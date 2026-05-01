import React, { useState, useEffect } from 'react';
import { Modal, View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { ThemedText } from './themed-text';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AppPalette } from '@/constants/app-ui';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DesignTokens, OutfitFonts, Colors } from '@/constants/theme';

export type HowToBookModalProps = {
  visible: boolean;
  onClose: () => void;
  showDontShowAgain?: boolean;
};

export function HowToBookModal({ visible, onClose, showDontShowAgain = true }: HowToBookModalProps) {
  const colorScheme = useColorScheme();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const bgColor = colorScheme === 'dark' ? '#111827' : '#ffffff';
  const surfaceColor = colorScheme === 'dark' ? '#1f2937' : '#f3f4f6';
  const textColor = colorScheme === 'dark' ? '#f9fafb' : '#111827';
  const mutedColor = colorScheme === 'dark' ? '#9ca3af' : '#6b7280';
  const borderColor = colorScheme === 'dark' ? '#374151' : '#e5e7eb';
  const tint = colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint;
  const successColor = colorScheme === 'dark' ? Colors.dark.success : Colors.light.success;

  const handleClose = async () => {
    if (showDontShowAgain && dontShowAgain) {
      await AsyncStorage.setItem('@how_to_book_seen', 'true');
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.modalContainer, { backgroundColor: bgColor, borderColor }]}>
          <View style={styles.header}>
            <View style={[styles.iconBadge, { backgroundColor: colorScheme === 'dark' ? AppPalette.darkOverlaySoft : AppPalette.slateBg }]}>
              <Ionicons name="book" size={20} color={tint} />
            </View>
            <View style={styles.headerTextWrap}>
              <ThemedText style={[styles.title, { color: textColor }]}>How to Book</ThemedText>
              <ThemedText style={[styles.subtitle, { color: mutedColor }]}>Your guide to requesting a shuttle</ThemedText>
            </View>
            <Pressable onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={mutedColor} />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <View style={[styles.stepCard, { borderColor, backgroundColor: surfaceColor }]}>
              <View style={[styles.stepNumber, { backgroundColor: tint }]}>
                <ThemedText style={styles.stepNumberText}>1</ThemedText>
              </View>
              <View style={styles.stepCopy}>
                <ThemedText style={[styles.stepTitle, { color: textColor }]}>Choose Your Destination</ThemedText>
                <ThemedText style={[styles.stepDesc, { color: mutedColor }]}>
                  Select a <ThemedText style={{fontFamily: OutfitFonts.bold}}>Fixed stop</ThemedText> configured by your community or choose your saved <ThemedText style={{fontFamily: OutfitFonts.bold}}>Home</ThemedText> location.
                </ThemedText>
              </View>
            </View>

            <View style={[styles.stepCard, { borderColor, backgroundColor: surfaceColor }]}>
              <View style={[styles.stepNumber, { backgroundColor: successColor }]}>
                <ThemedText style={styles.stepNumberText}>2</ThemedText>
              </View>
              <View style={styles.stepCopy}>
                <ThemedText style={[styles.stepTitle, { color: textColor }]}>Select Fare Type</ThemedText>
                <ThemedText style={[styles.stepDesc, { color: mutedColor }]}>
                  Choose between <ThemedText style={{fontFamily: OutfitFonts.bold}}>Standard</ThemedText> fare or <ThemedText style={{color: '#f59e0b', fontFamily: OutfitFonts.bold}}>Priority</ThemedText> fare to skip the queue during busy hours.
                </ThemedText>
              </View>
            </View>

            <View style={[styles.stepCard, { borderColor, backgroundColor: surfaceColor }]}>
              <View style={[styles.stepNumber, { backgroundColor: palette.navy }]}>
                <ThemedText style={styles.stepNumberText}>3</ThemedText>
              </View>
              <View style={styles.stepCopy}>
                <ThemedText style={[styles.stepTitle, { color: textColor }]}>Request Shuttle</ThemedText>
                <ThemedText style={[styles.stepDesc, { color: mutedColor }]}>
                  Tap the <ThemedText style={{fontFamily: OutfitFonts.bold}}>Request Shuttle</ThemedText> button. You will be notified when a driver is assigned.
                </ThemedText>
              </View>
            </View>
            
            <View style={[styles.stepCard, { borderColor, backgroundColor: surfaceColor }]}>
              <View style={[styles.stepNumber, { backgroundColor: AppPalette.slateBorder }]}>
                <Ionicons name="people" size={14} color={palette.white} />
              </View>
              <View style={styles.stepCopy}>
                <ThemedText style={[styles.stepTitle, { color: textColor }]}>Booking for someone else?</ThemedText>
                <ThemedText style={[styles.stepDesc, { color: mutedColor }]}>
                  Enable the <ThemedText style={{fontFamily: OutfitFonts.bold}}>Book for someone else</ThemedText> toggle to request a shuttle on behalf of guests.
                </ThemedText>
              </View>
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: borderColor, backgroundColor: bgColor }]}>
            {showDontShowAgain && (
              <Pressable
                onPress={() => setDontShowAgain(!dontShowAgain)}
                style={styles.checkboxRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: dontShowAgain }}
              >
                <Ionicons name={dontShowAgain ? 'checkbox' : 'square-outline'} size={20} color={dontShowAgain ? tint : mutedColor} />
                <ThemedText style={[styles.checkboxLabel, { color: mutedColor }]}>Don't show this again</ThemedText>
              </Pressable>
            )}
            
            <Pressable
              onPress={handleClose}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: tint },
                pressed && { opacity: 0.8 }
              ]}
            >
              <ThemedText style={styles.primaryBtnText}>Got it!</ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const palette = {
  navy: AppPalette.navy,
  white: AppPalette.white,
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: DesignTokens.radius.xl,
    borderTopRightRadius: DesignTokens.radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    maxHeight: '90%',
    paddingBottom: DesignTokens.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: DesignTokens.spacing.md,
    gap: DesignTokens.spacing.sm,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    fontFamily: OutfitFonts.extraBold,
    fontSize: 20,
  },
  subtitle: {
    fontFamily: OutfitFonts.medium,
    fontSize: 13,
  },
  closeBtn: {
    padding: DesignTokens.spacing.xs,
  },
  scroll: {
    maxHeight: 500,
  },
  content: {
    paddingHorizontal: DesignTokens.spacing.md,
    gap: DesignTokens.spacing.sm,
    paddingBottom: DesignTokens.spacing.md,
  },
  stepCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.md,
    flexDirection: 'row',
    gap: DesignTokens.spacing.md,
    alignItems: 'flex-start',
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stepNumberText: {
    color: palette.white,
    fontFamily: OutfitFonts.extraBold,
    fontSize: 13,
  },
  stepCopy: {
    flex: 1,
    gap: 4,
  },
  stepTitle: {
    fontFamily: OutfitFonts.bold,
    fontSize: 15,
  },
  stepDesc: {
    fontFamily: OutfitFonts.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    padding: DesignTokens.spacing.md,
    borderTopWidth: 1,
    gap: DesignTokens.spacing.md,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
  },
  checkboxLabel: {
    fontFamily: OutfitFonts.medium,
    fontSize: 14,
  },
  primaryBtn: {
    borderRadius: DesignTokens.radius.md,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: palette.white,
    fontFamily: OutfitFonts.bold,
    fontSize: 16,
  },
});
