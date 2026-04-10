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

const main = async () => {
  if (!process.env.MONGO_URI) {
    fail('MONGO_URI is required in environment.');
  }

  const connection = await mongoose.connect(process.env.MONGO_URI);

  try {
    console.log('Starting driver reset...\n');

    // Get the first active community
    const community = await Community.findOne({ isActive: true });
    if (!community) {
      fail('No active community found.');
    }
    console.log(`Found community: ${community.name}`);

    // Remove all drivers
    const driversDeleted = await User.deleteMany({ role: 'driver' });
    console.log(`✓ Deleted ${driversDeleted.deletedCount} drivers`);

    // Clear driver assignments from all shuttles
    const shuttlesUpdated = await Shuttle.updateMany(
      { communityId: community._id },
      { $set: { driverId: null } }
    );
    console.log(`✓ Cleared driver assignments from ${shuttlesUpdated.modifiedCount} shuttles`);

    // Create one new driver
    const newDriver = await User.create({
      communityId: community._id,
      firstName: 'John',
      lastName: 'Driver',
      email: 'john.driver@goshuttle.local',
      password: 'Driver1234!',
      phone: '+1234567890',
      role: 'driver',
      status: 'active',
      isActive: true,
    });
    console.log(`✓ Created new driver: ${newDriver.firstName} ${newDriver.lastName} (${newDriver.email})`);

    // Get or create a shuttle for the driver
    let shuttle = await Shuttle.findOne({ communityId: community._id, isActive: true });

    if (!shuttle) {
      // Create a new shuttle if none exists
      shuttle = await Shuttle.create({
        communityId: community._id,
        plateNumber: 'TEST-001',
        label: 'Test Shuttle 1',
        maxCapacity: 16,
        currentCapacity: 0,
        status: 'idle',
        isActive: true,
      });
      console.log(`✓ Created new shuttle: ${shuttle.plateNumber}`);
    }

    // Assign shuttle to driver
    shuttle.driverId = newDriver._id;
    await shuttle.save();
    console.log(`✓ Assigned shuttle ${shuttle.plateNumber} to ${newDriver.firstName} ${newDriver.lastName}`);

    console.log('\n✓ Driver reset complete!');
    console.log(`\nDriver Details:`);
    console.log(`  Name: ${newDriver.firstName} ${newDriver.lastName}`);
    console.log(`  Email: ${newDriver.email}`);
    console.log(`  Password: Driver1234!`);
    console.log(`  Shuttle: ${shuttle.plateNumber}`);
  } catch (error) {
    fail(error?.message || String(error));
  } finally {
    await connection.disconnect();
  }
};

main().catch((error) => {
  console.error('ERROR: Failed to reset drivers.');
  console.error(error?.message || error);
  process.exit(1);
});
