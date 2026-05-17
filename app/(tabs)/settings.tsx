import { HowToBookModal } from '@/components/HowToBookModal';
import { ThemedText } from '@/components/themed-text';
import { PremiumButton } from '@/components/ui/premium-button';
import { AppPalette } from '@/constants/app-ui';
import { ROUTES } from '@/constants/routes';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { getCommunityById, getPhaseGeofences, type PhaseGeofence } from '@/services/community';
import {
    isPushNotificationsAvailableInRuntime,
    registerForPushNotifications,
    savePushToken,
} from '@/services/notifications';
import { listShuttles } from '@/services/shuttle';
import { cancelMyPickupIntents, endShift, resolveRideRequest, startShift, stopShift } from '@/services/trip';
import { submitSupportMessage } from '@/services/support';

import { getMyDiscountVerification, submitDiscountVerification, type DiscountType, type DiscountVerification } from '@/services/user';
import { setHomeDestinationFromGps } from '@/services/user';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { memo, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type AppearanceOption = {
  key: 'system' | 'light' | 'dark';
  label: string;
};

type ThemeOptionChipProps = {
  item: AppearanceOption;
  appearance: AppearanceOption['key'];
  borderColor: string;
  mutedColor: string;
  surface: string;
  surfaceMuted: string;
  tint: string;
  onPress: (key: AppearanceOption['key']) => void;
};

const APPEARANCE_OPTIONS: readonly AppearanceOption[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

const ThemeOptionChip = memo(function ThemeOptionChip({
  item,
  appearance,
  borderColor,
  mutedColor,
  surface,
  surfaceMuted,
  tint,
  onPress,
}: ThemeOptionChipProps) {
  const isSelected = appearance === item.key;

  return (
    <Pressable
      onPress={() => onPress(item.key)}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${item.label} theme`}
      style={[
        styles.appearanceChip,
        {
          borderColor: isSelected ? tint : borderColor,
          backgroundColor: isSelected ? surfaceMuted : surface,
        },
      ]}>
      <ThemedText type="defaultSemiBold" style={{ color: isSelected ? tint : mutedColor, fontSize: 12 }}>
        {item.label}
      </ThemedText>
    </Pressable>
  );
});

type DiscountVerificationSectionProps = {
  tint: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  surface: string;
  surfaceMuted: string;
  bgColor: string;
  successColor: string;
  dangerColor: string;
};

const DISCOUNT_TYPES: { key: DiscountType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'student', label: 'Student', icon: 'school-outline' },
  { key: 'pwd', label: 'PWD', icon: 'accessibility-outline' },
  { key: 'senior', label: 'Senior Citizen', icon: 'person-outline' },
];

const DiscountVerificationSection = memo(function DiscountVerificationSection({
  tint,
  textColor,
  mutedColor,
  borderColor,
  surface,
  surfaceMuted,
  bgColor,
  successColor,
  dangerColor,
}: DiscountVerificationSectionProps) {
  const [verification, setVerification] = useState<DiscountVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [selectedType, setSelectedType] = useState<DiscountType | null>(null);
  const [pickedImageUri, setPickedImageUri] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getMyDiscountVerification()
      .then((v) => { if (mounted) { setVerification(v); setLoading(false); } })
      .catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setFeedback('Photo library permission is required to upload your ID.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setPickedImageUri(result.assets[0].uri);
      setFeedback('');
    }
  };

  const handleSubmit = async () => {
    if (!selectedType) {
      setFeedback('Please select a discount type.');
      return;
    }
    if (!pickedImageUri) {
      setFeedback('Please upload a photo of your valid ID.');
      return;
    }
    setSubmitting(true);
    setFeedback('');
    try {
      const updated = await submitDiscountVerification(selectedType, pickedImageUri);
      setVerification(updated);
      setPickedImageUri(null);
      setSelectedType(null);
      setFeedback('Application submitted. You will be notified once reviewed.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to submit. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const statusColor = (status: DiscountVerification['status']) => {
    if (status === 'approved') return successColor;
    if (status === 'rejected') return dangerColor;
    return tint;
  };

  const statusLabel = (status: DiscountVerification['status']) => {
    if (status === 'approved') return 'Approved';
    if (status === 'rejected') return 'Rejected';
    if (status === 'pending') return 'Under Review';
    return 'Not Submitted';
  };

  if (loading) {
    return (
      <View style={[{ borderColor, backgroundColor: surface }, styles.sectionBlock]}>
        <ActivityIndicator size="small" color={tint} />
      </View>
    );
  }

  return (
    <View style={[styles.sectionBlock, { borderColor, backgroundColor: surface }]}>
      <ThemedText type="subtitle" style={{ color: textColor }}>Discount ID Verification</ThemedText>
      <ThemedText type="caption" style={{ color: mutedColor }}>
        Submit a valid government-issued ID to qualify for student, PWD, or senior discounts on every ride.
      </ThemedText>

      {verification && verification.status !== 'none' ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          <View style={[{ borderColor: statusColor(verification.status), backgroundColor: bgColor }, styles.discountStatusBadge]}>
            <Ionicons
              name={verification.status === 'approved' ? 'checkmark-circle' : verification.status === 'rejected' ? 'close-circle' : 'time-outline'}
              size={16}
              color={statusColor(verification.status)}
            />
            <ThemedText type="defaultSemiBold" style={{ color: statusColor(verification.status), fontSize: 13 }}>
              {statusLabel(verification.status)}
            </ThemedText>
            {verification.discountType ? (
              <ThemedText type="caption" style={{ color: mutedColor, textTransform: 'capitalize' }}>
                · {verification.discountType}
              </ThemedText>
            ) : null}
          </View>

          {verification.status === 'rejected' ? (
            <>
              {verification.rejectionReason ? (
                <ThemedText type="caption" style={{ color: dangerColor }}>
                  Reason: {verification.rejectionReason}
                </ThemedText>
              ) : null}
              <ThemedText type="caption" style={{ color: mutedColor }}>
                You may resubmit with a clearer or different ID.
              </ThemedText>
            </>
          ) : null}

          {verification.idImageUrl ? (
            <Image
              source={{ uri: verification.idImageUrl }}
              style={styles.discountIdPreview}
              resizeMode="cover"
            />
          ) : null}

          {verification.status === 'approved' ? (
            <ThemedText type="caption" style={{ color: successColor }}>
              Your discount is active. It will be applied automatically at booking when available.
            </ThemedText>
          ) : null}

          {verification.status === 'pending' ? (
            <ThemedText type="caption" style={{ color: mutedColor }}>
              Your submission is pending review by your community admin.
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      {(!verification || verification.status === 'none' || verification.status === 'rejected') ? (
        <View style={{ gap: 12, marginTop: 12 }}>
          <ThemedText type="caption" style={{ color: mutedColor }}>Select discount type:</ThemedText>
          <View style={styles.discountTypeRow}>
            {DISCOUNT_TYPES.map(({ key, label, icon }) => (
              <Pressable
                key={key}
                onPress={() => setSelectedType(key)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.discountTypeChip,
                  {
                    borderColor: selectedType === key ? tint : borderColor,
                    backgroundColor: selectedType === key ? surfaceMuted : bgColor,
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons name={icon} size={14} color={selectedType === key ? tint : mutedColor} />
                <ThemedText type="defaultSemiBold" style={{ color: selectedType === key ? tint : mutedColor, fontSize: 12 }}>
                  {label}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={() => void handlePickImage()}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.discountUploadBtn,
              { borderColor: pickedImageUri ? successColor : borderColor, backgroundColor: bgColor },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name={pickedImageUri ? 'image' : 'cloud-upload-outline'} size={18} color={pickedImageUri ? successColor : tint} />
            <ThemedText type="defaultSemiBold" style={{ color: pickedImageUri ? successColor : tint, fontSize: 13 }}>
              {pickedImageUri ? 'ID Photo Selected ✓' : 'Upload ID Photo'}
            </ThemedText>
          </Pressable>

          {pickedImageUri ? (
            <Image source={{ uri: pickedImageUri }} style={styles.discountIdPreview} resizeMode="cover" />
          ) : null}

          {feedback ? (
            <ThemedText type="caption" style={{ color: feedback.includes('submitted') ? successColor : dangerColor }}>
              {feedback}
            </ThemedText>
          ) : null}

          <Pressable
            onPress={() => void handleSubmit()}
            disabled={submitting}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.discountSubmitBtn,
              { borderColor: tint, backgroundColor: tint },
              (pressed || submitting) && { opacity: 0.7 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <ThemedText type="defaultSemiBold" style={{ color: '#fff', fontSize: 14 }}>
                Submit for Verification
              </ThemedText>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

export default function SettingsTabScreen() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const isDriver = user?.role === 'driver';
  const isPassenger = user?.role === 'passenger';
  const pushAlerts = usePreferencesStore((state) => state.pushAlerts);
  const serviceUpdates = usePreferencesStore((state) => state.serviceUpdates);
  const quietMode = usePreferencesStore((state) => state.quietMode);
  const showEta = usePreferencesStore((state) => state.showEta);
  const hapticsEnabled = usePreferencesStore((state) => state.hapticsEnabled);
  const compactMapPins = usePreferencesStore((state) => state.compactMapPins);
  const precisePickup = usePreferencesStore((state) => state.precisePickup);
  const appearance = usePreferencesStore((state) => state.themeMode);

  const setPushAlerts = usePreferencesStore((state) => state.setPushAlerts);
  const setServiceUpdates = usePreferencesStore((state) => state.setServiceUpdates);
  const setQuietMode = usePreferencesStore((state) => state.setQuietMode);
  const setShowEta = usePreferencesStore((state) => state.setShowEta);
  const setHapticsEnabled = usePreferencesStore((state) => state.setHapticsEnabled);
  const setCompactMapPins = usePreferencesStore((state) => state.setCompactMapPins);
  const setPrecisePickup = usePreferencesStore((state) => state.setPrecisePickup);
  const setThemeMode = usePreferencesStore((state) => state.setThemeMode);
  const [settingsFeedback, setSettingsFeedback] = useState('');
  const [communityName, setCommunityName] = useState<string | null>(null);
  const [shiftLoading, setShiftLoading] = useState(false);
  const updateUserField = useAuthStore((state) => state.updateUserField);
  const [savingHomeDestination, setSavingHomeDestination] = useState(false);
  const [homeAddressInput, setHomeAddressInput] = useState('');
  
  const [unresolvedRequests, setUnresolvedRequests] = useState<any[]>([]);
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null);
  const [logoutGuardVisible, setLogoutGuardVisible] = useState(false);
  const [logoutGuardLoading, setLogoutGuardLoading] = useState(false);
  const [passengerLogoutGuardVisible, setPassengerLogoutGuardVisible] = useState(false);
  const [passengerLogoutLoading, setPassengerLogoutLoading] = useState(false);
  const [phaseGeofences, setPhaseGeofences] = useState<PhaseGeofence[]>([]);
  const [opsBypassMode, setOpsBypassMode] = useState(false);
  const [showHowToBookModal, setShowHowToBookModal] = useState(false);
  const [supportModalVisible, setSupportModalVisible] = useState(false);
  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSuccess, setSupportSuccess] = useState(false);
  const [supportError, setSupportError] = useState('');

  useEffect(() => {
    if (!user?.communityId) return;
    let isMounted = true;
    const loadCommunity = async () => {
      try {
        const community = await getCommunityById(user.communityId);
        if (isMounted) {
          setCommunityName(community?.name ?? null);
          setOpsBypassMode(Boolean(community?.opsBypassMode));
        }
      } catch (error) {
        if (isMounted) {
          console.error('Failed to load community:', error);
        }
      }
    };
    loadCommunity();
    return () => {
      isMounted = false;
    };
  }, [user?.communityId]);

  useEffect(() => {
    if (!user?.communityId) return;
    const loadPhaseGeofences = async () => {
      try {
        const phases = await getPhaseGeofences(user.communityId);
        setPhaseGeofences(phases);
      } catch (error) {
        console.warn('Failed to load phase geofences:', error);
      }
    };
    loadPhaseGeofences();
  }, [user?.communityId]);



  useEffect(() => {
    if (!isPassenger) return;
    setHomeAddressInput(user?.homeDestination?.label || '');
  }, [isPassenger, user?.homeDestination?.label]);

  const handleSupportSubmit = useCallback(async () => {
    if (!supportSubject.trim()) {
      setSupportError('Please enter a subject.');
      return;
    }
    if (!supportMessage.trim() || supportMessage.trim().length < 10) {
      setSupportError('Please describe your concern in more detail.');
      return;
    }
    setSupportError('');
    setSupportLoading(true);
    try {
      await submitSupportMessage(supportSubject.trim(), supportMessage.trim());
      setSupportSuccess(true);
      setSupportSubject('');
      setSupportMessage('');
    } catch (err: any) {
      setSupportError(err?.message || 'Failed to send. Please try again.');
    } finally {
      setSupportLoading(false);
    }
  }, [supportSubject, supportMessage]);

  const openSupportModal = useCallback(() => {
    setSupportSuccess(false);
    setSupportError('');
    setSupportModalVisible(true);
  }, []);

  const closeSupportModal = useCallback(() => {
    if (supportLoading) return;
    setSupportModalVisible(false);
    setSupportSuccess(false);
    setSupportError('');
    setSupportSubject('');
    setSupportMessage('');
  }, [supportLoading]);

  const resolveAssignedShuttleId = useCallback(async () => {
    if (!user?._id) return null;

    const shuttles = await listShuttles();
    const assigned = shuttles.find((item) => {
      if (typeof item.driverId === 'string') {
        return item.driverId === user._id;
      }

      return item.driverId?._id === user._id;
    });

    return assigned?._id || null;
  }, [user?._id]);

  const handleShiftToggle = useCallback(async () => {
    setShiftLoading(true);
    try {
      const newStatus = user?.status === 'driving' ? 'offline' : 'driving';
      if (newStatus === 'driving') {
        await startShift();
        updateUserField('status', newStatus);
        setSettingsFeedback('Shift started!');
      } else {
        let endingMessage = 'Shift ended!';
        const assignedShuttleId = await resolveAssignedShuttleId();

        if (assignedShuttleId) {
          try {
            const summary = await endShift(assignedShuttleId);
            if (summary?.passengersBoarded > 0) {
              const revenue = Number(summary.revenueCollected || 0).toFixed(2);
              endingMessage = `Shift ended. ${summary.passengersBoarded} passenger${summary.passengersBoarded > 1 ? 's' : ''} boarded (P${revenue}).`;
            } else {
              endingMessage = 'Shift ended. No passengers boarded this shift.';
            }
          } catch (error) {
            const status = (error as any).status;
            const responseData = (error as any).responseData;
            
            if (status === 409 && Array.isArray(responseData?.unresolvedRequests)) {
              setUnresolvedRequests(responseData.unresolvedRequests);
              setSettingsFeedback('Please resolve all pending ride requests before ending your shift.');
              setShiftLoading(false);
              return; // Halt shift end flow
            }

            const message = error instanceof Error ? error.message.toLowerCase() : '';
            const noActiveTrip = message.includes('no active trip found for this shuttle');

            if (!noActiveTrip) {
              throw error;
            }

            endingMessage = 'Shift ended. No active trip to close.';
          }
        } else {
          endingMessage = 'Shift ended. No assigned shuttle found to close a trip.';
        }

        await stopShift();
        updateUserField('status', newStatus);
        setSettingsFeedback(endingMessage);
      }
    } catch (error) {
      setSettingsFeedback(error instanceof Error ? error.message : 'Failed to update shift');
    } finally {
      setShiftLoading(false);
    }
  }, [resolveAssignedShuttleId, updateUserField, user?.status]);

  const endDriverShiftIfActive = useCallback(async (): Promise<boolean> => {
    if (!isDriver || user?.status !== 'driving') return true;

    const assignedShuttleId = await resolveAssignedShuttleId();
    if (!assignedShuttleId) {
      setSettingsFeedback('Cannot end shift yet: no assigned shuttle found.');
      return false;
    }

    try {
      let endingMessage = 'Shift ended!';
      try {
        const summary = await endShift(assignedShuttleId);
        if (summary?.passengersBoarded > 0) {
          const revenue = Number(summary.revenueCollected || 0).toFixed(2);
          endingMessage = `Shift ended. ${summary.passengersBoarded} passenger${summary.passengersBoarded > 1 ? 's' : ''} boarded (P${revenue}).`;
        } else {
          endingMessage = 'Shift ended. No passengers boarded this shift.';
        }
      } catch (error) {
        const status = (error as any).status;
        const responseData = (error as any).responseData;

        if (status === 409 && Array.isArray(responseData?.unresolvedRequests)) {
          setUnresolvedRequests(responseData.unresolvedRequests);
          setSettingsFeedback('Please resolve all pending ride requests before ending your shift.');
          return false;
        }

        const message = error instanceof Error ? error.message.toLowerCase() : '';
        const noActiveTrip = message.includes('no active trip found for this shuttle');

        if (!noActiveTrip) {
          throw error;
        }

        endingMessage = 'Shift ended. No active trip to close.';
      }

      await stopShift();
      updateUserField('status', 'offline');
      setSettingsFeedback(endingMessage);
      return true;
    } catch (error) {
      setSettingsFeedback(error instanceof Error ? error.message : 'Failed to end shift');
      return false;
    }
  }, [isDriver, resolveAssignedShuttleId, updateUserField, user?.status]);

  const handleResolveRequest = async (requestId: string, resolution: 'no_show' | 'late_manual') => {
    setResolvingRequestId(requestId);
    try {
      await resolveRideRequest(requestId, resolution);
      setUnresolvedRequests((prev) => prev.filter(req => req.requestId !== requestId));
      
      if (unresolvedRequests.length <= 1) {
        setSettingsFeedback('All requests resolved. You can now end your shift.');
      }
    } catch (error) {
      setSettingsFeedback(error instanceof Error ? error.message : 'Failed to resolve request');
    } finally {
      setResolvingRequestId(null);
    }
  };

  const handleChangePassword = async () => {
    const normalizedEmail = user?.email?.trim();
    if (!normalizedEmail) {
      setSettingsFeedback('No account email is available for this profile.');
      return;
    }

    try {
      router.push(ROUTES.changePassword);
    } catch {
      setSettingsFeedback('Unable to open password reset flow. Please try again.');
    }
  };

  const handleLogout = async () => {
    // Driver guard: must end shift first
    if (isDriver && user?.status === 'driving' && !opsBypassMode) {
      setLogoutGuardVisible(true);
      return;
    }
    // NOTE (testing): passenger requests intentionally survive logout — no guard or cancellation.
    await logout();
    router.replace(ROUTES.authLogin);
  };



  const handleSetHomeFromGps = async () => {
    if (!isPassenger || savingHomeDestination) return;

    const normalizedAddress = homeAddressInput.trim();
    if (!normalizedAddress) {
      setSettingsFeedback('Enter your home address first before saving GPS.');
      return;
    }

    setSavingHomeDestination(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setSettingsFeedback('Location permission is required to save Home destination.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const updatedUser = await setHomeDestinationFromGps(
        position.coords.latitude,
        position.coords.longitude,
        normalizedAddress
      );

      if (updatedUser?.homeDestination) {
        updateUserField('homeDestination', updatedUser.homeDestination);
      }

      setSettingsFeedback('Home address and GPS location saved. Drivers will now see this address as your destination.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save Home destination.';
      setSettingsFeedback(message);
    } finally {
      setSavingHomeDestination(false);
    }
  };

  const textColor = useThemeColor({}, 'text');
  const mutedColor = useThemeColor({}, 'textMuted');
  const bgColor = useThemeColor({}, 'background');
  const borderColor = useThemeColor({}, 'border');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const surface = useThemeColor({}, 'surface');
  const tint = useThemeColor({}, 'tint');
  const successColor = useThemeColor({}, 'success');
  const dangerColor = useThemeColor({}, 'danger');
  const toggleTrackOn = '#6EE7B7';
  const toggleThumbOn = '#34D399';

  const handleThemeOptionPress = useCallback((themeMode: AppearanceOption['key']) => {
    setThemeMode(themeMode);
  }, [setThemeMode]);

  const handlePushAlertsToggle = useCallback(async (enabled: boolean) => {
    try {
      await setPushAlerts(enabled);

      if (!enabled) {
        setSettingsFeedback('Ride alerts muted. You can re-enable anytime.');
        return;
      }

      const token = await registerForPushNotifications();
      if (token) {
        await savePushToken(token);
        setSettingsFeedback('Ride alerts enabled and notification permission granted.');
        return;
      }

      if (!isPushNotificationsAvailableInRuntime()) {
        setSettingsFeedback('Push notifications need a development build. Expo Go supports in-app alerts only.');
        return;
      }

      setSettingsFeedback('Ride alerts enabled in-app. Enable OS notification permission for push delivery.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update ride alert settings right now.';
      setSettingsFeedback(message);
    }
  }, [setPushAlerts]);

  const settingRow = (
    icon: keyof typeof Ionicons.glyphMap,
    title: string,
    subtitle: string,
    value: boolean,
    onChange: (value: boolean) => void
  ) => (
    <View style={[styles.controlRow, { borderColor }]}> 
      <View style={styles.controlCopy}>
        <View style={styles.controlTitleRow}>
          <Ionicons name={icon} size={15} color={tint} />
          <ThemedText type="defaultSemiBold" style={{ color: textColor, fontSize: 13 }}>{title}</ThemedText>
        </View>
        <ThemedText type="caption" style={{ color: mutedColor, fontSize: 11, lineHeight: 15 }}>{subtitle}</ThemedText>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: toggleTrackOn, false: AppPalette.switchTrackOff }}
        thumbColor={value ? toggleThumbOn : undefined}
        accessibilityLabel={title}
        accessibilityRole="switch"
      />
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bgColor }]} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.root, { backgroundColor: bgColor }]}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      > 
        <ThemedText type="overline" style={[styles.sectionLabel, styles.sectionLabelFirst, { color: mutedColor }]}>ACCOUNT</ThemedText>
        <View style={[styles.sectionBlock, { borderColor, backgroundColor: surface }]}>
        <View style={styles.row}>
          <ThemedText type="defaultSemiBold" style={{ color: mutedColor }}>Name</ThemedText>
          <ThemedText type="defaultSemiBold" style={{ color: textColor, flexShrink: 1, textAlign: 'right' }}>
            {user?.firstName} {user?.lastName}
          </ThemedText>
        </View>

        <View style={[styles.separator, { backgroundColor: borderColor }]} />

        <View style={styles.row}>
          <ThemedText type="defaultSemiBold" style={{ color: mutedColor }}>Email</ThemedText>
          <ThemedText type="defaultSemiBold" style={{ color: textColor, flexShrink: 1, textAlign: 'right' }}>{user?.email || '-'}</ThemedText>
        </View>

        <View style={[styles.separator, { backgroundColor: borderColor }]} />

        <View style={styles.row}>
          <ThemedText type="defaultSemiBold" style={{ color: mutedColor }}>Role</ThemedText>
          <View style={[styles.rolePill, { borderColor: tint, backgroundColor: surfaceMuted }]}> 
            <ThemedText style={[styles.roleText, { color: tint }]}>{user?.role || '-'}</ThemedText>
          </View>
        </View>

        <View style={[styles.separator, { backgroundColor: borderColor }]} />

        <View style={styles.row}>
          <ThemedText type="defaultSemiBold" style={{ color: mutedColor }}>Community</ThemedText>
          <ThemedText type="defaultSemiBold" style={{ color: textColor, flexShrink: 1, textAlign: 'right' }}>{communityName || '-'}</ThemedText>
        </View>

        <View style={[styles.separator, { backgroundColor: borderColor }]} />
        <View style={styles.accountSessionWrap}>
          <ThemedText type="overline" style={[styles.inlineSectionKicker, { color: mutedColor }]}>Session</ThemedText>
          <ThemedText type="caption" style={[styles.sessionHint, { color: mutedColor }]}>
            Reset your password with a verification code while staying signed in.
          </ThemedText>
          <View style={styles.sessionActions}>
            <PremiumButton
              style={[
                styles.sessionResetBtn,
                {
                  borderColor,
                  backgroundColor: surfaceMuted,
                },
              ]}
              variant="secondary"
              onPress={handleChangePassword}
              accessibilityLabel="Reset account password"
            >
              <Ionicons name="key-outline" size={16} color={tint} />
              <ThemedText type="defaultSemiBold" style={{ color: tint, fontSize: 14 }}>Reset Password</ThemedText>
            </PremiumButton>
            <Pressable
              onPress={handleLogout}
              style={({ pressed }) => [
                styles.sessionLogoutInline,
                { borderColor: AppPalette.danger },
                pressed && styles.sessionLogoutInlinePressed,
              ]}
              accessibilityLabel="Log out of your account"
              accessibilityRole="button"
            >
              <Ionicons name="log-out-outline" size={16} color={AppPalette.danger} />
              <ThemedText type="defaultSemiBold" style={{ color: AppPalette.danger, fontSize: 13 }}>Log out</ThemedText>
            </Pressable>
          </View>
        </View>
        </View>

        {isDriver ? (
          <>
            <ThemedText type="overline" style={[styles.sectionLabel, { color: mutedColor }]}>SHIFT</ThemedText>
            <View style={[styles.sectionBlock, { borderColor, backgroundColor: surface }]}>
              <View style={styles.shiftHeader}>
                <ThemedText type="subtitle" style={{ color: textColor }}>Driver Shift</ThemedText>
              <View style={[styles.statusBadge, { backgroundColor: user?.status === 'driving' ? AppPalette.success : AppPalette.slateBg, borderColor: user?.status === 'driving' ? AppPalette.success : AppPalette.slateBorder }]}> 
                  <ThemedText type="defaultSemiBold" style={{ color: user?.status === 'driving' ? AppPalette.white : mutedColor, fontSize: 11, textTransform: 'capitalize' }}>
                    {user?.status || 'offline'}
                  </ThemedText>
                </View>
              </View>
              <PremiumButton
                style={[styles.shiftBtn, { borderColor: user?.status === 'driving' ? AppPalette.danger : AppPalette.success, backgroundColor: user?.status === 'driving' ? AppPalette.danger : AppPalette.success }]}
                onPress={handleShiftToggle}
                disabled={shiftLoading}
              >
                <Ionicons name={user?.status === 'driving' ? 'stop-circle-outline' : 'play-circle-outline'} size={16} color={AppPalette.white} />
                <ThemedText type="defaultSemiBold" style={{ color: AppPalette.white, fontSize: 14 }}>
                  {shiftLoading ? 'Updating...' : user?.status === 'driving' ? 'End Shift' : 'Start Shift'}
                </ThemedText>
              </PremiumButton>
            </View>
          </>
        ) : null}

        <ThemedText type="overline" style={[styles.sectionLabel, { color: mutedColor }]}>NOTIFICATIONS</ThemedText>
        <View style={[styles.sectionBlock, { borderColor, backgroundColor: surfaceMuted }]}>
          <ThemedText type="subtitle" style={{ color: textColor }}>Notifications</ThemedText>
          {settingRow(
            'notifications-outline',
            isDriver ? 'Driver Action Alerts' : 'Push Alerts',
            isDriver
              ? 'Boarding, shift, and pickup action confirmations.'
              : 'Ride accepted, shuttle near, and boarding updates.',
            pushAlerts,
            handlePushAlertsToggle
          )}
          {settingRow(
            'megaphone-outline',
            'Service Updates',
            'Community advisories and route/availability notices.',
            serviceUpdates,
            setServiceUpdates
          )}
          {settingRow(
            'moon-outline',
            'Quiet Mode',
            'Silence non-critical alerts during rest hours.',
            quietMode,
            setQuietMode
          )}
        </View>

        <ThemedText type="overline" style={[styles.sectionLabel, { color: mutedColor }]}>EXPERIENCE</ThemedText>
        <View style={[styles.sectionBlock, { borderColor, backgroundColor: surface }]}>
          <ThemedText type="subtitle" style={{ color: textColor }}>
            {isDriver ? 'Driver Experience' : 'Ride Experience'}
          </ThemedText>
          {isPassenger
            ? settingRow(
                'time-outline',
                'Show ETA Prompts',
                'Display estimated shuttle arrival hints when available.',
                showEta,
                setShowEta
              )
            : null}
          {settingRow(
            'pulse-outline',
            'Haptic Feedback',
            isDriver
              ? 'Use subtle vibration for +1 boarding confirmation.'
              : 'Use subtle vibration for boarding and key actions.',
            hapticsEnabled,
            setHapticsEnabled
          )}
          {isPassenger
            ? settingRow(
                'navigate-outline',
                'Compact Map Markers',
                'Reduce pin density for a cleaner map while moving.',
                compactMapPins,
                setCompactMapPins
              )
            : null}
        </View>

        {isPassenger ? (
          <>
            <ThemedText type="overline" style={[styles.sectionLabel, { color: mutedColor }]}>PRIVACY</ThemedText>
            <View style={[styles.sectionBlock, { borderColor, backgroundColor: surfaceMuted }]}>
              <ThemedText type="subtitle" style={{ color: textColor }}>Privacy</ThemedText>
              {settingRow(
                'location-outline',
                'Precise Pickup Location',
                'Send exact pickup coordinates for faster matching.',
                precisePickup,
                setPrecisePickup
              )}
              <View style={styles.homeAddressGroup}>
                <ThemedText type="caption" style={{ color: mutedColor }}>
                  Home Address Label (shown to driver)
                </ThemedText>
                <TextInput
                  style={[
                    styles.homeAddressInput,
                    {
                      color: textColor,
                      borderColor,
                      backgroundColor: surface,
                    },
                  ]}
                  value={homeAddressInput}
                  onChangeText={setHomeAddressInput}
                  placeholder="e.g. Blk 10 Lot 5, Rose St, Sunridge"
                  placeholderTextColor={mutedColor}
                  autoCapitalize="words"
                  maxLength={120}
                />
              </View>
              <PremiumButton
                style={styles.secondaryAction}
                variant="secondary"
                onPress={handleSetHomeFromGps}
                disabled={savingHomeDestination || !homeAddressInput.trim()}
              >
                <Ionicons name="home-outline" size={16} color={tint} />
                <ThemedText type="defaultSemiBold" style={{ color: tint, fontSize: 14 }}>
                  {savingHomeDestination ? 'Saving Home...' : 'Save Home Address + GPS'}
                </ThemedText>
              </PremiumButton>
              <ThemedText type="caption" style={{ color: mutedColor }}>
                {user?.homeDestination?.location?.coordinates?.length === 2
                  ? `Saved Home: ${user.homeDestination.label}`
                  : 'No Home destination saved yet.'}
              </ThemedText>

              {/* Phase Selection */}
              {phaseGeofences.length > 0 && user?.homePhase && (
                <View style={styles.phaseSection}>
                  <ThemedText type="caption" style={{ color: mutedColor, marginBottom: 4 }}>
                    Home Phase
                  </ThemedText>
                  <View style={[styles.phaseButton, { borderColor, backgroundColor: surface, paddingVertical: 12 }]}>
                    <View style={styles.phaseButtonRow}>
                      {(() => {
                        const phase = phaseGeofences.find(p => p.name === user.homePhase);
                        if (phase) {
                          return <View style={[styles.phaseColorDot, { backgroundColor: phase.color }]} />;
                        }
                        return null;
                      })()}
                      <ThemedText style={{ color: tint, flex: 1 }}>
                        {user.homePhase.replace(/_/g, ' ')}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText type="caption" style={{ color: mutedColor }}>
                    Your phase is automatically determined by your home&apos;s GPS location.
                  </ThemedText>
                </View>
              )}
            </View>
          </>
        ) : null}

        {isPassenger ? (
          <>
            <ThemedText type="overline" style={[styles.sectionLabel, { color: mutedColor }]}>DISCOUNT VERIFICATION</ThemedText>
            <DiscountVerificationSection
              tint={tint}
              textColor={textColor}
              mutedColor={mutedColor}
              borderColor={borderColor}
              surface={surface}
              surfaceMuted={surfaceMuted}
              bgColor={bgColor}
              successColor={successColor}
              dangerColor={dangerColor}
            />
          </>
        ) : null}

        <ThemedText type="overline" style={[styles.sectionLabel, { color: mutedColor }]}>APPEARANCE</ThemedText>
        <View style={[styles.sectionBlock, { borderColor, backgroundColor: surface }]}>
          <ThemedText type="subtitle" style={{ color: textColor }}>Appearance</ThemedText>
          <View style={styles.appearanceRow}>
            {APPEARANCE_OPTIONS.map((item) => (
              <ThemeOptionChip
                key={item.key}
                item={item}
                appearance={appearance}
                borderColor={borderColor}
                mutedColor={mutedColor}
                surface={surface}
                surfaceMuted={surfaceMuted}
                tint={tint}
                onPress={handleThemeOptionPress}
              />
            ))}
          </View>
          <ThemedText type="caption" style={{ color: mutedColor }}>Theme preference is saved and applied app-wide.</ThemedText>
        </View>

        {isPassenger && (
          <>
            <ThemedText type="overline" style={[styles.sectionLabel, { color: mutedColor }]}>HELP & SUPPORT</ThemedText>
            <View style={[styles.sectionBlock, { borderColor, backgroundColor: surfaceMuted }]}>
              <ThemedText type="subtitle" style={{ color: textColor }}>Guides</ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.controlRow,
                  { borderColor },
                  pressed && { opacity: 0.7 }
                ]}
                onPress={() => setShowHowToBookModal(true)}
              >
                <View style={styles.controlCopy}>
                  <View style={styles.controlTitleRow}>
                    <Ionicons name="book-outline" size={16} color={tint} />
                    <ThemedText type="defaultSemiBold" style={{ color: textColor }}>How to Request a Shuttle</ThemedText>
                  </View>
                  <ThemedText type="caption" style={{ color: mutedColor }}>
                    View the step-by-step guide for booking your rides.
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={16} color={mutedColor} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.controlRow,
                  { borderColor },
                  pressed && { opacity: 0.7 }
                ]}
                onPress={openSupportModal}
              >
                <View style={styles.controlCopy}>
                  <View style={styles.controlTitleRow}>
                    <Ionicons name="chatbubble-ellipses-outline" size={16} color={tint} />
                    <ThemedText type="defaultSemiBold" style={{ color: textColor }}>Contact Support</ThemedText>
                  </View>
                  <ThemedText type="caption" style={{ color: mutedColor }}>
                    Send a concern or inquiry to our team.
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={16} color={mutedColor} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.controlRow,
                  { borderColor },
                  pressed && { opacity: 0.7 }
                ]}
                onPress={() => router.push(ROUTES.ticketHistory)}
              >
                <View style={styles.controlCopy}>
                  <View style={styles.controlTitleRow}>
                    <Ionicons name="time-outline" size={16} color={tint} />
                    <ThemedText type="defaultSemiBold" style={{ color: textColor }}>My Support Tickets</ThemedText>
                  </View>
                  <ThemedText type="caption" style={{ color: mutedColor }}>
                    View your past messages and their status.
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={16} color={mutedColor} />
              </Pressable>
            </View>
          </>
        )}

        {isDriver && (
          <>
            <ThemedText type="overline" style={[styles.sectionLabel, { color: mutedColor }]}>HELP & SUPPORT</ThemedText>
            <View style={[styles.sectionBlock, { borderColor, backgroundColor: surfaceMuted }]}>
              <ThemedText type="subtitle" style={{ color: textColor }}>Support</ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.controlRow,
                  { borderColor },
                  pressed && { opacity: 0.7 }
                ]}
                onPress={openSupportModal}
              >
                <View style={styles.controlCopy}>
                  <View style={styles.controlTitleRow}>
                    <Ionicons name="chatbubble-ellipses-outline" size={16} color={tint} />
                    <ThemedText type="defaultSemiBold" style={{ color: textColor }}>Contact Support</ThemedText>
                  </View>
                  <ThemedText type="caption" style={{ color: mutedColor }}>
                    Report an issue or send an inquiry to our team.
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={16} color={mutedColor} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.controlRow,
                  { borderColor },
                  pressed && { opacity: 0.7 }
                ]}
                onPress={() => router.push(ROUTES.ticketHistory)}
              >
                <View style={styles.controlCopy}>
                  <View style={styles.controlTitleRow}>
                    <Ionicons name="time-outline" size={16} color={tint} />
                    <ThemedText type="defaultSemiBold" style={{ color: textColor }}>My Support Tickets</ThemedText>
                  </View>
                  <ThemedText type="caption" style={{ color: mutedColor }}>
                    View your past messages and their status.
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={16} color={mutedColor} />
              </Pressable>
            </View>
          </>
        )}

        <Modal
          visible={unresolvedRequests.length > 0}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setUnresolvedRequests([])}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: bgColor, borderColor }]}>
              <View style={styles.modalHeader}>
                <ThemedText type="subtitle" style={{ color: textColor }}>Unresolved Requests</ThemedText>
                <Pressable onPress={() => setUnresolvedRequests([])} accessibilityRole="button" accessibilityLabel="Close settings modal">
                  <Ionicons name="close" size={24} color={mutedColor} />
                </Pressable>
              </View>
              <ThemedText type="caption" style={[{ color: mutedColor }, styles.modalDesc]}>
                You have {unresolvedRequests.length} pending request(s). Please resolve them as No Show or Late Board before ending your shift.
              </ThemedText>
              
              <ScrollView style={styles.requestsList} contentContainerStyle={styles.requestsListContent}>
                {unresolvedRequests.map((req) => (
                  <View key={req.requestId} style={[styles.requestCard, { borderColor, backgroundColor: surface }]}>
                    <View style={styles.requestItemHeader}>
                      <ThemedText type="defaultSemiBold" style={{ color: textColor }}>
                        {req.passengerName || 'Unknown Passenger'}
                      </ThemedText>
                      <ThemedText type="caption" style={{ color: mutedColor }}>
                        {new Date(req.createdAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}
                      </ThemedText>
                    </View>
                    <ThemedText type="caption" style={{ color: textColor, marginBottom: 8 }}>
                      Destination: {req.destinationLabel}
                    </ThemedText>
                    <View style={styles.requestActions}>
                      <PremiumButton
                        style={[styles.resolveBtn, { borderColor: AppPalette.danger, backgroundColor: surface }]}
                        variant="secondary"
                        onPress={() => handleResolveRequest(req.requestId, 'no_show')}
                        disabled={resolvingRequestId === req.requestId}
                      >
                        <ThemedText style={{ color: AppPalette.danger, fontSize: 13, fontFamily: OutfitFonts.semiBold }}>
                          {resolvingRequestId === req.requestId ? '...' : 'No Show'}
                        </ThemedText>
                      </PremiumButton>
                      <PremiumButton
                        style={[styles.resolveBtn, { borderColor: tint, backgroundColor: tint }]}
                        onPress={() => handleResolveRequest(req.requestId, 'late_manual')}
                        disabled={resolvingRequestId === req.requestId}
                      >
                        <ThemedText style={{ color: AppPalette.white, fontSize: 13, fontFamily: OutfitFonts.semiBold }}>
                          {resolvingRequestId === req.requestId ? '...' : 'Late Board'}
                        </ThemedText>
                      </PremiumButton>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={logoutGuardVisible}
          animationType="fade"
          transparent={true}
          onRequestClose={() => {
            if (!logoutGuardLoading) setLogoutGuardVisible(false);
          }}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: bgColor, borderColor }]}>
              <View style={styles.modalHeader}>
                <ThemedText type="subtitle" style={{ color: textColor }}>End shift before logout</ThemedText>
                <Pressable
                  onPress={() => {
                    if (!logoutGuardLoading) setLogoutGuardVisible(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Close logout dialog"
                >
                  <Ionicons name="close" size={24} color={mutedColor} />
                </Pressable>
              </View>

              <ThemedText type="caption" style={[{ color: mutedColor }, styles.modalDesc]}>
                You’re currently on shift. To keep trip and remittance records accurate, please end your shift first, then log out.
              </ThemedText>

              <View style={styles.requestActions}>
                <PremiumButton
                  style={[styles.resolveBtn, { borderColor, backgroundColor: surfaceMuted }]}
                  variant="secondary"
                  onPress={() => setLogoutGuardVisible(false)}
                  disabled={logoutGuardLoading}
                >
                  <ThemedText style={{ color: tint, fontSize: 13, fontFamily: OutfitFonts.semiBold }}>
                    Cancel
                  </ThemedText>
                </PremiumButton>

                <PremiumButton
                  style={[styles.resolveBtn, { borderColor: AppPalette.danger, backgroundColor: AppPalette.danger }]}
                  onPress={async () => {
                    if (logoutGuardLoading) return;
                    setLogoutGuardLoading(true);
                    try {
                      const ended = await endDriverShiftIfActive();
                      if (!ended) return;
                      setLogoutGuardVisible(false);
                      await logout();
                      router.replace(ROUTES.authLogin);
                    } finally {
                      setLogoutGuardLoading(false);
                    }
                  }}
                  disabled={logoutGuardLoading}
                >
                  {logoutGuardLoading ? (
                    <ActivityIndicator color={AppPalette.white} />
                  ) : (
                    <ThemedText style={{ color: AppPalette.white, fontSize: 13, fontFamily: OutfitFonts.semiBold }}>
                      End shift & log out
                    </ThemedText>
                  )}
                </PremiumButton>
              </View>
            </View>
          </View>
        </Modal>

        <HowToBookModal
          visible={showHowToBookModal}
          onClose={() => setShowHowToBookModal(false)}
          showDontShowAgain={false}
        />

        {settingsFeedback ? <ThemedText style={[styles.note, { color: mutedColor }]}>{settingsFeedback}</ThemedText> : null}
        <ThemedText type="caption" style={[styles.versionInfo, { color: mutedColor }]}>GoShuttle v1.0.0</ThemedText>
      </ScrollView>

      {/* ── Passenger Logout Guard ─────────────────────────────────────── */}
      <Modal
        visible={passengerLogoutGuardVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          if (!passengerLogoutLoading) setPassengerLogoutGuardVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: bgColor, borderColor }]}>
            <View style={styles.modalHeader}>
              <ThemedText type="subtitle" style={{ color: textColor }}>Active pickup request</ThemedText>
              <Pressable
                onPress={() => {
                  if (!passengerLogoutLoading) setPassengerLogoutGuardVisible(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Close logout dialog"
              >
                <Ionicons name="close" size={24} color={mutedColor} />
              </Pressable>
            </View>

            <ThemedText type="caption" style={[{ color: mutedColor }, styles.modalDesc]}>
              You have an active pickup request. Logging out will cancel it and free the reserved seat for another passenger.
            </ThemedText>

            <View style={styles.requestActions}>
              <PremiumButton
                style={[styles.resolveBtn, { borderColor, backgroundColor: surfaceMuted }]}
                variant="secondary"
                onPress={() => setPassengerLogoutGuardVisible(false)}
                disabled={passengerLogoutLoading}
              >
                <ThemedText style={{ color: tint, fontSize: 13, fontFamily: OutfitFonts.semiBold }}>
                  Stay
                </ThemedText>
              </PremiumButton>

              <PremiumButton
                style={[styles.resolveBtn, { borderColor: AppPalette.danger, backgroundColor: AppPalette.danger }]}
                onPress={async () => {
                  if (passengerLogoutLoading) return;
                  setPassengerLogoutLoading(true);
                  try {
                    await cancelMyPickupIntents(); // best-effort slot release
                    setPassengerLogoutGuardVisible(false);
                    await logout();
                    router.replace(ROUTES.authLogin);
                  } finally {
                    setPassengerLogoutLoading(false);
                  }
                }}
                disabled={passengerLogoutLoading}
              >
                {passengerLogoutLoading ? (
                  <ActivityIndicator color={AppPalette.white} />
                ) : (
                  <ThemedText style={{ color: AppPalette.white, fontSize: 13, fontFamily: OutfitFonts.semiBold }}>
                    Cancel request & log out
                  </ThemedText>
                )}
              </PremiumButton>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Customer Support Modal ──────────────────────────────────────── */}
      <Modal
        visible={supportModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={closeSupportModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.supportModalContent, { backgroundColor: bgColor, borderColor }]}>
            <View style={styles.modalHeader}>
              <ThemedText type="subtitle" style={{ color: textColor }}>Contact Support</ThemedText>
              <Pressable onPress={closeSupportModal} accessibilityRole="button" accessibilityLabel="Close support modal">
                <Ionicons name="close" size={24} color={mutedColor} />
              </Pressable>
            </View>

            {supportSuccess ? (
              <View style={styles.supportSuccessWrap}>
                <Ionicons name="checkmark-circle" size={52} color={tint} />
                <ThemedText type="defaultSemiBold" style={[styles.supportSuccessTitle, { color: textColor }]}>
                  Message Sent!
                </ThemedText>
                <ThemedText type="caption" style={[styles.supportSuccessDesc, { color: mutedColor }]}>
                  Your concern has been sent to our team. We will get back to you as soon as possible.
                </ThemedText>
                <PremiumButton style={[styles.supportSubmitBtn, { borderColor: tint, backgroundColor: tint }]} onPress={closeSupportModal}>
                  <ThemedText type="defaultSemiBold" style={{ color: AppPalette.white, fontSize: 14 }}>Done</ThemedText>
                </PremiumButton>
              </View>
            ) : (
              <>
                <ThemedText type="caption" style={[styles.modalDesc, { color: mutedColor }]}>
                  Describe your concern below and our support team will respond to your registered email.
                </ThemedText>

                <ThemedText type="caption" style={[styles.supportFieldLabel, { color: mutedColor }]}>Subject</ThemedText>
                <TextInput
                  style={[styles.supportInput, { borderColor, color: textColor, backgroundColor: surface }]}
                  placeholder="e.g. Issue with booking"
                  placeholderTextColor={mutedColor}
                  value={supportSubject}
                  onChangeText={(t) => { setSupportSubject(t); setSupportError(''); }}
                  maxLength={100}
                  editable={!supportLoading}
                />

                <ThemedText type="caption" style={[styles.supportFieldLabel, { color: mutedColor }]}>Message</ThemedText>
<TextInput
                   style={[styles.supportInput, styles.supportTextarea, { borderColor, color: textColor, backgroundColor: surface }]}
                   placeholder="Describe your concern in detail..."
                   placeholderTextColor={mutedColor}
                   value={supportMessage}
                   onChangeText={(t) => { setSupportMessage(t); setSupportError(''); }}
                   multiline
                   maxLength={1000}
                   editable={!supportLoading}
                   textAlignVertical="top"
                 />
                <ThemedText type="caption" style={[styles.supportCharCount, { color: mutedColor }]}>
                  {supportMessage.length}/1000
                </ThemedText>

                {supportError ? (
                  <ThemedText type="caption" style={[styles.supportError, { color: AppPalette.danger }]}>
                    {supportError}
                  </ThemedText>
                ) : null}

                <View style={styles.requestActions}>
                  <PremiumButton
                    style={[styles.resolveBtn, { borderColor, backgroundColor: surfaceMuted }]}
                    variant="secondary"
                    onPress={closeSupportModal}
                    disabled={supportLoading}
                  >
                    <ThemedText style={{ color: tint, fontSize: 13, fontFamily: OutfitFonts.semiBold }}>Cancel</ThemedText>
                  </PremiumButton>
                  <PremiumButton
                    style={[styles.resolveBtn, { borderColor: tint, backgroundColor: tint }]}
                    onPress={handleSupportSubmit}
                    disabled={supportLoading}
                  >
                    {supportLoading ? (
                      <ActivityIndicator color={AppPalette.white} />
                    ) : (
                      <ThemedText style={{ color: AppPalette.white, fontSize: 13, fontFamily: OutfitFonts.semiBold }}>Send</ThemedText>
                    )}
                  </PremiumButton>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  root: {
    padding: DesignTokens.spacing.md,
    gap: DesignTokens.spacing.xs,
  },
  sectionLabel: {
    marginTop: DesignTokens.spacing.sm,
    marginBottom: DesignTokens.spacing.xxs,
    letterSpacing: 0.45,
  },
  sectionLabelFirst: {
    marginTop: 0,
  },
  sectionBlock: {
    gap: DesignTokens.spacing.xs,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.md,
  },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: DesignTokens.spacing.xs,
  },
  separator: {
    height: 1,
  },
  controlRow: {
    minHeight: 54,
    borderBottomWidth: 1,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: DesignTokens.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: DesignTokens.spacing.xs,
  },
  controlCopy: {
    flex: 1,
    gap: 2,
  },
  controlTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xxs,
  },
  rolePill: {
    borderRadius: DesignTokens.radius.pill,
    borderWidth: 1,
    paddingHorizontal: DesignTokens.spacing.xs,
    paddingVertical: DesignTokens.spacing.xxs,
  },
  roleText: {
    fontFamily: OutfitFonts.bold,
    fontSize: 12,
    textTransform: 'capitalize',
  },
  appearanceRow: {
    flexDirection: 'row',
    gap: DesignTokens.spacing.xs,
  },
  appearanceChip: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
  },
  secondaryAction: {
    marginTop: DesignTokens.spacing.xxs,
  },
  sessionHint: {
    lineHeight: 17,
  },
  accountSessionWrap: {
    gap: DesignTokens.spacing.xs,
  },
  inlineSectionKicker: {
    letterSpacing: 0.4,
  },
  sessionActions: {
    marginTop: DesignTokens.spacing.xxs,
    gap: DesignTokens.spacing.xs,
    alignItems: 'flex-start',
  },
  sessionResetBtn: {
    minHeight: 46,
    borderRadius: DesignTokens.radius.md,
    alignSelf: 'stretch',
  },
  sessionLogoutInline: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xxs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sessionLogoutInlinePressed: {
    opacity: 0.85,
  },
  homeAddressGroup: {
    gap: DesignTokens.spacing.xxs,
  },
  homeAddressInput: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.xs,
    paddingVertical: DesignTokens.spacing.xs,
    fontFamily: OutfitFonts.semiBold,
    fontSize: 13,
  },
  shiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    marginTop: DesignTokens.spacing.xs,
  },
  shiftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: DesignTokens.spacing.xs,
    marginBottom: DesignTokens.spacing.sm,
  },
  shiftBtn: {
    marginTop: DesignTokens.spacing.xs,
  },
  note: {
    fontSize: 12,
  },
  versionInfo: {
    textAlign: 'center',
    marginTop: DesignTokens.spacing.sm,
    marginBottom: DesignTokens.spacing.lg,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: DesignTokens.radius.xl,
    borderTopRightRadius: DesignTokens.radius.xl,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    padding: DesignTokens.spacing.md,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: DesignTokens.spacing.xs,
  },
  modalDesc: {
    marginBottom: DesignTokens.spacing.md,
    lineHeight: 18,
  },
  requestsList: {
    maxHeight: 400,
  },
  requestsListContent: {
    gap: DesignTokens.spacing.sm,
    paddingBottom: DesignTokens.spacing.lg,
  },
  requestCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.sm,
  },
  requestItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  requestActions: {
    flexDirection: 'row',
    gap: DesignTokens.spacing.xs,
    marginTop: DesignTokens.spacing.xs,
  },
  resolveBtn: {
    flex: 1,
    minHeight: 36,
    paddingVertical: 0,
    borderRadius: DesignTokens.radius.sm,
  },
  phaseSection: {
    marginTop: DesignTokens.spacing.sm,
  },
  phaseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1,
  },
  phaseButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
  },
  phaseColorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  phaseDropdown: {
    marginTop: DesignTokens.spacing.xxs,
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  phaseOption: {
    paddingVertical: DesignTokens.spacing.sm,
    paddingHorizontal: DesignTokens.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  phaseOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
  },
  supportModalContent: {
    borderTopLeftRadius: DesignTokens.radius.xl,
    borderTopRightRadius: DesignTokens.radius.xl,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    padding: DesignTokens.spacing.md,
    maxHeight: '90%',
  },
  supportFieldLabel: {
    marginTop: DesignTokens.spacing.sm,
    marginBottom: DesignTokens.spacing.xxs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  supportInput: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    fontSize: 14,
    minHeight: 44,
  },
  supportTextarea: {
    minHeight: 110,
    paddingTop: DesignTokens.spacing.xs,
  },
  supportCharCount: {
    textAlign: 'right',
    marginTop: 2,
  },
  supportError: {
    marginTop: DesignTokens.spacing.xs,
  },
  supportSubmitBtn: {
    marginTop: DesignTokens.spacing.md,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
  },
  supportSuccessWrap: {
    alignItems: 'center',
    paddingVertical: DesignTokens.spacing.xl,
    gap: DesignTokens.spacing.sm,
  },
  supportSuccessTitle: {
    fontSize: 18,
    marginTop: DesignTokens.spacing.xs,
  },
  supportSuccessDesc: {
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: DesignTokens.spacing.md,
  },
  discountStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xxs,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
  },
  discountTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: DesignTokens.spacing.xs,
  },
  discountTypeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xxs,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
  },
  discountUploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: DesignTokens.spacing.xs,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    borderStyle: 'dashed',
    paddingVertical: DesignTokens.spacing.sm,
    minHeight: 48,
  },
  discountIdPreview: {
    width: '100%',
    height: 160,
    borderRadius: DesignTokens.radius.md,
  },
  discountSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
  },
});
