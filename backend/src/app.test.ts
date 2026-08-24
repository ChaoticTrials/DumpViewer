import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { Express } from 'express';

// app.ts fetches imports through undici (for the DNS-pinning dispatcher).
// Delegate undici.fetch to globalThis.fetch so vi.stubGlobal('fetch', ...)
// keeps intercepting import requests in these tests.
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return {
    ...actual,
    fetch: (input: unknown, init: unknown) => (globalThis.fetch as (i: unknown, o: unknown) => Promise<Response>)(input, init),
  };
});
import request from 'supertest';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// DUMPS_DIR is set via vitest.config.ts env before module load
import {
  app,
  getDumpsDir,
  isSafeUrl,
  isForbiddenIp,
  safeLookup,
  isValidId,
  validateAndExtractManifestId,
  extractManifestInfo,
  cleanupOldDumps,
  parseTtlMs,
  parseDumpName,
  parseDumpLink,
  generateDeleteKey,
  resolveDeleteKey,
} from './app.js';

// The test dumps directory is whatever app.ts resolved at module load time
const TEST_DUMPS_DIR = getDumpsDir();

// Re-import app.ts as a fresh module so its rate-limit buckets and
// env-derived constants start from scratch. Used by tests that must not
// spend the shared upload budget, and by the limiter tests themselves.
async function freshApp(env: Record<string, string>): Promise<Express> {
  Object.assign(process.env, env);
  vi.resetModules();
  const mod = await import('./app.js');
  return mod.app;
}

beforeAll(() => {
  fs.mkdirSync(TEST_DUMPS_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TEST_DUMPS_DIR, { recursive: true, force: true });
});

// --- Helper: build a valid SBB zip buffer ---
function buildValidSbbZip(manifestId: string, extraVersions: Record<string, string> = {}): Buffer {
  const zip = new AdmZip();
  const manifest = {
    manifest_version: 1,
    manifest_id: manifestId,
    settings: {},
    versions: {
      skyblockbuilder: '1.0',
      minecraft: '1.20.1',
      ...extraVersions,
    },
    files: [],
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf-8'));
  return zip.toBuffer();
}

// --- Helper: build a valid v2 SBB zip buffer with hashes ---
function buildValidSbbZipV2(manifestId: string): Buffer {
  const zip = new AdmZip();
  const manifest = {
    manifest_version: 2,
    manifest_id: manifestId,
    settings: {},
    versions: {
      skyblockbuilder: '2.0',
      minecraft: '1.21.1',
    },
    files: [],
    hashes: {
      somemod: { md5: 'abc123', sha1: 'def456', sha512: 'ghi789' },
    },
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf-8'));
  return zip.toBuffer();
}

// --- Helper: build a zip without manifest.json ---
function buildZipNoManifest(): Buffer {
  const zip = new AdmZip();
  zip.addFile('some-other-file.txt', Buffer.from('hello', 'utf-8'));
  return zip.toBuffer();
}

// --- Helper: build a zip with manifest.json missing manifest_id ---
function buildZipBadManifest(): Buffer {
  const zip = new AdmZip();
  const manifest = { manifest_version: 1 }; // missing manifest_id, versions, files
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf-8'));
  return zip.toBuffer();
}

// ============================================================
// Health check
// ============================================================

describe('GET /health', () => {
  it('returns 200 { ok: true }', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

// ============================================================
// isSafeUrl() unit tests
// ============================================================

describe('isSafeUrl()', () => {
  it('rejects loopback 127.x.x.x', () => {
    expect(isSafeUrl('http://127.0.0.1/')).toBe(false);
    expect(isSafeUrl('http://127.1.2.3/')).toBe(false);
  });

  it('rejects localhost', () => {
    expect(isSafeUrl('http://localhost/')).toBe(false);
  });

  it('rejects RFC 1918 addresses', () => {
    expect(isSafeUrl('http://10.0.0.1/')).toBe(false);
    expect(isSafeUrl('http://192.168.1.1/')).toBe(false);
    expect(isSafeUrl('http://172.16.0.1/')).toBe(false);
    expect(isSafeUrl('http://172.31.255.255/')).toBe(false);
  });

  it('rejects IPv6 loopback ::1', () => {
    expect(isSafeUrl('http://[::1]/')).toBe(false);
  });

  it('rejects IPv6 ULA (fc/fd prefix)', () => {
    expect(isSafeUrl('http://[fc00::1]/')).toBe(false);
    expect(isSafeUrl('http://[fd00::1]/')).toBe(false);
  });

  it('rejects IPv4-mapped IPv6 (::ffff:...)', () => {
    expect(isSafeUrl('http://[::ffff:127.0.0.1]/')).toBe(false);
    expect(isSafeUrl('http://[::ffff:10.0.0.1]/')).toBe(false);
  });

  it('rejects non-http/https schemes', () => {
    expect(isSafeUrl('ftp://example.com/')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
  });

  it('allows public http/https URLs', () => {
    expect(isSafeUrl('https://example.com/dump.zip')).toBe(true);
    expect(isSafeUrl('http://8.8.8.8/dump.zip')).toBe(true);
  });
});

// ============================================================
// isForbiddenIp() unit tests (DNS rebinding protection)
// ============================================================

describe('isForbiddenIp()', () => {
  it('rejects IPv4 loopback and unspecified', () => {
    expect(isForbiddenIp('127.0.0.1')).toBe(true);
    expect(isForbiddenIp('127.255.255.255')).toBe(true);
    expect(isForbiddenIp('0.0.0.0')).toBe(true);
  });

  it('rejects link-local / cloud metadata', () => {
    expect(isForbiddenIp('169.254.169.254')).toBe(true);
    expect(isForbiddenIp('169.254.0.1')).toBe(true);
  });

  it('rejects RFC 1918 ranges', () => {
    expect(isForbiddenIp('10.0.0.1')).toBe(true);
    expect(isForbiddenIp('192.168.1.1')).toBe(true);
    expect(isForbiddenIp('172.16.0.1')).toBe(true);
    expect(isForbiddenIp('172.31.255.255')).toBe(true);
  });

  it('rejects IPv6 loopback, unspecified, ULA and link-local', () => {
    expect(isForbiddenIp('::1')).toBe(true);
    expect(isForbiddenIp('::')).toBe(true);
    expect(isForbiddenIp('fc00::1')).toBe(true);
    expect(isForbiddenIp('fd12:3456::1')).toBe(true);
    expect(isForbiddenIp('fe80::1')).toBe(true);
  });

  it('rejects IPv4-mapped IPv6', () => {
    expect(isForbiddenIp('::ffff:127.0.0.1')).toBe(true);
    expect(isForbiddenIp('::ffff:7f00:1')).toBe(true);
  });

  it('allows public addresses', () => {
    expect(isForbiddenIp('8.8.8.8')).toBe(false);
    expect(isForbiddenIp('93.184.215.14')).toBe(false);
    expect(isForbiddenIp('2606:4700::6810:84e5')).toBe(false);
    expect(isForbiddenIp('172.32.0.1')).toBe(false); // just outside 172.16/12
  });
});

// ============================================================
// safeLookup() — DNS resolution pinning for import fetches
// ============================================================

describe('safeLookup()', () => {
  it('rejects hostnames that resolve to a forbidden address', async () => {
    // localhost resolves to 127.0.0.1/::1 via the hosts file, no network needed
    await expect(
      new Promise((resolve, reject) => {
        safeLookup('localhost', { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)));
      }),
    ).rejects.toThrow(/not allowed/);
  });
});

// ============================================================
// isValidId() unit tests
// ============================================================

describe('isValidId()', () => {
  it('accepts a valid UUID v4 (lowercase)', () => {
    expect(isValidId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects v1 UUID (version digit 1)', () => {
    expect(isValidId('550e8400-e29b-11d4-a716-446655440000')).toBe(false);
  });

  it('rejects v3 UUID (version digit 3)', () => {
    expect(isValidId('550e8400-e29b-31d4-a716-446655440000')).toBe(false);
  });

  it('rejects wrong variant (not [89ab])', () => {
    expect(isValidId('550e8400-e29b-41d4-1716-446655440000')).toBe(false);
  });

  it('rejects uppercase UUID', () => {
    expect(isValidId('550E8400-E29B-41D4-A716-446655440000')).toBe(false);
  });

  it('rejects too-short string', () => {
    expect(isValidId('550e8400-e29b-41d4-a716')).toBe(false);
  });
});

// ============================================================
// parseTtlMs() unit tests
// ============================================================

describe('parseTtlMs()', () => {
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  it('defaults to 1 year for missing value', () => {
    expect(parseTtlMs(undefined)).toBe(ONE_YEAR_MS);
  });

  it('defaults to 1 year for invalid string', () => {
    expect(parseTtlMs('abc')).toBe(ONE_YEAR_MS);
  });

  it('defaults to 1 year for zero or negative', () => {
    expect(parseTtlMs(0)).toBe(ONE_YEAR_MS);
    expect(parseTtlMs(-100)).toBe(ONE_YEAR_MS);
  });

  it('converts valid seconds to ms', () => {
    expect(parseTtlMs(3600)).toBe(3600 * 1000);
  });

  it('accepts a string number', () => {
    expect(parseTtlMs('7200')).toBe(7200 * 1000);
  });

  it('clamps values above 1 year to 1 year', () => {
    expect(parseTtlMs(999_999_999)).toBe(ONE_YEAR_MS);
  });
});

// ============================================================
// parseDumpName() unit tests
// ============================================================

describe('parseDumpName()', () => {
  it('maps null/undefined to null', () => {
    expect(parseDumpName(null)).toEqual({ ok: true, value: null });
    expect(parseDumpName(undefined)).toEqual({ ok: true, value: null });
  });

  it('maps an empty or whitespace-only string to null', () => {
    expect(parseDumpName('')).toEqual({ ok: true, value: null });
    expect(parseDumpName('   ')).toEqual({ ok: true, value: null });
    expect(parseDumpName('\t \t')).toEqual({ ok: true, value: null });
  });

  it('trims surrounding whitespace', () => {
    expect(parseDumpName('  Issue #412  ')).toEqual({ ok: true, value: 'Issue #412' });
  });

  it('accepts Unicode and emoji', () => {
    expect(parseDumpName('Ärger mit Inseln 🏝️')).toEqual({ ok: true, value: 'Ärger mit Inseln 🏝️' });
    expect(parseDumpName('スカイブロック')).toEqual({ ok: true, value: 'スカイブロック' });
  });

  it('accepts exactly 256 characters and rejects 257', () => {
    expect(parseDumpName('a'.repeat(256))).toEqual({ ok: true, value: 'a'.repeat(256) });
    const tooLong = parseDumpName('a'.repeat(257));
    expect(tooLong.ok).toBe(false);
  });

  it('measures length after trimming', () => {
    const padded = `  ${'a'.repeat(256)}  `;
    expect(parseDumpName(padded)).toEqual({ ok: true, value: 'a'.repeat(256) });
  });

  it('rejects non-string types', () => {
    expect(parseDumpName(42).ok).toBe(false);
    expect(parseDumpName(true).ok).toBe(false);
    expect(parseDumpName({}).ok).toBe(false);
    expect(parseDumpName(['a']).ok).toBe(false);
  });

  it('rejects C0/C1 control characters', () => {
    expect(parseDumpName('line1\nline2').ok).toBe(false);
    expect(parseDumpName('a\rb').ok).toBe(false);
    expect(parseDumpName('a\tb').ok).toBe(false);
    expect(parseDumpName('a\u0000b').ok).toBe(false);
    expect(parseDumpName('a\u000bb').ok).toBe(false);
    expect(parseDumpName('a\u001bb').ok).toBe(false);
    expect(parseDumpName('a\u0085b').ok).toBe(false); // C1 NEXT LINE
    expect(parseDumpName('a\u009bb').ok).toBe(false); // C1 CSI
  });

  it('rejects bidi control and zero-width characters', () => {
    expect(parseDumpName('a\u202eb').ok).toBe(false); // RIGHT-TO-LEFT OVERRIDE
    expect(parseDumpName('a\u200bb').ok).toBe(false); // ZERO WIDTH SPACE
    expect(parseDumpName('a\u200fb').ok).toBe(false); // RIGHT-TO-LEFT MARK
    expect(parseDumpName('a\u2066b').ok).toBe(false); // LEFT-TO-RIGHT ISOLATE
    expect(parseDumpName('a\ufeffb').ok).toBe(false); // ZERO WIDTH NO-BREAK SPACE
  });

  it('returns an error message when rejecting', () => {
    const res = parseDumpName('a'.repeat(257));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(typeof res.error).toBe('string');
  });
});

// ============================================================
// parseDumpLink() unit tests
// ============================================================

describe('parseDumpLink()', () => {
  it('accepts http and https URLs', () => {
    expect(parseDumpLink('https://github.com/o/r/issues/412')).toEqual({
      ok: true,
      value: 'https://github.com/o/r/issues/412',
    });
    expect(parseDumpLink('http://example.com/x')).toEqual({ ok: true, value: 'http://example.com/x' });
  });

  it('maps null/undefined/empty/whitespace to null', () => {
    expect(parseDumpLink(null)).toEqual({ ok: true, value: null });
    expect(parseDumpLink(undefined)).toEqual({ ok: true, value: null });
    expect(parseDumpLink('')).toEqual({ ok: true, value: null });
    expect(parseDumpLink('   ')).toEqual({ ok: true, value: null });
  });

  it('trims surrounding whitespace', () => {
    expect(parseDumpLink('  https://example.com/x  ')).toEqual({ ok: true, value: 'https://example.com/x' });
  });

  it('rejects non-http(s) schemes', () => {
    expect(parseDumpLink('javascript:alert(1)').ok).toBe(false);
    expect(parseDumpLink('data:text/html,<script>alert(1)</script>').ok).toBe(false);
    expect(parseDumpLink('file:///etc/passwd').ok).toBe(false);
    expect(parseDumpLink('ftp://example.com/x').ok).toBe(false);
  });

  it('rejects strings that are not URLs', () => {
    expect(parseDumpLink('example.com/x').ok).toBe(false);
    expect(parseDumpLink('not a url').ok).toBe(false);
  });

  it('accepts exactly 2048 characters and rejects 2049', () => {
    const prefix = 'https://example.com/';
    const ok = prefix + 'a'.repeat(2048 - prefix.length);
    expect(ok.length).toBe(2048);
    expect(parseDumpLink(ok)).toEqual({ ok: true, value: ok });
    expect(parseDumpLink(ok + 'a').ok).toBe(false);
  });

  it('rejects non-string types', () => {
    expect(parseDumpLink(42).ok).toBe(false);
    expect(parseDumpLink({}).ok).toBe(false);
  });

  it('accepts localhost and private addresses that isSafeUrl rejects (link is never fetched)', () => {
    expect(parseDumpLink('http://localhost:3000/issues/1')).toEqual({ ok: true, value: 'http://localhost:3000/issues/1' });
    expect(isSafeUrl('http://localhost:3000/issues/1')).toBe(false);

    expect(parseDumpLink('http://10.0.0.5/x')).toEqual({ ok: true, value: 'http://10.0.0.5/x' });
    expect(isSafeUrl('http://10.0.0.5/x')).toBe(false);
  });
});

// ============================================================
// validateAndExtractManifestId() unit tests
// ============================================================

describe('validateAndExtractManifestId()', () => {
  it('extracts manifest_id from a valid v1 zip', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const buf = buildValidSbbZip(id);
    expect(validateAndExtractManifestId(buf)).toBe(id);
  });

  it('accepts a v2 manifest with hashes', () => {
    const id = '550e8400-e29b-41d4-a716-446655440001';
    const buf = buildValidSbbZipV2(id);
    expect(validateAndExtractManifestId(buf)).toBe(id);
  });

  it('throws on oversized manifest.json (>10 MB)', () => {
    const zip = new AdmZip();
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x20); // 10 MB + 1 byte
    zip.addFile('manifest.json', big);
    expect(() => validateAndExtractManifestId(zip.toBuffer())).toThrow('manifest.json exceeds size limit');
  });

  it('rejects a manifest.json whose header declares an oversized entry without decompressing it', () => {
    // Tamper the central-directory uncompressed-size field to claim >10 MB
    // while the actual data stays tiny — only a header pre-check catches this.
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from('{}', 'utf-8'));
    const buf = zip.toBuffer();
    const cdOffset = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(cdOffset).toBeGreaterThan(-1);
    buf.writeUInt32LE(11 * 1024 * 1024, cdOffset + 24); // uncompressed size field
    expect(new AdmZip(buf).getEntry('manifest.json')!.header.size).toBe(11 * 1024 * 1024);
    expect(() => validateAndExtractManifestId(buf)).toThrow('manifest.json exceeds size limit');
  });

  it('throws when manifest_id is not a UUID v4', () => {
    const zip = new AdmZip();
    const manifest = {
      manifest_version: 1,
      manifest_id: 'not-a-uuid',
      versions: { skyblockbuilder: '1.0', minecraft: '1.20.1' },
      files: [],
    };
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf-8'));
    expect(() => validateAndExtractManifestId(zip.toBuffer())).toThrow('manifest_id must be a valid UUID v4');
  });

  it('throws when versions.skyblockbuilder is missing', () => {
    const zip = new AdmZip();
    const manifest = {
      manifest_version: 1,
      manifest_id: '550e8400-e29b-41d4-a716-446655440000',
      versions: { minecraft: '1.20.1' }, // no skyblockbuilder
      files: [],
    };
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf-8'));
    expect(() => validateAndExtractManifestId(zip.toBuffer())).toThrow(
      'Not a valid Skyblock Builder dump: missing versions.skyblockbuilder',
    );
  });
});

describe('extractManifestInfo()', () => {
  it('extracts manifest version and all mod versions from a v1 zip', () => {
    const buf = buildValidSbbZip('550e8400-e29b-41d4-a716-446655440000', { forge: '47.1.0', libx: '1.20.1-5.0.12' });
    const info = extractManifestInfo(buf);
    expect(info.manifestVersion).toBe(1);
    expect(info.versions).toEqual({
      skyblockbuilder: '1.0',
      minecraft: '1.20.1',
      forge: '47.1.0',
      libx: '1.20.1-5.0.12',
    });
    expect(info.hashes).toBeUndefined();
  });

  it('extracts hashes alongside versions from a v2 zip', () => {
    const buf = buildValidSbbZipV2('550e8400-e29b-41d4-a716-446655440001');
    const info = extractManifestInfo(buf);
    expect(info.manifestVersion).toBe(2);
    expect(info.versions).toEqual({ skyblockbuilder: '2.0', minecraft: '1.21.1' });
    expect(info.hashes).toEqual({ somemod: { md5: 'abc123', sha1: 'def456', sha512: 'ghi789' } });
  });

  it('ignores non-string values in versions', () => {
    const zip = new AdmZip();
    const manifest = {
      manifest_version: 1,
      versions: { skyblockbuilder: '1.0', minecraft: '1.20.1', weird: 42 },
    };
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf-8'));
    expect(extractManifestInfo(zip.toBuffer()).versions).toEqual({ skyblockbuilder: '1.0', minecraft: '1.20.1' });
  });

  it('returns null fields for a buffer that is not a zip', () => {
    expect(extractManifestInfo(Buffer.from('not a zip'))).toEqual({ manifestVersion: null, versions: null });
  });

  it('returns null fields for a zip without manifest.json', () => {
    expect(extractManifestInfo(buildZipNoManifest())).toEqual({ manifestVersion: null, versions: null });
  });
});

// ============================================================
// GET /api/dump/:id
// ============================================================

describe('GET /api/dump/:id', () => {
  it('returns 404 for a non-existent id', async () => {
    const res = await request(app).get('/api/dump/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for an id with special characters', async () => {
    // Express URL-encodes slashes, so use a query-parameter-style attack
    const res = await request(app).get('/api/dump/..%2Fetc%2Fpasswd');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ============================================================
// POST /api/dump/upload
// ============================================================

describe('POST /api/dump/upload', () => {
  it('returns 400 when no file is attached', async () => {
    const res = await request(app).post('/api/dump/upload');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 422 when the uploaded buffer is not a valid zip', async () => {
    const res = await request(app).post('/api/dump/upload').attach('file', Buffer.from('this is not a zip'), 'bad.zip');
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 422 when zip has no manifest.json', async () => {
    const buf = buildZipNoManifest();
    const res = await request(app).post('/api/dump/upload').attach('file', buf, 'dump.zip');
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 422 when manifest.json is missing required fields', async () => {
    const buf = buildZipBadManifest();
    const res = await request(app).post('/api/dump/upload').attach('file', buf, 'dump.zip');
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 200 { id, deleteKey } for a valid SBB dump zip', async () => {
    const manifestId = '550e8400-e29b-41d4-a716-446655440000';
    const buf = buildValidSbbZip(manifestId);
    const res = await request(app)
      .post('/api/dump/upload')
      .field('name', '  My Dump  ')
      .field('link', '  https://github.com/o/r/issues/412  ')
      .attach('file', buf, 'dump.zip');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', manifestId);
    expect(res.body).toHaveProperty('deleteKey');
    expect(typeof res.body.deleteKey).toBe('string');
    expect(res.body.deleteKey.length).toBeGreaterThan(0);

    // Verify the file was written to disk
    const stored = path.join(TEST_DUMPS_DIR, `${manifestId}.zip`);
    expect(fs.existsSync(stored)).toBe(true);

    // Verify the meta sidecar records the manifest info at upload time
    const meta = JSON.parse(fs.readFileSync(path.join(TEST_DUMPS_DIR, `${manifestId}.meta`), 'utf-8')) as Record<string, unknown>;
    expect(meta['manifestVersion']).toBe(1);
    expect(meta['versions']).toEqual({ skyblockbuilder: '1.0', minecraft: '1.20.1' });
    expect(typeof meta['createdAt']).toBe('number');
    expect(typeof meta['expiresAt']).toBe('number');

    // Optional name/link fields are trimmed and stored in the sidecar
    expect(meta['name']).toBe('My Dump');
    expect(meta['link']).toBe('https://github.com/o/r/issues/412');
  });
});

// ============================================================
// GET /api/dump/:id — after a successful upload
// ============================================================

describe('GET /api/dump/:id (after upload)', () => {
  const manifestId = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';

  beforeAll(async () => {
    const buf = buildValidSbbZip(manifestId);
    await request(app).post('/api/dump/upload').attach('file', buf, 'dump.zip');
  });

  it('returns 200 with application/zip content-type', async () => {
    const res = await request(app).get(`/api/dump/${manifestId}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/zip/);
  });

  it('includes X-Expires-At and Expires headers after upload', async () => {
    const res = await request(app).get(`/api/dump/${manifestId}`);
    expect(res.status).toBe(200);
    expect(res.headers['x-expires-at']).toBeDefined();
    const expiresAt = new Date(res.headers['x-expires-at'] as string);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(res.headers['expires']).toBeDefined();
    const expires = new Date(res.headers['expires'] as string);
    expect(expires.getTime()).toBeGreaterThan(Date.now());
  });
});

// ============================================================
// GET /api/dump/:id/manifest
// ============================================================

describe('GET /api/dump/:id/manifest', () => {
  const manifestId = 'b2c3d4e5-f6a7-4890-bc12-de3456fa7890';

  beforeAll(() => {
    // Write directly to disk to avoid hitting the upload rate limiter
    const buf = buildValidSbbZipV2(manifestId);
    const zipPath = path.join(TEST_DUMPS_DIR, `${manifestId}.zip`);
    fs.writeFileSync(zipPath, buf);
    fs.writeFileSync(
      path.join(TEST_DUMPS_DIR, `${manifestId}.meta`),
      JSON.stringify({ expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 }),
    );
  });

  it('returns parsed manifest JSON for a stored dump', async () => {
    const res = await request(app).get(`/api/dump/${manifestId}/manifest`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('manifest_id', manifestId);
    expect(res.body).toHaveProperty('manifest_version', 2);
    expect(res.body).toHaveProperty('hashes');
    expect(res.body.hashes).toHaveProperty('somemod');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get('/api/dump/00000000-0000-4000-8000-000000000099/manifest');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for an invalid id', async () => {
    const res = await request(app).get('/api/dump/not-a-uuid/manifest');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ============================================================
// POST /api/dump/import
// ============================================================

describe('POST /api/dump/import', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 400 when url field is missing', async () => {
    const res = await request(app).post('/api/dump/import').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when url fails isSafeUrl check (loopback)', async () => {
    const res = await request(app).post('/api/dump/import').send({ url: 'http://127.0.0.1/' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 200 { id, deleteKey } on success (mocked fetch)', async () => {
    const validId = '550e8400-e29b-41d4-a716-446655440002';
    const zipBuf = buildValidSbbZip(validId);
    let sent = false;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: new Uint8Array(zipBuf) };
          },
          cancel: vi.fn(),
        }),
      },
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app)
      .post('/api/dump/import')
      .send({ url: 'https://example.com/dump.zip', name: '  Imported dump  ', link: '  https://example.com/issue/1  ' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', validId);
    expect(res.body).toHaveProperty('deleteKey');
    expect(typeof res.body.deleteKey).toBe('string');
    expect(res.body.deleteKey.length).toBeGreaterThan(0);

    // Optional name/link fields are trimmed and stored in the sidecar
    const meta = JSON.parse(fs.readFileSync(path.join(TEST_DUMPS_DIR, `${validId}.meta`), 'utf-8')) as Record<string, unknown>;
    expect(meta['name']).toBe('Imported dump');
    expect(meta['link']).toBe('https://example.com/issue/1');
  });
});

// ============================================================
// DELETE /api/dump/:id
// ============================================================

describe('DELETE /api/dump/:id', () => {
  it('returns 400 on invalid id format', async () => {
    const res = await request(app).delete('/api/dump/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 on unknown id', async () => {
    const res = await request(app).delete('/api/dump/00000000-0000-4000-8000-000000000001');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 204 on successful delete and file is removed from disk', async () => {
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const buf = buildValidSbbZip(id);
    fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${id}.zip`), buf);

    const res = await request(app).delete(`/api/dump/${id}`);
    expect(res.status).toBe(204);
    expect(fs.existsSync(path.join(TEST_DUMPS_DIR, `${id}.zip`))).toBe(false);
  });
});

// ============================================================
// PATCH /api/dump/:id
// (all fixtures written straight to disk — no upload budget spent)
// ============================================================

describe('PATCH /api/dump/:id', () => {
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  function zipPathOf(id: string): string {
    return path.join(TEST_DUMPS_DIR, `${id}.zip`);
  }

  function metaPathOf(id: string): string {
    return path.join(TEST_DUMPS_DIR, `${id}.meta`);
  }

  function readMeta(id: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(metaPathOf(id), 'utf-8')) as Record<string, unknown>;
  }

  // Seed a dump on disk. `meta === null` writes no sidecar at all.
  function seed(id: string, meta: Record<string, unknown> | null = {}): void {
    fs.writeFileSync(zipPathOf(id), buildValidSbbZip(id));
    if (meta === null) return;
    fs.writeFileSync(metaPathOf(id), JSON.stringify({ expiresAt: Date.now() + ONE_YEAR_MS, createdAt: Date.now(), ...meta }));
  }

  it('returns 400 for an invalid id', async () => {
    const res = await request(app).patch('/api/dump/not-a-uuid').send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 for an unknown uuid', async () => {
    const res = await request(app).patch('/api/dump/00000000-0000-4000-8000-0000000000ff').send({ name: 'x' });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when neither name nor link is present', async () => {
    const id = '9a000000-0000-4000-8000-000000000001';
    seed(id);
    const res = await request(app).patch(`/api/dump/${id}`).send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('sets both fields and echoes the stored values', async () => {
    const id = '9a000000-0000-4000-8000-000000000002';
    seed(id);
    const res = await request(app).patch(`/api/dump/${id}`).send({ name: 'Issue #412', link: 'https://github.com/o/r/issues/412' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, name: 'Issue #412', link: 'https://github.com/o/r/issues/412' });

    const meta = readMeta(id);
    expect(meta['name']).toBe('Issue #412');
    expect(meta['link']).toBe('https://github.com/o/r/issues/412');
  });

  it('preserves every other sidecar field', async () => {
    const id = '9a000000-0000-4000-8000-000000000003';
    const createdAt = Date.parse('2025-05-01T00:00:00.000Z');
    const expiresAt = createdAt + ONE_YEAR_MS;
    const hashes = { somemod: { md5: 'abc', sha1: 'def', sha512: 'ghi' } };
    const versions = { skyblockbuilder: '1.0', minecraft: '1.20.1' };
    fs.writeFileSync(zipPathOf(id), buildValidSbbZip(id));
    fs.writeFileSync(metaPathOf(id), JSON.stringify({ expiresAt, createdAt, manifestVersion: 1, versions, hashes }));

    const res = await request(app).patch(`/api/dump/${id}`).send({ name: 'Only the name' });
    expect(res.status).toBe(200);

    const meta = readMeta(id);
    expect(meta['expiresAt']).toBe(expiresAt);
    expect(meta['createdAt']).toBe(createdAt);
    expect(meta['manifestVersion']).toBe(1);
    expect(meta['versions']).toEqual(versions);
    expect(meta['hashes']).toEqual(hashes);
    expect(meta['name']).toBe('Only the name');
  });

  it('applies a partial update, leaving the omitted field untouched', async () => {
    const id = '9a000000-0000-4000-8000-000000000004';
    seed(id, { name: 'Keep me', link: 'https://example.com/old' });

    const res = await request(app).patch(`/api/dump/${id}`).send({ link: 'https://example.com/new' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, name: 'Keep me', link: 'https://example.com/new' });
    expect(readMeta(id)['name']).toBe('Keep me');
  });

  it('clears a field via null and removes the key from the sidecar', async () => {
    const id = '9a000000-0000-4000-8000-000000000005';
    seed(id, { name: 'Bye', link: 'https://example.com/x' });

    const res = await request(app).patch(`/api/dump/${id}`).send({ name: null });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, name: null, link: 'https://example.com/x' });

    const meta = readMeta(id);
    expect('name' in meta).toBe(false);
    expect(meta['link']).toBe('https://example.com/x');
  });

  it('clears a field via an empty string and removes the key from the sidecar', async () => {
    const id = '9a000000-0000-4000-8000-000000000006';
    seed(id, { name: 'Bye', link: 'https://example.com/x' });

    const res = await request(app).patch(`/api/dump/${id}`).send({ link: '' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, name: 'Bye', link: null });

    const meta = readMeta(id);
    expect('link' in meta).toBe(false);
    expect(meta['name']).toBe('Bye');
  });

  it('trims whitespace before saving', async () => {
    const id = '9a000000-0000-4000-8000-000000000007';
    seed(id);

    const res = await request(app).patch(`/api/dump/${id}`).send({ name: '   Trimmed   ', link: '  https://example.com/y  ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, name: 'Trimmed', link: 'https://example.com/y' });
    expect(readMeta(id)['name']).toBe('Trimmed');
    expect(readMeta(id)['link']).toBe('https://example.com/y');
  });

  it('returns 400 for a 257-character name and leaves the sidecar byte-identical', async () => {
    const id = '9a000000-0000-4000-8000-000000000008';
    seed(id, { name: 'Original' });
    const before = fs.readFileSync(metaPathOf(id));

    const res = await request(app)
      .patch(`/api/dump/${id}`)
      .send({ name: 'a'.repeat(257) });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(fs.readFileSync(metaPathOf(id))).toEqual(before);
  });

  it('accepts a 256-character name', async () => {
    const id = '9a000000-0000-4000-8000-000000000009';
    seed(id);
    const res = await request(app)
      .patch(`/api/dump/${id}`)
      .send({ name: 'a'.repeat(256) });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('a'.repeat(256));
  });

  it('returns 400 for a javascript: link and leaves the sidecar byte-identical', async () => {
    const id = '9a000000-0000-4000-8000-00000000000a';
    seed(id, { link: 'https://example.com/keep' });
    const before = fs.readFileSync(metaPathOf(id));

    const res = await request(app).patch(`/api/dump/${id}`).send({ link: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(fs.readFileSync(metaPathOf(id))).toEqual(before);
  });

  it('returns 400 for a non-string name', async () => {
    const id = '9a000000-0000-4000-8000-00000000000b';
    seed(id);
    const res = await request(app).patch(`/api/dump/${id}`).send({ name: 42 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('creates a sidecar with mtime-derived timestamps and no manifestVersion key when none exists', async () => {
    const id = '9a000000-0000-4000-8000-00000000000c';
    seed(id, null);
    expect(fs.existsSync(metaPathOf(id))).toBe(false);
    const mtime = new Date('2025-03-01T00:00:00.000Z');
    fs.utimesSync(zipPathOf(id), mtime, mtime);

    const res = await request(app).patch(`/api/dump/${id}`).send({ name: 'Fresh' });
    expect(res.status).toBe(200);

    const meta = readMeta(id);
    expect(meta['name']).toBe('Fresh');
    expect(meta['createdAt']).toBe(mtime.getTime());
    expect(meta['expiresAt']).toBe(mtime.getTime() + ONE_YEAR_MS);
    expect('manifestVersion' in meta).toBe(false);
  });

  it('never writes manifestVersion into an existing sidecar that lacks it', async () => {
    const id = '9a000000-0000-4000-8000-00000000000d';
    fs.writeFileSync(zipPathOf(id), buildValidSbbZip(id));
    fs.writeFileSync(metaPathOf(id), JSON.stringify({ expiresAt: Date.now() + ONE_YEAR_MS }));

    const res = await request(app).patch(`/api/dump/${id}`).send({ name: 'Legacy' });
    expect(res.status).toBe(200);
    expect('manifestVersion' in readMeta(id)).toBe(false);
  });

  it('recovers from a corrupt sidecar instead of returning 500', async () => {
    const id = '9a000000-0000-4000-8000-00000000000e';
    fs.writeFileSync(zipPathOf(id), buildValidSbbZip(id));
    fs.writeFileSync(metaPathOf(id), '{ this is not json');

    const res = await request(app).patch(`/api/dump/${id}`).send({ name: 'Recovered' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, name: 'Recovered', link: null });

    const meta = readMeta(id);
    expect(meta['name']).toBe('Recovered');
    expect(typeof meta['expiresAt']).toBe('number');
    expect(typeof meta['createdAt']).toBe('number');
    expect('manifestVersion' in meta).toBe(false);
  });

  it('ignores unknown body keys', async () => {
    const id = '9a000000-0000-4000-8000-00000000000f';
    seed(id);
    const res = await request(app).patch(`/api/dump/${id}`).send({ name: 'Known', nope: 'ignored', expiresAt: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, name: 'Known', link: null });
    expect('nope' in readMeta(id)).toBe(false);
  });
});

// ============================================================
// Upload / import metadata validation
// (fresh module ⇒ fresh upload bucket, so these POSTs cost nothing)
// ============================================================

describe('Upload/import metadata validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('rejects a 257-character name on upload without writing the zip', async () => {
    const app2 = await freshApp({});
    const id = '7b000000-0000-4000-8000-000000000001';
    const res = await request(app2)
      .post('/api/dump/upload')
      .field('name', 'a'.repeat(257))
      .attach('file', buildValidSbbZip(id), 'dump.zip');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(fs.existsSync(path.join(TEST_DUMPS_DIR, `${id}.zip`))).toBe(false);
  });

  it('rejects a javascript: link on upload without writing the zip', async () => {
    const app2 = await freshApp({});
    const id = '7b000000-0000-4000-8000-000000000002';
    const res = await request(app2)
      .post('/api/dump/upload')
      .field('link', 'javascript:alert(1)')
      .attach('file', buildValidSbbZip(id), 'dump.zip');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(fs.existsSync(path.join(TEST_DUMPS_DIR, `${id}.zip`))).toBe(false);
  });

  it('rejects a javascript: link on import before fetching anything', async () => {
    const app2 = await freshApp({});
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app2).post('/api/dump/import').send({ url: 'https://example.com/dump.zip', link: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects a 257-character name on import before fetching anything', async () => {
    const app2 = await freshApp({});
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app2)
      .post('/api/dump/import')
      .send({ url: 'https://example.com/dump.zip', name: 'a'.repeat(257) });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ============================================================
// generateDeleteKey / resolveDeleteKey unit tests
// ============================================================

describe('generateDeleteKey / resolveDeleteKey', () => {
  it('roundtrips a valid UUID v4', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const key = generateDeleteKey(id);
    expect(resolveDeleteKey(key)).toBe(id);
  });

  it('returns null for a random string', () => {
    expect(resolveDeleteKey('notavalidkey')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(resolveDeleteKey('')).toBeNull();
  });

  it('produces different keys each call (PKCS1 is non-deterministic)', () => {
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const key1 = generateDeleteKey(id);
    const key2 = generateDeleteKey(id);
    // Both must resolve to the same id
    expect(resolveDeleteKey(key1)).toBe(id);
    expect(resolveDeleteKey(key2)).toBe(id);
  });
});

// ============================================================
// GET /api/delete/:key
// ============================================================

describe('GET /api/delete/:key (confirmation page)', () => {
  it('returns 400 for an invalid key', async () => {
    const res = await request(app).get('/api/delete/notavalidkey');
    expect(res.status).toBe(400);
    expect(res.text).toBe('Invalid delete key');
  });

  it('returns 400 for a key with non-base64url characters', async () => {
    const res = await request(app).get('/api/delete/%3Cscript%3Ekey');
    expect(res.status).toBe(400);
    expect(res.text).toBe('Invalid delete key');
  });

  it('returns 404 when the dump no longer exists', async () => {
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const key = generateDeleteKey(id);
    const res = await request(app).get(`/api/delete/${key}`);
    expect(res.status).toBe(404);
    expect(res.text).toBe('Not found');
  });

  it('returns a confirmation page and does NOT delete the dump', async () => {
    const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const buf = buildValidSbbZip(id);
    const zipPath = path.join(TEST_DUMPS_DIR, `${id}.zip`);
    fs.writeFileSync(zipPath, buf);

    const key = generateDeleteKey(id);
    const res = await request(app).get(`/api/delete/${key}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<form');
    expect(res.text).toContain('method="post"');
    expect(res.text).toContain(id);
    expect(fs.existsSync(zipPath)).toBe(true);

    fs.unlinkSync(zipPath);
  });

  it('is rate limited', async () => {
    const res = await request(app).get('/api/delete/notavalidkey');
    const hasRateLimitHeader = Object.keys(res.headers).some((h) => h.toLowerCase().includes('ratelimit'));
    expect(hasRateLimitHeader).toBe(true);
  });
});

// ============================================================
// POST /api/delete/:key
// ============================================================

describe('POST /api/delete/:key', () => {
  it('returns 400 for an invalid key', async () => {
    const res = await request(app).post('/api/delete/notavalidkey');
    expect(res.status).toBe(400);
    expect(res.text).toBe('Invalid delete key');
  });

  it('returns 404 when the dump no longer exists', async () => {
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const key = generateDeleteKey(id);
    const res = await request(app).post(`/api/delete/${key}`);
    expect(res.status).toBe(404);
    expect(res.text).toBe('Not found');
  });

  it('deletes the dump and returns "Deleted"', async () => {
    const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const buf = buildValidSbbZip(id);
    const zipPath = path.join(TEST_DUMPS_DIR, `${id}.zip`);
    fs.writeFileSync(zipPath, buf);

    const key = generateDeleteKey(id);
    const res = await request(app).post(`/api/delete/${key}`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('Deleted');
    expect(fs.existsSync(zipPath)).toBe(false);
  });

  it('also removes the .meta sidecar when present', async () => {
    const id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const buf = buildValidSbbZip(id);
    const zipPath = path.join(TEST_DUMPS_DIR, `${id}.zip`);
    const metaPath = path.join(TEST_DUMPS_DIR, `${id}.meta`);
    fs.writeFileSync(zipPath, buf);
    fs.writeFileSync(metaPath, JSON.stringify({ expiresAt: Date.now() + 1000 }));

    const key = generateDeleteKey(id);
    const res = await request(app).post(`/api/delete/${key}`);
    expect(res.status).toBe(200);
    expect(fs.existsSync(zipPath)).toBe(false);
    expect(fs.existsSync(metaPath)).toBe(false);
  });
});

// ============================================================
// Upload token enforcement
// Re-imports the app module with AUTH_TOKEN set so the
// module-level const picks up the value.
// ============================================================

describe('Auth token protection', () => {
  let tokenApp: Express;
  const TOKEN = 'test-secret-token';

  beforeAll(async () => {
    process.env.AUTH_TOKEN = TOKEN;
    vi.resetModules();
    const mod = await import('./app.js');
    tokenApp = mod.app;
  });

  afterAll(() => {
    delete process.env.AUTH_TOKEN;
    vi.resetModules();
  });

  it('POST /api/dump/upload returns 401 with no token', async () => {
    const buf = buildValidSbbZip('f47ac10b-58cc-4372-a567-0e02b2c3d479');
    const res = await request(tokenApp).post('/api/dump/upload').attach('file', buf, 'dump.zip');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/dump/upload returns 401 with wrong token', async () => {
    const buf = buildValidSbbZip('f47ac10b-58cc-4372-a567-0e02b2c3d480');
    const res = await request(tokenApp).post('/api/dump/upload').set('Authorization', 'Bearer wrong-token').attach('file', buf, 'dump.zip');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/dump/upload returns 200 with correct Bearer token', async () => {
    const bearerId = 'f47ac10b-58cc-4372-a567-0e02b2c3d481';
    const buf = buildValidSbbZip(bearerId);
    const res = await request(tokenApp).post('/api/dump/upload').set('Authorization', `Bearer ${TOKEN}`).attach('file', buf, 'dump.zip');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', bearerId);
  });

  it('POST /api/dump/upload returns 401 with X-Upload-Token header (no longer supported)', async () => {
    const headerId = 'f47ac10b-58cc-4372-a567-0e02b2c3d482';
    const buf = buildValidSbbZip(headerId);
    const res = await request(tokenApp).post('/api/dump/upload').set('X-Upload-Token', TOKEN).attach('file', buf, 'dump.zip');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/dump/upload returns 200 with correct X-Auth-Token header', async () => {
    const headerId = 'f47ac10b-58cc-4372-a567-0e02b2c3d483';
    const buf = buildValidSbbZip(headerId);
    const res = await request(tokenApp).post('/api/dump/upload').set('X-Auth-Token', TOKEN).attach('file', buf, 'dump.zip');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', headerId);
  });

  it('POST /api/dump/import returns 401 with no token', async () => {
    const res = await request(tokenApp).post('/api/dump/import').send({ url: 'http://example.com/dump.zip' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('DELETE /api/dump/:id returns 401 with no token', async () => {
    const res = await request(tokenApp).delete('/api/dump/00000000-0000-4000-8000-000000000002');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('PATCH /api/dump/:id returns 401 with no token', async () => {
    const res = await request(tokenApp).patch('/api/dump/00000000-0000-4000-8000-000000000003').send({ name: 'x' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('PATCH /api/dump/:id returns 401 with a wrong token', async () => {
    const res = await request(tokenApp)
      .patch('/api/dump/00000000-0000-4000-8000-000000000003')
      .set('Authorization', 'Bearer wrong-token')
      .send({ name: 'x' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/dumps returns 401 with no token', async () => {
    const res = await request(tokenApp).get('/api/dumps');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/delete/:key stays auth-free (404 for a missing dump, not 401)', async () => {
    const key = generateDeleteKey('12345678-1234-4123-8123-123456789012');
    const res = await request(tokenApp).get(`/api/delete/${key}`);
    expect(res.status).toBe(404);
  });

  it('POST /api/delete/:key deletes without a token', async () => {
    const id = '12345678-1234-4123-8123-123456789abc';
    const zipPath = path.join(TEST_DUMPS_DIR, `${id}.zip`);
    fs.writeFileSync(zipPath, buildValidSbbZip(id));

    const res = await request(tokenApp).post(`/api/delete/${generateDeleteKey(id)}`);
    expect(res.status).toBe(200);
    expect(fs.existsSync(zipPath)).toBe(false);
  });
});

// ============================================================
// Auth brute-force protection
// Fresh module instances so the limiter buckets and env-based
// limits don't interfere with the rest of the suite.
// ============================================================

describe('Auth brute-force protection', () => {
  afterEach(() => {
    delete process.env.AUTH_TOKEN;
    delete process.env.AUTH_FAIL_LIMIT;
    delete process.env.AUTH_FAIL_DELAY_MS;
    vi.resetModules();
  });

  it('locks out an IP after too many failed auth attempts, without counting successful ones', async () => {
    const app2 = await freshApp({ AUTH_TOKEN: 'brute-secret', AUTH_FAIL_LIMIT: '2', AUTH_FAIL_DELAY_MS: '0' });

    // Successful requests never count toward the failure budget
    for (let i = 0; i < 3; i++) {
      const ok = await request(app2).get('/api/dumps').set('Authorization', 'Bearer brute-secret');
      expect(ok.status).toBe(200);
    }

    // Two failures fill the budget…
    for (let i = 0; i < 2; i++) {
      const bad = await request(app2).get('/api/dumps').set('Authorization', 'Bearer wrong');
      expect(bad.status).toBe(401);
    }

    // …after which even a valid token is locked out
    const blockedBad = await request(app2).get('/api/dumps').set('Authorization', 'Bearer wrong');
    expect(blockedBad.status).toBe(429);
    const blockedGood = await request(app2).get('/api/dumps').set('Authorization', 'Bearer brute-secret');
    expect(blockedGood.status).toBe(429);
  });

  it('applies the failure budget to DELETE /api/dump/:id as well', async () => {
    const app2 = await freshApp({ AUTH_TOKEN: 'brute-secret', AUTH_FAIL_LIMIT: '2', AUTH_FAIL_DELAY_MS: '0' });

    for (let i = 0; i < 2; i++) {
      const bad = await request(app2).delete('/api/dump/00000000-0000-4000-8000-000000000009').set('Authorization', 'Bearer wrong');
      expect(bad.status).toBe(401);
    }
    const blocked = await request(app2).delete('/api/dump/00000000-0000-4000-8000-000000000009').set('Authorization', 'Bearer wrong');
    expect(blocked.status).toBe(429);
  });

  it('delays failed auth responses by AUTH_FAIL_DELAY_MS', async () => {
    const app2 = await freshApp({ AUTH_TOKEN: 'brute-secret', AUTH_FAIL_DELAY_MS: '120' });

    const start = Date.now();
    const res = await request(app2).get('/api/dumps').set('Authorization', 'Bearer wrong');
    const elapsed = Date.now() - start;
    expect(res.status).toBe(401);
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('does not delay successful auth', async () => {
    const app2 = await freshApp({ AUTH_TOKEN: 'brute-secret', AUTH_FAIL_DELAY_MS: '120' });

    const start = Date.now();
    const res = await request(app2).get('/api/dumps').set('Authorization', 'Bearer brute-secret');
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(100);
  });
});

// ============================================================
// General rate limiting on read endpoints
// ============================================================

describe('General rate limiter', () => {
  afterEach(() => {
    delete process.env.GENERAL_RATE_LIMIT;
    vi.resetModules();
  });

  it('throttles GET /api/dump/:id after the limit is exceeded', async () => {
    process.env.GENERAL_RATE_LIMIT = '2';
    vi.resetModules();
    const mod = await import('./app.js');
    const app2 = mod.app;

    const id = '00000000-0000-4000-8000-00000000000a';
    for (let i = 0; i < 2; i++) {
      const res = await request(app2).get(`/api/dump/${id}`);
      expect(res.status).toBe(404); // not stored, but not throttled
    }
    const blocked = await request(app2).get(`/api/dump/${id}`);
    expect(blocked.status).toBe(429);
  });
});

// ============================================================
// GET /api/dumps
// (placed last so the beforeAll cleanup doesn't affect earlier tests)
// ============================================================

describe('GET /api/dumps', () => {
  beforeAll(() => {
    // Clean the test dumps dir for a known starting state (skip subdirectories)
    for (const f of fs.readdirSync(TEST_DUMPS_DIR)) {
      const p = path.join(TEST_DUMPS_DIR, f);
      if (fs.statSync(p).isFile()) fs.unlinkSync(p);
    }
  });

  it('returns 200 with empty array when no dumps exist', async () => {
    const res = await request(app).get('/api/dumps');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dumps: [] });
  });

  it('returns 200 with correct shape after uploading a dump', async () => {
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const buf = buildValidSbbZip(id);
    await request(app).post('/api/dump/upload').attach('file', buf, 'dump.zip');

    const res = await request(app).get('/api/dumps');
    expect(res.status).toBe(200);
    expect(res.body.dumps).toHaveLength(1);
    const dump = res.body.dumps[0] as { id: string; size: number; createdAt: string; expiresAt: string };
    expect(dump.id).toBe(id);
    expect(typeof dump.size).toBe('number');
    expect(typeof dump.createdAt).toBe('string');
    expect(typeof dump.expiresAt).toBe('string');
    expect(new Date(dump.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('returns dumps sorted newest first', async () => {
    const id1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; // will be set to older
    const id2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; // will be set to newer
    const buf1 = buildValidSbbZip(id1);
    const buf2 = buildValidSbbZip(id2);
    fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${id1}.zip`), buf1);
    fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${id2}.zip`), buf2);

    const older = new Date('2024-01-01T00:00:00.000Z');
    const newer = new Date('2025-06-01T00:00:00.000Z');
    fs.utimesSync(path.join(TEST_DUMPS_DIR, `${id1}.zip`), older, older);
    fs.utimesSync(path.join(TEST_DUMPS_DIR, `${id2}.zip`), newer, newer);

    const res = await request(app).get('/api/dumps');
    expect(res.status).toBe(200);
    const ids = (res.body.dumps as { id: string }[]).map((d) => d.id);
    const idx1 = ids.indexOf(id1);
    const idx2 = ids.indexOf(id2);
    expect(idx2).toBeLessThan(idx1); // newer (id2) should appear before older (id1)
  });

  type DumpEntry = {
    id: string;
    size: number;
    createdAt: string;
    expiresAt: string;
    manifestVersion: number | null;
    versions: Record<string, string> | null;
    name: string | null;
    link: string | null;
  };

  function findDump(res: request.Response, id: string): DumpEntry {
    const entry = (res.body.dumps as DumpEntry[]).find((d) => d.id === id);
    expect(entry).toBeDefined();
    return entry as DumpEntry;
  }

  it('returns manifestVersion, versions and createdAt from an enriched meta sidecar', async () => {
    const id = 'aaaa1111-0000-4000-8000-000000000001';
    const createdAt = Date.parse('2025-05-01T00:00:00.000Z');
    const expiresAt = createdAt + 1000 * 60 * 60 * 24 * 30;
    const versions = { skyblockbuilder: '1.0', minecraft: '1.20.1', forge: '47.1.0', libx: '1.20.1-5.0.12' };
    fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${id}.zip`), buildValidSbbZip(id, { forge: '47.1.0', libx: '1.20.1-5.0.12' }));
    fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${id}.meta`), JSON.stringify({ expiresAt, createdAt, manifestVersion: 1, versions }));

    const res = await request(app).get('/api/dumps');
    expect(res.status).toBe(200);
    const dump = findDump(res, id);
    expect(dump.manifestVersion).toBe(1);
    expect(dump.versions).toEqual(versions);
    expect(dump.createdAt).toBe(new Date(createdAt).toISOString());
    expect(dump.expiresAt).toBe(new Date(expiresAt).toISOString());
  });

  it('backfills a legacy meta (expiresAt/hashes only) without changing those fields', async () => {
    const id = 'aaaa1111-0000-4000-8000-000000000003';
    const zipPath = path.join(TEST_DUMPS_DIR, `${id}.zip`);
    const metaPath = path.join(TEST_DUMPS_DIR, `${id}.meta`);
    const expiresAt = Date.now() + 12345678;
    const hashes = { legacymod: { md5: 'm', sha1: 's1', sha512: 's512' } };
    fs.writeFileSync(zipPath, buildValidSbbZip(id, { neoforge: '21.1.80' }));
    fs.writeFileSync(metaPath, JSON.stringify({ expiresAt, hashes }));

    const res = await request(app).get('/api/dumps');
    const dump = findDump(res, id);
    expect(dump.manifestVersion).toBe(1);
    expect(dump.versions).toEqual({ skyblockbuilder: '1.0', minecraft: '1.20.1', neoforge: '21.1.80' });
    expect(dump.expiresAt).toBe(new Date(expiresAt).toISOString());

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
    expect(meta['expiresAt']).toBe(expiresAt);
    expect(meta['hashes']).toEqual(hashes);
    expect(meta['manifestVersion']).toBe(1);
    expect(meta['versions']).toEqual(dump.versions);
    expect(typeof meta['createdAt']).toBe('number');
  });

  it('creates a meta with a stable mtime-derived expiry for a zip without one', async () => {
    const id = 'aaaa1111-0000-4000-8000-000000000004';
    const zipPath = path.join(TEST_DUMPS_DIR, `${id}.zip`);
    const metaPath = path.join(TEST_DUMPS_DIR, `${id}.meta`);
    fs.writeFileSync(zipPath, buildValidSbbZip(id));
    const mtime = new Date('2025-03-01T00:00:00.000Z');
    fs.utimesSync(zipPath, mtime, mtime);

    const res = await request(app).get('/api/dumps');
    const dump = findDump(res, id);
    expect(dump.manifestVersion).toBe(1);
    expect(dump.createdAt).toBe(mtime.toISOString());
    expect(dump.expiresAt).toBe(new Date(mtime.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString());

    expect(fs.existsSync(metaPath)).toBe(true);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
    expect(meta['expiresAt']).toBe(mtime.getTime() + 365 * 24 * 60 * 60 * 1000);

    // A second call returns the same expiry (persisted, not recomputed)
    const res2 = await request(app).get('/api/dumps');
    expect(findDump(res2, id).expiresAt).toBe(dump.expiresAt);
  });

  it('reports name/link as null when the sidecar has neither, without writing the keys back', async () => {
    const id = 'aaaa1111-0000-4000-8000-000000000006';
    const metaPath = path.join(TEST_DUMPS_DIR, `${id}.meta`);
    fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${id}.zip`), buildValidSbbZip(id));
    fs.writeFileSync(metaPath, JSON.stringify({ expiresAt: Date.now() + 12345, createdAt: Date.now(), manifestVersion: 1, versions: {} }));

    const res = await request(app).get('/api/dumps');
    const dump = findDump(res, id);
    expect(dump.name).toBeNull();
    expect(dump.link).toBeNull();

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
    expect('name' in meta).toBe(false);
    expect('link' in meta).toBe(false);
  });

  it('echoes name/link verbatim from an enriched sidecar', async () => {
    const id = 'aaaa1111-0000-4000-8000-000000000007';
    fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${id}.zip`), buildValidSbbZip(id));
    fs.writeFileSync(
      path.join(TEST_DUMPS_DIR, `${id}.meta`),
      JSON.stringify({
        expiresAt: Date.now() + 12345,
        createdAt: Date.now(),
        manifestVersion: 1,
        versions: {},
        name: 'Issue #412',
        link: 'https://github.com/o/r/issues/412',
      }),
    );

    const dump = findDump(await request(app).get('/api/dumps'), id);
    expect(dump.name).toBe('Issue #412');
    expect(dump.link).toBe('https://github.com/o/r/issues/412');
  });

  it('preserves name/link through the manifestVersion backfill', async () => {
    const id = 'aaaa1111-0000-4000-8000-000000000008';
    const metaPath = path.join(TEST_DUMPS_DIR, `${id}.meta`);
    const expiresAt = Date.now() + 987654;
    fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${id}.zip`), buildValidSbbZip(id));
    fs.writeFileSync(metaPath, JSON.stringify({ expiresAt, name: 'Legacy name', link: 'https://example.com/legacy' }));

    const dump = findDump(await request(app).get('/api/dumps'), id);
    expect(dump.manifestVersion).toBe(1);
    expect(dump.name).toBe('Legacy name');
    expect(dump.link).toBe('https://example.com/legacy');

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
    expect(meta['manifestVersion']).toBe(1);
    expect(meta['name']).toBe('Legacy name');
    expect(meta['link']).toBe('https://example.com/legacy');
  });

  it('marks an unreadable zip with null fields and suppresses re-parsing', async () => {
    const id = 'aaaa1111-0000-4000-8000-000000000005';
    const zipPath = path.join(TEST_DUMPS_DIR, `${id}.zip`);
    const metaPath = path.join(TEST_DUMPS_DIR, `${id}.meta`);
    const expiresAt = Date.now() + 9999999;
    fs.writeFileSync(zipPath, Buffer.from('this is not a zip file'));
    fs.writeFileSync(metaPath, JSON.stringify({ expiresAt }));

    const res = await request(app).get('/api/dumps');
    expect(res.status).toBe(200);
    const dump = findDump(res, id);
    expect(dump.manifestVersion).toBeNull();
    expect(dump.versions).toBeNull();

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
    expect(meta).toHaveProperty('manifestVersion', null);
    expect(meta['expiresAt']).toBe(expiresAt);
  });
});

// ============================================================
// GET /api/dump/:id/modpack
// ============================================================

// Helper: build a dump zip for modpack tests.
// Only includes `minecraft` in versions by default so no mod lookups are triggered.
function buildModpackTestDump(opts: {
  manifestId: string;
  versions?: Record<string, string>;
  settings?: Record<string, boolean>;
  files?: Array<{ path: string; data: string }>;
}): Buffer {
  const { manifestId, versions = {}, settings = {}, files = [] } = opts;
  const zip = new AdmZip();
  const manifest = {
    manifest_version: 1,
    manifest_id: manifestId,
    settings,
    versions: { minecraft: '1.21.1', ...versions },
    files: files.map((f) => ({ path: f.path })),
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf-8'));
  for (const f of files) {
    zip.addFile(f.path, Buffer.from(f.data, 'utf-8'));
  }
  return zip.toBuffer();
}

// Helper: get a modpack response as a Buffer (handles binary content-type).
async function getModpackBuffer(url: string): Promise<{ status: number; buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    // @ts-ignore
    request(app as Express)
      .get(url)
      .buffer(true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .parse((res: any, callback: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .end((err: Error | null, res: any) => {
        if (err) reject(err);
        else resolve({ status: res.status, buffer: res.body as Buffer, contentType: (res.headers['content-type'] as string) ?? '' });
      });
  });
}

describe('GET /api/dump/:id/modpack', () => {
  const BASE_ID = '12340000-0000-4000-8000-000000000000';

  beforeAll(() => {
    const buf = buildModpackTestDump({ manifestId: BASE_ID });
    fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${BASE_ID}.zip`), buf);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // --- Input validation ---

  it('returns 400 for an invalid dump id', async () => {
    const res = await request(app).get('/api/dump/not-a-uuid/modpack?platform=curseforge');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when platform param is missing', async () => {
    const res = await request(app).get(`/api/dump/${BASE_ID}/modpack`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when platform param is unrecognised', async () => {
    const res = await request(app).get(`/api/dump/${BASE_ID}/modpack?platform=technic`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 for a non-existent dump', async () => {
    const res = await request(app).get('/api/dump/00000000-0000-4000-8000-000000001234/modpack?platform=curseforge');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  // --- CurseForge output structure ---

  describe('platform=curseforge', () => {
    it('returns 200 with application/zip content-type', async () => {
      const { status, contentType } = await getModpackBuffer(`/api/dump/${BASE_ID}/modpack?platform=curseforge`);
      expect(status).toBe(200);
      expect(contentType).toMatch(/application\/zip/);
    });

    it('zip contains a valid manifest.json with correct structure', async () => {
      const { buffer } = await getModpackBuffer(`/api/dump/${BASE_ID}/modpack?platform=curseforge`);
      const zip = new AdmZip(buffer);
      const entry = zip.getEntry('manifest.json');
      expect(entry).not.toBeNull();
      const parsed = JSON.parse(entry!.getData().toString('utf-8')) as Record<string, unknown>;
      expect(parsed['manifestType']).toBe('minecraftModpack');
      expect(parsed['manifestVersion']).toBe(1);
      expect(parsed['overrides']).toBe('overrides');
      expect((parsed['minecraft'] as Record<string, unknown>)['version']).toBe('1.21.1');
    });

    it('includes forge modLoader entry when manifest has forge version', async () => {
      const id = '12340000-0000-4000-8000-cf0000000001';
      fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${id}.zip`), buildModpackTestDump({ manifestId: id, versions: { forge: '47.3.0' } }));

      const { buffer } = await getModpackBuffer(`/api/dump/${id}/modpack?platform=curseforge`);
      const zip = new AdmZip(buffer);
      const parsed = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf-8')) as Record<string, unknown>;
      const modLoaders = (parsed['minecraft'] as Record<string, unknown>)['modLoaders'] as Array<{ id: string; primary: boolean }>;
      expect(modLoaders).toHaveLength(1);
      expect(modLoaders[0].id).toBe('forge-47.3.0');
      expect(modLoaders[0].primary).toBe(true);
    });

    it('includes neoforge modLoader entry when manifest has neoforge version', async () => {
      const id = '12340000-0000-4000-8000-cf0000000002';
      fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${id}.zip`), buildModpackTestDump({ manifestId: id, versions: { neoforge: '21.1.0' } }));

      const { buffer } = await getModpackBuffer(`/api/dump/${id}/modpack?platform=curseforge`);
      const zip = new AdmZip(buffer);
      const parsed = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf-8')) as Record<string, unknown>;
      const modLoaders = (parsed['minecraft'] as Record<string, unknown>)['modLoaders'] as Array<{ id: string }>;
      expect(modLoaders[0].id).toBe('neoforge-21.1.0');
    });

    it('has empty modLoaders when no loader version in manifest', async () => {
      const { buffer } = await getModpackBuffer(`/api/dump/${BASE_ID}/modpack?platform=curseforge`);
      const zip = new AdmZip(buffer);
      const parsed = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf-8')) as Record<string, unknown>;
      expect((parsed['minecraft'] as Record<string, unknown>)['modLoaders']).toHaveLength(0);
    });

    it('has empty files array when no mod versions are present', async () => {
      const { buffer } = await getModpackBuffer(`/api/dump/${BASE_ID}/modpack?platform=curseforge`);
      const zip = new AdmZip(buffer);
      const parsed = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf-8')) as Record<string, unknown>;
      expect(parsed['files']).toHaveLength(0);
    });

    it('skips override entries whose header declares an oversized entry', async () => {
      const id = '12340000-0000-4000-8000-cf0000000099';
      const dumpBuf = buildModpackTestDump({
        manifestId: id,
        files: [
          { path: 'config/huge.json', data: '{}' },
          { path: 'config/small.json', data: '{"keep": true}' },
        ],
      });
      // Tamper the central-directory uncompressed-size of huge.json to claim 65 MB
      const nameOffset = dumpBuf.indexOf(Buffer.from('config/huge.json', 'utf-8'), dumpBuf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
      const cdOffset = nameOffset - 46; // central-directory header is 46 bytes before the name
      expect(dumpBuf.readUInt32LE(cdOffset)).toBe(0x02014b50);
      dumpBuf.writeUInt32LE(65 * 1024 * 1024, cdOffset + 24);
      fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${id}.zip`), dumpBuf);

      const { buffer } = await getModpackBuffer(`/api/dump/${id}/modpack?platform=curseforge`);
      const zip = new AdmZip(buffer);
      expect(zip.getEntry('overrides/config/skyblockbuilder/small.json')).not.toBeNull();
      expect(zip.getEntry('overrides/config/skyblockbuilder/huge.json')).toBeNull();
    });

    it('includes a mod entry when the CurseForge API returns a matching file', async () => {
      const id = '12340000-0000-4000-8000-cf0000000003';
      fs.writeFileSync(
        path.join(TEST_DUMPS_DIR, `${id}.zip`),
        buildModpackTestDump({ manifestId: id, versions: { skyblockbuilder: '2.3.0' } }),
      );

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [
            { project: 446691, file: 12345, name: 'skyblockbuilder-2.3.0.jar', versions: ['1.21.1'] },
            { project: 446691, file: 99999, name: 'skyblockbuilder-1.0.0.jar', versions: ['1.20.1'] },
          ],
        }),
      );

      const { buffer } = await getModpackBuffer(`/api/dump/${id}/modpack?platform=curseforge`);
      const zip = new AdmZip(buffer);
      const parsed = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf-8')) as Record<string, unknown>;
      const files = parsed['files'] as Array<{ projectID: unknown; fileID: number; required: boolean }>;
      expect(files).toHaveLength(1);
      expect(files[0].fileID).toBe(12345);
      expect(files[0].required).toBe(true);
    });

    it('silently skips a mod when the CurseForge API returns no matching file', async () => {
      const id = '12340000-0000-4000-8000-cf0000000004';
      fs.writeFileSync(
        path.join(TEST_DUMPS_DIR, `${id}.zip`),
        buildModpackTestDump({ manifestId: id, versions: { skyblockbuilder: '9.9.9' } }),
      );

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [{ project: 446691, file: 1, name: 'skyblockbuilder-2.3.0.jar', versions: ['1.21.1'] }],
        }),
      );

      const { status, buffer } = await getModpackBuffer(`/api/dump/${id}/modpack?platform=curseforge`);
      expect(status).toBe(200);
      const zip = new AdmZip(buffer);
      const parsed = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf-8')) as Record<string, unknown>;
      expect(parsed['files']).toHaveLength(0);
    });

    it('silently skips a mod when the CurseForge API call fails', async () => {
      const id = '12340000-0000-4000-8000-cf0000000005';
      fs.writeFileSync(
        path.join(TEST_DUMPS_DIR, `${id}.zip`),
        buildModpackTestDump({ manifestId: id, versions: { skyblockbuilder: '2.3.0' } }),
      );

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const { status, buffer } = await getModpackBuffer(`/api/dump/${id}/modpack?platform=curseforge`);
      expect(status).toBe(200);
      const zip = new AdmZip(buffer);
      const parsed = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf-8')) as Record<string, unknown>;
      expect(parsed['files']).toHaveLength(0);
    });
  });

  // --- Modrinth output structure ---

  describe('platform=modrinth', () => {
    it('returns 200 with modrinth content-type', async () => {
      const { status, contentType } = await getModpackBuffer(`/api/dump/${BASE_ID}/modpack?platform=modrinth`);
      expect(status).toBe(200);
      expect(contentType).toMatch(/modrinth/);
    });

    it('zip contains a valid modrinth.index.json with correct structure', async () => {
      const { buffer } = await getModpackBuffer(`/api/dump/${BASE_ID}/modpack?platform=modrinth`);
      const zip = new AdmZip(buffer);
      const entry = zip.getEntry('modrinth.index.json');
      expect(entry).not.toBeNull();
      const parsed = JSON.parse(entry!.getData().toString('utf-8')) as Record<string, unknown>;
      expect(parsed['formatVersion']).toBe(1);
      expect(parsed['game']).toBe('minecraft');
      expect((parsed['dependencies'] as Record<string, string>)['minecraft']).toBe('1.21.1');
    });

    it('includes forge in dependencies when manifest has forge version', async () => {
      const id = '12340000-0000-4000-8000-dd0000000001';
      fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${id}.zip`), buildModpackTestDump({ manifestId: id, versions: { forge: '47.3.0' } }));

      const { buffer } = await getModpackBuffer(`/api/dump/${id}/modpack?platform=modrinth`);
      const zip = new AdmZip(buffer);
      const parsed = JSON.parse(zip.getEntry('modrinth.index.json')!.getData().toString('utf-8')) as Record<string, unknown>;
      const deps = parsed['dependencies'] as Record<string, string>;
      expect(deps['forge']).toBe('47.3.0');
      expect(deps['neoforge']).toBeUndefined();
    });

    it('includes neoforge in dependencies when manifest has neoforge version', async () => {
      const id = '12340000-0000-4000-8000-dd0000000002';
      fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${id}.zip`), buildModpackTestDump({ manifestId: id, versions: { neoforge: '21.1.0' } }));

      const { buffer } = await getModpackBuffer(`/api/dump/${id}/modpack?platform=modrinth`);
      const zip = new AdmZip(buffer);
      const parsed = JSON.parse(zip.getEntry('modrinth.index.json')!.getData().toString('utf-8')) as Record<string, unknown>;
      const deps = parsed['dependencies'] as Record<string, string>;
      expect(deps['neoforge']).toBe('21.1.0');
      expect(deps['forge']).toBeUndefined();
    });

    it('omits loader from dependencies when no loader version in manifest', async () => {
      const { buffer } = await getModpackBuffer(`/api/dump/${BASE_ID}/modpack?platform=modrinth`);
      const zip = new AdmZip(buffer);
      const parsed = JSON.parse(zip.getEntry('modrinth.index.json')!.getData().toString('utf-8')) as Record<string, unknown>;
      const deps = parsed['dependencies'] as Record<string, string>;
      expect(deps['forge']).toBeUndefined();
      expect(deps['neoforge']).toBeUndefined();
    });

    it('includes a mod entry when the Modrinth API returns a matching version', async () => {
      const id = '12340000-0000-4000-8000-dd0000000003';
      fs.writeFileSync(
        path.join(TEST_DUMPS_DIR, `${id}.zip`),
        buildModpackTestDump({ manifestId: id, versions: { skyblockbuilder: '2.3.0', forge: '47.3.0' } }),
      );

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [
            {
              version_number: '2.3.0',
              files: [
                {
                  url: 'https://cdn.modrinth.com/data/abc/skyblockbuilder-2.3.0.jar',
                  filename: 'skyblockbuilder-2.3.0.jar',
                  primary: true,
                  hashes: { sha1: 'aabbcc', sha512: 'ddeeff' },
                  size: 123456,
                },
              ],
            },
          ],
        }),
      );

      const { buffer } = await getModpackBuffer(`/api/dump/${id}/modpack?platform=modrinth`);
      const zip = new AdmZip(buffer);
      const parsed = JSON.parse(zip.getEntry('modrinth.index.json')!.getData().toString('utf-8')) as Record<string, unknown>;
      const files = parsed['files'] as Array<Record<string, unknown>>;
      expect(files).toHaveLength(1);
      expect(files[0]['path']).toBe('mods/skyblockbuilder-2.3.0.jar');
      expect((files[0]['hashes'] as Record<string, string>)['sha1']).toBe('aabbcc');
      expect(files[0]['fileSize']).toBe(123456);
      expect((files[0]['downloads'] as string[])[0]).toBe('https://cdn.modrinth.com/data/abc/skyblockbuilder-2.3.0.jar');
    });

    it('silently skips a mod when the Modrinth API returns no matching version', async () => {
      const id = '12340000-0000-4000-8000-dd0000000004';
      fs.writeFileSync(
        path.join(TEST_DUMPS_DIR, `${id}.zip`),
        buildModpackTestDump({ manifestId: id, versions: { skyblockbuilder: '9.9.9', forge: '47.3.0' } }),
      );

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => [
            {
              version_number: '2.3.0',
              files: [{ url: 'https://example.com/f.jar', filename: 'f.jar', primary: true, hashes: { sha1: 'a', sha512: 'b' }, size: 1 }],
            },
          ],
        }),
      );

      const { status, buffer } = await getModpackBuffer(`/api/dump/${id}/modpack?platform=modrinth`);
      expect(status).toBe(200);
      const zip = new AdmZip(buffer);
      const parsed = JSON.parse(zip.getEntry('modrinth.index.json')!.getData().toString('utf-8')) as Record<string, unknown>;
      expect(parsed['files']).toHaveLength(0);
    });

    it('silently skips a mod when the Modrinth API call fails', async () => {
      const id = '12340000-0000-4000-8000-dd0000000005';
      fs.writeFileSync(
        path.join(TEST_DUMPS_DIR, `${id}.zip`),
        buildModpackTestDump({ manifestId: id, versions: { skyblockbuilder: '2.3.0', forge: '47.3.0' } }),
      );

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

      const { status, buffer } = await getModpackBuffer(`/api/dump/${id}/modpack?platform=modrinth`);
      expect(status).toBe(200);
      const zip = new AdmZip(buffer);
      const parsed = JSON.parse(zip.getEntry('modrinth.index.json')!.getData().toString('utf-8')) as Record<string, unknown>;
      expect(parsed['files']).toHaveLength(0);
    });
  });

  // --- File path mapping in overrides ---

  describe('override file mapping', () => {
    const FILE_MAP_ID = '12340000-0000-4000-8000-fe0000000000';

    beforeAll(() => {
      const buf = buildModpackTestDump({
        manifestId: FILE_MAP_ID,
        settings: { configs: true, 'level|world_gen_settings': true },
        files: [
          { path: 'level.dat', data: 'LEVELDAT' },
          { path: 'world_gen_settings.dat', data: 'WORLDGEN' },
          { path: 'config/customization.json5', data: 'CUSTOMIZATION' },
          { path: 'config/permissions.json5', data: 'PERMISSIONS' },
          { path: 'templates/islands/default.nbt', data: 'NBT' },
          { path: 'templates/spreads/test.snbt', data: 'SNBT' },
          { path: 'logs/latest.log', data: 'LOG' },
        ],
      });
      fs.writeFileSync(path.join(TEST_DUMPS_DIR, `${FILE_MAP_ID}.zip`), buf);
    });

    it('places level.dat at overrides/saves/SkyBlock/level.dat', async () => {
      const { buffer } = await getModpackBuffer(`/api/dump/${FILE_MAP_ID}/modpack?platform=curseforge`);
      const zip = new AdmZip(buffer);
      const entry = zip.getEntry('overrides/saves/SkyBlock/level.dat');
      expect(entry).not.toBeNull();
      expect(entry!.getData().toString('utf-8')).toBe('LEVELDAT');
    });

    it('places world_gen_settings.dat at overrides/saves/SkyBlock/data/minecraft/world_gen_settings.dat', async () => {
      const { buffer } = await getModpackBuffer(`/api/dump/${FILE_MAP_ID}/modpack?platform=curseforge`);
      const zip = new AdmZip(buffer);
      const entry = zip.getEntry('overrides/saves/SkyBlock/data/minecraft/world_gen_settings.dat');
      expect(entry).not.toBeNull();
      expect(entry!.getData().toString('utf-8')).toBe('WORLDGEN');
    });

    it('maps config/* to overrides/config/skyblockbuilder/*', async () => {
      const { buffer } = await getModpackBuffer(`/api/dump/${FILE_MAP_ID}/modpack?platform=curseforge`);
      const zip = new AdmZip(buffer);
      expect(zip.getEntry('overrides/config/skyblockbuilder/customization.json5')).not.toBeNull();
      expect(zip.getEntry('overrides/config/skyblockbuilder/permissions.json5')).not.toBeNull();
      expect(zip.getEntry('overrides/config/skyblockbuilder/customization.json5')!.getData().toString('utf-8')).toBe('CUSTOMIZATION');
    });

    it('maps templates/* to overrides/config/skyblockbuilder/templates/*', async () => {
      const { buffer } = await getModpackBuffer(`/api/dump/${FILE_MAP_ID}/modpack?platform=curseforge`);
      const zip = new AdmZip(buffer);
      expect(zip.getEntry('overrides/config/skyblockbuilder/templates/islands/default.nbt')).not.toBeNull();
      expect(zip.getEntry('overrides/config/skyblockbuilder/templates/spreads/test.snbt')).not.toBeNull();
    });

    it('excludes log files from the output zip', async () => {
      const { buffer } = await getModpackBuffer(`/api/dump/${FILE_MAP_ID}/modpack?platform=curseforge`);
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries().map((e) => e.entryName);
      expect(entries.some((e) => e.includes('logs/'))).toBe(false);
    });

    it('applies the same file mapping for the modrinth platform', async () => {
      const { buffer } = await getModpackBuffer(`/api/dump/${FILE_MAP_ID}/modpack?platform=modrinth`);
      const zip = new AdmZip(buffer);
      expect(zip.getEntry('overrides/saves/SkyBlock/level.dat')).not.toBeNull();
      expect(zip.getEntry('overrides/saves/SkyBlock/data/minecraft/world_gen_settings.dat')).not.toBeNull();
      expect(zip.getEntry('overrides/config/skyblockbuilder/customization.json5')).not.toBeNull();
      expect(zip.getEntry('overrides/config/skyblockbuilder/templates/islands/default.nbt')).not.toBeNull();
      expect(zip.getEntries().some((e) => e.entryName.includes('logs/'))).toBe(false);
    });
  });
});

// ============================================================
// cleanupOldDumps() unit tests
// ============================================================

describe('cleanupOldDumps()', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dump-viewer-cleanup-test-'));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not delete files that have not yet expired', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    fs.writeFileSync(path.join(tempDir, `${id}.zip`), Buffer.from('data'));
    // sidecar with expiresAt in the future
    fs.writeFileSync(path.join(tempDir, `${id}.meta`), JSON.stringify({ expiresAt: Date.now() + 60_000 }));
    const deleted = cleanupOldDumps(tempDir);
    expect(deleted).toBe(0);
    expect(fs.existsSync(path.join(tempDir, `${id}.zip`))).toBe(true);
  });

  it('deletes files that have expired and returns count', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    fs.writeFileSync(path.join(tempDir, `${id}.zip`), Buffer.from('data'));
    // sidecar with expiresAt in the past
    fs.writeFileSync(path.join(tempDir, `${id}.meta`), JSON.stringify({ expiresAt: Date.now() - 1000 }));
    const deleted = cleanupOldDumps(tempDir);
    expect(deleted).toBe(1);
    expect(fs.existsSync(path.join(tempDir, `${id}.zip`))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, `${id}.meta`))).toBe(false);
  });

  it('returns 0 when directory is empty', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dump-viewer-empty-'));
    try {
      expect(cleanupOldDumps(emptyDir)).toBe(0);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
