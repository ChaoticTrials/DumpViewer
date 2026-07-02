import { describe, it, expect } from 'vitest';
import { sortByExpirySoonest, formatManifestFormat } from './adminDumps';

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
