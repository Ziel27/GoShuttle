const mongoose = require('mongoose');

const SHUTTLE_STATUSES = ['idle', 'en_route', 'out_of_bounds', 'maintenance'];

const shuttleSchema = new mongoose.Schema(
  {
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: [true, 'Community assignment is required'],
      index: true,
    },

    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // null = unassigned
    },

    plateNumber: {
      type: String,
      required: [true, 'Plate number is required'],
      trim: true,
      uppercase: true,
      unique: true,
      maxlength: [15, 'Plate number cannot exceed 15 characters'],
    },

    label: {
      type: String,
      trim: true,
      default: '', // e.g., "Shuttle #3" or "Blue Van"
    },

    // Null means this shuttle can serve all phases.
    // When set (e.g., phase_1), dispatch is restricted to matching passenger phase.
    assignedPhase: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [40, 'Assigned phase cannot exceed 40 characters.'],
      default: null,
      index: true,
    },

    maxCapacity: {
      type: Number,
      required: [true, 'Maximum capacity is required'],
      min: [1, 'Capacity must be at least 1'],
      max: [50, 'Capacity cannot exceed 50'],
    },

    currentCapacity: {
      type: Number,
      default: 0,
      min: [0, 'Current capacity cannot be negative'],
    },

    // Seats pre-reserved for dispatched-but-not-yet-boarded passengers.
    // Effective capacity = currentCapacity + pendingPickupCount.
    // Atomically incremented by dispatch service, decremented on physical board or cancel.
    pendingPickupCount: {
      type: Number,
      default: 0,
      min: [0, 'Pending pickup count cannot be negative'],
    },

    // GeoJSON Point — updated in real-time via Socket.io
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
    },

    status: {
      type: String,
      enum: {
        values: SHUTTLE_STATUSES,
        message: 'Status must be one of: idle, en_route, out_of_bounds, maintenance',
      },
      default: 'idle',
    },

    lastLocationUpdate: {
      type: Date,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ─────────────────────────────────────────────────────
// Geospatial index for proximity / $geoIntersects queries
shuttleSchema.index({ location: '2dsphere' });

// "All active shuttles in community X" — the most frequent query
shuttleSchema.index({ communityId: 1, status: 1, isActive: 1 });
shuttleSchema.index({ communityId: 1, assignedPhase: 1, isActive: 1 });

// One driver per shuttle (sparse: allows multiple nulls)
shuttleSchema.index({ driverId: 1 }, { sparse: true });

// ─── Virtual: capacity percentage ────────────────────────────────
shuttleSchema.virtual('capacityPercent').get(function () {
  if (this.maxCapacity === 0) return 0;
  return Math.round((this.currentCapacity / this.maxCapacity) * 100);
});

// ─── Virtual: capacity status label (for UI color coding) ───────
shuttleSchema.virtual('capacityStatus').get(function () {
  const percent = this.capacityPercent;
  if (percent >= 100) return 'full';       // Red
  if (percent >= 70) return 'filling';     // Yellow
  return 'available';                       // Green
});

// Include virtuals in JSON/Object output
shuttleSchema.set('toJSON', { virtuals: true });
shuttleSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Shuttle', shuttleSchema);
module.exports.SHUTTLE_STATUSES = SHUTTLE_STATUSES;
