// Deep links that hand a generated modpack to the Ephervex launcher.
//
// `ephervex://import?url=<pack url>` carries an absolute, publicly reachable
// pack URL: the launcher runs outside the browser, so a relative `/api/...`
// path it could not resolve is worse than no link at all.
//
// The pack URL must be https. Release builds of Ephervex refuse to download a
// pack over plaintext http, or from an address carrying credentials, so a link
// naming one could only ever fail after the user had already confirmed it. That
// also means the link cannot work against a plain-http dev backend.

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

/** `ephervex://import?url=…` for an https pack URL, or `null` for anything else. */
export function ephervexImportUrl(packUrl: string): string | null {
  const parsed = parseAbsolute(packUrl);
  if (!parsed || parsed.protocol !== 'https:' || hasCredentials(parsed)) return null;
  const params = new URLSearchParams({ url: parsed.href });
  return `ephervex://import?${params.toString()}`;
}
