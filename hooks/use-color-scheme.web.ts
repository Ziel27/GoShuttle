import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { usePreferencesStore } from '@/store/preferences';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);
  const themeMode = usePreferencesStore((state) => state.themeMode);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const colorScheme = useRNColorScheme();

  if (themeMode !== 'system') {
    return themeMode;
  }

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
