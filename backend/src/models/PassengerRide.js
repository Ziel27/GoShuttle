const mongoose = require('mongoose');

const passengerRideSchema = new mongoose.Schema(
  {
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: true,
      index: true,
    },
    passengerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null,
      index: true,
    },
    // Link back to the permanent RideRequest when available
    rideRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RideRequest',
      default: null,
      index: true,
    },
    // For guest/delegated entries when passengerId is not provided
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
    shuttleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shuttle',
      required: true,
      index: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      required: true,
      index: true,
    },
    fareAtBoarding: {
      type: Number,
      required: true,
      min: 0,
    },
    pickupLocation: {
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
        required: true,
      },
    },
    // Whether the stored destination is a fallback (e.g. copied from pickup/shuttle
    // location because a proper destination was not available). Clients may hide
    // or de-emphasize markers where this is true.
    destinationIsFallback: {
      type: Boolean,
      default: false,
      index: true,
    },
    requestedAt: {
      type: Date,
      required: true,
    },
    boardedAt: {
      type: Date,
      required: true,
      index: true,
    },
    unboardedAt: {
      type: Date,
      default: null,
      index: true,
    },
    unboardLocation: {
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
    status: {
      type: String,
      enum: ['boarded', 'unboarded'],
      default: 'boarded',
      index: true,
    },

    discountType: {
      type: String,
      enum: ['student', 'pwd', 'senior', 'none'],
      default: 'none',
    },
    originalFare: {
      type: Number,
      default: null,
      min: 0,
    },
    discountRevoked: {
      type: Boolean,
      default: false,
    },
    discountRevokedAt: {
      type: Date,
      default: null,
    },
    discountRevokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

passengerRideSchema.index({ passengerId: 1, boardedAt: -1 });
passengerRideSchema.index({ communityId: 1, boardedAt: -1 });
passengerRideSchema.index({ status: 1, tripId: 1 });
passengerRideSchema.index({ destinationLocation: '2dsphere' });

module.exports = mongoose.model('PassengerRide', passengerRideSchema);
