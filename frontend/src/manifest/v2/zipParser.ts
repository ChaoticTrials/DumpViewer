import type { DumpFile, CategorizedFiles, ConfigEntry } from '../v1/types';
import type { Manifest } from './types';

// parseDump is identical to v1 — v2 zip structure is the same, the extra `hashes`
// field is just present in the manifest JSON.
export { parseDump } from '../v1/zipParser';

/**
 * Find a changed-values entry for v2: looks for `config/changed_values/<base>.diff`.
 * There is no json5 fallback — in v2, changed-values are always diff or absent.
 */
function findChangedEntry(files: Map<string, DumpFile>, entryName: string): { path: string | null; format: 'diff' | null } {
  // Strip the last extension to get the base name
  const base = entryName.replace(/\.[^.]+$/, '');
  const diffPath = `config/changed_values/${base}.diff`;
  if (files.has(diffPath)) {
    return { path: diffPath, format: 'diff' };
  }
  return { path: null, format: null };
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
      const changed = findChangedEntry(files, entry.name);
      configs.push({
        name: entry.name,
        fullPath: entry.path,
        changedPath: changed.path,
        changedFormat: changed.format,
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
