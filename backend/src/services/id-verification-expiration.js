const User = require('../models/User');
const Announcement = require('../models/Announcement');

/**
 * Check for upcoming ID verification expirations and send notifications
 * Notifies users 14 days before expiration (if not already notified)
 */
const checkAndNotifyExpiringVerifications = async () => {
  try {
    const now = new Date();
    // Find users with verified IDs that expire in the next 14 days
    const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const expiringUsers = await User.find({
      'discountVerification.status': 'approved',
      'discountVerification.validUntil': {
        $lte: fourteenDaysFromNow,
        $gt: now,
      },
      'discountVerification.expirationNotificationSent': false,
      role: 'passenger',
      isActive: true,
    }).select('_id firstName lastName communityId discountVerification email');

    if (expiringUsers.length === 0) {
      console.log('[ID Verification] No expiring verifications to notify.');
      return { notified: 0 };
    }

    let notifiedCount = 0;

    for (const user of expiringUsers) {
      try {
        const daysUntilExpiry = Math.ceil(
          (user.discountVerification.validUntil - now) / (1000 * 60 * 60 * 24)
        );

        const announcement = new Announcement({
          communityId: user.communityId,
          recipientUserId: user._id,
          title: `Your ${user.discountVerification.type.toUpperCase()} Discount Verification Expires Soon`,
          content: `Your ${user.discountVerification.type.toUpperCase()} discount verification will expire in ${daysUntilExpiry} days. Please re-verify your ID to continue using your discount.`,
          type: 'alert',
          priority: 'high',
          actionLink: '/discount-verification',
          createdAt: now,
          expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
        });

        await announcement.save();

        // Mark as notified
        user.discountVerification.expirationNotificationSent = true;
        await user.save();

        notifiedCount++;
        console.log(`[ID Verification] Notified user ${user._id} about verification expiry in ${daysUntilExpiry} days.`);
      } catch (error) {
        console.error(`[ID Verification] Error notifying user ${user._id}:`, error);
      }
    }

    return { notified: notifiedCount };
  } catch (error) {
    console.error('[ID Verification] Error checking expiring verifications:', error);
    throw error;
  }
};

/**
 * Mark expired ID verifications as expired
 */
const markExpiredVerifications = async () => {
  try {
    const now = new Date();

    const result = await User.updateMany(
      {
        'discountVerification.status': 'approved',
        'discountVerification.validUntil': { $lt: now },
      },
      {
        $set: { 'discountVerification.status': 'expired' },
      }
    );

    if (result.modifiedCount > 0) {
      console.log(`[ID Verification] Marked ${result.modifiedCount} verifications as expired.`);
    }

    return result;
  } catch (error) {
    console.error('[ID Verification] Error marking expired verifications:', error);
    throw error;
  }
};

/**
 * Get a user's ID verification status with expiration details
 */
const getUserIdVerificationStatus = async (userId) => {
  try {
    const user = await User.findById(userId).select('discountVerification');

    if (!user || !user.discountVerification) {
      return null;
    }

    const dv = user.discountVerification;
    const now = new Date();
    const isExpired = dv.validUntil && now > dv.validUntil;
    const daysUntilExpiry = dv.validUntil
      ? Math.ceil((dv.validUntil - now) / (1000 * 60 * 60 * 24))
      : null;

    return {
      type: dv.type,
      status: isExpired ? 'expired' : dv.status,
      validFrom: dv.validFrom,
      validUntil: dv.validUntil,
      daysUntilExpiry,
      isExpired,
      reviewedAt: dv.reviewedAt,
      submittedAt: dv.submittedAt,
    };
  } catch (error) {
    console.error('[ID Verification] Error getting user verification status:', error);
    throw error;
  }
};

/**
 * Start the ID verification expiration check job
 * Runs every 6 hours to check for upcoming expirations and mark expired verifications
 */
const startIdVerificationExpirationJob = () => {
  // Run every 6 hours
  setInterval(() => {
    console.log('[ID Verification] Running expiration check...');
    markExpiredVerifications().catch(err => {
      console.error('[ID Verification] Error in background job:', err);
    });
    checkAndNotifyExpiringVerifications().catch(err => {
      console.error('[ID Verification] Error in background job:', err);
    });
  }, 6 * 60 * 60 * 1000);

  // Run shortly after startup
  setTimeout(() => {
    console.log('[ID Verification] Running initial expiration check...');
    markExpiredVerifications().catch(err => {
      console.error('[ID Verification] Error in background job:', err);
    });
    checkAndNotifyExpiringVerifications().catch(err => {
      console.error('[ID Verification] Error in background job:', err);
    });
  }, 30 * 1000);
};

module.exports = {
  checkAndNotifyExpiringVerifications,
  markExpiredVerifications,
  getUserIdVerificationStatus,
  startIdVerificationExpirationJob,
};
