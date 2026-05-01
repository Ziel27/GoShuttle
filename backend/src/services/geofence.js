const Community = require('../models/Community');

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Ray-casting point-in-polygon test.
 * Returns true when (lat, lng) falls inside the given polygon ring.
 *
 * @param {number} lat  — latitude of the point
 * @param {lng} lng     — longitude of the point
 * @param {Array<[number, number]>} ring — GeoJSON coordinate ring [[lng, lat], …]
 * @returns {boolean}
 */
function pointInPolygon(lat, lng, ring) {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; // [lng, lat]
    const [xj, yj] = ring[j];

    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function distanceMeters(from, to) {
  if (!from || !to) return Number.POSITIVE_INFINITY;

  const fromLat = Number(from.latitude);
  const fromLng = Number(from.longitude);
  const toLat = Number(to.latitude);
  const toLng = Number(to.longitude);

  if (
    !Number.isFinite(fromLat) ||
    !Number.isFinite(fromLng) ||
    !Number.isFinite(toLat) ||
    !Number.isFinite(toLng)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Check whether a given (latitude, longitude) is inside the polygon
 * boundary of the specified community.
 *
 * Returns `true` when the community has no boundary defined (open community).
 *
 * @param {{ communityId: string, latitude: number, longitude: number }} opts
 * @returns {Promise<boolean>}
 */
async function isLocationInBoundary({ communityId, latitude, longitude }) {
  const community = await Community.findById(communityId)
    .select('boundaries')
    .lean();

  if (!community) return false;

  const ring = community.boundaries?.coordinates?.[0];

  // Missing geofence should deny by default to avoid accidental boundary bypass.
  const allowOpenBoundary = process.env.ALLOW_OPEN_BOUNDARY === 'true';
  if (!ring || ring.length < 4) return allowOpenBoundary;

  return pointInPolygon(latitude, longitude, ring);
}

module.exports = { distanceMeters, isLocationInBoundary, pointInPolygon };
