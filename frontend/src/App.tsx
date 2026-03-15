import { useState, useRef, useCallback, useEffect } from 'react';
import './App.css';
import type { ParsedDump, SelectedFile } from './types';
import { parseDump, categorizeFiles } from './utils/zipParser';
import DropZone from './components/DropZone';
import ManifestBanner from './components/ManifestBanner';
import FileTree from './components/FileTree';
import FileViewer from './components/FileViewer';
import ThemeToggle from './components/ThemeToggle';
import { HeaderLogo } from './components/HeaderLogo.tsx';
import NoDumpPage from './components/NoDumpPage';

export default function App() {
  const [dump, setDump] = useState<ParsedDump | null>(null);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [manifestId, setManifestId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
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

  // On mount, check URL for a manifest ID and fetch dump if API URL is configured
  useEffect(() => {
    const raw = window.location.pathname.replace(/^\//, '');
    if (!raw || !/^[a-zA-Z0-9_-]+$/.test(raw)) return;

    const apiUrl = import.meta.env.VITE_API_URL;
    if (!apiUrl) return;

    setManifestId(raw);
    setLoading(true);

    fetch(`${apiUrl}/api/dump/${raw}`)
      .then(async (res) => {
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], `${raw}.zip`);
          await handleFile(file);
        } else {
          setNotFound(true);
          setLoading(false);
        }
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (notFound && manifestId) {
    return (
      <div className="app">
        <header className="header">
          <HeaderLogo />
          <span className="header-title">Dump Viewer</span>
          <span style={{ flex: 1 }} />
          <ThemeToggle />
        </header>
        <NoDumpPage manifestId={manifestId} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="app">
        <header className="header">
          <HeaderLogo />
          <span className="header-title">Dump Viewer</span>
          <span style={{ flex: 1 }} />
          <ThemeToggle />
        </header>
        <div className="empty-state" style={{ height: 'calc(100dvh - var(--header-h, 48px))' }}>
          <span className="empty-state-icon">⏳</span>
          <span className="empty-state-text">
            {manifestId ? `Loading dump for ${manifestId}…` : 'Parsing dump file…'}
          </span>
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
        onReset={() => {
          setDump(null);
          setSelected(null);
          window.history.pushState({}, '', '/');
        }}
        onUpload={() => fileInputRef.current?.click()}
        fileInputRef={fileInputRef}
      />
      <div className="app-body">
        <FileTree cat={cat} files={dump.files} selected={selected} onSelect={setSelected} />
        <FileViewer selected={selected} dump={dump} />
      </div>
    </div>
  );
}
