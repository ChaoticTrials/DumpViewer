import { diffLines } from 'diff';

/**
 * Returns a Set of 1-based line numbers in the full config that are
 * NOT present in the changed_values file (i.e., they are default values).
 * Used for v1 json5 changed-values highlighting.
 */
export function computeDefaultLines(fullContent: string, changedContent: string): Set<number> {
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
