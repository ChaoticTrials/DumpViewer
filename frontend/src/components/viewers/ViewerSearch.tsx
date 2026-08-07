interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Lines/entries left after filtering. */
  resultCount: number;
  /** Lines/entries in the file before filtering. */
  totalCount: number;
}

/**
 * Presentational search box for the log and crash-report viewers. It filters lines —
 * there is deliberately no match highlighting and no prev/next navigation.
 *
 * `type="text"` rather than `type="search"`: the latter renders a native clear icon in
 * WebKit/Blink that would sit next to our own.
 */
export default function ViewerSearch({ value, onChange, resultCount, totalCount }: Props) {
  const hasQuery = value.trim() !== '';

  return (
    <div className="viewer-search">
      <input
        type="text"
        className="viewer-search-input"
        aria-label="Search lines"
        placeholder="Search…"
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onChange('');
          }
        }}
      />
      {hasQuery && (
        <span className="viewer-search-count">
          {resultCount} / {totalCount}
        </span>
      )}
      {value !== '' && (
        <button type="button" className="viewer-search-clear" aria-label="Clear search" onClick={() => onChange('')}>
          ×
        </button>
      )}
    </div>
  );
}
