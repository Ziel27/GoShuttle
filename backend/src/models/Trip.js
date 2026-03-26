const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema(
  {
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: [true, 'Community assignment is required'],
      index: true,
    },

    shuttleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shuttle',
      required: [true, 'Shuttle assignment is required'],
    },

    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Driver assignment is required'],
    },

    // ─── Boarding & Revenue ──────────────────────────────────────
    // passengersBoarded is incremented via the driver's "+1 Passenger" button.
    // This is the SINGLE SOURCE OF TRUTH for capacity and revenue,
    // accounting for both app users and walk-ins.
    passengersBoarded: {
      type: Number,
      default: 0,
      min: [0, 'Passengers boarded cannot be negative'],
    },

    // Revenue is calculated server-side: passengersBoarded × community.baseFare
    // Stored as a snapshot so historical data survives fare changes.
    revenueCollected: {
      type: Number,
      default: 0,
      min: [0, 'Revenue cannot be negative'],
    },

    fareAtTime: {
      type: Number,
      required: [true, 'Fare at time of trip is required'],
      min: [0, 'Fare cannot be negative'],
    },

    // ─── Shift Tracking ──────────────────────────────────────────
    shiftStart: {
      type: Date,
      default: Date.now,
    },

    shiftEnd: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: {
        values: ['active', 'completed', 'synced'],
        message: 'Status must be one of: active, completed, synced',
      },
      default: 'active',
    },

    // ─── Offline Sync ────────────────────────────────────────────
    // If the driver was offline, the client caches data locally
    // and syncs it later. This field stores the client-side UUID
    // to ensure idempotent upserts (no duplicate trip records).
    clientSyncId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ─────────────────────────────────────────────────────
// Analytics queries: "revenue for community X in date range"
tripSchema.index({ communityId: 1, shiftStart: -1 });

// Driver shift history: "all trips by driver Y"
tripSchema.index({ driverId: 1, shiftStart: -1 });

// Idempotent offline sync: prevent duplicate trip creation
tripSchema.index({ clientSyncId: 1 }, { unique: true, sparse: true });

// ─── Virtual: calculated revenue (real-time check) ───────────────
tripSchema.virtual('calculatedRevenue').get(function () {
  return this.passengersBoarded * this.fareAtTime;
});

tripSchema.set('toJSON', { virtuals: true });
tripSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Trip', tripSchema);
