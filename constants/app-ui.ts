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

  /* ---- Role-aware semantic tints ---- */
  /** Driver brand accent – used for active tint, badges, and highlights */
  driverTint: '#047857',
  /** Passenger brand accent – falls back to theme tint (navy/light-slate) */

  /* ---- Accent swatches (shared across tabs & home screen) ---- */
  sky: '#e0f2fe',
  mint: '#dcfce7',
  amber: '#fef3c7',
  indigo: '#e0e7ff',
  blush: '#ffe4e6',

  jade: '#047857',
  amberStrong: '#92400e',
  indigoStrong: '#3730a3',

  /** Dark-mode accent-background variants for tab icons */
  darkSkyBg: '#1e293b',
  darkAmberBg: '#3f2f14',
  darkIndigoBg: '#1f2548',
  darkMintBg: '#113b2c',

  /** Dark-mode tab label / icon foreground accents */
  darkAmberFg: '#fbbf24',
  darkIndigoFg: '#a5b4fc',
} as const;

/** Per-theme chip active-background (filter chips, toggles) */
export const chipActiveBg = {
  light: '#e2e8f0',
  dark: '#1e293b',
} as const;

export const getCapacityColor = (current: number, max: number) => {
  const ratio = max > 0 ? current / max : 0;
  if (ratio >= 1) return AppPalette.danger;
  if (ratio >= 0.7) return AppPalette.warning;
  return AppPalette.success;
};
