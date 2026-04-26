const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { createAnnouncement, listAnnouncements } = require('../controllers/announcement.controller');

const router = express.Router();

router.use(authenticate);

// Any authenticated user can read announcements for their community.
router.get('/', listAnnouncements);

// Only admins can publish.
router.post('/', authorize('admin'), createAnnouncement);

module.exports = router;
