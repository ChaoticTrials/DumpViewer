/** One entry from GET /api/dumps. `manifestVersion`/`versions` are null for unreadable zips. */
export interface DumpListEntry {
  id: string;
  size: number;
  createdAt: string;
  expiresAt: string;
  manifestVersion: number | null;
  versions: Record<string, string> | null;
  /** Optional display label. Absent in the sidecar is reported as null. */
  name: string | null;
  /** Optional http(s) link back to wherever this dump came from. */
  link: string | null;
}

/** The editable metadata fields, as returned by PATCH /api/dump/:id. */
export interface DumpMetadata {
  name: string | null;
  link: string | null;
}

/** Sort dumps so the ones expiring soonest come first. Non-mutating. */
export function sortByExpirySoonest<T extends { expiresAt: string }>(dumps: T[]): T[] {
  return [...dumps].sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
}

/** Display label for a dump's manifest format version. */
export function formatManifestFormat(version: number | null): string {
  return typeof version === 'number' ? `v${version}` : '—';
}

/** Label for a dump: its name if set, otherwise its id as a placeholder. */
export function formatDumpLabel(dump: { id: string; name: string | null }): string {
  const name = dump.name?.trim();
  return name ? name : dump.id;
}

/**
 * Whether a stored link is safe to render as an `<a href>`. Defence in depth:
 * the backend already rejects non-http(s) links, but a hand-edited sidecar
 * could still smuggle a `javascript:` URL into the admin panel.
 */
export function isDisplayableLink(link: string | null): boolean {
  return parseHttpUrl(link) !== null;
}

/** Hostname of a link, for a compact table cell. Null when it isn't a usable http(s) URL. */
export function linkHostLabel(link: string | null): string | null {
  return parseHttpUrl(link)?.hostname ?? null;
}

function parseHttpUrl(link: string | null): URL | null {
  if (!link) return null;
  const trimmed = link.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
}

/**
 * Merge updated metadata into the dump list, replacing only the matching entry.
 * Non-mutating, order-preserving, and a no-op for an unknown id — used instead
 * of a refetch so an edit doesn't re-sort the table and make the row jump.
 */
export function applyDumpMetadata<T extends { id: string }>(dumps: T[], id: string, metadata: DumpMetadata): T[] {
  return dumps.map((dump) => (dump.id === id ? { ...dump, name: metadata.name, link: metadata.link } : dump));
}
