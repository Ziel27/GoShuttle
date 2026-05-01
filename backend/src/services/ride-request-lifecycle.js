const RideRequest = require('../models/RideRequest');

const completeRideRequestsForPassengers = async ({
  tripId,
  passengerIds,
  rideRequestIds,
  completedAt = new Date(),
  session,
}) => {
  // Accept either a set of passengerIds (legacy) or explicit rideRequestIds for guest/manifest flows.
  const query = { status: 'boarded' };

  if (Array.isArray(rideRequestIds) && rideRequestIds.length > 0) {
    query._id = { $in: rideRequestIds };
  } else if (Array.isArray(passengerIds) && passengerIds.length > 0) {
    if (!tripId) return { matchedCount: 0 };
    query.tripId = tripId;
    query.passengerId = { $in: passengerIds };
  } else {
    return { matchedCount: 0 };
  }

  const result = await RideRequest.updateMany(
    query,
    {
      $set: {
        status: 'completed',
        completedAt,
      },
    },
    session ? { session } : undefined
  );

  return result || { matchedCount: 0 };
};

module.exports = { completeRideRequestsForPassengers };