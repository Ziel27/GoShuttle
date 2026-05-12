const mongoose = require('mongoose');
const User = require('../models/User');
const Community = require('../models/Community');
const PassengerRide = require('../models/PassengerRide');
const Trip = require('../models/Trip');
const { uploadDiscountIdImage } = require('../services/cloudinary');

const VALID_DISCOUNT_TYPES = ['student', 'pwd', 'senior'];

/**
 * POST /api/users/me/discount-verification
 * Passenger submits their ID photo for discount verification.
 */
const submitDiscountVerification = async (req, res) => {
  try {
    if (req.user.role !== 'passenger') {
      return res.status(403).json({ error: 'Only passengers can submit discount verification.' });
    }

    const { discountType } = req.body;
    if (!VALID_DISCOUNT_TYPES.includes(discountType)) {
      return res.status(400).json({ error: 'discountType must be one of: student, pwd, senior.' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'An ID photo is required.' });
    }

    const { secureUrl, publicId } = await uploadDiscountIdImage({
      buffer: req.file.buffer,
      userId: req.user._id,
      communityId: req.user.communityId,
    });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        discountVerification: {
          type: discountType,
          status: 'pending',
          idImageUrl: secureUrl,
          idImagePublicId: publicId,
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedBy: null,
          rejectionReason: null,
        },
      },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.status(200).json({
      message: 'Discount verification submitted. An admin will review your ID shortly.',
      discountVerification: user.discountVerification,
    });
  } catch (error) {
    console.error('Submit discount verification error:', error);
    return res.status(500).json({ error: 'Failed to submit discount verification.' });
  }
};

/**
 * GET /api/users/me/discount-verification
 * Passenger gets their own discount verification status.
 */
const getMyDiscountVerification = async (req, res) => {
  try {
    if (req.user.role !== 'passenger') {
      return res.status(403).json({ error: 'Only passengers can view discount verification.' });
    }

    const user = await User.findById(req.user._id).select('discountVerification').lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.status(200).json({
      discountVerification: user.discountVerification || null,
    });
  } catch (error) {
    console.error('Get discount verification error:', error);
    return res.status(500).json({ error: 'Failed to fetch discount verification.' });
  }
};

/**
 * GET /api/communities/:id/discount-verifications
 * Admin lists all discount verification requests in their community.
 */
const listDiscountVerifications = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid community ID.' });
    }

    if (String(req.user.communityId) !== String(id)) {
      return res.status(403).json({ error: 'Access denied. You can only view your own community.' });
    }

    const { status } = req.query;
    const query = {
      communityId: id,
      role: 'passenger',
      'discountVerification': { $exists: true, $ne: null },
    };

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query['discountVerification.status'] = status;
    }

    const users = await User.find(query)
      .select('firstName lastName email discountVerification')
      .sort({ 'discountVerification.submittedAt': -1 })
      .lean();

    return res.status(200).json({
      count: users.length,
      verifications: users.map((u) => {
        const dv = u.discountVerification;
        const isExpired = dv?.validUntil && new Date() > dv.validUntil;
        const daysUntilExpiry = dv?.validUntil
          ? Math.ceil((dv.validUntil - new Date()) / (1000 * 60 * 60 * 24))
          : null;

        return {
          userId: String(u._id),
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          discountType: dv?.type ?? null,
          status: isExpired ? 'expired' : (dv?.status ?? 'pending'),
          idImageUrl: dv?.idImageUrl ?? null,
          submittedAt: dv?.submittedAt ?? null,
          reviewedAt: dv?.reviewedAt ?? null,
          rejectionReason: dv?.rejectionReason ?? null,
          validFrom: dv?.validFrom ?? null,
          validUntil: dv?.validUntil ?? null,
          daysUntilExpiry,
          isExpired,
        };
      }),
    });
  } catch (error) {
    console.error('List discount verifications error:', error);
    return res.status(500).json({ error: 'Failed to fetch discount verifications.' });
  }
};

/**
 * PATCH /api/communities/:id/discount-verifications/:userId
 * Admin approves or rejects a passenger's discount verification.
 */
const reviewDiscountVerification = async (req, res) => {
  try {
    const { id, userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid ID.' });
    }

    if (String(req.user.communityId) !== String(id)) {
      return res.status(403).json({ error: 'Access denied. You can only review your own community.' });
    }

    const { action, rejectionReason, validityMonths } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be approve or reject.' });
    }
    const status = action === 'approve' ? 'approved' : 'rejected';

    if (status === 'rejected' && (!rejectionReason || !String(rejectionReason).trim())) {
      return res.status(400).json({ error: 'rejectionReason is required when rejecting.' });
    }

    if (status === 'approved' && validityMonths !== undefined) {
      const months = Number(validityMonths);
      if (!Number.isInteger(months) || months < 1 || months > 60) {
        return res.status(400).json({ error: 'validityMonths must be an integer between 1 and 60.' });
      }
    }

    const user = await User.findOne({ _id: userId, communityId: id, role: 'passenger' });
    if (!user) {
      return res.status(404).json({ error: 'Passenger not found in this community.' });
    }

    if (!user.discountVerification) {
      return res.status(404).json({ error: 'This passenger has no pending discount verification.' });
    }

    user.discountVerification.status = status;
    user.discountVerification.reviewedAt = new Date();
    user.discountVerification.reviewedBy = req.user._id;
    user.discountVerification.rejectionReason = status === 'rejected'
      ? String(rejectionReason).trim()
      : null;

    // Set validity dates when approving
    if (status === 'approved') {
      const months = validityMonths ? Number(validityMonths) : 12; // Default: 12 months
      const validFrom = new Date();
      const validUntil = new Date(validFrom);
      validUntil.setMonth(validUntil.getMonth() + months);

      user.discountVerification.validFrom = validFrom;
      user.discountVerification.validUntil = validUntil;
      user.discountVerification.expirationNotificationSent = false;
    }

    await user.save();

    return res.status(200).json({
      message: `Discount verification ${status}.`,
      discountVerification: user.discountVerification,
    });
  } catch (error) {
    console.error('Review discount verification error:', error);
    return res.status(500).json({ error: 'Failed to review discount verification.' });
  }
};

/**
 * PATCH /api/trips/rides/:rideId/revoke-discount
 * Driver revokes a passenger's discount. Fare is reset to full baseFare.
 * Works with auto-pickup/auto-dropoff: driver can revoke anytime after boarding.
 */
const revokePassengerDiscount = async (req, res) => {
  try {
    if (req.user.role !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can revoke discounts.' });
    }

    const { rideId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(rideId)) {
      return res.status(400).json({ error: 'Invalid ride ID.' });
    }

    const ride = await PassengerRide.findById(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found.' });
    }

    if (ride.driverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied. This ride is not on your trip.' });
    }

    if (ride.status !== 'boarded') {
      return res.status(409).json({ error: 'Can only revoke discount for currently boarded passengers.' });
    }

    if (ride.discountType === 'none' || !ride.originalFare) {
      return res.status(409).json({ error: 'This passenger has no active discount to revoke.' });
    }

    if (ride.discountRevoked) {
      return res.status(409).json({ error: 'Discount has already been revoked for this passenger.' });
    }

    const fareDifference = ride.originalFare - ride.fareAtBoarding;

    ride.discountRevoked = true;
    ride.discountRevokedAt = new Date();
    ride.discountRevokedBy = req.user._id;
    ride.fareAtBoarding = ride.originalFare;
    await ride.save();

    if (fareDifference > 0) {
      await Trip.findByIdAndUpdate(ride.tripId, {
        $inc: { revenueCollected: fareDifference },
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`community:${String(ride.communityId)}`).emit('trip:discount-revoked', {
        rideId: ride._id,
        passengerId: ride.passengerId,
        passengerName: ride.passengerName,
        tripId: ride.tripId,
        fareDifference,
        newFare: ride.fareAtBoarding,
      });
    }

    return res.status(200).json({
      message: 'Discount revoked. Passenger will be charged the full fare.',
      ride,
      fareDifference,
    });
  } catch (error) {
    console.error('Revoke passenger discount error:', error);
    return res.status(500).json({ error: 'Failed to revoke discount.' });
  }
};

/**
 * GET /api/users/me/discount-verification-status
 * Passenger gets their ID verification expiration status
 */
const getMyVerificationExpirationStatus = async (req, res) => {
  try {
    if (req.user.role !== 'passenger') {
      return res.status(403).json({ error: 'Only passengers can view this.' });
    }

    const user = await User.findById(req.user._id).select('discountVerification').lean();
    if (!user || !user.discountVerification) {
      return res.status(200).json({
        hasVerification: false,
        discountVerification: null,
      });
    }

    const dv = user.discountVerification;
    const now = new Date();
    const isExpired = dv.validUntil && now > dv.validUntil;
    const daysUntilExpiry = dv.validUntil
      ? Math.ceil((dv.validUntil - now) / (1000 * 60 * 60 * 24))
      : null;

    return res.status(200).json({
      hasVerification: true,
      discountVerification: {
        type: dv.type,
        status: isExpired ? 'expired' : dv.status,
        validFrom: dv.validFrom,
        validUntil: dv.validUntil,
        daysUntilExpiry,
        isExpired,
        expirationNotificationSent: dv.expirationNotificationSent,
      },
    });
  } catch (error) {
    console.error('Get verification expiration status error:', error);
    return res.status(500).json({ error: 'Failed to fetch verification status.' });
  }
};

module.exports = {
  submitDiscountVerification,
  getMyDiscountVerification,
  listDiscountVerifications,
  reviewDiscountVerification,
  revokePassengerDiscount,
  getMyVerificationExpirationStatus,
};
