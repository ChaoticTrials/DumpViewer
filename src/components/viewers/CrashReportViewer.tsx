import { useMemo } from 'react';

interface Props {
  content: string;
}

function parseCrashReport(content: string) {
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
      (line.match(/^[a-z][\w.]+Exception:/) ||
        line.match(/^[a-z][\w.]+Error:/) ||
        line.match(/^\w[\w.]+Exception$/))
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

export default function CrashReportViewer({ content }: Props) {
  const { description, exception } = useMemo(() => parseCrashReport(content), [content]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {description && (
        <div className="crash-header">
          <p className="crash-title">💥 Crash Report</p>
          <p className="crash-desc">{description}</p>
          {exception && <pre className="crash-exception">{exception}</pre>}
        </div>
      )}
      <div className="crash-body" style={{ flex: 1, overflow: 'auto' }}>
        <pre>{content}</pre>
      </div>
    </div>
  );
}
