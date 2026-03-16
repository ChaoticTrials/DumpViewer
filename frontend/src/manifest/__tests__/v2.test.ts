import { describe, it, expect } from 'vitest';
import { categorizeFiles } from '../v2/zipParser';
import type { Manifest } from '../v2/types';
import type { DumpFile } from '../v1/types';

function mockManifest(files: Array<{ name: string; path: string }>): Manifest {
  return {
    manifest_version: 2,
    manifest_id: '00000000-0000-4000-8000-000000000000',
    settings: {},
    versions: { skyblockbuilder: '2.0', minecraft: '1.21.1' },
    files,
    hashes: {},
  };
}

function mockFile(path: string, content = '{}'): DumpFile {
  return { path, name: path.split('/').pop() ?? path, content, isBinary: false, size: content.length };
}

describe('v2 categorizeFiles', () => {
  it('finds .diff file → changedFormat: diff', () => {
    const manifest = mockManifest([{ name: 'test.json', path: 'config/test.json' }]);
    const files = new Map([
      ['config/test.json', mockFile('config/test.json')],
      ['config/changed_values/test.diff', mockFile('config/changed_values/test.diff', '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new')],
    ]);
    const cat = categorizeFiles(manifest, files);
    expect(cat.configs).toHaveLength(1);
    expect(cat.configs[0].changedFormat).toBe('diff');
    expect(cat.configs[0].changedPath).toBe('config/changed_values/test.diff');
  });

  it('no .diff file → changedFormat: null', () => {
    const manifest = mockManifest([{ name: 'test.json', path: 'config/test.json' }]);
    const files = new Map([['config/test.json', mockFile('config/test.json')]]);
    const cat = categorizeFiles(manifest, files);
    expect(cat.configs).toHaveLength(1);
    expect(cat.configs[0].changedFormat).toBe(null);
    expect(cat.configs[0].changedPath).toBe(null);
  });

  it('no json5 fallback in v2 — json5-style file is ignored', () => {
    // Even if a v1-style changed_values/<name> file exists, v2 should NOT pick it up
    const manifest = mockManifest([{ name: 'test.json', path: 'config/test.json' }]);
    const files = new Map([
      ['config/test.json', mockFile('config/test.json')],
      // This is a v1-style file — v2 should ignore it (looks for .diff only)
      ['config/changed_values/test.json', mockFile('config/changed_values/test.json', '{"key":"val"}')],
    ]);
    const cat = categorizeFiles(manifest, files);
    expect(cat.configs[0].changedFormat).toBe(null);
    expect(cat.configs[0].changedPath).toBe(null);
  });

  it('strips extension correctly for multi-segment names', () => {
    const manifest = mockManifest([{ name: 'my.config.json', path: 'config/my.config.json' }]);
    const files = new Map([
      ['config/my.config.json', mockFile('config/my.config.json')],
      ['config/changed_values/my.config.diff', mockFile('config/changed_values/my.config.diff', '--- diff content')],
    ]);
    const cat = categorizeFiles(manifest, files);
    expect(cat.configs[0].changedFormat).toBe('diff');
    expect(cat.configs[0].changedPath).toBe('config/changed_values/my.config.diff');
  });
});
