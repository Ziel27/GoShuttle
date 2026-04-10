const mongoose = require('mongoose');
const validator = require('validator');
const User = require('../models/User');
const Community = require('../models/Community');

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

const isPlatformAdmin = (req) => req.user?.role === 'admin';

const resolveCommunityScopeId = (req, requestedCommunityId, options = {}) => {
  const { allowAll = false } = options;
  const ownCommunityId = String(req.user.communityId);

  if (!requestedCommunityId || requestedCommunityId === 'own') {
    if (allowAll && isPlatformAdmin(req)) {
      return null;
    }
    return ownCommunityId;
  }

  if (requestedCommunityId === 'all') {
    if (allowAll && isPlatformAdmin(req)) {
      return null;
    }
    return { error: 'Access denied. communityId is outside your scope.' };
  }

  if (!mongoose.Types.ObjectId.isValid(requestedCommunityId)) {
    return { error: 'Invalid communityId.' };
  }

  if (String(requestedCommunityId) === ownCommunityId || isPlatformAdmin(req)) {
    return String(requestedCommunityId);
  }

  return { error: 'Access denied. communityId is outside your scope.' };
};

const createManagedUser = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      role,
      phone,
      communityId,
    } = req.body;

    if (!firstName || !lastName || !email || !password || !role) {
      return res.status(400).json({
        error: 'firstName, lastName, email, password, and role are required.',
      });
    }

    if (!['driver', 'admin'].includes(role)) {
      return res.status(400).json({ error: "role must be either 'driver' or 'admin'." });
    }

    if (!validator.isEmail(String(email))) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    if (!validator.isLength(String(password), { min: 8 })) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    let targetCommunityId = communityId;
    if (!targetCommunityId) {
      const firstCommunity = await Community.findOne({ isActive: true }).select('_id');
      if (!firstCommunity) {
        return res.status(503).json({ error: 'No active community found for assignment.' });
      }
      targetCommunityId = firstCommunity._id.toString();
    }

    const scopedCommunityId = resolveCommunityScopeId(req, targetCommunityId, { allowAll: false });
    if (typeof scopedCommunityId !== 'string') {
      return res.status(403).json({ error: scopedCommunityId.error });
    }

    const community = await Community.findById(scopedCommunityId).select('isActive');
    if (!community || !community.isActive) {
      return res.status(403).json({ error: 'Your community is inactive.' });
    }

    const existing = await User.findOne({ email: String(email).toLowerCase() }).select('_id');
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const managedUser = await User.create({
      communityId: scopedCommunityId,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email: String(email).toLowerCase(),
      password,
      phone: phone ? String(phone).trim() : '',
      role,
      status: 'offline',
    });

    return res.status(201).json({
      message: `${role} account created successfully.`,
      user: managedUser,
    });
  } catch (error) {
    console.error('Create managed user error:', error);

    if (error.code === 11000) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    return res.status(500).json({ error: 'Failed to create user.' });
  }
};

const listUsers = async (req, res) => {
  try {
    const role = req.query.role;
    const activeOnly = req.query.active !== 'false';
    const scopedCommunityId = resolveCommunityScopeId(req, req.query.communityId, { allowAll: true });

    if (scopedCommunityId && typeof scopedCommunityId !== 'string') {
      return res.status(403).json({ error: scopedCommunityId.error });
    }

    const query = {};
    if (scopedCommunityId) {
      query.communityId = scopedCommunityId;
    }

    if (activeOnly) query.isActive = true;
    if (role) {
      if (!['admin', 'driver', 'passenger'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role filter.' });
      }
      query.role = role;
    }

    const users = await User.find(query)
      .select('-password')
      .populate('communityId', 'name')
      .sort({ createdAt: -1 });

    return res.status(200).json({ count: users.length, users });
  } catch (error) {
    console.error('List users error:', error);
    return res.status(500).json({ error: 'Failed to fetch users.' });
  }
};

const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive, status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (!isPlatformAdmin(req) && user.communityId.toString() !== req.user.communityId.toString()) {
      return res.status(403).json({ error: 'Access denied. User is outside your community.' });
    }

    if (status !== undefined) {
      if (!['active', 'offline', 'driving'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status value.' });
      }
      user.status = status;
    }

    if (isActive !== undefined) {
      user.isActive = Boolean(isActive);
    }

    await user.save();

    return res.status(200).json({
      message: 'User updated successfully.',
      user,
    });
  } catch (error) {
    console.error('Update user status error:', error);
    return res.status(500).json({ error: 'Failed to update user.' });
  }
};

const updateOwnStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const userId = req.user._id;

    if (status === undefined) {
      return res.status(400).json({ error: 'status is required.' });
    }

    const allowedStatuses = req.user.role === 'driver'
      ? ['active', 'offline', 'driving']
      : ['active', 'offline'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status value for this role.' });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { status },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.status(200).json({
      message: 'Status updated successfully.',
      user,
    });
  } catch (error) {
    console.error('Update own status error:', error);
    return res.status(500).json({ error: 'Failed to update status.' });
  }
};

const updateOwnHomeDestination = async (req, res) => {
  try {
    const { latitude, longitude, label } = req.body;
    const coords = validateCoordinates(latitude, longitude);

    if (!coords.valid) {
      return res.status(400).json({ error: coords.message });
    }

    const rawLabel = typeof label === 'string' ? label.trim() : '';
    if (!rawLabel) {
      return res.status(400).json({ error: 'label is required and must be a non-empty home address.' });
    }

    const normalizedLabel = rawLabel.slice(0, 120);
    const userId = req.user._id;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        homeDestination: {
          label: normalizedLabel,
          location: {
            type: 'Point',
            coordinates: [coords.lng, coords.lat],
          },
          updatedAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.status(200).json({
      message: 'Home destination updated successfully.',
      user,
    });
  } catch (error) {
    console.error('Update own home destination error:', error);
    return res.status(500).json({ error: 'Failed to update home destination.' });
  }
};

module.exports = {
  createManagedUser,
  listUsers,
  updateUserStatus,
  updateOwnStatus,
  updateOwnHomeDestination,
};
