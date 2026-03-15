import JSZip from 'jszip';
import type { Manifest, DumpFile, ParsedDump, CategorizedFiles, ConfigEntry } from '../types';

const BINARY_EXTENSIONS = ['.nbt', '.dat'];

function isBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.some((ext) => path.endsWith(ext));
}

export async function parseDump(file: File): Promise<ParsedDump> {
  const zip = await JSZip.loadAsync(file);

  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) throw new Error('Invalid dump file: missing manifest.json');

  const manifestText = await manifestEntry.async('string');
  const manifest: Manifest = JSON.parse(manifestText);

  const files = new Map<string, DumpFile>();

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || path === 'manifest.json') continue;

    const binary = isBinaryPath(path);
    const name = path.split('/').pop() ?? path;

    if (binary) {
      const buffer = await entry.async('arraybuffer');
      files.set(path, { path, name, content: null, isBinary: true, size: buffer.byteLength, rawBuffer: buffer });
    } else {
      const text = await entry.async('string');
      files.set(path, { path, name, content: text, isBinary: false, size: text.length });
    }
  }

  return { manifest, files };
}

export function categorizeFiles(manifest: Manifest, files: Map<string, DumpFile>): CategorizedFiles {
  const configs: ConfigEntry[] = [];
  const islands: DumpFile[] = [];
  const spreads: DumpFile[] = [];
  const portals: DumpFile[] = [];
  const otherTemplates: DumpFile[] = [];
  const logs: DumpFile[] = [];
  const worldFiles: DumpFile[] = [];

  for (const entry of manifest.files) {
    if (entry.path.startsWith('config/changed_values/')) continue;

    const file = files.get(entry.path);
    if (!file) continue;

    if (entry.path.startsWith('config/')) {
      const changedPath = `config/changed_values/${entry.name}`;
      configs.push({
        name: entry.name,
        fullPath: entry.path,
        changedPath: files.has(changedPath) ? changedPath : null,
      });
    } else if (entry.path.startsWith('templates/islands/')) {
      islands.push(file);
    } else if (entry.path.startsWith('templates/spreads/')) {
      spreads.push(file);
    } else if (entry.path.startsWith('templates/portals/')) {
      portals.push(file);
    } else if (entry.path.startsWith('templates/')) {
      otherTemplates.push(file);
    } else if (entry.path.startsWith('logs/')) {
      logs.push(file);
    } else {
      worldFiles.push(file);
    }
  }

  return { configs, islands, spreads, portals, otherTemplates, logs, worldFiles };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
