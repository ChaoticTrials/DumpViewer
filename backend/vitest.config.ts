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
    },
  },
});
