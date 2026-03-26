const Community = require('../models/Community');

/**
 * Returns true when a coordinate is inside (or on the border of) the community polygon.
 */
const isLocationInBoundary = async ({ communityId, latitude, longitude }) => {
  const match = await Community.findOne({
    _id: communityId,
    boundaries: {
      $geoIntersects: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude],
        },
      },
    },
  }).select('_id');

  return Boolean(match);
};

module.exports = { isLocationInBoundary };
