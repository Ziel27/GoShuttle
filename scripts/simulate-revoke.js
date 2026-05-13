// Simulate the discount revocation flow without database operations.
// Mirrors backend/src/controllers/discount.controller.js logic for demonstration.

const simulateRevoke = ({ ride, currentUser }) => {
  // Authorization: must be driver
  if (currentUser.role !== 'driver') {
    throw new Error('Only drivers can revoke discounts.');
  }

  // Ownership check
  if (String(ride.driverId) !== String(currentUser._id)) {
    throw new Error('Access denied. This ride is not on your trip.');
  }

  if (ride.status !== 'boarded') {
    throw new Error('Can only revoke discount for currently boarded passengers.');
  }

  if (ride.discountType === 'none' || !ride.originalFare) {
    throw new Error('This passenger has no active discount to revoke.');
  }

  if (ride.discountRevoked) {
    throw new Error('Discount has already been revoked for this passenger.');
  }

  const fareDifference = ride.originalFare - ride.fareAtBoarding;

  // Apply changes
  ride.discountRevoked = true;
  ride.discountRevokedAt = new Date();
  ride.discountRevokedBy = currentUser._id;
  ride.fareAtBoarding = ride.originalFare;

  // Simulate updating trip revenue
  const trip = { _id: ride.tripId, revenueCollected: ride.tripRevenueInitial || 0 };
  if (fareDifference > 0) {
    trip.revenueCollected += fareDifference;
  }

  // Simulate socket payload
  const payload = {
    rideId: ride._id,
    passengerId: ride.passengerId,
    passengerName: ride.passengerName,
    tripId: ride.tripId,
    fareDifference,
    newFare: ride.fareAtBoarding,
  };

  return { ride, trip, payload };
};

// Demo data
const ride = {
  _id: 'ride-100',
  passengerId: 'pass-1',
  passengerName: 'Alex Rider',
  tripId: 'trip-50',
  driverId: 'driver-42',
  status: 'boarded',
  discountType: 'student',
  originalFare: 50.0,
  fareAtBoarding: 30.0, // discounted
  discountRevoked: false,
  tripRevenueInitial: 500.0,
};

const currentUser = { _id: 'driver-42', role: 'driver' };

try {
  const { ride: updatedRide, trip, payload } = simulateRevoke({ ride, currentUser });
  console.log('Revoke simulation successful.');
  console.log('Updated ride:', JSON.stringify(updatedRide, null, 2));
  console.log('Updated trip revenue:', trip.revenueCollected);
  console.log('Emitted socket payload:', JSON.stringify(payload, null, 2));
} catch (err) {
  console.error('Simulation error:', err.message);
  process.exit(1);
}
