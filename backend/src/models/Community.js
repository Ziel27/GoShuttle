const mongoose = require('mongoose');

const communitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Community name is required'],
      trim: true,
      unique: true,
      maxlength: [100, 'Community name cannot exceed 100 characters'],
    },

    // GeoJSON Polygon — defines the exact geographic borders of the community
    // Used by $geoIntersects to validate shuttle GPS positions
    boundaries: {
      type: {
        type: String,
        enum: ['Polygon'],
        required: true,
      },
      coordinates: {
        type: [[[Number]]], // Array of arrays of [lng, lat] pairs
        required: [true, 'Community boundaries are required'],
      },
    },

    baseFare: {
      type: Number,
      required: [true, 'Base fare is required'],
      min: [0, 'Base fare cannot be negative'],
    },

    // White-label customization per community
    branding: {
      primaryColor: {
        type: String,
        default: '#1E3A5F', // Deep Navy
      },
      logoUrl: {
        type: String,
        default: '',
      },
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// 2dsphere index — required for $geoIntersects / $geoWithin queries
communitySchema.index({ boundaries: '2dsphere' });

// Compound index for active community lookups
communitySchema.index({ isActive: 1, name: 1 });

module.exports = mongoose.model('Community', communitySchema);
