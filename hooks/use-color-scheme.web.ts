import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';
import type { ColorSchemeName } from 'react-native';

import { usePreferencesStore } from '@/store/preferences';

/**
 * Hook to determine the active color scheme on the web.
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * @returns {ColorSchemeName} The active theme mode.
 */
export function useColorScheme(): ColorSchemeName {
  const [hasHydrated, setHasHydrated] = useState(false);
  const themeMode = usePreferencesStore((state) => state.themeMode);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const colorScheme = useRNColorScheme();

  if (themeMode !== 'system') {
    return themeMode as ColorSchemeName;
  }

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
