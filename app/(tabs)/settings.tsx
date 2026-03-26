import { ThemedText } from '@/components/themed-text';
import { PremiumButton } from '@/components/ui/premium-button';
import { PremiumCard } from '@/components/ui/premium-card';
import { AppPalette } from '@/constants/app-ui';
import { DesignTokens } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
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
          <ThemedText style={[styles.controlTitle, { color: textColor }]}>{title}</ThemedText>
        </View>
        <ThemedText style={[styles.controlSubtitle, { color: mutedColor }]}>{subtitle}</ThemedText>
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
            <ThemedText style={[styles.heroTitle, { color: onTint }]}>Account Settings</ThemedText>
            <ThemedText style={[styles.heroSubtitle, { color: onTint }]}>Manage your profile and session</ThemedText>
        </View>
        </PremiumCard>

        <PremiumCard style={styles.card}>
        <View style={styles.row}>
          <ThemedText style={[styles.rowLabel, { color: mutedColor }]}>Name</ThemedText>
          <ThemedText style={[styles.rowValue, { color: textColor }]}>
            {user?.firstName} {user?.lastName}
          </ThemedText>
        </View>

        <View style={[styles.separator, { backgroundColor: borderColor }]} />

        <View style={styles.row}>
          <ThemedText style={[styles.rowLabel, { color: mutedColor }]}>Email</ThemedText>
          <ThemedText style={[styles.rowValue, { color: textColor }]}>{user?.email || '-'}</ThemedText>
        </View>

        <View style={[styles.separator, { backgroundColor: borderColor }]} />

        <View style={styles.row}>
          <ThemedText style={[styles.rowLabel, { color: mutedColor }]}>Role</ThemedText>
          <View style={[styles.rolePill, { borderColor: tint, backgroundColor: surfaceMuted }]}> 
            <ThemedText style={[styles.roleText, { color: tint }]}>{user?.role || '-'}</ThemedText>
          </View>
        </View>

        <View style={[styles.separator, { backgroundColor: borderColor }]} />

        <View style={styles.row}>
          <ThemedText style={[styles.rowLabel, { color: mutedColor }]}>Community</ThemedText>
          <ThemedText style={[styles.rowValue, { color: textColor }]}>{user?.communityId || '-'}</ThemedText>
        </View>
        </PremiumCard>

        <PremiumCard style={styles.card}>
          <ThemedText style={[styles.sectionTitle, { color: textColor }]}>Session</ThemedText>
          <PremiumButton
            style={styles.secondaryAction}
            variant="secondary"
            onPress={handleChangePassword}
          >
            <Ionicons name="key-outline" size={16} color={tint} />
            <ThemedText style={[styles.secondaryActionText, { color: tint }]}>Change Password</ThemedText>
          </PremiumButton>
          <PremiumButton style={styles.logoutBtn} onPress={handleLogout} variant="danger">
            <Ionicons name="log-out-outline" size={16} color="#ffffff" />
            <ThemedText style={styles.logoutText}>Logout</ThemedText>
          </PremiumButton>
        </PremiumCard>

        <PremiumCard style={styles.card} muted>
          <ThemedText style={[styles.sectionTitle, { color: textColor }]}>Notifications</ThemedText>
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
          <ThemedText style={[styles.sectionTitle, { color: textColor }]}>
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
            <ThemedText style={[styles.sectionTitle, { color: textColor }]}>Privacy</ThemedText>
            {settingRow(
              'location-outline',
              'Precise Pickup Location',
              'Send exact pickup coordinates for faster matching.',
              precisePickup,
              setPrecisePickup
            )}
          </PremiumCard>
        ) : null}

        <PremiumCard style={styles.card}>
          <ThemedText style={[styles.sectionTitle, { color: textColor }]}>Appearance</ThemedText>
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
                <ThemedText style={{ color: appearance === item.key ? tint : mutedColor, fontWeight: '700', fontSize: 12 }}>
                  {item.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText style={[styles.note, { color: mutedColor }]}>Theme preference is saved and applied app-wide.</ThemedText>
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
  rowLabel: {
    fontWeight: '700',
  },
  rowValue: {
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  separator: {
    height: 1,
  },
  rolePill: {
    borderRadius: DesignTokens.radius.pill,
    borderWidth: 1,
    paddingHorizontal: DesignTokens.spacing.xs,
    paddingVertical: DesignTokens.spacing.xxs,
  },
  roleText: {
    fontWeight: '700',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  sectionTitle: {
    fontWeight: '700',
    fontSize: 15,
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
  controlTitle: {
    fontWeight: '700',
    fontSize: 13,
  },
  controlSubtitle: {
    fontSize: 11,
    lineHeight: 15,
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
  secondaryActionText: {
    fontWeight: '700',
    fontSize: 14,
  },
  logoutBtn: {
    marginTop: DesignTokens.spacing.xxs,
  },
  logoutText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 16,
  },
  note: {
    fontSize: 12,
  },
});
