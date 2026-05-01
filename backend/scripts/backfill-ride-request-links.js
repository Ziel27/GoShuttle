/*
  Backfill script: Link existing PassengerRide rows to RideRequest documents
  Strategy:
  - For each PassengerRide without `rideRequestId` but with `tripId` and `pickupLocation`,
  	try to find a matching RideRequest by `tripId`+`passengerId`+same pickup coordinates.
  - If not found, try matching by `tripId` + passengerName/phone.
  - Print summary and optionally update documents (dry-run by default).

  Usage:
    node backend/scripts/backfill-ride-request-links.js --apply

*/
const mongoose = require('mongoose');
const PassengerRide = require('../src/models/PassengerRide');
const RideRequest = require('../src/models/RideRequest');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/goshuttle';

const nearlyEqualCoords = (a, b) => {
  if (!a || !b || !Array.isArray(a.coordinates) || !Array.isArray(b.coordinates)) return false;
  return Math.abs(a.coordinates[0] - b.coordinates[0]) < 0.00001 && Math.abs(a.coordinates[1] - b.coordinates[1]) < 0.00001;
};

const normalizePhone = (phone) => (phone || '').replace(/[^0-9]/g, '').replace(/^\+?0+/, '');

const fuzzyNameRegex = (name) => {
  if (!name) return null;
  // simple fuzzy: match last name or significant substring (escape regex)
  const safe = String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = safe.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const token = parts[parts.length - 1];
  return new RegExp(token, 'i');
};

const run = async () => {
  const apply = process.argv.includes('--apply');
  console.log(`Connecting to ${MONGODB_URI} ...`);
  await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    const cursor = PassengerRide.find({ rideRequestId: null }).cursor();
    let processed = 0;
    let linked = 0;
    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      processed += 1;
      const pickup = doc.pickupLocation || doc.location || null;
      const tripId = doc.tripId;

      if (!tripId || !pickup) continue;

      // 1) Try exact match by tripId + passengerId + pickup coords
      let match = null;
      if (doc.passengerId) {
        match = await RideRequest.findOne({ tripId, passengerId: doc.passengerId });
        if (match && match.pickupLocation && nearlyEqualCoords(match.pickupLocation, pickup)) {
          console.log(`Linking PassengerRide ${doc._id} -> RideRequest ${match._id} (passengerId match)`);
          if (apply) {
            doc.rideRequestId = match._id;
            await doc.save();
          }
          linked += 1;
          continue;
        }
      }

      // 2) Try match by tripId + passengerId exact (without coord match)
      if (doc.passengerId) {
        match = await RideRequest.findOne({ tripId, passengerId: doc.passengerId, status: 'pending' });
        if (match) {
          console.log(`Linking PassengerRide ${doc._id} -> RideRequest ${match._id} (passengerId exact)`);
          if (apply) {
            doc.rideRequestId = match._id;
            await doc.save();
          }
          linked += 1;
          continue;
        }
      }

      // 3) Try fuzzy name or phone match within a small createdAt window
      const candidates = [];
      if (doc.passengerName) {
        const nameRx = fuzzyNameRegex(doc.passengerName);
        if (nameRx) candidates.push({ passengerName: nameRx });
      }
      if (doc.passengerPhone) {
        const norm = normalizePhone(doc.passengerPhone);
        if (norm) candidates.push({ passengerPhone: { $regex: norm } });
      }

      if (candidates.length > 0) {
        const orQuery = candidates.map((c) => c);
        const windowMs = 5 * 60 * 1000; // 5 minutes
        const before = new Date(doc.boardedAt ? doc.boardedAt.getTime() - windowMs : Date.now() - windowMs);
        const after = new Date(doc.boardedAt ? doc.boardedAt.getTime() + windowMs : Date.now() + windowMs);

        match = await RideRequest.findOne({
          tripId,
          status: 'pending',
          $or: orQuery,
          createdAt: { $gte: before, $lte: after },
        });

        if (match) {
          console.log(`Linking PassengerRide ${doc._id} -> RideRequest ${match._id} (fuzzy name/phone + time window)`);
          if (apply) {
            doc.rideRequestId = match._id;
            await doc.save();
          }
          linked += 1;
          continue;
        }
      }

      // 4) Spatial $near match within 20 meters
      try {
        match = await RideRequest.findOne({
          tripId,
          status: 'pending',
          pickupLocation: {
            $near: {
              $geometry: pickup,
              $maxDistance: 20,
            },
          },
        });
        if (match) {
          console.log(`Linking PassengerRide ${doc._id} -> RideRequest ${match._id} (spatial $near within 20m)`);
          if (apply) {
            doc.rideRequestId = match._id;
            await doc.save();
          }
          linked += 1;
          continue;
        }
      } catch (e) {
        // fall back to exact coordinate match if $near unsupported
      }
    }

    console.log(`Processed ${processed} PassengerRide(s). Linked: ${linked}. Apply: ${apply}`);
  } catch (err) {
    console.error('Error during backfill:', err);
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
