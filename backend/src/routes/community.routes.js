const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Community = require('../models/Community');
const { authenticate, authorize } = require('../middleware/auth');

const parseCoordinate = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const ensureOwnCommunityScope = (req, res, communityId) => {
  if (!req.user?.communityId) {
    res.status(401).json({ error: 'Authentication required.' });
    return false;
  }

  if (String(req.user.communityId) !== String(communityId)) {
    res.status(403).json({ error: 'Access denied. You can only update your own community.' });
    return false;
  }

  return true;
};

const isValidPolygonCoordinates = (coordinates) => {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return false;

  for (const ring of coordinates) {
    if (!Array.isArray(ring) || ring.length < 4) return false;

    for (const point of ring) {
      if (!Array.isArray(point) || point.length !== 2) return false;
      const [lng, lat] = point;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return false;
    }
  }

  return true;
};

const validatePoint = (latitude, longitude) => {
  const lat = parseCoordinate(latitude);
  const lng = parseCoordinate(longitude);

  if (lat === null || lng === null) {
    return { valid: false, message: 'Latitude and longitude must be valid numbers.' };
  }

  if (lat < -90 || lat > 90) {
    return { valid: false, message: 'Latitude must be between -90 and 90.' };
  }

  if (lng < -180 || lng > 180) {
    return { valid: false, message: 'Longitude must be between -180 and 180.' };
  }

  return { valid: true, lat, lng };
};

const emitCommunitySettingsUpdated = (req, communityId, source, changed = {}) => {
  const io = req.app.get('io');
  if (!io) return;

  io.to(`community:${String(communityId)}`).emit('community:settings-updated', {
    communityId: String(communityId),
    source,
    changed,
    updatedAt: new Date().toISOString(),
  });
};

/**
 * GET /api/communities
 * Public — returns all active communities (used by the register screen picker).
 */
router.get('/', async (_req, res) => {
  try {
    const communities = await Community.find({ isActive: true })
      .select('name branding')
      .sort({ name: 1 })
      .lean();

    res.json({ communities });
  } catch (error) {
    console.error('GET /communities error:', error);
    res.status(500).json({ error: 'Failed to load communities.' });
  }
});

/**
 * GET /api/communities/:id
 * Authenticated — returns a single community (including boundaries for geofencing).
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!ensureOwnCommunityScope(req, res, req.params.id)) {
      return;
    }

    const community = await Community.findById(req.params.id).lean();

    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    res.json({ community });
  } catch (error) {
    console.error('GET /communities/:id error:', error);
    res.status(500).json({ error: 'Failed to load community.' });
  }
});

router.post('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, baseFare = 25, boundaries, branding } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required.' });
    }

    if (boundaries !== undefined) {
      if (
        boundaries?.type !== 'Polygon' ||
        !isValidPolygonCoordinates(boundaries?.coordinates)
      ) {
        return res.status(400).json({ error: 'Invalid GeoJSON Polygon boundaries.' });
      }
    }

    const community = await Community.create({
      name: String(name).trim(),
      baseFare: Number(baseFare) || 0,
      boundaries,
      branding,
      isActive: true,
    });

    return res.status(201).json({ message: 'Community created.', community });
  } catch (error) {
    console.error('POST /communities error:', error);
    return res.status(500).json({ error: 'Failed to create community.' });
  }
});

router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid community id.' });
    }

    if (!ensureOwnCommunityScope(req, res, id)) {
      return;
    }

    const update = {};
    if (req.body.name !== undefined) update.name = String(req.body.name).trim();
    if (req.body.baseFare !== undefined) update.baseFare = Number(req.body.baseFare);
    if (req.body.boundaries !== undefined) {
      if (
        req.body.boundaries?.type !== 'Polygon' ||
        !isValidPolygonCoordinates(req.body.boundaries?.coordinates)
      ) {
        return res.status(400).json({ error: 'Invalid GeoJSON Polygon boundaries.' });
      }
      update.boundaries = req.body.boundaries;
    }
    if (req.body.branding !== undefined) update.branding = req.body.branding;
    if (req.body.isActive !== undefined) update.isActive = Boolean(req.body.isActive);
    if (req.body.fixedDestinations !== undefined) update.fixedDestinations = req.body.fixedDestinations;

    const community = await Community.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true });
    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    emitCommunitySettingsUpdated(req, community._id, 'community:update', {
      name: req.body.name !== undefined,
      baseFare: req.body.baseFare !== undefined,
      boundaries: req.body.boundaries !== undefined,
      fixedDestinations: req.body.fixedDestinations !== undefined,
      branding: req.body.branding !== undefined,
    });

    return res.status(200).json({ message: 'Community updated.', community });
  } catch (error) {
    console.error('PUT /communities/:id error:', error);
    return res.status(500).json({ error: 'Failed to update community.' });
  }
});

router.get('/:id/fixed-destinations', authenticate, async (req, res) => {
  try {
    if (!ensureOwnCommunityScope(req, res, req.params.id)) {
      return;
    }

    const community = await Community.findById(req.params.id).select('fixedDestinations');
    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }
    return res.status(200).json({
      destinations: (community.fixedDestinations || []).sort((a, b) => (a.order || 0) - (b.order || 0)),
    });
  } catch (error) {
    console.error('GET /communities/:id/fixed-destinations error:', error);
    return res.status(500).json({ error: 'Failed to fetch fixed destinations.' });
  }
});

router.post('/:id/fixed-destinations', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, latitude, longitude, order = 0 } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid community id.' });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required.' });
    }

    if (!ensureOwnCommunityScope(req, res, id)) {
      return;
    }

    const coords = validatePoint(latitude, longitude);
    if (!coords.valid) {
      return res.status(400).json({ error: coords.message });
    }

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const exists = (community.fixedDestinations || []).some(
      (item) => String(item.name).trim().toLowerCase() === String(name).trim().toLowerCase() && item.isActive !== false
    );
    if (exists) {
      return res.status(409).json({ error: 'Destination name already exists for this community.' });
    }

    const destination = {
      name: String(name).trim(),
      location: { type: 'Point', coordinates: [coords.lng, coords.lat] },
      order: Number(order) || 0,
      isActive: true,
    };

    community.fixedDestinations.push(destination);
    await community.save();
    const created = community.fixedDestinations[community.fixedDestinations.length - 1];

    emitCommunitySettingsUpdated(req, community._id, 'destination:create', {
      fixedDestinations: true,
    });

    return res.status(201).json({ message: 'Destination added.', destination: created, destinations: community.fixedDestinations });
  } catch (error) {
    console.error('POST /communities/:id/fixed-destinations error:', error);
    return res.status(500).json({ error: 'Failed to add destination.' });
  }
});

router.patch('/:id/fixed-destinations/:destinationId', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id, destinationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(destinationId)) {
      return res.status(400).json({ error: 'Invalid id.' });
    }

    if (!ensureOwnCommunityScope(req, res, id)) {
      return;
    }

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const destination = (community.fixedDestinations || []).id(destinationId);
    if (!destination) {
      return res.status(404).json({ error: 'Destination not found.' });
    }

    if (req.body.name !== undefined) destination.name = String(req.body.name).trim();
    if (req.body.order !== undefined) destination.order = Number(req.body.order) || 0;
    if (req.body.isActive !== undefined) destination.isActive = Boolean(req.body.isActive);
    if (req.body.latitude !== undefined || req.body.longitude !== undefined) {
      const lat = req.body.latitude ?? destination.location.coordinates[1];
      const lng = req.body.longitude ?? destination.location.coordinates[0];
      const coords = validatePoint(lat, lng);
      if (!coords.valid) {
        return res.status(400).json({ error: coords.message });
      }
      destination.location = { type: 'Point', coordinates: [coords.lng, coords.lat] };
    }

    await community.save();

    emitCommunitySettingsUpdated(req, community._id, 'destination:update', {
      fixedDestinations: true,
    });

    return res.status(200).json({ message: 'Destination updated.', destination, destinations: community.fixedDestinations });
  } catch (error) {
    console.error('PATCH /communities/:id/fixed-destinations/:destinationId error:', error);
    return res.status(500).json({ error: 'Failed to update destination.' });
  }
});

router.delete('/:id/fixed-destinations/:destinationId', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { id, destinationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(destinationId)) {
      return res.status(400).json({ error: 'Invalid id.' });
    }

    if (!ensureOwnCommunityScope(req, res, id)) {
      return;
    }

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    const destination = (community.fixedDestinations || []).id(destinationId);
    if (!destination) {
      return res.status(404).json({ error: 'Destination not found.' });
    }

    destination.isActive = false;
    await community.save();

    emitCommunitySettingsUpdated(req, community._id, 'destination:archive', {
      fixedDestinations: true,
    });

    return res.status(200).json({ message: 'Destination archived.', destinations: community.fixedDestinations });
  } catch (error) {
    console.error('DELETE /communities/:id/fixed-destinations/:destinationId error:', error);
    return res.status(500).json({ error: 'Failed to remove destination.' });
  }
});

module.exports = router;
