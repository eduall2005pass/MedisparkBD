// PM2 config for VM (app.medisparkbd.com) — runs prebuilt standalone, never builds on VM.
module.exports = {
  apps: [
    {
      name: "medispark",
      script: "./server.js",
      cwd: "/home/siam/medispark",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        HOSTNAME: "127.0.0.1",
        NEXT_PUBLIC_SITE_URL: "https://app.medisparkbd.com",
      },
      max_memory_restart: "450M",
      error_file: "/home/siam/medispark/pm2-error.log",
      out_file: "/home/siam/medispark/pm2-out.log",
      autorestart: true,
    },
  ],
};
