import { ThemedText } from '@/components/themed-text';
import { PremiumButton } from '@/components/ui/premium-button';
import { PremiumCard } from '@/components/ui/premium-card';
import { SectionHeader } from '@/components/ui/section-header';
import { getCapacityColor } from '@/constants/app-ui';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { listShuttles, Shuttle } from '@/services/shuttle';
import { connectCommunitySocket } from '@/services/socket';
import {
  DriverCompletedTrip,
  listDriverCompletedTrips,
  submitRemittance,
} from '@/services/trip';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const capacityColor = getCapacityColor;

type OpsTab = 'fleet' | 'remittance';

const STATUS_LABEL: Record<string, string> = {
  not_submitted: 'Not Submitted',
  pending: 'Pending Review',
  verified: 'Verified ✓',
  flagged: 'Flagged ⚠',
};

const STATUS_COLOR_KEY: Record<string, 'warning' | 'success' | 'danger' | 'textMuted'> = {
  not_submitted: 'warning',
  pending: 'textMuted',
  verified: 'success',
  flagged: 'danger',
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(n: number) {
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FleetScreen() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const quietMode = usePreferencesStore((state) => state.quietMode);
  const serviceUpdates = usePreferencesStore((state) => state.serviceUpdates);
  const isDriver = user?.role === 'driver';
  const tint = useThemeColor({}, 'tint');
  const textColor = useThemeColor({}, 'text');
  const mutedColor = useThemeColor({}, 'textMuted');
  const dangerColor = useThemeColor({}, 'danger');
  const successColor = useThemeColor({}, 'success');
  const warningColor = useThemeColor({}, 'warning');
  const bgColor = useThemeColor({}, 'background');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const onTint = useThemeColor({}, 'background');
  const [activeTab, setActiveTab] = useState<OpsTab>(isDriver ? 'remittance' : 'fleet');
  const [shuttles, setShuttles] = useState<Shuttle[]>([]);
  const [feedback, setFeedback] = useState<{ message: string; type: 'service' | 'critical' } | null>(null);
  const [loading, setLoading] = useState(false);

  // Remittance state
  const [trips, setTrips] = useState<DriverCompletedTrip[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [submittingTripId, setSubmittingTripId] = useState<string | null>(null);
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>({});
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  const totals = useMemo(() => {
    const totalMaxCapacity = shuttles.reduce((sum, item) => sum + item.maxCapacity, 0);
    const totalCurrentCapacity = shuttles.reduce((sum, item) => sum + item.currentCapacity, 0);
    const utilizationPercent = totalMaxCapacity > 0 ? Math.round((totalCurrentCapacity / totalMaxCapacity) * 100) : 0;

    const activeShiftCount = shuttles.filter(
      (item) => item.driverId && typeof item.driverId === 'object' && item.driverId.status === 'driving'
    ).length;
    const offShiftCount = Math.max(0, shuttles.length - activeShiftCount);
    return {
      activeShiftCount,
      offShiftCount,
      utilizationPercent,
    };
  }, [shuttles]);

  const remittanceSummary = useMemo(() => {
    const needsSubmission = trips.filter((t) => t.remittanceStatus === 'not_submitted').length;
    const pending = trips.filter((t) => t.remittanceStatus === 'pending').length;
    const verified = trips.filter((t) => t.remittanceStatus === 'verified').length;
    const flagged = trips.filter((t) => t.remittanceStatus === 'flagged').length;
    const totalExpected = trips.reduce((sum, t) => sum + t.expectedRemittance, 0);
    return { needsSubmission, pending, verified, flagged, totalExpected };
  }, [trips]);

  const getDriverShiftStatus = (driverId: Shuttle['driverId']) => {
    if (driverId && typeof driverId === 'object') {
      return driverId.status || 'offline';
    }
    return 'offline';
  };

  const getDisplayedShuttleStatus = (shuttle: Shuttle) => {
    const driverShift = getDriverShiftStatus(shuttle.driverId);
    if (driverShift !== 'driving' && shuttle.status !== 'maintenance') {
      return 'idle';
    }
    return shuttle.status;
  };

  const setPreferenceAwareFeedback = useCallback((
    message: string,
    channel: 'service' | 'critical' = 'service'
  ) => {
    if (channel === 'critical') {
      setFeedback({ message, type: channel });
      return;
    }

    if (quietMode || !serviceUpdates) return;
    setFeedback({ message, type: channel });
  }, [quietMode, serviceUpdates]);

  const refreshFleet = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listShuttles();
      setShuttles(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load fleet.';
      setPreferenceAwareFeedback(message, 'critical');
    } finally {
      setLoading(false);
    }
  }, [setPreferenceAwareFeedback]);

  const refreshTrips = useCallback(async () => {
    setTripsLoading(true);
    try {
      const data = await listDriverCompletedTrips();
      setTrips(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load trips.';
      setPreferenceAwareFeedback(message, 'critical');
    } finally {
      setTripsLoading(false);
    }
  }, [setPreferenceAwareFeedback]);

  const handleSubmitRemittance = useCallback(async (trip: DriverCompletedTrip) => {
    const rawAmount = amountInputs[trip.tripId];
    const amount = parseFloat(rawAmount || '');
    if (isNaN(amount) || amount < 0) {
      Alert.alert('Invalid Amount', 'Please enter the actual amount you collected.');
      return;
    }

    const variance = amount - trip.expectedRemittance;
    const varianceText = variance === 0
      ? 'Amount matches expected.'
      : variance > 0
        ? `Over by ${formatCurrency(variance)}`
        : `Under by ${formatCurrency(Math.abs(variance))}`;

    Alert.alert(
      'Confirm Remittance',
      `Expected: ${formatCurrency(trip.expectedRemittance)}\nYour Amount: ${formatCurrency(amount)}\n${varianceText}\n\nSubmit this remittance?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            setSubmittingTripId(trip.tripId);
            try {
              await submitRemittance(trip.tripId, amount, noteInputs[trip.tripId]);
              // Update local state
              setTrips((prev) =>
                prev.map((t) =>
                  t.tripId === trip.tripId
                    ? {
                        ...t,
                        remittanceStatus: 'pending' as const,
                        remittanceActualAmount: amount,
                        remittanceVariance: variance,
                        remittanceSubmittedAt: new Date().toISOString(),
                      }
                    : t
                )
              );
              setAmountInputs((prev) => {
                const next = { ...prev };
                delete next[trip.tripId];
                return next;
              });
              setNoteInputs((prev) => {
                const next = { ...prev };
                delete next[trip.tripId];
                return next;
              });
              Alert.alert('Submitted', 'Remittance submitted for admin review.');
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Failed to submit.';
              Alert.alert('Error', message);
            } finally {
              setSubmittingTripId(null);
            }
          },
        },
      ]
    );
  }, [amountInputs, noteInputs]);

  // Socket + initial load
  useEffect(() => {
    if (!user?.communityId) return;

    // Drivers start on remittance tab — only load trips initially
    if (isDriver) {
      refreshTrips();
    } else {
      refreshFleet();
    }

    const socket = connectCommunitySocket(user.communityId, token);

    const onLocationUpdated = (payload: {
      shuttleId: string;
      status?: Shuttle['status'];
      location?: Shuttle['location'];
      currentCapacity?: number;
      maxCapacity?: number;
    }) => {
      setShuttles((items) =>
        items.map((item) =>
          item._id === payload.shuttleId
            ? {
                ...item,
                ...payload,
                currentCapacity: payload.currentCapacity ?? item.currentCapacity,
                maxCapacity: payload.maxCapacity ?? item.maxCapacity,
              }
            : item
        )
      );
    };

    const onCapacityUpdated = (payload: {
      shuttleId: string;
      currentCapacity?: number;
      maxCapacity?: number;
      capacityStatus?: Shuttle['capacityStatus'];
    }) => {
      setShuttles((items) =>
        items.map((item) =>
          item._id === payload.shuttleId
            ? {
                ...item,
                currentCapacity: payload.currentCapacity ?? item.currentCapacity,
                maxCapacity: payload.maxCapacity ?? item.maxCapacity,
                capacityStatus: payload.capacityStatus ?? item.capacityStatus,
              }
            : item
        )
      );
    };

    socket.on('shuttle:location-updated', onLocationUpdated);
    socket.on('shuttle:capacity-updated', onCapacityUpdated);

    return () => {
      socket.off('shuttle:location-updated', onLocationUpdated);
      socket.off('shuttle:capacity-updated', onCapacityUpdated);
    };
  }, [refreshFleet, refreshTrips, token, user?.communityId, isDriver]);

  const getStatusColor = (status: string) => {
    const key = STATUS_COLOR_KEY[status] || 'textMuted';
    switch (key) {
      case 'success': return successColor;
      case 'danger': return dangerColor;
      case 'warning': return warningColor;
      default: return mutedColor;
    }
  };

  const renderFleetTab = () => (
    <>
      <PremiumCard style={styles.summaryCard} muted>
        <ThemedText type="defaultSemiBold" style={{ color: textColor }}>Fleet Status</ThemedText>
        <View style={styles.metricsRow}>
          <View style={[styles.metricItem, { backgroundColor: surfaceMuted }]}>
            <ThemedText type="title" style={{ color: successColor }}>{totals.activeShiftCount}</ThemedText>
            <ThemedText type="overline" style={{ color: mutedColor }}>On Shift</ThemedText>
          </View>
          <View style={[styles.metricItem, { backgroundColor: surfaceMuted }]}>
            <ThemedText type="title" style={{ color: mutedColor }}>{totals.offShiftCount}</ThemedText>
            <ThemedText type="overline" style={{ color: mutedColor }}>Off Shift</ThemedText>
          </View>
          <View style={[styles.metricItem, { backgroundColor: surfaceMuted }]}>
            <ThemedText type="title" style={{ color: textColor }}>{totals.utilizationPercent}%</ThemedText>
            <ThemedText type="overline" style={{ color: mutedColor }}>Utilization</ThemedText>
          </View>
        </View>
      </PremiumCard>

      {shuttles.map((item) => (
        <PremiumCard key={item._id} style={styles.shuttleCard}>
          <View style={styles.shuttleHead}>
            <View style={styles.shuttleTitleWrap}>
              <Ionicons name="bus" size={16} color={tint} />
              <ThemedText type="subtitle" style={{ color: textColor }}>
                {item.plateNumber} {item.label ? `- ${item.label}` : ''}
              </ThemedText>
            </View>
            <ThemedText type="overline" style={{ color: mutedColor }}>{getDisplayedShuttleStatus(item)}</ThemedText>
          </View>

          <View style={styles.rowLine}>
            <ThemedText type="caption" style={{ color: mutedColor }}>Capacity</ThemedText>
            <ThemedText type="defaultSemiBold" style={{ color: capacityColor(item.currentCapacity, item.maxCapacity) }}> 
              {item.currentCapacity}/{item.maxCapacity}
            </ThemedText>
          </View>

          <View style={styles.rowLine}>
            <ThemedText type="caption" style={{ color: mutedColor }}>Shift</ThemedText>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: getDriverShiftStatus(item.driverId) === 'driving' ? successColor : mutedColor,
                  },
                ]}
              />
              <ThemedText type="defaultSemiBold" style={{ color: textColor }}>
                {getDriverShiftStatus(item.driverId) === 'driving' ? 'On Shift' : 'Off Shift'}
              </ThemedText>
            </View>
          </View>
        </PremiumCard>
      ))}
    </>
  );

  const renderRemittanceTab = () => (
    <>
      {/* Summary */}
      <PremiumCard style={styles.summaryCard} muted>
        <ThemedText type="defaultSemiBold" style={{ color: textColor }}>Remittance Overview</ThemedText>
        <View style={styles.metricsRow}>
          <View style={[styles.metricItem, { backgroundColor: surfaceMuted }]}>
            <ThemedText type="title" style={{ color: warningColor }}>{remittanceSummary.needsSubmission}</ThemedText>
            <ThemedText type="overline" style={{ color: mutedColor }}>To Submit</ThemedText>
          </View>
          <View style={[styles.metricItem, { backgroundColor: surfaceMuted }]}>
            <ThemedText type="title" style={{ color: mutedColor }}>{remittanceSummary.pending}</ThemedText>
            <ThemedText type="overline" style={{ color: mutedColor }}>Pending</ThemedText>
          </View>
          <View style={[styles.metricItem, { backgroundColor: surfaceMuted }]}>
            <ThemedText type="title" style={{ color: successColor }}>{remittanceSummary.verified}</ThemedText>
            <ThemedText type="overline" style={{ color: mutedColor }}>Verified</ThemedText>
          </View>
          <View style={[styles.metricItem, { backgroundColor: surfaceMuted }]}>
            <ThemedText type="title" style={{ color: dangerColor }}>{remittanceSummary.flagged}</ThemedText>
            <ThemedText type="overline" style={{ color: mutedColor }}>Flagged</ThemedText>
          </View>
        </View>
      </PremiumCard>

      {tripsLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={tint} />
          <ThemedText type="caption" style={{ color: mutedColor }}>Loading shifts...</ThemedText>
        </View>
      ) : trips.length === 0 ? (
        <PremiumCard style={styles.emptyCard} muted>
          <Ionicons name="receipt-outline" size={32} color={mutedColor} />
          <ThemedText type="default" style={{ color: mutedColor, textAlign: 'center' }}>
            No completed shifts yet.{'\n'}Complete a shift to submit remittance.
          </ThemedText>
        </PremiumCard>
      ) : (
        trips.map((trip) => {
          const isNotSubmitted = trip.remittanceStatus === 'not_submitted';
          const isSubmitting = submittingTripId === trip.tripId;
          const statusColor = getStatusColor(trip.remittanceStatus);

          return (
            <PremiumCard key={trip.tripId} style={styles.remittanceCard}>
              {/* Header */}
              <View style={styles.shuttleHead}>
                <View style={styles.shuttleTitleWrap}>
                  <Ionicons name="bus" size={14} color={tint} />
                  <ThemedText type="subtitle" style={{ color: textColor }}>
                    {trip.shuttlePlate}{trip.shuttleLabel ? ` - ${trip.shuttleLabel}` : ''}
                  </ThemedText>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                  <ThemedText type="overline" style={{ color: statusColor }}>
                    {STATUS_LABEL[trip.remittanceStatus] || trip.remittanceStatus}
                  </ThemedText>
                </View>
              </View>

              {/* Trip info */}
              <View style={styles.rowLine}>
                <ThemedText type="caption" style={{ color: mutedColor }}>Shift</ThemedText>
                <ThemedText type="caption" style={{ color: textColor }}>
                  {formatDate(trip.shiftStart)} → {trip.shiftEnd ? formatDate(trip.shiftEnd) : '--'}
                </ThemedText>
              </View>
              <View style={styles.rowLine}>
                <ThemedText type="caption" style={{ color: mutedColor }}>Passengers</ThemedText>
                <ThemedText type="defaultSemiBold" style={{ color: textColor }}>{trip.passengersBoarded}</ThemedText>
              </View>
              <View style={styles.rowLine}>
                <ThemedText type="caption" style={{ color: mutedColor }}>Expected Remittance</ThemedText>
                <ThemedText type="defaultSemiBold" style={{ color: textColor }}>
                  {formatCurrency(trip.expectedRemittance)}
                </ThemedText>
              </View>

              {/* If already submitted, show outcome */}
              {!isNotSubmitted && trip.remittanceActualAmount !== null && (
                <>
                  <View style={[styles.divider, { borderColor: surfaceMuted }]} />
                  <View style={styles.rowLine}>
                    <ThemedText type="caption" style={{ color: mutedColor }}>You Remitted</ThemedText>
                    <ThemedText type="defaultSemiBold" style={{ color: textColor }}>
                      {formatCurrency(trip.remittanceActualAmount)}
                    </ThemedText>
                  </View>
                  <View style={styles.rowLine}>
                    <ThemedText type="caption" style={{ color: mutedColor }}>Variance</ThemedText>
                    <ThemedText
                      type="defaultSemiBold"
                      style={{
                        color:
                          (trip.remittanceVariance ?? 0) === 0
                            ? successColor
                            : (trip.remittanceVariance ?? 0) > 0
                              ? successColor
                              : dangerColor,
                      }}
                    >
                      {(trip.remittanceVariance ?? 0) >= 0 ? '+' : ''}
                      {formatCurrency(trip.remittanceVariance ?? 0)}
                    </ThemedText>
                  </View>
                  {trip.remittanceSubmittedAt && (
                    <View style={styles.rowLine}>
                      <ThemedText type="caption" style={{ color: mutedColor }}>Submitted</ThemedText>
                      <ThemedText type="caption" style={{ color: mutedColor }}>
                        {formatDate(trip.remittanceSubmittedAt)}
                      </ThemedText>
                    </View>
                  )}
                </>
              )}

              {/* Submit form for unsubmitted trips */}
              {isNotSubmitted && (
                <>
                  <View style={[styles.divider, { borderColor: surfaceMuted }]} />
                  <View style={styles.formGroup}>
                    <ThemedText type="caption" style={{ color: mutedColor }}>
                      Amount Collected (₱)
                    </ThemedText>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          color: textColor,
                          borderColor: surfaceMuted,
                          backgroundColor: surfaceMuted,
                        },
                      ]}
                      value={amountInputs[trip.tripId] || ''}
                      onChangeText={(text) =>
                        setAmountInputs((prev) => ({ ...prev, [trip.tripId]: text }))
                      }
                      placeholder={trip.expectedRemittance.toString()}
                      placeholderTextColor={mutedColor}
                      keyboardType="decimal-pad"
                      editable={!isSubmitting}
                    />
                  </View>
                  <View style={styles.formGroup}>
                    <ThemedText type="caption" style={{ color: mutedColor }}>
                      Note (optional)
                    </ThemedText>
                    <TextInput
                      style={[
                        styles.input,
                        styles.inputNote,
                        {
                          color: textColor,
                          borderColor: surfaceMuted,
                          backgroundColor: surfaceMuted,
                        },
                      ]}
                      value={noteInputs[trip.tripId] || ''}
                      onChangeText={(text) =>
                        setNoteInputs((prev) => ({ ...prev, [trip.tripId]: text }))
                      }
                      placeholder="e.g. one passenger had exact change..."
                      placeholderTextColor={mutedColor}
                      multiline
                      maxLength={500}
                      editable={!isSubmitting}
                    />
                  </View>
                  <PremiumButton
                    onPress={() => handleSubmitRemittance(trip)}
                    disabled={isSubmitting}
                    style={[styles.submitBtn, { backgroundColor: tint }]}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color={onTint} size="small" />
                    ) : (
                      <>
                        <Ionicons name="send" size={16} color={onTint} />
                        <ThemedText type="defaultSemiBold" style={{ color: onTint }}>
                          Submit Remittance
                        </ThemedText>
                      </>
                    )}
                  </PremiumButton>
                </>
              )}
            </PremiumCard>
          );
        })
      )}
    </>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bgColor }]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.container, { backgroundColor: bgColor }]}>
        <PremiumCard style={[styles.header, { backgroundColor: tint, borderColor: tint }]}>
          <SectionHeader
            title={isDriver ? 'Driver Ops' : 'Fleet Board'}
            titleColor={onTint}
            rightAction={
              <PremiumButton
                style={styles.refreshButton}
                onPress={() => {
                  if (activeTab === 'fleet') refreshFleet();
                  else refreshTrips();
                }}
                variant="secondary"
              >
                <Ionicons name="refresh" size={18} color={tint} />
                <ThemedText type="defaultSemiBold" style={{ color: tint }}>
                  {(activeTab === 'fleet' ? loading : tripsLoading) ? 'Refreshing' : 'Refresh'}
                </ThemedText>
              </PremiumButton>
            }
          />
        </PremiumCard>

        {/* Tab switcher for drivers */}
        {isDriver && (
          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === 'remittance' && [styles.tabButtonActive, { borderColor: tint }],
              ]}
              onPress={() => setActiveTab('remittance')}
            >
              <Ionicons
                name="receipt-outline"
                size={16}
                color={activeTab === 'remittance' ? tint : mutedColor}
              />
              <ThemedText
                type="defaultSemiBold"
                style={{ color: activeTab === 'remittance' ? tint : mutedColor }}
              >
                Remittance
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === 'fleet' && [styles.tabButtonActive, { borderColor: tint }],
              ]}
              onPress={() => setActiveTab('fleet')}
            >
              <Ionicons
                name="bus-outline"
                size={16}
                color={activeTab === 'fleet' ? tint : mutedColor}
              />
              <ThemedText
                type="defaultSemiBold"
                style={{ color: activeTab === 'fleet' ? tint : mutedColor }}
              >
                Fleet
              </ThemedText>
            </TouchableOpacity>
          </View>
        )}

        {feedback && activeTab === 'fleet' ? (
          <ThemedText
            style={[
              styles.error,
              {
                color: feedback.type === 'critical' ? dangerColor : successColor,
              },
            ]}
          >
            {feedback.message}
          </ThemedText>
        ) : null}

        {activeTab === 'fleet' ? renderFleetTab() : renderRemittanceTab()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    padding: DesignTokens.spacing.md,
    gap: DesignTokens.spacing.sm,
  },
  header: {
  },
  summaryCard: {
    gap: DesignTokens.spacing.sm,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: DesignTokens.spacing.xs,
  },
  metricItem: {
    flex: 1,
    borderRadius: DesignTokens.radius.md,
    paddingVertical: DesignTokens.spacing.xs,
    alignItems: 'center',
  },
  refreshButton: {
    minHeight: 40,
    paddingVertical: DesignTokens.spacing.xxs,
    paddingHorizontal: DesignTokens.spacing.xs,
  },
  error: {
    fontFamily: OutfitFonts.semiBold,
  },
  shuttleCard: {
    gap: DesignTokens.spacing.xs,
  },
  shuttleHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  shuttleTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
    flexShrink: 1,
  },
  rowLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Tab switcher
  tabRow: {
    flexDirection: 'row',
    gap: DesignTokens.spacing.xs,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: DesignTokens.spacing.sm,
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tabButtonActive: {
    borderWidth: 1.5,
  },

  // Remittance
  remittanceCard: {
    gap: DesignTokens.spacing.xs,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: DesignTokens.radius.pill,
  },
  divider: {
    borderTopWidth: 1,
    marginVertical: DesignTokens.spacing.xxs,
  },
  formGroup: {
    gap: 4,
  },
  input: {
    fontFamily: OutfitFonts.medium,
    fontSize: 15,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1,
  },
  inputNote: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  submitBtn: {
    marginTop: DesignTokens.spacing.xxs,
  },
  loadingWrap: {
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
    paddingVertical: DesignTokens.spacing.xl,
  },
  emptyCard: {
    alignItems: 'center',
    gap: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xl,
  },
});
