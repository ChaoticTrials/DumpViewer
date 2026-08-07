import { normalizeQuery } from './lineSearch';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'FATAL' | 'DEBUG' | 'UNKNOWN';

export interface LogEntry {
  /** 1-based line number of the entry's first line in the source file. */
  index: number;
  level: LogLevel;
  /** The header line plus any continuation lines (stack frames, wrapped output). */
  lines: string[];
}

export const LOG_PATTERN = /^\[.*?] \[.*?\/(INFO|WARN|ERROR|FATAL|DEBUG)]/;

/** The levels offered as filter pills. `UNKNOWN` is deliberately not one of them. */
export const LOG_LEVELS: LogLevel[] = ['INFO', 'WARN', 'ERROR', 'FATAL', 'DEBUG'];

function parseLine(line: string): LogLevel {
  const m = line.match(LOG_PATTERN);
  if (!m) return 'UNKNOWN';
  return m[1] as LogLevel;
}

export function parseLog(content: string): LogEntry[] {
  const rawLines = content.split('\n');
  const entries: LogEntry[] = [];
  let lineNum = 0;

  for (const line of rawLines) {
    lineNum++;
    if (!line.trim()) continue;
    const level = parseLine(line);
    if (level === 'UNKNOWN' && entries.length > 0) {
      entries[entries.length - 1].lines.push(line);
    } else {
      entries.push({ index: lineNum, level, lines: [line] });
    }
  }

  return entries;
}

export function countByLevel(entries: LogEntry[]): Partial<Record<LogLevel, number>> {
  const counts: Partial<Record<LogLevel, number>> = {};
  for (const e of entries) counts[e.level] = (counts[e.level] ?? 0) + 1;
  return counts;
}

/** The full searchable text of an entry: its header line plus every continuation line. */
export function entryText(entry: LogEntry): string {
  return entry.lines.join('\n');
}

/**
 * Filters entries by active levels AND by a plain-substring query. A match anywhere in
 * an entry — including a stack-trace continuation line — keeps the whole entry.
 *
 * Note the pre-existing level quirk this preserves: `UNKNOWN` is not in `LOG_LEVELS`, so
 * it can never be in `activeLevels`. Unlevelled entries survive only via the "every level
 * selected" shortcut, which means deselecting any single pill also hides them.
 */
export function filterLogEntries(entries: LogEntry[], activeLevels: Set<LogLevel>, query: string): LogEntry[] {
  const q = normalizeQuery(query);
  const allSelected = LOG_LEVELS.every((l) => activeLevels.has(l));
  if (allSelected && !q) return entries;

  return entries.filter((entry) => {
    if (!allSelected && !activeLevels.has(entry.level)) return false;
    if (!q) return true;
    return entryText(entry).toLowerCase().includes(q);
  });
}
