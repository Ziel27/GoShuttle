const assert = require('assert');
const { computeEligibleDriverIds } = require('../backend/src/services/dispatch-utils');

// Mock shuttles: two drivers
const shuttles = [
  {
    _id: 'shuttle-1',
    driverId: { _id: 'driver-1', status: 'driving' },
    assignedPhase: 'north',
    currentCapacity: 2,
    maxCapacity: 10,
  },
  {
    _id: 'shuttle-2',
    driverId: { _id: 'driver-2', status: 'driving' },
    assignedPhase: 'north',
    currentCapacity: 1,
    maxCapacity: 3,
  },
  {
    _id: 'shuttle-3',
    driverId: { _id: 'driver-3', status: 'off' },
    assignedPhase: 'north',
    currentCapacity: 0,
    maxCapacity: 10,
  },
];

// pendingAgg: shuttle-1 has 1 pending, shuttle-2 has 0
const pendingAgg = [
  { _id: 'shuttle-1', count: 1 },
];

// Pickup request with 5 passengers, phase 'north'
const pickupRequest = {
  _id: 'req-1',
  passengerManifest: new Array(5).fill({}),
  passengerHomePhase: 'north',
};

const eligible = computeEligibleDriverIds({ shuttles, pendingAgg, pickupRequest });

// shuttle-1: available = 10 - (2+1)=7 >=5 -> eligible (driver-1)
// shuttle-2: available = 3 - (1+0)=2 <5 -> not eligible
// shuttle-3: driver not driving -> not eligible

assert.deepStrictEqual(eligible, ['driver-1']);

console.log('Backend pickup eligibility test passed');
