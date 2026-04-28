const DEFAULT_MANUAL_AUTOMATION_COOLDOWN_MS = 15_000;

const parseDuration = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const MANUAL_AUTOMATION_COOLDOWN_MS = parseDuration(
  process.env.MANUAL_AUTOMATION_COOLDOWN_MS,
  DEFAULT_MANUAL_AUTOMATION_COOLDOWN_MS
);
const AUTOMATION_COOLDOWN_SWEEP_MS = 10 * 60 * 1000;

// NOTE: In-memory cooldown map. For multi-instance deployments, migrate this to Redis.
const manualAutomationCooldownByShuttleId = new Map();

const toShuttleKey = (shuttleId) => (shuttleId ? String(shuttleId) : '');

const startManualAutomationCooldown = (
  shuttleId,
  durationMs = MANUAL_AUTOMATION_COOLDOWN_MS
) => {
  const key = toShuttleKey(shuttleId);
  if (!key) return 0;

  const safeDuration = parseDuration(durationMs, MANUAL_AUTOMATION_COOLDOWN_MS);
  const cooldownUntil = Date.now() + safeDuration;
  manualAutomationCooldownByShuttleId.set(key, cooldownUntil);
  return cooldownUntil;
};

const getManualAutomationCooldownRemainingMs = (shuttleId) => {
  const key = toShuttleKey(shuttleId);
  if (!key) return 0;

  const cooldownUntil = manualAutomationCooldownByShuttleId.get(key);
  if (!cooldownUntil) return 0;

  const remainingMs = cooldownUntil - Date.now();
  if (remainingMs <= 0) {
    manualAutomationCooldownByShuttleId.delete(key);
    return 0;
  }

  return remainingMs;
};

const clearManualAutomationCooldown = (shuttleId) => {
  const key = toShuttleKey(shuttleId);
  if (!key) return;
  manualAutomationCooldownByShuttleId.delete(key);
};

const pruneExpiredAutomationCooldowns = () => {
  const now = Date.now();

  for (const [key, cooldownUntil] of manualAutomationCooldownByShuttleId.entries()) {
    if (cooldownUntil <= now) {
      manualAutomationCooldownByShuttleId.delete(key);
    }
  }
};

if (process.env.NODE_ENV !== 'test') {
  const timer = setInterval(pruneExpiredAutomationCooldowns, AUTOMATION_COOLDOWN_SWEEP_MS);
  timer.unref?.();
}

module.exports = {
  MANUAL_AUTOMATION_COOLDOWN_MS,
  startManualAutomationCooldown,
  getManualAutomationCooldownRemainingMs,
  clearManualAutomationCooldown,
  pruneExpiredAutomationCooldowns,
};