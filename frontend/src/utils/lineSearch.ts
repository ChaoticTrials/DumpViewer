/**
 * Plain-substring, case-insensitive line search shared by the log and crash-report
 * viewers. Deliberately not regex: log lines are full of `[`, `.` and `:` and users
 * paste fragments verbatim, so metacharacters must stay literal.
 */

export interface NumberedLine {
  /** 1-based line number in the source file. */
  index: number;
  text: string;
}

/** Trim + lowercase. A whitespace-only query normalizes to `''` (= match everything). */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase();
}

/** True when `text` contains `query` (case-insensitively). An empty query matches everything. */
export function matchesQuery(text: string, query: string): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  return text.toLowerCase().includes(q);
}

/**
 * Splits content into 1-based numbered lines. A trailing newline does not produce a
 * phantom final line; interior blank lines are kept so numbering matches the source.
 */
export function splitNumberedLines(content: string): NumberedLine[] {
  if (content === '') return [];
  const raw = content.split('\n');
  if (raw[raw.length - 1] === '') raw.pop();
  return raw.map((text, i) => ({ index: i + 1, text }));
}

/** Filters lines by query, preserving their original indexes. An empty query is the identity. */
export function filterNumberedLines(lines: NumberedLine[], query: string): NumberedLine[] {
  const q = normalizeQuery(query);
  if (!q) return lines;
  return lines.filter((line) => line.text.toLowerCase().includes(q));
}
