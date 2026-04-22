import { useColorScheme as useNativeColorScheme } from 'react-native';
import type { ColorSchemeName } from 'react-native';

import { usePreferencesStore } from '@/store/preferences';

/**
 * Hook to determine the active color scheme (light or dark).
 * @returns {ColorSchemeName} The active theme mode.
 */
export function useColorScheme(): ColorSchemeName {
	const nativeScheme = useNativeColorScheme();
	const themeMode = usePreferencesStore((state) => state.themeMode);

	if (themeMode === 'system') {
		return nativeScheme;
	}

	return themeMode as ColorSchemeName;
}
