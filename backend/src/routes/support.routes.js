const express = require('express');
const { authenticate } = require('../middleware/auth');
const { sendSupportMessage, getMyTickets } = require('../controllers/support.controller');

const router = express.Router();

router.post('/contact', authenticate, sendSupportMessage);
router.get('/tickets', authenticate, getMyTickets);

module.exports = router;
