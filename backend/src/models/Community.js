const mongoose = require('mongoose');

const communitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Community name is required.'],
      trim: true,
      maxlength: [120, 'Community name cannot exceed 120 characters.'],
    },
    baseFare: {
      type: Number,
      default: 25,
      min: [0, 'Base fare cannot be negative'],
    },

    // Multiplier applied to baseFare for priority rides. Admin-editable.
    // Priority fare = baseFare × priorityFareMultiplier
    priorityFareMultiplier: {
      type: Number,
      default: 1.5,
      min: [1.0, 'Priority multiplier must be at least 1.0'],
      max: [10.0, 'Priority multiplier cannot exceed 10.0'],
    },
    boundaries: {
      type: {
        type: String,
        enum: ['Polygon'],
        default: 'Polygon',
      },
      coordinates: {
        type: [[[Number]]],
        default: undefined,
      },
    },
    branding: {
      primaryColor: { type: String, default: '#6366f1' },
      logoUrl: { type: String, default: '' },
    },
    fixedDestinations: {
      type: [{
        name: {
          type: String,
          required: true,
          trim: true,
          maxlength: [120, 'Destination name cannot exceed 120 characters.'],
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
        pickupRadiusMeters: {
          type: Number,
          default: 80,
          min: [1, 'Pickup radius must be at least 1 meter.'],
          max: [10000, 'Pickup radius cannot exceed 10000 meters.'],
        },
        color: {
          type: String,
          default: '#94a3b8', // default slate color
        },
        order: {
          type: Number,
          default: 0,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
      }],
      default: [],
    },
    // Phase-specific geofences for sub-areas within the community
    phaseGeofences: {
      type: [{
        name: {
          type: String,
          required: true,
          trim: true,
          lowercase: true,
          maxlength: [40, 'Phase name cannot exceed 40 characters.'],
        },
        boundaries: {
          type: {
            type: String,
            enum: ['Polygon'],
            required: true,
          },
          coordinates: {
            type: [[[Number]]],
            required: true,
          },
        },
        color: {
          type: String,
          default: '#6366f1',
        },
        isActive: {
          type: Boolean,
          default: true,
        },
        order: {
          type: Number,
          default: 0,
        },
      }],
      default: [],
    },
    discountSettings: {
      type: new mongoose.Schema(
        {
          enabled: {
            type: Boolean,
            default: false,
          },
          studentPct: {
            type: Number,
            default: 0,
            min: [0, 'Discount cannot be negative'],
            max: [100, 'Discount cannot exceed 100%'],
          },
          pwdPct: {
            type: Number,
            default: 0,
            min: [0, 'Discount cannot be negative'],
            max: [100, 'Discount cannot exceed 100%'],
          },
          seniorPct: {
            type: Number,
            default: 0,
            min: [0, 'Discount cannot be negative'],
            max: [100, 'Discount cannot exceed 100%'],
          },
        },
        { _id: false }
      ),
      default: () => ({ enabled: false, studentPct: 0, pwdPct: 0, seniorPct: 0 }),
    },
    opsBypassMode: {
      type: Boolean,
      default: false,
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

communitySchema.index({ isActive: 1 });
communitySchema.index({ 'fixedDestinations.location': '2dsphere' });

module.exports = mongoose.model('Community', communitySchema);
