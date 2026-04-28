module.exports = {
  apps: [
    {
      name: 'goshuttle-expo-lan',
      script: 'npx',
      args: 'expo start --lan --port 8081 --clear',
      cwd: '/app',
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 5000,
      env: {
        EXPO_NO_TELEMETRY: '1',
        // Add this line below to force traffic through Cloudflare:
        EXPO_PACKAGER_PROXY_URL: 'https://shuttle.goshuttle.app'
      },
    },
  ],
};