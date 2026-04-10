/** Format a number as a monetary value with 2 decimal places. Returns '0.00' for non-finite inputs. */
export const formatMoney = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(2) : '0.00';

/** Format a coordinate pair to a fixed number of decimal places. */
export const formatCoordinate = (lat: number, lng: number, precision = 4): string =>
  `${lat.toFixed(precision)}, ${lng.toFixed(precision)}`;
