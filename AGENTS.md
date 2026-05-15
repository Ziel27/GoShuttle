# GoShuttle — Agent Guide

## Project structure

Three packages in one repo:

| Path | Stack | Entry | Dev command |
|------|-------|-------|-------------|
| `./` (root) | Expo 54 + React Native, expo-router, Zustand | `expo-router/entry` | `npx expo start` |
| `backend/` | Express + Mongoose + Socket.io (CJS) | `src/server.js` | `cd backend && npm run dev` (nodemon) |
| `admin-web/` | React 19 + Vite + Tailwind + react-router (ESM) | `src/main.tsx` | `cd admin-web && npm run dev` (port 5000) |

## Essential commands

```bash
# Mobile app
npm install           # Install root deps
npx expo start        # Dev server (Expo Go / simulator)
npx expo start --web  # Web preview
npm run lint          # expo lint (ESLint flat config)

# Backend
cd backend && npm run dev            # Dev with nodemon on :5000
cd backend && npm run test           # Integration tests (node:test + supertest + mongodb-memory-server)
cd backend && npm run test:watch     # Watch mode

# Admin web
cd admin-web && npm run dev          # Vite dev on :5000 (proxies /api -> localhost:3001, /socket.io -> localhost:3001)
cd admin-web && npm run build        # tsc -b && vite build
cd admin-web && npm run preview      # Preview production build
```

## Testing

- **Backend**: uses Node built-in `node:test` + `supertest` + `mongodb-memory-server`. No Jest/Mocha.
  - Run: `cd backend && npm run test`
  - Runs with `--test-concurrency=1` (sequential tests).
  - Tests auto-set `NODE_ENV=test` and create an in-memory MongoDB.
  - Single file: `tests/api.integration.test.js` (730 lines), `tests/security.integration.test.js`.
- **Mobile**: no test framework configured. Only a tiny standalone unit test script at `scripts/test-pickup-claimed.js` that you run with `npm run test:unit`.

## Architecture notes

- **Auth**: JWT via HttpOnly cookie (`auth_token`) or Bearer header. Auto-logout on 401 via Axios interceptor (`services/api.ts:36-40`).
- **Real-time**: Socket.io with `connectCommunitySocket(communityId, token)` — joins a room per community. Tracking uses `trackingToken` instead of JWT.
- **State**: Zustand stores in `store/` — `auth.ts` (token/user session in SecureStore) and `preferences.ts`.
- **API client**: Axios instance in `services/api.ts`, base URL from `EXPO_PUBLIC_API_URL`. Sockets from `EXPO_PUBLIC_SOCKET_URL`.
- **Routing**: expo-router file-based routing in `app/`. Tab layout at `app/(tabs)/`, auth screens at `app/(auth)/`.
- **Theme**: Custom design tokens in `constants/theme.ts`. Uses `@expo-google-fonts/outfit` (Outfit font family).
- **Path alias**: `@/*` maps to root in mobile app; `@/*` maps to `./src/*` in admin-web.

## Backend specifics

- **Required env**: `MONGO_URI`, `JWT_SECRET`. SMTP vars needed for password reset. Cloudinary vars for image uploads.
- **Server starts on `PORT` (default 5000)** in Docker, but **bare-metal PM2 uses port 3000** (`ecosystem.config.js`).
- **Middleware stack**: helmet → cors → cookie-parser → express.json (10kb limit) → mongo-sanitize → morgan → rate-limit.
- **Health check**: `GET /api/health` — pings MongoDB, returns status + uptime.
- **Background jobs**: remittance enforcement, ID verification expiration, dispatch timeout — skip when `NODE_ENV=test`.
- **Models** (10 total): User, Community, Shuttle, Trip, PickupRequest, RideRequest, PassengerRide, ShiftRemittance, Announcement, Ticket.
- **Uploads**: remittance receipts stored at `uploads/`, served at `/uploads`. Multer middleware in `middleware/upload.js`.
- **Known gotcha**: Destination fallback in `trip.controller.js` — legacy clients without `destination` param get pickup coords as destination. See `DESTINATION_FLOW_ANALYSIS.md` for full analysis.

## Docker deployment

Three compose files using an external `proxy` network:

1. `docker-compose.yml` — backend (port 5000) + admin-web (port 3001). Internal Caddy reverse proxy routes `admin.goshuttle.app` → admin-web, `api.goshuttle.app` → backend.
2. `docker-compose.backend-cloudflare.yml` — Cloudflare tunnel for API (needs `CLOUDFLARE_API_TUNNEL_TOKEN`).
3. `docker-compose.expo-cloudflare.yml` — Expo dev server (port 8081) + Cloudflare tunnel.

Deploy order: backend stack first, then tunnel stacks. Tunnel only creates the secure path; Cloudflare dashboard must map hostname to backend service.

- `ecosystem.config.js` is for **bare-metal only** (PM2). Ignore it when working with Docker.
- `.replit` config is for Replit deployments, not production.

## Linting

- **Mobile**: `npm run lint` — uses `eslint-config-expo/flat` (flat config via `eslint.config.js`).
- **Backend**: no lint config.
- **Admin-web**: `cd admin-web && npm run lint` — ESLint with react-hooks + react-refresh plugins.