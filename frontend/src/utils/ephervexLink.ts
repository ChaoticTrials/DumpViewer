// Deep links that hand a generated modpack to the Ephervex launcher.
//
// `ephervex://import?url=<pack url>&issue=<issue url>` carries an absolute,
// publicly reachable pack URL: the launcher runs outside the browser, so a
// relative `/api/...` path it could not resolve is worse than no link at all.
//
// The pack URL must be https. Release builds of Ephervex refuse to download a
// pack over plaintext http, or from an address carrying credentials, so a link
// naming one could only ever fail after the user had already confirmed it. That
// also means the link cannot work against a plain-http dev backend.
//
// `issue` names what the imported instance reproduces, the way Ephervex's Case
// record does. Ephervex's rules for that are looser (http is fine) but stricter
// about shape, so a stored link it would refuse is replaced by the dump page.

const HTTP_SCHEMES = ['http:', 'https:'];

/** Ephervex's own ceiling for an issue link (`MAX_ISSUE_LINK_BYTES`). */
const MAX_ISSUE_LINK_BYTES = 2048;

function parseAbsolute(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function hasCredentials(url: URL): boolean {
  return url.username !== '' || url.password !== '';
}

/** Absolute https URL of the Modrinth pack endpoint, or `null` if the base cannot serve one. */
export function modpackUrl(apiBase: string, origin: string, id: string): string | null {
  const base = (apiBase || origin).replace(/\/+$/, '');
  const resolved = parseAbsolute(`${base}/api/dump/${encodeURIComponent(id)}/modpack?platform=modrinth`);
  if (!resolved || resolved.protocol !== 'https:' || hasCredentials(resolved)) return null;
  return resolved.href;
}

// Mirrors Ephervex's `validated_issue_link`: no whitespace, controls or
// invisible direction marks; an absolute http(s) address with a host and no
// credentials; at most 2048 bytes.
export function isAcceptableIssueLink(raw: string): boolean {
  if (raw === '' || new TextEncoder().encode(raw).length > MAX_ISSUE_LINK_BYTES) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(raw)) return false;
  if (raw.includes('\\') || !/^https?:\/\/[^/]/i.test(raw)) return false;
  const parsed = parseAbsolute(raw);
  return parsed !== null && HTTP_SCHEMES.includes(parsed.protocol) && parsed.hostname !== '' && !hasCredentials(parsed);
}

/**
 * The issue link to send along: the link stored with the dump (typically its
 * GitHub issue) if Ephervex would accept it, otherwise the dump's own page.
 */
export function ephervexIssueLink(storedLink: string | null | undefined, origin: string, id: string): string | null {
  const stored = storedLink?.trim() ?? '';
  if (isAcceptableIssueLink(stored)) return stored;
  const page = parseAbsolute(`${origin.replace(/\/+$/, '')}/${encodeURIComponent(id)}`);
  return page && isAcceptableIssueLink(page.href) ? page.href : null;
}

/**
 * `ephervex://import?url=…[&issue=…]` for an https pack URL, or `null` for anything else.
 * An issue link Ephervex would refuse is left out rather than sent.
 */
export function ephervexImportUrl(packUrl: string, issueLink?: string | null): string | null {
  const parsed = parseAbsolute(packUrl);
  if (!parsed || parsed.protocol !== 'https:' || hasCredentials(parsed)) return null;
  const params = new URLSearchParams({ url: parsed.href });
  if (issueLink && isAcceptableIssueLink(issueLink)) params.set('issue', issueLink);
  return `ephervex://import?${params.toString()}`;
}
