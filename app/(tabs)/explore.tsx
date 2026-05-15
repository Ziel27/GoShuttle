import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { PremiumButton } from '@/components/ui/premium-button';
import { PremiumCard } from '@/components/ui/premium-card';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonList } from '@/components/ui/skeleton-loader';
import { getCapacityColor } from '@/constants/app-ui';
import { DesignTokens, OutfitFonts, SemanticColors } from '@/constants/theme';
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
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    ScrollView,
    StyleSheet,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const capacityColor = getCapacityColor;

type OpsTab = 'fleet' | 'remittance';

const STATUS_LABEL: Record<string, string> = {
  not_submitted: 'Not Submitted',
  overdue: 'Overdue!',
  escalated: 'Escalated 🚨',
  pending: 'Pending Review',
  verified: 'Verified ✓',
  flagged: 'Flagged ⚠',
};

const STATUS_COLOR_KEY: Record<string, 'warning' | 'success' | 'danger' | 'textMuted'> = {
  not_submitted: 'warning',
  overdue: 'danger',
  escalated: 'danger',
  pending: 'textMuted',
  verified: 'success',
  flagged: 'danger',
};

const STATUS_BADGE_BG: Record<string, string> = {
  not_submitted: SemanticColors.warningLight,
  overdue: SemanticColors.errorLight,
  escalated: '#fee2e2',
  pending: '#F3F4F6',
  verified: SemanticColors.successLight,
  flagged: SemanticColors.errorLight,
};

type FleetShuttleCardProps = {
  item: Shuttle;
  tint: string;
  textColor: string;
  mutedColor: string;
  successColor: string;
  getDisplayedShuttleStatus: (shuttle: Shuttle) => string;
  getDriverShiftStatus: (driverId: Shuttle['driverId']) => string;
};

type RemittanceTripCardProps = {
  trip: DriverCompletedTrip;
  amountValue: string;
  noteValue: string;
  receiptUri: string | null;
  isSubmitting: boolean;
  tint: string;
  onTint: string;
  textColor: string;
  mutedColor: string;
  surfaceMuted: string;
  successColor: string;
  dangerColor: string;
  statusColor: string;
  onAmountChange: (tripId: string, value: string) => void;
  onNoteChange: (tripId: string, value: string) => void;
  onPickReceipt: (tripId: string) => void;
  onSubmit: (trip: DriverCompletedTrip) => void;
};

const FleetShuttleCard = memo(function FleetShuttleCard({
  item,
  tint,
  textColor,
  mutedColor,
  successColor,
  getDisplayedShuttleStatus,
  getDriverShiftStatus,
}: FleetShuttleCardProps) {
  return (
    <PremiumCard style={styles.shuttleCard}>
      <View style={styles.shuttleHead}>
        <View style={styles.shuttleTitleWrap}>
          <Ionicons name="bus" size={16} color={tint} />
          <ThemedText type="subtitle" style={{ color: textColor }}>
            {item.plateNumber}{item.label ? ` · Electric ${item.label}` : ''}
          </ThemedText>
        </View>
        <ThemedText type="overline" style={{ color: mutedColor }}>
          {getDisplayedShuttleStatus(item)}
        </ThemedText>
      </View>

      <View style={styles.rowLine}>
        <ThemedText type="caption" style={{ color: mutedColor }}>
          Capacity
        </ThemedText>
        <ThemedText
          type="defaultSemiBold"
          style={{ color: capacityColor(item.currentCapacity, item.maxCapacity) }}>
          {item.currentCapacity}/{item.maxCapacity}
        </ThemedText>
      </View>

      <View style={styles.rowLine}>
        <ThemedText type="caption" style={{ color: mutedColor }}>
          Shift
        </ThemedText>
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
  );
});

const RemittanceTripCard = memo(function RemittanceTripCard({
  trip,
  amountValue,
  noteValue,
  receiptUri,
  isSubmitting,
  tint,
  onTint,
  textColor,
  mutedColor,
  surfaceMuted,
  successColor,
  dangerColor,
  statusColor,
  onAmountChange,
  onNoteChange,
  onPickReceipt,
  onSubmit,
}: RemittanceTripCardProps) {
  const needsSubmission = ['not_submitted', 'overdue', 'escalated'].includes(trip.remittanceStatus);

  const [timeLeft, setTimeLeft] = useState<string>('');
  
  useEffect(() => {
    if (!needsSubmission || !trip.remittanceDeadlineAt) return;
    
    // Initial evaluation
    const evaluateTimeLeft = () => {
      const now = new Date().getTime();
      const deadline = new Date(trip.remittanceDeadlineAt!).getTime();
      const diff = deadline - now;
      
      if (diff <= 0) {
         setTimeLeft('Overdue');
      } else {
         const h = Math.floor(diff / (1000 * 60 * 60));
         const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
         setTimeLeft(`Due in ${h}h ${m}m`);
      }
    };
    evaluateTimeLeft();

    const interval = setInterval(evaluateTimeLeft, 60000);
    return () => clearInterval(interval);
  }, [needsSubmission, trip.remittanceDeadlineAt]);

  const renderBanner = () => {
    if (!needsSubmission) return null;

    let bannerColor: string = SemanticColors.warningLight;
    let bannerTextColor: string = SemanticColors.warning;
    let bannerText = `Deadline: ${timeLeft}`;

    if (trip.remittanceStatus === 'escalated') {
      bannerColor = '#7f1d1d';
      bannerTextColor = '#fff';
      bannerText = '🚨 Escalated to Admin. Please submit immediately.';
    } else if (trip.remittanceStatus === 'overdue' || timeLeft === 'Overdue') {
      bannerColor = SemanticColors.errorLight;
      bannerTextColor = SemanticColors.error;
      bannerText = '🚨 Overdue! Submit immediately.';
    } else {
      // It's not_submitted
      const hMatch = timeLeft.match(/Due in (\d+)h/);
      if (hMatch && parseInt(hMatch[1]) < 12) {
        // Less than 12 hours = yellow/orange warning
        bannerColor = SemanticColors.warningLight;
        bannerTextColor = SemanticColors.warning;
      } else {
        // More than 12 hours = green
        bannerColor = SemanticColors.successLight;
        bannerTextColor = SemanticColors.success;
      }
    }

    return (
      <View style={{ backgroundColor: bannerColor, padding: 8, borderTopLeftRadius: 12, borderTopRightRadius: 12, alignItems: 'center' }}>
        <ThemedText type="caption" style={{ color: bannerTextColor, fontFamily: OutfitFonts.semiBold }}>
          {bannerText}
        </ThemedText>
      </View>
    );
  };

  return (
    <PremiumCard style={[styles.remittanceCard, { padding: 0, overflow: 'hidden' }]}>
      {renderBanner()}
      <View style={{ padding: 16 }}>
        <View style={styles.shuttleHead}>
        <View style={styles.shuttleTitleWrap}>
          <Ionicons name="bus" size={14} color={tint} />
          <ThemedText type="subtitle" style={{ color: textColor }}>
            {trip.shuttlePlate}
            {trip.shuttleLabel ? ` - ${trip.shuttleLabel}` : ''}
          </ThemedText>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_BADGE_BG[trip.remittanceStatus] || '#F3F4F6' }]}>
          <ThemedText type="overline" style={{ color: statusColor }}>
            {STATUS_LABEL[trip.remittanceStatus] || trip.remittanceStatus}
          </ThemedText>
        </View>
      </View>

      <View style={styles.rowLine}>
        <ThemedText type="caption" style={{ color: mutedColor }}>
          Shift
        </ThemedText>
        <ThemedText type="caption" style={{ color: textColor }}>
          {formatDate(trip.shiftStart)} → {trip.shiftEnd ? formatDate(trip.shiftEnd) : '--'}
        </ThemedText>
      </View>
      <View style={styles.rowLine}>
        <ThemedText type="caption" style={{ color: mutedColor }}>
          Passengers
        </ThemedText>
        <ThemedText type="defaultSemiBold" style={{ color: textColor }}>
          {trip.passengersBoarded}
        </ThemedText>
      </View>
      <View style={styles.rowLine}>
        <ThemedText type="caption" style={{ color: mutedColor }}>
          Expected Remittance
        </ThemedText>
        <ThemedText type="defaultSemiBold" style={{ color: textColor }}>
          {formatCurrency(trip.expectedRemittance)}
        </ThemedText>
      </View>

      {!needsSubmission && trip.remittanceActualAmount !== null && (
        <>
          <View style={[styles.divider, { borderColor: surfaceMuted }]} />
          <View style={styles.rowLine}>
            <ThemedText type="caption" style={{ color: mutedColor }}>
              You Remitted
            </ThemedText>
            <ThemedText type="defaultSemiBold" style={{ color: textColor }}>
              {formatCurrency(trip.remittanceActualAmount)}
            </ThemedText>
          </View>
          <View style={styles.rowLine}>
            <ThemedText type="caption" style={{ color: mutedColor }}>
              Variance
            </ThemedText>
            <ThemedText
              type="defaultSemiBold"
              style={{
                color:
                  (trip.remittanceVariance ?? 0) === 0
                    ? successColor
                    : (trip.remittanceVariance ?? 0) > 0
                      ? successColor
                      : dangerColor,
              }}>
              {(trip.remittanceVariance ?? 0) >= 0 ? '+' : ''}
              {formatCurrency(trip.remittanceVariance ?? 0)}
            </ThemedText>
          </View>
          {trip.remittanceSubmittedAt && (
            <View style={styles.rowLine}>
              <ThemedText type="caption" style={{ color: mutedColor }}>
                Submitted
              </ThemedText>
              <ThemedText type="caption" style={{ color: mutedColor }}>
                {formatDate(trip.remittanceSubmittedAt)}
              </ThemedText>
            </View>
          )}
        </>
      )}

      {needsSubmission && (
        <>
          <View style={[styles.divider, { borderColor: surfaceMuted }]} />
          <View style={styles.formGroup}>
            <ThemedText type="caption" style={{ color: mutedColor }}>
              Amount Collected (₱) — receipt required
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
              value={amountValue}
              onChangeText={(text) => onAmountChange(trip.tripId, text)}
              placeholder={trip.expectedRemittance.toString()}
              placeholderTextColor={mutedColor}
              keyboardType="decimal-pad"
              editable={!isSubmitting}
            />
          </View>
          <View style={styles.formGroup}>
            <ThemedText type="caption" style={{ color: mutedColor }}>
              Receipt Photo (required)
            </ThemedText>
            <View style={styles.receiptRow}>
              <Pressable
                onPress={() => onPickReceipt(trip.tripId)}
                disabled={isSubmitting}
                style={[
                  styles.receiptPickBlock,
                  {
                    borderColor: tint,
                    backgroundColor: surfaceMuted,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Attach receipt photo"
              >
                <Ionicons name="camera-outline" size={18} color={tint} />
                <ThemedText type="defaultSemiBold" style={{ color: tint }}>
                  {receiptUri ? 'Change Receipt Photo' : 'Attach Receipt Photo'}
                </ThemedText>
              </Pressable>

              {receiptUri ? (
                <View style={[styles.receiptPreviewWrap, { borderColor: surfaceMuted }]}>
                  <Image source={{ uri: receiptUri }} style={styles.receiptPreview} contentFit="cover" />
                </View>
              ) : null}
            </View>
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
              value={noteValue}
              onChangeText={(text) => onNoteChange(trip.tripId, text)}
              placeholder="e.g. one passenger had exact change..."
              placeholderTextColor={mutedColor}
              multiline
              maxLength={500}
              editable={!isSubmitting}
            />
          </View>
          <PremiumButton
            onPress={() => onSubmit(trip)}
            disabled={isSubmitting}
            style={[styles.submitBtn, { backgroundColor: tint }]}>
            {isSubmitting ? (
              <ActivityIndicator color={onTint} size="small" />
            ) : (
              <>
                <Ionicons name="send" size={16} color={onTint} />
                <ThemedText type="defaultSemiBold" style={{ color: onTint }}>
                  {receiptUri ? 'Submit Remittance' : 'Attach Receipt & Submit'}
                </ThemedText>
              </>
            )}
          </PremiumButton>
        </>
      )}
      </View>
    </PremiumCard>
  );
});

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
  const borderColor = useThemeColor({}, 'border');
  const dangerColor = useThemeColor({}, 'danger');
  const successColor = useThemeColor({}, 'success');
  const warningColor = useThemeColor({}, 'warning');
  const bgColor = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
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
  const [receiptUris, setReceiptUris] = useState<Record<string, string>>({});

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

  const getDriverShiftStatus = useCallback((driverId: Shuttle['driverId']) => {
    if (driverId && typeof driverId === 'object') {
      return driverId.status || 'offline';
    }
    return 'offline';
  }, []);

  const getDisplayedShuttleStatus = useCallback((shuttle: Shuttle) => {
    const driverShift = getDriverShiftStatus(shuttle.driverId);
    if (driverShift !== 'driving' && shuttle.status !== 'maintenance') {
      return 'idle';
    }
    return shuttle.status;
  }, [getDriverShiftStatus]);

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

    const receiptUri = receiptUris[trip.tripId];
    if (!receiptUri) {
      Alert.alert('Receipt Required', 'Please add a receipt photo proof before submitting remittance.');
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
              await submitRemittance(trip.tripId, amount, noteInputs[trip.tripId], receiptUri);
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
              setReceiptUris((prev) => {
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
  }, [amountInputs, noteInputs, receiptUris]);

  const handlePickReceipt = useCallback((tripId: string) => {
    const pickFromLibrary = async () => {
      const library = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (library.status !== 'granted') {
        Alert.alert('Permission Required', 'Photo library permission is required to attach a receipt.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        // Some Android gallery/crop UIs hide confirm controls when editing is enabled.
        // Skipping the edit step keeps the pick flow consistent across devices.
        allowsEditing: false,
        quality: 0.7,
      });

      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;
      setReceiptUris((prev) => ({ ...prev, [tripId]: uri }));
    };

    const pickFromCamera = async () => {
      const camera = await ImagePicker.requestCameraPermissionsAsync();
      if (camera.status !== 'granted') {
        Alert.alert('Permission Required', 'Camera permission is required to take a receipt photo.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.7,
      });

      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;
      setReceiptUris((prev) => ({ ...prev, [tripId]: uri }));
    };

    Alert.alert('Attach Receipt', 'Choose how you want to add the receipt photo.', [
      { text: 'Take Photo', onPress: () => void pickFromCamera() },
      { text: 'Choose from Gallery', onPress: () => void pickFromLibrary() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, []);

  const handleAmountInputChange = useCallback((tripId: string, value: string) => {
    setAmountInputs((prev) => ({ ...prev, [tripId]: value }));
  }, []);

  const handleNoteInputChange = useCallback((tripId: string, value: string) => {
    setNoteInputs((prev) => ({ ...prev, [tripId]: value }));
  }, []);

  const handleActiveTabRefresh = useCallback(() => {
    if (activeTab === 'fleet') {
      void refreshFleet();
      return;
    }
    void refreshTrips();
  }, [activeTab, refreshFleet, refreshTrips]);

  const handleOpenRemittanceTab = useCallback(() => {
    setActiveTab('remittance');
  }, []);

  const handleOpenFleetTab = useCallback(() => {
    setActiveTab('fleet');
  }, []);

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

    const onPassengerBoarded = (payload: {
      shuttleId?: string;
      currentCapacity?: number;
      maxCapacity?: number;
    }) => {
      if (!payload.shuttleId || payload.currentCapacity === undefined) return;
      setShuttles((items) =>
        items.map((item) =>
          item._id === payload.shuttleId
            ? {
                ...item,
                currentCapacity: payload.currentCapacity!,
                ...(payload.maxCapacity !== undefined ? { maxCapacity: payload.maxCapacity } : {}),
              }
            : item
        )
      );
    };

    const onPassengerUnboarded = (payload: {
      shuttleId?: string;
      currentCapacity?: number;
      maxCapacity?: number;
    }) => {
      if (!payload.shuttleId || payload.currentCapacity === undefined) return;
      setShuttles((items) =>
        items.map((item) =>
          item._id === payload.shuttleId
            ? {
                ...item,
                currentCapacity: payload.currentCapacity!,
                ...(payload.maxCapacity !== undefined ? { maxCapacity: payload.maxCapacity } : {}),
              }
            : item
        )
      );
    };

    socket.on('shuttle:location-updated', onLocationUpdated);
    socket.on('shuttle:capacity-updated', onCapacityUpdated);
    socket.on('trip:passenger-boarded', onPassengerBoarded);
    socket.on('trip:passenger-auto-unboarded', onPassengerUnboarded);
    socket.on('trip:passenger-unboarded', onPassengerUnboarded);

    return () => {
      socket.off('shuttle:location-updated', onLocationUpdated);
      socket.off('shuttle:capacity-updated', onCapacityUpdated);
      socket.off('trip:passenger-boarded', onPassengerBoarded);
      socket.off('trip:passenger-auto-unboarded', onPassengerUnboarded);
      socket.off('trip:passenger-unboarded', onPassengerUnboarded);
    };
  }, [refreshFleet, refreshTrips, token, user?.communityId, isDriver]);

  const getStatusColor = useCallback((status: string) => {
    const key = STATUS_COLOR_KEY[status] || 'textMuted';
    switch (key) {
      case 'success': return successColor;
      case 'danger': return dangerColor;
      case 'warning': return warningColor;
      default: return mutedColor;
    }
  }, [dangerColor, mutedColor, successColor, warningColor]);

  const renderFleetShuttleItem = useCallback(
    ({ item }: { item: Shuttle }) => (
      <FleetShuttleCard
        item={item}
        tint={tint}
        textColor={textColor}
        mutedColor={mutedColor}
        successColor={successColor}
        getDisplayedShuttleStatus={getDisplayedShuttleStatus}
        getDriverShiftStatus={getDriverShiftStatus}
      />
    ),
    [getDisplayedShuttleStatus, getDriverShiftStatus, mutedColor, successColor, textColor, tint]
  );

  const renderRemittanceTripItem = useCallback(
    ({ item: trip }: { item: DriverCompletedTrip }) => (
      <RemittanceTripCard
        trip={trip}
        amountValue={amountInputs[trip.tripId] || ''}
        noteValue={noteInputs[trip.tripId] || ''}
        receiptUri={receiptUris[trip.tripId] || null}
        isSubmitting={submittingTripId === trip.tripId}
        tint={tint}
        onTint={onTint}
        textColor={textColor}
        mutedColor={mutedColor}
        surfaceMuted={surfaceMuted}
        successColor={successColor}
        dangerColor={dangerColor}
        statusColor={getStatusColor(trip.remittanceStatus)}
        onAmountChange={handleAmountInputChange}
        onNoteChange={handleNoteInputChange}
        onPickReceipt={handlePickReceipt}
        onSubmit={handleSubmitRemittance}
      />
    ),
    [
      amountInputs,
      dangerColor,
      getStatusColor,
      handleAmountInputChange,
      handleNoteInputChange,
      handlePickReceipt,
      handleSubmitRemittance,
      mutedColor,
      noteInputs,
      onTint,
      receiptUris,
      submittingTripId,
      successColor,
      surfaceMuted,
      textColor,
      tint,
    ]
  );

  const renderFleetTab = () => (
    <>
      <View style={[styles.summaryCard, { borderColor, backgroundColor: surfaceMuted }]}>
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
      </View>

      {loading ? (
        <SkeletonList count={3} />
      ) : shuttles.length === 0 ? (
        <EmptyState
          icon="bus-outline"
          title="No shuttles in fleet"
          subtitle="No active shuttle data is available right now."
        />
      ) : (
        <FlatList
          data={shuttles}
          keyExtractor={(item) => item._id}
          renderItem={renderFleetShuttleItem}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.listItemSpacer} />}
        />
      )}

      {!loading && shuttles.length > 0 ? (
        <View style={[styles.fleetAmbientPanel, { borderColor, backgroundColor: surfaceMuted }]}> 
          <View style={styles.fleetAmbientHeader}>
            <Ionicons name="pulse-outline" size={14} color={tint} />
            <ThemedText type="defaultSemiBold" style={{ color: textColor }}>Live Fleet Pulse</ThemedText>
          </View>
          <ThemedText type="caption" style={{ color: mutedColor }}>
            Tracking {shuttles.length} shuttle{shuttles.length > 1 ? 's' : ''} across your community. Updates stream automatically while this screen is open.
          </ThemedText>
        </View>
      ) : null}
    </>
  );

  const renderRemittanceTab = () => (
    <>
      {/* Summary */}
      <View style={[styles.summaryCard, { borderColor, backgroundColor: surfaceMuted }]}>
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
      </View>

      {tripsLoading ? (
        <SkeletonList count={3} />
      ) : trips.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No completed shifts"
          subtitle={"Complete a shift to submit remittance."}
        />
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(item) => item.tripId}
          renderItem={renderRemittanceTripItem}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.listItemSpacer} />}
        />
      )}
    </>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bgColor }]} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.container, { backgroundColor: bgColor }]}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        <View style={[styles.header, { borderBottomColor: borderColor }]}>
          <SectionHeader
            title={isDriver ? 'Driver Ops' : 'Fleet Board'}
            titleColor={textColor}
            rightAction={
              <PremiumButton
                style={styles.refreshButton}
                onPress={handleActiveTabRefresh}
                variant="secondary"
              >
                <Ionicons name="refresh" size={18} color={tint} />
                <ThemedText type="defaultSemiBold" style={{ color: tint }}>
                  {(activeTab === 'fleet' ? loading : tripsLoading) ? 'Refreshing' : 'Refresh'}
                </ThemedText>
              </PremiumButton>
            }
          />
        </View>

        {/* Tab switcher for drivers */}
        {isDriver && (
          <View style={[styles.tabRow, { backgroundColor: surface, borderColor }]}> 
            <Pressable
              style={[
                styles.tabButton,
                { backgroundColor: surface },
                activeTab === 'remittance' && [styles.tabButtonActive, { borderColor: tint, backgroundColor: surfaceMuted }],
              ]}
              onPress={handleOpenRemittanceTab}
              accessibilityRole="button"
              accessibilityState={{ selected: activeTab === 'remittance' }}
              accessibilityLabel="Remittance tab"
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
            </Pressable>
            <Pressable
              style={[
                styles.tabButton,
                { backgroundColor: surface },
                activeTab === 'fleet' && [styles.tabButtonActive, { borderColor: tint, backgroundColor: surfaceMuted }],
              ]}
              onPress={handleOpenFleetTab}
              accessibilityRole="button"
              accessibilityState={{ selected: activeTab === 'fleet' }}
              accessibilityLabel="Fleet tab"
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
            </Pressable>
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
    flexGrow: 1,
  },
  header: {
    minHeight: 48,
    paddingBottom: DesignTokens.spacing.xs,
    justifyContent: 'center',
    borderBottomWidth: 1,
  },
  summaryCard: {
    gap: DesignTokens.spacing.sm,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.sm,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: DesignTokens.spacing.xs,
  },
  metricItem: {
    flex: 1,
    borderRadius: DesignTokens.radius.md,
    minHeight: 62,
    paddingVertical: DesignTokens.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButton: {
    minHeight: 32,
    paddingVertical: DesignTokens.spacing.xxs,
    paddingHorizontal: DesignTokens.spacing.xs,
    alignSelf: 'center',
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
    gap: DesignTokens.spacing.xxs,
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
    borderWidth: 1,
    borderRadius: DesignTokens.radius.pill,
    padding: DesignTokens.spacing.xxs,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: DesignTokens.spacing.xs,
    minHeight: 46,
    paddingVertical: DesignTokens.spacing.sm,
    borderRadius: DesignTokens.radius.pill,
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
    paddingHorizontal: DesignTokens.spacing.xs,
    paddingVertical: DesignTokens.spacing.xxs,
    borderRadius: DesignTokens.radius.pill,
  },
  divider: {
    borderTopWidth: 1,
    marginVertical: DesignTokens.spacing.xxs,
  },
  formGroup: {
    gap: DesignTokens.spacing.xxs,
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
  receiptRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: DesignTokens.spacing.sm,
  },
  receiptPickBlock: {
    minHeight: 46,
    borderWidth: 1.5,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: DesignTokens.spacing.xs,
  },
  receiptPreviewWrap: {
    width: 120,
    height: 120,
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  receiptPreview: {
    width: '100%',
    height: '100%',
  },
  submitBtn: {
    marginTop: DesignTokens.spacing.xxs,
  },
  listItemSpacer: {
    height: DesignTokens.spacing.sm,
  },
  fleetAmbientPanel: {
    marginTop: DesignTokens.spacing.xs,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.xxs,
    minHeight: 76,
    justifyContent: 'center',
  },
  fleetAmbientHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xxs,
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
