const mongoose = require('mongoose');
const validator = require('validator');
const User = require('../models/User');
const Community = require('../models/Community');
const ShiftRemittance = require('../models/ShiftRemittance');
const Trip = require('../models/Trip');
const RideRequest = require('../models/RideRequest');
const Shuttle = require('../models/Shuttle');
const { normalizePhase, buildPhaseAwareRequestQuery } = require('../utils/phase');
const { pointInPolygon } = require('../services/geofence');
const { sendWarningEmail, sendDeactivationEmail } = require('../utils/email');

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

const detectPhaseForCoordinates = (phaseGeofences, latitude, longitude) => {
  for (const phase of phaseGeofences || []) {
    if (phase?.isActive === false) continue;

    const ring = phase?.boundaries?.coordinates?.[0] || [];
    if (ring.length < 4) continue;

    if (pointInPolygon(latitude, longitude, ring)) {
      return normalizePhase(phase.name);
    }
  }

  return null;
};

const isPlatformAdmin = (req) => req.user?.role === 'admin';

const SHIFT_WINDOW_FALLBACK_MS = 12 * 60 * 60 * 1000;

const resolveDriverShiftWindowStart = async ({ driverId, communityId, fallbackUpdatedAt }) => {
  const activeTrip = await Trip.findOne({
    communityId,
    driverId,
    status: 'active',
  })
    .select('shiftStart')
    .sort({ shiftStart: -1 })
    .lean();

  if (activeTrip?.shiftStart instanceof Date) {
    return activeTrip.shiftStart;
  }

  if (fallbackUpdatedAt instanceof Date) {
    return fallbackUpdatedAt;
  }

  return new Date(Date.now() - SHIFT_WINDOW_FALLBACK_MS);
};

const listPendingRideRequestsForShift = async ({ communityId, shiftStart, driverId }) => {
  let phaseFilter = {};

  if (driverId) {
    const shuttle = await Shuttle.findOne({
      communityId,
      driverId,
      isActive: true,
    })
      .select('assignedPhase')
      .lean();

    phaseFilter = buildPhaseAwareRequestQuery({
      shuttlePhase: shuttle?.assignedPhase,
      passengerPhaseField: 'passengerHomePhase',
    });
  }

  return RideRequest.find({
    communityId,
    status: 'pending',
    createdAt: {
      $gte: shiftStart,
      $lte: new Date(),
    },
    ...phaseFilter,
  })
    .select('_id passengerId destination fareExpected createdAt')
    .populate('passengerId', 'firstName lastName')
    .lean();
};

const mapUnresolvedRideRequest = (request) => ({
  requestId: request._id,
  passengerName: request.passengerId
    ? `${request.passengerId.firstName} ${request.passengerId.lastName}`.trim()
    : 'Unknown',
  passengerId: request.passengerId?._id || request.passengerId,
  destinationLabel: request.destination?.label || 'Destination',
  fareExpected: request.fareExpected,
  createdAt: request.createdAt,
});

// NOTE: Multi-community support. Currently single-community — scope typically resolves to req.user.communityId.
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
      homePhase,
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
      homePhase: normalizePhase(homePhase),
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
    const { isActive, status, homePhase } = req.body;

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

      // Admin-forced driver shift shutdown: preserve unresolved requests as explicit ignored records.
      if (status === 'offline' && user.role === 'driver' && user.status === 'driving') {
        const shiftStart = await resolveDriverShiftWindowStart({
          driverId: user._id,
          communityId: user.communityId,
          fallbackUpdatedAt: user.updatedAt,
        });

        const pendingRequests = await listPendingRideRequestsForShift({
          communityId: user.communityId,
          shiftStart,
          driverId: user._id,
        });

        if (pendingRequests.length > 0) {
          const now = new Date();
          await RideRequest.updateMany(
            {
              _id: { $in: pendingRequests.map((request) => request._id) },
              status: 'pending',
            },
            {
              $set: {
                status: 'ignored',
                resolution: 'expired',
                resolvedAt: now,
                resolvedBy: req.user._id,
              },
            }
          );
        }
      }

      user.status = status;
    }

    if (isActive !== undefined) {
      user.isActive = Boolean(isActive);
    }

    if (homePhase !== undefined) {
      user.homePhase = normalizePhase(homePhase);
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
    if (!['driver', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Only drivers and admins can update own status.' });
    }

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

    const currentUser = await User.findById(userId).select('_id role status communityId updatedAt');
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (req.user.role === 'driver' && currentUser.status === 'driving' && status === 'offline') {
      const shiftStart = await resolveDriverShiftWindowStart({
        driverId: currentUser._id,
        communityId: currentUser.communityId,
        fallbackUpdatedAt: currentUser.updatedAt,
      });

      const unresolvedRequests = await listPendingRideRequestsForShift({
        communityId: currentUser.communityId,
        shiftStart,
        driverId: currentUser._id,
      });

      if (unresolvedRequests.length > 0) {
        return res.status(409).json({
          error: 'Unresolved ride requests must be resolved before ending shift.',
          unresolvedRequests: unresolvedRequests.map(mapUnresolvedRideRequest),
        });
      }
    }

    if (status === 'driving' && req.user.role === 'driver') {
      const blockers = await ShiftRemittance.find({
        driverId: userId,
        status: { $in: ['overdue', 'escalated'] },
      }).select('status');

      if (blockers.length > 0) {
        return res.status(409).json({
          error: 'You have overdue or escalated remittances. You must submit them before starting a new shift.'
        });
      }
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
    if (!['passenger', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Only passengers and admins can update home destination.' });
    }

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

    const community = await Community.findById(req.user.communityId).select('phaseGeofences').lean();
    const detectedHomePhase = detectPhaseForCoordinates(community?.phaseGeofences || [], coords.lat, coords.lng);

    const update = {
      homeDestination: {
        label: normalizedLabel,
        location: {
          type: 'Point',
          coordinates: [coords.lng, coords.lat],
        },
        updatedAt: new Date(),
      },
    };

    if (detectedHomePhase) {
      update.homePhase = detectedHomePhase;
    } else if (req.body.homePhase !== undefined) {
      update.homePhase = normalizePhase(req.body.homePhase);
    }

    const user = await User.findByIdAndUpdate(userId, update, { new: true, runValidators: true });

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

const updateOwnHomePhase = async (req, res) => {
  try {
    if (req.user.role !== 'passenger') {
      return res.status(403).json({ error: 'Access denied. Only passengers can update their home phase.' });
    }

    const { homePhase } = req.body;

    if (homePhase === undefined) {
      return res.status(400).json({ error: 'homePhase is required.' });
    }

    const normalizedPhase = normalizePhase(homePhase);
    if (normalizedPhase) {
      const community = await Community.findById(req.user.communityId).select('phaseGeofences').lean();
      const hasMatchingActivePhase = (community?.phaseGeofences || []).some(
        (phase) => phase?.isActive !== false && phase?.name === normalizedPhase
      );
      if (!hasMatchingActivePhase) {
        return res.status(400).json({ error: 'Selected home phase is not available in your community.' });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { homePhase: normalizedPhase },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.status(200).json({
      message: 'Home phase updated successfully.',
      user,
    });
  } catch (error) {
    console.error('Update own home phase error:', error);
    return res.status(500).json({ error: 'Failed to update home phase.' });
  }
};

/**
 * POST /api/users/:id/warn
 * Admin sends a warning to a user (max 2). Saves to DB and emails the user.
 */
const warnUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }
    if (!note || !String(note).trim()) {
      return res.status(400).json({ error: 'A warning note is required.' });
    }
    if (String(note).trim().length < 5) {
      return res.status(400).json({ error: 'Warning note must be at least 5 characters.' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (!isPlatformAdmin(req) && user.communityId.toString() !== req.user.communityId.toString()) {
      return res.status(403).json({ error: 'Access denied. User is outside your community.' });
    }

    if (!user.isActive) {
      return res.status(400).json({ error: 'Cannot warn a deactivated user.' });
    }

    if ((user.warnings || []).length >= 2) {
      return res.status(400).json({ error: 'User has already received 2 warnings. You can now deactivate their account.' });
    }

    const issuedByName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || 'Admin';
    user.warnings.push({
      note: String(note).trim(),
      issuedBy: issuedByName,
      date: new Date(),
    });

    await user.save();

    const warningNumber = user.warnings.length;
    const toName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    await sendWarningEmail({
      toEmail: user.email,
      toName,
      warningNumber,
      note: String(note).trim(),
      issuedBy: issuedByName,
    });

    return res.status(200).json({
      message: `Warning ${warningNumber}/2 sent to ${toName}.`,
      user,
    });
  } catch (error) {
    console.error('Warn user error:', error);
    return res.status(500).json({ error: 'Failed to send warning.' });
  }
};

/**
 * POST /api/users/:id/deactivate
 * Admin deactivates a user with a required note (only after 2 warnings). Emails the user.
 */
const deactivateUserWithNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }
    if (!note || !String(note).trim()) {
      return res.status(400).json({ error: 'A deactivation reason is required.' });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (!isPlatformAdmin(req) && user.communityId.toString() !== req.user.communityId.toString()) {
      return res.status(403).json({ error: 'Access denied. User is outside your community.' });
    }

    if (!user.isActive) {
      return res.status(400).json({ error: 'User is already deactivated.' });
    }

    if ((user.warnings || []).length < 2) {
      return res.status(400).json({ error: 'User must receive 2 warnings before deactivation.' });
    }

    user.isActive = false;
    await user.save();

    const issuedByName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || 'Admin';
    const toName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    await sendDeactivationEmail({
      toEmail: user.email,
      toName,
      note: String(note).trim(),
      issuedBy: issuedByName,
    });

    return res.status(200).json({
      message: `${toName}'s account has been deactivated.`,
      user,
    });
  } catch (error) {
    console.error('Deactivate user error:', error);
    return res.status(500).json({ error: 'Failed to deactivate user.' });
  }
};

module.exports = {
  createManagedUser,
  listUsers,
  updateUserStatus,
  updateOwnStatus,
  updateOwnHomeDestination,
  updateOwnHomePhase,
  warnUser,
  deactivateUserWithNote,
};
