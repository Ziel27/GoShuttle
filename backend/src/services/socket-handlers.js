const Shuttle = require('../models/Shuttle');
const PickupRequest = require('../models/PickupRequest');
const { isLocationInBoundary } = require('./geofence');
const { retryWaitingQueue } = require('./dispatch.service');

/**
 * Finds all active pickup requests assigned to shuttleId and pushes a
 * real-time location update to their dedicated public tracking rooms.
 * Called after every shuttle location write (REST + socket paths).
 */
const emitToTrackingRooms = async (io, shuttleId, location, updatedAt) => {
  try {
    if (!location || !Array.isArray(location.coordinates) || location.coordinates.length < 2) return;
    const [lng, lat] = location.coordinates;

    const activeRequests = await PickupRequest.find({
      assignedShuttleId: shuttleId,
      status: { $in: ['dispatched', 'claimed'] },
      trackingToken: { $exists: true, $ne: null },
    }).select('trackingToken').lean();

    for (const req of activeRequests) {
      if (req.trackingToken) {
        io.to(`tracking:${req.trackingToken}`).emit('tracking:location-updated', {
          latitude: lat,
          longitude: lng,
          updatedAt: updatedAt || new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    console.error('[emitToTrackingRooms] error:', err);
  }
};


const isDriverOrAdmin = (role) => role === 'driver' || role === 'admin';
const DRIVER_LOCATION_THROTTLE_MS = 500;
const CAPACITY_UPDATE_THROTTLE_MS = 300;

const registerSocketHandlers = (io) => {
  // TODO: Move socket event throttling to a shared limiter (Redis) — in-memory socket throttles do not protect multi-instance deployments.
  io.on('connection', (socket) => {
    const lastEventAt = {
      driverLocation: 0,
      capacityUpdate: 0,
    };

    socket.on('join-community', ({ communityId }) => {
      const userCommunityId = socket.data?.user?.communityId?.toString();
      if (!userCommunityId) return;
      if (communityId && communityId !== userCommunityId) {
        socket.emit('socket:error', { error: 'Access denied for the requested community.' });
        return;
      }

      socket.join(`community:${userCommunityId}`);
    });

    socket.on('driver-location', async (payload) => {
      try {
        const { shuttleId, latitude, longitude } = payload || {};
        const socketUser = socket.data?.user;

        if (!socketUser || !isDriverOrAdmin(socketUser.role)) {
          socket.emit('socket:error', { error: 'Only drivers and admins can update shuttle location.' });
          return;
        }

        const now = Date.now();
        if (now - lastEventAt.driverLocation < DRIVER_LOCATION_THROTTLE_MS) {
          socket.emit('socket:error', { error: 'Too many driver-location updates. Please slow down.' });
          return;
        }
        lastEventAt.driverLocation = now;

        if (!shuttleId) {
          socket.emit('socket:error', { error: 'shuttleId is required.' });
          return;
        }

        const lat = Number(latitude);
        const lng = Number(longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          socket.emit('socket:error', { error: 'Invalid coordinates.' });
          return;
        }

        const shuttle = await Shuttle.findById(shuttleId);
        if (!shuttle) {
          socket.emit('socket:error', { error: 'Shuttle not found.' });
          return;
        }

        const communityId = shuttle.communityId?.toString();
        if (!communityId || communityId !== socketUser.communityId.toString()) {
          socket.emit('socket:error', { error: 'Access denied for this shuttle.' });
          return;
        }

        if (socketUser.role === 'driver' && String(shuttle.driverId || '') !== String(socketUser._id)) {
          socket.emit('socket:error', { error: 'Access denied. This shuttle is not assigned to you.' });
          return;
        }

        const insideBoundary = await isLocationInBoundary({
          communityId,
          latitude: lat,
          longitude: lng,
        });

        if (!insideBoundary) {
          shuttle.status = 'out_of_bounds';
          shuttle.lastLocationUpdate = new Date();
          await shuttle.save();

          io.to(`community:${communityId}`).emit('shuttle:out-of-bounds', {
            shuttleId,
            communityId,
            status: shuttle.status,
            updatedAt: shuttle.lastLocationUpdate,
          });
          return;
        }

        shuttle.location = {
          type: 'Point',
          coordinates: [lng, lat],
        };
        shuttle.lastLocationUpdate = new Date();
        if (shuttle.status === 'idle' || shuttle.status === 'out_of_bounds') {
          shuttle.status = 'en_route';
        }

        await shuttle.save();

        io.to(`community:${communityId}`).emit('shuttle:location-updated', {
          shuttleId: shuttle._id,
          communityId,
          location: shuttle.location,
          status: shuttle.status,
          currentCapacity: shuttle.currentCapacity,
          maxCapacity: shuttle.maxCapacity,
          updatedAt: shuttle.lastLocationUpdate,
        });

        // Push real-time location to any public tracking pages watching this shuttle
        emitToTrackingRooms(io, shuttle._id, shuttle.location, shuttle.lastLocationUpdate);

      } catch (error) {
        console.error('Socket driver-location error:', error);
        socket.emit('socket:error', { error: 'Failed to process driver-location event.' });
      }
    });

    socket.on('capacity-update', async (payload) => {
      try {
        const { shuttleId, delta } = payload || {};
        const socketUser = socket.data?.user;

        if (!socketUser || !isDriverOrAdmin(socketUser.role)) {
          socket.emit('socket:error', { error: 'Only drivers and admins can update shuttle capacity.' });
          return;
        }

        const now = Date.now();
        if (now - lastEventAt.capacityUpdate < CAPACITY_UPDATE_THROTTLE_MS) {
          socket.emit('socket:error', { error: 'Too many capacity updates. Please slow down.' });
          return;
        }
        lastEventAt.capacityUpdate = now;

        if (!shuttleId) {
          socket.emit('socket:error', { error: 'shuttleId is required.' });
          return;
        }

        const parsedDelta = Number(delta);
        if (!Number.isInteger(parsedDelta) || parsedDelta === 0) {
          socket.emit('socket:error', { error: 'delta must be a non-zero integer.' });
          return;
        }

        const shuttle = await Shuttle.findById(shuttleId);
        if (!shuttle) {
          socket.emit('socket:error', { error: 'Shuttle not found.' });
          return;
        }

        const communityId = shuttle.communityId?.toString();
        if (!communityId || communityId !== socketUser.communityId.toString()) {
          socket.emit('socket:error', { error: 'Access denied for this shuttle.' });
          return;
        }

        if (socketUser.role === 'driver' && String(shuttle.driverId || '') !== String(socketUser._id)) {
          socket.emit('socket:error', { error: 'Access denied. This shuttle is not assigned to you.' });
          return;
        }

        const nextCapacity = shuttle.currentCapacity + parsedDelta;
        if (nextCapacity < 0 || nextCapacity > shuttle.maxCapacity) {
          socket.emit('socket:error', {
            error: `Capacity update rejected. Valid range is 0 to ${shuttle.maxCapacity}.`,
          });
          return;
        }

        shuttle.currentCapacity = nextCapacity;
        shuttle.lastLocationUpdate = new Date();
        await shuttle.save();

        io.to(`community:${communityId}`).emit('shuttle:capacity-updated', {
          shuttleId: shuttle._id,
          communityId,
          currentCapacity: shuttle.currentCapacity,
          maxCapacity: shuttle.maxCapacity,
          capacityStatus: shuttle.capacityStatus,
          updatedAt: shuttle.updatedAt,
        });

        // DISPATCH: When capacity decreases (passenger unboarded), retry waiting queue
        if (parsedDelta < 0) {
          setImmediate(() => {
            retryWaitingQueue(communityId, io).catch((err) =>
              console.error('[socket:capacity-update] retryWaitingQueue error:', err)
            );
          });
        }

      } catch (error) {
        console.error('Socket capacity-update error:', error);
        socket.emit('socket:error', { error: 'Failed to process capacity-update event.' });
      }
    });

    // ── Public tracking room (no auth — only tracking-only sockets allowed) ──
    socket.on('join-tracking', ({ trackingToken }) => {
      if (!socket.data.trackingToken || socket.data.trackingToken !== trackingToken) {
        socket.emit('socket:error', { error: 'Unauthorized.' });
        return;
      }
      socket.join(`tracking:${trackingToken}`);
    });

    socket.on('disconnect', () => {
      // no-op for now; clients are expected to auto-reconnect and rejoin via join-community.
    });
  });
};

module.exports = { registerSocketHandlers, emitToTrackingRooms };
