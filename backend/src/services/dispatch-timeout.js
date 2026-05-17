'use strict';

/**
 * dispatch-timeout.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Background job: re-queues dispatched PickupRequests that the assigned driver
 * has not acknowledged (claimed/boarded) within DISPATCH_ACK_TIMEOUT_MS.
 *
 * Flow:
 *   1. Find all 'dispatched' requests whose dispatchedAt is older than the timeout.
 *   2. For each stale request:
 *      a. Release the pending capacity slot on the assigned shuttle.
 *      b. Reset status to 'pending' and clear assignment fields.
 *      c. Notify the old driver (dispatch:timeout) so their UI clears.
 *      d. Re-broadcast the request to the community (trip:pickup-intent).
 *      e. Attempt immediate re-dispatch to the next available driver.
 */

const PickupRequest = require('../models/PickupRequest');
const Community = require('../models/Community');
const { releasePendingSlot, findAndDispatch } = require('./dispatch.service');

const DISPATCH_ACK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const JOB_INTERVAL_MS = 30 * 1000;              // check every 30 seconds
const MAX_PER_RUN = 20;                          // safety cap per cycle

let _timer = null;

const runDispatchTimeoutCheck = async (io) => {
  try {
    const cutoff = new Date(Date.now() - DISPATCH_ACK_TIMEOUT_MS);

    const stale = await PickupRequest.find({
      status: 'dispatched',
      dispatchedAt: { $lt: cutoff },
      expiresAt: { $gt: new Date() },
    })
      .limit(MAX_PER_RUN)
      .lean();

    if (stale.length === 0) return;

    for (const req of stale) {
      try {
        const shuttleId = req.assignedShuttleId;
        const driverId  = req.assignedDriverId;
        const communityId = String(req.communityId);

        // 1. Release the reserved capacity slot on the shuttle (best-effort)
        if (shuttleId) {
          await releasePendingSlot(shuttleId).catch(() => {});
        }

        // 2. Reset to 'pending' and clear dispatch fields
        await PickupRequest.findByIdAndUpdate(req._id, {
          $set: {
            status: 'pending',
            assignedShuttleId: null,
            assignedDriverId: null,
            dispatchedAt: null,
          },
        });

        // 3. Tell the previously-assigned driver their assignment was revoked
        if (driverId && io) {
          io.to(`user:${String(driverId)}`).emit('dispatch:timeout', {
            requestId: req._id,
            message: 'Pickup assignment expired. The request has been re-queued.',
          });
        }

        // 4. Re-broadcast the request to the community so all drivers see it again
        if (io) {
          io.to(`community:${communityId}`).emit('trip:pickup-intent', {
            requestId: req._id,
            communityId: req.communityId,
            passengerId: req.passengerId,
            bookingOwner: req.bookingOwner || req.passengerId,
            pickupLocation: req.pickupLocation || null,
            pickupLabel: req.pickupLabel || null,
            location: req.location,
            destinationType: req.destinationType,
            destinationLabel: req.destinationLabel,
            destinationLocation: req.destinationLocation,
            passengerHomePhase: req.passengerHomePhase,
            fareType: req.fareType,
            fareExpected: null,
            expiresAt: req.expiresAt,
            status: 'pending',
            passengerManifest: Array.isArray(req.passengerManifest) ? req.passengerManifest : [],
            note: req.note || null,
            trackingToken: req.trackingToken || null,
            trackingUrl: null,
            assignedShuttleId: null,
          });
        }

        // 5. Attempt immediate re-dispatch
        const community = await Community.findById(communityId)
          .select('baseFare priorityFareMultiplier')
          .lean();

        if (community) {
          const fareExpected = req.fareType === 'priority'
            ? Number(((community.baseFare ?? 0) * (community.priorityFareMultiplier ?? 1.5)).toFixed(2))
            : (community.baseFare ?? 0);

          const fresh = await PickupRequest.findById(req._id);
          if (fresh && fresh.status === 'pending') {
            await findAndDispatch({
              communityId,
              passengerId: req.passengerId,
              location: req.location,
              fareType: req.fareType,
              fareExpected,
              passengerHomePhase: req.passengerHomePhase,
              pickupRequest: fresh,
              io,
            }).catch((err) => {
              console.error('[dispatch-timeout] re-dispatch error:', err);
            });
          }
        }

        console.log(`[dispatch-timeout] Re-queued stale dispatch: requestId=${req._id} driverId=${driverId}`);
      } catch (innerErr) {
        console.error(`[dispatch-timeout] Error processing requestId=${req._id}:`, innerErr);
      }
    }
  } catch (err) {
    console.error('[dispatch-timeout] Job error:', err);
  }
};

const startDispatchTimeoutJob = (io) => {
  if (_timer) return;
  _timer = setInterval(() => {
    runDispatchTimeoutCheck(io).catch((err) => {
      console.error('[dispatch-timeout] Unhandled error in job:', err);
    });
  }, JOB_INTERVAL_MS);

  console.log(`[dispatch-timeout] Job started — timeout=${DISPATCH_ACK_TIMEOUT_MS / 1000}s, interval=${JOB_INTERVAL_MS / 1000}s`);
};

const stopDispatchTimeoutJob = () => {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
};

module.exports = { startDispatchTimeoutJob, stopDispatchTimeoutJob };
