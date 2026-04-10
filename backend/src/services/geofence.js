const Community = require('../models/Community');

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

module.exports = { isLocationInBoundary, pointInPolygon };
