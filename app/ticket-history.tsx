import { ThemedText } from '@/components/themed-text';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { getMyTickets, SupportTicket } from '@/services/support';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const STATUS_CONFIG = {
  open: { label: 'Open', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  closed: { label: 'Closed', color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
};

function TicketCard({
  ticket,
  textColor,
  mutedColor,
  surfaceColor,
  borderColor,
}: {
  ticket: SupportTicket;
  textColor: string;
  mutedColor: string;
  surfaceColor: string;
  borderColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusCfg = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.open;
  const date = new Date(ticket.createdAt).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const time = new Date(ticket.createdAt).toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <Pressable
      onPress={() => setExpanded((v) => !v)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: surfaceColor, borderColor },
        pressed && { opacity: 0.85 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Support ticket: ${ticket.subject}`}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={mutedColor} style={{ marginTop: 1 }} />
          <Text style={[styles.cardSubject, { color: textColor }]} numberOfLines={expanded ? undefined : 1}>
            {ticket.subject}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg, borderColor: statusCfg.border }]}>
          <Text style={[styles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        </View>
      </View>

      {expanded && (
        <Text style={[styles.cardMessage, { color: mutedColor }]}>{ticket.message}</Text>
      )}

      <View style={styles.cardFooter}>
        <Text style={[styles.cardDate, { color: mutedColor }]}>
          {date} · {time}
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={mutedColor} />
      </View>
    </Pressable>
  );
}

export default function TicketHistoryScreen() {
  const textColor = useThemeColor({}, 'text');
  const mutedColor = useThemeColor({}, 'textMuted');
  const bgColor = useThemeColor({}, 'background');
  const surfaceColor = useThemeColor({}, 'surface');
  const borderColor = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getMyTickets();
      setTickets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load support history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bgColor }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { borderColor, backgroundColor: surfaceColor }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.backBtn}
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={tint} />
        </Pressable>
        <View style={styles.headerTitle}>
          <ThemedText type="subtitle" style={{ color: textColor }}>Support History</ThemedText>
          <ThemedText type="caption" style={{ color: mutedColor }}>Your submitted messages</ThemedText>
        </View>
        <Pressable
          onPress={load}
          hitSlop={8}
          style={styles.refreshBtn}
          accessibilityLabel="Refresh tickets"
        >
          <Ionicons name="refresh" size={18} color={tint} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={tint} size="large" />
          <ThemedText type="caption" style={{ color: mutedColor, marginTop: 12 }}>
            Loading your support history…
          </ThemedText>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={mutedColor} />
          <ThemedText type="caption" style={{ color: mutedColor, marginTop: 12, textAlign: 'center' }}>
            {error}
          </ThemedText>
          <Pressable onPress={load} style={[styles.retryBtn, { borderColor: tint }]}>
            <ThemedText type="defaultSemiBold" style={{ color: tint }}>Retry</ThemedText>
          </Pressable>
        </View>
      ) : tickets.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="chatbubbles-outline" size={48} color={mutedColor} />
          <ThemedText type="defaultSemiBold" style={{ color: textColor, marginTop: 16 }}>
            No tickets yet
          </ThemedText>
          <ThemedText type="caption" style={{ color: mutedColor, marginTop: 6, textAlign: 'center', paddingHorizontal: 40 }}>
            Messages you send to our support team will appear here.
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: DesignTokens.spacing.sm }} />}
          renderItem={({ item }) => (
            <TicketCard
              ticket={item}
              textColor={textColor}
              mutedColor={mutedColor}
              surfaceColor={surfaceColor}
              borderColor={borderColor}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: DesignTokens.spacing.md,
    paddingVertical: DesignTokens.spacing.sm,
    borderBottomWidth: 1,
    gap: DesignTokens.spacing.sm,
  },
  backBtn: {
    padding: 4,
  },
  refreshBtn: {
    padding: 4,
    marginLeft: 'auto',
  },
  headerTitle: {
    flex: 1,
    gap: 2,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: DesignTokens.spacing.xl,
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: DesignTokens.spacing.lg,
    paddingVertical: DesignTokens.spacing.sm,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
  },
  list: {
    padding: DesignTokens.spacing.md,
    paddingBottom: DesignTokens.spacing.xl,
  },
  card: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.md,
    gap: DesignTokens.spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: DesignTokens.spacing.sm,
    justifyContent: 'space-between',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    flex: 1,
  },
  cardSubject: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 14,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
  },
  statusText: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 11,
  },
  cardMessage: {
    fontFamily: OutfitFonts.regular,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  cardDate: {
    fontFamily: OutfitFonts.regular,
    fontSize: 11,
  },
});
