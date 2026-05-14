const mongoose = require('mongoose');
const validator = require('validator');
const Shuttle = require('../models/Shuttle');
const User = require('../models/User');
const Trip = require('../models/Trip');
const Community = require('../models/Community');
const PickupRequest = require('../models/PickupRequest');
const PassengerRide = require('../models/PassengerRide');
const RideRequest = require('../models/RideRequest');
const { isLocationInBoundary } = require('../services/geofence');
const { completeRideRequestsForPassengers } = require('../services/ride-request-lifecycle');
const { getManualAutomationCooldownRemainingMs } = require('../services/automation-cooldown');
const { normalizePhase, buildPhaseAwareRequestQuery, isShuttlePhaseCompatible } = require('../utils/phase');
const { retryWaitingQueue, } = require('../services/dispatch.service');
const { emitToTrackingRooms } = require('../services/socket-handlers');

const AUTO_PICKUP_RADIUS_METERS = 140;
const AUTO_UNBOARD_RADIUS_METERS = 20;
const EARTH_RADIUS_METERS = 6_371_000;
const MAX_WRITE_CONFLICT_RETRIES = 3;
const LOCATION_WRITE_CONFLICT_RETRY_BASE_DELAY_MS = 80;

const AUTO_DIAGNOSTIC_STATES = {
  READY: 'ready',
  WAITING: 'waiting',
  BLOCKED: 'blocked',
  EXECUTED: 'executed',
};

const isPlatformAdmin = (req) => req.user?.role === 'admin';

const toCenterSphereRadius = (meters) => Number(meters) / EARTH_RADIUS_METERS;

const buildGeoWithinDistanceFilter = (location, maxDistanceMeters) => ({
  $geoWithin: {
    $centerSphere: [location.coordinates, toCenterSphereRadius(maxDistanceMeters)],
  },
});

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

const claimNearbyPickupRequests = async ({ session, shuttle, maxCount }) => {
  const claimed = [];
  const phaseQuery = buildPhaseAwareRequestQuery({
    shuttlePhase: shuttle.assignedPhase,
    passengerPhaseField: 'passengerHomePhase',
  });

  for (let i = 0; i < maxCount; i += 1) {
    let request = null;

    for (let attempt = 1; attempt <= MAX_WRITE_CONFLICT_RETRIES; attempt += 1) {
      try {
        request = await PickupRequest.findOneAndUpdate(
          {
            communityId: shuttle.communityId,
            status: 'pending',
            expiresAt: { $gt: new Date() },
            ...phaseQuery,
            location: {
              $near: {
                $geometry: shuttle.location,
                $maxDistance: AUTO_PICKUP_RADIUS_METERS,
              },
            },
          },
          { $set: { status: 'claimed' } },
          {
            session,
            sort: { createdAt: 1 },
            new: true,
          }
        );
        break;
      } catch (error) {
        if (isRetryableMongoWriteConflict(error) && attempt < MAX_WRITE_CONFLICT_RETRIES) {
          continue;
        }
        throw error;
      }
    }

    if (!request) break;
    claimed.push(request);
  }

  return claimed;
};

const autoBoardNearbyPickups = async ({ session, shuttle, driverId }) => {
  if (!shuttle?.location?.coordinates || shuttle.location.coordinates.length !== 2) {
    return { autoBoardedCount: 0, trip: null, claimedRequests: [] };
  }

  const availableSeats = Math.max(0, shuttle.maxCapacity - shuttle.currentCapacity);
  if (availableSeats === 0) {
    return { autoBoardedCount: 0, trip: null, claimedRequests: [] };
  }

  const nearbyRequests = await claimNearbyPickupRequests({
    session,
    shuttle,
    maxCount: availableSeats,
  });

  if (nearbyRequests.length === 0) {
    return { autoBoardedCount: 0, trip: null, claimedRequests: [] };
  }

  let activeTrip = await Trip.findOne({
    communityId: shuttle.communityId,
    shuttleId: shuttle._id,
    driverId,
    status: 'active',
  }).session(session);

  if (!activeTrip) {
    const community = await Community.findById(shuttle.communityId).select('baseFare').session(session);
    if (!community) {
      throw new Error('Community not found for auto-boarding.');
    }

    [activeTrip] = await Trip.create([{
      communityId: shuttle.communityId,
      shuttleId: shuttle._id,
      driverId,
      fareAtTime: community.baseFare,
      passengersBoarded: 0,
      revenueCollected: 0,
    }], { session });
  }

  const boardedAt = new Date();
  const passengerRidesToInsert = [];
  for (const request of nearbyRequests) {
    // Prefer authoritative RideRequest documents linked to this pickup request
    const linkedRideRequests = await RideRequest.find({ pickupRequestId: request._id, status: 'pending' }).session(session);
    if (linkedRideRequests && linkedRideRequests.length > 0) {
      for (const rr of linkedRideRequests) {
        const rrDiscountType = rr.discountType && rr.discountType !== 'none' ? rr.discountType : 'none';
        const rrOriginalFare = rr.originalFare || null;
        const rrFareAtBoarding = rrDiscountType !== 'none' && rr.fareExpected ? rr.fareExpected : activeTrip.fareAtTime;
        const destLocation = rr.destination?.location || request.destinationLocation || request.pickupLocation || request.location;
        passengerRidesToInsert.push({
          communityId: shuttle.communityId,
          passengerId: rr.passengerId || null,
          passengerName: rr.passengerName || null,
          passengerPhone: rr.passengerPhone || null,
          shuttleId: shuttle._id,
          driverId,
          tripId: activeTrip._id,
          rideRequestId: rr._id,
          fareAtBoarding: rrFareAtBoarding,
          discountType: rrDiscountType,
          originalFare: rrOriginalFare,
          pickupLocation: rr.pickupLocation || request.pickupLocation || request.location,
          destinationType: rr.destination?.type || request.destinationType || 'fixed',
          destinationLabel: rr.destination?.label || request.destinationLabel || 'Destination',
          destinationLocation: destLocation,
          requestedAt: rr.createdAt || request.createdAt,
          boardedAt,
          status: 'boarded',
        });
      }
    } else if (Array.isArray(request.passengerManifest) && request.passengerManifest.length > 0) {
      for (const entry of request.passengerManifest) {
        const destLocation = request.destinationLocation || request.pickupLocation || request.location;
        passengerRidesToInsert.push({
          communityId: shuttle.communityId,
          passengerId: entry.passengerId || null,
          passengerName: entry.name || null,
          passengerPhone: entry.phone || null,
          shuttleId: shuttle._id,
          driverId,
          tripId: activeTrip._id,
          fareAtBoarding: activeTrip.fareAtTime,
          discountType: 'none',
          pickupLocation: request.pickupLocation || request.location,
          destinationType: request.destinationType || 'fixed',
          destinationLabel: request.destinationLabel || 'Destination',
          destinationLocation: destLocation,
          requestedAt: request.createdAt,
          boardedAt,
          status: 'boarded',
        });
      }
    } else {
      const destLocation = request.destinationLocation || request.pickupLocation || request.location;
      passengerRidesToInsert.push({
        communityId: shuttle.communityId,
        passengerId: request.passengerId,
        shuttleId: shuttle._id,
        driverId,
        tripId: activeTrip._id,
        fareAtBoarding: activeTrip.fareAtTime,
        discountType: 'none',
        pickupLocation: request.pickupLocation || request.location,
        destinationType: request.destinationType || 'fixed',
        destinationLabel: request.destinationLabel || 'Destination',
        destinationLocation: destLocation,
        requestedAt: request.createdAt,
        boardedAt,
        status: 'boarded',
      });
    }
  }

  if (passengerRidesToInsert.length > 0) {
    await PassengerRide.insertMany(passengerRidesToInsert, { session });
  }
  const insertedCount = passengerRidesToInsert.length;

  // Persist boarded status back to RideRequest documents when we have linked rideRequestIds
  const linkedRideRequestIds = passengerRidesToInsert
    .map((r) => r.rideRequestId)
    .filter(Boolean);

  if (linkedRideRequestIds.length > 0) {
    const boardedAtForUpdate = boardedAt || new Date();
    await RideRequest.updateMany(
      { _id: { $in: linkedRideRequestIds }, status: 'pending' },
      { $set: { status: 'boarded', shuttleId: shuttle._id, tripId: activeTrip._id, boardedAt: boardedAtForUpdate } },
      { session }
    );
  }
  activeTrip.passengersBoarded += insertedCount;
  // Revenue = sum of actual fares paid (accounting for discounts)
  const revenueFromThisBatch = passengerRidesToInsert.reduce((sum, r) => sum + (r.fareAtBoarding || 0), 0);
  activeTrip.revenueCollected = (activeTrip.revenueCollected || 0) + revenueFromThisBatch;
  await activeTrip.save({ session });

  shuttle.currentCapacity += insertedCount;
  if (shuttle.status === 'idle') {
    shuttle.status = 'en_route';
  }

  return {
    autoBoardedCount: insertedCount,
    trip: activeTrip,
    claimedRequests: nearbyRequests.map((request) => ({
      requestId: request._id,
      passengerId: request.passengerId,
    })),
  };
};

const autoUnboardArrivedPassengers = async ({ session, shuttle }) => {
  const activeTrip = await Trip.findOne({
    communityId: shuttle.communityId,
    shuttleId: shuttle._id,
    status: 'active',
  }).select('_id');

  if (!activeTrip) {
    return { autoUnboardedCount: 0, unboardedRideIds: [] };
  }

  const arrivedRides = await PassengerRide.find({
    tripId: activeTrip._id,
    shuttleId: shuttle._id,
    status: 'boarded',
    destinationLocation: {
      $near: {
        $geometry: shuttle.location,
        $maxDistance: AUTO_UNBOARD_RADIUS_METERS,
      },
    },
  })
    .select('_id passengerId rideRequestId')
    .session(session);

  if (arrivedRides.length === 0) {
    return { autoUnboardedCount: 0, unboardedRideIds: [] };
  }

  const unboardedRideIds = arrivedRides.map((ride) => ride._id);
  const now = new Date();

  await PassengerRide.updateMany(
    { _id: { $in: unboardedRideIds }, status: 'boarded' },
    {
      $set: {
        status: 'unboarded',
        unboardedAt: now,
        unboardLocation: shuttle.location,
      },
    },
    { session }
  );

  const arrivedPassengerIds = arrivedRides.map((ride) => ride.passengerId).filter(Boolean);
  const arrivedRideRequestIds = arrivedRides.map((ride) => ride.rideRequestId).filter(Boolean);

  if (arrivedRideRequestIds.length > 0) {
    await completeRideRequestsForPassengers({
      rideRequestIds: arrivedRideRequestIds,
      completedAt: now,
      session,
    });
  }

  if (arrivedPassengerIds.length > 0) {
    await completeRideRequestsForPassengers({
      tripId: activeTrip._id,
      passengerIds: arrivedPassengerIds,
      completedAt: now,
      session,
    });
  }

  const effectiveUnboardCount = unboardedRideIds.length;
  shuttle.currentCapacity = Math.max(0, shuttle.currentCapacity - effectiveUnboardCount);
  if (shuttle.currentCapacity === 0 && shuttle.status !== 'maintenance') {
    shuttle.status = 'idle';
  }

  return {
    autoUnboardedCount: effectiveUnboardCount,
    unboardedRideIds,
    activeTripId: activeTrip._id,
  };
};

const buildAutomationDiagnostics = async ({
  session,
  shuttle,
  actor,
  autoBoardingResult,
  autoUnboardingResult,
}) => {
  const baseDiagnostics = {
    autoBoarding: {
      state: AUTO_DIAGNOSTIC_STATES.WAITING,
      reasonCode: 'no_nearby_pickups',
      matchedCount: Number(autoBoardingResult?.autoBoardedCount || 0),
      candidateCount: 0,
    },
    autoUnboarding: {
      state: AUTO_DIAGNOSTIC_STATES.WAITING,
      reasonCode: 'no_arrived_destinations',
      matchedCount: Number(autoUnboardingResult?.autoUnboardedCount || 0),
      candidateCount: 0,
    },
  };

  if (actor?.role !== 'driver') {
    return {
      autoBoarding: {
        ...baseDiagnostics.autoBoarding,
        state: AUTO_DIAGNOSTIC_STATES.BLOCKED,
        reasonCode: 'not_driver',
      },
      autoUnboarding: {
        ...baseDiagnostics.autoUnboarding,
        state: AUTO_DIAGNOSTIC_STATES.BLOCKED,
        reasonCode: 'not_driver',
      },
    };
  }

  if (actor?.status !== 'driving') {
    return {
      autoBoarding: {
        ...baseDiagnostics.autoBoarding,
        state: AUTO_DIAGNOSTIC_STATES.BLOCKED,
        reasonCode: 'driver_off_shift',
      },
      autoUnboarding: {
        ...baseDiagnostics.autoUnboarding,
        state: AUTO_DIAGNOSTIC_STATES.BLOCKED,
        reasonCode: 'driver_off_shift',
      },
    };
  }

  if (!shuttle?.location?.coordinates || shuttle.location.coordinates.length !== 2) {
    return {
      autoBoarding: {
        ...baseDiagnostics.autoBoarding,
        state: AUTO_DIAGNOSTIC_STATES.BLOCKED,
        reasonCode: 'location_unavailable',
      },
      autoUnboarding: {
        ...baseDiagnostics.autoUnboarding,
        state: AUTO_DIAGNOSTIC_STATES.BLOCKED,
        reasonCode: 'location_unavailable',
      },
    };
  }

  const availableSeats = Math.max(0, Number(shuttle.maxCapacity || 0) - Number(shuttle.currentCapacity || 0));
  if (availableSeats === 0) {
    baseDiagnostics.autoBoarding.state = AUTO_DIAGNOSTIC_STATES.BLOCKED;
    baseDiagnostics.autoBoarding.reasonCode = 'shuttle_full';
  } else if (baseDiagnostics.autoBoarding.matchedCount > 0) {
    baseDiagnostics.autoBoarding.state = AUTO_DIAGNOSTIC_STATES.EXECUTED;
    baseDiagnostics.autoBoarding.reasonCode = 'auto_boarded';
  } else {
    const phaseQuery = buildPhaseAwareRequestQuery({
      shuttlePhase: shuttle.assignedPhase,
      passengerPhaseField: 'passengerHomePhase',
    });
    const nearbyPendingCount = await applySession(
      PickupRequest.countDocuments({
        communityId: shuttle.communityId,
        status: 'pending',
        expiresAt: { $gt: new Date() },
        ...phaseQuery,
        location: buildGeoWithinDistanceFilter(shuttle.location, AUTO_PICKUP_RADIUS_METERS),
      }),
      session
    );

    baseDiagnostics.autoBoarding.candidateCount = nearbyPendingCount;
    baseDiagnostics.autoBoarding.state = AUTO_DIAGNOSTIC_STATES.WAITING;
    baseDiagnostics.autoBoarding.reasonCode = nearbyPendingCount > 0
      ? 'nearby_pickups_pending'
      : 'no_nearby_pickups';
  }

  if (baseDiagnostics.autoUnboarding.matchedCount > 0) {
    baseDiagnostics.autoUnboarding.state = AUTO_DIAGNOSTIC_STATES.EXECUTED;
    baseDiagnostics.autoUnboarding.reasonCode = 'auto_unboarded';
    return baseDiagnostics;
  }

  const activeTrip = await applySession(
    Trip.findOne({
      communityId: shuttle.communityId,
      shuttleId: shuttle._id,
      status: 'active',
    }).select('_id'),
    session
  );

  if (!activeTrip) {
    baseDiagnostics.autoUnboarding.state = AUTO_DIAGNOSTIC_STATES.WAITING;
    baseDiagnostics.autoUnboarding.reasonCode = 'no_active_trip';
    return baseDiagnostics;
  }

  const boardedCount = await applySession(
    PassengerRide.countDocuments({
      tripId: activeTrip._id,
      shuttleId: shuttle._id,
      status: 'boarded',
    }),
    session
  );

  if (boardedCount === 0) {
    baseDiagnostics.autoUnboarding.state = AUTO_DIAGNOSTIC_STATES.WAITING;
    baseDiagnostics.autoUnboarding.reasonCode = 'no_onboard_passengers';
    return baseDiagnostics;
  }

  const arrivedCount = await applySession(
    PassengerRide.countDocuments({
      tripId: activeTrip._id,
      shuttleId: shuttle._id,
      status: 'boarded',
      destinationLocation: buildGeoWithinDistanceFilter(shuttle.location, AUTO_UNBOARD_RADIUS_METERS),
    }),
    session
  );

  baseDiagnostics.autoUnboarding.candidateCount = arrivedCount;
  baseDiagnostics.autoUnboarding.state = AUTO_DIAGNOSTIC_STATES.WAITING;
  baseDiagnostics.autoUnboarding.reasonCode = arrivedCount > 0
    ? 'arrivals_pending_retry'
    : 'no_arrived_destinations';

  return baseDiagnostics;
};

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

      const manualAutomationCooldownRemainingMs =
        req.user.role === 'driver'
          ? getManualAutomationCooldownRemainingMs(shuttle._id)
          : 0;

      const shouldRunAutomation =
        req.user.role === 'driver' &&
        req.user.status === 'driving' &&
        manualAutomationCooldownRemainingMs <= 0;

      const autoBoardingResult = shouldRunAutomation
        ? await autoBoardNearbyPickups({
          session,
          shuttle,
          driverId: req.user._id,
        })
        : { autoBoardedCount: 0, trip: null, claimedRequests: [] };

      const autoUnboardingResult = shouldRunAutomation
        ? await autoUnboardArrivedPassengers({ session, shuttle })
        : { autoUnboardedCount: 0, unboardedRideIds: [] };

      const automationDiagnostics = await buildAutomationDiagnostics({
        session,
        shuttle,
        actor: req.user,
        autoBoardingResult,
        autoUnboardingResult,
      });

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

      if (autoBoardingResult.autoBoardedCount > 0) {
        io.to(communityRoom).emit('trip:passenger-boarded', {
          tripId: autoBoardingResult.trip?._id || null,
          shuttleId: shuttle._id,
          communityId: shuttle.communityId,
          boardedCount: autoBoardingResult.autoBoardedCount,
          passengersBoarded: autoBoardingResult.trip?.passengersBoarded || 0,
          revenueCollected: autoBoardingResult.trip?.revenueCollected || 0,
          currentCapacity: shuttle.currentCapacity,
          maxCapacity: shuttle.maxCapacity,
          source: 'auto-nearby-pickup',
        });

        for (const claimed of autoBoardingResult.claimedRequests) {
          io.to(communityRoom).emit('trip:pickup-claimed', {
            requestId: claimed.requestId,
            passengerId: claimed.passengerId,
            shuttleId: shuttle._id,
            tripId: autoBoardingResult.trip?._id || null,
            source: 'auto-nearby-pickup',
          });
        }
      }

      if (autoUnboardingResult.autoUnboardedCount > 0) {
        io.to(communityRoom).emit('trip:passenger-auto-unboarded', {
          tripId: autoUnboardingResult.activeTripId || null,
          shuttleId: shuttle._id,
          communityId: shuttle.communityId,
          unboardCount: autoUnboardingResult.autoUnboardedCount,
          currentCapacity: shuttle.currentCapacity,
          maxCapacity: shuttle.maxCapacity,
          rideIds: autoUnboardingResult.unboardedRideIds,
        });

        // DISPATCH: Seats freed by auto-unboard — retry waiting queue so queued passengers get dispatched
        setImmediate(() => {
          retryWaitingQueue(shuttle.communityId, io).catch((err) =>
            console.error('[updateShuttleLocation] retryWaitingQueue after auto-unboard error:', err)
          );
        });
      }

      return res.status(200).json({
        message: 'Location updated.',
        shuttle,
        autoBoardedCount: autoBoardingResult.autoBoardedCount,
        autoUnboardedCount: autoUnboardingResult.autoUnboardedCount,
        manualAutomationCooldownSeconds: manualAutomationCooldownRemainingMs > 0
          ? Math.ceil(manualAutomationCooldownRemainingMs / 1000)
          : 0,
        automationDiagnostics,
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
