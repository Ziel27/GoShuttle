process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { io: ioClient } = require('socket.io-client');

const Community = require('../src/models/Community');
const User = require('../src/models/User');
const Shuttle = require('../src/models/Shuttle');
const { app, server } = require('../src/server');

let mongod;
let community;
let secondCommunity;
let adminToken;
let secondAdminToken;
let driverToken;
let passengerToken;
let shuttle;
let socketBaseUrl;

const withTimeout = (promise, ms = 3000, label = 'Timed out waiting for socket event') =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label)), ms);
    }),
  ]);

const connectSocketWithToken = async (token) => {
  const socket = ioClient(socketBaseUrl, {
    transports: ['websocket'],
    auth: { token },
  });

  try {
    await withTimeout(once(socket, 'connect'), 3000, 'Socket did not connect');
    return socket;
  } catch (error) {
    socket.close();
    throw error;
  }
};

const polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [121.2, 14.4],
      [121.3, 14.4],
      [121.3, 14.5],
      [121.2, 14.5],
      [121.2, 14.4],
    ],
  ],
};

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGO_URI = uri;

  await mongoose.connect(uri);

  community = await Community.create({
    name: 'Secure Village',
    boundaries: polygon,
    baseFare: 25,
  });

  secondCommunity = await Community.create({
    name: 'Neighbor Village',
    boundaries: {
      type: 'Polygon',
      coordinates: [
        [
          [121.4, 14.4],
          [121.5, 14.4],
          [121.5, 14.5],
          [121.4, 14.5],
          [121.4, 14.4],
        ],
      ],
    },
    baseFare: 30,
  });

  const admin = await User.create({
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin-sec@test.local',
    password: 'Password123!',
    role: 'admin',
    status: 'active',
    communityId: community._id,
  });

  const driver = await User.create({
    firstName: 'Driver',
    lastName: 'User',
    email: 'driver-sec@test.local',
    password: 'Password123!',
    role: 'driver',
    status: 'active',
    communityId: community._id,
  });

  await User.create({
    firstName: 'Passenger',
    lastName: 'User',
    email: 'passenger-sec@test.local',
    password: 'Password123!',
    role: 'passenger',
    status: 'active',
    communityId: community._id,
  });

  const secondAdmin = await User.create({
    firstName: 'Other',
    lastName: 'Admin',
    email: 'other-admin@test.local',
    password: 'Password123!',
    role: 'admin',
    status: 'active',
    communityId: secondCommunity._id,
  });

  const loginAdmin = await request(app)
    .post('/api/auth/login')
    .send({ email: admin.email, password: 'Password123!' });
  adminToken = loginAdmin.body.token;

  const loginDriver = await request(app)
    .post('/api/auth/login')
    .send({ email: driver.email, password: 'Password123!' });
  driverToken = loginDriver.body.token;

  const loginPassenger = await request(app)
    .post('/api/auth/login')
    .send({ email: 'passenger-sec@test.local', password: 'Password123!' });
  passengerToken = loginPassenger.body.token;

  const loginSecondAdmin = await request(app)
    .post('/api/auth/login')
    .send({ email: secondAdmin.email, password: 'Password123!' });
  secondAdminToken = loginSecondAdmin.body.token;

  shuttle = await Shuttle.create({
    communityId: community._id,
    driverId: driver._id,
    plateNumber: 'SEC-201',
    maxCapacity: 1,
    currentCapacity: 1,
  });

  await new Promise((resolve, reject) => {
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve test server address for sockets.'));
        return;
      }

      socketBaseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(() => resolve());
  });
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

test('GET /api/users without token returns 401', async () => {
  const response = await request(app).get('/api/users');

  assert.equal(response.status, 401);
  assert.match(response.body.error, /authentication required/i);
});

test('Passenger cannot access admin /api/users endpoint', async () => {
  const response = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${passengerToken}`);

  assert.equal(response.status, 403);
  assert.match(response.body.error, /access denied/i);
});

test('Driver cannot access admin analytics endpoint', async () => {
  const response = await request(app)
    .get('/api/trips/analytics')
    .set('Authorization', `Bearer ${driverToken}`);

  assert.equal(response.status, 403);
  assert.match(response.body.error, /access denied/i);
});

test('Register with invalid email fails validation', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      firstName: 'Bad',
      lastName: 'Email',
      email: 'not-an-email',
      password: 'Password123!',
      communityId: String(community._id),
    });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /invalid email address/i);
});

test('Register with invalid communityId fails validation', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      firstName: 'Wrong',
      lastName: 'Community',
      email: 'wrong-community@test.local',
      password: 'Password123!',
      communityId: 'not-a-mongo-id',
    });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /invalid community id/i);
});

test('Admin cannot create community with invalid polygon', async () => {
  const response = await request(app)
    .post('/api/communities')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: 'Broken Village',
      baseFare: 20,
      boundaries: {
        type: 'Polygon',
        coordinates: [
          [
            [121.0, 14.0],
            [121.1, 14.0],
          ],
        ],
      },
    });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /invalid geojson polygon boundaries/i);
});

test('Driver location update with invalid coordinates returns 400', async () => {
  const response = await request(app)
    .put(`/api/shuttles/${shuttle._id}/location`)
    .set('Authorization', `Bearer ${driverToken}`)
    .send({ latitude: 'abc', longitude: 121.2 });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /must be valid numbers/i);
});

test('Passenger board rejects over-capacity attempts', async () => {
  const response = await request(app)
    .post('/api/trips/passenger-board')
    .set('Authorization', `Bearer ${driverToken}`)
    .send({
      shuttleId: String(shuttle._id),
      boardedCount: 1,
    });

  assert.equal(response.status, 409);
  assert.match(response.body.error, /shuttle is full/i);
});

test('Admin cannot update a different community', async () => {
  const response = await request(app)
    .put(`/api/communities/${community._id}`)
    .set('Authorization', `Bearer ${secondAdminToken}`)
    .send({ baseFare: 99 });

  assert.equal(response.status, 403);
  assert.match(response.body.error, /only update your own community/i);
});

test('Socket connection without token is rejected', async () => {
  const socket = ioClient(socketBaseUrl, {
    transports: ['websocket'],
  });

  const result = await withTimeout(
    Promise.race([
      once(socket, 'connect_error').then(([error]) => ({ type: 'connect_error', error })),
      once(socket, 'connect').then(() => ({ type: 'connect' })),
    ]),
    3000,
    'Socket auth test timed out'
  );

  socket.close();

  assert.equal(result.type, 'connect_error');
  assert.match(String(result.error?.message || ''), /authentication required|invalid socket token/i);
});

test('Socket user cannot emit shuttle updates for another community', async () => {
  const socket = await connectSocketWithToken(secondAdminToken);

  socket.emit('driver-location', {
    shuttleId: String(shuttle._id),
    latitude: 14.45,
    longitude: 121.25,
  });

  const [payload] = await withTimeout(
    once(socket, 'socket:error'),
    3000,
    'Cross-community socket denial event timed out'
  );

  socket.close();

  assert.match(String(payload?.error || ''), /access denied for this shuttle/i);
});
