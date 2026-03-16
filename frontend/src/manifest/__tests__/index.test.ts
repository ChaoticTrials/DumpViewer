import { describe, it, expect } from 'vitest';
import { parseManifest } from '../index';

const baseManifest = {
  manifest_id: '00000000-0000-4000-8000-000000000000',
  settings: {},
  versions: { skyblockbuilder: '1.0', minecraft: '1.20.1' },
  files: [],
};

describe('parseManifest', () => {
  it('routes to v1 by manifest_version 1', () => {
    const raw = { ...baseManifest, manifest_version: 1 };
    const manifest = parseManifest(raw);
    expect(manifest.manifest_version).toBe(1);
  });

  it('routes to v2 by manifest_version 2', () => {
    const raw = { ...baseManifest, manifest_version: 2, hashes: {} };
    const manifest = parseManifest(raw);
    expect(manifest.manifest_version).toBe(2);
  });

  it('throws for unknown manifest_version', () => {
    expect(() => parseManifest({ ...baseManifest, manifest_version: 99 })).toThrow('Unknown manifest_version: 99');
  });

  it('throws for non-object input', () => {
    expect(() => parseManifest(null)).toThrow('manifest must be an object');
    expect(() => parseManifest('string')).toThrow('manifest must be an object');
    expect(() => parseManifest(42)).toThrow('manifest must be an object');
  });
});
