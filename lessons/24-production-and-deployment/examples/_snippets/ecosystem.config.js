// SNIPPET, not executed. A PM2 config file. Needs: npm install -g pm2   (PM2 is a third-party process manager)
//
//   Start / update : pm2 start ecosystem.config.js --env production
//   Zero-downtime  : pm2 reload orders-api          (restarts the cluster workers one at a time)
//   Look           : pm2 ls    pm2 logs orders-api    pm2 monit
//   Survive reboot : pm2 startup    then    pm2 save
//
// Compare with systemd and containers in the lesson: PM2 is useful on a plain server. Inside Docker or Kubernetes
// the platform already restarts and scales your process, so one `node` process per container is usually better.
module.exports = {
  apps: [
    {
      name: 'orders-api',
      script: 'dist/server.js',

      // "cluster" mode uses Node's cluster module: several workers share one port, one per CPU core with 'max'.
      exec_mode: 'cluster',
      instances: 'max',

      // Restart a worker whose memory passes this value (a safety net for a slow leak, not a cure for it).
      max_memory_restart: '400M',

      // Graceful stop: PM2 sends SIGINT, waits kill_timeout milliseconds, then sends SIGKILL.
      // So your app must handle SIGINT (and SIGTERM for other platforms) and finish within this time.
      kill_timeout: 10000,

      // With wait_ready, `pm2 reload` waits until the new worker calls process.send('ready') before stopping the old one.
      // In server.js:  server.listen(port, () => { if (process.send) process.send('ready'); });
      wait_ready: true,
      listen_timeout: 10000,

      // Crash-loop protection: stop restarting a worker that dies in less than 5 seconds, after 10 tries.
      min_uptime: '5s',
      max_restarts: 10,

      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production', PORT: 3000 },
    },
  ],
};
