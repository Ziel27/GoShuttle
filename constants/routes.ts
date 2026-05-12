export const ROUTES = {
  tabs: '/(tabs)',
  tabsSettings: '/(tabs)/settings',
  changePassword: '/change-password',
  ticketHistory: '/ticket-history',
  authLogin: '/(auth)/login',
  authRegister: '/(auth)/register',
  authForgotPassword: '/(auth)/forgot-password',
} as const;

export type AuthEntryRoute = typeof ROUTES.authLogin | typeof ROUTES.authRegister;
