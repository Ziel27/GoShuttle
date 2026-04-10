const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * authenticate — Verifies the JWT from HttpOnly cookie or Authorization header.
 * Attaches the full user document (minus password) to `req.user`.
 */
const authenticate = async (req, res, next) => {
  try {
    // Try to get token from HttpOnly cookie first (secure, XSS-proof)
    let token = req.cookies?.auth_token;

    // Fall back to Authorization header (Bearer token) for backward compatibility
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required. No token provided.' });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired. Please login again.' });
      }
      return res.status(401).json({ error: 'Invalid token.' });
    }

    // Fetch user and verify they still exist + are active
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'User belonging to this token no longer exists.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ error: 'Account has been deactivated. Contact your community admin.' });
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed.' });
  }
};

/**
 * authorize — Role-based access control.
 * Usage: authorize('admin') or authorize('admin', 'driver')
 * Returns 403 if the authenticated user's role is not in the allowed list.
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Role '${req.user.role}' is not authorized for this resource. Required: ${allowedRoles.join(', ')}.`,
      });
    }

    next();
  };
};

/**
 * requireSameCommunity — Ensures the authenticated user's communityId
 * matches the communityId in the request params or body.
 * Admins can only see/manage their own community's data.
 */
const requireSameCommunity = (req, res, next) => {
  const targetCommunityId =
    req.params.communityId || req.body.communityId;

  if (!targetCommunityId) {
    return next(); // No community context in request — skip check
  }

  if (req.user.communityId.toString() !== targetCommunityId.toString()) {
    return res.status(403).json({
      error: 'Access denied. You can only access resources within your own community.',
    });
  }

  next();
};

module.exports = { authenticate, authorize, requireSameCommunity };
