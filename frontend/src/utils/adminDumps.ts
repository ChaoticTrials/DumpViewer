/** One entry from GET /api/dumps. `manifestVersion`/`versions` are null for unreadable zips. */
export interface DumpListEntry {
  id: string;
  size: number;
  createdAt: string;
  expiresAt: string;
  manifestVersion: number | null;
  versions: Record<string, string> | null;
}

/** Sort dumps so the ones expiring soonest come first. Non-mutating. */
export function sortByExpirySoonest<T extends { expiresAt: string }>(dumps: T[]): T[] {
  return [...dumps].sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
}

/** Display label for a dump's manifest format version. */
export function formatManifestFormat(version: number | null): string {
  return typeof version === 'number' ? `v${version}` : '—';
}
