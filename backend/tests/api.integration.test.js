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
const { app } = require('../src/server');

let mongod;
let adminUser;
let adminToken;
let driverUser;
let driverToken;
let passengerToken;
let community;
let shuttle;

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

test('POST /api/trips/pickup-intent creates a passenger pickup pin', async () => {
  const response = await request(app)
    .post('/api/trips/pickup-intent')
    .set('Authorization', `Bearer ${passengerToken}`)
    .send({ latitude: 14.551, longitude: 121.052 });

  assert.equal(response.status, 201);
  assert.equal(response.body.request.status, 'pending');
  assert.deepEqual(response.body.request.location.coordinates, [121.052, 14.551]);
});

test('GET /api/trips/pickup-intents returns active demand pins for driver', async () => {
  const response = await request(app)
    .get('/api/trips/pickup-intents')
    .set('Authorization', `Bearer ${driverToken}`);

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.requests));
  assert.ok(response.body.requests.length >= 1);
  assert.equal(response.body.requests[0].status, 'pending');
});
