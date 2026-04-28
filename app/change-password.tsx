import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AnimatedPressable } from '@/components/ui/animated-pressable';
import { AuthShell } from '@/components/ui/auth-shell';
import { ThemedInput } from '@/components/ui/themed-input';
import { ROUTES } from '@/constants/routes';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth';
import logoSource from '../assets/images/logo.png';

type Step = 'request' | 'verify' | 'reset';
const CODE_LENGTH = 6;

export default function ChangePasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const userEmail = useAuthStore((state) => state.user?.email || '');
  const signedInEmail = userEmail.trim().toLowerCase();
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState((params.email || signedInEmail || '').toString().trim().toLowerCase());
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef<TextInput | null>(null);
  const tint = useThemeColor({}, 'tint');
  const danger = useThemeColor({}, 'danger');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'textMuted');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const onTint = useThemeColor({}, 'background');
  const targetEmail = (signedInEmail || email.trim()).toLowerCase();
  const isEmailLocked = signedInEmail.length > 0;

  useEffect(() => {
    if (signedInEmail) {
      setEmail(signedInEmail);
    }
  }, [signedInEmail]);

  const handleCodeChange = useCallback((value: string) => {
    const normalized = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(normalized);
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;

    const timer = setInterval(() => {
      setResendCooldown((current) => {
        if (current <= 1) {
          clearInterval(timer);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resendCooldown > 0]);

  const requestCode = useCallback(async (isResend = false) => {
    if (!targetEmail) {
      setError('Email is required.');
      return;
    }

    setLoading(true);
    setError('');
    setInfo('');

    try {
      const response = await api.post('/auth/forgot-password', { email: targetEmail });
      const message = response.data?.message || 'Verification code sent.';
      const devCode = response.data?.devCode;
      const detail = devCode ? `${message} Dev code: ${devCode}` : message;
      setInfo(isResend ? `Code resent. ${detail}` : detail);
      setStep('verify');
      setResendCooldown(30);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send verification code.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [targetEmail]);

  const verifyCode = useCallback(async () => {
    if (code.trim().length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit verification code.`);
      return;
    }

    setLoading(true);
    setError('');
    setInfo('');

    try {
      const response = await api.post('/auth/verify-reset-code', {
        email: targetEmail,
        code: code.trim(),
      });

      setInfo(response.data?.message || 'Code verified. Please set your new password.');
      setStep('reset');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to verify code.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [targetEmail, code]);

  const changePassword = useCallback(async () => {
    if (!newPassword || !confirmPassword) {
      setError('Please enter and confirm your new password.');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError('');
    setInfo('');

    try {
      const response = await api.post('/auth/reset-password', {
        email: targetEmail,
        code: code.trim(),
        newPassword,
      });

      setInfo(response.data?.message || 'Password updated successfully.');
      router.replace(ROUTES.tabsSettings);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reset password.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [targetEmail, code, newPassword, confirmPassword]);

  return (
    <AuthShell
      icon="key-outline"
      logoSource={logoSource}
      title="Change Password"
      subtitle="Securely update your password"
      heroHeight="34%">
      <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
        <ThemedText type="title">Change Password</ThemedText>
        <ThemedText type="caption" style={{ color: muted, marginBottom: DesignTokens.spacing.xs }}>
          {step === 'request'
            ? 'Request a verification code to your account email.'
            : step === 'verify'
            ? 'Enter the verification code sent to your email.'
            : 'Set your new password.'}
        </ThemedText>

        <ThemedInput
          value={targetEmail}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="Email"
          editable={!isEmailLocked && step === 'request' && !loading}
        />

        {isEmailLocked ? (
          <ThemedText style={[styles.codeHint, { color: muted }]}>Using your signed-in account email.</ThemedText>
        ) : null}

        {step !== 'request' ? (
          <View>
            <Pressable
              style={styles.codeBoxesRow}
              onPress={() => codeInputRef.current?.focus()}
              disabled={step !== 'verify' || loading}>
              {Array.from({ length: CODE_LENGTH }).map((_, index) => {
                const digit = code[index] || '';
                const isActive = step === 'verify' && index === Math.min(code.length, CODE_LENGTH - 1);

                return (
                  <View
                    key={`otp-box-${index}`}
                    style={[
                      styles.codeBox,
                      { borderColor: muted, backgroundColor: onTint },
                      isActive && styles.codeBoxActive,
                      isActive && { borderColor: tint },
                    ]}>
                    <ThemedText style={[styles.codeBoxText, { color: text }]}>{digit || ' '}</ThemedText>
                  </View>
                );
              })}
            </Pressable>

            <TextInput
              ref={codeInputRef}
              value={code}
              onChangeText={handleCodeChange}
              keyboardType="number-pad"
              style={styles.hiddenCodeInput}
              editable={step === 'verify' && !loading}
              maxLength={CODE_LENGTH}
              autoFocus={step === 'verify'}
            />
          </View>
        ) : null}

        {step === 'verify' ? (
          <ThemedText style={[styles.codeHint, { color: muted }]}>Enter {CODE_LENGTH} digits from your email.</ThemedText>
        ) : null}

        {step === 'reset' ? (
          <>
            <ThemedInput
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              placeholder="New password"
              editable={!loading}
            />
            <ThemedInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              placeholder="Confirm new password"
              editable={!loading}
            />
          </>
        ) : null}

        {error ? <ThemedText style={[styles.error, { color: danger }]}>{error}</ThemedText> : null}
        {info ? <ThemedText style={[styles.info, { color: muted }]}>{info}</ThemedText> : null}

        <AnimatedPressable
          style={[styles.button, { backgroundColor: tint }, loading && styles.buttonDisabled]}
          onPress={
            step === 'request'
              ? () => requestCode(false)
              : step === 'verify'
              ? verifyCode
              : changePassword
          }
          disabled={
            loading ||
            (step === 'verify' && code.length !== CODE_LENGTH) ||
            (step === 'reset' && (!newPassword || !confirmPassword))
          }
          accessibilityRole="button"
          accessibilityLabel={
            step === 'request'
              ? 'Send verification code'
              : step === 'verify'
              ? 'Verify code'
              : 'Change password'
          }
          haptic>
          <ThemedText type="defaultSemiBold" style={{ color: onTint }}>
            {loading
              ? 'Please wait...'
              : step === 'request'
              ? 'Send Verification Code'
              : step === 'verify'
              ? 'Verify Code'
              : 'Change Password'}
          </ThemedText>
        </AnimatedPressable>

        {step === 'verify' ? (
          <Pressable
            onPress={() => requestCode(true)}
            disabled={loading || resendCooldown > 0}
            style={[styles.resendLink, (loading || resendCooldown > 0) && styles.resendLinkDisabled]}
            accessibilityRole="button"
            accessibilityLabel={resendCooldown > 0 ? `Resend code available in ${resendCooldown} seconds` : 'Resend verification code'}>
            <ThemedText type="defaultSemiBold" style={{ color: tint, fontSize: 13 }}>
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend verification code'}
            </ThemedText>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => router.replace(ROUTES.tabsSettings)}
          accessibilityRole="link"
          accessibilityLabel="Back to settings">
          <ThemedText type="link" style={{ color: tint, textAlign: 'center', marginTop: DesignTokens.spacing.sm }}>
            Back to Settings
          </ThemedText>
        </Pressable>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.lg,
    padding: DesignTokens.spacing.md,
    gap: DesignTokens.spacing.sm,
    ...DesignTokens.elevation.card,
  },
  codeBoxesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: DesignTokens.spacing.xs,
    marginTop: DesignTokens.spacing.xxs,
  },
  codeBox: {
    flex: 1,
    minHeight: 52,
    borderWidth: 1.5,
    borderRadius: DesignTokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxActive: {
    borderWidth: 1.5,
  },
  codeBoxText: {
    fontFamily: OutfitFonts.extraBold,
    fontSize: 20,
  },
  hiddenCodeInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  codeHint: {
    fontSize: 11,
    fontFamily: OutfitFonts.semiBold,
  },
  button: {
    marginTop: DesignTokens.spacing.xxs,
    borderRadius: DesignTokens.radius.pill,
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  error: {
    fontFamily: OutfitFonts.bold,
    fontSize: 12,
  },
  info: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 12,
  },
  resendLink: {
    alignSelf: 'center',
    marginTop: 2,
  },
  resendLinkDisabled: {
    opacity: 0.7,
  },
});