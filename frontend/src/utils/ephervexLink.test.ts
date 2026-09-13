import { describe, it, expect } from 'vitest';
import { modpackUrl, ephervexImportUrl } from './ephervexLink';

const ID = '550e8400-e29b-41d4-a716-446655440000';
const ORIGIN = 'https://dumps.example.com';

describe('modpackUrl', () => {
  it('falls back to the origin when the API base is empty (production same-origin)', () => {
    expect(modpackUrl('', ORIGIN, ID, 'modrinth')).toBe(`${ORIGIN}/api/dump/${ID}/modpack?platform=modrinth`);
  });

  it('uses the API base when one is configured (dev)', () => {
    expect(modpackUrl('http://localhost:3001', ORIGIN, ID, 'modrinth')).toBe(
      `http://localhost:3001/api/dump/${ID}/modpack?platform=modrinth`,
    );
  });

  it('strips trailing slashes from the API base', () => {
    expect(modpackUrl('https://api.example.com//', ORIGIN, ID, 'curseforge')).toBe(
      `https://api.example.com/api/dump/${ID}/modpack?platform=curseforge`,
    );
  });

  it('preserves a path prefix on the API base', () => {
    expect(modpackUrl('https://example.com/dumps', ORIGIN, ID, 'modrinth')).toBe(
      `https://example.com/dumps/api/dump/${ID}/modpack?platform=modrinth`,
    );
  });

  it('carries the requested platform through', () => {
    expect(modpackUrl('', ORIGIN, ID, 'curseforge')).toContain('platform=curseforge');
  });

  it('returns null for a non-http base', () => {
    expect(modpackUrl('file:///tmp', ORIGIN, ID, 'modrinth')).toBeNull();
  });

  it('returns null when neither a base nor an origin resolves to an absolute URL', () => {
    expect(modpackUrl('', '', ID, 'modrinth')).toBeNull();
    expect(modpackUrl('', '/relative', ID, 'modrinth')).toBeNull();
  });
});

describe('ephervexImportUrl', () => {
  it('wraps an https pack URL in the import scheme', () => {
    const link = ephervexImportUrl(`${ORIGIN}/api/dump/${ID}/modpack?platform=modrinth`);
    expect(link).toBe(`ephervex://import?url=https%3A%2F%2Fdumps.example.com%2Fapi%2Fdump%2F${ID}%2Fmodpack%3Fplatform%3Dmodrinth`);
  });

  it('encodes the nested query string so it round-trips', () => {
    const packUrl = `${ORIGIN}/api/dump/${ID}/modpack?platform=modrinth`;
    const link = ephervexImportUrl(packUrl);
    expect(link).not.toBeNull();
    expect(new URL(link as string).searchParams.get('url')).toBe(packUrl);
  });

  it('names import as the action', () => {
    const link = new URL(ephervexImportUrl(`${ORIGIN}/x`) as string);
    expect(link.protocol).toBe('ephervex:');
    expect(link.host).toBe('import');
  });

  it('accepts a plaintext http pack URL, as used in development', () => {
    const packUrl = `http://localhost:3001/api/dump/${ID}/modpack?platform=modrinth`;
    expect(new URL(ephervexImportUrl(packUrl) as string).searchParams.get('url')).toBe(packUrl);
  });

  it('refuses schemes the launcher must never be handed', () => {
    expect(ephervexImportUrl('file:///etc/passwd')).toBeNull();
    expect(ephervexImportUrl('data:application/zip;base64,UEsDBA==')).toBeNull();
    expect(ephervexImportUrl('ephervex://import?url=https://example.com')).toBeNull();
  });

  it('returns null for a malformed or relative URL', () => {
    expect(ephervexImportUrl('')).toBeNull();
    expect(ephervexImportUrl(`/api/dump/${ID}/modpack?platform=modrinth`)).toBeNull();
  });
});
