const Shuttle = require('../models/Shuttle');
const { isLocationInBoundary } = require('./geofence');

const isDriverOrAdmin = (role) => role === 'driver' || role === 'admin';

const registerSocketHandlers = (io) => {
  io.on('connection', (socket) => {
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
      } catch (error) {
        console.error('Socket capacity-update error:', error);
        socket.emit('socket:error', { error: 'Failed to process capacity-update event.' });
      }
    });

    socket.on('disconnect', () => {
      // no-op for now, hook reserved for presence tracking
    });
  });
};

module.exports = { registerSocketHandlers };
