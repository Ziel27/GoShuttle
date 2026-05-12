/**
 * Format a number as a monetary value with 2 decimal places. Returns '0.00' for non-finite inputs.
 * @param {number} value - The number to format.
 * @returns {string} The formatted monetary value.
 */
export const formatMoney = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(2) : '0.00';

/**
 * Format a phase name into a human-readable "Phase X" label.
 * e.g. "phase_1" → "Phase 1", "phase1" → "Phase 1", "1" → "Phase 1"
 */
export const formatPhaseLabel = (phase?: string | null): string => {
  if (!phase) return 'All phases';
  const cleaned = phase.replace(/_/g, ' ').trim();
  const lower = cleaned.toLowerCase();
  if (lower.startsWith('phase ')) return 'Phase ' + cleaned.slice(6);
  return 'Phase ' + cleaned;
};

/**
 * Format a shuttle label into "Electric X" display format.
 * If no label is provided, falls back to the plate number.
 */
export const formatShuttleLabel = (label?: string | null, plateNumber?: string | null): string => {
  if (label) return `Electric ${label}`;
  return plateNumber || 'Shuttle';
};
