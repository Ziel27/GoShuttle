module.exports = {
  apps: [
    {
      name: 'goshuttle-expo-tunnel',
      script: 'npx',
      args: 'expo start --tunnel --non-interactive --port 8081',
      cwd: '/app',
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 5000,
      env: {
        CI: '1',
        EXPO_NO_TELEMETRY: '1',
      },
    },
  ],
};
