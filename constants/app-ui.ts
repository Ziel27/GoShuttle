export const AppPalette = {
  navy: '#1A1A2E',
  white: '#FFFFFF',
  slateBg: '#F4F6FA',
  slateBorder: '#E5E7EB',
  slateText: '#6B7280',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  dangerMutedBackground: '#FEE8E8',
  dangerMutedBorder: '#FECACA',
  dangerStrongText: '#B42318',
  successMutedBackground: '#DFF8EE',
  darkOverlaySoft: 'rgba(26, 26, 46, 0.45)',
  darkOverlayStrong: 'rgba(26, 26, 46, 0.82)',
  dangerOverlaySoft: 'rgba(239, 68, 68, 0.14)',
  dangerOverlayMedium: 'rgba(239, 68, 68, 0.52)',
  navyOverlaySoft: 'rgba(26, 26, 46, 0.12)',
  switchTrackOff: '#9CA3AF',

  /* ---- Role-aware semantic tints ---- */
  /** Driver brand accent – used for active tint, badges, and highlights */
  driverTint: '#00A87D',
  /** Passenger brand accent – falls back to theme tint (navy/light-slate) */

  /* ---- Accent swatches (shared across tabs & home screen) ---- */
  sky: '#E8F0FF',
  mint: '#E8FCF6',
  amber: '#FFF3DC',
  indigo: '#E9EEFF',
  blush: '#FEE8E8',

  jade: '#00A87D',
  amberStrong: '#B45309',
  indigoStrong: '#3E63D3',

  /** Dark-mode accent-background variants for tab icons */
  darkSkyBg: '#222A40',
  darkAmberBg: '#3B2B1D',
  darkIndigoBg: '#242C4A',
  darkMintBg: '#1C3A34',

  /** Dark-mode tab label / icon foreground accents */
  darkAmberFg: '#F8B64C',
  darkIndigoFg: '#9EB6FF',
} as const;

/** Per-theme chip active-background (filter chips, toggles) */
export const chipActiveBg = {
  light: '#E8FCF6',
  dark: '#263944',
} as const;

export const getCapacityColor = (current: number, max: number) => {
  const ratio = max > 0 ? current / max : 0;
  if (ratio >= 1) return AppPalette.danger;
  if (ratio >= 0.7) return AppPalette.warning;
  return AppPalette.success;
};
