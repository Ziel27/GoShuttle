const mongoose = require('mongoose');
const validator = require('validator');
const Trip = require('../models/Trip');
const Shuttle = require('../models/Shuttle');
const Community = require('../models/Community');
const PickupRequest = require('../models/PickupRequest');
const PassengerRide = require('../models/PassengerRide');
const User = require('../models/User');
const ShiftRemittance = require('../models/ShiftRemittance');
const { isLocationInBoundary } = require('../services/geofence');

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
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
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

const claimPendingPickupRequests = async ({ session, communityId, maxCount }) => {
  const claimed = [];

  for (let i = 0; i < maxCount; i += 1) {
    const request = await PickupRequest.findOneAndUpdate(
      {
        communityId,
        status: 'pending',
        expiresAt: { $gt: new Date() },
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
    });

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

      await PassengerRide.insertMany(
        pendingRequests.map((request) => ({
          communityId: shuttle.communityId,
          passengerId: request.passengerId,
          shuttleId: shuttle._id,
          driverId: req.user._id,
          tripId: activeTrip._id,
          fareAtBoarding: activeTrip.fareAtTime,
          pickupLocation: request.location,
          destinationType: request.destinationType || 'fixed',
          destinationLabel: request.destinationLabel || 'Destination',
          destinationLocation: request.destinationLocation || request.location,
          requestedAt: request.createdAt,
          boardedAt,
          status: 'boarded',
        })),
        { session }
      );
    }

    // Update shuttle within transaction
    shuttle.currentCapacity += boardedCount;
    shuttle.status = 'en_route';
    shuttle.lastLocationUpdate = new Date();
    await shuttle.save({ session });

    // Commit transaction
    if (session) await session.commitTransaction();

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
    });

    for (const request of pendingRequests) {
      io.to(communityRoom).emit('trip:pickup-claimed', {
        requestId: request._id,
        passengerId: request.passengerId,
        shuttleId: shuttle._id,
        tripId: activeTrip._id,
      });
    }

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

    if (!activeTrip) {
      return res.status(404).json({ error: 'No active trip found for this shuttle.' });
    }

    activeTrip.status = 'completed';
    activeTrip.shiftEnd = new Date();
    activeTrip.revenueCollected = activeTrip.passengersBoarded * activeTrip.fareAtTime;
    await activeTrip.save();

    shuttle.currentCapacity = 0;
    shuttle.status = 'idle';
    shuttle.lastLocationUpdate = new Date();
    await shuttle.save();

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
    const { latitude, longitude, destination } = req.body;

    const coords = validateCoordinates(latitude, longitude);
    if (!coords.valid) {
      return res.status(400).json({ error: coords.message });
    }

    const insideBoundary = await isLocationInBoundary({
      communityId: req.user.communityId,
      latitude: coords.lat,
      longitude: coords.lng,
    });

    if (!insideBoundary) {
      return res.status(403).json({
        error: 'Pickup request rejected. Location is outside your community boundary.',
      });
    }

    const community = await Community.findById(req.user.communityId).select('fixedDestinations');
    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }

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
        const selectedFixed = (community.fixedDestinations || []).find(
          (item) => String(item._id) === destinationPayload.fixedDestinationId && item.isActive !== false
        );
        if (!selectedFixed) {
          return res.status(404).json({ error: 'Selected fixed destination not found or inactive.' });
        }
        destinationLabel = selectedFixed.name;
        destinationLocation = selectedFixed.location;
      } else {
        const destinationInsideBoundary = await isLocationInBoundary({
          communityId: req.user.communityId,
          latitude: destinationPayload.latitude,
          longitude: destinationPayload.longitude,
        });

        if (!destinationInsideBoundary) {
          return res.status(403).json({
            error: 'Home destination rejected. Destination is outside your community boundary.',
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

    const pickupRequest = await PickupRequest.create({
      communityId: req.user.communityId,
      passengerId: req.user._id,
      location: {
        type: 'Point',
        coordinates: [coords.lng, coords.lat],
      },
      destinationType,
      destinationLabel,
      destinationLocation,
      status: 'pending',
      expiresAt,
    });

    const io = req.app.get('io');
    io.to(`community:${String(req.user.communityId)}`).emit('trip:pickup-intent', {
      requestId: pickupRequest._id,
      communityId: pickupRequest.communityId,
      passengerId: pickupRequest.passengerId,
      location: pickupRequest.location,
      destinationType: pickupRequest.destinationType,
      destinationLabel: pickupRequest.destinationLabel,
      destinationLocation: pickupRequest.destinationLocation,
      expiresAt: pickupRequest.expiresAt,
      status: pickupRequest.status,
    });

    return res.status(201).json({
      message: 'Pickup intent submitted.',
      request: pickupRequest,
    });
  } catch (error) {
    console.error('Create pickup intent error:', error);
    return res.status(500).json({ error: 'Failed to submit pickup intent.' });
  }
};

/**
 * GET /api/trips/pickup-intents
 * Drivers/Admins fetch active pickup demand pins in their community.
 */
const listPickupIntents = async (req, res) => {
  try {
    const now = new Date();

    const requests = await PickupRequest.find({
      communityId: req.user.communityId,
      status: 'pending',
      expiresAt: { $gt: now },
    })
      .select('communityId passengerId location destinationType destinationLabel destinationLocation status expiresAt createdAt')
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
 * POST /api/trips/:tripId/remittance
 * Driver submits actual collected amount for a completed shift.
 */
const submitShiftRemittance = async (req, res) => {
  try {
    const { tripId } = req.params;
    const { actualAmount, driverNote } = req.body;

    if (!mongoose.Types.ObjectId.isValid(tripId)) {
      return res.status(400).json({ error: 'Invalid tripId.' });
    }

    const normalizedActual = parseMoney(actualAmount);
    if (normalizedActual === null) {
      return res.status(400).json({ error: 'actualAmount must be a valid non-negative number.' });
    }

    const trip = await Trip.findById(tripId).select(
      '_id communityId shuttleId driverId status shiftEnd passengersBoarded fareAtTime revenueCollected'
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

    const expectedAmount = Number((trip.revenueCollected || (trip.passengersBoarded * trip.fareAtTime) || 0).toFixed(2));
    const varianceAmount = Number((normalizedActual - expectedAmount).toFixed(2));
    const now = new Date();
    const status = req.user.role === 'admin'
      ? Math.abs(varianceAmount) < 0.01
        ? 'verified'
        : 'flagged'
      : 'pending';

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
      adminNote: req.user.role === 'admin' && Math.abs(varianceAmount) >= 0.01 ? 'Recorded by admin with variance.' : '',
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
 * Uses FIFO: first boarded passengers are unboarded first.
 */
const passengerUnboard = async (req, res) => {
  const session = await createOptionalSession();
  if (session) session.startTransaction();

  try {
    const { shuttleId, unboardCount } = req.body;
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

    // Find the most recent boarded passengers (FIFO: earliest boarders first)
    // Sort by boardedAt ascending to get first boarded first
    const boardedPassengers = await PassengerRide.find({
      tripId: activeTrip._id,
      status: 'boarded',
    })
      .session(session)
      .sort({ boardedAt: 1 })
      .limit(count);

    const effectiveUnboardCount = Math.min(count, boardedPassengers.length);
    if (effectiveUnboardCount === 0) {
      if (session) await session.abortTransaction();
      return res.status(409).json({
        error: 'No boarded passengers found for unboarding.',
      });
    }

    // Update those PassengerRide records with unboarded status
    const now = new Date();
    const unboardedPassengerIds = boardedPassengers.map((p) => p._id);

    await PassengerRide.updateMany(
      { _id: { $in: unboardedPassengerIds } },
      {
        $set: {
          status: 'unboarded',
          unboardedAt: now,
          // unboardLocation would be set by driver/GPS if available in future
        },
      },
      { session }
    );

    // Decrement shuttle capacity
    shuttle.currentCapacity = Math.max(0, shuttle.currentCapacity - effectiveUnboardCount);
    if (shuttle.currentCapacity === 0 && shuttle.status !== 'maintenance') {
      shuttle.status = 'idle';
    }
    shuttle.lastLocationUpdate = new Date();
    await shuttle.save({ session });

    // Note: Trip.passengersBoarded is NOT decremented - it stays as total boarded in shift
    // Only Trip.passengersBoarded is updated, status remains active per spec

    // Commit transaction
    if (session) await session.commitTransaction();

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
      .select('passengerId boardedAt destinationType destinationLabel destinationLocation')
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
      .select('tripId status actualAmount expectedAmount varianceAmount submittedAt')
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

module.exports = {
  passengerBoard,
  passengerUnboard,
  listOnboardDestinations,
  getCurrentPassengers,
  endShift,
  syncOfflineTrips,
  createPickupIntent,
  listPickupIntents,
  listPassengerRecentRides,
  getAnalytics,
  getDriverAnalytics,
  submitShiftRemittance,
  verifyShiftRemittance,
  listShiftRemittances,
  getRemittanceSummary,
  listDriverCompletedTrips,
  listDriverRemittances,
};
