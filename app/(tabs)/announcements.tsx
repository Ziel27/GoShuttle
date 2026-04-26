import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { PremiumCard } from '@/components/ui/premium-card';
import { SectionHeader } from '@/components/ui/section-header';
import { AppPalette } from '@/constants/app-ui';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Announcement, listAnnouncements } from '@/services/announcements';
import { connectCommunitySocket } from '@/services/socket';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const levelPill = (level: Announcement['level']) => {
  if (level === 'critical') return { label: 'Critical', bg: AppPalette.danger, fg: AppPalette.white };
  if (level === 'warning') return { label: 'Warning', bg: AppPalette.amber, fg: AppPalette.navy };
  return { label: 'Info', bg: AppPalette.sky, fg: AppPalette.navy };
};

export default function AnnouncementsTabScreen() {
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const serviceUpdates = usePreferencesStore((state) => state.serviceUpdates);
  const quietMode = usePreferencesStore((state) => state.quietMode);

  const bgColor = useThemeColor({}, 'background');
  const textColor = useThemeColor({}, 'text');
  const mutedColor = useThemeColor({}, 'textMuted');
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const tint = useThemeColor({}, 'tint');

  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    setError('');
    try {
      const data = await listAnnouncements({ limit: 50 });
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load announcements.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  useEffect(() => {
    if (!user?.communityId) return;
    const socket = connectCommunitySocket(user.communityId, token);

    const onAnnouncementNew = (payload: any) => {
      if (!payload || typeof payload !== 'object') return;
      if (typeof payload._id !== 'string') return;

      const next: Announcement = {
        _id: payload._id,
        title: String(payload.title || ''),
        body: String(payload.body || ''),
        level: (payload.level as Announcement['level']) || 'info',
        createdAt: String(payload.createdAt || new Date().toISOString()),
        updatedAt: String(payload.updatedAt || new Date().toISOString()),
        createdBy: typeof payload.createdBy === 'object' && payload.createdBy !== null
          ? {
              firstName: (payload.createdBy as any).firstName,
              lastName: (payload.createdBy as any).lastName,
              email: (payload.createdBy as any).email,
            }
          : undefined,
      };

      setItems((current) => {
        if (current.some((item) => item._id === next._id)) return current;
        return [next, ...current];
      });
    };

    socket.on('announcement:new', onAnnouncementNew);
    return () => {
      socket.off('announcement:new', onAnnouncementNew);
    };
  }, [token, user?.communityId]);

  const preferenceHint = useMemo(() => {
    if (quietMode) return 'Quiet Mode is enabled — service alerts are muted.';
    if (!serviceUpdates) return 'Service Updates notifications are off — announcements won’t trigger alerts.';
    return 'Announcements will respect your Service Updates preference.';
  }, [quietMode, serviceUpdates]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: bgColor }]} edges={['top', 'left', 'right']}>
      <View style={[styles.root, { backgroundColor: bgColor }]}>
        <SectionHeader
          title="Announcements"
          subtitle="Service updates and advisories from your community admins."
          rightAction={
            <Pressable
              onPress={() => void load('refresh')}
              accessibilityRole="button"
              accessibilityLabel="Refresh announcements"
              style={({ pressed }) => [
                styles.refreshButton,
                { borderColor, backgroundColor: surfaceMuted },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Ionicons name="refresh" size={16} color={tint} />
              <ThemedText type="defaultSemiBold" style={{ color: tint, fontSize: 12 }}>
                Refresh
              </ThemedText>
            </Pressable>
          }
        />

        <View style={[styles.hintCard, { borderColor, backgroundColor: surfaceMuted }]}>
          <ThemedText type="caption" style={{ color: mutedColor }}>
            {preferenceHint}
          </ThemedText>
        </View>

        {error ? (
          <View style={[styles.errorCard, { borderColor: AppPalette.danger, backgroundColor: surface }]}>
            <ThemedText type="caption" style={{ color: AppPalette.danger }}>
              {error}
            </ThemedText>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={tint} />
            <ThemedText type="caption" style={{ color: mutedColor }}>
              Loading announcements...
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item._id}
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            contentContainerStyle={[
              styles.listContent,
              items.length === 0 ? styles.listContentEmpty : null,
            ]}
            renderItem={({ item }) => {
              const pill = levelPill(item.level);
              const byline = item.createdBy
                ? `${item.createdBy.firstName || ''} ${item.createdBy.lastName || ''}`.trim() || item.createdBy.email || 'Admin'
                : 'Admin';

              return (
                <PremiumCard style={[styles.card, { borderColor, backgroundColor: surface }]}>
                  <View style={styles.cardHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="defaultSemiBold" style={{ color: textColor, fontSize: 14 }}>
                        {item.title}
                      </ThemedText>
                      <ThemedText type="caption" style={{ color: mutedColor }}>
                        {new Date(item.createdAt).toLocaleString('en-PH')} · {byline}
                      </ThemedText>
                    </View>
                    <View style={[styles.levelPill, { backgroundColor: pill.bg }]}>
                      <ThemedText style={{ color: pill.fg, fontSize: 11, fontFamily: OutfitFonts.bold }}>
                        {pill.label}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText style={{ color: textColor, marginTop: 10, lineHeight: 18 }}>
                    {item.body}
                  </ThemedText>
                </PremiumCard>
              );
            }}
            ListEmptyComponent={
              <EmptyState
                icon="megaphone-outline"
                title="No announcements yet"
                subtitle="When admins post service updates, they’ll appear here."
              />
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  root: {
    flex: 1,
    padding: DesignTokens.spacing.md,
    gap: DesignTokens.spacing.sm,
  },
  refreshButton: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hintCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.sm,
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.sm,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  listContent: {
    gap: DesignTokens.spacing.sm,
    paddingBottom: DesignTokens.spacing.lg,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    borderRadius: DesignTokens.radius.lg,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: DesignTokens.spacing.sm,
  },
  levelPill: {
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
});

