const Announcement = require('../models/Announcement');

const clampInt = (value, fallback, { min = 1, max = 100 } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const asInt = Math.floor(parsed);
  return Math.max(min, Math.min(max, asInt));
};

/**
 * GET /api/announcements
 * Returns recent announcements for the authenticated user's community.
 */
const listAnnouncements = async (req, res) => {
  const limit = clampInt(req.query?.limit, 20, { min: 1, max: 100 });
  const before = req.query?.before ? new Date(String(req.query.before)) : null;

  const query = {
    communityId: req.user.communityId,
  };

  if (before && !Number.isNaN(before.getTime())) {
    query.createdAt = { $lt: before };
  }

  const items = await Announcement.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('createdBy', 'firstName lastName email role');

  return res.json({ announcements: items });
};

/**
 * POST /api/announcements
 * Admin-only. Creates a new announcement for the authenticated admin's community.
 */
const createAnnouncement = async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  const level = String(req.body?.level || 'info').trim();

  if (!title) return res.status(400).json({ error: 'Title is required.' });
  if (!body) return res.status(400).json({ error: 'Body is required.' });

  const announcement = await Announcement.create({
    communityId: req.user.communityId,
    createdBy: req.user._id,
    title,
    body,
    level,
  });

  const populated = await Announcement.findById(announcement._id).populate(
    'createdBy',
    'firstName lastName email role'
  );

  // Optional: broadcast to community room if client listens.
  try {
    const io = req.app?.get('io');
    if (io) {
      io.to(`community:${String(req.user.communityId)}`).emit('announcement:new', populated);
    }
  } catch {
    // ignore broadcast errors
  }

  return res.status(201).json({ announcement: populated });
};

module.exports = { listAnnouncements, createAnnouncement };
