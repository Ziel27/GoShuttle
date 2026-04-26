export type Role = 'admin' | 'driver' | 'passenger';

export type Community = {
  _id: string;
  name: string;
  opsBypassMode?: boolean;
  boundaries?: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  fixedDestinations?: Array<{
    _id: string;
    name: string;
    location: {
      type: 'Point';
      coordinates: [number, number];
    };
    order?: number;
    isActive?: boolean;
  }>;
  phaseGeofences?: Array<{
    _id: string;
    name: string;
    boundaries: {
      type: 'Polygon';
      coordinates: number[][][];
    };
    color?: string;
    order?: number;
    isActive?: boolean;
  }>;
  baseFare?: number;
  priorityFareMultiplier?: number;
  isActive?: boolean;

  branding?: {
    primaryColor?: string;
    logoUrl?: string;
  };
};

export type User = {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  communityId: string | Community;
  status?: 'active' | 'offline' | 'driving';
  isActive?: boolean;
};

export type Shuttle = {
  _id: string;
  communityId:
  | string
  | {
    _id?: string;
    name?: string;
  };
  driverId:
  | null
  | string
  | {
    _id?: string;
    firstName?: string;
    lastName?: string;
    status?: string;
  };
  plateNumber: string;
  label: string;
  assignedPhase?: string | null;
  maxCapacity: number;
  currentCapacity: number;
  status: 'idle' | 'en_route' | 'out_of_bounds' | 'maintenance';
  location?: {
    type: 'Point';
    coordinates: [number, number];
  };
  lastLocationUpdate?: string;
  updatedAt?: string;
};

export type AnalyticsTotals = {
  totalPassengers: number;
  totalRevenue: number;
  tripCount: number;
};

export type AnalyticsSeriesPoint = {
  _id: {
    year: number;
    month: number;
    day: number;
  };
  totalPassengers: number;
  totalRevenue: number;
  tripCount: number;
};

export type AnalyticsResponse = {
  range: {
    startDate: string;
    endDate: string;
  };
  totals: AnalyticsTotals;
  series: AnalyticsSeriesPoint[];
};

export type LiveEvent = {
  id: string;
  label: string;
  createdAt: number;
};

export type DriverAnalyticsRow = {
  driverId: string;
  firstName: string;
  lastName: string;
  email: string;
  status: 'active' | 'offline' | 'driving';
  isActive: boolean;
  tripCount: number;
  totalPassengers: number;
  totalRevenue: number;
  averagePassengersPerTrip: number;
  lastShiftAt: string | null;
};

export type DriverAnalyticsResponse = {
  range: {
    startDate: string;
    endDate: string;
  };
  totals: {
    tripCount: number;
    totalPassengers: number;
    totalRevenue: number;
  };
  drivers: DriverAnalyticsRow[];
};

export type DriverPerformanceShiftRow = {
  tripId: string;
  shiftDate: string;
  shiftStatus: string;
  passengers: number;
  expectedRemittance: number;
  actualRemittance: number;
  variance: number;
  remittanceStatus: string;
  submittedOnTime: boolean;
  ignoredRequests: number;
  lateManualBoards: number;
};

export type DriverPerformanceRow = {
  driverId: string;
  driverName: string;
  totalShifts: number;
  totalShiftHours: number;
  totalRequestsReceived: number;
  totalPassengersBoarded: number;
  totalAutoBoarded: number;
  totalManualBoarded: number;
  totalLateManualBoarded: number;
  totalIgnoredRequests: number;
  totalNoShows: number;
  totalExpectedRemittance: number;
  totalActualRemittance: number;
  totalVariance: number;
  totalFlaggedRemittances: number;
  totalVerifiedRemittances: number;
  totalEscalatedRemittances: number;
  onTimeSubmissionRate: number;
  flagRate: number;
  lateManualBoardRate: number;
  ignoredRequestRate: number;
  varianceRate: number;
  shifts: DriverPerformanceShiftRow[];
};

export type DriverPerformanceResponse = {
  range: {
    startDate: string;
    endDate: string;
  };
  driversNeedingAttention: number;
  drivers: DriverPerformanceRow[];
};

export type RemittanceSummarySeriesPoint = {
  period: string;
  expectedAmount: number;
  actualAmount: number;
  varianceAmount: number;
  remittanceCount: number;
};

export type RemittanceSummaryDriverRow = {
  driverId: string;
  firstName: string;
  lastName: string;
  email: string;
  expectedAmount: number;
  actualAmount: number;
  varianceAmount: number;
  remittanceCount: number;
};

export type RideRequestBreakdown = {
  totalRequests: number;
  totalBoarded: number;
  totalCompleted: number;
  totalCancelled: number;
  totalIgnored: number;
  totalPending: number;
  totalLateManual: number;
  totalFareExpected: number;
};

export type RideRequestBreakdownByDriverRow = {
  driverId: string;
  firstName: string;
  lastName: string;
  email: string;
  totalRequests: number;
  totalBoarded: number;
  totalCompleted: number;
  totalCancelled: number;
  totalIgnored: number;
  totalPending: number;
  totalLateManual: number;
};

export type RemittanceSummaryResponse = {
  range: {
    startDate: string;
    endDate: string;
  };
  groupBy: 'day' | 'week' | 'month';
  totals: {
    expectedAmount: number;
    actualAmount: number;
    varianceAmount: number;
    remittanceCount: number;
    pendingCount: number;
    verifiedCount: number;
    flaggedCount: number;
    missingCount: number;
    missingExpectedAmount: number;
  };
  rideRequestBreakdown?: RideRequestBreakdown;
  rideRequestBreakdownByDriver?: RideRequestBreakdownByDriverRow[];
  series: RemittanceSummarySeriesPoint[];
  drivers: RemittanceSummaryDriverRow[];
  missingByDriver: Array<{
    driverId: string;
    firstName: string;
    lastName: string;
    email: string;
    missingCount: number;
    missingExpectedAmount: number;
  }>;
};

export type Remittance = {
  _id: string;
  communityId: string;
  tripId: string | {
    _id?: string;
    shiftStart?: string;
    shiftEnd?: string;
    status?: string;
  };
  shuttleId: string | {
    _id?: string;
    plateNumber?: string;
    label?: string;
  };
  driverId: string | {
    _id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
  expectedAmount: number;
  actualAmount: number;
  varianceAmount: number;
  submittedAt: string;
  status: 'not_submitted' | 'pending' | 'verified' | 'flagged' | 'overdue' | 'escalated';
  driverNote: string;
  adminNote: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  receiptUrl?: string;
  receiptUploadedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AnnouncementLevel = 'info' | 'warning' | 'critical';

export type Announcement = {
  _id: string;
  communityId: string;
  createdBy: string | {
    _id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    role?: Role;
  };
  title: string;
  body: string;
  level: AnnouncementLevel;
  createdAt: string;
  updatedAt: string;
};

