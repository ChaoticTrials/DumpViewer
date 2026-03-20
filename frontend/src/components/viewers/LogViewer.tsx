import { useState, useMemo } from 'react';

type Level = 'INFO' | 'WARN' | 'ERROR' | 'FATAL' | 'DEBUG' | 'UNKNOWN';

interface LogEntry {
  index: number;
  level: Level;
  lines: string[];
}

const LOG_PATTERN = /^\[.*?] \[.*?\/(INFO|WARN|ERROR|FATAL|DEBUG)]/;

function parseLine(line: string): Level {
  const m = line.match(LOG_PATTERN);
  if (!m) return 'UNKNOWN';
  return m[1] as Level;
}

function parseLog(content: string): LogEntry[] {
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

const LEVELS: Level[] = ['INFO', 'WARN', 'ERROR', 'FATAL', 'DEBUG'];

interface Props {
  content: string;
}

export default function LogViewer({ content }: Props) {
  const entries = useMemo(() => parseLog(content), [content]);
  const [activeLevels, setActiveLevels] = useState<Set<Level>>(new Set(['INFO', 'WARN', 'ERROR', 'FATAL', 'DEBUG']));

  const counts = useMemo(() => {
    const c: Partial<Record<Level, number>> = {};
    for (const e of entries) c[e.level] = (c[e.level] ?? 0) + 1;
    return c;
  }, [entries]);

  const allSelected = LEVELS.every((l) => activeLevels.has(l));
  const filtered = allSelected ? entries : entries.filter((e) => activeLevels.has(e.level));

  function toggleLevel(lvl: Level) {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });
  }

  return (
    <div className="log-container">
      <div className="log-toolbar">
        <span className="log-toolbar-label">Filter:</span>
        {LEVELS.map((lvl) => (
          <button
            key={lvl}
            className={`log-filter-btn${activeLevels.has(lvl) ? ` active-${lvl.toLowerCase()}` : ''}`}
            onClick={() => toggleLevel(lvl)}
          >
            {lvl} {counts[lvl] ? `(${counts[lvl]})` : ''}
          </button>
        ))}
        {!allSelected && (
          <button className="log-filter-btn" onClick={() => setActiveLevels(new Set(LEVELS))}>
            Reset
          </button>
        )}
      </div>
      <div className="log-lines">
        {filtered.map((entry) => (
          <div key={entry.index} className={`log-line ${entry.level}`}>
            <span className="log-lineno">{entry.index}</span>
            <span className="log-text">{entry.lines.join('\n')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
