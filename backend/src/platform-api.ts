const USER_AGENT = 'ChaoticTrials/DumpViewer';

// ── CurseForge ────────────────────────────────────────────────

interface CfFileEntry {
  project: number;
  file: number;
  name: string;
  versions: string[];
}

export interface CfModEntry {
  projectID: number | string;
  fileID: number;
  required: true;
}

export async function lookupCurseForgeFile(
  cfId: number | string,
  mcVersion: string,
  modVersion: string,
  signal: AbortSignal,
): Promise<CfModEntry | null> {
  try {
    const res = await fetch(`https://curse.moddingx.org/project/${cfId}/files`, {
      headers: { 'User-Agent': USER_AGENT },
      signal,
    });
    if (!res.ok) return null;
    const entries = (await res.json()) as CfFileEntry[];
    const match = entries.find((e) => e.versions.includes(mcVersion) && e.name.includes(modVersion));
    if (!match) return null;
    return { projectID: cfId, fileID: match.file, required: true };
  } catch {
    return null;
  }
}

// ── Modrinth ──────────────────────────────────────────────────

interface MrVersionFile {
  url: string;
  filename: string;
  primary: boolean;
  hashes: { sha1: string; sha512: string };
  size: number;
}

interface MrVersionEntry {
  version_number: string;
  files: MrVersionFile[];
}

export interface MrModEntry {
  path: string;
  hashes: { sha1: string; sha512: string };
  env: { client: 'required'; server: 'required' };
  downloads: string[];
  fileSize: number;
}

export async function lookupModrinthVersion(
  mrId: string,
  mcVersion: string,
  modVersion: string,
  loaderName: string | null,
  signal: AbortSignal,
): Promise<MrModEntry | null> {
  const loaderParam = loaderName ? `&loaders=["${loaderName}"]` : '';
  try {
    const res = await fetch(
      `https://api.modrinth.com/v2/project/${mrId}/version?game_versions=["${mcVersion}"]${loaderParam}`,
      { headers: { 'User-Agent': USER_AGENT }, signal },
    );
    if (!res.ok) return null;
    const entries = (await res.json()) as MrVersionEntry[];
    const match = entries.find(
      (e) => e.version_number === modVersion || e.version_number.endsWith('-' + modVersion),
    );
    if (!match) return null;
    const file = match.files.find((f) => f.primary) ?? match.files[0];
    if (!file) return null;
    return {
      path: `mods/${file.filename}`,
      hashes: { sha1: file.hashes.sha1, sha512: file.hashes.sha512 },
      env: { client: 'required', server: 'required' },
      downloads: [file.url],
      fileSize: file.size,
    };
  } catch {
    return null;
  }
}
