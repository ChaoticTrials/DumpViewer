import { describe, it, expect } from 'vitest';
import { normalizeQuery, matchesQuery, splitNumberedLines, filterNumberedLines, type NumberedLine } from './lineSearch';

describe('normalizeQuery', () => {
  it('trims and lowercases', () => {
    expect(normalizeQuery('  ERROR  ')).toBe('error');
  });

  it('returns an empty string for an empty query', () => {
    expect(normalizeQuery('')).toBe('');
  });

  it('returns an empty string for a whitespace-only query', () => {
    expect(normalizeQuery('   \t\n ')).toBe('');
  });

  it('preserves interior whitespace', () => {
    expect(normalizeQuery('  Failed   To Load  ')).toBe('failed   to load');
  });
});

describe('matchesQuery', () => {
  it('matches everything when the query is empty', () => {
    expect(matchesQuery('anything at all', '')).toBe(true);
    expect(matchesQuery('', '')).toBe(true);
  });

  it('matches everything when the query is whitespace only', () => {
    expect(matchesQuery('anything at all', '   ')).toBe(true);
  });

  it('is case-insensitive in both directions', () => {
    expect(matchesQuery('Fatal Error Occurred', 'fatal')).toBe(true);
    expect(matchesQuery('fatal error occurred', 'FATAL')).toBe(true);
  });

  it('matches mid-word substrings', () => {
    expect(matchesQuery('abcdef', 'cde')).toBe(true);
  });

  it('returns false when the substring is absent', () => {
    expect(matchesQuery('abcdef', 'xyz')).toBe(false);
  });

  it('treats regex metacharacters literally', () => {
    expect(matchesQuery('abc', 'a.c')).toBe(false);
    expect(matchesQuery('a.c', 'a.c')).toBe(true);
    expect(matchesQuery('aaa', 'a+')).toBe(false);
    expect(matchesQuery('a+a', 'a+')).toBe(true);
    expect(matchesQuery('abc', '.*')).toBe(false);
    expect(matchesQuery('[main/INFO]', '[main')).toBe(true);
    expect(matchesQuery('net.minecraft.Foo', 'net.minecraft')).toBe(true);
    expect(matchesQuery('netXminecraft', 'net.minecraft')).toBe(false);
  });

  it('treats interior whitespace as significant', () => {
    expect(matchesQuery('a b', 'a  b')).toBe(false);
    expect(matchesQuery('a  b', 'a  b')).toBe(true);
  });

  it('trims the query before matching', () => {
    expect(matchesQuery('hello world', '  world  ')).toBe(true);
  });
});

describe('splitNumberedLines', () => {
  it('returns an empty array for empty content', () => {
    expect(splitNumberedLines('')).toEqual([]);
  });

  it('numbers lines from 1', () => {
    expect(splitNumberedLines('a\nb\nc')).toEqual([
      { index: 1, text: 'a' },
      { index: 2, text: 'b' },
      { index: 3, text: 'c' },
    ]);
  });

  it('does not produce a phantom trailing line for content ending in a newline', () => {
    expect(splitNumberedLines('a\nb\n')).toEqual([
      { index: 1, text: 'a' },
      { index: 2, text: 'b' },
    ]);
  });

  it('keeps interior blank lines and keeps the numbering aligned with the source', () => {
    expect(splitNumberedLines('a\n\nb\n')).toEqual([
      { index: 1, text: 'a' },
      { index: 2, text: '' },
      { index: 3, text: 'b' },
    ]);
  });

  it('treats a lone newline as a single blank line', () => {
    expect(splitNumberedLines('\n')).toEqual([{ index: 1, text: '' }]);
  });

  it('keeps the trailing carriage return of a CRLF file rather than stripping it', () => {
    expect(splitNumberedLines('a\r\nb\r\n')).toEqual([
      { index: 1, text: 'a\r' },
      { index: 2, text: 'b\r' },
    ]);
  });
});

describe('filterNumberedLines', () => {
  const lines: NumberedLine[] = [
    { index: 1, text: 'Loading mod alpha' },
    { index: 2, text: 'Loading mod beta' },
    { index: 3, text: '' },
    { index: 4, text: 'ALPHA finished' },
  ];

  it('is the identity for an empty query', () => {
    expect(filterNumberedLines(lines, '')).toBe(lines);
  });

  it('is the identity for a whitespace-only query', () => {
    expect(filterNumberedLines(lines, '   ')).toBe(lines);
  });

  it('keeps the original indexes of surviving lines', () => {
    expect(filterNumberedLines(lines, 'alpha')).toEqual([
      { index: 1, text: 'Loading mod alpha' },
      { index: 4, text: 'ALPHA finished' },
    ]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterNumberedLines(lines, 'gamma')).toEqual([]);
  });

  it('does not mutate the input', () => {
    const snapshot = JSON.parse(JSON.stringify(lines));
    filterNumberedLines(lines, 'beta');
    expect(lines).toEqual(snapshot);
    expect(lines).toHaveLength(4);
  });
});
