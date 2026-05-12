const express = require('express');
const { authenticate } = require('../middleware/auth');
const { sendSupportMessage } = require('../controllers/support.controller');

const router = express.Router();

router.post('/contact', authenticate, sendSupportMessage);

module.exports = router;
