import { describe, it, expect } from 'vitest';
import { modpackUrl, ephervexImportUrl, ephervexIssueLink } from './ephervexLink';

const ID = '550e8400-e29b-41d4-a716-446655440000';
const ORIGIN = 'https://dumps.example.com';
const PACK = `${ORIGIN}/api/dump/${ID}/modpack?platform=modrinth`;

describe('modpackUrl', () => {
  it('falls back to the origin when the API base is empty (production same-origin)', () => {
    expect(modpackUrl('', ORIGIN, ID)).toBe(PACK);
  });

  it('uses the API base when one is configured', () => {
    expect(modpackUrl('https://api.example.com', ORIGIN, ID)).toBe(`https://api.example.com/api/dump/${ID}/modpack?platform=modrinth`);
  });

  it('strips trailing slashes from the API base', () => {
    expect(modpackUrl('https://api.example.com//', ORIGIN, ID)).toBe(`https://api.example.com/api/dump/${ID}/modpack?platform=modrinth`);
  });

  it('preserves a path prefix on the API base', () => {
    expect(modpackUrl('https://example.com/dumps', ORIGIN, ID)).toBe(`https://example.com/dumps/api/dump/${ID}/modpack?platform=modrinth`);
  });

  it('returns null for a plaintext http base, which Ephervex refuses to download from', () => {
    expect(modpackUrl('http://localhost:3001', ORIGIN, ID)).toBeNull();
    expect(modpackUrl('', 'http://dumps.example.com', ID)).toBeNull();
  });

  it('returns null for a non-http base', () => {
    expect(modpackUrl('file:///tmp', ORIGIN, ID)).toBeNull();
  });

  it('returns null when neither a base nor an origin resolves to an absolute URL', () => {
    expect(modpackUrl('', '', ID)).toBeNull();
    expect(modpackUrl('', '/relative', ID)).toBeNull();
  });
});

describe('ephervexImportUrl', () => {
  it('wraps an https pack URL in the import scheme', () => {
    expect(ephervexImportUrl(PACK)).toBe(
      `ephervex://import?url=https%3A%2F%2Fdumps.example.com%2Fapi%2Fdump%2F${ID}%2Fmodpack%3Fplatform%3Dmodrinth`,
    );
  });

  it('encodes the nested query string so it round-trips', () => {
    const link = ephervexImportUrl(PACK);
    expect(link).not.toBeNull();
    expect(new URL(link as string).searchParams.get('url')).toBe(PACK);
  });

  it('names import as the action', () => {
    const link = new URL(ephervexImportUrl(`${ORIGIN}/x`) as string);
    expect(link.protocol).toBe('ephervex:');
    expect(link.host).toBe('import');
  });

  it('refuses a plaintext http pack URL, which Ephervex will not download', () => {
    expect(ephervexImportUrl(`http://localhost:3001/api/dump/${ID}/modpack?platform=modrinth`)).toBeNull();
  });

  it('refuses a pack URL carrying credentials, which Ephervex rejects', () => {
    expect(ephervexImportUrl('https://user:pass@dumps.example.com/pack.mrpack')).toBeNull();
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

  it('adds the issue link as its own parameter, encoded so it round-trips', () => {
    const issue = 'https://github.com/o/r/issues/412?x=1&y=2';
    const link = new URL(ephervexImportUrl(PACK, issue) as string);
    expect(link.searchParams.getAll('url')).toEqual([PACK]);
    expect(link.searchParams.get('issue')).toBe(issue);
  });

  it('leaves out an issue link Ephervex would refuse', () => {
    expect(new URL(ephervexImportUrl(PACK, 'javascript:alert(1)') as string).searchParams.has('issue')).toBe(false);
    expect(new URL(ephervexImportUrl(PACK, 'https://example.com/a b') as string).searchParams.has('issue')).toBe(false);
  });

  it('leaves the issue parameter out when there is none', () => {
    expect(new URL(ephervexImportUrl(PACK, null) as string).searchParams.has('issue')).toBe(false);
  });
});

describe('ephervexIssueLink', () => {
  it('prefers the link stored with the dump', () => {
    expect(ephervexIssueLink('https://github.com/o/r/issues/412', ORIGIN, ID)).toBe('https://github.com/o/r/issues/412');
  });

  it('falls back to the dump page when nothing is stored', () => {
    expect(ephervexIssueLink(null, ORIGIN, ID)).toBe(`${ORIGIN}/${ID}`);
    expect(ephervexIssueLink(undefined, ORIGIN, ID)).toBe(`${ORIGIN}/${ID}`);
    expect(ephervexIssueLink('', ORIGIN, ID)).toBe(`${ORIGIN}/${ID}`);
  });

  it('accepts plaintext http, as Ephervex does for issue links', () => {
    expect(ephervexIssueLink('http://tracker.example.com/1', ORIGIN, ID)).toBe('http://tracker.example.com/1');
    expect(ephervexIssueLink(null, 'http://localhost:5173', ID)).toBe(`http://localhost:5173/${ID}`);
  });

  it('falls back to the dump page for a stored link Ephervex would refuse', () => {
    const page = `${ORIGIN}/${ID}`;
    expect(ephervexIssueLink('javascript:alert(1)', ORIGIN, ID)).toBe(page);
    expect(ephervexIssueLink('https://user:pass@example.com/1', ORIGIN, ID)).toBe(page);
    expect(ephervexIssueLink('https://example.com/a b', ORIGIN, ID)).toBe(page);
    expect(ephervexIssueLink(`https://example.com/${'a'.repeat(2048)}`, ORIGIN, ID)).toBe(page);
    expect(ephervexIssueLink('not a url', ORIGIN, ID)).toBe(page);
  });

  it('returns null when neither the stored link nor the dump page is usable', () => {
    expect(ephervexIssueLink(null, '', ID)).toBeNull();
    expect(ephervexIssueLink('javascript:alert(1)', 'file://', ID)).toBeNull();
  });
});
