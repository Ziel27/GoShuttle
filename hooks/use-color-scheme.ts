import { useColorScheme as useNativeColorScheme } from 'react-native';

import { usePreferencesStore } from '@/store/preferences';

export function useColorScheme() {
	const nativeScheme = useNativeColorScheme();
	const themeMode = usePreferencesStore((state) => state.themeMode);

	if (themeMode === 'system') {
		return nativeScheme;
	}

	return themeMode;
}
