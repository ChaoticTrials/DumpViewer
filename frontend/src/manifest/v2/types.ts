import type { Manifest as ManifestV1, ConfigEntry as ConfigEntryV1 } from '../v1/types';

export interface ModHashes {
  md5: string;
  sha1: string;
  sha512: string;
}

// Re-export all unchanged v1 types
export type { DumpFile, ParsedDump, CategorizedFiles, SelectedFile } from '../v1/types';

// v2 Manifest: same as v1 but manifest_version = 2 and adds hashes
export interface Manifest extends Omit<ManifestV1, 'manifest_version'> {
  manifest_version: 2;
  hashes: Record<string, ModHashes>;
}

// v2 ConfigEntry: changed-values are always unified diff (.diff), never json5
export interface ConfigEntry extends Omit<ConfigEntryV1, 'changedFormat'> {
  changedFormat: 'diff' | null;
}
