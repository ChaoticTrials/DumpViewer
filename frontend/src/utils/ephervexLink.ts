// Deep links that hand a generated modpack to the Ephervex launcher.
//
// `ephervex://import?url=<pack url>` carries an absolute, publicly reachable URL:
// the launcher runs outside the browser, so a relative `/api/...` path it could
// not resolve is worse than no link at all. Only http(s) pack URLs are ever
// wrapped — a misconfigured API base must not be able to hand the launcher a
// `file:` or `data:` URL to open.

export type ModpackPlatform = 'curseforge' | 'modrinth';

const HTTP_SCHEMES = ['http:', 'https:'];

/** Absolute URL of the modpack endpoint, or `null` if the base is not http(s). */
export function modpackUrl(apiBase: string, origin: string, id: string, platform: ModpackPlatform): string | null {
  const base = (apiBase || origin).replace(/\/+$/, '');
  let resolved: URL;
  try {
    resolved = new URL(`${base}/api/dump/${encodeURIComponent(id)}/modpack?platform=${platform}`);
  } catch {
    return null;
  }
  return HTTP_SCHEMES.includes(resolved.protocol) ? resolved.href : null;
}

/** `ephervex://import?url=…` for an http(s) pack URL, or `null` for anything else. */
export function ephervexImportUrl(packUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(packUrl);
  } catch {
    return null;
  }
  if (!HTTP_SCHEMES.includes(parsed.protocol)) return null;
  return `ephervex://import?${new URLSearchParams({ url: parsed.href }).toString()}`;
}
