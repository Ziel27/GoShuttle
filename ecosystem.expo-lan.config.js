module.exports = {
  apps: [
    {
      name: 'goshuttle-expo-lan',
      script: 'npx',
      // Changed --lan to --offline to bypass the Expo server login prompt
      args: 'expo start --offline --port 8081 --clear',
      cwd: '/app',
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 5000,
      env: {
        EXPO_NO_TELEMETRY: '1',
        EXPO_PACKAGER_PROXY_URL: 'https://shuttle.goshuttle.app',
        EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL || 'https://api.goshuttle.app/api',
        EXPO_PUBLIC_SOCKET_URL: process.env.EXPO_PUBLIC_SOCKET_URL || 'https://api.goshuttle.app'
      },
    },
  ],
};