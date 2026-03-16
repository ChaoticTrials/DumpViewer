import { useState, useMemo, type HTMLAttributes } from 'react';
import { diffLines } from 'diff';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { useHighlighterTheme } from '../../utils/useHighlighterTheme';
import { getConfigParseError } from '../../utils/parseConfig';

interface Props {
  fullContent: string;
  changedContent: string | null;
  changedFormat: 'json5' | 'diff' | null;
}

type TabJson5 = 'full' | 'changed';
type TabDiff = 'full' | 'diff';

/**
 * Returns a Set of 1-based line numbers in the full config that are
 * NOT present in the changed_values file (i.e., they are default values).
 * Used for v1 json5 changed-values highlighting.
 */
function computeDefaultLines(fullContent: string, changedContent: string): Set<number> {
  const defaultLines = new Set<number>();
  const parts = diffLines(changedContent, fullContent);

  let lineNum = 1;
  for (const part of parts) {
    const count = part.count ?? 0;
    if (part.added) {
      // Lines only in fullContent => default values
      for (let i = 0; i < count; i++) {
        defaultLines.add(lineNum + i);
      }
      lineNum += count;
    } else if (!part.removed) {
      // Unchanged => present in both => changed value lines
      lineNum += count;
    }
    // removed = only in changedContent, skip (doesn't affect fullContent line numbering)
  }

  return defaultLines;
}

export default function ConfigViewer({ fullContent, changedContent, changedFormat }: Props) {
  const hlStyle = useHighlighterTheme();
  const [tabJson5, setTabJson5] = useState<TabJson5>('full');
  const [tabDiff, setTabDiff] = useState<TabDiff>('full');

  const defaultLines = useMemo(() => {
    if (changedFormat !== 'json5' || !changedContent) return new Set<number>();
    return computeDefaultLines(fullContent, changedContent);
  }, [fullContent, changedContent, changedFormat]);

  const parseError = useMemo(() => getConfigParseError(fullContent), [fullContent]);

  // ── v1 json5 mode ──────────────────────────────────────────────────────
  if (changedFormat === 'json5' && changedContent !== null) {
    const content = tabJson5 === 'changed' ? changedContent : fullContent;
    const showDiffHighlight = tabJson5 === 'full';

    function lineProps(lineNumber: number): HTMLAttributes<HTMLElement> {
      if (!showDiffHighlight) return {};
      if (defaultLines.has(lineNumber)) {
        return { className: 'line-default' };
      }
      return { className: 'line-changed' };
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {parseError && <ParseErrorBanner parseError={parseError} />}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '5px 14px',
            background: 'var(--bg2)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div className="tab-group">
            <button className={`tab-btn${tabJson5 === 'full' ? ' active' : ''}`} onClick={() => setTabJson5('full')}>
              Full Config
            </button>
            <button className={`tab-btn${tabJson5 === 'changed' ? ' active' : ''}`} onClick={() => setTabJson5('changed')}>
              Changes Only
            </button>
          </div>
          {tabJson5 === 'full' && (
            <div className="diff-legend" style={{ padding: 0, background: 'none', border: 'none' }}>
              <div className="legend-item">
                <div className="legend-dot changed" />
                <span>Changed from default</span>
              </div>
              <div className="legend-item">
                <div className="legend-dot default" />
                <span>Default value</span>
              </div>
            </div>
          )}
        </div>
        <div className="code-wrap" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <SyntaxHighlighter
            language="json"
            style={hlStyle}
            showLineNumbers
            wrapLines={showDiffHighlight}
            lineProps={showDiffHighlight ? lineProps : undefined}
            customStyle={{ margin: 0, borderRadius: 0, fontSize: '12.5px', lineHeight: '1.6' }}
            codeTagProps={{ style: { fontFamily: 'var(--mono)' } }}
          >
            {content}
          </SyntaxHighlighter>
        </div>
      </div>
    );
  }

  // ── v2 diff mode ───────────────────────────────────────────────────────
  if (changedFormat === 'diff' && changedContent !== null) {
    const rawDiffLines = changedContent.split('\n');

    function diffLineProps(lineNumber: number): HTMLAttributes<HTMLElement> {
      const line = rawDiffLines[lineNumber - 1] ?? '';
      if (line.startsWith('+++') || line.startsWith('---')) return { className: 'line-diff-meta' };
      if (line.startsWith('+')) return { className: 'line-diff-added' };
      if (line.startsWith('-')) return { className: 'line-diff-removed' };
      if (line.startsWith('@@')) return { className: 'line-diff-hunk' };
      return {};
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {parseError && <ParseErrorBanner parseError={parseError} />}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '5px 14px',
            background: 'var(--bg2)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div className="tab-group">
            <button className={`tab-btn${tabDiff === 'full' ? ' active' : ''}`} onClick={() => setTabDiff('full')}>
              Full Config
            </button>
            <button className={`tab-btn${tabDiff === 'diff' ? ' active' : ''}`} onClick={() => setTabDiff('diff')}>
              Diff
            </button>
          </div>
        </div>
        <div className="code-wrap" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <SyntaxHighlighter
            language={tabDiff === 'diff' ? 'text' : 'json'}
            style={hlStyle}
            showLineNumbers
            wrapLines={tabDiff === 'diff'}
            lineProps={tabDiff === 'diff' ? diffLineProps : undefined}
            customStyle={{ margin: 0, borderRadius: 0, fontSize: '12.5px', lineHeight: '1.6' }}
            codeTagProps={{ style: { fontFamily: 'var(--mono)' } }}
          >
            {tabDiff === 'diff' ? changedContent : fullContent}
          </SyntaxHighlighter>
        </div>
      </div>
    );
  }

  // ── No diff (null) ─────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {parseError && <ParseErrorBanner parseError={parseError} />}
      <div className="code-wrap" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <SyntaxHighlighter
          language="json"
          style={hlStyle}
          showLineNumbers
          customStyle={{ margin: 0, borderRadius: 0, fontSize: '12.5px', lineHeight: '1.6' }}
          codeTagProps={{ style: { fontFamily: 'var(--mono)' } }}
        >
          {fullContent}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

function ParseErrorBanner({ parseError }: { parseError: { message: string; line?: number; hint?: string } }) {
  return (
    <div
      style={{
        padding: '8px 14px',
        background: 'rgba(248,113,113,0.1)',
        borderBottom: '1px solid rgba(248,113,113,0.25)',
        color: 'var(--log-error)',
        fontSize: 12.5,
        flexShrink: 0,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: parseError.hint ? 4 : 0 }}>
        ⚠ JSON parse error{parseError.line ? ` (detected at line ${parseError.line})` : ''}: {parseError.message}
      </div>
      {parseError.hint && (
        <pre
          style={{
            margin: 0,
            fontFamily: 'var(--mono)',
            fontSize: 11.5,
            opacity: 0.85,
            whiteSpace: 'pre-wrap',
          }}
        >
          {parseError.hint}
        </pre>
      )}
    </div>
  );
}
