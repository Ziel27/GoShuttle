const express = require('express');
const {
  createManagedUser,
  listUsers,
  updateUserStatus,
  updateOwnStatus,
  updateOwnHomeDestination,
  updateOwnHomePhase,
} = require('../controllers/user.controller');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

// Public routes (authenticated users only)
router.patch('/me', authorize('driver', 'admin'), updateOwnStatus);
router.patch('/me/home-destination', authorize('passenger', 'admin'), updateOwnHomeDestination);
router.patch('/me/home-phase', authorize('passenger'), updateOwnHomePhase);

// Admin routes
router.use(authorize('admin'));

router.get('/', listUsers);
router.post('/', createManagedUser);
router.patch('/:id', updateUserStatus);

module.exports = router;
