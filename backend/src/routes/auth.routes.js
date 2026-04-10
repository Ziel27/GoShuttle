const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  register,
  login,
  logout,
  getMe,
  requestPasswordReset,
  verifyPasswordResetCode,
  resetPassword,
} = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ─── Stricter rate limiter for auth endpoints ────────────────────
// Brute-force protection: 10 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
});

// ─── Public Routes ───────────────────────────────────────────────
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/forgot-password', authLimiter, requestPasswordReset);
router.post('/verify-reset-code', authLimiter, verifyPasswordResetCode);
router.post('/reset-password', authLimiter, resetPassword);

// ─── Protected Routes ────────────────────────────────────────────
router.get('/me', authenticate, getMe);
router.post('/logout', authenticate, logout);

module.exports = router;
