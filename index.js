import 'dotenv/config';
import { monitorProductURLs } from './amazon.js';
import server from './keep_alive.js';

// Keep-alive HTTP server on port 8080 (used by Railway health checks)
server();

// Run immediately on startup, cron in amazon.js handles hourly repeats
monitorProductURLs().catch(err => console.error('Startup run failed:', err));
