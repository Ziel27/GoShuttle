const express = require('express');
const {
  createShuttle,
  listShuttles,
  updateShuttleLocation,
  updateShuttleCapacity,
} = require('../controllers/shuttle.controller');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/', listShuttles);
router.post('/', authorize('admin'), createShuttle);
router.put('/:id/location', authorize('driver', 'admin'), updateShuttleLocation);
router.patch('/:id/capacity', authorize('driver', 'admin'), updateShuttleCapacity);

module.exports = router;
