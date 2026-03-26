const mongoose = require('mongoose');
const validator = require('validator');
const Trip = require('../models/Trip');
const Shuttle = require('../models/Shuttle');
const Community = require('../models/Community');
const PickupRequest = require('../models/PickupRequest');
const PassengerRide = require('../models/PassengerRide');
const { isLocationInBoundary } = require('../services/geofence');

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

/**
 * POST /api/trips/passenger-board
 * Driver's +1 Passenger action. Creates or updates the active shift trip.
 */
const passengerBoard = async (req, res) => {
  try {
    const { shuttleId } = req.body;
    const boardedCount = req.body.boardedCount === undefined ? 1 : Number(req.body.boardedCount);

    if (!shuttleId) {
      return res.status(400).json({ error: 'shuttleId is required.' });
    }

    if (!validator.isMongoId(String(shuttleId))) {
      return res.status(400).json({ error: 'Invalid shuttle ID.' });
    }

    if (!Number.isInteger(boardedCount) || boardedCount <= 0) {
      return res.status(400).json({ error: 'boardedCount must be a positive integer.' });
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

    if (shuttle.currentCapacity + boardedCount > shuttle.maxCapacity) {
      return res.status(409).json({
        error: `Shuttle is full. Available seats: ${Math.max(0, shuttle.maxCapacity - shuttle.currentCapacity)}.`,
      });
    }

    const community = await Community.findById(shuttle.communityId).select('baseFare');
    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    let activeTrip = await Trip.findOne({
      communityId: shuttle.communityId,
      shuttleId: shuttle._id,
      driverId: req.user._id,
      status: 'active',
    });

    if (!activeTrip) {
      activeTrip = await Trip.create({
        communityId: shuttle.communityId,
        shuttleId: shuttle._id,
        driverId: req.user._id,
        fareAtTime: community.baseFare,
        passengersBoarded: 0,
        revenueCollected: 0,
      });
    }

    activeTrip.passengersBoarded += boardedCount;
    activeTrip.revenueCollected = activeTrip.passengersBoarded * activeTrip.fareAtTime;
    await activeTrip.save();

    const pendingRequests = await PickupRequest.find({
      communityId: shuttle.communityId,
      status: 'pending',
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: 1 })
      .limit(boardedCount);

    if (pendingRequests.length > 0) {
      const boardedAt = new Date();

      await PickupRequest.updateMany(
        { _id: { $in: pendingRequests.map((request) => request._id) } },
        { $set: { status: 'claimed' } }
      );

      await PassengerRide.insertMany(
        pendingRequests.map((request) => ({
          communityId: shuttle.communityId,
          passengerId: request.passengerId,
          shuttleId: shuttle._id,
          driverId: req.user._id,
          tripId: activeTrip._id,
          fareAtBoarding: activeTrip.fareAtTime,
          pickupLocation: request.location,
          requestedAt: request.createdAt,
          boardedAt,
          status: 'completed',
        }))
      );
    }

    shuttle.currentCapacity += boardedCount;
    shuttle.status = 'en_route';
    shuttle.lastLocationUpdate = new Date();
    await shuttle.save();

    const io = req.app.get('io');
    io.emit('trip:passenger-boarded', {
      tripId: activeTrip._id,
      shuttleId: shuttle._id,
      communityId: shuttle.communityId,
      boardedCount,
      passengersBoarded: activeTrip.passengersBoarded,
      revenueCollected: activeTrip.revenueCollected,
      currentCapacity: shuttle.currentCapacity,
      maxCapacity: shuttle.maxCapacity,
    });

    return res.status(200).json({
      message: 'Passenger boarding recorded.',
      trip: activeTrip,
      shuttle,
    });
  } catch (error) {
    console.error('Passenger board error:', error);
    return res.status(500).json({ error: 'Failed to record passenger boarding.' });
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
    const { latitude, longitude } = req.body;

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

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const pickupRequest = await PickupRequest.create({
      communityId: req.user.communityId,
      passengerId: req.user._id,
      location: {
        type: 'Point',
        coordinates: [coords.lng, coords.lat],
      },
      status: 'pending',
      expiresAt,
    });

    const io = req.app.get('io');
    io.to(`community:${String(req.user.communityId)}`).emit('trip:pickup-intent', {
      requestId: pickupRequest._id,
      communityId: pickupRequest.communityId,
      passengerId: pickupRequest.passengerId,
      location: pickupRequest.location,
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
      .select('communityId passengerId location status expiresAt createdAt')
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
      .select('status requestedAt boardedAt fareAtBoarding pickupLocation shuttleId')
      .sort({ boardedAt: -1 })
      .limit(10);

    const serialized = rides.map((ride) => ({
      rideId: ride._id,
      status: ride.status,
      requestedAt: ride.requestedAt,
      boardedAt: ride.boardedAt,
      fareAtBoarding: ride.fareAtBoarding,
      pickupLocation: ride.pickupLocation,
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

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid startDate or endDate.' });
    }

    const series = await Trip.aggregate([
      {
        $match: {
          communityId: new mongoose.Types.ObjectId(req.user.communityId),
          shiftStart: {
            $gte: startDate,
            $lte: endDate,
          },
        },
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

module.exports = {
  passengerBoard,
  endShift,
  syncOfflineTrips,
  createPickupIntent,
  listPickupIntents,
  listPassengerRecentRides,
  getAnalytics,
};
