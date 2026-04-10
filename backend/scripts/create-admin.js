#!/usr/bin/env node

require('dotenv').config();

const mongoose = require('mongoose');

const User = require('../src/models/User');
const Community = require('../src/models/Community');

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

  return {
    email: getArg('email') || process.env.ADMIN_EMAIL || 'admin@goshuttle.local',
    password: getArg('password') || process.env.ADMIN_PASSWORD || 'Admin1234!',
    firstName: getArg('firstName') || process.env.ADMIN_FIRST_NAME || 'System',
    lastName: getArg('lastName') || process.env.ADMIN_LAST_NAME || 'Admin',
    phone: getArg('phone') || process.env.ADMIN_PHONE || '',
    communityId: getArg('communityId') || process.env.ADMIN_COMMUNITY_ID || '',
    communityName: getArg('communityName') || process.env.ADMIN_COMMUNITY_NAME || '',
  };
};

const resolveCommunity = async ({ communityId, communityName }) => {
  if (communityId) {
    if (!mongoose.Types.ObjectId.isValid(communityId)) {
      fail('ADMIN_COMMUNITY_ID / --communityId is not a valid Mongo ObjectId.');
    }

    const byId = await Community.findById(communityId).select('_id name isActive');
    if (!byId) fail('Community not found for provided communityId.');
    if (!byId.isActive) fail('Provided communityId is inactive.');
    return byId;
  }

  if (communityName) {
    const byName = await Community.findOne({ name: communityName, isActive: true }).select('_id name isActive');
    if (!byName) fail('Active community not found for provided communityName.');
    return byName;
  }

  const firstActive = await Community.findOne({ isActive: true }).sort({ createdAt: 1 }).select('_id name');
  if (!firstActive) {
    fail('No active community found. Provide --communityId=<id> (or ADMIN_COMMUNITY_ID) first.');
  }

  return firstActive;
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    fail('MONGO_URI is required in environment.');
  }

  const input = parseArgs();
  const email = String(input.email).toLowerCase();

  if (!email.includes('@')) {
    fail('Admin email must be valid. Use --email=<address>.');
  }

  if (String(input.password).length < 8) {
    fail('Admin password must be at least 8 characters. Use --password=<value>.');
  }

  const conn = await mongoose.connect(process.env.MONGO_URI);

  try {
    const community = await resolveCommunity(input);

    const existing = await User.findOne({ email }).select('+password');

    if (existing) {
      existing.firstName = input.firstName;
      existing.lastName = input.lastName;
      existing.phone = input.phone;
      existing.communityId = community._id;
      existing.role = 'admin';
      existing.isActive = true;
      existing.status = 'offline';

      if (input.password) {
        existing.password = input.password;
      }

      await existing.save();

      console.log(`OK: Updated existing user as admin (${email}) in community ${community.name}.`);
      return;
    }

    await User.create({
      communityId: community._id,
      firstName: input.firstName,
      lastName: input.lastName,
      email,
      password: input.password,
      phone: input.phone,
      role: 'admin',
      status: 'offline',
      isActive: true,
    });

    console.log(`OK: Created admin user (${email}) in community ${community.name}.`);
  } finally {
    await conn.disconnect();
  }
};

main().catch((error) => {
  console.error('ERROR: Failed to create/update admin user.');
  console.error(error.message || error);
  process.exit(1);
});
