export interface CrashReportSummary {
  description: string;
  exception: string;
}

/**
 * Pulls the `Description:` line and the leading exception out of a Minecraft crash
 * report. Moved verbatim out of CrashReportViewer so it can be unit-tested.
 */
export function parseCrashReport(content: string): CrashReportSummary {
  const lines = content.split('\n');
  let description = '';
  let exception = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('Description:')) {
      description = line.replace('Description:', '').trim();
    }
    // Exception line: starts with a known exception class or "net." / "java." etc.
    if (
      !exception &&
      description &&
      (line.match(/^[a-z][\w.]+Exception:/) || line.match(/^[a-z][\w.]+Error:/) || line.match(/^\w[\w.]+Exception$/))
    ) {
      // Collect multiline exception (may span several lines before "at ...")
      const excLines: string[] = [line];
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const next = lines[j].trim();
        if (next.startsWith('at ') || next.startsWith('Stacktrace:') || next === '') break;
        excLines.push(next);
      }
      exception = excLines.join('\n');
    }
  }

  return { description, exception };
}
