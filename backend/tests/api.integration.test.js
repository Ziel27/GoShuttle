process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Community = require('../src/models/Community');
const User = require('../src/models/User');
const Shuttle = require('../src/models/Shuttle');
const Trip = require('../src/models/Trip');
const PassengerRide = require('../src/models/PassengerRide');
const PickupRequest = require('../src/models/PickupRequest');
const ShiftRemittance = require('../src/models/ShiftRemittance');
const RideRequest = require('../src/models/RideRequest');
const { clearManualAutomationCooldown } = require('../src/services/automation-cooldown');
const { app } = require('../src/server');

// Minimal JPEG bytes (SOI ... EOI) for multipart upload tests
const dummyReceiptJpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

let mongod;
let adminUser;
let adminToken;
let driverUser;
let driverToken;
let passengerToken;
let community;
let shuttle;
let completedTrip;
let submittedRemittance;
let pickupIntentId;

const polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [121.0, 14.5],
      [121.1, 14.5],
      [121.1, 14.6],
      [121.0, 14.6],
      [121.0, 14.5],
    ],
  ],
};

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGO_URI = uri;

  await mongoose.connect(uri);

  community = await Community.create({
    name: 'Test Village',
    boundaries: polygon,
    baseFare: 20,
  });

  adminUser = await User.create({
    firstName: 'Admin',
    lastName: 'Tester',
    email: 'admin@test.local',
    password: 'Password123!',
    role: 'admin',
    communityId: community._id,
    status: 'active',
  });
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

test('GET /api/health returns service status', async () => {
  const response = await request(app).get('/api/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.service, 'GoShuttle API');
});

test('POST /api/auth/login returns admin JWT token', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({
      email: adminUser.email,
      password: 'Password123!',
    });

  assert.equal(response.status, 200);
  assert.ok(response.body.token);
  assert.equal(response.body.user.email, adminUser.email);

  adminToken = response.body.token;
});

test('GET /api/communities lists active communities', async () => {
  const response = await request(app).get('/api/communities');

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.communities));
  assert.equal(response.body.communities.length, 1);
  assert.equal(response.body.communities[0].name, 'Test Village');
});

test('POST /api/auth/register creates a passenger account', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      firstName: 'Passenger',
      lastName: 'One',
      email: 'passenger@test.local',
      password: 'Password123!',
      communityId: String(community._id),
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.user.role, 'passenger');
  assert.ok(response.body.token);

  passengerToken = response.body.token;
});

test('POST /api/users creates a driver account as admin', async () => {
  const response = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      firstName: 'Driver',
      lastName: 'One',
      email: 'driver@test.local',
      password: 'Password123!',
      role: 'driver',
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.user.role, 'driver');

  driverUser = await User.findOne({ email: 'driver@test.local' });
  assert.ok(driverUser);
});

test('POST /api/auth/login returns token for created driver', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'driver@test.local',
      password: 'Password123!',
    });

  assert.equal(response.status, 200);
  assert.ok(response.body.token);

  driverToken = response.body.token;
});

test('POST /api/shuttles creates a shuttle for admin community', async () => {
  const response = await request(app)
    .post('/api/shuttles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      plateNumber: 'TST-101',
      maxCapacity: 12,
      label: 'Shuttle A',
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.shuttle.maxCapacity, 12);

  shuttle = await Shuttle.findById(response.body.shuttle._id);
  assert.ok(shuttle);

  shuttle.driverId = driverUser._id;
  await shuttle.save();
});

test('PUT /api/shuttles/:id/location accepts in-bound GPS coordinate', async () => {
  const response = await request(app)
    .put(`/api/shuttles/${shuttle._id}/location`)
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ latitude: 14.55, longitude: 121.05 });

  assert.equal(response.status, 200);
  assert.equal(response.body.shuttle.status, 'en_route');
  assert.deepEqual(response.body.shuttle.location.coordinates, [121.05, 14.55]);
});

test('PUT /api/shuttles/:id/location rejects out-of-bound GPS coordinate', async () => {
  const response = await request(app)
    .put(`/api/shuttles/${shuttle._id}/location`)
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ latitude: 15.2, longitude: 122.2 });

  assert.equal(response.status, 403);
  assert.match(response.body.error, /outside the community boundary/i);

  const dbShuttle = await Shuttle.findById(shuttle._id);
  assert.equal(dbShuttle.status, 'out_of_bounds');
});

test('POST /api/trips/passenger-board increments trip and shuttle capacity', async () => {
  const response = await request(app)
    .post('/api/trips/passenger-board')
    .set('Authorization', `Bearer ${driverToken}`)
    .send({
      shuttleId: String(shuttle._id),
      boardedCount: 2,
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.trip.passengersBoarded, 2);
  assert.equal(response.body.trip.revenueCollected, 40);
  assert.equal(response.body.shuttle.currentCapacity, 2);
});

test('POST /api/trips/shift-end completes active trip and resets shuttle capacity', async () => {
  const response = await request(app)
    .post('/api/trips/shift-end')
    .set('Authorization', `Bearer ${driverToken}`)
    .send({
      shuttleId: String(shuttle._id),
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.summary.passengersBoarded, 2);
  assert.equal(response.body.summary.revenueCollected, 40);

  const dbShuttle = await Shuttle.findById(shuttle._id);
  assert.equal(dbShuttle.currentCapacity, 0);
  assert.equal(dbShuttle.status, 'idle');

  completedTrip = await Trip.findById(response.body.summary.tripId);
  assert.ok(completedTrip);
});

test('POST /api/trips/:tripId/remittance allows driver remittance submission', async () => {
  const response = await request(app)
    .post(`/api/trips/${completedTrip._id}/remittance`)
    .set('Authorization', `Bearer ${driverToken}`)
    .field('actualAmount', '40')
    .field('driverNote', 'Cash handed over at end of shift.')
    .attach('receipt', dummyReceiptJpg, { filename: 'receipt.jpg', contentType: 'image/jpeg' });

  assert.equal(response.status, 200);
  assert.equal(response.body.remittance.expectedAmount, 40);
  assert.equal(response.body.remittance.actualAmount, 40);
  assert.equal(response.body.remittance.varianceAmount, 0);
  assert.equal(response.body.remittance.status, 'pending');
  assert.ok(response.body.remittance.receiptUrl);

  submittedRemittance = await ShiftRemittance.findById(response.body.remittance._id);
  assert.ok(submittedRemittance);
});

test('POST /api/trips/:tripId/remittance rejects duplicate submission', async () => {
  const response = await request(app)
    .post(`/api/trips/${completedTrip._id}/remittance`)
    .set('Authorization', `Bearer ${driverToken}`)
    .field('actualAmount', '40')
    .field('driverNote', 'Second submission should be rejected.')
    .attach('receipt', dummyReceiptJpg, { filename: 'receipt.jpg', contentType: 'image/jpeg' });

  assert.equal(response.status, 409);
  assert.match(response.body.error, /already submitted/i);
});

test('GET /api/trips/analytics returns community totals for admin', async () => {
  const response = await request(app)
    .get('/api/trips/analytics')
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(response.status, 200);
  assert.ok(response.body.totals);
  assert.equal(response.body.totals.totalPassengers, 2);
  assert.equal(response.body.totals.totalRevenue, 40);

  const tripCount = await Trip.countDocuments({ communityId: community._id });
  assert.ok(tripCount >= 1);
});

test('PATCH /api/shuttles/:id/assign-driver assigns driver to shuttle as admin', async () => {
  const response = await request(app)
    .patch(`/api/shuttles/${shuttle._id}/assign-driver`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ driverId: String(driverUser._id) });

  assert.equal(response.status, 200);
  assert.equal(String(response.body.shuttle.driverId._id), String(driverUser._id));
});

test('GET /api/trips/driver-analytics returns grouped metrics by driver', async () => {
  const response = await request(app)
    .get('/api/trips/driver-analytics')
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.drivers));
  assert.ok(response.body.drivers.length >= 1);
  assert.equal(response.body.drivers[0].tripCount >= 1, true);
  assert.equal(response.body.drivers[0].totalPassengers >= 2, true);
});

test('GET /api/trips/remittance-summary returns expected vs remitted totals', async () => {
  const response = await request(app)
    .get('/api/trips/remittance-summary')
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.totals.expectedAmount, 40);
  assert.equal(response.body.totals.actualAmount, 40);
  assert.equal(response.body.totals.varianceAmount, 0);
  assert.equal(response.body.totals.pendingCount, 1);
  assert.equal(response.body.totals.missingCount, 0);
  assert.equal(response.body.totals.missingExpectedAmount, 0);
  assert.ok(Array.isArray(response.body.series));
  assert.ok(Array.isArray(response.body.drivers));
  assert.ok(Array.isArray(response.body.missingByDriver));
});

test('PATCH /api/trips/remittances/:id/verify marks remittance as verified', async () => {
  const response = await request(app)
    .patch(`/api/trips/remittances/${submittedRemittance._id}/verify`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'verified', adminNote: 'Cash count matched expected fare.' });

  assert.equal(response.status, 200);
  assert.equal(response.body.remittance.status, 'verified');
  assert.equal(response.body.remittance.adminNote, 'Cash count matched expected fare.');
});

test('POST /api/trips/pickup-intent creates a passenger pickup pin', async () => {
  const response = await request(app)
    .post('/api/trips/pickup-intent')
    .set('Authorization', `Bearer ${passengerToken}`)
    .send({ latitude: 14.551, longitude: 121.052 });

  assert.equal(response.status, 201);
  assert.equal(response.body.request.status, 'pending');
  assert.deepEqual(response.body.request.location.coordinates, [121.052, 14.551]);
  pickupIntentId = response.body.request._id;
});

test('DELETE /api/trips/pickup-intent/:intentId lets passenger cancel own pending intent', async () => {
  const response = await request(app)
    .delete(`/api/trips/pickup-intent/${pickupIntentId}`)
    .set('Authorization', `Bearer ${passengerToken}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.request.status, 'cancelled');
});

test('DELETE /api/trips/pickup-intent/:intentId rejects non-pending cancellations', async () => {
  const response = await request(app)
    .delete(`/api/trips/pickup-intent/${pickupIntentId}`)
    .set('Authorization', `Bearer ${passengerToken}`);

  assert.equal(response.status, 409);
  assert.match(response.body.error, /only pending requests can be cancelled/i);
});

test('DELETE /api/trips/pickup-intent/:intentId lets admin cancel passenger intent', async () => {
  const createResponse = await request(app)
    .post('/api/trips/pickup-intent')
    .set('Authorization', `Bearer ${passengerToken}`)
    .send({ latitude: 14.552, longitude: 121.053 });

  assert.equal(createResponse.status, 201);

  const response = await request(app)
    .delete(`/api/trips/pickup-intent/${createResponse.body.request._id}`)
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.request.status, 'cancelled');
});

test('GET /api/trips/pickup-intents returns active demand pins for driver', async () => {
  const seedResponse = await request(app)
    .post('/api/trips/pickup-intent')
    .set('Authorization', `Bearer ${passengerToken}`)
    .send({ latitude: 14.553, longitude: 121.054 });

  assert.equal(seedResponse.status, 201);

  const response = await request(app)
    .get('/api/trips/pickup-intents')
    .set('Authorization', `Bearer ${driverToken}`);

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.requests));
  assert.ok(response.body.requests.length >= 1);
  assert.equal(response.body.requests[0].status, 'pending');
});

test('PUT /api/shuttles/:id/location suppresses auto-boarding immediately after manual board', async () => {
  clearManualAutomationCooldown(shuttle._id);

  await User.findByIdAndUpdate(driverUser._id, { status: 'driving' });
  await Shuttle.findByIdAndUpdate(shuttle._id, {
    currentCapacity: 0,
    status: 'idle',
    location: {
      type: 'Point',
      coordinates: [121.05, 14.55],
    },
  });
  await Trip.updateMany(
    { communityId: community._id, shuttleId: shuttle._id, status: 'active' },
    { $set: { status: 'completed', shiftEnd: new Date() } }
  );
  await PickupRequest.deleteMany({ communityId: community._id });

  const firstIntent = await request(app)
    .post('/api/trips/pickup-intent')
    .set('Authorization', `Bearer ${passengerToken}`)
    .send({ latitude: 14.551, longitude: 121.052 });
  assert.equal(firstIntent.status, 201);

  const secondIntent = await request(app)
    .post('/api/trips/pickup-intent')
    .set('Authorization', `Bearer ${passengerToken}`)
    .send({ latitude: 14.5515, longitude: 121.0525 });
  assert.equal(secondIntent.status, 201);

  const manualBoardResponse = await request(app)
    .post('/api/trips/passenger-board')
    .set('Authorization', `Bearer ${driverToken}`)
    .send({
      shuttleId: String(shuttle._id),
      boardedCount: 1,
    });
  assert.equal(manualBoardResponse.status, 200);

  const pendingBeforeSync = await PickupRequest.countDocuments({
    communityId: community._id,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  });
  assert.equal(pendingBeforeSync, 1);

  const locationSyncResponse = await request(app)
    .put(`/api/shuttles/${shuttle._id}/location`)
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ latitude: 14.551, longitude: 121.052 });

  assert.equal(locationSyncResponse.status, 200);
  assert.equal(locationSyncResponse.body.autoBoardedCount, 0);
  assert.ok(locationSyncResponse.body.manualAutomationCooldownSeconds >= 1);

  const pendingAfterSync = await PickupRequest.countDocuments({
    communityId: community._id,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  });
  assert.equal(pendingAfterSync, 1);
});

test('PUT /api/shuttles/:id/location suppresses auto-unboarding immediately after manual unboard', async () => {
  clearManualAutomationCooldown(shuttle._id);

  await User.findByIdAndUpdate(driverUser._id, { status: 'driving' });
  await Shuttle.findByIdAndUpdate(shuttle._id, {
    currentCapacity: 2,
    status: 'en_route',
    location: {
      type: 'Point',
      coordinates: [121.052, 14.551],
    },
  });
  await Trip.updateMany(
    { communityId: community._id, shuttleId: shuttle._id, status: 'active' },
    { $set: { status: 'completed', shiftEnd: new Date() } }
  );
  await PickupRequest.deleteMany({ communityId: community._id });
  await PassengerRide.deleteMany({ communityId: community._id, shuttleId: shuttle._id });

  const passenger = await User.findOne({ email: 'passenger@test.local' }).select('_id');
  assert.ok(passenger);

  const activeTrip = await Trip.create({
    communityId: community._id,
    shuttleId: shuttle._id,
    driverId: driverUser._id,
    passengersBoarded: 2,
    fareAtTime: 20,
    revenueCollected: 40,
    status: 'active',
  });

  const boardedAt = new Date();
  await PassengerRide.insertMany([
    {
      communityId: community._id,
      passengerId: passenger._id,
      shuttleId: shuttle._id,
      driverId: driverUser._id,
      tripId: activeTrip._id,
      fareAtBoarding: 20,
      pickupLocation: {
        type: 'Point',
        coordinates: [121.052, 14.551],
      },
      destinationType: 'fixed',
      destinationLabel: 'Stop A',
      destinationLocation: {
        type: 'Point',
        coordinates: [121.052, 14.551],
      },
      requestedAt: boardedAt,
      boardedAt,
      status: 'boarded',
    },
    {
      communityId: community._id,
      passengerId: passenger._id,
      shuttleId: shuttle._id,
      driverId: driverUser._id,
      tripId: activeTrip._id,
      fareAtBoarding: 20,
      pickupLocation: {
        type: 'Point',
        coordinates: [121.0522, 14.5512],
      },
      destinationType: 'fixed',
      destinationLabel: 'Stop A',
      destinationLocation: {
        type: 'Point',
        coordinates: [121.052, 14.551],
      },
      requestedAt: boardedAt,
      boardedAt: new Date(boardedAt.getTime() + 1000),
      status: 'boarded',
    },
  ]);

  const manualUnboardResponse = await request(app)
    .post('/api/trips/passenger-unboard')
    .set('Authorization', `Bearer ${driverToken}`)
    .send({
      shuttleId: String(shuttle._id),
      unboardCount: 1,
    });

  assert.equal(manualUnboardResponse.status, 200);

  const boardedBeforeSync = await PassengerRide.countDocuments({
    tripId: activeTrip._id,
    status: 'boarded',
  });
  assert.equal(boardedBeforeSync, 1);

  const locationSyncResponse = await request(app)
    .put(`/api/shuttles/${shuttle._id}/location`)
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ latitude: 14.551, longitude: 121.052 });

  assert.equal(locationSyncResponse.status, 200);
  assert.equal(locationSyncResponse.body.autoUnboardedCount, 0);
  assert.ok(locationSyncResponse.body.manualAutomationCooldownSeconds >= 1);

  const boardedAfterSync = await PassengerRide.countDocuments({
    tripId: activeTrip._id,
    status: 'boarded',
  });
  assert.equal(boardedAfterSync, 1);
});

test('POST /api/trips/shift-end blocks unresolved ride requests even without active trip', async () => {
  await Trip.updateMany(
    { communityId: community._id, shuttleId: shuttle._id, status: 'active' },
    { $set: { status: 'completed', shiftEnd: new Date() } }
  );
  await PickupRequest.deleteMany({ communityId: community._id });
  await RideRequest.deleteMany({ communityId: community._id, status: 'pending' });

  const createIntentResponse = await request(app)
    .post('/api/trips/pickup-intent')
    .set('Authorization', `Bearer ${passengerToken}`)
    .send({ latitude: 14.551, longitude: 121.052 });
  assert.equal(createIntentResponse.status, 201);

  const endShiftResponse = await request(app)
    .post('/api/trips/shift-end')
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ shuttleId: String(shuttle._id) });

  assert.equal(endShiftResponse.status, 409);
  assert.match(endShiftResponse.body.error, /unresolved ride requests/i);
  assert.ok(Array.isArray(endShiftResponse.body.unresolvedRequests));
  assert.ok(endShiftResponse.body.unresolvedRequests.length >= 1);

  const requestId = endShiftResponse.body.unresolvedRequests[0].requestId;
  const resolveResponse = await request(app)
    .post(`/api/trips/ride-requests/${requestId}/resolve`)
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ resolution: 'no_show' });
  assert.equal(resolveResponse.status, 200);
});

test('PATCH /api/users/me blocks driver offline transition with unresolved ride requests', async () => {
  await User.findByIdAndUpdate(driverUser._id, { status: 'driving' });
  await PickupRequest.deleteMany({ communityId: community._id });
  await RideRequest.deleteMany({ communityId: community._id, status: 'pending' });

  const createIntentResponse = await request(app)
    .post('/api/trips/pickup-intent')
    .set('Authorization', `Bearer ${passengerToken}`)
    .send({ latitude: 14.552, longitude: 121.053 });
  assert.equal(createIntentResponse.status, 201);

  const offlineResponse = await request(app)
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ status: 'offline' });

  assert.equal(offlineResponse.status, 409);
  assert.match(offlineResponse.body.error, /unresolved ride requests/i);
  assert.ok(Array.isArray(offlineResponse.body.unresolvedRequests));
  assert.ok(offlineResponse.body.unresolvedRequests.length >= 1);

  const requestId = offlineResponse.body.unresolvedRequests[0].requestId;
  const resolveResponse = await request(app)
    .post(`/api/trips/ride-requests/${requestId}/resolve`)
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ resolution: 'no_show' });
  assert.equal(resolveResponse.status, 200);

  const retryOfflineResponse = await request(app)
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ status: 'offline' });
  assert.equal(retryOfflineResponse.status, 200);

  await User.findByIdAndUpdate(driverUser._id, { status: 'active' });
});

test('PATCH /api/users/:id marks unresolved ride requests as ignored on admin-forced driver offline', async () => {
  await User.findByIdAndUpdate(driverUser._id, { status: 'driving' });
  await PickupRequest.deleteMany({ communityId: community._id });
  await RideRequest.deleteMany({ communityId: community._id, status: 'pending' });

  const createIntentResponse = await request(app)
    .post('/api/trips/pickup-intent')
    .set('Authorization', `Bearer ${passengerToken}`)
    .send({ latitude: 14.553, longitude: 121.054 });
  assert.equal(createIntentResponse.status, 201);

  const forceOfflineResponse = await request(app)
    .patch(`/api/users/${driverUser._id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'offline' });

  assert.equal(forceOfflineResponse.status, 200);

  const linkedRideRequest = await RideRequest.findOne({
    pickupRequestId: createIntentResponse.body.request._id,
  }).lean();
  assert.ok(linkedRideRequest);
  assert.equal(linkedRideRequest.status, 'ignored');
  assert.equal(linkedRideRequest.resolution, 'expired');
});

test('POST /api/trips/:tripId/remittance auto-flags when ignored ride requests exist and verify is blocked', async () => {
  const passenger = await User.findOne({ email: 'passenger@test.local' }).select('_id');
  assert.ok(passenger);

  const shiftStart = new Date(Date.now() - 45 * 60 * 1000);
  const shiftEnd = new Date(Date.now() - 15 * 60 * 1000);

  const ignoredTrip = await Trip.create({
    communityId: community._id,
    shuttleId: shuttle._id,
    driverId: driverUser._id,
    passengersBoarded: 1,
    fareAtTime: 20,
    revenueCollected: 20,
    status: 'completed',
    shiftStart,
    shiftEnd,
  });

  await RideRequest.create({
    communityId: community._id,
    passengerId: passenger._id,
    shuttleId: shuttle._id,
    tripId: ignoredTrip._id,
    pickupLocation: {
      type: 'Point',
      coordinates: [121.052, 14.551],
    },
    destination: {
      type: 'fixed',
      label: 'Stop B',
      location: {
        type: 'Point',
        coordinates: [121.054, 14.553],
      },
    },
    fareExpected: 20,
    status: 'ignored',
    resolution: 'expired',
    resolvedAt: shiftEnd,
    createdAt: new Date(shiftStart.getTime() + 2 * 60 * 1000),
    updatedAt: shiftEnd,
  });

  const submitResponse = await request(app)
    .post(`/api/trips/${ignoredTrip._id}/remittance`)
    .set('Authorization', `Bearer ${driverToken}`)
    .field('actualAmount', '20')
    .field('driverNote', 'Submitting with ignored ride request in same shift.')
    .attach('receipt', dummyReceiptJpg, { filename: 'receipt.jpg', contentType: 'image/jpeg' });

  assert.equal(submitResponse.status, 200);
  assert.equal(submitResponse.body.remittance.status, 'flagged');

  const verifyResponse = await request(app)
    .patch(`/api/trips/remittances/${submitResponse.body.remittance._id}/verify`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'verified', adminNote: 'Attempting verification.' });

  assert.equal(verifyResponse.status, 409);
  assert.match(verifyResponse.body.error, /cannot verify remittance/i);
});
