const mongoose = require('mongoose');
const validator = require('validator');
const User = require('../models/User');
const Community = require('../models/Community');

const createManagedUser = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      role,
      phone,
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

    const community = await Community.findById(req.user.communityId).select('isActive');
    if (!community || !community.isActive) {
      return res.status(403).json({ error: 'Your community is inactive.' });
    }

    const existing = await User.findOne({ email: String(email).toLowerCase() }).select('_id');
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const managedUser = await User.create({
      communityId: req.user.communityId,
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

    const query = { communityId: req.user.communityId };

    if (activeOnly) query.isActive = true;
    if (role) {
      if (!['admin', 'driver', 'passenger'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role filter.' });
      }
      query.role = role;
    }

    const users = await User.find(query)
      .select('-password')
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

    if (user.communityId.toString() !== req.user.communityId.toString()) {
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

module.exports = {
  createManagedUser,
  listUsers,
  updateUserStatus,
};
