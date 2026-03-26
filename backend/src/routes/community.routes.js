const express = require('express');
const {
  createCommunity,
  listCommunities,
  getCommunityById,
  updateCommunity,
} = require('../controllers/community.controller');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/', listCommunities);
router.get('/:id', getCommunityById);

router.post('/', authenticate, authorize('admin'), createCommunity);
router.put('/:id', authenticate, authorize('admin'), updateCommunity);

module.exports = router;
