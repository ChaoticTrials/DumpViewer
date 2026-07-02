import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

const testDumpsDir = path.join(os.tmpdir(), 'dump-viewer-test-dumps');

export default defineConfig({
  test: {
    globals: true,
    exclude: ['dist/**', 'node_modules/**'],
    env: {
      DUMPS_DIR: testDumpsDir,
      // Keep the suite's ~70 requests from tripping the limiters; dedicated
      // rate-limit tests re-import the app with low limits instead.
      GENERAL_RATE_LIMIT: '10000',
      MODPACK_RATE_LIMIT: '10000',
      AUTH_FAIL_LIMIT: '1000',
      AUTH_FAIL_DELAY_MS: '0',
    },
  },
});
