import { describe, it, expect } from 'vitest';
import {
  sortByExpirySoonest,
  formatManifestFormat,
  formatDumpLabel,
  isDisplayableLink,
  linkHostLabel,
  applyDumpMetadata,
  type DumpListEntry,
} from './adminDumps';

function makeDump(overrides: Partial<DumpListEntry> = {}): DumpListEntry {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    size: 1024,
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    manifestVersion: 1,
    versions: null,
    name: null,
    link: null,
    ...overrides,
  };
}

describe('sortByExpirySoonest', () => {
  it('sorts ascending by expiresAt (soonest first)', () => {
    const dumps = [
      { id: 'c', expiresAt: '2027-01-01T00:00:00.000Z' },
      { id: 'a', expiresAt: '2026-08-01T00:00:00.000Z' },
      { id: 'b', expiresAt: '2026-12-01T00:00:00.000Z' },
    ];
    expect(sortByExpirySoonest(dumps).map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('places already-expired dumps first', () => {
    const dumps = [
      { id: 'future', expiresAt: '2099-01-01T00:00:00.000Z' },
      { id: 'expired', expiresAt: '2020-01-01T00:00:00.000Z' },
    ];
    expect(sortByExpirySoonest(dumps).map((d) => d.id)).toEqual(['expired', 'future']);
  });

  it('does not mutate the input array', () => {
    const dumps = [
      { id: 'b', expiresAt: '2027-01-01T00:00:00.000Z' },
      { id: 'a', expiresAt: '2026-01-01T00:00:00.000Z' },
    ];
    const copy = [...dumps];
    sortByExpirySoonest(dumps);
    expect(dumps).toEqual(copy);
  });

  it('handles an empty array', () => {
    expect(sortByExpirySoonest([])).toEqual([]);
  });
});

describe('formatManifestFormat', () => {
  it('formats known versions as v<n>', () => {
    expect(formatManifestFormat(1)).toBe('v1');
    expect(formatManifestFormat(2)).toBe('v2');
  });

  it('returns a dash for null', () => {
    expect(formatManifestFormat(null)).toBe('—');
  });
});

describe('formatDumpLabel', () => {
  it('returns the name when set', () => {
    expect(formatDumpLabel(makeDump({ name: 'Issue #412' }))).toBe('Issue #412');
  });

  it('falls back to the id when the name is null', () => {
    const dump = makeDump({ name: null });
    expect(formatDumpLabel(dump)).toBe(dump.id);
  });

  it('falls back to the id when the name is empty or whitespace-only', () => {
    const dump = makeDump({ name: '' });
    expect(formatDumpLabel(dump)).toBe(dump.id);
    expect(formatDumpLabel(makeDump({ name: '   ' }))).toBe(dump.id);
  });

  it('trims a padded name', () => {
    expect(formatDumpLabel(makeDump({ name: '  Padded  ' }))).toBe('Padded');
  });
});

describe('isDisplayableLink', () => {
  it('accepts http and https', () => {
    expect(isDisplayableLink('https://github.com/o/r/issues/412')).toBe(true);
    expect(isDisplayableLink('http://example.com/x')).toBe(true);
  });

  it('rejects null, empty and whitespace', () => {
    expect(isDisplayableLink(null)).toBe(false);
    expect(isDisplayableLink('')).toBe(false);
    expect(isDisplayableLink('   ')).toBe(false);
  });

  it('rejects dangerous or unsupported schemes', () => {
    expect(isDisplayableLink('javascript:alert(1)')).toBe(false);
    expect(isDisplayableLink('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isDisplayableLink('ftp://example.com/x')).toBe(false);
    expect(isDisplayableLink('file:///etc/passwd')).toBe(false);
  });

  it('rejects garbage that is not a URL', () => {
    expect(isDisplayableLink('not a url')).toBe(false);
    expect(isDisplayableLink('example.com/x')).toBe(false);
  });
});

describe('linkHostLabel', () => {
  it('returns the hostname of a valid URL', () => {
    expect(linkHostLabel('https://github.com/o/r/issues/412')).toBe('github.com');
    expect(linkHostLabel('http://issues.example.co.uk:8080/a/b')).toBe('issues.example.co.uk');
  });

  it('returns null for null, invalid URLs and non-http schemes', () => {
    expect(linkHostLabel(null)).toBeNull();
    expect(linkHostLabel('')).toBeNull();
    expect(linkHostLabel('not a url')).toBeNull();
    expect(linkHostLabel('javascript:alert(1)')).toBeNull();
  });
});

describe('applyDumpMetadata', () => {
  const a = makeDump({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  const b = makeDump({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'B' });

  it('updates only the matching entry', () => {
    const result = applyDumpMetadata([a, b], a.id, { name: 'Updated', link: 'https://example.com/x' });
    expect(result[0].name).toBe('Updated');
    expect(result[0].link).toBe('https://example.com/x');
    expect(result[1]).toEqual(b);
  });

  it('returns a new array and does not mutate the input', () => {
    const input = [a, b];
    const result = applyDumpMetadata(input, a.id, { name: 'Updated', link: null });
    expect(result).not.toBe(input);
    expect(input[0].name).toBeNull();
  });

  it('preserves order and every other field', () => {
    const result = applyDumpMetadata([a, b], b.id, { name: null, link: null });
    expect(result.map((d) => d.id)).toEqual([a.id, b.id]);
    expect(result[1]).toEqual({ ...b, name: null, link: null });
  });

  it('is a no-op for an unknown id', () => {
    const result = applyDumpMetadata([a, b], 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', { name: 'X', link: null });
    expect(result).toEqual([a, b]);
  });

  it('handles an empty list', () => {
    expect(applyDumpMetadata([], a.id, { name: 'X', link: null })).toEqual([]);
  });
});
