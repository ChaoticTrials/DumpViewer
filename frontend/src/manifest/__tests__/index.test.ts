import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { parseManifest, parseDump } from '../index';

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

  it('routes to v3 by manifest_version 3', () => {
    const raw = { ...baseManifest, manifest_version: 3, hashes: {} };
    const manifest = parseManifest(raw);
    expect(manifest.manifest_version).toBe(3);
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

async function buildDumpFile(manifest: unknown): Promise<File> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('config/test.json', '{}');
  const buffer = await zip.generateAsync({ type: 'arraybuffer' });
  return new File([buffer], 'dump.zip', { type: 'application/zip' });
}

describe('parseDump', () => {
  it('parses a valid v1 dump zip', async () => {
    const file = await buildDumpFile({ ...baseManifest, manifest_version: 1 });
    const dump = await parseDump(file);
    expect(dump.manifest.manifest_version).toBe(1);
    expect(dump.manifest.manifest_id).toBe(baseManifest.manifest_id);
    expect(dump.files.has('config/test.json')).toBe(true);
  });

  it('parses a valid v2 dump zip', async () => {
    const file = await buildDumpFile({ ...baseManifest, manifest_version: 2, hashes: {} });
    const dump = await parseDump(file);
    expect(dump.manifest.manifest_version).toBe(2);
  });

  it('parses a valid v3 dump zip', async () => {
    const file = await buildDumpFile({ ...baseManifest, manifest_version: 3, hashes: {} });
    const dump = await parseDump(file);
    expect(dump.manifest.manifest_version).toBe(3);
  });

  it('rejects an unknown manifest_version', async () => {
    const file = await buildDumpFile({ ...baseManifest, manifest_version: 99 });
    await expect(parseDump(file)).rejects.toThrow('Unknown manifest_version: 99');
  });

  it('rejects a manifest without a version', async () => {
    const file = await buildDumpFile({ ...baseManifest });
    await expect(parseDump(file)).rejects.toThrow('Unknown manifest_version: undefined');
  });

  it('rejects a zip without manifest.json', async () => {
    const zip = new JSZip();
    zip.file('config/test.json', '{}');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const file = new File([buffer], 'dump.zip', { type: 'application/zip' });
    await expect(parseDump(file)).rejects.toThrow('missing manifest.json');
  });
});
