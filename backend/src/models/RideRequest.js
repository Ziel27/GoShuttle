const mongoose = require('mongoose');

const RIDE_REQUEST_STATUSES = ['pending', 'boarded', 'completed', 'cancelled', 'ignored'];
const RIDE_REQUEST_RESOLUTIONS = ['no_show', 'late_manual', 'expired', 'passenger_cancel'];

const rideRequestSchema = new mongoose.Schema(
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
      required: false,
      default: null,
      index: true,
    },
    // For delegated/guest bookings when passengerId is not set
    passengerName: {
      type: String,
      trim: true,
      default: null,
    },
    passengerPhone: {
      type: String,
      trim: true,
      default: null,
    },
    // Who created the booking (may be same as passengerId)
    bookingOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    shuttleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shuttle',
      default: null,
    },
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      default: null,
    },
    pickupRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PickupRequest',
      default: null,
    },
    pickupLocation: {
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
    passengerHomePhase: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [40, 'Passenger home phase cannot exceed 40 characters.'],
      default: null,
      index: true,
    },
    destination: {
      type: {
        type: String,
        enum: ['fixed', 'home'],
        required: true,
      },
      label: {
        type: String,
        trim: true,
        maxlength: [120, 'Destination label cannot exceed 120 characters.'],
        required: true,
      },
      location: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
        },
        coordinates: {
          type: [Number],
          required: true,
        },
      },
    },
    fareExpected: {
      type: Number,
      required: [true, 'Expected fare is required'],
      min: [0, 'Fare cannot be negative'],
    },
    status: {
      type: String,
      enum: {
        values: RIDE_REQUEST_STATUSES,
        message: 'Status must be one of: pending, boarded, completed, cancelled, ignored',
      },
      default: 'pending',
      index: true,
    },
    resolution: {
      type: String,
      enum: {
        values: [...RIDE_REQUEST_RESOLUTIONS, null],
        message: 'Resolution must be one of: no_show, late_manual, expired, passenger_cancel',
      },
      default: null,
    },
    boardedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ─────────────────────────────────────────────────────
// Shift-end gate: "all pending requests in community since shift start"
rideRequestSchema.index({ communityId: 1, status: 1, createdAt: -1 });
rideRequestSchema.index({ communityId: 1, status: 1, passengerHomePhase: 1, createdAt: -1 });

// Passenger ride history
rideRequestSchema.index({ passengerId: 1, createdAt: -1 });

// Per-trip summary
rideRequestSchema.index({ tripId: 1, status: 1 });

// Link back to ephemeral pickup request (non-unique: multiple guests share one PickupRequest)
rideRequestSchema.index(
  { pickupRequestId: 1 },
  {
    partialFilterExpression: {
      pickupRequestId: { $type: 'objectId' },
    },
  }
);

// Geospatial indexes
rideRequestSchema.index({ pickupLocation: '2dsphere' });

module.exports = mongoose.model('RideRequest', rideRequestSchema);
module.exports.RIDE_REQUEST_STATUSES = RIDE_REQUEST_STATUSES;
module.exports.RIDE_REQUEST_RESOLUTIONS = RIDE_REQUEST_RESOLUTIONS;
