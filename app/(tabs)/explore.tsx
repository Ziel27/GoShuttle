import { ThemedText } from '@/components/themed-text';
import { PremiumButton } from '@/components/ui/premium-button';
import { PremiumCard } from '@/components/ui/premium-card';
import { SectionHeader } from '@/components/ui/section-header';
import { getCapacityColor } from '@/constants/app-ui';
import { DesignTokens } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { listShuttles, Shuttle } from '@/services/shuttle';
import { connectCommunitySocket } from '@/services/socket';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const capacityColor = getCapacityColor;

export default function FleetScreen() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const quietMode = usePreferencesStore((state) => state.quietMode);
  const serviceUpdates = usePreferencesStore((state) => state.serviceUpdates);
  const tint = useThemeColor({}, 'tint');
  const textColor = useThemeColor({}, 'text');
  const mutedColor = useThemeColor({}, 'textMuted');
  const dangerColor = useThemeColor({}, 'danger');
  const bgColor = useThemeColor({}, 'background');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const onTint = useThemeColor({}, 'background');
  const [shuttles, setShuttles] = useState<Shuttle[]>([]);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  const totals = useMemo(() => {
    const totalCapacity = shuttles.reduce((sum, item) => sum + item.maxCapacity, 0);
    const currentLoad = shuttles.reduce((sum, item) => sum + item.currentCapacity, 0);

    return {
      count: shuttles.length,
      totalCapacity,
      currentLoad,
    };
  }, [shuttles]);

  const setPreferenceAwareFeedback = useCallback((
    message: string,
    channel: 'service' | 'critical' = 'service'
  ) => {
    if (channel === 'critical') {
      setFeedback(message);
      return;
    }

    if (quietMode || !serviceUpdates) return;
    setFeedback(message);
  }, [quietMode, serviceUpdates]);

  const refresh = useCallback(async () => {
    setLoading(true);
    if (!quietMode && serviceUpdates) {
      setFeedback('');
    }
    try {
      const data = await listShuttles();
      setShuttles(data);
      setPreferenceAwareFeedback('Fleet refreshed.', 'service');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load fleet.';
      setPreferenceAwareFeedback(message, 'critical');
    } finally {
      setLoading(false);
    }
  }, [quietMode, serviceUpdates, setPreferenceAwareFeedback]);

  useEffect(() => {
    if (!user?.communityId) return;

    refresh();
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
  }, [refresh, token, user?.communityId]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bgColor }]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.container, { backgroundColor: bgColor }]}>
        <PremiumCard style={[styles.header, { backgroundColor: tint, borderColor: tint }]}>
          <SectionHeader
            title="Fleet Board"
            subtitle={`Role: ${user?.role}`}
            titleColor={onTint}
            subtitleColor={onTint}
            rightAction={
              <PremiumButton style={styles.refreshButton} onPress={refresh} variant="secondary">
                <Ionicons name="refresh" size={18} color={tint} />
                <ThemedText style={[styles.refreshText, { color: tint }]}>{loading ? 'Refreshing' : 'Refresh'}</ThemedText>
              </PremiumButton>
            }
          />
        </PremiumCard>

        <PremiumCard style={styles.summaryCard} muted>
          <ThemedText style={[styles.summaryTitle, { color: textColor }]}>Community Snapshot</ThemedText>
          <View style={styles.metricsRow}>
            <View style={[styles.metricItem, { backgroundColor: surfaceMuted }]}>
              <ThemedText style={[styles.metricValue, { color: textColor }]}>{totals.count}</ThemedText>
              <ThemedText style={[styles.metricLabel, { color: mutedColor }]}>Shuttles</ThemedText>
            </View>
            <View style={[styles.metricItem, { backgroundColor: surfaceMuted }]}>
              <ThemedText style={[styles.metricValue, { color: textColor }]}>{totals.currentLoad}</ThemedText>
              <ThemedText style={[styles.metricLabel, { color: mutedColor }]}>Current Load</ThemedText>
            </View>
            <View style={[styles.metricItem, { backgroundColor: surfaceMuted }]}>
              <ThemedText style={[styles.metricValue, { color: textColor }]}>{totals.totalCapacity}</ThemedText>
              <ThemedText style={[styles.metricLabel, { color: mutedColor }]}>Total Capacity</ThemedText>
            </View>
          </View>
        </PremiumCard>

        {feedback ? <ThemedText style={[styles.error, { color: dangerColor }]}>{feedback}</ThemedText> : null}

        {shuttles.map((item) => (
          <PremiumCard key={item._id} style={styles.shuttleCard}>
            <View style={styles.shuttleHead}>
              <View style={styles.shuttleTitleWrap}>
                <Ionicons name="bus" size={16} color={tint} />
                <ThemedText style={[styles.shuttleTitle, { color: textColor }]}>
                  {item.plateNumber} {item.label ? `- ${item.label}` : ''}
                </ThemedText>
              </View>
              <ThemedText style={[styles.statusText, { color: mutedColor }]}>{item.status}</ThemedText>
            </View>

            <View style={styles.rowLine}>
              <ThemedText style={[styles.rowLabel, { color: mutedColor }]}>Capacity</ThemedText>
              <ThemedText style={[styles.rowValue, { color: capacityColor(item.currentCapacity, item.maxCapacity) }]}> 
                {item.currentCapacity}/{item.maxCapacity}
              </ThemedText>
            </View>

            <View style={styles.rowLine}>
              <ThemedText style={[styles.rowLabel, { color: mutedColor }]}>Lng / Lat</ThemedText>
              <ThemedText style={[styles.rowValue, { color: textColor }]}> 
                {item.location?.coordinates?.[0]?.toFixed?.(4) ?? '-'} / {item.location?.coordinates?.[1]?.toFixed?.(4) ?? '-'}
              </ThemedText>
            </View>
          </PremiumCard>
        ))}
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
    gap: DesignTokens.spacing.xs,
  },
  summaryTitle: {
    fontSize: DesignTokens.typography.bodyStrong.fontSize,
    fontWeight: '700',
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
  metricValue: {
    fontSize: 26,
    fontWeight: '800',
  },
  metricLabel: {
    ...DesignTokens.typography.caption,
  },
  refreshButton: {
    minHeight: 40,
    paddingVertical: DesignTokens.spacing.xxs,
    paddingHorizontal: DesignTokens.spacing.xs,
  },
  refreshText: {
    fontWeight: '700',
  },
  error: {
    fontWeight: '600',
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
  shuttleTitle: {
    fontWeight: '800',
    fontSize: 15,
  },
  statusText: {
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  rowLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    ...DesignTokens.typography.caption,
  },
  rowValue: {
    fontWeight: '700',
  },
});
