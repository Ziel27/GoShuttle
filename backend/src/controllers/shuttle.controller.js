const mongoose = require('mongoose');
const validator = require('validator');
const Shuttle = require('../models/Shuttle');
const User = require('../models/User');
const Trip = require('../models/Trip');
const Community = require('../models/Community');
const PickupRequest = require('../models/PickupRequest');
const PassengerRide = require('../models/PassengerRide');
const RideRequest = require('../models/RideRequest');
const { isLocationInBoundary, distanceMeters } = require('../services/geofence');
const { normalizePhase, isShuttlePhaseCompatible } = require('../utils/phase');
const { retryWaitingQueue, } = require('../services/dispatch.service');
const { emitToTrackingRooms } = require('../services/socket-handlers');

const MAX_WRITE_CONFLICT_RETRIES = 3;
const LOCATION_WRITE_CONFLICT_RETRY_BASE_DELAY_MS = 80;

const isPlatformAdmin = (req) => req.user?.role === 'admin';

const resolveCommunityScopeId = (req, requestedCommunityId, options = {}) => {
  const { allowAll = false } = options;
  const ownCommunityId = String(req.user.communityId);

  if (!requestedCommunityId || requestedCommunityId === 'own') {
    if (allowAll && isPlatformAdmin(req)) {
      return null;
    }
    return ownCommunityId;
  }

  if (requestedCommunityId === 'all') {
    if (allowAll && isPlatformAdmin(req)) {
      return null;
    }
    return { error: 'Access denied. communityId is outside your scope.' };
  }

  if (!mongoose.Types.ObjectId.isValid(requestedCommunityId)) {
    return { error: 'Invalid communityId.' };
  }

  if (String(requestedCommunityId) === ownCommunityId || isPlatformAdmin(req)) {
    return String(requestedCommunityId);
  }

  return { error: 'Access denied. communityId is outside your scope.' };
};

const parseCoordinate = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const isRetryableMongoWriteConflict = (error) => {
  const responseLabels = error?.errorResponse?.errorLabels || [];
  const labelSet = error?.errorLabelSet;

  return (
    error?.code === 112 ||
    error?.codeName === 'WriteConflict' ||
    responseLabels.includes('TransientTransactionError') ||
    (typeof labelSet?.has === 'function' && labelSet.has('TransientTransactionError'))
  );
};

const validateCoordinates = (latitude, longitude) => {
  const lat = parseCoordinate(latitude);
  const lng = parseCoordinate(longitude);

  if (lat === null || lng === null) {
    return { valid: false, message: 'Latitude and longitude must be valid numbers.' };
  }

  if (lat < -90 || lat > 90) {
    return { valid: false, message: 'Latitude must be between -90 and 90.' };
  }

  if (lng < -180 || lng > 180) {
    return { valid: false, message: 'Longitude must be between -180 and 180.' };
  }

  return { valid: true, lat, lng };
};

const createOptionalSession = async () => {
  if (process.env.NODE_ENV === 'test') {
    return undefined;
  }

  return mongoose.startSession();
};

const waitMs = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

const applySession = (query, session) => (session ? query.session(session) : query);

/**
 * POST /api/shuttles
 * Admin creates a shuttle in their own community.
 */
const createShuttle = async (req, res) => {
  try {
    const { plateNumber, maxCapacity, label, communityId } = req.body;
    const assignedPhase = normalizePhase(req.body.assignedPhase);

    if (!plateNumber || maxCapacity === undefined) {
      return res.status(400).json({ error: 'plateNumber and maxCapacity are required.' });
    }

    if (!validator.isLength(String(plateNumber), { min: 3, max: 15 })) {
      return res.status(400).json({ error: 'Plate number must be between 3 and 15 characters.' });
    }

    const parsedCapacity = Number(maxCapacity);
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 5) {
      return res.status(400).json({ error: 'maxCapacity must be an integer between 1 and 5.' });
    }

    const scopedCommunityId = resolveCommunityScopeId(req, communityId, { allowAll: false });
    if (typeof scopedCommunityId !== 'string') {
      return res.status(403).json({ error: scopedCommunityId.error });
    }

    const shuttle = await Shuttle.create({
      communityId: scopedCommunityId,
      plateNumber: String(plateNumber).trim().toUpperCase(),
      maxCapacity: parsedCapacity,
      label: label ? String(label).trim() : '',
      assignedPhase,
    });

    return res.status(201).json({
      message: 'Shuttle created successfully.',
      shuttle,
    });
  } catch (error) {
    console.error('Create shuttle error:', error);

    if (error.code === 11000) {
      return res.status(409).json({ error: 'Plate number already exists.' });
    }

    return res.status(500).json({ error: 'Failed to create shuttle.' });
  }
};

/**
 * GET /api/shuttles
 * Lists active shuttles in the authenticated user's community.
 */
const listShuttles = async (req, res) => {
  try {
    const onlyActive = req.query.active !== 'false';
    const scopedCommunityId = resolveCommunityScopeId(req, req.query.communityId, { allowAll: true });

    if (scopedCommunityId && typeof scopedCommunityId !== 'string') {
      return res.status(403).json({ error: scopedCommunityId.error });
    }

    const query = {};

    if (scopedCommunityId) {
      query.communityId = scopedCommunityId;
    }

    if (onlyActive) {
      query.isActive = true;
    }

    const shuttles = await Shuttle.find(query)
      .populate('driverId', 'firstName lastName status')
      .populate('communityId', 'name')
      .sort({ updatedAt: -1 });

    if (req.user.role === 'passenger') {
      const passengerHomePhase = normalizePhase(req.user.homePhase);

      const passengerSafeShuttles = shuttles
        .filter((doc) => {
          // Hide shuttles that are phase-restricted to a different area than
          // the passenger's home phase, so the map only shows relevant shuttles.
          const shuttlePhase = normalizePhase(doc.assignedPhase);
          return isShuttlePhaseCompatible({ shuttlePhase, passengerHomePhase });
        })
        .map((doc) => {
          const shuttle = doc.toObject({ virtuals: true });
          const driverStatus = shuttle?.driverId && typeof shuttle.driverId === 'object'
            ? shuttle.driverId.status
            : null;

          if (driverStatus !== 'driving') {
            shuttle.location = {
              type: 'Point',
              coordinates: [],
            };
            shuttle.lastLocationUpdate = null;
            if (shuttle.status !== 'maintenance') {
              shuttle.status = 'idle';
            }
          }

          return shuttle;
        });

      return res.status(200).json({ count: passengerSafeShuttles.length, shuttles: passengerSafeShuttles });
    }

    return res.status(200).json({ count: shuttles.length, shuttles });
  } catch (error) {
    console.error('List shuttles error:', error);
    return res.status(500).json({ error: 'Failed to fetch shuttles.' });
  }
};

/**
 * PUT /api/shuttles/:id/location
 * Driver updates shuttle GPS. Rejects out-of-bound coordinates and flags shuttle status.
 */
const updateShuttleLocation = async (req, res) => {
  const { id } = req.params;
  const { latitude, longitude } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid shuttle ID.' });
  }

  const coords = validateCoordinates(latitude, longitude);
  if (!coords.valid) {
    return res.status(400).json({ error: coords.message });
  }

  for (let attempt = 1; attempt <= MAX_WRITE_CONFLICT_RETRIES; attempt += 1) {
    const session = await createOptionalSession();
    if (session) session.startTransaction();

    try {
      const shuttle = await applySession(Shuttle.findById(id), session);
      if (!shuttle || !shuttle.isActive) {
        if (session) await session.abortTransaction();
        return res.status(404).json({ error: 'Shuttle not found.' });
      }

      if (!isPlatformAdmin(req) && shuttle.communityId.toString() !== req.user.communityId.toString()) {
        if (session) await session.abortTransaction();
        return res.status(403).json({ error: 'Access denied. Shuttle is outside your community.' });
      }

      if (req.user.role === 'driver') {
        if (!shuttle.driverId || shuttle.driverId.toString() !== req.user._id.toString()) {
          if (session) await session.abortTransaction();
          return res.status(403).json({ error: 'Access denied. This shuttle is not assigned to you.' });
        }
      }

      const insideBoundary = await isLocationInBoundary({
        communityId: shuttle.communityId,
        latitude: coords.lat,
        longitude: coords.lng,
      });

      if (!insideBoundary) {
        shuttle.status = 'out_of_bounds';
        shuttle.lastLocationUpdate = new Date();
        await shuttle.save({ session });
        if (session) await session.commitTransaction();

        return res.status(403).json({
          error: 'Location rejected. Coordinate is outside the community boundary.',
          status: shuttle.status,
        });
      }

      shuttle.location = {
        type: 'Point',
        coordinates: [coords.lng, coords.lat],
      };
      shuttle.lastLocationUpdate = new Date();
      if (shuttle.status === 'out_of_bounds' || shuttle.status === 'idle') {
        shuttle.status = 'en_route';
      }

      await shuttle.save({ session });
      if (session) await session.commitTransaction();

      const io = req.app.get('io');
      const communityRoom = `community:${String(shuttle.communityId)}`;
      const shouldBroadcastPreciseLocation = req.user.role !== 'driver' || req.user.status === 'driving';

      io.to(communityRoom).emit('shuttle:location-updated', {
        shuttleId: shuttle._id,
        communityId: shuttle.communityId,
        location: shouldBroadcastPreciseLocation
          ? shuttle.location
          : { type: 'Point', coordinates: [] },
        status: shuttle.status,
        currentCapacity: shuttle.currentCapacity,
        maxCapacity: shuttle.maxCapacity,
        updatedAt: shuttle.lastLocationUpdate,
      });

      // Push real-time location to any public tracking pages watching this shuttle
      if (shouldBroadcastPreciseLocation) {
        emitToTrackingRooms(io, shuttle._id, shuttle.location, shuttle.lastLocationUpdate);
      }

      return res.status(200).json({
        message: 'Location updated.',
        shuttle,
      });
    } catch (error) {
      if (session) await session.abortTransaction();

      if (isRetryableMongoWriteConflict(error)) {
        if (attempt < MAX_WRITE_CONFLICT_RETRIES) {
          await waitMs(LOCATION_WRITE_CONFLICT_RETRY_BASE_DELAY_MS * attempt);
          continue;
        }

        return res.status(409).json({ error: 'Location update conflicted with another write. Please retry.' });
      }

      console.error('Update shuttle location error:', error);
      return res.status(500).json({ error: 'Failed to update location.' });
    } finally {
      if (session) session.endSession();
    }
  }

  return res.status(409).json({ error: 'Location update conflicted with another write. Please retry.' });
};

/**
 * PATCH /api/shuttles/:id/capacity
 * Driver/Admin adjusts current capacity by delta (default +1).
 */
const updateShuttleCapacity = async (req, res) => {
  try {
    const { id } = req.params;
    const delta = req.body.delta === undefined ? 1 : Number(req.body.delta);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid shuttle ID.' });
    }

    if (!Number.isInteger(delta) || delta === 0) {
      return res.status(400).json({ error: 'delta must be a non-zero integer.' });
    }

    const shuttle = await Shuttle.findById(id);
    if (!shuttle || !shuttle.isActive) {
      return res.status(404).json({ error: 'Shuttle not found.' });
    }

    if (shuttle.communityId.toString() !== req.user.communityId.toString()) {
      return res.status(403).json({ error: 'Access denied. Shuttle is outside your community.' });
    }

    if (req.user.role === 'driver') {
      if (!shuttle.driverId || shuttle.driverId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Access denied. This shuttle is not assigned to you.' });
      }
    }

    const nextCapacity = shuttle.currentCapacity + delta;
    if (nextCapacity < 0 || nextCapacity > shuttle.maxCapacity) {
      return res.status(400).json({
        error: `Capacity update rejected. Resulting capacity must be between 0 and ${shuttle.maxCapacity}.`,
      });
    }

    shuttle.currentCapacity = nextCapacity;
    shuttle.lastLocationUpdate = new Date();
    await shuttle.save();

    const io = req.app.get('io');
    const communityRoom = `community:${String(shuttle.communityId)}`;
    io.to(communityRoom).emit('shuttle:capacity-updated', {
      shuttleId: shuttle._id,
      communityId: shuttle.communityId,
      currentCapacity: shuttle.currentCapacity,
      maxCapacity: shuttle.maxCapacity,
      capacityStatus: shuttle.capacityStatus,
      updatedAt: shuttle.updatedAt,
    });

    return res.status(200).json({
      message: 'Shuttle capacity updated.',
      shuttle,
    });
  } catch (error) {
    console.error('Update shuttle capacity error:', error);
    return res.status(500).json({ error: 'Failed to update shuttle capacity.' });
  }
};

/**
 * PATCH /api/shuttles/:id/assign-driver
 * Admin assigns (or clears) a driver for a shuttle in the same community.
 */
const assignShuttleDriver = async (req, res) => {
  try {
    const { id } = req.params;
    const { driverId } = req.body;
    const normalizedAssignedPhase = normalizePhase(req.body.assignedPhase);
    const requesterCommunityId = req.user?.communityId ? req.user.communityId.toString() : '';

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid shuttle ID.' });
    }

    const shuttle = await Shuttle.findById(id);
    if (!shuttle || !shuttle.isActive) {
      return res.status(404).json({ error: 'Shuttle not found.' });
    }

    if (!isPlatformAdmin(req) && shuttle.communityId.toString() !== requesterCommunityId) {
      return res.status(403).json({ error: 'Access denied. Shuttle is outside your community.' });
    }

    const phaseUpdate = req.body.assignedPhase !== undefined ? { assignedPhase: normalizedAssignedPhase } : {};

    if (driverId === null || driverId === '' || driverId === undefined) {
      const cleared = await Shuttle.findByIdAndUpdate(
        id,
        { $set: { driverId: null, ...phaseUpdate } },
        { new: true, runValidators: false }
      ).populate('driverId', 'firstName lastName status');
      return res.status(200).json({ message: 'Driver assignment cleared.', shuttle: cleared });
    }

    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      return res.status(400).json({ error: 'Invalid driver ID.' });
    }

    const driver = await User.findById(driverId).select('_id role communityId isActive');
    if (!driver || !driver.isActive || driver.role !== 'driver') {
      return res.status(404).json({ error: 'Driver not found.' });
    }

    if (driver.communityId.toString() !== shuttle.communityId.toString()) {
      return res.status(403).json({ error: 'Driver must belong to the same community as the shuttle.' });
    }

    const updated = await Shuttle.findByIdAndUpdate(
      id,
      { $set: { driverId: driver._id, ...phaseUpdate } },
      { new: true, runValidators: false }
    ).populate('driverId', 'firstName lastName status');

    return res.status(200).json({
      message: 'Driver assigned successfully.',
      shuttle: updated,
    });
  } catch (error) {
    console.error('Assign shuttle driver error:', error);
    return res.status(500).json({ error: 'Failed to assign driver.' });
  }
};

module.exports = {
  createShuttle,
  listShuttles,
  updateShuttleLocation,
  updateShuttleCapacity,
  assignShuttleDriver,
};
