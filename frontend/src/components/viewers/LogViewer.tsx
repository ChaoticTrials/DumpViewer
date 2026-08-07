import { useState, useMemo, useDeferredValue } from 'react';
import { parseLog, countByLevel, filterLogEntries, LOG_LEVELS, type LogLevel } from '../../utils/logFilter';
import { normalizeQuery } from '../../utils/lineSearch';
import ViewerSearch from './ViewerSearch';

interface Props {
  content: string;
}

export default function LogViewer({ content }: Props) {
  const entries = useMemo(() => parseLog(content), [content]);
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(() => new Set(LOG_LEVELS));
  const [query, setQuery] = useState('');
  // No debounce timer needed: React drops renders made stale by newer keystrokes.
  const deferredQuery = useDeferredValue(query);

  const counts = useMemo(() => countByLevel(entries), [entries]);

  const allSelected = LOG_LEVELS.every((l) => activeLevels.has(l));
  const filtered = useMemo(() => filterLogEntries(entries, activeLevels, deferredQuery), [entries, activeLevels, deferredQuery]);

  function toggleLevel(lvl: LogLevel) {
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
        {LOG_LEVELS.map((lvl) => (
          <button
            key={lvl}
            className={`log-filter-btn${activeLevels.has(lvl) ? ` active-${lvl.toLowerCase()}` : ''}`}
            onClick={() => toggleLevel(lvl)}
          >
            {lvl} {counts[lvl] ? `(${counts[lvl]})` : ''}
          </button>
        ))}
        {!allSelected && (
          <button className="log-filter-btn" onClick={() => setActiveLevels(new Set(LOG_LEVELS))}>
            Reset
          </button>
        )}
        <ViewerSearch value={query} onChange={setQuery} resultCount={filtered.length} totalCount={entries.length} />
      </div>
      <div className="log-lines">
        {filtered.length === 0 && entries.length > 0 && (
          <div className="viewer-search-empty">
            {normalizeQuery(deferredQuery) ? 'No lines match your search.' : 'No lines match the selected levels.'}
          </div>
        )}
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
