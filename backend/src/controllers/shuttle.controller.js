const mongoose = require('mongoose');
const validator = require('validator');
const Shuttle = require('../models/Shuttle');
const { isLocationInBoundary } = require('../services/geofence');

const parseCoordinate = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const validateCoordinates = (latitude, longitude) => {
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

/**
 * POST /api/shuttles
 * Admin creates a shuttle in their own community.
 */
const createShuttle = async (req, res) => {
  try {
    const { plateNumber, maxCapacity, label } = req.body;

    if (!plateNumber || maxCapacity === undefined) {
      return res.status(400).json({ error: 'plateNumber and maxCapacity are required.' });
    }

    if (!validator.isLength(String(plateNumber), { min: 3, max: 15 })) {
      return res.status(400).json({ error: 'Plate number must be between 3 and 15 characters.' });
    }

    const parsedCapacity = Number(maxCapacity);
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 50) {
      return res.status(400).json({ error: 'maxCapacity must be an integer between 1 and 50.' });
    }

    const shuttle = await Shuttle.create({
      communityId: req.user.communityId,
      plateNumber: String(plateNumber).trim().toUpperCase(),
      maxCapacity: parsedCapacity,
      label: label ? String(label).trim() : '',
    });

    return res.status(201).json({
      message: 'Shuttle created successfully.',
      shuttle,
    });
  } catch (error) {
    console.error('Create shuttle error:', error);

    if (error.code === 11000) {
      return res.status(409).json({ error: 'Plate number already exists.' });
    }

    return res.status(500).json({ error: 'Failed to create shuttle.' });
  }
};

/**
 * GET /api/shuttles
 * Lists active shuttles in the authenticated user's community.
 */
const listShuttles = async (req, res) => {
  try {
    const onlyActive = req.query.active !== 'false';

    const query = {
      communityId: req.user.communityId,
    };

    if (onlyActive) {
      query.isActive = true;
    }

    const shuttles = await Shuttle.find(query)
      .populate('driverId', 'firstName lastName status')
      .sort({ updatedAt: -1 });

    return res.status(200).json({ count: shuttles.length, shuttles });
  } catch (error) {
    console.error('List shuttles error:', error);
    return res.status(500).json({ error: 'Failed to fetch shuttles.' });
  }
};

/**
 * PUT /api/shuttles/:id/location
 * Driver updates shuttle GPS. Rejects out-of-bound coordinates and flags shuttle status.
 */
const updateShuttleLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid shuttle ID.' });
    }

    const coords = validateCoordinates(latitude, longitude);
    if (!coords.valid) {
      return res.status(400).json({ error: coords.message });
    }

    const shuttle = await Shuttle.findById(id);
    if (!shuttle || !shuttle.isActive) {
      return res.status(404).json({ error: 'Shuttle not found.' });
    }

    if (shuttle.communityId.toString() !== req.user.communityId.toString()) {
      return res.status(403).json({ error: 'Access denied. Shuttle is outside your community.' });
    }

    if (req.user.role === 'driver') {
      if (!shuttle.driverId || shuttle.driverId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Access denied. This shuttle is not assigned to you.' });
      }
    }

    const insideBoundary = await isLocationInBoundary({
      communityId: shuttle.communityId,
      latitude: coords.lat,
      longitude: coords.lng,
    });

    if (!insideBoundary) {
      shuttle.status = 'out_of_bounds';
      shuttle.lastLocationUpdate = new Date();
      await shuttle.save();

      return res.status(403).json({
        error: 'Location rejected. Coordinate is outside the community boundary.',
        status: shuttle.status,
      });
    }

    shuttle.location = {
      type: 'Point',
      coordinates: [coords.lng, coords.lat],
    };
    shuttle.lastLocationUpdate = new Date();
    if (shuttle.status === 'out_of_bounds' || shuttle.status === 'idle') {
      shuttle.status = 'en_route';
    }

    await shuttle.save();

    const io = req.app.get('io');
    io.emit('shuttle:location-updated', {
      shuttleId: shuttle._id,
      communityId: shuttle.communityId,
      location: shuttle.location,
      status: shuttle.status,
      currentCapacity: shuttle.currentCapacity,
      maxCapacity: shuttle.maxCapacity,
      updatedAt: shuttle.lastLocationUpdate,
    });

    return res.status(200).json({ message: 'Location updated.', shuttle });
  } catch (error) {
    console.error('Update shuttle location error:', error);
    return res.status(500).json({ error: 'Failed to update location.' });
  }
};

/**
 * PATCH /api/shuttles/:id/capacity
 * Driver/Admin adjusts current capacity by delta (default +1).
 */
const updateShuttleCapacity = async (req, res) => {
  try {
    const { id } = req.params;
    const delta = req.body.delta === undefined ? 1 : Number(req.body.delta);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid shuttle ID.' });
    }

    if (!Number.isInteger(delta) || delta === 0) {
      return res.status(400).json({ error: 'delta must be a non-zero integer.' });
    }

    const shuttle = await Shuttle.findById(id);
    if (!shuttle || !shuttle.isActive) {
      return res.status(404).json({ error: 'Shuttle not found.' });
    }

    if (shuttle.communityId.toString() !== req.user.communityId.toString()) {
      return res.status(403).json({ error: 'Access denied. Shuttle is outside your community.' });
    }

    if (req.user.role === 'driver') {
      if (!shuttle.driverId || shuttle.driverId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Access denied. This shuttle is not assigned to you.' });
      }
    }

    const nextCapacity = shuttle.currentCapacity + delta;
    if (nextCapacity < 0 || nextCapacity > shuttle.maxCapacity) {
      return res.status(400).json({
        error: `Capacity update rejected. Resulting capacity must be between 0 and ${shuttle.maxCapacity}.`,
      });
    }

    shuttle.currentCapacity = nextCapacity;
    shuttle.lastLocationUpdate = new Date();
    await shuttle.save();

    const io = req.app.get('io');
    io.emit('shuttle:capacity-updated', {
      shuttleId: shuttle._id,
      communityId: shuttle.communityId,
      currentCapacity: shuttle.currentCapacity,
      maxCapacity: shuttle.maxCapacity,
      capacityStatus: shuttle.capacityStatus,
      updatedAt: shuttle.updatedAt,
    });

    return res.status(200).json({
      message: 'Shuttle capacity updated.',
      shuttle,
    });
  } catch (error) {
    console.error('Update shuttle capacity error:', error);
    return res.status(500).json({ error: 'Failed to update shuttle capacity.' });
  }
};

module.exports = {
  createShuttle,
  listShuttles,
  updateShuttleLocation,
  updateShuttleCapacity,
};
