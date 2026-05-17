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
    // Optional explicit pickup location when booking for someone else or specifying a pickup point
    pickupLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: null,
      },
    },
    // Booking owner when someone creates a request on behalf of others
    bookingOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    // Optional passenger manifest to support group/delegated bookings
    passengerManifest: [
      {
        passengerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        name: { type: String, trim: true, default: null },
        phone: { type: String, trim: true, default: null },
      },
    ],
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
    pickupLabel: {
      type: String,
      trim: true,
      maxlength: [500, 'Pickup label cannot exceed 500 characters.'],
      default: null,
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
    destinationRadiusMeters: {
      type: Number,
      default: null,
    },
    destinationFixedId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
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
    note: {
      type: String,
      trim: true,
      maxlength: [300, 'Note cannot exceed 300 characters.'],
      default: null,
    },

    trackingToken: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: null,
    },

    trackingMode: {
      type: String,
      enum: ['driver', 'passenger'],
      default: 'passenger',
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
