const mongoose = require('mongoose');

const REMITTANCE_STATUSES = ['pending', 'verified', 'flagged'];

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
      required: [true, 'Actual amount is required.'],
      min: [0, 'Actual amount cannot be negative.'],
    },

    varianceAmount: {
      type: Number,
      required: true,
      default: 0,
    },

    submittedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },

    status: {
      type: String,
      enum: {
        values: REMITTANCE_STATUSES,
        message: 'Status must be one of: pending, verified, flagged',
      },
      default: 'pending',
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
  },
  {
    timestamps: true,
  }
);

shiftRemittanceSchema.index({ communityId: 1, submittedAt: -1 });
shiftRemittanceSchema.index({ driverId: 1, submittedAt: -1 });

module.exports = mongoose.model('ShiftRemittance', shiftRemittanceSchema);
module.exports.REMITTANCE_STATUSES = REMITTANCE_STATUSES;
