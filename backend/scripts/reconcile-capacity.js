#!/usr/bin/env node

require('dotenv').config();

const mongoose = require('mongoose');

const Shuttle = require('../src/models/Shuttle');
const Trip = require('../src/models/Trip');
const PassengerRide = require('../src/models/PassengerRide');

const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const has = (flag) => args.includes(`--${flag}`);
  const get = (name) => {
    const item = args.find((entry) => entry.startsWith(`--${name}=`));
    return item ? item.slice(name.length + 3).trim() : '';
  };

  const communityId = get('communityId');
  const apply = has('apply');

  return { communityId, apply };
};

const buildShuttleQuery = (communityId) => {
  const query = { isActive: true };

  if (communityId) {
    if (!mongoose.Types.ObjectId.isValid(communityId)) {
      fail('communityId must be a valid ObjectId when provided.');
    }
    query.communityId = new mongoose.Types.ObjectId(communityId);
  }

  return query;
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    fail('MONGO_URI is required in environment.');
  }

  const { communityId, apply } = parseArgs();
  const connection = await mongoose.connect(process.env.MONGO_URI);

  try {
    const shuttleQuery = buildShuttleQuery(communityId);
    const shuttles = await Shuttle.find(shuttleQuery).select(
      '_id communityId plateNumber currentCapacity maxCapacity'
    );

    if (shuttles.length === 0) {
      console.log('No active shuttles matched the query.');
      return;
    }

    let mismatches = 0;
    let updated = 0;

    for (const shuttle of shuttles) {
      const activeTripIds = await Trip.find({
        shuttleId: shuttle._id,
        status: 'active',
      }).distinct('_id');

      const boardedCount = activeTripIds.length
        ? await PassengerRide.countDocuments({
          shuttleId: shuttle._id,
          tripId: { $in: activeTripIds },
          status: 'boarded',
        })
        : 0;

      const normalizedCapacity = Math.min(shuttle.maxCapacity, Math.max(0, boardedCount));
      const isMismatch = shuttle.currentCapacity !== normalizedCapacity;
      if (!isMismatch) continue;

      mismatches += 1;
      console.log(
        `[MISMATCH] ${shuttle.plateNumber || shuttle._id} current=${shuttle.currentCapacity} expected=${normalizedCapacity}`
      );

      if (apply) {
        shuttle.currentCapacity = normalizedCapacity;
        if (normalizedCapacity === 0 && shuttle.status !== 'maintenance') {
          shuttle.status = 'idle';
        } else if (normalizedCapacity > 0 && shuttle.status === 'idle') {
          shuttle.status = 'en_route';
        }
        shuttle.lastLocationUpdate = new Date();
        await shuttle.save();
        updated += 1;
      }
    }

    console.log(`Scanned shuttles: ${shuttles.length}`);
    console.log(`Capacity mismatches: ${mismatches}`);
    if (apply) {
      console.log(`Updated shuttles: ${updated}`);
    } else {
      console.log('Dry run only. Use --apply to persist updates.');
    }
  } finally {
    await connection.disconnect();
  }
};

main().catch((error) => {
  console.error('ERROR: Capacity reconciliation failed.');
  console.error(error?.message || error);
  process.exit(1);
});
