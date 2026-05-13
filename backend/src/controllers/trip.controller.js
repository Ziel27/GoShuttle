const crypto = require('crypto');
const mongoose = require('mongoose');
const validator = require('validator');
const Trip = require('../models/Trip');
const Shuttle = require('../models/Shuttle');
const Community = require('../models/Community');
const PickupRequest = require('../models/PickupRequest');
const PassengerRide = require('../models/PassengerRide');
const User = require('../models/User');
const ShiftRemittance = require('../models/ShiftRemittance');
const RideRequest = require('../models/RideRequest');
const { distanceMeters } = require('../services/geofence');
const { completeRideRequestsForPassengers } = require('../services/ride-request-lifecycle');
const { startManualAutomationCooldown } = require('../services/automation-cooldown');
const { uploadReceiptImage } = require('../services/cloudinary');
const { findAndDispatch, releaseAndRetry, retryWaitingQueue, releasePendingSlot, haversineMeters } = require('../services/dispatch.service');
const {
  normalizePhase,
  isShuttlePhaseCompatible,
  buildPhaseAwareRequestQuery,
} = require('../utils/phase');


const MAX_REMITTANCE_AMOUNT = 1000000;
const DEFAULT_FIXED_DESTINATION_PICKUP_RADIUS_METERS = 80;

const isPlatformAdmin = (req) => req.user?.role === 'admin';

const resolveCommunityScopeObjectId = (req, requestedCommunityId, options = {}) => {
  const { allowAll = false } = options;
  const ownCommunityId = String(req.user.communityId);

  if (!requestedCommunityId || requestedCommunityId === 'own') {
    if (allowAll && isPlatformAdmin(req)) {
      return null;
    }
    return new mongoose.Types.ObjectId(ownCommunityId);
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
    return new mongoose.Types.ObjectId(String(requestedCommunityId));
  }

  return { error: 'Access denied. communityId is outside your scope.' };
};

const parseCoordinate = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

const parseMoney = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_REMITTANCE_AMOUNT) {
    return null;
  }

  return Number(parsed.toFixed(2));
};

const getFixedDestinationPickupRadiusMeters = (destination) => {
  const radius = Number(destination?.pickupRadiusMeters);
  if (!Number.isFinite(radius) || radius <= 0) {
    return DEFAULT_FIXED_DESTINATION_PICKUP_RADIUS_METERS;
  }

  return radius;
};

const findNearbyHomeDestination = (homeDestination, latitude, longitude) => {
  const coordinates = homeDestination?.location?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 2) {
    return null;
  }

  const homePoint = {
    latitude: Number(coordinates[1]),
    longitude: Number(coordinates[0]),
  };

  const distance = distanceMeters({ latitude, longitude }, homePoint);
  if (distance > DEFAULT_FIXED_DESTINATION_PICKUP_RADIUS_METERS) {
    return null;
  }

  return {
    type: 'home',
    label: homeDestination?.label?.trim() || 'Home address',
  };
};

const findNearbyFixedDestination = (fixedDestinations, latitude, longitude) => {
  const pickupPoint = { latitude, longitude };
  let nearestDestination = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const destination of fixedDestinations || []) {
    if (destination?.isActive === false) continue;

    const coordinates = destination?.location?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length !== 2) continue;

    const destinationPoint = {
      latitude: Number(coordinates[1]),
      longitude: Number(coordinates[0]),
    };

    const radiusMeters = getFixedDestinationPickupRadiusMeters(destination);
    const distance = distanceMeters(pickupPoint, destinationPoint);
    if (distance > radiusMeters || distance >= nearestDistance) continue;

    nearestDistance = distance;
    nearestDestination = destination;
  }

  return nearestDestination;
};

const detectPickupOrigin = ({ homeDestination, fixedDestinations, latitude, longitude }) => {
  const nearbyHome = findNearbyHomeDestination(homeDestination, latitude, longitude);
  if (nearbyHome) {
    return nearbyHome;
  }

  const nearbyFixed = findNearbyFixedDestination(fixedDestinations, latitude, longitude);
  if (nearbyFixed) {
    return {
      type: 'fixed',
      label: nearbyFixed.name,
    };
  }

  return {
    type: 'unknown',
    label: 'Current pickup location not matched to Home or a fixed destination yet.',
  };
};

const parseDestinationPayload = (destination) => {
  if (!destination || typeof destination !== 'object') {
    return { valid: false, message: 'destination is required.' };
  }

  const destinationType = String(destination.type || '');
  if (!['fixed', 'home'].includes(destinationType)) {
    return { valid: false, message: "destination.type must be either 'fixed' or 'home'." };
  }

  if (destinationType === 'fixed') {
    if (!mongoose.Types.ObjectId.isValid(String(destination.fixedDestinationId || ''))) {
      return { valid: false, message: 'destination.fixedDestinationId must be a valid id.' };
    }
    return {
      valid: true,
      type: 'fixed',
      fixedDestinationId: String(destination.fixedDestinationId),
    };
  }

  const coords = validateCoordinates(destination.latitude, destination.longitude);
  if (!coords.valid) {
    return { valid: false, message: `destination coordinates invalid: ${coords.message}` };
  }

  const label = String(destination.label || 'Home').trim().slice(0, 120) || 'Home';
  return {
    valid: true,
    type: 'home',
    label,
    latitude: coords.lat,
    longitude: coords.lng,
  };
};

const claimPendingPickupRequests = async ({ session, communityId, maxCount, shuttlePhase }) => {
  const claimed = [];
  const phaseQuery = buildPhaseAwareRequestQuery({
    shuttlePhase,
    passengerPhaseField: 'passengerHomePhase',
  });

  for (let i = 0; i < maxCount; i += 1) {
    const request = await PickupRequest.findOneAndUpdate(
      {
        communityId,
        status: 'pending',
        expiresAt: { $gt: new Date() },
        ...phaseQuery,
      },
      { $set: { status: 'claimed' } },
      {
        session,
        sort: { createdAt: 1 },
        new: true,
      }
    );

    if (!request) break;
    claimed.push(request);
  }

  return claimed;
};

const toPeriodKeyForSummary = (date, groupBy) => {
  const current = new Date(date);
  if (groupBy === 'month') {
    return `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  if (groupBy === 'week') {
    const weekDate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
    const dayNum = weekDate.getUTCDay() || 7;
    weekDate.setUTCDate(weekDate.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((weekDate - yearStart) / 86400000) + 1) / 7);
    return `${weekDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  return `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}-${String(current.getUTCDate()).padStart(2, '0')}`;
};

const createOptionalSession = async () => {
  if (process.env.NODE_ENV === 'test') {
    return undefined;
  }

  return mongoose.startSession();
};

const SHIFT_WINDOW_FALLBACK_MS = 12 * 60 * 60 * 1000;

const resolveDriverShiftWindowStart = async ({ activeTrip, driverId }) => {
  if (activeTrip?.shiftStart instanceof Date) {
    return activeTrip.shiftStart;
  }

  const driver = await User.findById(driverId)
    .select('status updatedAt')
    .lean();

  if (driver?.status === 'driving' && driver.updatedAt instanceof Date) {
    return driver.updatedAt;
  }

  return new Date(Date.now() - SHIFT_WINDOW_FALLBACK_MS);
};

const listUnresolvedRideRequestsForShift = async ({ communityId, shiftStart, shuttlePhase }) => {
  const phaseQuery = buildPhaseAwareRequestQuery({
    shuttlePhase,
    passengerPhaseField: 'passengerHomePhase',
  });

  return RideRequest.find({
    communityId,
    status: 'pending',
    createdAt: {
      $gte: shiftStart,
      $lte: new Date(),
    },
    ...phaseQuery,
  })
    .select('_id passengerId destination fareExpected createdAt')
    .populate('passengerId', 'firstName lastName')
    .lean();
};

const mapUnresolvedRideRequest = (request) => ({
  requestId: request._id,
  passengerName: request.passengerId
    ? `${request.passengerId.firstName} ${request.passengerId.lastName}`.trim()
    : 'Unknown',
  passengerId: request.passengerId?._id || request.passengerId,
  destinationLabel: request.destination?.label || 'Destination',
  fareExpected: request.fareExpected,
  createdAt: request.createdAt,
});

const countIgnoredRideRequestsForTrip = async (trip) => {
  if (!trip?.shiftStart) {
    return 0;
  }

  return RideRequest.countDocuments({
    communityId: trip.communityId,
    status: 'ignored',
    createdAt: {
      $gte: trip.shiftStart,
      $lte: trip.shiftEnd || new Date(),
    },
  });
};

const shouldEnforceDriverShift = process.env.NODE_ENV !== 'test';

/**
 * POST /api/trips/passenger-board
 * Driver's +1 Passenger action. Creates or updates the active shift trip.
 */
const passengerBoard = async (req, res) => {
  const session = await createOptionalSession();
  if (session) session.startTransaction();

  try {
    const { shuttleId } = req.body;
    const boardedCount = req.body.boardedCount === undefined ? 1 : Number(req.body.boardedCount);

    if (!shuttleId) {
      if (session) await session.abortTransaction();
      return res.status(400).json({ error: 'shuttleId is required.' });
    }

    if (!validator.isMongoId(String(shuttleId))) {
      if (session) await session.abortTransaction();
      return res.status(400).json({ error: 'Invalid shuttle ID.' });
    }

    if (!Number.isInteger(boardedCount) || boardedCount <= 0) {
      if (session) await session.abortTransaction();
      return res.status(400).json({ error: 'boardedCount must be a positive integer.' });
    }

    // Fetch shuttle within transaction with session lock
    const shuttle = await Shuttle.findById(shuttleId).session(session);
    if (!shuttle || !shuttle.isActive) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ error: 'Shuttle not found.' });
    }

    if (shuttle.communityId.toString() !== req.user.communityId.toString()) {
      if (session) await session.abortTransaction();
      return res.status(403).json({ error: 'Access denied. Shuttle is outside your community.' });
    }

    if (!shuttle.driverId || shuttle.driverId.toString() !== req.user._id.toString()) {
      if (session) await session.abortTransaction();
      return res.status(403).json({ error: 'Access denied. This shuttle is not assigned to you.' });
    }

    if (shouldEnforceDriverShift && req.user.status !== 'driving') {
      if (session) await session.abortTransaction();
      return res.status(409).json({ error: 'Start your shift first before boarding passengers.' });
    }

    if (shuttle.currentCapacity + boardedCount > shuttle.maxCapacity) {
      if (session) await session.abortTransaction();
      return res.status(409).json({
        error: `Shuttle is full. Available seats: ${Math.max(0, shuttle.maxCapacity - shuttle.currentCapacity)}.`,
      });
    }

    // Enforce boarded seats against active pickup intents so driver actions are auditable.
    const pendingRequests = await claimPendingPickupRequests({
      session,
      communityId: shuttle.communityId,
      maxCount: boardedCount,
      shuttlePhase: shuttle.assignedPhase,
    });

    // DISPATCH: Decrement pendingPickupCount for each dispatched PickupRequest that is now physically boarding
    const dispatchedClaimedIds = pendingRequests
      .filter((r) => r.status === 'claimed' && r.assignedShuttleId)
      .map((r) => r._id);

    if (dispatchedClaimedIds.length > 0) {
      // Each claimed dispatched request had a pending slot reserved — release them now
      await Shuttle.updateOne(
        { _id: shuttle._id },
        { $inc: { pendingPickupCount: -dispatchedClaimedIds.length } }
      ).session(session);

      // Ensure pendingPickupCount doesn't go below 0
      await Shuttle.updateOne(
        { _id: shuttle._id, pendingPickupCount: { $lt: 0 } },
        { $set: { pendingPickupCount: 0 } }
      ).session(session);
    }


    const community = await Community.findById(shuttle.communityId).select('baseFare').session(session);
    if (!community) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ error: 'Community not found.' });
    }

    // Find or create active trip within transaction
    let activeTrip = await Trip.findOne({
      communityId: shuttle.communityId,
      shuttleId: shuttle._id,
      driverId: req.user._id,
      status: 'active',
    }).session(session);

    if (!activeTrip) {
      [activeTrip] = await Trip.create([{
        communityId: shuttle.communityId,
        shuttleId: shuttle._id,
        driverId: req.user._id,
        fareAtTime: community.baseFare,
        passengersBoarded: 0,
        revenueCollected: 0,
      }], { session });
    }

    // Update trip within transaction
    activeTrip.passengersBoarded += boardedCount;
    activeTrip.revenueCollected = activeTrip.passengersBoarded * activeTrip.fareAtTime;
    await activeTrip.save({ session });

    // Create passenger ride records for pickup-intent based boardings when available.
    // Manual board actions remain supported even without pending pickup intents.
    if (pendingRequests.length > 0) {
      const boardedAt = new Date();

      const passengerRidesToInsert = [];
      for (const request of pendingRequests) {
        // Prefer authoritative RideRequest documents linked to this pickup request so
        // we accurately create PassengerRide rows and keep linkage to the audit ledger.
        const linkedRideRequests = await RideRequest.find({ pickupRequestId: request._id, status: 'pending' }).session(session);

        if (linkedRideRequests && linkedRideRequests.length > 0) {
          for (const rr of linkedRideRequests) {
            const rrDiscountType = rr.discountType && rr.discountType !== 'none' ? rr.discountType : 'none';
            const rrOriginalFare = rr.originalFare || null;
            const rrFareAtBoarding = rrDiscountType !== 'none' && rr.fareExpected ? rr.fareExpected : activeTrip.fareAtTime;
            passengerRidesToInsert.push({
              communityId: shuttle.communityId,
              passengerId: rr.passengerId || null,
              passengerName: rr.passengerName || null,
              passengerPhone: rr.passengerPhone || null,
              shuttleId: shuttle._id,
              driverId: req.user._id,
              tripId: activeTrip._id,
              rideRequestId: rr._id,
              fareAtBoarding: rrFareAtBoarding,
              discountType: rrDiscountType,
              originalFare: rrOriginalFare,
              pickupLocation: rr.pickupLocation || request.pickupLocation || request.location,
              destinationType: rr.destination?.type || request.destinationType || 'fixed',
              destinationLabel: rr.destination?.label || request.destinationLabel || 'Destination',
              destinationLocation: rr.destination?.location || request.destinationLocation,
              requestedAt: rr.createdAt || request.createdAt,
              boardedAt,
              status: 'boarded',
            });
          }
        } else if (Array.isArray(request.passengerManifest) && request.passengerManifest.length > 0) {
          for (const entry of request.passengerManifest) {
            passengerRidesToInsert.push({
              communityId: shuttle.communityId,
              passengerId: entry.passengerId || null,
              passengerName: entry.name || null,
              passengerPhone: entry.phone || null,
              shuttleId: shuttle._id,
              driverId: req.user._id,
              tripId: activeTrip._id,
              fareAtBoarding: activeTrip.fareAtTime,
              discountType: 'none',
              pickupLocation: request.pickupLocation || request.location,
              destinationType: request.destinationType || 'fixed',
              destinationLabel: request.destinationLabel || 'Destination',
              destinationLocation: request.destinationLocation,
              requestedAt: request.createdAt,
              boardedAt,
              status: 'boarded',
            });
          }
        } else {
          passengerRidesToInsert.push({
            communityId: shuttle.communityId,
            passengerId: request.passengerId,
            shuttleId: shuttle._id,
            driverId: req.user._id,
            tripId: activeTrip._id,
            fareAtBoarding: activeTrip.fareAtTime,
            discountType: 'none',
            pickupLocation: request.pickupLocation || request.location,
            destinationType: request.destinationType || 'fixed',
            destinationLabel: request.destinationLabel || 'Destination',
            destinationLocation: request.destinationLocation,
            requestedAt: request.createdAt,
            boardedAt,
            status: 'boarded',
          });
        }
      }

      if (passengerRidesToInsert.length > 0) {
        await PassengerRide.insertMany(passengerRidesToInsert, { session });
      }

      // PERSISTENCE: Update linked RideRequest records to reflect successful boarding
      const claimedPickupIds = pendingRequests.map((r) => r._id);
      await RideRequest.updateMany(
        { pickupRequestId: { $in: claimedPickupIds }, status: 'pending' },
        {
          $set: {
            status: 'boarded',
            shuttleId: shuttle._id,
            tripId: activeTrip._id,
            boardedAt,
          },
        },
        { session }
      );
    } else {
      // Manual board with no matching pickup intents — create anonymous PassengerRide records for audit.
      const boardedAt = new Date();
      const anonymousRides = Array.from({ length: boardedCount }, () => ({
        communityId: shuttle.communityId,
        passengerId: null,
        shuttleId: shuttle._id,
        driverId: req.user._id,
        tripId: activeTrip._id,
        fareAtBoarding: activeTrip.fareAtTime,
        destinationType: 'fixed',
        destinationLabel: 'Unknown',
        requestedAt: boardedAt,
        boardedAt,
        status: 'boarded',
      }));
      if (anonymousRides.length > 0) {
        await PassengerRide.insertMany(anonymousRides, { session });
      }
    }

    // Update shuttle within transaction
    shuttle.currentCapacity += boardedCount;
    shuttle.status = 'en_route';
    shuttle.lastLocationUpdate = new Date();
    await shuttle.save({ session });

    // Commit transaction
    if (session) await session.commitTransaction();

    // Pause location-triggered automation briefly to avoid manual+auto double processing.
    startManualAutomationCooldown(shuttle._id);

    // Emit event after successful transaction
    const io = req.app.get('io');
    const communityRoom = `community:${String(shuttle.communityId)}`;
    io.to(communityRoom).emit('trip:passenger-boarded', {
      tripId: activeTrip._id,
      shuttleId: shuttle._id,
      communityId: shuttle.communityId,
      boardedCount,
      passengersBoarded: activeTrip.passengersBoarded,
      revenueCollected: activeTrip.revenueCollected,
      currentCapacity: shuttle.currentCapacity,
      maxCapacity: shuttle.maxCapacity,
      pendingPickupCount: shuttle.pendingPickupCount,
    });

    for (const request of pendingRequests) {
      io.to(communityRoom).emit('trip:pickup-claimed', {
        requestId: request._id,
        passengerId: request.passengerId,
        shuttleId: shuttle._id,
        tripId: activeTrip._id,
      });
    }

    // DISPATCH: Retry waiting queue — a seat opened up after physical boarding frees capacity checks
    setImmediate(() => {
      retryWaitingQueue(shuttle.communityId, io).catch((err) =>
        console.error('[passengerBoard] retryWaitingQueue error:', err)
      );
    });


    return res.status(200).json({
      message: 'Passenger boarding recorded.',
      trip: activeTrip,
      shuttle,
    });
  } catch (error) {
    if (session) await session.abortTransaction();
    console.error('Passenger board error:', error);
    return res.status(500).json({ error: 'Failed to record passenger boarding.' });
  } finally {
    if (session) session.endSession();
  }
};

/**
 * POST /api/trips/shift-end
 * Completes active shift and returns summary.
 */
const endShift = async (req, res) => {
  try {
    const { shuttleId } = req.body;

    if (!shuttleId || !mongoose.Types.ObjectId.isValid(shuttleId)) {
      return res.status(400).json({ error: 'Valid shuttleId is required.' });
    }

    const shuttle = await Shuttle.findById(shuttleId);
    if (!shuttle || !shuttle.isActive) {
      return res.status(404).json({ error: 'Shuttle not found.' });
    }

    if (shuttle.communityId.toString() !== req.user.communityId.toString()) {
      return res.status(403).json({ error: 'Access denied. Shuttle is outside your community.' });
    }

    if (!shuttle.driverId || shuttle.driverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied. This shuttle is not assigned to you.' });
    }

    const activeTrip = await Trip.findOne({
      communityId: shuttle.communityId,
      shuttleId: shuttle._id,
      driverId: req.user._id,
      status: 'active',
    });

    const shiftWindowStart = await resolveDriverShiftWindowStart({
      activeTrip,
      driverId: req.user._id,
    });

    // SHIFT-END GATE: Block completion if there are unresolved ride requests
    // even when no Trip row exists yet (e.g. no boarded passengers this shift).
    const unresolvedRequests = await listUnresolvedRideRequestsForShift({
      communityId: shuttle.communityId,
      shiftStart: shiftWindowStart,
      shuttlePhase: shuttle.assignedPhase,
    });

    if (unresolvedRequests.length > 0) {
      return res.status(409).json({
        error: 'Unresolved ride requests must be resolved before ending shift.',
        unresolvedRequests: unresolvedRequests.map(mapUnresolvedRideRequest),
      });
    }

    if (!activeTrip) {
      return res.status(404).json({ error: 'No active trip found for this shuttle.' });
    }

    activeTrip.status = 'completed';
    activeTrip.shiftEnd = new Date();
    activeTrip.revenueCollected = activeTrip.passengersBoarded * activeTrip.fareAtTime;
    await activeTrip.save();

    // Notify passengers still on board so their app UI reflects the shift ending
    const boardedRides = await PassengerRide.find({
      tripId: activeTrip._id,
      status: 'boarded',
    }).select('_id passengerId').lean();

    if (boardedRides.length > 0) {
      const endShiftIo = req.app.get('io');
      const rideIds = boardedRides.map((r) => String(r._id));
      for (const ride of boardedRides) {
        if (ride.passengerId) {
          endShiftIo.to(`user:${String(ride.passengerId)}`).emit('trip:passenger-auto-unboarded', { rideIds });
        }
      }
    }

    // Mark any remaining boarded ride requests as completed for this trip
    await RideRequest.updateMany(
      { tripId: activeTrip._id, status: 'boarded' },
      { $set: { status: 'completed', completedAt: activeTrip.shiftEnd } }
    );

    shuttle.currentCapacity = 0;
    shuttle.status = 'idle';
    shuttle.lastLocationUpdate = new Date();
    await shuttle.save();

    // REMITTANCE ENFORCEMENT: Create tracking ShiftRemittance record
    const deadlineAt = new Date(activeTrip.shiftEnd.getTime() + 24 * 60 * 60 * 1000);
    const expectedAmount = Number((activeTrip.revenueCollected).toFixed(2));
    
    await ShiftRemittance.create({
      communityId: shuttle.communityId,
      tripId: activeTrip._id,
      shuttleId: shuttle._id,
      driverId: req.user._id,
      expectedAmount,
      status: 'not_submitted',
      shift_ended_at: activeTrip.shiftEnd,
      deadline_at: deadlineAt,
    });

    // Notify driver about the shift end and remittance requirement
    const io = req.app.get('io');
    const driverRoom = `user:${String(req.user._id)}`;
    io.to(driverRoom).emit('notification', {
      title: 'Shift Completed',
      body: `Review your shift summary and submit your remittance of ₱${expectedAmount.toFixed(2)} within 24 hours.`,
      type: 'shift_ended',
    });

    const summary = {
      tripId: activeTrip._id,
      shiftStart: activeTrip.shiftStart,
      shiftEnd: activeTrip.shiftEnd,
      passengersBoarded: activeTrip.passengersBoarded,
      fareAtTime: activeTrip.fareAtTime,
      revenueCollected: activeTrip.revenueCollected,
    };

    return res.status(200).json({
      message: 'Shift completed successfully.',
      summary,
    });
  } catch (error) {
    console.error('End shift error:', error);
    return res.status(500).json({ error: 'Failed to complete shift.' });
  }
};

/**
 * POST /api/trips/sync-offline
 * Upserts offline entries using clientSyncId to avoid duplicates.
 */
const syncOfflineTrips = async (req, res) => {
  try {
    const { entries } = req.body;

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries must be a non-empty array.' });
    }

    const results = {
      inserted: 0,
      skipped: 0,
      invalid: 0,
    };

    for (const entry of entries) {
      const {
        clientSyncId,
        shuttleId,
        passengersBoarded,
        fareAtTime,
        shiftStart,
        shiftEnd,
      } = entry;

      if (!clientSyncId || !shuttleId || !validator.isMongoId(String(shuttleId))) {
        results.invalid += 1;
        continue;
      }

      const boarded = Number(passengersBoarded);
      const fare = Number(fareAtTime);
      if (!Number.isFinite(boarded) || boarded < 0 || !Number.isFinite(fare) || fare < 0) {
        results.invalid += 1;
        continue;
      }

      const shuttle = await Shuttle.findById(shuttleId).select('communityId');
      if (!shuttle || shuttle.communityId.toString() !== req.user.communityId.toString()) {
        results.invalid += 1;
        continue;
      }

      const existing = await Trip.findOne({ clientSyncId }).select('_id');
      if (existing) {
        results.skipped += 1;
        continue;
      }

      await Trip.create({
        communityId: req.user.communityId,
        shuttleId,
        driverId: req.user._id,
        passengersBoarded: boarded,
        fareAtTime: fare,
        revenueCollected: boarded * fare,
        clientSyncId,
        shiftStart: shiftStart ? new Date(shiftStart) : new Date(),
        shiftEnd: shiftEnd ? new Date(shiftEnd) : new Date(),
        status: 'synced',
      });

      results.inserted += 1;
    }

    return res.status(200).json({
      message: 'Offline sync completed.',
      results,
    });
  } catch (error) {
    console.error('Sync offline trips error:', error);
    return res.status(500).json({ error: 'Failed to sync offline trips.' });
  }
};

/**
 * POST /api/trips/pickup-intent
 * Passenger drops a temporary pickup pin for drivers in the same community.
 */
const createPickupIntent = async (req, res) => {
  try {
    const { latitude, longitude, destination, detectedPhase, pickupLocation, passengerManifest } = req.body;
    const fareType = ['priority', 'standard'].includes(req.body.fareType) ? req.body.fareType : 'standard';
    const note = req.body.note && typeof req.body.note === 'string'
      ? req.body.note.trim().slice(0, 300) || null
      : null;

    const VALID_DISCOUNT_TYPES = ['student', 'pwd', 'senior'];


    const coords = validateCoordinates(latitude, longitude);
    if (!coords.valid) {
      return res.status(400).json({ error: coords.message });
    }

    const community = await Community.findById(req.user.communityId).select('fixedDestinations baseFare priorityFareMultiplier discountSettings');
    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const passenger = await User.findById(req.user._id).select('homePhase homeDestination').lean();
    const passengerHomePhase = normalizePhase(passenger?.homePhase);

    // If client provided an explicit pickupLocation (booking-for-others), validate it
    let explicitPickupPoint = null;
    let pickupDetectionLat = coords.lat;
    let pickupDetectionLng = coords.lng;
    if (pickupLocation && typeof pickupLocation === 'object') {
      const pcoords = validateCoordinates(pickupLocation.latitude, pickupLocation.longitude);
      if (!pcoords.valid) {
        return res.status(400).json({ error: `pickupLocation invalid: ${pcoords.message}` });
      }
      explicitPickupPoint = { type: 'Point', coordinates: [pcoords.lng, pcoords.lat] };
      pickupDetectionLat = pcoords.lat;
      pickupDetectionLng = pcoords.lng;
    }

    const pickupOrigin = detectPickupOrigin({
      homeDestination: passenger?.homeDestination,
      fixedDestinations: community.fixedDestinations,
      latitude: pickupDetectionLat,
      longitude: pickupDetectionLng,
    });

    // Use detected phase from current location, fallback to saved homePhase
    const passsengerPhaseForDispatch = detectedPhase
      ? normalizePhase(detectedPhase)
      : passengerHomePhase;

    // Backward-compatible default destination for legacy clients not sending destination payload.
    let destinationType = 'fixed';
    let destinationLabel = 'Destination';
    let destinationLocation = {
      type: 'Point',
      coordinates: [coords.lng, coords.lat],
    };

    if (destination !== undefined) {
      const destinationPayload = parseDestinationPayload(destination);
      if (!destinationPayload.valid) {
        return res.status(400).json({ error: destinationPayload.message });
      }

      destinationType = destinationPayload.type;

      if (destinationPayload.type === 'fixed') {
        // Skip origin enforcement when an explicit pickupLocation is provided (booking-for-others)
        if (!explicitPickupPoint && pickupOrigin.type !== 'home') {
          return res.status(403).json({
            error: 'Fixed destinations are only available when you are at your home pickup location.',
          });
        }

        const selectedFixed = (community.fixedDestinations || []).find(
          (item) => String(item._id) === destinationPayload.fixedDestinationId && item.isActive !== false
        );
        if (!selectedFixed) {
          return res.status(404).json({ error: 'Selected fixed destination not found or inactive.' });
        }
        destinationLabel = selectedFixed.name;
        destinationLocation = selectedFixed.location;
      } else {
        // Skip origin enforcement when an explicit pickupLocation is provided (booking-for-others)
        if (!explicitPickupPoint && pickupOrigin.type !== 'fixed') {
          return res.status(403).json({
            error: 'Home destinations are only available when you are at a fixed destination.',
          });
        }

        destinationLabel = destinationPayload.label;
        destinationLocation = {
          type: 'Point',
          coordinates: [destinationPayload.longitude, destinationPayload.latitude],
        };
      }
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // explicitPickupPoint (if any) is already validated above and will be used when creating RideRequests

    const baseFareForType = fareType === 'priority'
      ? Number((community.baseFare * (community.priorityFareMultiplier ?? 1.5)).toFixed(2))
      : community.baseFare;

    // ── Discount resolution ───────────────────────────────────────────────────
    const getDiscountPct = (dtype) => {
      if (!dtype) return 0;
      const ds = community.discountSettings || {};
      if (!ds.enabled) return 0;
      if (dtype === 'student') return ds.studentPct || 0;
      if (dtype === 'pwd') return ds.pwdPct || 0;
      if (dtype === 'senior') return ds.seniorPct || 0;
      return 0;
    };

    // fareExpected is the total for the first passenger (for backward compat, keep it per-seat)
    const fareExpected = baseFareForType;

    // PERSISTENCE: Create permanent ride request(s) BEFORE ephemeral pickup intent.
    // Support passengerManifest for delegated/group bookings. If no manifest is provided,
    // we default it to the primary passenger, making sure their name and optional phone
    // are visible to the driver.
    const MAX_PASSENGERS_PER_BOOKING = 5;

    let finalPassengerManifest = passengerManifest;
    if (!Array.isArray(finalPassengerManifest) || finalPassengerManifest.length === 0) {
      finalPassengerManifest = [{
        passengerId: req.user._id,
        name: `${req.user.firstName} ${req.user.lastName}`.trim(),
        phone: req.user.phone || null,
        discountType: 'none',
      }];
    }

    if (finalPassengerManifest.length > MAX_PASSENGERS_PER_BOOKING) {
      return res.status(400).json({
        error: `A single booking cannot exceed ${MAX_PASSENGERS_PER_BOOKING} passengers (shuttle maximum capacity).`,
      });
    }

    const freshUser = await User.findById(req.user._id).select('discountVerification').lean();
    const ownerVerification = freshUser?.discountVerification;
    const isOwnerVerificationApproved = ownerVerification
      && ['approved', 'verified'].includes(ownerVerification.status)
      && (!ownerVerification.validUntil || new Date(ownerVerification.validUntil) > new Date())
      && VALID_DISCOUNT_TYPES.includes(ownerVerification.type);
    const ownerVerifiedDiscountType = isOwnerVerificationApproved ? ownerVerification.type : 'none';

    // Validate and normalize discount types in manifest.
    // Owner discount is always derived from account verification state.
    const normalizedManifest = finalPassengerManifest.map((entry, idx) => {
      const isOwnerEntry = String(entry.passengerId || '') === String(req.user._id)
        || (idx === 0 && (!entry.passengerId || String(entry.passengerId) === String(req.user._id)));

      return {
        ...entry,
        passengerId: isOwnerEntry ? req.user._id : entry.passengerId,
        discountType: isOwnerEntry
          ? ownerVerifiedDiscountType
          : (VALID_DISCOUNT_TYPES.includes(entry.discountType) ? entry.discountType : 'none'),
      };
    });

    // Build discount notes for passengers with active discounts
    let finalNote = note;
    const discountNotes = normalizedManifest
      .map((entry, idx) => {
        if (entry.discountType === 'none') {
          return null;
        }
        const entryDiscountPct = getDiscountPct(entry.discountType);
        if (entryDiscountPct <= 0) return null;
        const discountLabel = { student: 'Student', pwd: 'PWD', senior: 'Senior Citizen' }[entry.discountType] || entry.discountType;
        const guestName = entry.name || (String(entry.passengerId || '') === String(req.user._id) ? 'Account Owner' : `Guest ${idx + 1}`);
        return `${guestName}: ${discountLabel} ID required`;
      })
      .filter(Boolean);

    if (discountNotes.length > 0) {
      const idNote = `[Discounts] ${discountNotes.join(' | ')}`;
      finalNote = note ? `${note} | ${idNote}` : idNote;
      finalNote = finalNote.slice(0, 500);
    }
    const rideRequestsToCreate = [];
    for (let i = 0; i < normalizedManifest.length; i++) {
      const entry = normalizedManifest[i];
      const passengerDiscountType = entry.discountType;
      const getPassengerDiscountPct = (dtype) => {
        if (!dtype || dtype === 'none') return 0;
        const ds = community.discountSettings || {};
        if (!ds.enabled) return 0;
        if (dtype === 'student') return ds.studentPct || 0;
        if (dtype === 'pwd') return ds.pwdPct || 0;
        if (dtype === 'senior') return ds.seniorPct || 0;
        return 0;
      };
      const passengerDiscountPct = getPassengerDiscountPct(passengerDiscountType);
      const passengerDiscountedFare = passengerDiscountPct > 0
        ? Number((baseFareForType * (1 - passengerDiscountPct / 100)).toFixed(2))
        : baseFareForType;
      const isDiscounted = passengerDiscountType && passengerDiscountType !== 'none' && passengerDiscountPct > 0;
      const rr = {
        communityId: req.user.communityId,
        passengerId: entry.passengerId && mongoose.Types.ObjectId.isValid(String(entry.passengerId)) ? entry.passengerId : null,
        passengerName: entry.name || null,
        passengerPhone: entry.phone || null,
        bookingOwner: req.user._id,
        pickupLocation: explicitPickupPoint || { type: 'Point', coordinates: [coords.lng, coords.lat] },
        passengerHomePhase: passsengerPhaseForDispatch,
        destination: {
          type: destinationType,
          label: destinationLabel,
          location: destinationLocation,
        },
        fareExpected: isDiscounted ? passengerDiscountedFare : baseFareForType,
        originalFare: isDiscounted ? baseFareForType : null,
        discountType: passengerDiscountType || 'none',
        note: finalNote,
        status: 'pending',
      };
      rideRequestsToCreate.push(rr);
    }

    const createdRideRequests = await RideRequest.create(rideRequestsToCreate);

    const trackingToken = crypto.randomUUID();
    const trackingMode = Array.isArray(passengerManifest) && passengerManifest.length > 0 ? 'driver' : 'passenger';
    const webBaseUrl = process.env.WEB_BASE_URL || '';
    const trackingUrl = webBaseUrl ? `${webBaseUrl}/track/${trackingToken}` : null;

    const pickupRequest = await PickupRequest.create({
      communityId: req.user.communityId,
      passengerId: req.user._id,
      bookingOwner: req.user._id,
      passengerManifest: normalizedManifest.map((p) => ({
        passengerId: p.passengerId && mongoose.Types.ObjectId.isValid(String(p.passengerId)) ? p.passengerId : null,
        name: p.name || null,
        phone: p.phone || null,
        discountType: p.discountType || 'none',
      })),
      location: explicitPickupPoint || {
        type: 'Point',
        coordinates: [coords.lng, coords.lat],
      },
      pickupLocation: explicitPickupPoint,
      destinationType,
      destinationLabel,
      destinationLocation,
      passengerHomePhase: passsengerPhaseForDispatch,
      fareType,
      note,
      trackingToken,
      trackingMode,
      status: 'pending',
      expiresAt,
    });


    // Link the permanent ride requests to the ephemeral pickup intent
    await RideRequest.updateMany(
      { _id: { $in: createdRideRequests.map((r) => r._id) } },
      { $set: { pickupRequestId: pickupRequest._id } }
    );

    const io = req.app.get('io');

    // DISPATCH: Find nearest driver and auto-assign.
    // In test mode we keep requests pending to preserve deterministic integration flows.
    let dispatchResult = {
      dispatched: false,
      shuttle: null,
      queuePosition: null,
      queueReason: null,
    };

    if (process.env.NODE_ENV !== 'test') {
      dispatchResult = await findAndDispatch({
        communityId: req.user.communityId,
        passengerId: req.user._id,
        location: pickupRequest.location,
        fareType,
        fareExpected,
        passengerHomePhase: passsengerPhaseForDispatch,
        pickupRequest,
        io,
      });
    }

    // Server-side: Emit pickup intents only to drivers whose shuttle can fully
    // accommodate every passenger in the request. This avoids showing requests
    // to shuttles that don't have enough available seats.
    const passengerCount = Array.isArray(pickupRequest.passengerManifest) && pickupRequest.passengerManifest.length > 0
      ? pickupRequest.passengerManifest.length
      : 1;

    // Load on-duty shuttles and their pending pickup counts to compute effective
    // available seats (currentCapacity + pendingPickupCount).
    const communityOid = pickupRequest.communityId;

    const [shuttles, pendingAgg] = await Promise.all([
      Shuttle.find({
        communityId: communityOid,
        isActive: true,
        status: { $in: ['idle', 'en_route'] },
        driverId: { $ne: null },
      })
        .select('_id driverId plateNumber label assignedPhase currentCapacity maxCapacity')
        .populate('driverId', '_id status')
        .lean(),

      PickupRequest.aggregate([
        {
          $match: {
            communityId: communityOid,
            status: 'dispatched',
            assignedShuttleId: { $ne: null },
            expiresAt: { $gt: new Date() },
          },
        },
        { $group: { _id: '$assignedShuttleId', count: { $sum: 1 } } },
      ]),
    ]);

    const actualPending = {};
    for (const { _id, count } of pendingAgg) {
      actualPending[String(_id)] = count;
    }

    const passengerFares = Array.isArray(createdRideRequests) ? createdRideRequests.map((r) => ({
      rideRequestId: r._id,
      passengerId: r.passengerId || null,
      passengerName: r.passengerName || null,
      discountType: r.discountType || 'none',
      fareExpected: r.fareExpected ?? null,
      originalFare: r.originalFare ?? null,
    })) : [];

    const payload = {
      requestId: pickupRequest._id,
      communityId: pickupRequest.communityId,
      passengerId: pickupRequest.passengerId,
      bookingOwner: pickupRequest.bookingOwner || pickupRequest.passengerId,
      pickupLocation: pickupRequest.pickupLocation || null,
      location: pickupRequest.location,
      destinationType: pickupRequest.destinationType,
      destinationLabel: pickupRequest.destinationLabel,
      destinationLocation: pickupRequest.destinationLocation,
      passengerHomePhase: pickupRequest.passengerHomePhase,
      fareType: pickupRequest.fareType,
      fareExpected,
      expiresAt: pickupRequest.expiresAt,
      status: pickupRequest.status,
      passengerManifest: Array.isArray(pickupRequest.passengerManifest) ? pickupRequest.passengerManifest : [],
      passengerFares,
      note: pickupRequest.note || null,
      trackingToken: pickupRequest.trackingToken,
      trackingUrl,
      assignedShuttleId: dispatchResult.dispatched ? dispatchResult.shuttle?._id : null,
    };

    const { computeEligibleDriverIds } = require('../services/dispatch-utils');
    const eligibleDriverIds = computeEligibleDriverIds({ shuttles, pendingAgg, pickupRequest });

    for (const did of eligibleDriverIds) {
      const driverRoom = `user:${String(did)}`;
      io.to(driverRoom).emit('trip:pickup-intent', payload);
    }

    return res.status(201).json({
      message: 'Pickup intent submitted.',
      request: { ...pickupRequest.toObject(), trackingUrl },
      rideRequestId: Array.isArray(createdRideRequests) && createdRideRequests.length > 0 ? createdRideRequests[0]._id : null,
      rideRequestIds: createdRideRequests.map((r) => r._id),
      fareType,
      fareExpected,
      dispatched: dispatchResult.dispatched,
      assignedShuttle: dispatchResult.dispatched ? dispatchResult.shuttle : null,
      queuePosition: dispatchResult.queuePosition,
      queueReason: dispatchResult.queueReason ?? null,
      trackingToken: pickupRequest.trackingToken,
      trackingUrl,
    });
  } catch (error) {
    console.error('Create pickup intent error:', error);
    return res.status(500).json({ error: 'Failed to submit pickup intent.' });
  }
};


/**
 * DELETE /api/trips/pickup-intent/:intentId
 * Passenger can cancel own pending intent; admin can cancel any pending intent in community scope.
 */
const cancelPickupIntent = async (req, res) => {
  try {
    const { intentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(intentId))) {
      return res.status(400).json({ error: 'Invalid pickup intent ID.' });
    }

    const request = await PickupRequest.findById(intentId);
    if (!request) {
      return res.status(404).json({ error: 'Pickup intent not found.' });
    }

    if (String(request.communityId) !== String(req.user.communityId)) {
      return res.status(403).json({ error: 'Access denied. Pickup intent is outside your community.' });
    }

    const isAdmin = req.user.role === 'admin';
    const isOwnerPassenger = String(request.passengerId) === String(req.user._id);

    if (!isAdmin && !isOwnerPassenger) {
      return res.status(403).json({ error: 'Access denied. You can only cancel your own pickup intent.' });
    }

    if (request.status === 'pending' && request.expiresAt && new Date(request.expiresAt).getTime() <= Date.now()) {
      request.status = 'expired';
      await request.save();
    }

    const cancellableStatuses = ['pending', 'dispatched', 'queued'];
    if (!cancellableStatuses.includes(request.status)) {
      return res.status(409).json({ error: 'Only pending requests can be cancelled.' });
    }

    // DISPATCH: Release the reserved slot FIRST (before status changes)
    const shuttleToHeal = request.assignedShuttleId;
    if (shuttleToHeal && request.status === 'dispatched') {
      await releasePendingSlot(shuttleToHeal).catch((err) =>
        console.error('[cancelPickupIntent] releasePendingSlot error:', err)
      );
    }

    // NOW mark as cancelled
    request.status = 'cancelled';
    await request.save();

    // PERSISTENCE: Cancel ALL linked permanent ride requests (updateMany for multi-guest bookings)
    await RideRequest.updateMany(
      { pickupRequestId: request._id, status: 'pending' },
      {
        $set: {
          status: 'cancelled',
          resolution: 'passenger_cancel',
          cancelledAt: new Date(),
        },
      }
    );

    // SELF-HEAL: Recompute and reset the stored pendingPickupCount to match reality,
    // preventing any drift from accumulating regardless of which code path ran.
    if (shuttleToHeal) {
      setImmediate(async () => {
        try {
          const liveCount = await PickupRequest.countDocuments({
            assignedShuttleId: shuttleToHeal,
            status: 'dispatched',
            expiresAt: { $gt: new Date() },
          });
          await Shuttle.updateOne({ _id: shuttleToHeal }, { $set: { pendingPickupCount: liveCount } });
        } catch (err) {
          console.error('[cancelPickupIntent] self-heal pendingPickupCount error:', err);
        }
      });
    }

    // DISPATCH: Retry waiting queue with the freed slot
    setImmediate(() => {
      const { retryWaitingQueue } = require('../services/dispatch.service');
      retryWaitingQueue(request.communityId, req.app.get('io')).catch((err) =>
        console.error('[cancelPickupIntent] retryWaitingQueue error:', err)
      );
    });


    const io = req.app.get('io');
    const communityRoom = `community:${String(request.communityId)}`;
    const payload = {
      requestId: request._id,
      communityId: request.communityId,
      passengerId: request.passengerId,
      status: request.status,
      cancelledBy: req.user.role,
      cancelledAt: request.updatedAt,
    };

    io.to(communityRoom).emit('pickup-intent:cancelled', payload);
    io.to(communityRoom).emit('trip:pickup-intent-cancelled', payload);

    return res.status(200).json({
      message: 'Pickup intent cancelled.',
      request,
    });
  } catch (error) {
    console.error('Cancel pickup intent error:', error);
    return res.status(500).json({ error: 'Failed to cancel pickup intent.' });
  }
};

/**
 * DELETE /api/trips/my-pickup-intents
 * Passenger-initiated: cancel ALL their own active pickup requests atomically.
 * Called before logout to ensure reserved slots are returned to the pool.
 */
const cancelMyPickupIntents = async (req, res) => {
  try {
    const passengerId = req.user._id;
    const communityId = req.user.communityId;
    const io = req.app.get('io');

    // Find all active requests for this passenger
    const activeRequests = await PickupRequest.find({
      passengerId,
      communityId,
      status: { $in: ['pending', 'dispatched', 'queued'] },
    }).lean();

    if (activeRequests.length === 0) {
      return res.status(200).json({ message: 'No active pickup requests to cancel.', cancelled: 0 });
    }

    const ids = activeRequests.map((r) => r._id);

    // Mark all as cancelled
    await PickupRequest.updateMany(
      { _id: { $in: ids } },
      { $set: { status: 'cancelled' } }
    );

    // Cancel linked persistent ride requests
    await RideRequest.updateMany(
      { pickupRequestId: { $in: ids }, status: 'pending' },
      {
        $set: {
          status: 'cancelled',
          resolution: 'passenger_cancel',
          cancelledAt: new Date(),
        },
      }
    );

    // Broadcast cancellation and release slots — one per request, non-blocking
    const communityRoom = `community:${String(communityId)}`;
    setImmediate(async () => {
      // Collect unique shuttle IDs that had dispatched slots so we can self-heal them
      const shuttleIdsToHeal = new Set();

      for (const req of activeRequests) {
        const payload = {
          requestId: req._id,
          communityId: req.communityId,
          passengerId: req.passengerId,
          status: 'cancelled',
          cancelledBy: 'passenger',
          cancelledAt: new Date(),
        };
        io.to(communityRoom).emit('pickup-intent:cancelled', payload);
        io.to(communityRoom).emit('trip:pickup-intent-cancelled', payload);

        // Release slot directly using the lean snapshot (status/assignedShuttleId captured
        // BEFORE updateMany ran). Do NOT call releaseAndRetry — it re-reads from DB and
        // would find status='cancelled', skipping the release entirely.
        if (req.status === 'dispatched' && req.assignedShuttleId) {
          try {
            await releasePendingSlot(req.assignedShuttleId);
            shuttleIdsToHeal.add(String(req.assignedShuttleId));
          } catch (err) {
            console.error('[cancelMyPickupIntents] releasePendingSlot error:', err);
          }
        }
      }

      // SELF-HEAL: Reset stored pendingPickupCount to the live reality for every
      // affected shuttle so drift cannot accumulate.
      for (const shuttleId of shuttleIdsToHeal) {
        try {
          const liveCount = await PickupRequest.countDocuments({
            assignedShuttleId: shuttleId,
            status: 'dispatched',
            expiresAt: { $gt: new Date() },
          });
          await Shuttle.updateOne({ _id: shuttleId }, { $set: { pendingPickupCount: liveCount } });
        } catch (err) {
          console.error('[cancelMyPickupIntents] self-heal pendingPickupCount error:', err);
        }
      }

      // One final queue retry to fill any freed slots
      try {
        await retryWaitingQueue(communityId, io);
      } catch (err) {
        console.error('[cancelMyPickupIntents] retryWaitingQueue error:', err);
      }
    });

    return res.status(200).json({
      message: `${activeRequests.length} pickup request(s) cancelled.`,
      cancelled: activeRequests.length,
    });
  } catch (error) {
    console.error('Cancel my pickup intents error:', error);
    return res.status(500).json({ error: 'Failed to cancel your pickup requests.' });
  }
};

/**
 * GET /api/trips/pickup-intents
 * Drivers/Admins fetch active pickup demand pins in their community.
 */
const listPickupIntents = async (req, res) => {
  try {
    const now = new Date();
    const query = {
      communityId: req.user.communityId,
      status: { $in: ['pending', 'queued'] },
      expiresAt: { $gt: now },
    };

    if (req.user.role === 'driver') {
      const driverShuttle = await Shuttle.findOne({
        communityId: req.user.communityId,
        driverId: req.user._id,
        isActive: true,
      })
        .select('assignedPhase')
        .lean();

      if (!driverShuttle) {
        return res.status(200).json({ count: 0, requests: [] });
      }

      Object.assign(
        query,
        buildPhaseAwareRequestQuery({
          shuttlePhase: driverShuttle?.assignedPhase,
          passengerPhaseField: 'passengerHomePhase',
        })
      );
    }

    const requests = await PickupRequest.find(query)
      .select('communityId passengerId location pickupLocation destinationType destinationLabel destinationLocation passengerHomePhase status expiresAt createdAt passengerManifest note trackingToken')
      .sort({ createdAt: -1 })
      .limit(100);

    return res.status(200).json({
      count: requests.length,
      requests,
    });
  } catch (error) {
    console.error('List pickup intents error:', error);
    return res.status(500).json({ error: 'Failed to fetch pickup intents.' });
  }
};

/**
 * GET /api/trips/passenger-recent-rides
 * Passenger-only endpoint returning recent pickup-based ride intents.
 */
const listPassengerRecentRides = async (req, res) => {
  try {
    const rides = await PassengerRide.find({
      communityId: req.user.communityId,
      passengerId: req.user._id,
    })
      .populate('shuttleId', 'plateNumber label')
      .select('status requestedAt boardedAt fareAtBoarding pickupLocation destinationType destinationLabel destinationLocation shuttleId')
      .sort({ boardedAt: -1 })
      .limit(10);

    const serialized = rides.map((ride) => ({
      rideId: ride._id,
      status: ride.status,
      requestedAt: ride.requestedAt,
      boardedAt: ride.boardedAt,
      fareAtBoarding: ride.fareAtBoarding,
      pickupLocation: ride.pickupLocation,
      destinationType: ride.destinationType,
      destinationLabel: ride.destinationLabel,
      destinationLocation: ride.destinationLocation,
      shuttle: {
        plateNumber: ride.shuttleId?.plateNumber || '',
        label: ride.shuttleId?.label || '',
      },
    }));

    return res.status(200).json({
      count: serialized.length,
      rides: serialized,
    });
  } catch (error) {
    console.error('List passenger recent rides error:', error);
    return res.status(500).json({ error: 'Failed to fetch recent rides.' });
  }
};

/**
 * GET /api/trips/analytics?startDate=...&endDate=...
 * Community-scoped analytics for admins.
 */
const getAnalytics = async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const scopedCommunityId = resolveCommunityScopeObjectId(req, req.query.communityId, { allowAll: true });

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid startDate or endDate.' });
    }

    if (scopedCommunityId && !(scopedCommunityId instanceof mongoose.Types.ObjectId)) {
      return res.status(403).json({ error: scopedCommunityId.error });
    }

    const match = {
      shiftStart: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    if (scopedCommunityId) {
      match.communityId = scopedCommunityId;
    }

    const series = await Trip.aggregate([
      {
        $match: match,
      },
      {
        $group: {
          _id: {
            year: { $year: '$shiftStart' },
            month: { $month: '$shiftStart' },
            day: { $dayOfMonth: '$shiftStart' },
          },
          totalPassengers: { $sum: '$passengersBoarded' },
          totalRevenue: { $sum: '$revenueCollected' },
          tripCount: { $sum: 1 },
        },
      },
      {
        $sort: {
          '_id.year': 1,
          '_id.month': 1,
          '_id.day': 1,
        },
      },
    ]);

    const totals = series.reduce(
      (acc, day) => {
        acc.totalPassengers += day.totalPassengers;
        acc.totalRevenue += day.totalRevenue;
        acc.tripCount += day.tripCount;
        return acc;
      },
      { totalPassengers: 0, totalRevenue: 0, tripCount: 0 }
    );

    return res.status(200).json({
      range: { startDate, endDate },
      totals,
      series,
    });
  } catch (error) {
    console.error('Get analytics error:', error);
    return res.status(500).json({ error: 'Failed to fetch analytics.' });
  }
};

/**
 * GET /api/trips/driver-analytics?startDate=...&endDate=...&driverId=...
 * Community-scoped analytics grouped by driver.
 */
const getDriverAnalytics = async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const driverId = req.query.driverId;
    const scopedCommunityId = resolveCommunityScopeObjectId(req, req.query.communityId, { allowAll: true });

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid startDate or endDate.' });
    }

    if (scopedCommunityId && !(scopedCommunityId instanceof mongoose.Types.ObjectId)) {
      return res.status(403).json({ error: scopedCommunityId.error });
    }

    const match = {
      shiftStart: { $gte: startDate, $lte: endDate },
      status: { $in: ['completed', 'synced', 'active'] },
    };

    if (scopedCommunityId) {
      match.communityId = scopedCommunityId;
    }

    if (driverId !== undefined && driverId !== '') {
      if (!mongoose.Types.ObjectId.isValid(driverId)) {
        return res.status(400).json({ error: 'Invalid driverId.' });
      }
      match.driverId = new mongoose.Types.ObjectId(driverId);
    }

    const grouped = await Trip.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$driverId',
          tripCount: { $sum: 1 },
          totalPassengers: { $sum: '$passengersBoarded' },
          totalRevenue: { $sum: '$revenueCollected' },
          lastShiftAt: { $max: '$shiftEnd' },
        },
      },
      { $sort: { totalRevenue: -1 } },
    ]);

    const driverIds = grouped.map((item) => item._id);
    const drivers = await User.find({ _id: { $in: driverIds } })
      .select('_id firstName lastName email status isActive')
      .lean();

    const driversById = new Map(drivers.map((driver) => [String(driver._id), driver]));

    const rows = grouped.map((item) => {
      const driver = driversById.get(String(item._id));
      return {
        driverId: String(item._id),
        firstName: driver?.firstName || 'Unknown',
        lastName: driver?.lastName || 'Driver',
        email: driver?.email || '',
        status: driver?.status || 'offline',
        isActive: driver?.isActive !== false,
        tripCount: item.tripCount,
        totalPassengers: item.totalPassengers,
        totalRevenue: item.totalRevenue,
        averagePassengersPerTrip: item.tripCount ? Number((item.totalPassengers / item.tripCount).toFixed(2)) : 0,
        lastShiftAt: item.lastShiftAt || null,
      };
    });

    const totals = rows.reduce(
      (acc, row) => {
        acc.tripCount += row.tripCount;
        acc.totalPassengers += row.totalPassengers;
        acc.totalRevenue += row.totalRevenue;
        return acc;
      },
      { tripCount: 0, totalPassengers: 0, totalRevenue: 0 }
    );

    return res.status(200).json({
      range: { startDate, endDate },
      totals,
      drivers: rows,
    });
  } catch (error) {
    console.error('Get driver analytics error:', error);
    return res.status(500).json({ error: 'Failed to fetch driver analytics.' });
  }
};

/**
 * GET /api/trips/driver-performance?startDate=...&endDate=...&driverId=...
 * Driver performance analytics with per-shift detail.
 */
const getDriverPerformanceAnalytics = async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const driverId = req.query.driverId;
    const scopedCommunityId = resolveCommunityScopeObjectId(req, req.query.communityId, { allowAll: true });

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid startDate or endDate.' });
    }

    if (scopedCommunityId && !(scopedCommunityId instanceof mongoose.Types.ObjectId)) {
      return res.status(403).json({ error: scopedCommunityId.error });
    }

    if (driverId && !mongoose.Types.ObjectId.isValid(String(driverId))) {
      return res.status(400).json({ error: 'Invalid driverId.' });
    }

    const tripQuery = {
      shiftStart: { $gte: startDate, $lte: endDate },
      status: { $in: ['completed', 'synced', 'active'] },
    };
    if (scopedCommunityId) tripQuery.communityId = scopedCommunityId;
    if (driverId) tripQuery.driverId = new mongoose.Types.ObjectId(String(driverId));

    const trips = await Trip.find(tripQuery)
      .select('_id communityId driverId shiftStart shiftEnd status passengersBoarded fareAtTime revenueCollected')
      .sort({ shiftStart: 1 })
      .lean();

    const tripIds = trips.map((trip) => trip._id);
    const driverIdsInTrips = Array.from(new Set(trips.map((trip) => String(trip.driverId)).filter(Boolean)));

    const remittanceQuery = {
      tripId: { $in: tripIds },
    };
    if (scopedCommunityId) remittanceQuery.communityId = scopedCommunityId;
    if (driverId) remittanceQuery.driverId = new mongoose.Types.ObjectId(String(driverId));

    const remittances = tripIds.length
      ? await ShiftRemittance.find(remittanceQuery)
        .select('tripId driverId expectedAmount actualAmount varianceAmount status submittedAt deadline_at')
        .lean()
      : [];

    const remittanceByTripId = new Map(remittances.map((row) => [String(row.tripId), row]));

    const rideRequestStatsByTrip = tripIds.length
      ? await RideRequest.aggregate([
        { $match: { tripId: { $in: tripIds } } },
        {
          $group: {
            _id: '$tripId',
            totalRequestsReceived: { $sum: 1 },
            totalAutoBoarded: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$status', 'boarded'] },
                      { $eq: ['$status', 'completed'] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            totalLateManualBoarded: {
              $sum: {
                $cond: [{ $eq: ['$resolution', 'late_manual'] }, 1, 0],
              },
            },
            totalNoShows: {
              $sum: {
                $cond: [{ $eq: ['$resolution', 'no_show'] }, 1, 0],
              },
            },
            totalIgnoredRequests: {
              $sum: {
                $cond: [{ $eq: ['$status', 'ignored'] }, 1, 0],
              },
            },
          },
        },
      ])
      : [];

    const rideStatsByTripId = new Map(
      rideRequestStatsByTrip.map((row) => [String(row._id), row])
    );

    const ignoredByResolvedDriver = await RideRequest.aggregate([
      {
        $match: {
          status: 'ignored',
          resolvedAt: { $gte: startDate, $lte: endDate },
          ...(scopedCommunityId ? { communityId: scopedCommunityId } : {}),
          ...(driverId ? { resolvedBy: new mongoose.Types.ObjectId(String(driverId)) } : {}),
        },
      },
      {
        $group: {
          _id: '$resolvedBy',
          count: { $sum: 1 },
        },
      },
    ]);
    const ignoredByResolvedDriverMap = new Map(
      ignoredByResolvedDriver
        .filter((row) => row._id)
        .map((row) => [String(row._id), row.count])
    );

    const allDriverIds = Array.from(
      new Set([
        ...driverIdsInTrips,
        ...remittances.map((item) => String(item.driverId)).filter(Boolean),
        ...Array.from(ignoredByResolvedDriverMap.keys()),
      ])
    ).filter((id) => mongoose.Types.ObjectId.isValid(id));

    const drivers = allDriverIds.length
      ? await User.find({ _id: { $in: allDriverIds } })
        .select('_id firstName lastName email')
        .lean()
      : [];
    const driverById = new Map(drivers.map((row) => [String(row._id), row]));

    const metricsByDriver = new Map();
    const shiftDetailsByDriver = new Map();

    const ensureDriver = (rawDriverId) => {
      const key = String(rawDriverId);
      if (!metricsByDriver.has(key)) {
        metricsByDriver.set(key, {
          driverId: key,
          driverName: `${driverById.get(key)?.firstName || 'Unknown'} ${driverById.get(key)?.lastName || 'Driver'}`.trim(),
          totalShifts: 0,
          totalShiftHours: 0,
          totalRequestsReceived: 0,
          totalPassengersBoarded: 0,
          totalAutoBoarded: 0,
          totalManualBoarded: 0,
          totalLateManualBoarded: 0,
          totalIgnoredRequests: ignoredByResolvedDriverMap.get(key) || 0,
          totalNoShows: 0,
          totalExpectedRemittance: 0,
          totalActualRemittance: 0,
          totalVariance: 0,
          totalFlaggedRemittances: 0,
          totalVerifiedRemittances: 0,
          totalEscalatedRemittances: 0,
          totalSubmittedRemittances: 0,
          totalOnTimeSubmissions: 0,
          shifts: [],
        });
      }

      if (!shiftDetailsByDriver.has(key)) {
        shiftDetailsByDriver.set(key, []);
      }
      return metricsByDriver.get(key);
    };

    for (const trip of trips) {
      const key = String(trip.driverId);
      const metrics = ensureDriver(key);
      const rideStats = rideStatsByTripId.get(String(trip._id)) || {
        totalRequestsReceived: 0,
        totalAutoBoarded: 0,
        totalLateManualBoarded: 0,
        totalNoShows: 0,
        totalIgnoredRequests: 0,
      };
      const remittance = remittanceByTripId.get(String(trip._id));

      const shiftStart = trip.shiftStart ? new Date(trip.shiftStart) : null;
      const shiftEnd = trip.shiftEnd ? new Date(trip.shiftEnd) : null;
      const shiftHours = shiftStart && shiftEnd
        ? Math.max(0, (shiftEnd.getTime() - shiftStart.getTime()) / 3600000)
        : 0;

      metrics.totalShifts += 1;
      metrics.totalShiftHours += shiftHours;
      metrics.totalRequestsReceived += rideStats.totalRequestsReceived || 0;
      metrics.totalPassengersBoarded += trip.passengersBoarded || 0;
      metrics.totalAutoBoarded += (rideStats.totalAutoBoarded || 0) - (rideStats.totalLateManualBoarded || 0);
      metrics.totalLateManualBoarded += rideStats.totalLateManualBoarded || 0;
      metrics.totalNoShows += rideStats.totalNoShows || 0;
      metrics.totalIgnoredRequests += rideStats.totalIgnoredRequests || 0;
      metrics.totalManualBoarded = metrics.totalLateManualBoarded;

      const expectedAmount = remittance ? remittance.expectedAmount || 0 : Number((trip.revenueCollected || 0).toFixed(2));
      const actualAmount = remittance ? remittance.actualAmount || 0 : 0;
      const varianceAmount = remittance ? remittance.varianceAmount || 0 : Number((actualAmount - expectedAmount).toFixed(2));
      const remittanceStatus = remittance?.status || 'not_submitted';
      const submittedOnTime = Boolean(
        remittance?.submittedAt
        && remittance?.deadline_at
        && new Date(remittance.submittedAt).getTime() <= new Date(remittance.deadline_at).getTime()
      );

      metrics.totalExpectedRemittance += expectedAmount;
      metrics.totalActualRemittance += actualAmount;
      metrics.totalVariance += varianceAmount;
      if (['pending', 'verified', 'flagged', 'overdue', 'escalated'].includes(remittanceStatus)) {
        metrics.totalSubmittedRemittances += 1;
      }
      if (submittedOnTime) metrics.totalOnTimeSubmissions += 1;
      if (remittanceStatus === 'flagged') metrics.totalFlaggedRemittances += 1;
      if (remittanceStatus === 'verified') metrics.totalVerifiedRemittances += 1;
      if (remittanceStatus === 'escalated') metrics.totalEscalatedRemittances += 1;

      shiftDetailsByDriver.get(key).push({
        tripId: String(trip._id),
        shiftDate: trip.shiftStart,
        shiftStatus: trip.status,
        passengers: trip.passengersBoarded || 0,
        expectedRemittance: Number(expectedAmount.toFixed(2)),
        actualRemittance: Number(actualAmount.toFixed(2)),
        variance: Number(varianceAmount.toFixed(2)),
        remittanceStatus,
        submittedOnTime,
        ignoredRequests: rideStats.totalIgnoredRequests || 0,
        lateManualBoards: rideStats.totalLateManualBoarded || 0,
      });
    }

    const driversPerformance = Array.from(metricsByDriver.values())
      .map((row) => {
        const remittanceCount = row.totalSubmittedRemittances;
        const onTimeSubmissionRate = row.totalShifts
          ? (row.totalOnTimeSubmissions / row.totalShifts) * 100
          : 0;
        const flagRate = remittanceCount
          ? (row.totalFlaggedRemittances / remittanceCount) * 100
          : 0;
        const lateManualBoardRate = row.totalPassengersBoarded
          ? (row.totalLateManualBoarded / row.totalPassengersBoarded) * 100
          : 0;
        const ignoredRequestRate = row.totalRequestsReceived
          ? (row.totalIgnoredRequests / row.totalRequestsReceived) * 100
          : 0;
        const varianceRate = row.totalExpectedRemittance
          ? (row.totalVariance / row.totalExpectedRemittance) * 100
          : 0;

        return {
          driverId: row.driverId,
          driverName: row.driverName,
          totalShifts: row.totalShifts,
          totalShiftHours: Number(row.totalShiftHours.toFixed(2)),
          totalRequestsReceived: row.totalRequestsReceived,
          totalPassengersBoarded: row.totalPassengersBoarded,
          totalAutoBoarded: Math.max(0, row.totalAutoBoarded),
          totalManualBoarded: row.totalManualBoarded,
          totalLateManualBoarded: row.totalLateManualBoarded,
          totalIgnoredRequests: row.totalIgnoredRequests,
          totalNoShows: row.totalNoShows,
          totalExpectedRemittance: Number(row.totalExpectedRemittance.toFixed(2)),
          totalActualRemittance: Number(row.totalActualRemittance.toFixed(2)),
          totalVariance: Number(row.totalVariance.toFixed(2)),
          totalFlaggedRemittances: row.totalFlaggedRemittances,
          totalVerifiedRemittances: row.totalVerifiedRemittances,
          totalEscalatedRemittances: row.totalEscalatedRemittances,
          onTimeSubmissionRate: Number(onTimeSubmissionRate.toFixed(2)),
          flagRate: Number(flagRate.toFixed(2)),
          lateManualBoardRate: Number(lateManualBoardRate.toFixed(2)),
          ignoredRequestRate: Number(ignoredRequestRate.toFixed(2)),
          varianceRate: Number(varianceRate.toFixed(2)),
          shifts: (shiftDetailsByDriver.get(row.driverId) || []).sort(
            (a, b) => new Date(b.shiftDate).getTime() - new Date(a.shiftDate).getTime()
          ),
        };
      })
      .sort((a, b) => a.totalVariance - b.totalVariance);

    const driversNeedingAttention = driversPerformance.filter((driver) =>
      driver.varianceRate < -10
      || driver.flagRate > 20
      || driver.totalIgnoredRequests > 3
      || driver.onTimeSubmissionRate < 70
    ).length;

    return res.status(200).json({
      range: { startDate, endDate },
      driversNeedingAttention,
      drivers: driversPerformance,
    });
  } catch (error) {
    console.error('Get driver performance analytics error:', error);
    return res.status(500).json({ error: 'Failed to fetch driver performance analytics.' });
  }
};

/**
 * POST /api/trips/:tripId/remittance
 * Driver submits actual collected amount for a completed shift.
 */
const submitShiftRemittance = async (req, res) => {
  try {
    const { tripId } = req.params;
    const { actualAmount, driverNote } = req.body;
    const receiptFile = req.file;

    if (!mongoose.Types.ObjectId.isValid(tripId)) {
      return res.status(400).json({ error: 'Invalid tripId.' });
    }

    if (req.user.role === 'driver' && !receiptFile) {
      return res.status(400).json({ error: 'Receipt photo is required to submit remittance.' });
    }

    const normalizedActual = parseMoney(actualAmount);
    if (normalizedActual === null) {
      return res.status(400).json({ error: `actualAmount must be a valid non-negative number not exceeding ${MAX_REMITTANCE_AMOUNT}.` });
    }

    const trip = await Trip.findById(tripId).select(
      '_id communityId shuttleId driverId status shiftStart shiftEnd passengersBoarded fareAtTime revenueCollected'
    );

    if (!trip) {
      return res.status(404).json({ error: 'Trip not found.' });
    }

    if (!trip.shiftEnd || !['completed', 'synced'].includes(trip.status)) {
      return res.status(409).json({ error: 'Trip must be completed before submitting remittance.' });
    }

    const requesterCommunityId = req.user?.communityId ? req.user.communityId.toString() : '';
    if (!isPlatformAdmin(req) && trip.communityId.toString() !== requesterCommunityId) {
      return res.status(403).json({ error: 'Access denied. Trip is outside your community.' });
    }

    if (req.user.role === 'driver' && trip.driverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied. You can only submit remittance for your own shift.' });
    }

    const existingRemittance = await ShiftRemittance.findOne({ tripId: trip._id }).select('_id status');
    if (existingRemittance && !['not_submitted', 'overdue', 'escalated'].includes(existingRemittance.status)) {
      return res.status(409).json({ error: 'Remittance already submitted for this trip.' });
    }

    const expectedAmount = Number((trip.revenueCollected || (trip.passengersBoarded * trip.fareAtTime) || 0).toFixed(2));
    const varianceAmount = Number((normalizedActual - expectedAmount).toFixed(2));
    const now = new Date();
    const ignoredCount = await countIgnoredRideRequestsForTrip(trip);

    let status = 'pending';
    if (ignoredCount > 0) {
      status = 'flagged';
    } else if (req.user.role === 'admin') {
      status = Math.abs(varianceAmount) < 0.01 ? 'verified' : 'flagged';
    }

    const systemNotes = [];
    if (ignoredCount > 0) {
      systemNotes.push(`Auto-flagged: ${ignoredCount} ignored ride request(s) in this shift.`);
    }
    if (req.user.role === 'admin' && Math.abs(varianceAmount) >= 0.01) {
      systemNotes.push('Recorded by admin with variance.');
    }

    let receiptUrl = '';
    if (receiptFile) {
      const upload = await uploadReceiptImage({
        buffer: receiptFile.buffer,
        tripId: trip._id,
        communityId: trip.communityId,
      });
      receiptUrl = upload.secureUrl;
    }

    const update = {
      communityId: trip.communityId,
      tripId: trip._id,
      shuttleId: trip.shuttleId,
      driverId: trip.driverId,
      expectedAmount,
      actualAmount: normalizedActual,
      varianceAmount,
      submittedAt: now,
      status,
      driverNote: driverNote ? String(driverNote).trim().slice(0, 500) : '',
      verifiedBy: req.user.role === 'admin' ? req.user._id : null,
      verifiedAt: req.user.role === 'admin' ? now : null,
      adminNote: systemNotes.join(' '),
      ...(receiptUrl ? { receiptUrl, receiptUploadedAt: now } : {}),
    };

    const remittance = await ShiftRemittance.findOneAndUpdate(
      { tripId: trip._id },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
      .populate('driverId', 'firstName lastName email')
      .populate('shuttleId', 'plateNumber label');

    return res.status(200).json({
      message: 'Shift remittance submitted.',
      remittance,
    });
  } catch (error) {
    if (error?.message && String(error.message).toLowerCase().includes('receipt')) {
      return res.status(400).json({ error: error.message });
    }
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'Remittance already submitted for this trip.' });
    }
    console.error('Submit shift remittance error:', error);
    return res.status(500).json({ error: 'Failed to submit shift remittance.' });
  }
};

/**
 * PATCH /api/trips/remittances/:id/verify
 * Admin verifies or flags a remittance record.
 */
const verifyShiftRemittance = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNote } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid remittance id.' });
    }

    if (!['verified', 'flagged', 'pending'].includes(String(status))) {
      return res.status(400).json({ error: "status must be one of 'pending', 'verified', or 'flagged'." });
    }

    const remittance = await ShiftRemittance.findById(id);
    if (!remittance) {
      return res.status(404).json({ error: 'Remittance not found.' });
    }

    const requesterCommunityId = req.user?.communityId ? req.user.communityId.toString() : '';
    if (!isPlatformAdmin(req) && remittance.communityId.toString() !== requesterCommunityId) {
      return res.status(403).json({ error: 'Access denied. Remittance is outside your community.' });
    }

    if (String(status) === 'verified') {
      const trip = await Trip.findById(remittance.tripId)
        .select('communityId shiftStart shiftEnd')
        .lean();

      const ignoredCount = await countIgnoredRideRequestsForTrip(trip);
      if (ignoredCount > 0) {
        return res.status(409).json({
          error: `Cannot verify remittance while ${ignoredCount} ignored ride request(s) exist for this shift. Flag for review first.`,
        });
      }
    }

    remittance.status = String(status);
    remittance.verifiedBy = req.user._id;
    remittance.verifiedAt = new Date();
    remittance.adminNote = adminNote ? String(adminNote).trim().slice(0, 500) : '';
    await remittance.save();

    await remittance.populate('driverId', 'firstName lastName email');
    await remittance.populate('shuttleId', 'plateNumber label');

    return res.status(200).json({
      message: 'Remittance status updated.',
      remittance,
    });
  } catch (error) {
    console.error('Verify shift remittance error:', error);
    return res.status(500).json({ error: 'Failed to verify remittance.' });
  }
};

/**
 * GET /api/trips/remittances
 * Admin list view for reconciliation records.
 */
const listShiftRemittances = async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const scopedCommunityId = resolveCommunityScopeObjectId(req, req.query.communityId, { allowAll: true });
    const statusFilter = req.query.status;
    const driverId = req.query.driverId;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid startDate or endDate.' });
    }

    if (scopedCommunityId && !(scopedCommunityId instanceof mongoose.Types.ObjectId)) {
      return res.status(403).json({ error: scopedCommunityId.error });
    }

    if (driverId && !mongoose.Types.ObjectId.isValid(String(driverId))) {
      return res.status(400).json({ error: 'Invalid driverId.' });
    }

    const query = {
      submittedAt: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    if (scopedCommunityId) {
      query.communityId = scopedCommunityId;
    }

    if (statusFilter) {
      query.status = String(statusFilter);
    }

    if (driverId) {
      query.driverId = new mongoose.Types.ObjectId(String(driverId));
    }

    const remittances = await ShiftRemittance.find(query)
      .populate('driverId', 'firstName lastName email')
      .populate('shuttleId', 'plateNumber label')
      .populate('tripId', 'shiftStart shiftEnd status')
      .sort({ submittedAt: -1 })
      .limit(limit);

    return res.status(200).json({
      count: remittances.length,
      remittances,
    });
  } catch (error) {
    console.error('List shift remittances error:', error);
    return res.status(500).json({ error: 'Failed to fetch remittances.' });
  }
};

/**
 * GET /api/trips/remittance-summary
 * Admin summary by day/week/month and by driver.
 */
const getRemittanceSummary = async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const groupBy = ['day', 'week', 'month'].includes(String(req.query.groupBy)) ? String(req.query.groupBy) : 'day';
    const scopedCommunityId = resolveCommunityScopeObjectId(req, req.query.communityId, { allowAll: true });
    const driverId = req.query.driverId;

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid startDate or endDate.' });
    }

    if (scopedCommunityId && !(scopedCommunityId instanceof mongoose.Types.ObjectId)) {
      return res.status(403).json({ error: scopedCommunityId.error });
    }

    if (driverId && !mongoose.Types.ObjectId.isValid(String(driverId))) {
      return res.status(400).json({ error: 'Invalid driverId.' });
    }

    const query = {
      submittedAt: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    if (scopedCommunityId) {
      query.communityId = scopedCommunityId;
    }

    if (driverId) {
      query.driverId = new mongoose.Types.ObjectId(String(driverId));
    }

    const remittances = await ShiftRemittance.find(query)
      .select('tripId driverId expectedAmount actualAmount varianceAmount submittedAt status')
      .sort({ submittedAt: 1 })
      .lean();

    const totals = remittances.reduce(
      (acc, item) => {
        acc.expectedAmount += item.expectedAmount || 0;
        acc.actualAmount += item.actualAmount || 0;
        acc.varianceAmount += item.varianceAmount || 0;
        acc.remittanceCount += 1;
        if (item.status === 'pending') acc.pendingCount += 1;
        if (item.status === 'verified') acc.verifiedCount += 1;
        if (item.status === 'flagged') acc.flaggedCount += 1;
        return acc;
      },
      {
        expectedAmount: 0,
        actualAmount: 0,
        varianceAmount: 0,
        remittanceCount: 0,
        pendingCount: 0,
        verifiedCount: 0,
        flaggedCount: 0,
      }
    );

    const periodMap = new Map();
    const driverMap = new Map();

    for (const item of remittances) {
      const period = toPeriodKeyForSummary(item.submittedAt, groupBy);
      if (!periodMap.has(period)) {
        periodMap.set(period, {
          period,
          expectedAmount: 0,
          actualAmount: 0,
          varianceAmount: 0,
          remittanceCount: 0,
        });
      }

      const periodRow = periodMap.get(period);
      periodRow.expectedAmount += item.expectedAmount || 0;
      periodRow.actualAmount += item.actualAmount || 0;
      periodRow.varianceAmount += item.varianceAmount || 0;
      periodRow.remittanceCount += 1;

      const driverKey = String(item.driverId);
      if (!driverMap.has(driverKey)) {
        driverMap.set(driverKey, {
          driverId: driverKey,
          expectedAmount: 0,
          actualAmount: 0,
          varianceAmount: 0,
          remittanceCount: 0,
        });
      }

      const driverRow = driverMap.get(driverKey);
      driverRow.expectedAmount += item.expectedAmount || 0;
      driverRow.actualAmount += item.actualAmount || 0;
      driverRow.varianceAmount += item.varianceAmount || 0;
      driverRow.remittanceCount += 1;
    }

    const remittedTripIds = remittances
      .map((item) => item.tripId)
      .filter(Boolean)
      .map((id) => String(id));

    const tripQuery = {
      shiftEnd: {
        $gte: startDate,
        $lte: endDate,
      },
      status: { $in: ['completed', 'synced'] },
    };

    if (scopedCommunityId) {
      tripQuery.communityId = scopedCommunityId;
    }

    if (driverId) {
      tripQuery.driverId = new mongoose.Types.ObjectId(String(driverId));
    }

    const completedTrips = await Trip.find(tripQuery)
      .select('_id driverId revenueCollected passengersBoarded fareAtTime')
      .lean();

    const missingTrips = completedTrips.filter((trip) => !remittedTripIds.includes(String(trip._id)));

    const missingByDriverMap = new Map();
    let missingExpectedAmount = 0;

    for (const trip of missingTrips) {
      const expected = Number(((trip.revenueCollected || (trip.passengersBoarded * trip.fareAtTime) || 0)).toFixed(2));
      missingExpectedAmount += expected;

      const key = String(trip.driverId);
      if (!missingByDriverMap.has(key)) {
        missingByDriverMap.set(key, {
          driverId: key,
          missingCount: 0,
          missingExpectedAmount: 0,
        });
      }

      const row = missingByDriverMap.get(key);
      row.missingCount += 1;
      row.missingExpectedAmount += expected;
    }

    const allDriverIds = Array.from(new Set([
      ...Array.from(driverMap.keys()),
      ...Array.from(missingByDriverMap.keys()),
    ])).filter((id) => mongoose.Types.ObjectId.isValid(id));

    const drivers = await User.find({ _id: { $in: allDriverIds } })
      .select('_id firstName lastName email')
      .lean();
    const driverMeta = new Map(drivers.map((driver) => [String(driver._id), driver]));

    const series = Array.from(periodMap.values())
      .map((row) => ({
        ...row,
        expectedAmount: Number(row.expectedAmount.toFixed(2)),
        actualAmount: Number(row.actualAmount.toFixed(2)),
        varianceAmount: Number(row.varianceAmount.toFixed(2)),
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    const byDriver = Array.from(driverMap.values())
      .map((row) => {
        const meta = driverMeta.get(row.driverId);
        return {
          ...row,
          firstName: meta?.firstName || 'Unknown',
          lastName: meta?.lastName || 'Driver',
          email: meta?.email || '',
          expectedAmount: Number(row.expectedAmount.toFixed(2)),
          actualAmount: Number(row.actualAmount.toFixed(2)),
          varianceAmount: Number(row.varianceAmount.toFixed(2)),
        };
      })
      .sort((a, b) => Math.abs(b.varianceAmount) - Math.abs(a.varianceAmount));

    const missingByDriver = Array.from(missingByDriverMap.values())
      .map((row) => {
        const meta = driverMeta.get(row.driverId);
        return {
          driverId: row.driverId,
          firstName: meta?.firstName || 'Unknown',
          lastName: meta?.lastName || 'Driver',
          email: meta?.email || '',
          missingCount: row.missingCount,
          missingExpectedAmount: Number(row.missingExpectedAmount.toFixed(2)),
        };
      })
      .sort((a, b) => b.missingExpectedAmount - a.missingExpectedAmount);

    // PERSISTENCE: Ride request accountability stats
    const rideRequestQuery = {
      createdAt: { $gte: startDate, $lte: endDate },
    };
    if (scopedCommunityId) {
      rideRequestQuery.communityId = scopedCommunityId;
    }

    const rideRequestStats = await RideRequest.aggregate([
      { $match: rideRequestQuery },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          fareTotal: { $sum: '$fareExpected' },
        },
      },
    ]);

    const rideRequestBreakdown = {
      totalRequests: 0,
      totalBoarded: 0,
      totalCompleted: 0,
      totalCancelled: 0,
      totalIgnored: 0,
      totalPending: 0,
      totalLateManual: 0,
      totalFareExpected: 0,
    };

    for (const stat of rideRequestStats) {
      rideRequestBreakdown.totalRequests += stat.count;
      rideRequestBreakdown.totalFareExpected += stat.fareTotal;
      if (stat._id === 'boarded') rideRequestBreakdown.totalBoarded += stat.count;
      if (stat._id === 'completed') rideRequestBreakdown.totalCompleted += stat.count;
      if (stat._id === 'cancelled') rideRequestBreakdown.totalCancelled += stat.count;
      if (stat._id === 'ignored') rideRequestBreakdown.totalIgnored += stat.count;
      if (stat._id === 'pending') rideRequestBreakdown.totalPending += stat.count;
    }

    // Count late manual boards from resolution field
    const lateManualCount = await RideRequest.countDocuments({
      ...rideRequestQuery,
      resolution: 'late_manual',
    });
    rideRequestBreakdown.totalLateManual = lateManualCount;

    // Attribution: breakdown by effective driver (trip driver when available, else resolver for manual resolutions)
    const rideRequestBreakdownByDriverRaw = await RideRequest.aggregate([
      { $match: rideRequestQuery },
      {
        $lookup: {
          from: 'trips',
          localField: 'tripId',
          foreignField: '_id',
          as: 'trip',
        },
      },
      { $unwind: { path: '$trip', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          effectiveDriverId: { $ifNull: ['$trip.driverId', '$resolvedBy'] },
        },
      },
      { $match: { effectiveDriverId: { $ne: null } } },
      {
        $group: {
          _id: '$effectiveDriverId',
          totalRequests: { $sum: 1 },
          totalBoarded: { $sum: { $cond: [{ $eq: ['$status', 'boarded'] }, 1, 0] } },
          totalCompleted: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          totalCancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          totalIgnored: { $sum: { $cond: [{ $eq: ['$status', 'ignored'] }, 1, 0] } },
          totalPending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          totalLateManual: { $sum: { $cond: [{ $eq: ['$resolution', 'late_manual'] }, 1, 0] } },
        },
      },
    ]);

    const rideBreakdownDriverIds = rideRequestBreakdownByDriverRaw
      .map((row) => String(row._id))
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    const rideBreakdownDrivers = rideBreakdownDriverIds.length
      ? await User.find({ _id: { $in: rideBreakdownDriverIds } })
        .select('_id firstName lastName email')
        .lean()
      : [];
    const rideBreakdownDriverMeta = new Map(
      rideBreakdownDrivers.map((driver) => [String(driver._id), driver])
    );

    const rideRequestBreakdownByDriver = rideRequestBreakdownByDriverRaw
      .map((row) => {
        const driverIdKey = String(row._id);
        const meta = rideBreakdownDriverMeta.get(driverIdKey);
        return {
          driverId: driverIdKey,
          firstName: meta?.firstName || 'Unknown',
          lastName: meta?.lastName || 'Driver',
          email: meta?.email || '',
          totalRequests: row.totalRequests || 0,
          totalBoarded: row.totalBoarded || 0,
          totalCompleted: row.totalCompleted || 0,
          totalCancelled: row.totalCancelled || 0,
          totalIgnored: row.totalIgnored || 0,
          totalPending: row.totalPending || 0,
          totalLateManual: row.totalLateManual || 0,
        };
      })
      .sort((a, b) => (b.totalIgnored - a.totalIgnored) || (b.totalPending - a.totalPending) || (b.totalLateManual - a.totalLateManual));

    return res.status(200).json({
      range: { startDate, endDate },
      groupBy,
      totals: {
        expectedAmount: Number(totals.expectedAmount.toFixed(2)),
        actualAmount: Number(totals.actualAmount.toFixed(2)),
        varianceAmount: Number(totals.varianceAmount.toFixed(2)),
        remittanceCount: totals.remittanceCount,
        pendingCount: totals.pendingCount,
        verifiedCount: totals.verifiedCount,
        flaggedCount: totals.flaggedCount,
        missingCount: missingTrips.length,
        missingExpectedAmount: Number(missingExpectedAmount.toFixed(2)),
      },
      rideRequestBreakdown,
      rideRequestBreakdownByDriver,
      series,
      drivers: byDriver,
      missingByDriver,
    });
  } catch (error) {
    console.error('Get remittance summary error:', error);
    return res.status(500).json({ error: 'Failed to fetch remittance summary.' });
  }
};

/**
 * POST /api/trips/passenger-unboard
 * Driver's passenger unboarding action. Updates passenger ride status and shuttle capacity.
 * When shuttle coordinates are provided, passengers whose destination is nearest to the
 * shuttle are unboarded first (destination-aware). Falls back to FIFO when no coordinates.
 */
const passengerUnboard = async (req, res) => {
  const session = await createOptionalSession();
  if (session) session.startTransaction();

  try {
    const { shuttleId, unboardCount, latitude, longitude } = req.body;
    const count = unboardCount === undefined ? 1 : Number(unboardCount);

    if (!shuttleId) {
      if (session) await session.abortTransaction();
      return res.status(400).json({ error: 'shuttleId is required.' });
    }

    if (!validator.isMongoId(String(shuttleId))) {
      if (session) await session.abortTransaction();
      return res.status(400).json({ error: 'Invalid shuttle ID.' });
    }

    if (!Number.isInteger(count) || count <= 0) {
      if (session) await session.abortTransaction();
      return res.status(400).json({ error: 'unboardCount must be a positive integer.' });
    }

    // Fetch shuttle within transaction with session lock
    const shuttle = await Shuttle.findById(shuttleId).session(session);
    if (!shuttle || !shuttle.isActive) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ error: 'Shuttle not found.' });
    }

    if (shuttle.communityId.toString() !== req.user.communityId.toString()) {
      if (session) await session.abortTransaction();
      return res.status(403).json({ error: 'Access denied. Shuttle is outside your community.' });
    }

    if (!shuttle.driverId || shuttle.driverId.toString() !== req.user._id.toString()) {
      if (session) await session.abortTransaction();
      return res.status(403).json({ error: 'Access denied. This shuttle is not assigned to you.' });
    }

    if (shouldEnforceDriverShift && req.user.status !== 'driving') {
      if (session) await session.abortTransaction();
      return res.status(409).json({ error: 'Start your shift first before unboarding passengers.' });
    }

    // Validate: can't unboard more than currently boarded
    if (shuttle.currentCapacity < count) {
      if (session) await session.abortTransaction();
      return res.status(409).json({
        error: `Cannot unboard ${count} passengers. Current capacity: ${shuttle.currentCapacity}.`,
      });
    }

    // Find active trip for this shuttle
    const activeTrip = await Trip.findOne({
      communityId: shuttle.communityId,
      shuttleId: shuttle._id,
      driverId: req.user._id,
      status: 'active',
    }).session(session);

    if (!activeTrip) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ error: 'Active trip not found for this shuttle.' });
    }

    // Fetch all currently boarded passengers with destination data
    const allBoardedPassengers = await PassengerRide.find({
      tripId: activeTrip._id,
      status: 'boarded',
    })
      .session(session)
      .select('passengerId rideRequestId destinationLocation boardedAt')
      .sort({ boardedAt: 1 });

    if (allBoardedPassengers.length === 0) {
      if (session) await session.abortTransaction();
      return res.status(409).json({
        error: 'No boarded passengers found for unboarding.',
      });
    }

    // Destination-aware selection: if shuttle coordinates provided, sort by
    // proximity to each passenger's destination (nearest destination = unboard first).
    // Falls back to FIFO (boardedAt ascending) when coordinates are not provided.
    const shuttleCoords = validateCoordinates(latitude, longitude);
    let passengersToUnboard;

    if (shuttleCoords.valid) {
      // Sort by distance from shuttle to each passenger's destination (ascending)
      const withDistance = allBoardedPassengers.map((p) => {
        const destCoords = p.destinationLocation?.coordinates;
        let distance = Number.POSITIVE_INFINITY;
        if (Array.isArray(destCoords) && destCoords.length === 2) {
          distance = distanceMeters(
            { latitude: shuttleCoords.lat, longitude: shuttleCoords.lng },
            { latitude: Number(destCoords[1]), longitude: Number(destCoords[0]) }
          );
        }
        return { passenger: p, distance };
      });

      withDistance.sort((a, b) => a.distance - b.distance);
      passengersToUnboard = withDistance.slice(0, count).map((item) => item.passenger);
    } else {
      // Fallback: FIFO (already sorted by boardedAt ascending from query)
      passengersToUnboard = allBoardedPassengers.slice(0, count);
    }

    const effectiveUnboardCount = passengersToUnboard.length;

    // Update those PassengerRide records with unboarded status
    const now = new Date();
    const unboardedRideIds = passengersToUnboard.map((p) => p._id);

    // Build unboard location from shuttle's current position if available
    const unboardLocation = shuttleCoords.valid
      ? { type: 'Point', coordinates: [shuttleCoords.lng, shuttleCoords.lat] }
      : (shuttle.location || undefined);

    await PassengerRide.updateMany(
      { _id: { $in: unboardedRideIds } },
      {
        $set: {
          status: 'unboarded',
          unboardedAt: now,
          ...(unboardLocation ? { unboardLocation } : {}),
        },
      },
      { session }
    );

    // Complete linked RideRequests — use rideRequestIds when available (guest/manifest flows),
    // fall back to passengerIds for legacy flows
    const linkedRideRequestIds = passengersToUnboard.map((p) => p.rideRequestId).filter(Boolean);
    const passengerIds = passengersToUnboard.map((p) => p.passengerId).filter(Boolean);

    if (linkedRideRequestIds.length > 0) {
      await completeRideRequestsForPassengers({
        rideRequestIds: linkedRideRequestIds,
        completedAt: now,
        session,
      });
    }

    if (passengerIds.length > 0) {
      await completeRideRequestsForPassengers({
        tripId: activeTrip._id,
        passengerIds,
        completedAt: now,
        session,
      });
    }

    // Decrement shuttle capacity
    shuttle.currentCapacity = Math.max(0, shuttle.currentCapacity - effectiveUnboardCount);
    if (shuttle.currentCapacity === 0 && shuttle.status !== 'maintenance') {
      shuttle.status = 'idle';
    }
    shuttle.lastLocationUpdate = new Date();
    await shuttle.save({ session });

    // Note: Trip.passengersBoarded is NOT decremented - it stays as total boarded in shift

    // Commit transaction
    if (session) await session.commitTransaction();

    // Pause location-triggered automation briefly to avoid manual+auto double processing.
    startManualAutomationCooldown(shuttle._id);

    // Emit event after successful transaction
    const io = req.app.get('io');
    const communityRoom = `community:${String(shuttle.communityId)}`;
    io.to(communityRoom).emit('trip:passenger-unboarded', {
      tripId: activeTrip._id,
      shuttleId: shuttle._id,
      communityId: shuttle.communityId,
      unboardCount: effectiveUnboardCount,
      currentCapacity: shuttle.currentCapacity,
      maxCapacity: shuttle.maxCapacity,
      timestamp: now,
    });

    // Notify individual passengers who were unboarded so their apps update immediately
    try {
      const perPassengerMap = {};
      for (const p of passengersToUnboard) {
        if (p.passengerId) {
          const pid = String(p.passengerId);
          perPassengerMap[pid] = perPassengerMap[pid] || [];
          perPassengerMap[pid].push(String(p._id));
        }
      }
      for (const [pid, rideIds] of Object.entries(perPassengerMap)) {
        io.to(`user:${pid}`).emit('trip:passenger-unboarded', {
          rideIds,
          tripId: activeTrip._id,
          shuttleId: shuttle._id,
          unboardedAt: now,
        });
      }
    } catch (err) {
      console.error('Failed to emit per-passenger unboard notifications:', err);
    }

    // DISPATCH: Retry waiting queue — freed seats should be offered to queued passengers
    setImmediate(() => {
      retryWaitingQueue(shuttle.communityId, io).catch((err) =>
        console.error('[passengerUnboard] retryWaitingQueue error:', err)
      );
    });

    // Expire PickupRequests for passengers just dropped off so tracking links go dead immediately.
    setImmediate(async () => {
      try {
        const expireTime = new Date();
        const pickupIdsToExpire = new Set();

        if (linkedRideRequestIds.length > 0) {
          const rideReqs = await RideRequest.find(
            { _id: { $in: linkedRideRequestIds }, pickupRequestId: { $ne: null } }
          ).select('pickupRequestId').lean();
          rideReqs.forEach((r) => { if (r.pickupRequestId) pickupIdsToExpire.add(String(r.pickupRequestId)); });
        }

        if (passengerIds.length > 0) {
          const prs = await PickupRequest.find({
            passengerId: { $in: passengerIds },
            communityId: shuttle.communityId,
            status: { $in: ['pending', 'claimed', 'dispatched', 'queued'] },
          }).select('_id').lean();
          prs.forEach((r) => pickupIdsToExpire.add(String(r._id)));
        }

        if (pickupIdsToExpire.size > 0) {
          await PickupRequest.updateMany(
            { _id: { $in: [...pickupIdsToExpire] } },
            { $set: { expiresAt: expireTime, status: 'expired' } }
          );
        }
      } catch (err) {
        console.error('[passengerUnboard] expire PickupRequests error:', err);
      }
    });

    return res.status(200).json({
      message: `${effectiveUnboardCount} passenger(s) unboarded successfully.`,
      trip: activeTrip,
      shuttle,
      unboardedAt: now,
    });
  } catch (error) {
    if (session) await session.abortTransaction();
    console.error('Passenger unboard error:', error);
    return res.status(500).json({ error: 'Failed to record passenger unboarding.' });
  } finally {
    if (session) session.endSession();
  }
};

/**
 * GET /api/trips/:tripId/current-passengers
 * Returns array of currently boarded passengers for a trip.
 * Driver can only view passengers from their own shifts.
 */
const getCurrentPassengers = async (req, res) => {
  try {
    const { tripId } = req.params;

    // Validate tripId format
    if (!mongoose.Types.ObjectId.isValid(tripId)) {
      return res.status(400).json({ error: 'Invalid tripId.' });
    }

    // Fetch trip and validate ownership
    const trip = await Trip.findById(tripId).select('communityId driverId shuttleId status');
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found.' });
    }

    // Authorization: verify trip belongs to user's community
    if (trip.communityId.toString() !== req.user.communityId.toString()) {
      return res.status(403).json({ error: 'Access denied. Trip is outside your community.' });
    }

    // Authorization: driver can only view their own trips
    if (req.user.role === 'driver' && trip.driverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied. This trip is not assigned to you.' });
    }

    // Query boarded passengers using index on status + tripId
    const boardedPassengers = await PassengerRide.find({
      tripId: new mongoose.Types.ObjectId(tripId),
      status: 'boarded',
    })
      .populate('passengerId', 'firstName lastName phone')
      .select('passengerId boardedAt pickupLocation')
      .sort({ boardedAt: 1 }) // FIFO order
      .lean();

    // Transform response to match expected format
    const passengers = boardedPassengers.map((ride) => ({
      passengerId: ride.passengerId?._id || null,
      passengerName: ride.passengerId
        ? `${ride.passengerId.firstName} ${ride.passengerId.lastName}`
        : 'Unknown',
      boardedAt: ride.boardedAt,
      boardLocation: ride.pickupLocation,
    }));

    return res.status(200).json({
      tripId,
      count: passengers.length,
      passengers,
    });
  } catch (error) {
    console.error('Get current passengers error:', error);
    return res.status(500).json({ error: 'Failed to fetch current passengers.' });
  }
};

const listOnboardDestinations = async (req, res) => {
  try {
    const { shuttleId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(shuttleId)) {
      return res.status(400).json({ error: 'Invalid shuttleId.' });
    }

    const shuttle = await Shuttle.findById(shuttleId).select('communityId driverId');
    if (!shuttle) {
      return res.status(404).json({ error: 'Shuttle not found.' });
    }

    if (String(shuttle.communityId) !== String(req.user.communityId)) {
      return res.status(403).json({ error: 'Access denied. Shuttle is outside your community.' });
    }

    if (req.user.role === 'driver' && String(shuttle.driverId || '') !== String(req.user._id)) {
      return res.status(403).json({ error: 'Access denied. This shuttle is not assigned to you.' });
    }

    const activeTrip = await Trip.findOne({
      communityId: shuttle.communityId,
      shuttleId: shuttle._id,
      status: 'active',
    }).select('_id');

    if (!activeTrip) {
      return res.status(200).json({ shuttleId, count: 0, passengers: [] });
    }

    const rides = await PassengerRide.find({
      tripId: activeTrip._id,
      status: 'boarded',
    })
      .populate('passengerId', 'firstName lastName')
      .select('passengerId boardedAt destinationType destinationLabel destinationLocation discountType fareAtBoarding originalFare discountRevoked')
      .sort({ boardedAt: 1 })
      .lean();

    const passengers = rides.map((ride) => ({
      rideId: String(ride._id),
      passengerId: ride.passengerId?._id || null,
      passengerName: ride.passengerId
        ? `${ride.passengerId.firstName} ${ride.passengerId.lastName}`.trim()
        : 'Passenger',
      boardedAt: ride.boardedAt,
      destinationType: ride.destinationType,
      destinationLabel: ride.destinationLabel,
      destinationLocation: ride.destinationLocation,
      discountType: ride.discountType || 'none',
      fareAtBoarding: ride.fareAtBoarding,
      originalFare: ride.originalFare || null,
      discountRevoked: ride.discountRevoked || false,
    }));

    return res.status(200).json({ shuttleId, count: passengers.length, passengers });
  } catch (error) {
    console.error('List onboard destinations error:', error);
    return res.status(500).json({ error: 'Failed to fetch onboard destinations.' });
  }
};

/**
 * GET /api/trips/driver-completed-trips
 * Driver fetches their own completed trips (to see which need remittance).
 */
const listDriverCompletedTrips = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const driverId = req.user._id;
    const communityId = req.user.communityId;

    const trips = await Trip.find({
      communityId,
      driverId,
      status: { $in: ['completed', 'synced'] },
    })
      .select('_id shuttleId shiftStart shiftEnd passengersBoarded fareAtTime revenueCollected status')
      .populate('shuttleId', 'plateNumber label')
      .sort({ shiftEnd: -1 })
      .limit(limit)
      .lean();

    const tripIds = trips.map((trip) => trip._id);
    const remittances = await ShiftRemittance.find({
      tripId: { $in: tripIds },
    })
      .select('tripId status actualAmount expectedAmount varianceAmount submittedAt deadline_at')
      .lean();

    const remittanceByTripId = new Map(
      remittances.map((r) => [String(r.tripId), r])
    );

    const rows = trips.map((trip) => {
      const remittance = remittanceByTripId.get(String(trip._id));
      return {
        tripId: trip._id,
        shuttlePlate: trip.shuttleId?.plateNumber || '',
        shuttleLabel: trip.shuttleId?.label || '',
        shiftStart: trip.shiftStart,
        shiftEnd: trip.shiftEnd,
        passengersBoarded: trip.passengersBoarded,
        fareAtTime: trip.fareAtTime,
        revenueCollected: trip.revenueCollected,
        expectedRemittance: Number(
          (trip.revenueCollected || (trip.passengersBoarded * trip.fareAtTime) || 0).toFixed(2)
        ),
        remittanceStatus: remittance ? remittance.status : 'not_submitted',
        remittanceActualAmount: remittance ? remittance.actualAmount : null,
        remittanceVariance: remittance ? remittance.varianceAmount : null,
        remittanceSubmittedAt: remittance ? remittance.submittedAt : null,
        remittanceDeadlineAt: remittance ? remittance.deadline_at : null,
      };
    });

    return res.status(200).json({
      count: rows.length,
      trips: rows,
    });
  } catch (error) {
    console.error('List driver completed trips error:', error);
    return res.status(500).json({ error: 'Failed to fetch completed trips.' });
  }
};

/**
 * GET /api/trips/driver-remittances
 * Driver fetches their own remittance history.
 */
const listDriverRemittances = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const driverId = req.user._id;
    const communityId = req.user.communityId;

    const remittances = await ShiftRemittance.find({
      communityId,
      driverId,
    })
      .populate('shuttleId', 'plateNumber label')
      .populate('tripId', 'shiftStart shiftEnd passengersBoarded revenueCollected')
      .sort({ submittedAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({
      count: remittances.length,
      remittances,
    });
  } catch (error) {
    console.error('List driver remittances error:', error);
    return res.status(500).json({ error: 'Failed to fetch remittances.' });
  }
};

/**
 * POST /api/trips/ride-requests/:requestId/resolve
 * Driver resolves an unresolved ride request before ending shift.
 * resolution: 'no_show' | 'late_manual'
 */
const resolveRideRequest = async (req, res) => {
  const session = await createOptionalSession();
  if (session) session.startTransaction();

  try {
    const { requestId } = req.params;
    const { resolution } = req.body;

    if (!mongoose.Types.ObjectId.isValid(String(requestId))) {
      if (session) await session.abortTransaction();
      return res.status(400).json({ error: 'Invalid ride request ID.' });
    }

    if (!['no_show', 'late_manual'].includes(String(resolution))) {
      if (session) await session.abortTransaction();
      return res.status(400).json({ error: "resolution must be 'no_show' or 'late_manual'." });
    }

    const rideRequest = await RideRequest.findById(requestId).session(session);
    if (!rideRequest) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ error: 'Ride request not found.' });
    }

    if (String(rideRequest.communityId) !== String(req.user.communityId)) {
      if (session) await session.abortTransaction();
      return res.status(403).json({ error: 'Access denied. Ride request is outside your community.' });
    }

    if (rideRequest.status !== 'pending') {
      if (session) await session.abortTransaction();
      return res.status(409).json({
        error: `Cannot resolve ride request with status '${rideRequest.status}'. Only pending requests can be resolved.`,
      });
    }

    const now = new Date();

    if (resolution === 'no_show') {
      rideRequest.status = 'cancelled';
      rideRequest.resolution = 'no_show';
      rideRequest.cancelledAt = now;
      rideRequest.resolvedAt = now;
      rideRequest.resolvedBy = req.user._id;
      await rideRequest.save({ session });

      if (session) await session.commitTransaction();

      return res.status(200).json({
        message: 'Ride request resolved as no-show.',
        rideRequest,
      });
    }

    // resolution === 'late_manual'
    // Find the driver's shuttle and active trip to link the late boarding
    const shuttle = await Shuttle.findOne({
      communityId: req.user.communityId,
      driverId: req.user._id,
      isActive: true,
    }).session(session);

    if (!shuttle) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ error: 'No active shuttle found for this driver.' });
    }

    if (!isShuttlePhaseCompatible({
      shuttlePhase: shuttle.assignedPhase,
      passengerHomePhase: rideRequest.passengerHomePhase,
    })) {
      if (session) await session.abortTransaction();
      return res.status(409).json({
        error: 'This ride request belongs to a different home phase and cannot be resolved by your shuttle.',
      });
    }

    const activeTrip = await Trip.findOne({
      communityId: shuttle.communityId,
      shuttleId: shuttle._id,
      driverId: req.user._id,
      status: 'active',
    }).session(session);

    if (!activeTrip) {
      if (session) await session.abortTransaction();
      return res.status(404).json({ error: 'No active trip found. Cannot record late boarding.' });
    }

    // Update the ride request
    rideRequest.status = 'boarded';
    rideRequest.resolution = 'late_manual';
    rideRequest.shuttleId = shuttle._id;
    rideRequest.tripId = activeTrip._id;
    rideRequest.boardedAt = now;
    rideRequest.resolvedAt = now;
    rideRequest.resolvedBy = req.user._id;
    await rideRequest.save({ session });

    // Create corresponding PassengerRide record
    await PassengerRide.create(
      [{
        communityId: shuttle.communityId,
        passengerId: rideRequest.passengerId,
        shuttleId: shuttle._id,
        driverId: req.user._id,
        tripId: activeTrip._id,
        fareAtBoarding: activeTrip.fareAtTime,
        pickupLocation: rideRequest.pickupLocation,
        destinationType: rideRequest.destination?.type || 'fixed',
        destinationLabel: rideRequest.destination?.label || 'Destination',
        destinationLocation: rideRequest.destination?.location || rideRequest.pickupLocation,
        requestedAt: rideRequest.createdAt,
        boardedAt: now,
        status: 'boarded',
      }],
      { session }
    );

    // Increment trip counters
    activeTrip.passengersBoarded += 1;
    activeTrip.revenueCollected = activeTrip.passengersBoarded * activeTrip.fareAtTime;
    await activeTrip.save({ session });

    // Update shuttle capacity
    if (shuttle.currentCapacity < shuttle.maxCapacity) {
      shuttle.currentCapacity += 1;
      shuttle.status = 'en_route';
      shuttle.lastLocationUpdate = new Date();
      await shuttle.save({ session });
    }

    // Release the pendingPickupCount slot if the linked PickupRequest was dispatched
    if (rideRequest.pickupRequestId) {
      const linkedPickup = await PickupRequest.findById(rideRequest.pickupRequestId)
        .select('status assignedShuttleId')
        .session(session);
      if (linkedPickup?.status === 'dispatched' && linkedPickup.assignedShuttleId) {
        await Shuttle.updateOne(
          { _id: linkedPickup.assignedShuttleId, pendingPickupCount: { $gt: 0 } },
          { $inc: { pendingPickupCount: -1 } }
        ).session(session);
      }
    }

    if (session) await session.commitTransaction();

    // Emit socket events so passengers and community UI stay in sync
    const lateIo = req.app.get('io');
    lateIo.to(`community:${String(req.user.communityId)}`).emit('trip:pickup-claimed', {
      requestId: rideRequest.pickupRequestId || null,
      passengerId: rideRequest.passengerId || null,
      shuttleId: shuttle._id,
      tripId: activeTrip._id,
    });
    if (rideRequest.passengerId) {
      lateIo.to(`user:${String(rideRequest.passengerId)}`).emit('notification', {
        title: 'Boarded',
        body: 'Your ride has been recorded by the driver.',
        type: 'late_manual_boarded',
      });
    }

    return res.status(200).json({
      message: 'Ride request resolved as late manual boarding.',
      rideRequest,
      trip: activeTrip,
    });
  } catch (error) {
    if (session) await session.abortTransaction();
    console.error('Resolve ride request error:', error);
    return res.status(500).json({ error: 'Failed to resolve ride request.' });
  } finally {
    if (session) session.endSession();
  }
};

/**
 * GET /api/trips/my-dispatch
 * Passenger-only: returns their current dispatched PickupRequest with assigned shuttle info.
 * Used by the passenger map to show which shuttle is coming.
 */
const getMyDispatch = async (req, res) => {
  try {
    const request = await PickupRequest.findOne({
      passengerId: req.user._id,
      communityId: req.user.communityId,
      status: { $in: ['pending', 'dispatched', 'queued'] },
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .populate('assignedShuttleId', 'plateNumber label assignedPhase location currentCapacity maxCapacity pendingPickupCount status')
      .lean();

    if (!request) {
      return res.status(200).json({ dispatch: null });
    }

    const webBaseUrl = process.env.WEB_BASE_URL || '';
    const trackingUrl = webBaseUrl && request.trackingToken
      ? `${webBaseUrl}/track/${request.trackingToken}`
      : null;

    // Compute live pendingPickupCount so the "pickups ahead" display is always accurate
    // and never shows a stale stored value from the Shuttle document.
    let livePendingPickupCount = 0;
    if (request.assignedShuttleId) {
      livePendingPickupCount = await PickupRequest.countDocuments({
        assignedShuttleId: request.assignedShuttleId._id,
        status: 'dispatched',
        expiresAt: { $gt: new Date() },
      });
    }

    return res.status(200).json({
      dispatch: {
        requestId: request._id,
        fareType: request.fareType,
        status: request.status,
          passengerHomePhase: request.passengerHomePhase || null,
        queuePosition: request.queuePosition,
        dispatchedAt: request.dispatchedAt,
        expiresAt: request.expiresAt,
        trackingToken: request.trackingToken || null,
        trackingUrl,
        assignedShuttle: request.assignedShuttleId
          ? {
              shuttleId: request.assignedShuttleId._id,
              plateNumber: request.assignedShuttleId.plateNumber,
              label: request.assignedShuttleId.label,
            assignedPhase: request.assignedShuttleId.assignedPhase || null,
              location: request.assignedShuttleId.location,
              currentCapacity: request.assignedShuttleId.currentCapacity,
              maxCapacity: request.assignedShuttleId.maxCapacity,
              pendingPickupCount: livePendingPickupCount,
              status: request.assignedShuttleId.status,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Get my dispatch error:', error);
    return res.status(500).json({ error: 'Failed to fetch dispatch status.' });
  }
};

/**
 * POST /api/trips/pickup-intent/:requestId/claim
 * Driver manually claims a pending or queued pickup request for their shuttle.
 */
const claimPickupIntent = async (req, res) => {
  try {
    const { requestId } = req.params;
    const io = req.app.get('io');
    const driverId = req.user._id;
    const communityId = req.user.communityId;

    if (req.user.status !== 'driving') {
      return res.status(409).json({ error: 'Start your shift before claiming a pickup.' });
    }

    const shuttle = await Shuttle.findOne({
      communityId,
      driverId,
      isActive: true,
      status: { $in: ['idle', 'en_route'] },
    }).select('_id plateNumber label assignedPhase currentCapacity maxCapacity pendingPickupCount location status').lean();

    if (!shuttle) {
      return res.status(404).json({ error: 'No active shuttle found for your account.' });
    }

    const communityOid = mongoose.Types.ObjectId.isValid(String(communityId))
      ? new mongoose.Types.ObjectId(String(communityId))
      : communityId;

    const pendingAgg = await PickupRequest.aggregate([
      {
        $match: {
          communityId: communityOid,
          status: 'dispatched',
          assignedShuttleId: shuttle._id,
          expiresAt: { $gt: new Date() },
        },
      },
      { $count: 'count' },
    ]);
    const actualPendingCount = pendingAgg[0]?.count ?? 0;

    if (shuttle.currentCapacity + actualPendingCount >= shuttle.maxCapacity) {
      return res.status(409).json({ error: 'Your shuttle is at full capacity.' });
    }

    const now = new Date();
    const requestFilter = mongoose.Types.ObjectId.isValid(String(requestId))
      ? {
        _id: requestId,
        communityId,
        status: { $in: ['pending', 'queued'] },
        expiresAt: { $gt: now },
      }
      : {
        trackingToken: requestId,
        communityId,
        status: { $in: ['pending', 'queued'] },
        expiresAt: { $gt: now },
      };

    const pickupRequest = await PickupRequest.findOne(requestFilter);

    if (!pickupRequest) {
      return res.status(404).json({ error: 'Request not found, already claimed, or expired.' });
    }

    if (!isShuttlePhaseCompatible({ shuttlePhase: shuttle.assignedPhase, passengerHomePhase: pickupRequest.passengerHomePhase })) {
      return res.status(409).json({ error: 'This passenger is not in your assigned phase area.' });
    }

    // Use $set to actualPendingCount + 1 instead of $inc so we never inherit a
    // drifted stored counter. actualPendingCount is the live aggregate from DB.
    const updatedShuttle = await Shuttle.findByIdAndUpdate(
      shuttle._id,
      { $set: { pendingPickupCount: actualPendingCount + 1 } },
      { new: true, select: '_id plateNumber label currentCapacity maxCapacity pendingPickupCount location' }
    );

    if (!updatedShuttle) {
      return res.status(500).json({ error: 'Failed to reserve shuttle slot.' });
    }

    // Check with the accurate count (currentCapacity + live pending + 1 for this claim)
    if (shuttle.currentCapacity + actualPendingCount + 1 > shuttle.maxCapacity) {
      await Shuttle.updateOne({ _id: shuttle._id }, { $set: { pendingPickupCount: actualPendingCount } });
      return res.status(409).json({ error: 'Shuttle became full while claiming. Please try again.' });
    }

    await PickupRequest.findByIdAndUpdate(requestId, {
      $set: {
        status: 'dispatched',
        assignedShuttleId: shuttle._id,
        assignedDriverId: driverId,
        dispatchedAt: now,
        queuePosition: null,
      },
    });

    const community = await Community.findById(communityId).select('baseFare priorityFareMultiplier').lean();
    const fareExpected = pickupRequest.fareType === 'priority'
      ? Number(((community?.baseFare ?? 0) * (community?.priorityFareMultiplier ?? 1.5)).toFixed(2))
      : (community?.baseFare ?? 0);

    const communityRoom = `community:${String(communityId)}`;
    const passengerRoom = `user:${String(pickupRequest.passengerId)}`;
    const driverRoom = `user:${String(driverId)}`;

    const sharedPayload = {
      requestId: pickupRequest._id,
      passengerId: pickupRequest.passengerId,
      bookingOwner: pickupRequest.bookingOwner || pickupRequest.passengerId,
      fareType: pickupRequest.fareType,
      fareExpected,
      passengerFares: [],
      pickupLocation: pickupRequest.pickupLocation || null,
      location: pickupRequest.location,
      destinationType: pickupRequest.destinationType,
      destinationLabel: pickupRequest.destinationLabel,
      destinationLocation: pickupRequest.destinationLocation,
      expiresAt: pickupRequest.expiresAt,
      dispatchedAt: now,
    };

    try {
      const linkedRrs = await RideRequest.find({ pickupRequestId: pickupRequest._id }).lean();
      if (Array.isArray(linkedRrs) && linkedRrs.length > 0) {
        sharedPayload.passengerFares = linkedRrs.map((r) => ({
          rideRequestId: r._id,
          passengerId: r.passengerId || null,
          passengerName: r.passengerName || null,
          discountType: r.discountType || 'none',
          fareExpected: r.fareExpected ?? null,
          originalFare: r.originalFare ?? null,
        }));
      }
    } catch (err) {
      // non-fatal: leave passengerFares empty if lookup fails
      console.error('Failed to load linked ride requests for claim payload:', err);
    }

    const shuttlePayload = {
      shuttleId: updatedShuttle._id,
      plateNumber: updatedShuttle.plateNumber || '',
      label: updatedShuttle.label || '',
      location: updatedShuttle.location,
      currentCapacity: updatedShuttle.currentCapacity,
      maxCapacity: updatedShuttle.maxCapacity,
      pendingPickupCount: updatedShuttle.pendingPickupCount,
    };

    io.to(passengerRoom).emit('dispatch:passenger-assigned', { ...sharedPayload, shuttle: shuttlePayload });
    io.to(driverRoom).emit('dispatch:assigned', { ...sharedPayload, shuttle: shuttlePayload });
    io.to(communityRoom).emit('dispatch:shuttle-pending-updated', {
      shuttleId: updatedShuttle._id,
      pendingPickupCount: updatedShuttle.pendingPickupCount,
    });
    io.to(communityRoom).emit('pickup-intent:cancelled', { requestId: String(pickupRequest._id) });
    io.to(communityRoom).emit('trip:pickup-intent-cancelled', { requestId: String(pickupRequest._id) });

    return res.status(200).json({
      message: 'Pickup request claimed successfully.',
      shuttle: shuttlePayload,
    });
  } catch (error) {
    console.error('Claim pickup intent error:', error);
    return res.status(500).json({ error: 'Failed to claim pickup request.' });
  }
};

/**
 * GET /api/track/:token  (public — no auth required)
 * Returns live tracking data for a pickup request by its tracking token.
 */
const getTrackingInfo = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || typeof token !== 'string' || token.length < 10) {
      return res.status(400).json({ error: 'Invalid tracking token.' });
    }

    const pickupRequest = await PickupRequest.findOne({ trackingToken: token })
      .populate('assignedShuttleId', 'location lastLocationUpdate label plateNumber status')
      .lean();

    if (!pickupRequest) {
      return res.status(404).json({ error: 'Tracking link not found or has expired.' });
    }

    if (
      pickupRequest.status === 'expired' ||
      pickupRequest.status === 'cancelled' ||
      new Date(pickupRequest.expiresAt) <= new Date()
    ) {
      return res.status(410).json({ completed: true, error: 'This ride has been completed.' });
    }

    const passengerNames = (pickupRequest.passengerManifest || [])
      .map((p) => p.name || 'Guest')
      .filter(Boolean);

    // Always extract passenger pickup coords for map context
    const pickupCoords = pickupRequest.pickupLocation?.coordinates || pickupRequest.location?.coordinates;
    const pickupLatLng = (Array.isArray(pickupCoords) && pickupCoords.length === 2)
      ? { latitude: pickupCoords[1], longitude: pickupCoords[0] }
      : null;

    // Destination location for drop-off pin
    const destCoords = pickupRequest.destinationLocation?.coordinates;
    const destinationLatLng = (Array.isArray(destCoords) && destCoords.length === 2)
      ? { latitude: destCoords[1], longitude: destCoords[0] }
      : null;

    const response = {
      mode: pickupRequest.trackingMode || 'passenger',
      status: pickupRequest.status,
      destinationLabel: pickupRequest.destinationLabel,
      fareType: pickupRequest.fareType,
      note: pickupRequest.note || null,
      expiresAt: pickupRequest.expiresAt,
      passengerNames,
      location: null,
      pickupLocation: pickupLatLng,
      destinationLocation: destinationLatLng,
      shuttleLabel: null,
      shuttlePlate: null,
      locationUpdatedAt: null,
      etaMinutes: null,
    };

    if (pickupRequest.trackingMode === 'driver') {
      const shuttle = pickupRequest.assignedShuttleId;
      if (shuttle && shuttle.location && Array.isArray(shuttle.location.coordinates) && shuttle.location.coordinates.length === 2) {
        const [lng, lat] = shuttle.location.coordinates;
        response.location = { latitude: lat, longitude: lng };
        response.shuttleLabel = shuttle.label || null;
        response.shuttlePlate = shuttle.plateNumber || null;
        response.locationUpdatedAt = shuttle.lastLocationUpdate || null;

        // ETA: time for shuttle to reach pickup (30 km/h ≈ 500 m/min in community)
        if (pickupLatLng) {
          const distM = haversineMeters(lat, lng, pickupLatLng.latitude, pickupLatLng.longitude);
          response.etaMinutes = Math.max(1, Math.round(distM / 500));
        }
      } else {
        // No shuttle assigned yet — show passenger pickup location so map is useful
        response.location = pickupLatLng;
      }
    } else {
      const coords = pickupRequest.location?.coordinates;
      if (Array.isArray(coords) && coords.length === 2) {
        const [lng, lat] = coords;
        response.location = { latitude: lat, longitude: lng };
      }
    }

    return res.json(response);
  } catch (error) {
    console.error('Get tracking info error:', error);
    return res.status(500).json({ error: 'Failed to fetch tracking info.' });
  }
};

module.exports = {

  passengerBoard,
  passengerUnboard,
  listOnboardDestinations,
  getCurrentPassengers,
  endShift,
  syncOfflineTrips,
  createPickupIntent,
  cancelPickupIntent,
  cancelMyPickupIntents,
  listPickupIntents,
  listPassengerRecentRides,
  getAnalytics,
  getDriverAnalytics,
  getDriverPerformanceAnalytics,
  submitShiftRemittance,
  verifyShiftRemittance,
  listShiftRemittances,
  getRemittanceSummary,
  listDriverCompletedTrips,
  listDriverRemittances,
  resolveRideRequest,
  getMyDispatch,
  claimPickupIntent,
  getTrackingInfo,
};
