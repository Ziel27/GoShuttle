#!/usr/bin/env node

require('dotenv').config();

const mongoose = require('mongoose');

const Community = require('../src/models/Community');
const User = require('../src/models/User');
const Shuttle = require('../src/models/Shuttle');

const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const match = args.find((item) => item.startsWith(`--${name}=`));
    if (!match) return '';
    return match.slice(name.length + 3).trim();
  };

  const parsedCount = Number(getArg('count') || process.env.MOCK_SEED_COUNT || 5);
  const count = Number.isInteger(parsedCount) && parsedCount > 0 ? parsedCount : 5;

  return { count };
};

const baseCommunityData = [
  {
    name: 'Sunridge Gardens',
    baseFare: 25,
    boundaries: {
      type: 'Polygon',
      coordinates: [
        [
          [121.030, 14.555],
          [121.045, 14.555],
          [121.045, 14.568],
          [121.030, 14.568],
          [121.030, 14.555],
        ],
      ],
    },
  },
  {
    name: 'Lakeside Park Villas',
    baseFare: 30,
    boundaries: {
      type: 'Polygon',
      coordinates: [
        [
          [121.060, 14.540],
          [121.075, 14.540],
          [121.075, 14.553],
          [121.060, 14.553],
          [121.060, 14.540],
        ],
      ],
    },
  },
];

const ensureCommunity = async (communityInput) => {
  let community = await Community.findOne({ name: communityInput.name });

  if (!community) {
    community = await Community.create({
      name: communityInput.name,
      baseFare: communityInput.baseFare,
      boundaries: communityInput.boundaries,
      branding: { primaryColor: '#1E3A5F' },
      isActive: true,
    });
    return { community, created: true };
  }

  if (!community.isActive) {
    community.isActive = true;
    await community.save();
  }

  return { community, created: false };
};

const ensureDriver = async ({ communityId, communitySlug, index }) => {
  const firstName = `Driver${index}`;
  const lastName = communitySlug;
  const email = `driver${index}.${communitySlug}@goshuttle.local`;

  let driver = await User.findOne({ email }).select('+password');

  if (!driver) {
    driver = await User.create({
      communityId,
      firstName,
      lastName,
      email,
      password: 'Driver1234!',
      role: 'driver',
      status: index % 3 === 0 ? 'driving' : index % 2 === 0 ? 'active' : 'offline',
      isActive: true,
    });

    return { driver, created: true };
  }

  driver.communityId = communityId;
  driver.role = 'driver';
  driver.isActive = true;
  if (!driver.status || !['active', 'offline', 'driving'].includes(driver.status)) {
    driver.status = 'offline';
  }
  await driver.save();

  return { driver, created: false };
};

const ensureShuttle = async ({ communityId, communitySlug, index, driverId }) => {
  const plateNumber = `${communitySlug.slice(0, 3).toUpperCase()}-${String(index).padStart(3, '0')}`;
  const label = `${communitySlug.replace(/-/g, ' ')} Shuttle ${index}`;

  let shuttle = await Shuttle.findOne({ plateNumber });

  if (!shuttle) {
    shuttle = await Shuttle.create({
      communityId,
      driverId,
      plateNumber,
      label,
      maxCapacity: 16,
      currentCapacity: index % 2 === 0 ? 0 : Math.min(8, index),
      status: index % 5 === 0 ? 'maintenance' : index % 4 === 0 ? 'en_route' : 'idle',
      isActive: true,
    });

    return { shuttle, created: true };
  }

  shuttle.communityId = communityId;
  shuttle.driverId = driverId;
  shuttle.label = label;
  shuttle.isActive = true;
  await shuttle.save();

  return { shuttle, created: false };
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    fail('MONGO_URI is required in environment.');
  }

  const { count } = parseArgs();

  const connection = await mongoose.connect(process.env.MONGO_URI);

  try {
    let createdCommunities = 0;
    let createdDrivers = 0;
    let createdShuttles = 0;

    for (const input of baseCommunityData) {
      const { community, created: communityCreated } = await ensureCommunity(input);
      if (communityCreated) createdCommunities += 1;

      const communitySlug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

      for (let i = 1; i <= count; i += 1) {
        const { driver, created: driverCreated } = await ensureDriver({
          communityId: community._id,
          communitySlug,
          index: i,
        });
        if (driverCreated) createdDrivers += 1;

        const { created: shuttleCreated } = await ensureShuttle({
          communityId: community._id,
          communitySlug,
          index: i,
          driverId: driver._id,
        });
        if (shuttleCreated) createdShuttles += 1;
      }
    }

    console.log('OK: Mock seed complete.');
    console.log(`Communities created: ${createdCommunities}`);
    console.log(`Drivers created: ${createdDrivers}`);
    console.log(`Shuttles created: ${createdShuttles}`);
    console.log(`Configured per community: ${count} drivers + ${count} shuttles`);
  } finally {
    await connection.disconnect();
  }
};

main().catch((error) => {
  console.error('ERROR: Failed to seed mock data.');
  console.error(error?.message || error);
  process.exit(1);
});
