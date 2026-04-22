const mongoose = require('mongoose');

const REMITTANCE_STATUSES = ['not_submitted', 'pending', 'verified', 'flagged', 'overdue', 'escalated'];

const shiftRemittanceSchema = new mongoose.Schema(
  {
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: [true, 'Community is required.'],
      index: true,
    },

    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      required: [true, 'Trip is required.'],
      unique: true,
      index: true,
    },

    shuttleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shuttle',
      required: [true, 'Shuttle is required.'],
      index: true,
    },

    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Driver is required.'],
      index: true,
    },

    expectedAmount: {
      type: Number,
      required: [true, 'Expected amount is required.'],
      min: [0, 'Expected amount cannot be negative.'],
    },

    actualAmount: {
      type: Number,
      min: [0, 'Actual amount cannot be negative.'],
      default: null,
    },

    varianceAmount: {
      type: Number,
      required: true,
      default: 0,
    },

    submittedAt: {
      type: Date,
      default: null,
      index: true,
    },

    shift_ended_at: {
      type: Date,
      default: null,
      index: true,
    },

    deadline_at: {
      type: Date,
      default: null,
      index: true,
    },

    overdue_notified_driver_at: {
      type: Date,
      default: null,
    },

    escalated_at: {
      type: Date,
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: {
        values: REMITTANCE_STATUSES,
        message: 'Status must be one of: pending, verified, flagged',
      },
      default: 'not_submitted',
      index: true,
    },

    driverNote: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'Driver note cannot exceed 500 characters.'],
    },

    adminNote: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'Admin note cannot exceed 500 characters.'],
    },

    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    verifiedAt: {
      type: Date,
      default: null,
    },

    receiptUrl: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'Receipt URL cannot exceed 500 characters.'],
    },

    receiptUploadedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

shiftRemittanceSchema.index({ communityId: 1, submittedAt: -1 });
shiftRemittanceSchema.index({ driverId: 1, submittedAt: -1 });

module.exports = mongoose.model('ShiftRemittance', shiftRemittanceSchema);
module.exports.REMITTANCE_STATUSES = REMITTANCE_STATUSES;
