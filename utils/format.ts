/**
 * Format a number as a monetary value with 2 decimal places. Returns '0.00' for non-finite inputs.
 * @param {number} value - The number to format.
 * @returns {string} The formatted monetary value.
 */
export const formatMoney = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(2) : '0.00';
