'use strict';

const normalizePhase = (value) => {
  if (value === undefined || value === null) return null;

  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

  return normalized || null;
};

const isShuttlePhaseCompatible = ({ shuttlePhase, passengerHomePhase }) => {
  const normalizedShuttlePhase = normalizePhase(shuttlePhase);
  const normalizedPassengerPhase = normalizePhase(passengerHomePhase);

  // Unassigned shuttles can serve all requests.
  if (!normalizedShuttlePhase) {
    return true;
  }

  // Passengers with no detected/saved phase can be served by any shuttle.
  if (!normalizedPassengerPhase) return true;

  // Phase-assigned shuttles can only serve matching passenger phases.
  return normalizedShuttlePhase === normalizedPassengerPhase;
};

const buildPhaseAwareRequestQuery = ({ shuttlePhase, passengerPhaseField = 'passengerHomePhase' }) => {
  const normalizedShuttlePhase = normalizePhase(shuttlePhase);
  if (!normalizedShuttlePhase) return {};

  // Include requests with matching phase AND requests with no phase set
  // (null-phase passengers can be served by any shuttle).
  return {
    $or: [
      { [passengerPhaseField]: normalizedShuttlePhase },
      { [passengerPhaseField]: null },
    ],
  };
};

module.exports = {
  normalizePhase,
  isShuttlePhaseCompatible,
  buildPhaseAwareRequestQuery,
};