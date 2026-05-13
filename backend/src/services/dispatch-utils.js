'use strict';

const { isShuttlePhaseCompatible } = require('../utils/phase');

/**
 * Compute driver ids whose shuttle can fully accommodate the pickupRequest.
 *
 * @param {Array} shuttles  Array of shuttle objects (lean) with populated driverId
 * @param {Array} pendingAgg Aggregation result [{ _id: shuttleId, count }]
 * @param {Object} pickupRequest  The pickup request document
 * @returns {Array} Array of driver ids (string/ObjectId) eligible
 */
const computeEligibleDriverIds = ({ shuttles, pendingAgg, pickupRequest }) => {
  const passengerCount = Array.isArray(pickupRequest.passengerManifest) && pickupRequest.passengerManifest.length > 0
    ? pickupRequest.passengerManifest.length
    : 1;

  const actualPending = {};
  for (const { _id, count } of pendingAgg || []) {
    actualPending[String(_id)] = count;
  }

  const eligible = [];
  for (const s of shuttles || []) {
    const driver = s.driverId;
    if (!driver) continue;
    const driverStatus = driver.status || (typeof driver === 'object' && driver._id ? (driver.status || null) : null);
    if (driverStatus !== 'driving') continue;

    if (!isShuttlePhaseCompatible({ shuttlePhase: s.assignedPhase, passengerHomePhase: pickupRequest.passengerHomePhase })) {
      continue;
    }

    const pending = actualPending[String(s._id)] ?? 0;
    const availableSeats = (s.maxCapacity || 0) - ((s.currentCapacity || 0) + pending);
    if (availableSeats < passengerCount) continue;

    eligible.push(driver._id || driver);
  }

  return eligible;
};

module.exports = {
  computeEligibleDriverIds,
};
