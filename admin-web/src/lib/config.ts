const rawApiUrl = import.meta.env.VITE_ADMIN_API_URL || 'http://localhost:5000/api';

export const API_BASE_URL = rawApiUrl.replace(/\/$/, '');
export const SOCKET_BASE_URL =
  import.meta.env.VITE_ADMIN_SOCKET_URL || API_BASE_URL.replace(/\/api$/, '');
