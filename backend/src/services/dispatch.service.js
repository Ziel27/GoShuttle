/**
 * dispatch.service.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Taxi-style auto-dispatch engine for GoShuttle.
 *
 * Key invariant: a shuttle's "effective capacity" = currentCapacity + pendingPickupCount.
 * A seat is only considered available when effective capacity < maxCapacity.
 *
 * Priority bumping logic:
 *   - If a shuttle has physical space (currentCapacity < maxCapacity) but its
 *     effective capacity is full due to standard pending pickups, a priority
 *     request CAN displace one standard pending pickup from that shuttle.
 *   - The bumped standard request is immediately re-dispatched to the next
 *     nearest qualifying shuttle, or queued if none is available.
 */

'use strict';

const mongoose = require('mongoose');
const Shuttle = require('../models/Shuttle');
const PickupRequest = require('../models/PickupRequest');
const {
  normalizePhase,
  isShuttlePhaseCompatible,
  buildPhaseAwareRequestQuery,
} = require('../utils/phase');

// ─── Haversine distance (meters) ─────────────────────────────────────────────
const toRad = (deg) => (deg * Math.PI) / 180;

const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6_371_000; // Earth radius in metres
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ─── Load on-duty shuttles (GPS + capacity data) ──────────────────────────────
// pendingPickupCount is recomputed from live PickupRequest records on every call
// to prevent drift from expired / improperly-cancelled requests.
const loadOnDutyShuttles = async (communityId) => {
  const communityOid = mongoose.Types.ObjectId.isValid(communityId)
    ? new mongoose.Types.ObjectId(String(communityId))
    : communityId;

  const [shuttles, pendingAgg] = await Promise.all([
    Shuttle.find({
      communityId,
      isActive: true,
      status: { $in: ['idle', 'en_route'] },
      driverId: { $ne: null },
    })
      .select('_id driverId plateNumber label assignedPhase currentCapacity maxCapacity pendingPickupCount location status')
      .populate('driverId', '_id status')
      .lean(),

    // Count actual dispatched-but-not-yet-boarded requests per shuttle.
    // Exclude expired requests so stale records don't inflate the count.
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

  // Override the cached counter with the DB-accurate value
  return shuttles.map((s) => ({
    ...s,
    pendingPickupCount: actualPending[String(s._id)] ?? 0,
  }));
};

// ─── Atomically increment pendingPickupCount and return updated shuttle ───────
// Uses $set with an explicit target value (actualPending + 1) instead of $inc
// to avoid inheriting a drifted stored counter.
const reservePendingSlot = async (shuttleId, actualPending) => {
  return Shuttle.findByIdAndUpdate(
    shuttleId,
    { $set: { pendingPickupCount: actualPending + 1 } },
    { new: true, select: '_id driverId currentCapacity maxCapacity pendingPickupCount' }
  );
};

// ─── Atomically decrement pendingPickupCount (floor at 0) ────────────────────
const releasePendingSlot = async (shuttleId) => {
  return Shuttle.findOneAndUpdate(
    { _id: shuttleId, pendingPickupCount: { $gt: 0 } },
    { $inc: { pendingPickupCount: -1 } },
    { new: true }
  );
};

// ─── Emit dispatch events ─────────────────────────────────────────────────────
const emitDispatchEvents = (io, { communityId, pickupRequest, shuttle, driverId, fareExpected }) => {
  const communityRoom = `community:${String(communityId)}`;
  const passengerRoom = `user:${String(pickupRequest.passengerId)}`;
  const driverRoom = `user:${String(driverId)}`;

  const sharedPayload = {
    requestId: pickupRequest._id,
    passengerId: pickupRequest.passengerId,
    fareType: pickupRequest.fareType,
    fareExpected,
    pickupLabel: pickupRequest.pickupLabel || null,
    // Prefer explicit pickupLocation when present
    pickupLocation: pickupRequest.pickupLocation || null,
    location: pickupRequest.location,
    destinationType: pickupRequest.destinationType,
    destinationLabel: pickupRequest.destinationLabel,
    destinationLocation: pickupRequest.destinationLocation,
    expiresAt: pickupRequest.expiresAt,
    dispatchedAt: pickupRequest.dispatchedAt,
    passengerManifest: pickupRequest.passengerManifest || [],
    note: pickupRequest.note || null,
  };

  const shuttlePayload = {
    shuttleId: shuttle._id,
    plateNumber: shuttle.plateNumber || '',
    label: shuttle.label || '',
    location: shuttle.location,
    currentCapacity: shuttle.currentCapacity,
    maxCapacity: shuttle.maxCapacity,
    pendingPickupCount: shuttle.pendingPickupCount,
  };

  // Driver sees the new pickup job — same event name as passenger so the mobile
  // app's unified onDispatchPassengerAssigned handler fires for both roles.
  io.to(driverRoom).emit('dispatch:passenger-assigned', {
    ...sharedPayload,
    shuttle: shuttlePayload,
  });

  // Also broadcast to community room so other drivers update their view
  io.to(communityRoom).emit('dispatch:shuttle-pending-updated', {
    shuttleId: shuttle._id,
    pendingPickupCount: shuttle.pendingPickupCount,
  });

  // Passenger sees which shuttle is coming
  io.to(passengerRoom).emit('dispatch:passenger-assigned', {
    ...sharedPayload,
    shuttle: shuttlePayload,
  });
};

// ─── Emit waiting queue notice to passenger ───────────────────────────────────
const emitQueuedNotice = (io, { passengerId, requestId, queuePosition, fareType, fareExpected, queueReason }) => {
  const passengerRoom = `user:${String(passengerId)}`;
  io.to(passengerRoom).emit('dispatch:queued', {
    requestId,
    queuePosition,
    fareType,
    fareExpected,
    queueReason,
    message: queueReasonMessage(queueReason),
  });
};

// ─── Human-readable queue reason ─────────────────────────────────────────────
const queueReasonMessage = (reason) => {
  switch (reason) {
    case 'no_shuttles_on_duty':
      return 'No shuttles are currently on duty. You will be dispatched automatically when a driver starts their shift.';
    case 'all_shuttles_full':
      return 'All shuttles are currently full. You are in the queue and will be dispatched when a seat opens.';
    case 'no_shuttle_for_phase':
      return 'No shuttle is currently assigned to your area. You will be dispatched automatically when one becomes available.';
    case 'dispatch_race':
      return 'A seat was taken just as we tried to assign you. You are in the queue and will be dispatched shortly.';
    default:
      return 'You are in the queue and will be dispatched when a shuttle is available.';
  }
};

// ─── Bump one standard pending from a shuttle back to the queue ───────────────
/**
 * Finds the most recently dispatched standard PickupRequest on the given shuttle
 * and changes its status back to 'queued' so the priority request can claim the slot.
 * Returns the bumped request or null if nothing was bumped.
 */
const bumpOnePendingStandard = async (shuttleId, passengerHomePhase) => {
  const normalizedPassengerHomePhase = normalizePhase(passengerHomePhase);

  const bumped = await PickupRequest.findOneAndUpdate(
    {
      assignedShuttleId: shuttleId,
      status: 'dispatched',
      fareType: 'standard',
      ...buildPhaseAwareRequestQuery({
        shuttlePhase: normalizedPassengerHomePhase,
        passengerPhaseField: 'passengerHomePhase',
      }),
    },
    {
      $set: {
        status: 'queued',
        assignedShuttleId: null,
        assignedDriverId: null,
        dispatchedAt: null,
        queuePosition: 0,
      },
    },
    {
      sort: { dispatchedAt: -1 }, // bump the most recently dispatched standard
      new: true,
    }
  );

  if (bumped) {
    // Release the slot atomically
    await releasePendingSlot(shuttleId);
  }

  return bumped;
};

// ─── findAndDispatch ──────────────────────────────────────────────────────────
/**
 * Main dispatch function.
 *
 * @param {object} opts
 * @param {string|ObjectId} opts.communityId
 * @param {string|ObjectId} opts.passengerId
 * @param {{ coordinates: [number, number] }} opts.location  GeoJSON Point  [lng, lat]
 * @param {'standard'|'priority'} opts.fareType
 * @param {number} opts.fareExpected
 * @param {string|null} [opts.passengerHomePhase]
 * @param {object} opts.pickupRequest  The just-created PickupRequest document
 * @param {object} opts.io             Socket.io server instance
 *
 * @returns {{ dispatched: boolean, shuttle: object|null, queuePosition: number|null }}
 */
const findAndDispatch = async ({
  communityId,
  passengerId,
  location,
  fareType,
  fareExpected,
  passengerHomePhase,
  pickupRequest,
  io,
}) => {
  const normalizedPassengerHomePhase = normalizePhase(
    passengerHomePhase !== undefined ? passengerHomePhase : pickupRequest?.passengerHomePhase
  );

  // Prefer authoritative pickup coordinates when present on pickupRequest
  const pickupCoords = (pickupRequest && pickupRequest.pickupLocation && Array.isArray(pickupRequest.pickupLocation.coordinates) && pickupRequest.pickupLocation.coordinates.length === 2)
    ? pickupRequest.pickupLocation.coordinates
    : (location && Array.isArray(location.coordinates) ? location.coordinates : [0, 0]);

  const [passengerLng, passengerLat] = pickupCoords;
  const shuttles = await loadOnDutyShuttles(communityId);

  if (shuttles.length === 0) {
    return enqueueRequest({ pickupRequest, fareExpected, io, position: 0, queueReason: 'no_shuttles_on_duty' });
  }


  // Filter and sort shuttles — priority/standard differ in what "available" means
  const candidateShuttles = shuttles
    .filter((s) => {
      const driverOnShift = s.driverId?.status === 'driving';
      if (!driverOnShift) return false;

      if (!isShuttlePhaseCompatible({
        shuttlePhase: s.assignedPhase,
        passengerHomePhase: normalizedPassengerHomePhase,
      })) {
        return false;
      }

      const physicallyFull = s.currentCapacity >= s.maxCapacity;
      if (physicallyFull) return false; // priority can't displace when physically full

      if (fareType === 'standard') {
        // Standard: effective capacity must have room
        const effectiveFull = s.currentCapacity + s.pendingPickupCount >= s.maxCapacity;
        return !effectiveFull;
      }

      // Priority: physically available is enough (may bump standard pending)
      return true;
    })
    .map((s) => {
      const [sLng, sLat] = s.location?.coordinates || [0, 0];
      return {
        ...s,
        distanceMeters: haversineMeters(passengerLat, passengerLng, sLat, sLng),
        effectivelyFull: s.currentCapacity + s.pendingPickupCount >= s.maxCapacity,
      };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  if (candidateShuttles.length === 0) {
    const anyDriverOnShift = shuttles.some((s) => s.driverId?.status === 'driving');
    if (!anyDriverOnShift) {
      return enqueueRequest({ pickupRequest, fareExpected, io, position: 0, queueReason: 'no_shuttles_on_duty' });
    }
    // Distinguish: did shuttles fail phase check, or fail capacity check?
    const phaseCompatible = shuttles.filter((s) =>
      s.driverId?.status === 'driving' &&
      isShuttlePhaseCompatible({ shuttlePhase: s.assignedPhase, passengerHomePhase: normalizedPassengerHomePhase })
    );
    const queueReason = phaseCompatible.length === 0 ? 'no_shuttle_for_phase' : 'all_shuttles_full';
    return enqueueRequest({ pickupRequest, fareExpected, io, position: 0, queueReason });
  }


  // For priority: prefer shuttles that have a free effective slot; only bump if needed
  let targetShuttle = null;
  let bumpedRequest = null;

  if (fareType === 'priority') {
    // Try to find a shuttle with a free effective slot first (no bumping needed)
    targetShuttle = candidateShuttles.find((s) => !s.effectivelyFull) || null;

    if (!targetShuttle) {
      // All physically available shuttles are effectively full with standard pending.
      // Bump one standard pending from the nearest shuttle.
      const nearestCandidate = candidateShuttles[0];
      bumpedRequest = await bumpOnePendingStandard(nearestCandidate._id, normalizedPassengerHomePhase);
      if (bumpedRequest) {
        targetShuttle = nearestCandidate;
      }
    }
  } else {
    // Standard: just take the nearest with an effective slot
    targetShuttle = candidateShuttles.find((s) => !s.effectivelyFull) || null;
  }

  if (!targetShuttle) {
    return enqueueRequest({ pickupRequest, fareExpected, io, position: 0, queueReason: 'all_shuttles_full' });
  }


  // Atomically reserve the slot using the live pending count (not $inc)
  const updatedShuttle = await reservePendingSlot(targetShuttle._id, targetShuttle.pendingPickupCount);
  if (!updatedShuttle) {
    // Very unlikely race — shuttle was deleted between load and reserve
    return enqueueRequest({ pickupRequest, fareExpected, io, position: 0 });
  }

  // Safety check: ensure reserve didn't push us over capacity (race with another dispatch)
  if (updatedShuttle.currentCapacity + updatedShuttle.pendingPickupCount > updatedShuttle.maxCapacity) {
    // Roll back and queue
    await releasePendingSlot(updatedShuttle._id);
    return enqueueRequest({ pickupRequest, fareExpected, io, position: 0, queueReason: 'dispatch_race' });
  }


  const driverId = targetShuttle.driverId?._id || targetShuttle.driverId;

  // Materialize shuttle for event emission (merge updated counts)
  const shuttleForEmit = {
    ...targetShuttle,
    plateNumber: targetShuttle.plateNumber || '',
    label: targetShuttle.label || '',
    currentCapacity: updatedShuttle.currentCapacity,
    pendingPickupCount: updatedShuttle.pendingPickupCount,
  };

  // Mark the PickupRequest as dispatched
  await PickupRequest.findByIdAndUpdate(pickupRequest._id, {
    $set: {
      status: 'dispatched',
      assignedShuttleId: targetShuttle._id,
      assignedDriverId: driverId,
      dispatchedAt: new Date(),
      queuePosition: null,
      passengerHomePhase: normalizedPassengerHomePhase,
    },
  });

  // Refresh the request object with the assigned shuttle info for response
  pickupRequest.status = 'dispatched';
  pickupRequest.assignedShuttleId = targetShuttle._id;
  pickupRequest.assignedDriverId = driverId;
  pickupRequest.dispatchedAt = new Date();
  pickupRequest.passengerHomePhase = normalizedPassengerHomePhase;

  emitDispatchEvents(io, {
    communityId,
    pickupRequest,
    shuttle: shuttleForEmit,
    driverId,
    fareExpected,
  });

  // If we bumped a standard request, re-dispatch it now
  if (bumpedRequest) {
    setImmediate(() => {
      retryBumpedRequest({ bumpedRequest, communityId, io }).catch((err) => {
        console.error('[dispatch] Error re-dispatching bumped request:', err);
      });
    });
  }

  return {
    dispatched: true,
    shuttle: shuttleForEmit,
    queuePosition: null,
  };
};

// ─── enqueueRequest ───────────────────────────────────────────────────────────
/**
 * Puts a PickupRequest into the waiting queue when no driver is available.
 */
const enqueueRequest = async ({ pickupRequest, fareExpected, io, position, queueReason }) => {
  const queuePosition = typeof position === 'number' ? position : 0;

  await PickupRequest.findByIdAndUpdate(pickupRequest._id, {
    $set: {
      status: 'queued',
      queuePosition,
    },
  });

  emitQueuedNotice(io, {
    passengerId: pickupRequest.passengerId,
    requestId: pickupRequest._id,
    queuePosition,
    fareType: pickupRequest.fareType,
    fareExpected,
    queueReason: queueReason || 'all_shuttles_full',
  });

  return { dispatched: false, shuttle: null, queuePosition, queueReason: queueReason || 'all_shuttles_full' };
};


// ─── retryBumpedRequest ───────────────────────────────────────────────────────
/**
 * After a standard request is bumped by a priority, try to re-dispatch it.
 * Loads from DB to ensure we have fresh data.
 */
const retryBumpedRequest = async ({ bumpedRequest, communityId, io }) => {
  // Reload to check it's still in a re-dispatchable state
  const fresh = await PickupRequest.findById(bumpedRequest._id);
  if (!fresh || !['queued', 'pending'].includes(fresh.status)) return;
  if (fresh.expiresAt && new Date(fresh.expiresAt) <= new Date()) return;

  // Fetch community baseFare — we need fare for emitting
  const Community = require('../models/Community');
  const community = await Community.findById(communityId).select('baseFare priorityFareMultiplier').lean();
  const fareExpected = community?.baseFare ?? 0;

  await findAndDispatch({
    communityId,
    passengerId: fresh.passengerId,
    location: fresh.location,
    fareType: 'standard',
    fareExpected,
    passengerHomePhase: fresh.passengerHomePhase,
    pickupRequest: fresh,
    io,
  });
};

// ─── retryWaitingQueue ────────────────────────────────────────────────────────
/**
 * Called when a shuttle seat becomes free (unboard, cancel, shift-end).
 * Processes the waiting queue in priority-first, FIFO order.
 *
 * @param {string|ObjectId} communityId
 * @param {object} io Socket.io server instance
 * @param {number} [maxRetries=3] Max passengers to dispatch in one call
 */
const retryWaitingQueue = async (communityId, io, maxRetries = 3) => {
  try {
    const Community = require('../models/Community');
    const community = await Community.findById(communityId).select('baseFare priorityFareMultiplier').lean();
    if (!community) return;

    const now = new Date();

    // Fetch queued requests: priority first, then FIFO
    const queuedRequests = await PickupRequest.find({
      communityId,
      status: 'queued',
      expiresAt: { $gt: now },
    })
      .sort({ fareType: 1, createdAt: 1 }) // 'priority' < 'standard' alphabetically — ascending puts priority first
      .limit(maxRetries)
      .lean();

    for (const req of queuedRequests) {
      const fareExpected =
        req.fareType === 'priority'
          ? Number(((community.baseFare ?? 0) * (community.priorityFareMultiplier ?? 1.5)).toFixed(2))
          : (community.baseFare ?? 0);

      // Attempt dispatch — if no shuttle available, stop retrying (queue remains)
      const result = await findAndDispatch({
        communityId,
        passengerId: req.passengerId,
        location: req.location,
        fareType: req.fareType,
        fareExpected,
        passengerHomePhase: req.passengerHomePhase,
        pickupRequest: req,
        io,
      });

      if (!result.dispatched) break; // No driver available — stop here
    }
  } catch (err) {
    console.error('[dispatch] retryWaitingQueue error:', err);
  }
};

// ─── releaseAndRetry ──────────────────────────────────────────────────────────
/**
 * Convenience: release a pending slot from a specific pickup request on cancel/board,
 * then trigger queue retry.
 *
 * @param {object} opts
 * @param {string|ObjectId} opts.pickupRequestId  The PickupRequest that was resolved
 * @param {string|ObjectId} opts.communityId
 * @param {object} opts.io
 */
const releaseAndRetry = async ({ pickupRequestId, communityId, io }) => {
  try {
    const req = await PickupRequest.findById(pickupRequestId).select('assignedShuttleId status').lean();
    if (req?.assignedShuttleId && req.status === 'dispatched') {
      await releasePendingSlot(req.assignedShuttleId);
    }
    await retryWaitingQueue(communityId, io);
  } catch (err) {
    console.error('[dispatch] releaseAndRetry error:', err);
  }
};

module.exports = {
  findAndDispatch,
  retryWaitingQueue,
  releaseAndRetry,
  releasePendingSlot,
  haversineMeters,
};
