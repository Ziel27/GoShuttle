const express = require('express');
const {
  submitDiscountVerification,
  getMyDiscountVerification,
  listDiscountVerifications,
  reviewDiscountVerification,
  revokePassengerDiscount,
} = require('../controllers/discount.controller');
const { authenticate, authorize } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.use(authenticate);

router.get('/me/discount-verification', authorize('passenger'), getMyDiscountVerification);
router.post('/me/discount-verification', authorize('passenger'), upload.single('idPhoto'), submitDiscountVerification);

router.get('/communities/:id/discount-verifications', authorize('admin'), listDiscountVerifications);
router.patch('/communities/:id/discount-verifications/:userId', authorize('admin'), reviewDiscountVerification);

module.exports = router;
