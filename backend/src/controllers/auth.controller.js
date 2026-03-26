const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const validator = require('validator');
const User = require('../models/User');
const Community = require('../models/Community');

let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

/**
 * Generate a signed JWT for a given user.
 * Payload includes: id, role, communityId — the minimum needed for auth decisions.
 */
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      communityId: user.communityId,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

const hashResetCode = (code) => {
  const secret = process.env.JWT_SECRET || 'goshuttle-reset-secret';
  return crypto.createHash('sha256').update(`${code}:${secret}`).digest('hex');
};

const sendResetCodeEmail = async (email, code) => {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!smtpHost || !smtpUser || !smtpPass || !fromEmail || !nodemailer) {
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: fromEmail,
    to: email,
    subject: 'GoShuttle Password Reset Verification Code',
    text: `Your GoShuttle verification code is ${code}. It expires in 10 minutes.`,
  });

  return true;
};

/**
 * POST /api/auth/register
 * Creates a new user account.
 * Default role: "passenger". Only existing admins can create driver/admin accounts.
 */
const register = async (req, res) => {
  try {
    const { firstName, lastName, email, password, communityId, phone } = req.body;

    // ─── Input Validation ──────────────────────────────────────
    if (!firstName || !lastName || !email || !password || !communityId) {
      return res.status(400).json({
        error: 'All fields are required: firstName, lastName, email, password, communityId.',
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    if (!validator.isLength(password, { min: 8 })) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    if (!validator.isMongoId(communityId)) {
      return res.status(400).json({ error: 'Invalid community ID.' });
    }

    // ─── Verify community exists and is active ─────────────────
    const community = await Community.findById(communityId);
    if (!community || !community.isActive) {
      return res.status(404).json({ error: 'Community not found or is inactive.' });
    }

    // ─── Check for duplicate email ─────────────────────────────
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // ─── Create user (always as passenger via public registration) ─
    const user = await User.create({
      firstName: validator.trim(firstName),
      lastName: validator.trim(lastName),
      email: email.toLowerCase(),
      password, // Hashed by the pre-save hook in User model
      communityId,
      phone: phone ? validator.trim(phone) : '',
      role: 'passenger', // Hardcoded — admin/driver accounts are created via admin endpoints
    });

    // ─── Generate token & respond ──────────────────────────────
    const token = generateToken(user);

    res.status(201).json({
      message: 'Registration successful.',
      token,
      user: user.toJSON(),
    });
  } catch (error) {
    console.error('Register error:', error);
    if (error.code === 11000) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};

/**
 * POST /api/auth/login
 * Authenticates a user with email + password, returns a JWT.
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // ─── Input Validation ──────────────────────────────────────
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    // ─── Find user (explicitly select password for comparison) ──
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    // Use generic message — don't reveal whether email or password was wrong
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'Account has been deactivated. Contact your community admin.' });
    }

    // ─── Verify password ───────────────────────────────────────
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // ─── Generate token & respond ──────────────────────────────
    const token = generateToken(user);

    res.status(200).json({
      message: 'Login successful.',
      token,
      user: user.toJSON(), // password stripped by toJSON override
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
};

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's profile.
 * Requires: authenticate middleware.
 */
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('communityId', 'name branding');

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error('GetMe error:', error);
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
};

const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !validator.isEmail(String(email))) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const normalizedEmail = String(email).toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select('+resetPasswordCodeHash +resetPasswordCodeExpiresAt');

    if (!user) {
      return res.status(200).json({ message: 'If your account exists, a verification code has been sent to your email.' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    user.resetPasswordCodeHash = hashResetCode(code);
    user.resetPasswordCodeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const sent = await sendResetCodeEmail(normalizedEmail, code);

    if (sent) {
      return res.status(200).json({ message: 'Verification code sent to your email.' });
    }

    const fallback = { message: 'Verification code generated. Contact support if email delivery is not configured.' };
    if (process.env.NODE_ENV !== 'production') {
      fallback.devCode = code;
    }

    return res.status(200).json(fallback);
  } catch (error) {
    console.error('Request password reset error:', error);
    return res.status(500).json({ error: 'Failed to process password reset request.' });
  }
};

const verifyPasswordResetCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code || !validator.isEmail(String(email))) {
      return res.status(400).json({ error: 'Valid email and verification code are required.' });
    }

    const normalizedEmail = String(email).toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select('+resetPasswordCodeHash +resetPasswordCodeExpiresAt');

    if (!user || !user.resetPasswordCodeHash || !user.resetPasswordCodeExpiresAt) {
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }

    if (new Date(user.resetPasswordCodeExpiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Verification code has expired.' });
    }

    const matches = user.resetPasswordCodeHash === hashResetCode(String(code).trim());
    if (!matches) {
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }

    return res.status(200).json({ message: 'Verification successful.' });
  } catch (error) {
    console.error('Verify password reset code error:', error);
    return res.status(500).json({ error: 'Failed to verify code.' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword || !validator.isEmail(String(email))) {
      return res.status(400).json({ error: 'Email, code, and newPassword are required.' });
    }

    if (!validator.isLength(String(newPassword), { min: 8 })) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const normalizedEmail = String(email).toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select('+password +resetPasswordCodeHash +resetPasswordCodeExpiresAt');

    if (!user || !user.resetPasswordCodeHash || !user.resetPasswordCodeExpiresAt) {
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }

    if (new Date(user.resetPasswordCodeExpiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Verification code has expired.' });
    }

    const matches = user.resetPasswordCodeHash === hashResetCode(String(code).trim());
    if (!matches) {
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }

    user.password = String(newPassword);
    user.resetPasswordCodeHash = null;
    user.resetPasswordCodeExpiresAt = null;
    await user.save();

    return res.status(200).json({ message: 'Password updated successfully. Please login.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password.' });
  }
};

module.exports = {
  register,
  login,
  getMe,
  requestPasswordReset,
  verifyPasswordResetCode,
  resetPassword,
};
