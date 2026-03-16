import { describe, it, expect } from 'vitest';
import { categorizeFiles } from '../v1/zipParser';
import type { Manifest, DumpFile } from '../v1/types';

function mockManifest(files: Array<{ name: string; path: string }>): Manifest {
  return {
    manifest_version: 1,
    manifest_id: '00000000-0000-4000-8000-000000000000',
    settings: {},
    versions: { skyblockbuilder: '1.0', minecraft: '1.20.1' },
    files,
  };
}

function mockFile(path: string, content = '{}'): DumpFile {
  return { path, name: path.split('/').pop() ?? path, content, isBinary: false, size: content.length };
}

describe('v1 categorizeFiles', () => {
  it('finds <name> changed file → changedFormat: json5', () => {
    const manifest = mockManifest([{ name: 'test.json', path: 'config/test.json' }]);
    const files = new Map([
      ['config/test.json', mockFile('config/test.json')],
      ['config/changed_values/test.json', mockFile('config/changed_values/test.json', '{"key":"val"}')],
    ]);
    const cat = categorizeFiles(manifest, files);
    expect(cat.configs).toHaveLength(1);
    expect(cat.configs[0].changedFormat).toBe('json5');
    expect(cat.configs[0].changedPath).toBe('config/changed_values/test.json');
  });

  it('no changed file → changedFormat: null', () => {
    const manifest = mockManifest([{ name: 'test.json', path: 'config/test.json' }]);
    const files = new Map([['config/test.json', mockFile('config/test.json')]]);
    const cat = categorizeFiles(manifest, files);
    expect(cat.configs).toHaveLength(1);
    expect(cat.configs[0].changedFormat).toBe(null);
    expect(cat.configs[0].changedPath).toBe(null);
  });

  it('does not include changed_values entries in configs', () => {
    const manifest = mockManifest([
      { name: 'test.json', path: 'config/test.json' },
      { name: 'test.json', path: 'config/changed_values/test.json' },
    ]);
    const files = new Map([
      ['config/test.json', mockFile('config/test.json')],
      ['config/changed_values/test.json', mockFile('config/changed_values/test.json')],
    ]);
    const cat = categorizeFiles(manifest, files);
    expect(cat.configs).toHaveLength(1);
    expect(cat.configs[0].fullPath).toBe('config/test.json');
  });
});
