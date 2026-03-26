const express = require('express');
const {
  createManagedUser,
  listUsers,
  updateUserStatus,
} = require('../controllers/user.controller');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/', listUsers);
router.post('/', createManagedUser);
router.patch('/:id', updateUserStatus);

module.exports = router;
