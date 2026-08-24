import type { Manifest as ManifestV2 } from '../v2/types';

// Re-export all unchanged v1 types
export type { ModHashes, DumpFile, ParsedDump, CategorizedFiles, SelectedFile, ConfigEntry } from '../v2/types';

// v3 Manifest: same as v2 (already has hashes), just manifest_version = 3
export interface Manifest extends Omit<ManifestV2, 'manifest_version'> {
  manifest_version: 3;
}
