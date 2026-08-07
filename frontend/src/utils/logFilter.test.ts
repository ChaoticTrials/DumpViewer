import { describe, it, expect } from 'vitest';
import { parseLog, countByLevel, entryText, filterLogEntries, LOG_LEVELS, type LogLevel } from './logFilter';

const all = () => new Set<LogLevel>(LOG_LEVELS);

describe('parseLog', () => {
  it('returns one entry per recognised level line, in order', () => {
    const content = [
      '[10:00:00] [main/INFO]: Starting',
      '[10:00:01] [main/WARN]: Careful',
      '[10:00:02] [main/ERROR]: Boom',
      '[10:00:03] [main/FATAL]: Dead',
      '[10:00:04] [main/DEBUG]: Chatter',
    ].join('\n');

    expect(parseLog(content).map((e) => e.level)).toEqual(['INFO', 'WARN', 'ERROR', 'FATAL', 'DEBUG']);
  });

  it('uses the source line number as the entry index', () => {
    const content = ['[10:00:00] [main/INFO]: one', '[10:00:01] [main/WARN]: two'].join('\n');
    expect(parseLog(content).map((e) => e.index)).toEqual([1, 2]);
  });

  it('attaches continuation lines to the preceding entry', () => {
    const content = [
      '[10:00:00] [main/INFO]: Starting',
      '[10:00:01] [main/ERROR]: Boom',
      '\tat net.minecraft.Foo.bar(Foo.java:12)',
      '\tat net.minecraft.Baz.qux(Baz.java:34)',
      '[10:00:02] [main/INFO]: Recovered',
    ].join('\n');

    const entries = parseLog(content);
    expect(entries).toHaveLength(3);
    expect(entries[1].level).toBe('ERROR');
    expect(entries[1].lines).toEqual([
      '[10:00:01] [main/ERROR]: Boom',
      '\tat net.minecraft.Foo.bar(Foo.java:12)',
      '\tat net.minecraft.Baz.qux(Baz.java:34)',
    ]);
    expect(entries[2].index).toBe(5);
  });

  it('skips blank lines but still advances the line counter', () => {
    const content = ['[10:00:00] [main/INFO]: one', '', '[10:00:01] [main/WARN]: two'].join('\n');
    const entries = parseLog(content);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.index)).toEqual([1, 3]);
  });

  it('treats a continuation line with no preceding entry as an UNKNOWN entry', () => {
    const content = ['some banner text', '[10:00:00] [main/INFO]: one'].join('\n');
    const entries = parseLog(content);
    expect(entries[0]).toEqual({ index: 1, level: 'UNKNOWN', lines: ['some banner text'] });
    expect(entries[1].level).toBe('INFO');
  });

  it('returns no entries for empty or whitespace-only content', () => {
    expect(parseLog('')).toEqual([]);
    expect(parseLog('\n\n  \n')).toEqual([]);
  });

  it('keeps the trailing carriage return of a CRLF log rather than stripping it', () => {
    const content = '[10:00:00] [main/INFO]: one\r\n[10:00:01] [main/WARN]: two\r\n';
    const entries = parseLog(content);
    expect(entries).toHaveLength(2);
    expect(entries[0].lines[0]).toBe('[10:00:00] [main/INFO]: one\r');
    expect(entries[0].level).toBe('INFO');
  });
});

describe('countByLevel', () => {
  it('counts entries per level and omits levels with no entries', () => {
    const entries = parseLog(
      ['[10:00:00] [main/INFO]: one', '[10:00:01] [main/INFO]: two', '[10:00:02] [main/ERROR]: boom', '\tat Foo.bar'].join('\n'),
    );
    expect(countByLevel(entries)).toEqual({ INFO: 2, ERROR: 1 });
  });

  it('returns an empty object for no entries', () => {
    expect(countByLevel([])).toEqual({});
  });

  it('counts UNKNOWN entries too', () => {
    const entries = parseLog(['banner', '[10:00:00] [main/INFO]: one'].join('\n'));
    expect(countByLevel(entries)).toEqual({ UNKNOWN: 1, INFO: 1 });
  });
});

describe('entryText', () => {
  it('joins the entry lines with newlines', () => {
    const entries = parseLog(['[10:00:00] [main/ERROR]: Boom', '\tat Foo.bar'].join('\n'));
    expect(entryText(entries[0])).toBe('[10:00:00] [main/ERROR]: Boom\n\tat Foo.bar');
  });
});

const SAMPLE = [
  '[10:00:00] [main/INFO]: Loading mod alpha',
  '[10:00:01] [main/WARN]: Deprecated call',
  '\tat net.minecraft.Foo.bar(Foo.java:12)',
  '[10:00:02] [main/ERROR]: Failed to load beta',
  '[10:00:03] [main/DEBUG]: alpha ready',
].join('\n');

describe('filterLogEntries', () => {
  it('returns everything when all levels are active and the query is empty', () => {
    const entries = parseLog(SAMPLE);
    expect(filterLogEntries(entries, all(), '')).toEqual(entries);
  });

  it('filters by level alone', () => {
    const entries = parseLog(SAMPLE);
    const result = filterLogEntries(entries, new Set<LogLevel>(['ERROR']), '');
    expect(result.map((e) => e.level)).toEqual(['ERROR']);
  });

  it('filters by query alone', () => {
    const entries = parseLog(SAMPLE);
    const result = filterLogEntries(entries, all(), 'alpha');
    expect(result.map((e) => e.index)).toEqual([1, 5]);
  });

  it('matches against continuation lines and keeps the whole entry', () => {
    const entries = parseLog(SAMPLE);
    const result = filterLogEntries(entries, all(), 'Foo.java:12');
    expect(result).toHaveLength(1);
    expect(result[0].level).toBe('WARN');
    expect(result[0].lines).toHaveLength(2);
  });

  it('is case-insensitive', () => {
    const entries = parseLog(SAMPLE);
    expect(filterLogEntries(entries, all(), 'FAILED TO LOAD')).toHaveLength(1);
  });

  it('combines level and query with AND', () => {
    const entries = parseLog(SAMPLE);
    // "alpha" appears in an INFO and a DEBUG entry; restricting to DEBUG leaves one.
    const result = filterLogEntries(entries, new Set<LogLevel>(['DEBUG']), 'alpha');
    expect(result.map((e) => e.index)).toEqual([5]);
  });

  it('returns an empty array when the level and the query disagree', () => {
    const entries = parseLog(SAMPLE);
    expect(filterLogEntries(entries, new Set<LogLevel>(['ERROR']), 'alpha')).toEqual([]);
  });

  it('treats a whitespace-only query as no query', () => {
    const entries = parseLog(SAMPLE);
    expect(filterLogEntries(entries, all(), '   ')).toEqual(entries);
  });

  it('treats regex metacharacters in the query literally', () => {
    const entries = parseLog(SAMPLE);
    expect(filterLogEntries(entries, all(), 'F.o.bar')).toEqual([]);
    expect(filterLogEntries(entries, all(), 'Foo.bar')).toHaveLength(1);
  });

  it('does not mutate the input entries', () => {
    const entries = parseLog(SAMPLE);
    const snapshot = JSON.parse(JSON.stringify(entries));
    filterLogEntries(entries, new Set<LogLevel>(['WARN']), 'foo');
    expect(entries).toEqual(snapshot);
  });

  // Lock-in for an existing quirk: UNKNOWN is not one of LOG_LEVELS, so it can never be
  // in activeLevels. Its entries only survive via the "all levels selected" shortcut —
  // deselecting any single level therefore also hides every UNKNOWN entry.
  it('hides UNKNOWN entries as soon as any level is deselected', () => {
    const entries = parseLog(['banner text', '[10:00:00] [main/INFO]: one'].join('\n'));
    expect(filterLogEntries(entries, all(), '').map((e) => e.level)).toEqual(['UNKNOWN', 'INFO']);

    const minusDebug = new Set<LogLevel>(LOG_LEVELS.filter((l) => l !== 'DEBUG'));
    expect(filterLogEntries(entries, minusDebug, '').map((e) => e.level)).toEqual(['INFO']);
  });
});
