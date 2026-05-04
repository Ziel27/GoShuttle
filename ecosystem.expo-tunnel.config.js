module.exports = {
  apps: [
    {
      name: 'goshuttle-expo-tunnel',
      script: 'npx',
      args: 'expo start --tunnel --port 8081 --clear',
      cwd: '/app',
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 5000,
      env: {
        EXPO_NO_TELEMETRY: '1',
        EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
        EXPO_PUBLIC_SOCKET_URL: process.env.EXPO_PUBLIC_SOCKET_URL
      },
    },
  ],
};
