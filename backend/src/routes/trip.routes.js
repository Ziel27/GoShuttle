const express = require('express');
const {
  passengerBoard,
  passengerUnboard,
  listOnboardDestinations,
  getCurrentPassengers,
  endShift,
  syncOfflineTrips,
  createPickupIntent,
  listPickupIntents,
  listPassengerRecentRides,
  getAnalytics,
  getDriverAnalytics,
  submitShiftRemittance,
  verifyShiftRemittance,
  listShiftRemittances,
  getRemittanceSummary,
  listDriverCompletedTrips,
  listDriverRemittances,
} = require('../controllers/trip.controller');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.post('/passenger-board', authorize('driver'), passengerBoard);
router.post('/passenger-unboard', authorize('driver'), passengerUnboard);
router.post('/shift-end', authorize('driver'), endShift);
router.post('/sync-offline', authorize('driver'), syncOfflineTrips);
router.post('/pickup-intent', authorize('passenger'), createPickupIntent);
router.get('/pickup-intents', authorize('admin', 'driver'), listPickupIntents);
router.get('/passenger-recent-rides', authorize('passenger'), listPassengerRecentRides);
router.get('/analytics', authorize('admin'), getAnalytics);
router.get('/driver-analytics', authorize('admin'), getDriverAnalytics);
router.get('/driver-completed-trips', authorize('driver'), listDriverCompletedTrips);
router.get('/driver-remittances', authorize('driver'), listDriverRemittances);
router.post('/:tripId/remittance', authorize('driver', 'admin'), submitShiftRemittance);
router.patch('/remittances/:id/verify', authorize('admin'), verifyShiftRemittance);
router.get('/remittances', authorize('admin'), listShiftRemittances);
router.get('/remittance-summary', authorize('admin'), getRemittanceSummary);
router.get('/:shuttleId/onboard-destinations', authorize('driver', 'admin'), listOnboardDestinations);
router.get('/:tripId/current-passengers', authorize('driver', 'admin'), getCurrentPassengers);

module.exports = router;

