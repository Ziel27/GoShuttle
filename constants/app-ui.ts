export const AppPalette = {
  navy: '#0f172a',
  white: '#ffffff',
  slateBg: '#f8fafc',
  slateBorder: '#cbd5e1',
  slateText: '#64748b',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#f43f5e',
  dangerMutedBackground: '#fff1f2',
  dangerMutedBorder: '#fecdd3',
  dangerStrongText: '#9f1239',
  successMutedBackground: '#ecfdf5',
  darkOverlaySoft: 'rgba(15, 23, 42, 0.45)',
  darkOverlayStrong: 'rgba(15, 23, 42, 0.8)',
  dangerOverlaySoft: 'rgba(244, 63, 94, 0.14)',
  dangerOverlayMedium: 'rgba(244, 63, 94, 0.55)',
  navyOverlaySoft: 'rgba(15, 23, 42, 0.10)',
  switchTrackOff: '#94a3b8',
} as const;

export const getCapacityColor = (current: number, max: number) => {
  const ratio = max > 0 ? current / max : 0;
  if (ratio >= 1) return AppPalette.danger;
  if (ratio >= 0.7) return AppPalette.warning;
  return AppPalette.success;
};
