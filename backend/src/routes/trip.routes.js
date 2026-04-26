const express = require('express');
const {
  passengerBoard,
  passengerUnboard,
  listOnboardDestinations,
  getCurrentPassengers,
  endShift,
  syncOfflineTrips,
  createPickupIntent,
  cancelPickupIntent,
  listPickupIntents,
  listPassengerRecentRides,
  getAnalytics,
  getDriverAnalytics,
  getDriverPerformanceAnalytics,
  submitShiftRemittance,
  verifyShiftRemittance,
  listShiftRemittances,
  getRemittanceSummary,
  listDriverCompletedTrips,
  listDriverRemittances,
  resolveRideRequest,
  getMyDispatch,
  cancelMyPickupIntents,
} = require('../controllers/trip.controller');


const { authenticate, authorize } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.use(authenticate);

router.post('/passenger-board', authorize('driver'), passengerBoard);
router.post('/passenger-unboard', authorize('driver'), passengerUnboard);
router.post('/shift-end', authorize('driver'), endShift);
router.post('/sync-offline', authorize('driver'), syncOfflineTrips);
router.post('/pickup-intent', authorize('passenger', 'admin'), createPickupIntent);
router.delete('/pickup-intent/:intentId', authorize('passenger', 'admin'), cancelPickupIntent);
router.get('/pickup-intents', authorize('admin', 'driver'), listPickupIntents);
router.get('/my-dispatch', authorize('passenger'), getMyDispatch);
router.delete('/my-pickup-intents', authorize('passenger'), cancelMyPickupIntents);

router.get('/passenger-recent-rides', authorize('passenger'), listPassengerRecentRides);

router.get('/analytics', authorize('admin'), getAnalytics);
router.get('/driver-analytics', authorize('admin'), getDriverAnalytics);
router.get('/driver-performance', authorize('admin'), getDriverPerformanceAnalytics);
router.get('/driver-completed-trips', authorize('driver'), listDriverCompletedTrips);
router.get('/driver-remittances', authorize('driver'), listDriverRemittances);
router.post('/:tripId/remittance', authorize('driver', 'admin'), upload.single('receipt'), submitShiftRemittance);
router.patch('/remittances/:id/verify', authorize('admin'), verifyShiftRemittance);
router.get('/remittances', authorize('admin'), listShiftRemittances);
router.get('/remittance-summary', authorize('admin'), getRemittanceSummary);
router.post('/ride-requests/:requestId/resolve', authorize('driver'), resolveRideRequest);
router.get('/:shuttleId/onboard-destinations', authorize('driver', 'admin'), listOnboardDestinations);
router.get('/:tripId/current-passengers', authorize('driver', 'admin'), getCurrentPassengers);

module.exports = router;


