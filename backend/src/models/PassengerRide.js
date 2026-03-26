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
      required: true,
      index: true,
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
    requestedAt: {
      type: Date,
      required: true,
    },
    boardedAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['completed'],
      default: 'completed',
    },
  },
  {
    timestamps: true,
  }
);

passengerRideSchema.index({ passengerId: 1, boardedAt: -1 });
passengerRideSchema.index({ communityId: 1, boardedAt: -1 });

module.exports = mongoose.model('PassengerRide', passengerRideSchema);
