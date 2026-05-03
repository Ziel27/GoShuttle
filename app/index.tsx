import { Redirect } from 'expo-router';
import { View } from 'react-native';

import { useAuthStore } from '@/store/auth';

/**
 * Root index route — handles initial navigation.
 * We redirect here instead of conditionally declaring Stack.Screen
 * entries in the root layout, which causes a rnscreens crash on auth
 * state transitions (ScreenStackFragment added into a non-stack container).
 *
 * NOTE: The parent _layout.tsx already blocks rendering this component
 * until `hydrated === true`, so the token/hasSeenWelcome values here
 * are always the real values read from SecureStore — never the defaults.
 */
export default function Index() {
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const hasSeenWelcome = useAuthStore((state) => state.hasSeenWelcome);

  // Extra safety: don't redirect until store is hydrated from SecureStore.
  // In practice _layout.tsx already blocks us, but this prevents a flash
  // if the layout guard is ever removed.
  if (!hydrated) {
    return <View />;
  }

  if (token) {
    return <Redirect href="/(tabs)" />;
  }

  if (!hasSeenWelcome) {
    return <Redirect href="/welcome" />;
  }

  return <Redirect href="/(auth)/login" />;
}
