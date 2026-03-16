import { useState } from 'react';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { useHighlighterTheme } from '../utils/useHighlighterTheme';
import type { DumpFile, ParsedDump, SelectedFile } from '../manifest/index';
import ConfigViewer from './viewers/ConfigViewer';
import LogViewer from './viewers/LogViewer';
import CrashReportViewer from './viewers/CrashReportViewer';
import BinaryViewer from './viewers/BinaryViewer';
import NbtViewer from './viewers/NbtViewer';

interface Props {
  selected: SelectedFile | null;
  dump: ParsedDump;
}

// Strip RTLO (U+202E), null bytes, and other bidirectional override characters
// that could disguise a filename's apparent extension in the browser save dialog.
function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u202e\u200f\u200e\u202b\u202a\u0000]/g, '');
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filename);
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBinaryFile(filename: string, buffer: ArrayBuffer) {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filename);
  a.click();
  URL.revokeObjectURL(url);
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function getLanguage(name: string): string {
  if (name.endsWith('.json5') || name.endsWith('.json')) return 'json';
  if (name.endsWith('.snbt')) return 'json';
  return 'text';
}

function GenericTextViewer({ file }: { file: DumpFile }) {
  const hlStyle = useHighlighterTheme();
  const content = file.content ?? '';
  return (
    <div className="code-wrap" style={{ height: '100%' }}>
      <SyntaxHighlighter
        language={getLanguage(file.name)}
        style={hlStyle}
        showLineNumbers
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: '12.5px',
          lineHeight: '1.6',
          height: '100%',
          padding: '8px 0',
        }}
        codeTagProps={{ style: { fontFamily: 'var(--mono)' } }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
}

interface FontCtrlProps {
  size: number;
  onDec: () => void;
  onInc: () => void;
  onReset: () => void;
}

function FontCtrl({ size, onDec, onInc, onReset }: FontCtrlProps) {
  return (
    <>
      <div className="font-size-ctrl">
        <button className="font-size-btn" onClick={onDec} title="Decrease font size">
          −
        </button>
        <span className="font-size-val">{size}px</span>
        <button className="font-size-btn" onClick={onInc} title="Increase font size">
          +
        </button>
      </div>
      <button className="action-btn" onClick={onReset} title="Reset font size">
        ↺
      </button>
    </>
  );
}

const DEFAULT_FONT_SIZE = 16;

export default function FileViewer({ selected, dump }: Props) {
  const [viewerFontSize, setViewerFontSize] = useState(DEFAULT_FONT_SIZE);
  const incFont = () => setViewerFontSize((s) => Math.min(s + 1, 24));
  const decFont = () => setViewerFontSize((s) => Math.max(s - 1, 8));
  const resetFont = () => setViewerFontSize(DEFAULT_FONT_SIZE);

  if (!selected) {
    return (
      <div className="viewer-area" style={{ '--viewer-font-size': `${viewerFontSize}px` } as React.CSSProperties}>
        <div className="empty-state">
          <span className="empty-state-icon">👈</span>
          <span className="empty-state-text">Select a file from the sidebar</span>
        </div>
      </div>
    );
  }

  // ── Config file ──────────────────────────────────────────
  if (selected.kind === 'config') {
    const { entry } = selected;
    const fullFile = dump.files.get(entry.fullPath);
    const changedFile = entry.changedPath ? dump.files.get(entry.changedPath) : null;

    if (!fullFile) return null;

    const fullContent = fullFile.content ?? '';
    const changedContent = changedFile?.content ?? null;

    return (
      <div className="viewer-area" style={{ '--viewer-font-size': `${viewerFontSize}px` } as React.CSSProperties}>
        <div className="file-viewer-header">
          <span className="file-viewer-title">{entry.fullPath}</span>
          <div className="file-viewer-actions">
            <FontCtrl size={viewerFontSize} onDec={decFont} onInc={incFont} onReset={resetFont} />
            <button className="action-btn" onClick={() => copyToClipboard(fullContent)}>
              Copy
            </button>
            <button className="action-btn action-btn-primary" onClick={() => downloadFile(entry.name, fullContent)}>
              Download
            </button>
          </div>
        </div>
        <ConfigViewer fullContent={fullContent} changedContent={changedContent} changedFormat={entry.changedFormat} />
      </div>
    );
  }

  // ── Regular file ─────────────────────────────────────────
  const { file } = selected;

  if (file.isBinary) {
    if (file.rawBuffer) {
      return (
        <div className="viewer-area" style={{ '--viewer-font-size': `${viewerFontSize}px` } as React.CSSProperties}>
          <div className="file-viewer-header">
            <span className="file-viewer-title">{file.path}</span>
            <div className="file-viewer-actions">
              <FontCtrl size={viewerFontSize} onDec={decFont} onInc={incFont} onReset={resetFont} />
              <button className="action-btn action-btn-primary" onClick={() => downloadBinaryFile(file.name, file.rawBuffer!)}>
                Download
              </button>
            </div>
          </div>
          <div className="file-viewer-body">
            <NbtViewer rawBuffer={file.rawBuffer} />
          </div>
        </div>
      );
    } else {
      return (
        <div className="viewer-area" style={{ '--viewer-font-size': `${viewerFontSize}px` } as React.CSSProperties}>
          <div className="file-viewer-header">
            <span className="file-viewer-title">{file.path}</span>
            <div className="file-viewer-actions">
              {file.rawBuffer && (
                <button className="action-btn action-btn-primary" onClick={() => downloadBinaryFile(file.name, file.rawBuffer!)}>
                  Download
                </button>
              )}
            </div>
          </div>
          <div className="file-viewer-body">
            <BinaryViewer file={file} />
          </div>
        </div>
      );
    }
  }

  const content = file.content ?? '';

  if (file.name.endsWith('.log')) {
    return (
      <div className="viewer-area" style={{ '--viewer-font-size': `${viewerFontSize}px` } as React.CSSProperties}>
        <div className="file-viewer-header">
          <span className="file-viewer-title">{file.path}</span>
          <div className="file-viewer-actions">
            <FontCtrl size={viewerFontSize} onDec={decFont} onInc={incFont} onReset={resetFont} />
            <button className="action-btn" onClick={() => copyToClipboard(content)}>
              Copy
            </button>
            <button className="action-btn action-btn-primary" onClick={() => downloadFile(file.name, content)}>
              Download
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <LogViewer content={content} />
        </div>
      </div>
    );
  }

  if (file.name === 'crash-report.txt') {
    return (
      <div className="viewer-area" style={{ '--viewer-font-size': `${viewerFontSize}px` } as React.CSSProperties}>
        <div className="file-viewer-header">
          <span className="file-viewer-title">{file.path}</span>
          <div className="file-viewer-actions">
            <FontCtrl size={viewerFontSize} onDec={decFont} onInc={incFont} onReset={resetFont} />
            <button className="action-btn" onClick={() => copyToClipboard(content)}>
              Copy
            </button>
            <button className="action-btn action-btn-primary" onClick={() => downloadFile(file.name, content)}>
              Download
            </button>
          </div>
        </div>
        <div className="file-viewer-body">
          <CrashReportViewer content={content} />
        </div>
      </div>
    );
  }

  // Generic text file
  return (
    <div className="viewer-area" style={{ '--viewer-font-size': `${viewerFontSize}px` } as React.CSSProperties}>
      <div className="file-viewer-header">
        <span className="file-viewer-title">{file.path}</span>
        <div className="file-viewer-actions">
          <FontCtrl size={viewerFontSize} onDec={decFont} onInc={incFont} onReset={resetFont} />
          <button className="action-btn" onClick={() => copyToClipboard(content)}>
            Copy
          </button>
          <button className="action-btn action-btn-primary" onClick={() => downloadFile(file.name, content)}>
            Download
          </button>
        </div>
      </div>
      <div className="file-viewer-body">
        <GenericTextViewer file={file} />
      </div>
    </div>
  );
}
