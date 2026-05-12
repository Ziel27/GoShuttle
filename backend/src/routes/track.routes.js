const express = require('express');
const { getTrackingInfo } = require('../controllers/trip.controller');

const router = express.Router();

router.get('/:token', getTrackingInfo);

module.exports = router;
