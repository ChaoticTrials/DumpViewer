import type { CategorizedFiles, DumpFile } from '../v1/types';
import type { Manifest as ManifestV2 } from '../v2/types';
import { categorizeFiles as categorizeFilesV2 } from '../v2/zipParser';
import type { Manifest } from './types';

// parseDump is identical to v1 — v3 zip structure is unchanged, the manifest
// JSON is returned as-is.
export { parseDump } from '../v1/zipParser';

// categorizeFiles logic is identical to v2 (same zip layout); only the
// manifest_version literal type differs, so delegate rather than duplicate.
export function categorizeFiles(manifest: Manifest, files: Map<string, DumpFile>): CategorizedFiles {
  return categorizeFilesV2(manifest as unknown as ManifestV2, files);
}
