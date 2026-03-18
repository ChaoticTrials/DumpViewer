import 'dotenv/config';
import { app, cleanupOldDumps, getDumpsDir } from './app.js';

const PORT = process.env.PORT ?? '3001';

cleanupOldDumps(getDumpsDir());
const cleanupInterval = setInterval(() => cleanupOldDumps(getDumpsDir()), 24 * 60 * 60 * 1000);

const server = app.listen(Number(PORT), () => {
  console.log(`Server listening on port ${PORT}`);
});

function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully`);
  clearInterval(cleanupInterval);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
