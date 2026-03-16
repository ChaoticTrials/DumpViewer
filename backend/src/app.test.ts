import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// DUMPS_DIR is set via vitest.config.ts env before module load
import { app, getDumpsDir, isSafeUrl, isValidId, validateAndExtractManifestId, cleanupOldDumps, parseTtlMs } from './app.js';

// The test dumps directory is whatever app.ts resolved at module load time
const TEST_DUMPS_DIR = getDumpsDir();

beforeAll(() => {
  fs.mkdirSync(TEST_DUMPS_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TEST_DUMPS_DIR, { recursive: true, force: true });
});

// --- Helper: build a valid SBB zip buffer ---
function buildValidSbbZip(manifestId: string): Buffer {
  const zip = new AdmZip();
  const manifest = {
    manifest_version: 1,
    manifest_id: manifestId,
    settings: {},
    versions: {
      skyblockbuilder: '1.0',
      minecraft: '1.20.1',
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

  it('returns 200 { id, url } for a valid SBB dump zip', async () => {
    const manifestId = '550e8400-e29b-41d4-a716-446655440000';
    const buf = buildValidSbbZip(manifestId);
    const res = await request(app).post('/api/dump/upload').attach('file', buf, 'dump.zip');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: manifestId, url: `/api/dump/${manifestId}` });

    // Verify the file was written to disk
    const stored = path.join(TEST_DUMPS_DIR, `${manifestId}.zip`);
    expect(fs.existsSync(stored)).toBe(true);
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

  it('returns 200 { id, url } on success (mocked fetch)', async () => {
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

    const res = await request(app).post('/api/dump/import').send({ url: 'https://example.com/dump.zip' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: validId, url: `/api/dump/${validId}` });
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

  it('GET /api/dumps returns 401 with no token', async () => {
    const res = await request(tokenApp).get('/api/dumps');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});

// ============================================================
// GET /api/dumps
// (placed last so the beforeAll cleanup doesn't affect earlier tests)
// ============================================================

describe('GET /api/dumps', () => {
  beforeAll(() => {
    // Clean the test dumps dir for a known starting state
    for (const f of fs.readdirSync(TEST_DUMPS_DIR)) {
      fs.unlinkSync(path.join(TEST_DUMPS_DIR, f));
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
