import { describe, it, expect } from 'vitest';
import { categorizeFiles } from '../v3/zipParser';
import type { Manifest } from '../v3/types';
import type { DumpFile } from '../v1/types';

function mockManifest(files: Array<{ name: string; path: string }>): Manifest {
  return {
    manifest_version: 3,
    manifest_id: '00000000-0000-4000-8000-000000000000',
    settings: {},
    versions: { skyblockbuilder: '26.1.0', minecraft: '26.1.2' },
    files,
    hashes: {},
  };
}

function mockFile(path: string, content = '{}'): DumpFile {
  return { path, name: path.split('/').pop() ?? path, content, isBinary: false, size: content.length };
}

describe('v3 categorizeFiles', () => {
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

  it('no json5 fallback in v3 — json5-style file is ignored', () => {
    const manifest = mockManifest([{ name: 'test.json', path: 'config/test.json' }]);
    const files = new Map([
      ['config/test.json', mockFile('config/test.json')],
      ['config/changed_values/test.json', mockFile('config/changed_values/test.json', '{"key":"val"}')],
    ]);
    const cat = categorizeFiles(manifest, files);
    expect(cat.configs[0].changedFormat).toBe(null);
    expect(cat.configs[0].changedPath).toBe(null);
  });

  it('categorizes a world_gen_settings.dat entry as a world file', () => {
    const manifest = mockManifest([{ name: 'world_gen_settings.dat', path: 'world_gen_settings.dat' }]);
    const files = new Map([['world_gen_settings.dat', mockFile('world_gen_settings.dat', 'WORLDGEN')]]);
    const cat = categorizeFiles(manifest, files);
    expect(cat.worldFiles).toHaveLength(1);
    expect(cat.worldFiles[0].path).toBe('world_gen_settings.dat');
  });
});
