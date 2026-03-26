require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const connectDB = require('./config/db');
const User = require('./models/User');
const { registerSocketHandlers } = require('./services/socket-handlers');

const resolvedCorsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  : process.env.NODE_ENV === 'production'
    ? null
    : '*';

if (!resolvedCorsOrigin) {
  throw new Error('CORS_ORIGIN must be configured in production.');
}

// ─── Initialize Express & HTTP Server ────────────────────────────
const app = express();
const server = http.createServer(app);

// ─── Socket.io (attached to HTTP server, configured in Phase 4) ──
const io = new Server(server, {
  cors: {
    origin: resolvedCorsOrigin,
    methods: ['GET', 'POST'],
  },
});

io.use(async (socket, next) => {
  try {
    const rawToken = socket.handshake.auth?.token || socket.handshake.headers.authorization;
    const token = typeof rawToken === 'string' && rawToken.startsWith('Bearer ')
      ? rawToken.slice(7)
      : rawToken;

    if (!token) {
      return next(new Error('Authentication required.'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('_id role communityId isActive');

    if (!user || !user.isActive) {
      return next(new Error('Unauthorized socket user.'));
    }

    socket.data.user = user;
    return next();
  } catch (_error) {
    return next(new Error('Invalid socket token.'));
  }
});

// Make io accessible to route handlers via req.io
app.set('io', io);
registerSocketHandlers(io);

// ─── Global Middleware ───────────────────────────────────────────

// Security headers
app.use(helmet());

// CORS
app.use(
  cors({
    origin: resolvedCorsOrigin,
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));

// Sanitize MongoDB query operators from user input ($gt, $ne, etc.)
app.use(mongoSanitize());

// HTTP request logging (disabled in test)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Rate limiting — global baseline (stricter limits on auth routes in Phase 2)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use(globalLimiter);

// ─── Health Check ────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'GoShuttle API',
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ──────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/communities', require('./routes/community.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/shuttles', require('./routes/shuttle.routes'));
app.use('/api/trips', require('./routes/trip.routes'));

// ─── 404 Handler ─────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Global Error Handler ────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('🔥 Unhandled error:', err.stack);
  res.status(err.status || 500).json({
    error:
      process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message,
  });
});

// ─── Start Server ────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  server.listen(PORT, () => {
    console.log(`🚀 GoShuttle API running on port ${PORT} [${process.env.NODE_ENV}]`);
  });
};

if (require.main === module) {
  startServer();
}

module.exports = { app, server, io, startServer };
