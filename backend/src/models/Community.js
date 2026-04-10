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
