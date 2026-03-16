import type { Manifest as ManifestV1, DumpFile, CategorizedFiles } from './v1/types';
import type { Manifest as ManifestV2 } from './v2/types';
import { parseDump as parseDumpV1, categorizeFiles as categorizeFilesV1 } from './v1/zipParser';
import { categorizeFiles as categorizeFilesV2 } from './v2/zipParser';

export type { DumpFile, CategorizedFiles, ConfigEntry, SelectedFile } from './v1/types';
export type { ManifestV1, ManifestV2 };
export type { ModHashes } from './v2/types';

export type AnyManifest = ManifestV1 | ManifestV2;

export interface ParsedDump {
  manifest: AnyManifest;
  files: Map<string, DumpFile>;
}

/**
 * Parse a raw manifest object (already JSON.parsed) and return it typed correctly.
 * Throws for unknown manifest versions.
 */
export function parseManifest(raw: unknown): ManifestV1 | ManifestV2 {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('manifest must be an object');
  }
  const m = raw as Record<string, unknown>;
  const version = m['manifest_version'];
  if (version === 1) return raw as ManifestV1;
  if (version === 2) return raw as ManifestV2;
  throw new Error(`Unknown manifest_version: ${String(version)}`);
}

/**
 * Parse a dump zip File. Detects manifest version and returns a typed ParsedDump.
 */
export async function parseDump(file: File): Promise<ParsedDump> {
  // parseDumpV1 reads the zip identically for all versions; the manifest JSON
  // is returned as-is (extra fields like `hashes` are present in the raw data).
  const result = await parseDumpV1(file);
  return result as unknown as ParsedDump;
}

/**
 * Categorize files from a parsed dump, routing to the version-appropriate logic.
 */
export function categorizeFiles(manifest: AnyManifest, files: Map<string, DumpFile>): CategorizedFiles {
  if (manifest.manifest_version === 2) {
    return categorizeFilesV2(manifest as ManifestV2, files);
  }
  return categorizeFilesV1(manifest as ManifestV1, files);
}

export { formatBytes } from './v1/zipParser';
