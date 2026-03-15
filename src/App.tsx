import { useState, useRef, useCallback, useEffect } from 'react';
import './App.css';
import type { ParsedDump, SelectedFile } from './types';
import { parseDump, categorizeFiles } from './utils/zipParser';
import DropZone from './components/DropZone';
import ManifestBanner from './components/ManifestBanner';
import FileTree from './components/FileTree';
import FileViewer from './components/FileViewer';
import ThemeToggle from './components/ThemeToggle';
import { HeaderLogo } from "./components/HeaderLogo.tsx";

export default function App() {
  const [dump, setDump] = useState<ParsedDump | null>(null);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(undefined);
    setLoading(true);
    try {
      const parsed = await parseDump(file);
      setDump(parsed);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse dump file.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Listen for file events dispatched by ManifestBanner's hidden input
  useEffect(() => {
    function handler(e: Event) {
      const file = (e as CustomEvent<File>).detail;
      if (file) handleFile(file);
    }
    window.addEventListener('dump-upload', handler);
    return () => window.removeEventListener('dump-upload', handler);
  }, [handleFile]);

  if (loading) {
    return (
      <div className="app">
        <div className="empty-state" style={{ height: '100dvh' }}>
          <span className="empty-state-icon">⏳</span>
          <span className="empty-state-text">Parsing dump file…</span>
        </div>
      </div>
    );
  }

  if (!dump) {
    return (
      <div className="app">
        <header className="header">
          <HeaderLogo />
          <span className="header-title">Dump Viewer</span>
          <span style={{ flex: 1 }} />
          <ThemeToggle />
        </header>
        <DropZone onFile={handleFile} error={error} />
      </div>
    );
  }

  const cat = categorizeFiles(dump.manifest, dump.files);

  return (
    <div className="app">
      <ManifestBanner
        manifest={dump.manifest}
        onReset={() => { setDump(null); setSelected(null); }}
        onUpload={() => fileInputRef.current?.click()}
        fileInputRef={fileInputRef}
      />
      <div className="app-body">
        <FileTree
          cat={cat}
          files={dump.files}
          selected={selected}
          onSelect={setSelected}
        />
        <FileViewer selected={selected} dump={dump} />
      </div>
    </div>
  );
}
