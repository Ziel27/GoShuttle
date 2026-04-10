const mongoose = require('mongoose');

const pickupRequestSchema = new mongoose.Schema(
  {
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: [true, 'Community assignment is required'],
      index: true,
    },
    passengerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Passenger assignment is required'],
      index: true,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: [true, 'Pickup coordinates are required'],
      },
    },
    destinationType: {
      type: String,
      enum: ['fixed', 'home'],
      required: true,
      default: 'fixed',
      index: true,
    },
    destinationLabel: {
      type: String,
      trim: true,
      maxlength: [120, 'Destination label cannot exceed 120 characters.'],
      required: true,
    },
    destinationLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: [true, 'Destination coordinates are required'],
      },
    },
    status: {
      type: String,
      enum: ['pending', 'claimed', 'expired'],
      default: 'pending',
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

pickupRequestSchema.index({ location: '2dsphere' });
pickupRequestSchema.index({ destinationLocation: '2dsphere' });
pickupRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
pickupRequestSchema.index({ communityId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('PickupRequest', pickupRequestSchema);
