const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['admin', 'driver', 'passenger'];
const STATUSES = ['active', 'offline', 'driving'];

const userSchema = new mongoose.Schema(
  {
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: [true, 'Community assignment is required'],
      index: true,
    },

    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters'],
    },

    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters'],
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address',
      ],
    },

    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Never return password in queries by default
    },

    role: {
      type: String,
      enum: {
        values: ROLES,
        message: 'Role must be one of: admin, driver, passenger',
      },
      default: 'passenger',
    },

    status: {
      type: String,
      enum: {
        values: STATUSES,
        message: 'Status must be one of: active, offline, driving',
      },
      default: 'offline',
    },

    phone: {
      type: String,
      trim: true,
      default: '',
    },

    // Passenger home phase (e.g., phase_1). Used for phase-scoped dispatching.
    homePhase: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [40, 'Home phase cannot exceed 40 characters.'],
      default: null,
      index: true,
    },

    homeDestination: {
      type: new mongoose.Schema(
        {
          label: {
            type: String,
            trim: true,
            maxlength: [120, 'Home destination label cannot exceed 120 characters.'],
            default: 'Home',
          },
          location: {
            type: {
              type: String,
              enum: ['Point'],
              required: true,
            },
            coordinates: {
              type: [Number], // [longitude, latitude]
              required: true,
              validate: {
                validator: (coords) =>
                  Array.isArray(coords) &&
                  coords.length === 2 &&
                  Number.isFinite(coords[0]) &&
                  Number.isFinite(coords[1]),
                message: 'Home destination coordinates must be a valid [longitude, latitude] pair.',
              },
            },
          },
          updatedAt: {
            type: Date,
            default: null,
          },
        },
        { _id: false }
      ),
      default: undefined,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    warnings: {
      type: [
        new mongoose.Schema(
          {
            note: {
              type: String,
              required: true,
              trim: true,
              maxlength: [500, 'Warning note cannot exceed 500 characters.'],
            },
            issuedBy: {
              type: String,
              required: true,
              trim: true,
            },
            date: {
              type: Date,
              default: Date.now,
            },
          },
          { _id: true }
        ),
      ],
      default: [],
    },

    discountVerification: {
      type: new mongoose.Schema(
        {
          type: {
            type: String,
            enum: ['student', 'pwd', 'senior'],
            required: true,
          },
          status: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending',
          },
          idImageUrl: {
            type: String,
            default: null,
          },
          idImagePublicId: {
            type: String,
            default: null,
          },
          submittedAt: {
            type: Date,
            default: Date.now,
          },
          reviewedAt: {
            type: Date,
            default: null,
          },
          reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
          },
          rejectionReason: {
            type: String,
            default: null,
          },
        },
        { _id: false }
      ),
      default: undefined,
    },

    resetPasswordCodeHash: {
      type: String,
      default: null,
      select: false,
    },

    resetPasswordCodeExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ─────────────────────────────────────────────────────
// Multi-tenant scoped queries: "all drivers in this community"
userSchema.index({ communityId: 1, role: 1, isActive: 1 });
userSchema.index({ communityId: 1, role: 1, homePhase: 1, isActive: 1 });
userSchema.index(
  { 'homeDestination.location': '2dsphere' },
  {
    sparse: true,
    partialFilterExpression: {
      'homeDestination.location.type': 'Point',
      'homeDestination.location.coordinates.1': { $exists: true },
    },
  }
);

// ─── Pre-save: Hash password ─────────────────────────────────────
userSchema.pre('save', async function (next) {
  // Only hash if password was modified (or is new)
  if (!this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ─── Instance method: Compare password ───────────────────────────
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ─── Strip sensitive fields from JSON output ─────────────────────
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
module.exports.STATUSES = STATUSES;
