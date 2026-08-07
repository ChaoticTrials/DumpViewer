import { useDeferredValue, useMemo, useState } from 'react';
import { useIsMobile } from '../../utils/useIsMobile';
import { parseCrashReport } from '../../utils/crashReport';
import { filterNumberedLines, splitNumberedLines } from '../../utils/lineSearch';
import ViewerSearch from './ViewerSearch';

interface Props {
  content: string;
}

export default function CrashReportViewer({ content }: Props) {
  const { description, exception } = useMemo(() => parseCrashReport(content), [content]);
  const isMobile = useIsMobile();
  const [exceptionCollapsed, setExceptionCollapsed] = useState(true);

  const lines = useMemo(() => splitNumberedLines(content), [content]);
  const [query, setQuery] = useState('');
  // No debounce timer needed: React drops renders made stale by newer keystrokes.
  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(() => filterNumberedLines(lines, deferredQuery), [lines, deferredQuery]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {description && (
        <div className="crash-header">
          <p className="crash-title">💥 Crash Report</p>
          <p className="crash-desc">{description}</p>
          {exception && (
            <>
              {isMobile && (
                <button className="crash-exception-toggle" onClick={() => setExceptionCollapsed((v) => !v)}>
                  {exceptionCollapsed ? '▶ Show exception' : '▼ Hide exception'}
                </button>
              )}
              {(!isMobile || !exceptionCollapsed) && <pre className="crash-exception">{exception}</pre>}
            </>
          )}
        </div>
      )}
      <div className="viewer-toolbar">
        <ViewerSearch value={query} onChange={setQuery} resultCount={filtered.length} totalCount={lines.length} />
      </div>
      <div className="crash-body" style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 && lines.length > 0 && <div className="viewer-search-empty">No lines match your search.</div>}
        {filtered.map((line) => (
          <div key={line.index} className="crash-line">
            <span className="crash-lineno">{line.index}</span>
            <span className="crash-text">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
