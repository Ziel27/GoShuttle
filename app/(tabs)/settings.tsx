import { ThemedText } from '@/components/themed-text';
import { PremiumButton } from '@/components/ui/premium-button';
import { PremiumCard } from '@/components/ui/premium-card';
import { AppPalette } from '@/constants/app-ui';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { getCommunityById } from '@/services/community';
import { startShift, stopShift } from '@/services/trip';
import { setHomeDestinationFromGps } from '@/services/user';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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

  useEffect(() => {
    if (!user?.communityId) return;
    const loadCommunity = async () => {
      try {
        const community = await getCommunityById(user.communityId);
        setCommunityName(community?.name ?? null);
      } catch (error) {
        console.error('Failed to load community:', error);
      }
    };
    loadCommunity();
  }, [user?.communityId]);

  useEffect(() => {
    if (!isPassenger) return;
    setHomeAddressInput(user?.homeDestination?.label || '');
  }, [isPassenger, user?.homeDestination?.label]);

  const handleShiftToggle = async () => {
    setShiftLoading(true);
    try {
      const newStatus = user?.status === 'driving' ? 'offline' : 'driving';
      if (newStatus === 'driving') {
        await startShift();
      } else {
        await stopShift();
      }
      updateUserField('status', newStatus);
      setSettingsFeedback(newStatus === 'driving' ? 'Shift started!' : 'Shift ended!');
    } catch (error) {
      setSettingsFeedback(error instanceof Error ? error.message : 'Failed to update shift');
    } finally {
      setShiftLoading(false);
    }
  };

  const handleChangePassword = async () => {
    try {
      const mailto = `mailto:support@goshuttle.app?subject=${encodeURIComponent('Password Reset Request')}&body=${encodeURIComponent(`Please help reset my password for ${user?.email || 'my account'}.`)}`;
      const canOpen = await Linking.canOpenURL(mailto);

      if (!canOpen) {
        setSettingsFeedback('No mail app is available. Please contact your community admin for password reset.');
        return;
      }

      await Linking.openURL(mailto);
      setSettingsFeedback('Opened mail app for password reset request.');
    } catch {
      setSettingsFeedback('Unable to open password reset flow. Please try again later.');
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
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
  const onTint = useThemeColor({}, 'background');

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
      <Switch value={value} onValueChange={onChange} trackColor={{ true: tint, false: AppPalette.switchTrackOff }} />
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bgColor }]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.root, { backgroundColor: bgColor }]}>
        <PremiumCard style={[styles.hero, { backgroundColor: tint, borderColor: tint }]}> 
        <View style={[styles.heroIconWrap, { borderColor: onTint, backgroundColor: tint }]}> 
          <Ionicons name="person-circle-outline" size={22} color={onTint} />
        </View>
        <View style={styles.heroTextWrap}>
            <ThemedText type="subtitle" style={{ color: onTint }}>Account Settings</ThemedText>
            <ThemedText type="caption" style={{ color: onTint, opacity: 0.9 }}>Manage your profile and session</ThemedText>
        </View>
        </PremiumCard>

        <PremiumCard style={styles.card}>
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
        </PremiumCard>

        <PremiumCard style={styles.card}>
          <ThemedText type="subtitle" style={{ color: textColor }}>Session</ThemedText>
          <PremiumButton
            style={styles.secondaryAction}
            variant="secondary"
            onPress={handleChangePassword}
          >
            <Ionicons name="key-outline" size={16} color={tint} />
            <ThemedText type="defaultSemiBold" style={{ color: tint, fontSize: 14 }}>Change Password</ThemedText>
          </PremiumButton>
          <PremiumButton style={[styles.logoutBtn, { backgroundColor: '#dc2626', borderColor: '#dc2626' }]} onPress={handleLogout} variant="danger">
            <Ionicons name="log-out-outline" size={16} color="#ffffff" />
            <ThemedText type="defaultSemiBold" style={{ color: '#ffffff', fontSize: 16 }}>Logout</ThemedText>
          </PremiumButton>
        </PremiumCard>

        {isDriver ? (
          <PremiumCard style={styles.card}>
            <View style={styles.shiftHeader}>
              <ThemedText type="subtitle" style={{ color: textColor }}>Driver Shift</ThemedText>
              <View style={[styles.statusBadge, { backgroundColor: user?.status === 'driving' ? AppPalette.success : AppPalette.slateBg, borderColor: user?.status === 'driving' ? AppPalette.success : AppPalette.slateBorder }]}> 
                <ThemedText type="defaultSemiBold" style={{ color: user?.status === 'driving' ? '#ffffff' : mutedColor, fontSize: 11, textTransform: 'capitalize' }}>
                  {user?.status || 'offline'}
                </ThemedText>
              </View>
            </View>
            <PremiumButton
              style={[styles.shiftBtn, { borderColor: user?.status === 'driving' ? '#dc2626' : AppPalette.success, backgroundColor: user?.status === 'driving' ? '#dc2626' : AppPalette.success }]}
              onPress={handleShiftToggle}
              disabled={shiftLoading}
            >
              <Ionicons name={user?.status === 'driving' ? 'stop-circle-outline' : 'play-circle-outline'} size={16} color="#ffffff" />
              <ThemedText type="defaultSemiBold" style={{ color: '#ffffff', fontSize: 14 }}>
                {shiftLoading ? 'Updating...' : user?.status === 'driving' ? 'End Shift' : 'Start Shift'}
              </ThemedText>
            </PremiumButton>
          </PremiumCard>
        ) : null}

        <PremiumCard style={styles.card} muted>
          <ThemedText type="subtitle" style={{ color: textColor }}>Notifications</ThemedText>
          {settingRow(
            'notifications-outline',
            isDriver ? 'Driver Action Alerts' : 'Push Alerts',
            isDriver
              ? 'Boarding, shift, and pickup action confirmations.'
              : 'Ride accepted, shuttle near, and boarding updates.',
            pushAlerts,
            setPushAlerts
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
        </PremiumCard>

        <PremiumCard style={styles.card}>
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
        </PremiumCard>

        {isPassenger ? (
          <PremiumCard style={styles.card} muted>
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
                ? `Saved Home: ${user.homeDestination.label} (${user.homeDestination.location.coordinates[1].toFixed(5)}, ${user.homeDestination.location.coordinates[0].toFixed(5)})`
                : 'No Home destination saved yet.'}
            </ThemedText>
          </PremiumCard>
        ) : null}

        <PremiumCard style={styles.card}>
          <ThemedText type="subtitle" style={{ color: textColor }}>Appearance</ThemedText>
          <View style={styles.appearanceRow}>
            {[
              { key: 'system' as const, label: 'System' },
              { key: 'light' as const, label: 'Light' },
              { key: 'dark' as const, label: 'Dark' },
            ].map((item) => (
              <Pressable
                key={item.key}
                onPress={() => setThemeMode(item.key)}
                style={[
                  styles.appearanceChip,
                  {
                    borderColor: appearance === item.key ? tint : borderColor,
                    backgroundColor: appearance === item.key ? surfaceMuted : surface,
                  },
                ]}>
                <ThemedText type="defaultSemiBold" style={{ color: appearance === item.key ? tint : mutedColor, fontSize: 12 }}>
                  {item.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText type="caption" style={{ color: mutedColor }}>Theme preference is saved and applied app-wide.</ThemedText>
        </PremiumCard>

        {settingsFeedback ? <ThemedText style={[styles.note, { color: mutedColor }]}>{settingsFeedback}</ThemedText> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  root: {
    padding: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.xs,
  },
  hero: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
  },
  heroIconWrap: {
    width: 42,
    height: 42,
    borderRadius: DesignTokens.radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextWrap: {
    flex: 1,
  },
  heroTitle: {
    ...DesignTokens.typography.subtitle,
  },
  heroSubtitle: {
    ...DesignTokens.typography.caption,
    opacity: 0.9,
  },
  card: {
    gap: DesignTokens.spacing.xs,
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
    minHeight: 58,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.xs,
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
    gap: 6,
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
  logoutBtn: {
    marginTop: DesignTokens.spacing.xxs,
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
});
