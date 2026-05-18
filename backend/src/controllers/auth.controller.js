const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const validator = require('validator');
const User = require('../models/User');
const Community = require('../models/Community');
const { normalizePhase } = require('../utils/phase');

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

const getSmtpValue = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) return String(value).trim();
  }

  return '';
};

/**
 * Set HTTP-only, secure, sameSite cookie for auth token.
 * Protects against XSS attacks by preventing JavaScript access.
 */
const setAuthTokenCookie = (res, token) => {
  const isProduction = process.env.NODE_ENV === 'production';

  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };

  if (isProduction) {
    cookieOptions.domain = '.goshuttle.app';
  }

  res.cookie('auth_token', token, {
    ...cookieOptions,
  });
};

const hashResetCode = (code) => {
  // Use dedicated reset secret, not JWT_SECRET
  const secret = process.env.JWT_RESET_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_RESET_SECRET environment variable is required.');
  }
  return crypto.createHash('sha256').update(`${code}:${secret}`).digest('hex');
};

/**
 * Track password reset attempts (in-memory for now, should use Redis in production)
 */
// NOTE: In-memory rate limiter. Resets on server restart.
// Replace with Redis-based limiter (e.g. rate-limiter-flexible) before scaling to multiple instances.
const resetAttempts = new Map(); // {key: number[]}
const RESET_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RESET_LIMIT_MAX = 3;
const RESET_ATTEMPT_CLEANUP_MS = 15 * 60 * 1000;

const pruneResetAttempts = (key, now = Date.now()) => {
  const attempts = resetAttempts.get(key) || [];
  const freshAttempts = attempts.filter((timestamp) => timestamp > now - RESET_LIMIT_WINDOW_MS);

  if (freshAttempts.length === 0) {
    resetAttempts.delete(key);
  } else {
    resetAttempts.set(key, freshAttempts);
  }

  return freshAttempts;
};

const isResetAttemptAllowed = (key) => {
  const now = Date.now();
  const recentAttempts = pruneResetAttempts(key, now);

  if (recentAttempts.length >= RESET_LIMIT_MAX) {
    return false;
  }

  recentAttempts.push(now);
  resetAttempts.set(key, recentAttempts);
  return true;
};

const pruneStaleResetAttempts = () => {
  const now = Date.now();
  for (const key of resetAttempts.keys()) {
    pruneResetAttempts(key, now);
  }
};

if (process.env.NODE_ENV !== 'test') {
  const timer = setInterval(pruneStaleResetAttempts, RESET_ATTEMPT_CLEANUP_MS);
  timer.unref?.();
}

const buildResetPasswordEmail = ({ code, email }) => {
  const supportEmail = getSmtpValue('SMTP_FROM', 'SMTP_FROM_EMAIL', 'SMTP_USER') || 'GoShuttle Support';
  const safeCode = String(code).trim();
  const safeEmail = String(email).trim();
  const logoPath = path.resolve(__dirname, '../../../assets/images/logo.png');

  const text = [
    'GoShuttle Password Reset',
    '',
    `Your verification code is: ${safeCode}`,
    '',
    'This code expires in 10 minutes.',
    'If you did not request this reset, you can ignore this message.',
  ].join('\n');

  const html = `
    <div style="margin:0;padding:0;background:#0f1f14;font-family:Arial,Helvetica,sans-serif;color:#eaf4ec;">
      <div style="max-width:640px;margin:0 auto;padding:32px 16px;">
        <div style="overflow:hidden;border-radius:28px;background:#14261a;box-shadow:0 24px 60px rgba(0,0,0,0.34);border:1px solid rgba(133,173,143,0.18);">
          <div style="background:linear-gradient(145deg,#17351f 0%,#21472b 52%,#0f1f14 100%);padding:30px 28px 26px;position:relative;">
            <div style="display:inline-flex;align-items:center;gap:12px;border-radius:999px;background:rgba(255,255,255,0.08);padding:8px 14px;color:#f4fbf5;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
              Secure reset
            </div>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px;">
              <tr>
                <td style="width:88px;height:88px;border-radius:24px;background:#f6fbf6;overflow:hidden;box-shadow:0 12px 28px rgba(0,0,0,0.18);">
                  <img src="cid:goshuttle-logo" alt="GoShuttle" width="88" height="88" style="display:block;width:88px;height:88px;object-fit:cover;" />
                </td>
                <td style="padding-left:16px;vertical-align:middle;">
                  <div style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#9fc5a9;margin-bottom:6px;">GoShuttle</div>
                  <h1 style="margin:0;font-size:30px;line-height:1.15;color:#ffffff;">Password reset code</h1>
                </td>
              </tr>
            </table>
            <p style="margin:18px 0 0;font-size:15px;line-height:1.6;color:rgba(234,244,236,0.92);max-width:500px;">
              Use the code below to continue resetting your password for your GoShuttle account.
            </p>
          </div>

          <div style="padding:30px 28px 26px;background:linear-gradient(180deg,#14261a 0%,#101d14 100%);">
            <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#c9d8cc;">Hello ${safeEmail},</p>
            <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#c9d8cc;">
              We received a request to reset your GoShuttle password. Enter this verification code in the app:
            </p>

            <div style="margin:22px 0 24px;padding:22px;border-radius:22px;background:#f4fbf6;border:1px solid #d1e4d4;text-align:center;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.55);">
              <div style="font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#5a8266;margin-bottom:10px;">Verification Code</div>
              <div style="font-size:40px;line-height:1.1;font-weight:800;letter-spacing:0.24em;color:#1d5f39;">${safeCode}</div>
            </div>

            <div style="margin:0 0 18px;padding:16px 18px;border-radius:18px;background:#0c1710;border:1px solid rgba(159,197,169,0.18);">
              <div style="font-size:12px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#8fb39a;margin-bottom:10px;">Next steps</div>
              <div style="display:flex;flex-direction:column;gap:8px;">
                <div style="font-size:14px;line-height:1.55;color:#edf5ef;">1. Open the GoShuttle app.</div>
                <div style="font-size:14px;line-height:1.55;color:#edf5ef;">2. Enter the verification code above.</div>
                <div style="font-size:14px;line-height:1.55;color:#edf5ef;">3. Create your new password and sign in again.</div>
              </div>
            </div>

            <div style="display:flex;gap:12px;flex-wrap:wrap;">
              <div style="flex:1 1 180px;padding:14px 16px;border-radius:16px;background:#0d1911;border:1px solid rgba(159,197,169,0.16);">
                <div style="font-size:12px;font-weight:700;color:#9db4a2;margin-bottom:4px;">Expires</div>
                <div style="font-size:14px;font-weight:700;color:#f2f8f3;">10 minutes</div>
              </div>
              <div style="flex:1 1 180px;padding:14px 16px;border-radius:16px;background:#0d1911;border:1px solid rgba(159,197,169,0.16);">
                <div style="font-size:12px;font-weight:700;color:#9db4a2;margin-bottom:4px;">Account</div>
                <div style="font-size:14px;font-weight:700;color:#f2f8f3;word-break:break-word;">${safeEmail}</div>
              </div>
            </div>

            <p style="margin:22px 0 0;font-size:13px;line-height:1.7;color:#aebfb3;">
              If you did not request this password reset, you can safely ignore this email.
            </p>
          </div>

          <div style="padding:0 28px 28px;background:#101d14;">
            <div style="height:1px;background:rgba(159,197,169,0.14);margin-bottom:18px;"></div>
            <p style="margin:0;font-size:12px;line-height:1.6;color:#92a593;">
              Sent by ${supportEmail}. This is an automated message from GoShuttle.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;

  return { text, html };
};

const sendResetCodeEmail = async (email, code) => {
  const smtpHost = getSmtpValue('SMTP_HOST');
  const smtpPort = Number(getSmtpValue('SMTP_PORT') || 587);
  const smtpUser = getSmtpValue('SMTP_USER');
  const smtpPass = getSmtpValue('SMTP_PASS', 'SMTP_PASSWORD');
  const fromEmail = getSmtpValue('SMTP_FROM', 'SMTP_FROM_EMAIL', 'SMTP_USER');

  if (!smtpHost || !smtpUser || !smtpPass || !fromEmail || !nodemailer) {
    console.warn('[WARN] SMTP configuration missing. Email sending disabled. Configure SMTP_HOST, SMTP_USER, SMTP_PASS (or SMTP_PASSWORD), and SMTP_FROM (or SMTP_FROM_EMAIL) to enable.');
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const logoPath = path.resolve(__dirname, '../../../assets/images/logo.png');
    const message = buildResetPasswordEmail({ code, email });

    await transporter.sendMail({
      from: fromEmail,
      to: email,
      subject: 'Your GoShuttle password reset code',
      text: message.text,
      html: message.html,
      attachments: [
        {
          filename: 'logo.png',
          path: logoPath,
          cid: 'goshuttle-logo',
        },
      ],
    });

    return true;
  } catch (error) {
    console.error('[ERROR] Failed to send password reset email to:', email, 'Error:', error.message);
    return false;
  }
};

/**
 * POST /api/auth/register
 * Creates a new user account.
 * Default role: "passenger". Only existing admins can create driver/admin accounts.
 */
const register = async (req, res) => {
  try {
    const { firstName, lastName, email, password, communityId, phone } = req.body;
    const homePhase = normalizePhase(req.body.homePhase);

    // ─── Resolve community assignment ─────────────────────────
    let assignedCommunityId = communityId;
    
    if (!assignedCommunityId) {
      const firstCommunity = await Community.findOne({ isActive: true }).select('_id');
      if (!firstCommunity) {
        return res.status(503).json({ error: 'System error: No active community found for registration.' });
      }
      assignedCommunityId = firstCommunity._id.toString();
    }

    // ─── Input Validation ──────────────────────────────────────
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        error: 'Almost all fields are required: firstName, lastName, email, password.',
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    if (!validator.isLength(password, { min: 8 })) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    if (!validator.isMongoId(assignedCommunityId)) {
      return res.status(400).json({ error: 'Invalid community ID.' });
    }

    // ─── Verify community exists and is active ─────────────────
    const community = await Community.findById(assignedCommunityId).select('isActive phaseGeofences');
    if (!community || !community.isActive) {
      return res.status(404).json({ error: 'Community not found or is inactive.' });
    }

    if (homePhase) {
      const hasMatchingActivePhase = (community.phaseGeofences || []).some(
        (phase) => phase?.isActive !== false && phase?.name === homePhase
      );
      if (!hasMatchingActivePhase) {
        return res.status(400).json({ error: 'Selected home phase is not available in this community.' });
      }
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
      communityId: assignedCommunityId,
      phone: phone ? validator.trim(phone) : '',
      homePhase,
      role: 'passenger', // Hardcoded — admin/driver accounts are created via admin endpoints
    });

    // ─── Generate token & respond ──────────────────────────────
    const token = generateToken(user);
    setAuthTokenCookie(res, token);

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

    // ─── Update online status on login ─────────────────────────
    // Admins and passengers become 'active'. Drivers stay in their own
    // lifecycle (offline ↔ driving) managed by the shift endpoints —
    // but if a driver is somehow still marked 'driving' from a stale
    // session, reset them to 'offline' for a clean start.
    if (user.role === 'driver') {
      if (user.status === 'driving') {
        user.status = 'offline';
        await user.save();
      }
    } else {
      // admin / passenger → mark online
      user.status = 'active';
      await user.save();
    }

    // ─── Generate token & respond ──────────────────────────────
    const token = generateToken(user);
    setAuthTokenCookie(res, token);

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
    const attemptKey = `request:${normalizedEmail}:${req.ip}`;

    // Rate limit password reset attempts (3 per hour)
    if (!isResetAttemptAllowed(attemptKey)) {
      return res.status(429).json({ error: 'Too many password reset attempts. Please try again in an hour.' });
    }

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

    if (process.env.NODE_ENV === 'production') {
      console.error('[CRITICAL] Password reset email failed to send for:', normalizedEmail);
      return res.status(200).json({
        message: 'If your account exists, a verification code has been sent to your email.',
      });
    }

    return res.status(200).json({
      message: 'SMTP not configured. Dev mode only.',
      devCode: code,
    });
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
    const attemptKey = `verify:${normalizedEmail}:${req.ip}`;

    // Rate limit verification attempts (3 per hour per email)
    if (!isResetAttemptAllowed(attemptKey)) {
      return res.status(429).json({ error: 'Too many verification attempts. Please try again later.' });
    }

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
    const attemptKey = `reset:${normalizedEmail}:${req.ip}`;

    if (!isResetAttemptAllowed(attemptKey)) {
      return res.status(429).json({ error: 'Too many password reset attempts. Please try again later.' });
    }

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

    resetAttempts.delete(`request:${normalizedEmail}:${req.ip}`);
    resetAttempts.delete(`verify:${normalizedEmail}:${req.ip}`);
    resetAttempts.delete(attemptKey);

    return res.status(200).json({ message: 'Password updated successfully. Please login.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ error: 'Failed to reset password.' });
  }
};

/**
 * POST /api/auth/logout
 * Clears the authentication cookie and marks the user offline.
 */
const logout = async (req, res) => {
  try {
    if (req.user?._id) {
      await User.findByIdAndUpdate(req.user._id, { status: 'offline' });
    }
  } catch {
    // Non-fatal — still clear the cookie
  }
  const isProduction = process.env.NODE_ENV === 'production';
  const clearOptions = {
    path: '/',
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
  };

  if (isProduction) {
    clearOptions.domain = '.goshuttle.app';
  }

  res.clearCookie('auth_token', clearOptions);
  res.status(200).json({ message: 'Logged out successfully.' });
};

module.exports = {
  register,
  login,
  logout,
  getMe,
  requestPasswordReset,
  verifyPasswordResetCode,
  resetPassword,
  setAuthTokenCookie,
};
