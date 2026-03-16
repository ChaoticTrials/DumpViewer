/**
 * Strips // line comments from JSON5-like content and attempts JSON.parse.
 * Returns the parse error message, or undefined if valid.
 */
export interface ConfigParseError {
  message: string;
  line?: number; // 1-based line in the ORIGINAL content
  hint?: string;
}

export function getConfigParseError(content: string): ConfigParseError | undefined {
  // Strip // comments (lines where // appears outside of strings)
  // Simple approach: remove everything from // to end of line,
  // but only when // is not inside a string.
  const stripped = stripLineComments(content);
  try {
    JSON.parse(stripped);
    return undefined;
  } catch (e) {
    if (!(e instanceof SyntaxError)) return { message: String(e) };

    const msg = e.message;
    // Extract line number from the error message (V8: "at line X column Y", Firefox: "at line X")
    const lineMatch = msg.match(/line (\d+)/i);
    const colMatch = msg.match(/column (\d+)/i) ?? msg.match(/position (\d+)/i);

    let line: number | undefined;
    if (lineMatch) {
      line = parseInt(lineMatch[1], 10);
    } else if (colMatch) {
      // Calculate line from character position
      const pos = parseInt(colMatch[1], 10);
      line = stripped.substring(0, pos).split('\n').length;
    }

    // Build a hint: show the problem line and suggest looking one line above for missing commas
    let hint: string | undefined;
    if (line !== undefined) {
      const lines = content.split('\n');
      const errorLine = lines[line - 1];

      if (errorLine !== undefined) {
        hint = `Line ${line}: ${errorLine.trim()}`;
        // Walk backward from the error line to find first non-comment, non-empty line
        let prevLineNum: number | undefined;
        let prevTrimmed: string | undefined;
        for (let i = line - 2; i >= 0; i--) {
          const t = lines[i].trim();
          if (t && !t.startsWith('//')) {
            prevLineNum = i + 1; // 1-based
            prevTrimmed = t;
            break;
          }
        }
        if (
          prevTrimmed !== undefined &&
          prevLineNum !== undefined &&
          !prevTrimmed.endsWith(',') &&
          !prevTrimmed.endsWith('{') &&
          !prevTrimmed.endsWith('[')
        ) {
          hint += `\n→ Possible missing comma after line ${prevLineNum}: ${prevTrimmed}`;
        }
      }
    }

    // Clean up the raw message (remove the "at line X column Y" part, we show it ourselves)
    const cleanMsg = msg.replace(/\s*(in JSON)?\s*at (position \d+|line \d+(,? column \d+)?).*$/i, '').trim();

    return { message: cleanMsg || msg, line, hint };
  }
}

function stripLineComments(input: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let escape = false;

  while (i < input.length) {
    const ch = input[i];

    if (escape) {
      result += ch;
      escape = false;
      i++;
      continue;
    }

    if (ch === '\\' && inString) {
      result += ch;
      escape = true;
      i++;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      i++;
      continue;
    }

    if (!inString && ch === '/' && input[i + 1] === '/') {
      // Skip until end of line
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}
