import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
  useFonts
} from '@expo-google-fonts/outfit';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';

const logoSource = require('../assets/images/logo.png');

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrated = useAuthStore((state) => state.hydrated);
  const hydratePreferences = usePreferencesStore((state) => state.hydrate);
  const preferencesHydrated = usePreferencesStore((state) => state.hydrated);

  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
  });

  useEffect(() => {
    hydrate();
    hydratePreferences();
  }, [hydrate, hydratePreferences]);

  if (!hydrated || !preferencesHydrated || !fontsLoaded) {
    return (
      <View style={styles.loadingScreen}>
        <View style={styles.loadingCard}>
          <View style={styles.loadingLogoFrame}>
            <Image source={logoSource} resizeMode="cover" style={styles.loadingLogo} />
          </View>
          <Text style={styles.loadingTitle}>GoShuttle</Text>
          <Text style={styles.loadingSubtitle}>Preparing your shuttle experience...</Text>
        </View>
        <ActivityIndicator size="small" style={styles.loadingSpinner} />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="change-password" options={{ headerShown: false }} />
        <Stack.Screen name="ticket-history" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
  },
  loadingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 20,
  },
  loadingLogoFrame: {
    width: 128,
    height: 128,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#f0f7f2',
  },
  loadingLogo: {
    width: '100%',
    height: '100%',
    transform: [{ scale: 1.18 }],
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#17351f',
    letterSpacing: 0.2,
  },
  loadingSubtitle: {
    fontSize: 13,
    color: '#5d6d61',
  },
  loadingSpinner: {
    marginTop: 10,
  },
});
