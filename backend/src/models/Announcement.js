const mongoose = require('mongoose');

const ANNOUNCEMENT_LEVELS = ['info', 'warning', 'critical'];

const announcementSchema = new mongoose.Schema(
  {
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: [true, 'Community is required.'],
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Created by is required.'],
      index: true,
    },
    title: {
      type: String,
      trim: true,
      required: [true, 'Title is required.'],
      maxlength: [120, 'Title cannot exceed 120 characters.'],
    },
    body: {
      type: String,
      trim: true,
      required: [true, 'Body is required.'],
      maxlength: [2000, 'Body cannot exceed 2000 characters.'],
    },
    level: {
      type: String,
      enum: {
        values: ANNOUNCEMENT_LEVELS,
        message: 'Level must be one of: info, warning, critical',
      },
      default: 'info',
      index: true,
    },
  },
  { timestamps: true }
);

announcementSchema.index({ communityId: 1, createdAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);
module.exports.ANNOUNCEMENT_LEVELS = ANNOUNCEMENT_LEVELS;
