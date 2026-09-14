const express = require('express');
const path = require('path');
const { initDb } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable trust proxy for reverse proxies (Render, Cloudflare, etc.)
app.set('trust proxy', 1);

// Standard body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint for deployment monitoring
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// Initialize database
initDb();

let server = null;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`LinkVault server listening on port ${PORT}`);
  });

  const shutdown = () => {
    console.log('Shutting down server gracefully...');
    if (server) {
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = app;
