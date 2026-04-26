const mongoose = require('mongoose');

const FARE_TYPES = ['standard', 'priority'];

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
    passengerHomePhase: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [40, 'Passenger home phase cannot exceed 40 characters.'],
      default: null,
      index: true,
    },
    fareType: {
      type: String,
      enum: FARE_TYPES,
      default: 'standard',
      index: true,
    },

    assignedShuttleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shuttle',
      default: null,
    },

    assignedDriverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    dispatchedAt: {
      type: Date,
      default: null,
    },

    // null = dispatched, number >= 0 = waiting in queue
    queuePosition: {
      type: Number,
      default: null,
    },

    status: {
      type: String,
      enum: ['pending', 'claimed', 'dispatched', 'queued', 'bumped', 'expired', 'cancelled'],
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
pickupRequestSchema.index({ communityId: 1, status: 1, passengerHomePhase: 1, createdAt: -1 });

// Waiting queue: priority-first, then FIFO
pickupRequestSchema.index({ communityId: 1, status: 1, fareType: -1, createdAt: 1 });

// Dispatch lookup: find passenger's active dispatched request
pickupRequestSchema.index({ passengerId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('PickupRequest', pickupRequestSchema);
module.exports.FARE_TYPES = FARE_TYPES;
