import { describe, it, expect } from 'vitest';
import { computeDefaultLines } from './configDiff';

describe('computeDefaultLines', () => {
  it('returns an empty set when full and changed are identical', () => {
    const content = '{\n  "a": 1,\n  "b": 2\n}\n';
    expect(computeDefaultLines(content, content)).toEqual(new Set());
  });

  it('marks lines missing from changed as default', () => {
    const full = '"a": 1\n"b": 2\n"c": 3\n';
    const changed = '"b": 2\n';
    expect(computeDefaultLines(full, changed)).toEqual(new Set([1, 3]));
  });

  it('marks every line default when changed shares no lines', () => {
    const full = '"a": 1\n"b": 2\n';
    const changed = '"x": 9\n';
    expect(computeDefaultLines(full, changed)).toEqual(new Set([1, 2]));
  });

  it('handles a realistic json5 config with shared braces', () => {
    const full = ['{', '  "spawnRadius": 10,', '  "seaLevel": 63,', '  "biome": "plains"', '}'].join('\n') + '\n';
    const changed = ['{', '  "seaLevel": 63,', '}'].join('\n') + '\n';
    const result = computeDefaultLines(full, changed);
    // Lines shared with changed ({, seaLevel, }) are "changed values"; the rest are defaults.
    expect(result.has(3)).toBe(false); // seaLevel
    expect(result.has(1)).toBe(false); // {
    expect(result.has(5)).toBe(false); // }
    expect(result.has(2)).toBe(true); // spawnRadius
    expect(result.has(4)).toBe(true); // biome
  });

  it('treats a shared line with differing trailing newline as not shared (current jsdiff behavior)', () => {
    const full = '"a": 1\n"b": 2\n"c": 3';
    const changed = '"b": 2';
    const result = computeDefaultLines(full, changed);
    // changed's line lacks the trailing newline the full config has, so jsdiff
    // sees two different lines and the whole full config counts as default.
    expect(result).toEqual(new Set([1, 2, 3]));
  });

  it('matches the shared line when both sides end without a trailing newline', () => {
    const full = '"a": 1\n"b": 2';
    const changed = '"b": 2';
    const result = computeDefaultLines(full, changed);
    expect(result).toEqual(new Set([1]));
  });

  it('numbers default lines correctly after a multi-line shared block', () => {
    const full = 'x\ny\nz\nd1\nd2\n';
    const changed = 'x\ny\nz\n';
    expect(computeDefaultLines(full, changed)).toEqual(new Set([4, 5]));
  });
});
