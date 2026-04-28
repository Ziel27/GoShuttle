module.exports = {
  apps: [
    {
      name: 'goshuttle-expo-lan',
      script: 'npx',
      args: 'expo start --lan --host lan --port 8081 --clear',
      cwd: '/app',
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 5000,
      env: {
        EXPO_NO_TELEMETRY: '1',
      },
    },
  ],
};
