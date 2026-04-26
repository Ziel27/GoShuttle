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

  // Phase-assigned shuttles can only serve matching passenger phases.
  return Boolean(normalizedPassengerPhase) && normalizedShuttlePhase === normalizedPassengerPhase;
};

const buildPhaseAwareRequestQuery = ({ shuttlePhase, passengerPhaseField = 'passengerHomePhase' }) => {
  const normalizedShuttlePhase = normalizePhase(shuttlePhase);
  if (!normalizedShuttlePhase) return {};

  return {
    [passengerPhaseField]: normalizedShuttlePhase,
  };
};

module.exports = {
  normalizePhase,
  isShuttlePhaseCompatible,
  buildPhaseAwareRequestQuery,
};