const express = require('express');
const {
  passengerBoard,
  endShift,
  syncOfflineTrips,
  createPickupIntent,
  listPickupIntents,
  listPassengerRecentRides,
  getAnalytics,
} = require('../controllers/trip.controller');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.post('/passenger-board', authorize('driver'), passengerBoard);
router.post('/shift-end', authorize('driver'), endShift);
router.post('/sync-offline', authorize('driver'), syncOfflineTrips);
router.post('/pickup-intent', authorize('passenger'), createPickupIntent);
router.get('/pickup-intents', authorize('admin', 'driver'), listPickupIntents);
router.get('/passenger-recent-rides', authorize('passenger'), listPassengerRecentRides);
router.get('/analytics', authorize('admin'), getAnalytics);

module.exports = router;
