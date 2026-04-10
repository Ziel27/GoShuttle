require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const connectDB = require('./config/db');
const User = require('./models/User');
const { registerSocketHandlers } = require('./services/socket-handlers');

// ─── Environment Validation ───────────────────────────────────────
const validateEnvironment = () => {
  const required = ['MONGO_URI', 'JWT_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please check your .env file or set the following variables:');
    missing.forEach(key => console.error(`  - ${key}`));
    process.exit(1);
  }

  // Warn about missing optional variables in production
  if (process.env.NODE_ENV === 'production') {
    const recommended = ['JWT_RESET_SECRET', 'CORS_ORIGIN', 'SMTP_HOST', 'SMTP_USER'];
    const missingOptional = recommended.filter(key => !process.env[key]);
    if (missingOptional.length > 0) {
      console.warn(`⚠️  Missing recommended environment variables: ${missingOptional.join(', ')}`);
    }
  }
};

validateEnvironment();

const isProduction = process.env.NODE_ENV === 'production';

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return fallback;
};

const GLOBAL_RATE_LIMIT_WINDOW_MS = parsePositiveInt(
  process.env.GLOBAL_RATE_LIMIT_WINDOW_MS,
  15 * 60 * 1000
);

const GLOBAL_RATE_LIMIT_MAX = parsePositiveInt(
  process.env.GLOBAL_RATE_LIMIT_MAX,
  1200
);

const getRateLimitKey = (req) => {
  const authHeader = req.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded && typeof decoded === 'object' && decoded.id) {
          return `user:${decoded.id}`;
        }
      } catch (_error) {
        // Fall back to IP-based key when token is invalid.
      }
    }
  }

  return `ip:${req.ip}`;
};

const configuredOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

const hasWildcardOrigin = configuredOrigins.includes('*');
const defaultDevOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const allowlistOrigins = configuredOrigins.length
  ? configuredOrigins.filter((origin) => origin !== '*')
  : (isProduction ? [] : defaultDevOrigins);

if (isProduction && (hasWildcardOrigin || allowlistOrigins.length === 0)) {
  throw new Error('CORS_ORIGIN must be configured in production.');
}

const isLocalDevOrigin = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

const corsOriginEvaluator = (origin, callback) => {
  // Allow non-browser clients and same-origin requests without Origin header.
  if (!origin) return callback(null, true);

  if (!isProduction && (hasWildcardOrigin || isLocalDevOrigin(origin))) {
    return callback(null, true);
  }

  if (allowlistOrigins.includes(origin)) {
    return callback(null, true);
  }

  return callback(new Error('Origin not allowed by CORS policy.'));
};

const corsConfig = {
  origin: corsOriginEvaluator,
  credentials: true,
};

// ─── Initialize Express & HTTP Server ────────────────────────────
const app = express();
const server = http.createServer(app);

// ─── Socket.io (attached to HTTP server, configured in Phase 4) ──
const io = new Server(server, {
  cors: {
    origin: corsOriginEvaluator,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

io.use(async (socket, next) => {
  try {
    // Try to get token from cookies first (secure approach)
    let token = socket.handshake.headers.cookie
      ? socket.handshake.headers.cookie
        .split('; ')
        .find(c => c.startsWith('auth_token='))
        ?.slice(11)
      : null;

    // Fall back to auth token in handshake or Authorization header
    if (!token) {
      const rawToken = socket.handshake.auth?.token || socket.handshake.headers.authorization;
      token = typeof rawToken === 'string' && rawToken.startsWith('Bearer ')
        ? rawToken.slice(7)
        : rawToken;
    }

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

// Security headers with comprehensive config
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https:', 'wss:'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      childSrc: ["'none'"],
    },
  },
  frameguard: {
    action: 'deny', // Prevent clickjacking
  },
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
}));

// CORS
app.use(
  cors(corsConfig)
);
app.options('*', cors(corsConfig));

// Cookie parsing
app.use(cookieParser());

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
  windowMs: GLOBAL_RATE_LIMIT_WINDOW_MS,
  max: GLOBAL_RATE_LIMIT_MAX,
  keyGenerator: getRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use(globalLimiter);

// ─── Health Check ────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    // Check MongoDB connection
    const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    // Attempt a simple database query to verify actual connectivity
    let dbHealthy = false;
    try {
      await mongoose.connection.db.admin().ping();
      dbHealthy = true;
    } catch {
      dbHealthy = false;
    }

    const status = dbHealthy ? 200 : 503;

    res.status(status).json({
      status: dbHealthy ? 'ok' : 'degraded',
      service: 'GoShuttle API',
      timestamp: new Date().toISOString(),
      database: {
        status: mongoStatus,
        connected: dbHealthy,
      },
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      service: 'GoShuttle API',
      timestamp: new Date().toISOString(),
      error: 'Failed to determine health status',
    });
  }
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
