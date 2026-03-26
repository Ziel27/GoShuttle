const mongoose = require('mongoose');
const validator = require('validator');
const Community = require('../models/Community');

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

const createCommunity = async (req, res) => {
  try {
    const { name, boundaries, baseFare, branding } = req.body;

    if (!name || !boundaries || baseFare === undefined) {
      return res.status(400).json({ error: 'name, boundaries, and baseFare are required.' });
    }

    if (!validator.isLength(String(name).trim(), { min: 2, max: 100 })) {
      return res.status(400).json({ error: 'Community name must be between 2 and 100 characters.' });
    }

    if (
      boundaries.type !== 'Polygon' ||
      !isValidPolygonCoordinates(boundaries.coordinates)
    ) {
      return res.status(400).json({ error: 'Invalid GeoJSON Polygon boundaries.' });
    }

    const parsedFare = Number(baseFare);
    if (!Number.isFinite(parsedFare) || parsedFare < 0) {
      return res.status(400).json({ error: 'baseFare must be a non-negative number.' });
    }

    const community = await Community.create({
      name: String(name).trim(),
      boundaries: {
        type: 'Polygon',
        coordinates: boundaries.coordinates,
      },
      baseFare: parsedFare,
      branding: {
        primaryColor: branding?.primaryColor || undefined,
        logoUrl: branding?.logoUrl || undefined,
      },
    });

    return res.status(201).json({
      message: 'Community created successfully.',
      community,
    });
  } catch (error) {
    console.error('Create community error:', error);

    if (error.code === 11000) {
      return res.status(409).json({ error: 'Community name already exists.' });
    }

    return res.status(500).json({ error: 'Failed to create community.' });
  }
};

const listCommunities = async (_req, res) => {
  try {
    const communities = await Community.find({ isActive: true })
      .select('name boundaries baseFare branding isActive createdAt')
      .sort({ name: 1 });

    return res.status(200).json({ count: communities.length, communities });
  } catch (error) {
    console.error('List communities error:', error);
    return res.status(500).json({ error: 'Failed to fetch communities.' });
  }
};

const getCommunityById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid community ID.' });
    }

    const community = await Community.findById(id);
    if (!community || !community.isActive) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    return res.status(200).json({ community });
  } catch (error) {
    console.error('Get community error:', error);
    return res.status(500).json({ error: 'Failed to fetch community.' });
  }
};

const updateCommunity = async (req, res) => {
  try {
    const { id } = req.params;
    const { baseFare, branding, isActive, boundaries, name } = req.body;
    const requesterCommunityId = req.user?.communityId?.toString();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid community ID.' });
    }

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ error: 'Community not found.' });
    }

    if (!requesterCommunityId || community._id.toString() !== requesterCommunityId) {
      return res.status(403).json({ error: 'Access denied. You can only update your own community.' });
    }

    if (name !== undefined) {
      if (!validator.isLength(String(name).trim(), { min: 2, max: 100 })) {
        return res.status(400).json({ error: 'Community name must be between 2 and 100 characters.' });
      }
      community.name = String(name).trim();
    }

    if (baseFare !== undefined) {
      const parsedFare = Number(baseFare);
      if (!Number.isFinite(parsedFare) || parsedFare < 0) {
        return res.status(400).json({ error: 'baseFare must be a non-negative number.' });
      }
      community.baseFare = parsedFare;
    }

    if (boundaries !== undefined) {
      if (boundaries.type !== 'Polygon' || !isValidPolygonCoordinates(boundaries.coordinates)) {
        return res.status(400).json({ error: 'Invalid GeoJSON Polygon boundaries.' });
      }

      community.boundaries = {
        type: 'Polygon',
        coordinates: boundaries.coordinates,
      };
    }

    if (branding !== undefined) {
      community.branding = {
        ...community.branding,
        ...branding,
      };
    }

    if (isActive !== undefined) {
      community.isActive = Boolean(isActive);
    }

    await community.save();

    return res.status(200).json({
      message: 'Community updated successfully.',
      community,
    });
  } catch (error) {
    console.error('Update community error:', error);

    if (error.code === 11000) {
      return res.status(409).json({ error: 'Community name already exists.' });
    }

    return res.status(500).json({ error: 'Failed to update community.' });
  }
};

module.exports = {
  createCommunity,
  listCommunities,
  getCommunityById,
  updateCommunity,
};
