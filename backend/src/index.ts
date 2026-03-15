import 'dotenv/config';
import { app, cleanupOldDumps, getDumpsDir } from './app.js';

const PORT = process.env.PORT ?? '3001';

cleanupOldDumps(getDumpsDir());
setInterval(() => cleanupOldDumps(getDumpsDir()), 24 * 60 * 60 * 1000);

app.listen(Number(PORT), () => {
  console.log(`Server listening on port ${PORT}`);
});
