const assert = require('assert');

// Mirrors the logic used in app/(tabs)/index.tsx for handling pickup:claimed
function computeNewDriverAssignedPickupRequest(current, payload, assignedShuttle) {
  if (!current || String(current._id) !== String(payload.requestId)) return current;
  if (payload.shuttleId && assignedShuttle && String(payload.shuttleId) === String(assignedShuttle._id)) {
    return current;
  }
  return null;
}

// Test fixtures
const assignedShuttle = { _id: 'shuttle-1' };
const otherShuttle = { _id: 'shuttle-2' };
const currentRequest = { _id: 'req-123', passengerId: 'pass-1' };

// 1) current is null -> unchanged
assert.strictEqual(computeNewDriverAssignedPickupRequest(null, { requestId: 'req-123', shuttleId: 'shuttle-1' }, assignedShuttle), null);

// 2) current._id doesn't match payload -> unchanged
assert.strictEqual(computeNewDriverAssignedPickupRequest(currentRequest, { requestId: 'req-999', shuttleId: 'shuttle-1' }, assignedShuttle), currentRequest);

// 3) claimed by this shuttle -> keep current
assert.strictEqual(computeNewDriverAssignedPickupRequest(currentRequest, { requestId: 'req-123', shuttleId: 'shuttle-1' }, assignedShuttle), currentRequest);

// 4) claimed by other shuttle -> clear (null)
assert.strictEqual(computeNewDriverAssignedPickupRequest(currentRequest, { requestId: 'req-123', shuttleId: 'shuttle-2' }, assignedShuttle), null);

// 5) payload has no shuttleId -> clear (null) because claim came but no shuttle specified
assert.strictEqual(computeNewDriverAssignedPickupRequest(currentRequest, { requestId: 'req-123' }, assignedShuttle), null);

console.log('All pickup-claimed unit tests passed');
