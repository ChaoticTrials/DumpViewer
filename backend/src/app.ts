import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DUMPS_DIR = path.resolve(process.env.DUMPS_DIR ?? './dumps');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';
function loadAuthToken(): string {
  if (process.env.AUTH_TOKEN) return process.env.AUTH_TOKEN;
  const file = process.env.AUTH_TOKEN_FILE ?? '/run/secrets/dumpviewer_token';
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}
const AUTH_TOKEN = loadAuthToken();

const ONE_YEAR_SECS = 365 * 24 * 60 * 60;
const ONE_YEAR_MS = ONE_YEAR_SECS * 1000;

// Max sizes
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // 512 MB
const MAX_MANIFEST_ENTRY_BYTES = 10 * 1024 * 1024; // 10 MB for manifest.json

// UUID v4 regex (Java lowercase output: 550e8400-e29b-41d4-a716-446655440000)
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Rate limiter for POST endpoints: max 10 requests per 10s (avg 1/sec)
const uploadLimiter = rateLimit({ windowMs: 10_000, limit: 10, standardHeaders: true, legacyHeaders: false });

// Ensure dumps directory exists
fs.mkdirSync(DUMPS_DIR, { recursive: true });

export const app = express();

// Open CORS — expose X-Expires-At for browser fetch
app.use(cors({ origin: ALLOWED_ORIGIN, exposedHeaders: ['X-Expires-At'] }));

app.use(express.json({ limit: '4kb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// Helper: fetch a URL following redirects, validating each redirect target with isSafeUrl()
async function fetchWithSafeRedirects(url: string, signal: AbortSignal, maxRedirects = 5): Promise<Response> {
  let currentUrl = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const response = await fetch(currentUrl, { signal, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect with no Location header');
      const resolved = new URL(location, currentUrl).toString();
      if (!isSafeUrl(resolved)) throw new Error('Redirect target is not allowed');
      currentUrl = resolved;
      continue;
    }
    return response;
  }
  throw new Error('Too many redirects');
}

// Helper: validate a URL is safe to fetch (no SSRF)
export function isSafeUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  // Strip IPv6 brackets — Node normalizes [::1] to hostname [::1]
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Block all IPv4-mapped IPv6 addresses (::ffff:...) — covers all private IPv4 ranges
  // Node.js URL normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1, so we block all ::ffff:
  if (/^::ffff:/.test(hostname)) {
    return false;
  }

  // Block loopback and special IPv6 addresses
  if (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '::' || // IPv6 unspecified (equivalent to 0.0.0.0)
    hostname === '0.0.0.0'
  ) {
    return false;
  }

  // Block IPv4 loopback and link-local
  if (
    /^127\./.test(hostname) ||
    /^169\.254\./.test(hostname) // link-local / cloud metadata (AWS IMDS, etc.)
  ) {
    return false;
  }

  // Block private IPv4 ranges (RFC 1918)
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) {
    return false;
  }

  // Block IPv6 private/link-local ranges
  return !(
    /^fc/.test(hostname) || // ULA fc00::/7
    /^fd/.test(hostname) || // ULA fd00::/8
    /^fe80/.test(hostname)
  );
}

// Helper: parse and validate a Skyblock Builder dump zip, returning manifest_id
export function validateAndExtractManifestId(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) {
    throw new Error('manifest.json not found in zip');
  }

  let manifest: unknown;
  const manifestData = manifestEntry.getData();
  if (manifestData.length > MAX_MANIFEST_ENTRY_BYTES) {
    throw new Error('manifest.json exceeds size limit');
  }

  try {
    manifest = JSON.parse(manifestData.toString('utf-8')) as unknown;
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'manifest.json contains invalid JSON');
  }

  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('manifest.json must be a JSON object');
  }

  const m = manifest as Record<string, unknown>;

  // manifest_version must be a number
  if (typeof m['manifest_version'] !== 'number') {
    throw new Error('manifest_version is missing or not a number');
  }

  // manifest_id must be a valid UUID v4
  if (typeof m['manifest_id'] !== 'string' || !UUID_V4_REGEX.test(m['manifest_id'] as string)) {
    throw new Error('manifest_id must be a valid UUID v4');
  }

  // versions must be an object
  if (typeof m['versions'] !== 'object' || m['versions'] === null || Array.isArray(m['versions'])) {
    throw new Error('versions is missing or not an object');
  }

  const versions = m['versions'] as Record<string, unknown>;

  // versions.skyblockbuilder must be a non-empty string — key SBB-specific check
  if (typeof versions['skyblockbuilder'] !== 'string' || versions['skyblockbuilder'] === '') {
    throw new Error('Not a valid Skyblock Builder dump: missing versions.skyblockbuilder');
  }

  // versions.minecraft must be a non-empty string
  if (typeof versions['minecraft'] !== 'string' || versions['minecraft'] === '') {
    throw new Error('versions.minecraft is missing or empty');
  }

  // files must be an array
  if (!Array.isArray(m['files'])) {
    throw new Error('files is missing or not an array');
  }

  return m['manifest_id'] as string;
}

// Helper: validate id — must be a valid UUID v4
export function isValidId(id: string): boolean {
  return UUID_V4_REGEX.test(id);
}

// Helper: return the resolved DUMPS_DIR (useful for tests)
export function getDumpsDir(): string {
  return DUMPS_DIR;
}

// Helper: parse a ttl value (seconds, from request) into milliseconds.
// Accepts string (form field) or number (JSON). Clamps to 1 year, defaults to 1 year.
export function parseTtlMs(raw: unknown): number {
  const secs = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? Math.trunc(raw) : NaN;
  if (!Number.isFinite(secs) || secs <= 0) return ONE_YEAR_MS;
  return Math.min(secs, ONE_YEAR_SECS) * 1000;
}

// Helper: delete expired dump files; returns count of deleted files.
// Expiry is read from the sidecar <id>.meta file written at upload time.
// Files with no sidecar fall back to mtime + 1 year.
export function cleanupOldDumps(dumpsDir: string): number {
  let files: string[];
  try {
    files = fs.readdirSync(dumpsDir).filter((f) => f.endsWith('.zip'));
  } catch {
    return 0;
  }
  let deleted = 0;
  for (const file of files) {
    const id = file.slice(0, -4);
    const zipPath = path.join(dumpsDir, file);
    const metaPath = path.join(dumpsDir, `${id}.meta`);
    let expiresAt: number;
    try {
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { expiresAt: number };
        expiresAt = meta.expiresAt;
      } else {
        const stat = fs.statSync(zipPath);
        expiresAt = stat.mtimeMs + ONE_YEAR_MS;
      }
    } catch {
      console.error(`Failed to read sidecar for ${id}`);
      expiresAt = 0;
    }

    if (Date.now() > expiresAt) {
      fs.unlinkSync(zipPath);
      try {
        fs.unlinkSync(metaPath);
      } catch {
        /* no sidecar is fine */
      }
      deleted++;
    }
  }

  return deleted;
}

// Helper: atomic file write via temp file + rename
function writeFileAtomic(dest: string, buffer: Buffer): void {
  const tmp = dest + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';

  try {
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, dest);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore cleanup error */
    }

    throw err;
  }
}

// Helper: extract the `hashes` field from a manifest (present in v2 dumps)
function extractManifestHashes(buffer: Buffer): Record<string, unknown> | undefined {
  try {
    const zip = new AdmZip(buffer);
    const manifestEntry = zip.getEntry('manifest.json');
    if (!manifestEntry) return undefined;
    const manifest = JSON.parse(manifestEntry.getData().toString('utf-8')) as Record<string, unknown>;
    const h = manifest['hashes'];
    if (typeof h === 'object' && h !== null && !Array.isArray(h)) {
      return h as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

// Helper: write a sidecar .meta file recording expiry and optional hashes
function writeMeta(zipDest: string, ttlMs: number, hashes?: Record<string, unknown>): void {
  const metaDest = zipDest.replace(/\.zip$/, '.meta');
  const meta: Record<string, unknown> = { expiresAt: Date.now() + ttlMs };
  if (hashes) meta['hashes'] = hashes;
  fs.writeFileSync(metaDest, JSON.stringify(meta));
}

// Middleware: require auth token if configured
function requireUploadToken(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!AUTH_TOKEN) {
    next();
    return;
  } // token not configured → open

  const auth = (req.headers['authorization'] as string) ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ((req.headers['x-auth-token'] as string) ?? '');

  // Constant-time comparison to prevent timing attacks
  let valid = false;
  try {
    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(AUTH_TOKEN);
    valid = tokenBuf.length === expectedBuf.length && crypto.timingSafeEqual(tokenBuf, expectedBuf);
  } catch {
    valid = false;
  }

  if (!valid) {
    res.status(401).json({ error: 'Invalid or missing auth token' });
    return;
  }

  next();
}

// POST /api/dump/import
app.post('/api/dump/import', uploadLimiter, requireUploadToken, async (req, res) => {
  const { url, ttl } = req.body as { url?: unknown; ttl?: unknown };
  if (typeof url !== 'string' || !url) {
    res.status(400).json({ error: 'Missing or invalid url' });
    return;
  }

  if (!isSafeUrl(url)) {
    res.status(400).json({ error: 'URL is not allowed' });
    return;
  }

  let buffer: Buffer;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetchWithSafeRedirects(url, controller.signal);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      res.status(502).json({ error: `Upstream returned an error` });
      return;
    }

    // Stream response with size cap to prevent memory exhaustion
    const reader = response.body?.getReader();
    if (!reader) {
      res.status(502).json({ error: 'No response body from upstream' });
      return;
    }
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_UPLOAD_BYTES) {
        reader.cancel();
        res.status(413).json({ error: 'Remote file exceeds size limit' });
        return;
      }
      chunks.push(value);
    }
    buffer = Buffer.concat(chunks);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      res.status(504).json({ error: 'Request timed out' });
    } else {
      res.status(502).json({ error: 'Failed to fetch URL' });
    }
    return;
  }

  let id: string;
  try {
    id = validateAndExtractManifestId(buffer);
  } catch {
    res.status(422).json({ error: 'Failed to read manifest: invalid or unsupported dump file' });
    return;
  }

  const dest = path.join(DUMPS_DIR, `${id}.zip`);
  try {
    writeFileAtomic(dest, buffer);
    writeMeta(dest, parseTtlMs(ttl), extractManifestHashes(buffer));
  } catch {
    res.status(500).json({ error: 'Failed to save dump' });
    return;
  }

  res.json({ id, url: '/api/dump/' + id });
});

// POST /api/dump/upload
app.post('/api/dump/upload', uploadLimiter, requireUploadToken, upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const buffer = req.file.buffer;
  const ttl = (req.body as Record<string, unknown>)?.['ttl'];

  let id: string;
  try {
    id = validateAndExtractManifestId(buffer);
  } catch {
    res.status(422).json({ error: 'Failed to read manifest: invalid or unsupported dump file' });
    return;
  }

  const dest = path.join(DUMPS_DIR, `${id}.zip`);
  try {
    writeFileAtomic(dest, buffer);
    writeMeta(dest, parseTtlMs(ttl), extractManifestHashes(buffer));
  } catch {
    res.status(500).json({ error: 'Failed to save dump' });
    return;
  }

  res.json({ id, url: '/api/dump/' + id });
});

// GET /api/dump/:id
app.get('/api/dump/:id', (req, res) => {
  const id = req.params['id'] as string;

  if (!isValidId(id)) {
    res.status(400).json({ error: 'Invalid dump id' });
    return;
  }

  const filePath = path.join(DUMPS_DIR, `${id}.zip`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // Add expiry header if sidecar meta exists
  const metaPath = path.join(DUMPS_DIR, `${id}.meta`);
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { expiresAt: number };
      const expiresDate = new Date(meta.expiresAt);
      res.setHeader('X-Expires-At', expiresDate.toISOString());
      res.setHeader('Expires', expiresDate.toUTCString());
    } catch {
      /* ignore missing or malformed meta */
    }
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${id}.zip"`);
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to read dump' });
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
});

// GET /api/dump/:id/manifest — returns parsed manifest.json from the stored zip (public)
app.get('/api/dump/:id/manifest', (req, res) => {
  const id = req.params['id'] as string;

  if (!isValidId(id)) {
    res.status(400).json({ error: 'Invalid dump id' });
    return;
  }

  const filePath = path.join(DUMPS_DIR, `${id}.zip`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  try {
    const zip = new AdmZip(filePath);
    const manifestEntry = zip.getEntry('manifest.json');
    if (!manifestEntry) {
      res.status(422).json({ error: 'No manifest.json in stored zip' });
      return;
    }
    const manifest = JSON.parse(manifestEntry.getData().toString('utf-8')) as unknown;
    res.json(manifest);
  } catch {
    res.status(500).json({ error: 'Failed to read manifest' });
  }
});

// DELETE /api/dump/:id
app.delete('/api/dump/:id', requireUploadToken, (req, res) => {
  const id = req.params['id'] as string;

  if (!isValidId(id)) {
    res.status(400).json({ error: 'Invalid dump id' });
    return;
  }

  const filePath = path.join(DUMPS_DIR, `${id}.zip`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  try {
    fs.unlinkSync(filePath);
    try {
      fs.unlinkSync(path.join(DUMPS_DIR, `${id}.meta`));
    } catch {
      /* no sidecar is fine */
    }
  } catch {
    res.status(500).json({ error: 'Failed to delete dump' });
    return;
  }

  res.status(204).send();
});

// GET /api/dumps
app.get('/api/dumps', requireUploadToken, (_req, res) => {
  let files: string[];
  try {
    files = fs.readdirSync(DUMPS_DIR).filter((f) => f.endsWith('.zip'));
  } catch {
    res.status(500).json({ error: 'Failed to list dumps' });
    return;
  }

  const dumps = files
    .map((file) => {
      const id = file.slice(0, -4); // strip .zip
      try {
        const stat = fs.statSync(path.join(DUMPS_DIR, file));
        const metaPath = path.join(DUMPS_DIR, `${id}.meta`);
        let expiresAt: number;
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { expiresAt: number };
          expiresAt = meta.expiresAt;
        } else {
          expiresAt = stat.mtimeMs + ONE_YEAR_MS;
        }
        return { id, size: stat.size, createdAt: stat.mtime.toISOString(), expiresAt: new Date(expiresAt).toISOString() };
      } catch {
        return null;
      }
    })
    .filter((d): d is { id: string; size: number; createdAt: string; expiresAt: string } => d !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ dumps });
});

// GET /health
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Serve frontend static files in production
if (process.env.NODE_ENV === 'production') {
  const frontendDir = path.resolve(
    process.env.FRONTEND_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'dist'),
  );
  app.use(express.static(frontendDir));
  // Fallback to index.html for SPA routing
  app.use((_req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
  });
}
