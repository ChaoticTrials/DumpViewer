import { useState, useCallback, useEffect } from 'react';
import './App.css';
import type { ParsedDump, SelectedFile } from './manifest/index';
import { parseDump, categorizeFiles } from './manifest/index';
import DropZone from './components/DropZone';
import ManifestBanner from './components/ManifestBanner';
import FileTree from './components/FileTree';
import FileViewer from './components/FileViewer';
import ThemeToggle from './components/ThemeToggle';
import { HeaderLogo } from './components/HeaderLogo.tsx';
import NoDumpPage from './components/NoDumpPage';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function SimpleHeader() {
  return (
    <header className="header">
      <div className="header-brand">
        <HeaderLogo />
        <span className="header-title">Dump Viewer</span>
      </div>
      <div className="header-actions" style={{ gridColumn: 3 }}>
        <ThemeToggle />
      </div>
    </header>
  );
}

export default function App() {
  const [dump, setDump] = useState<ParsedDump | null>(null);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [manifestId, setManifestId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [expiresAt, setExpiresAt] = useState<Date | null | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setError(undefined);
    setExpiresAt(undefined); // "Local" until the server provides an expiry date
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

  // On mount, check URL for a manifest ID and fetch dump if API URL is configured.
  // Non-UUID paths and UUID paths without a backend are redirected to /.
  useEffect(() => {
    const raw = window.location.pathname.replace(/^\//, '');
    if (!raw) return;

    // Not a UUID v4 → redirect to home
    if (!UUID_V4_RE.test(raw)) {
      window.history.replaceState({}, '', '/');
      return;
    }

    // In production (Docker), default to '' (relative same-origin paths) if VITE_API_URL is not set.
    // In dev, no VITE_API_URL means browser-only mode → redirect home.
    const rawApiUrl = import.meta.env.VITE_API_URL as string | undefined;
    const apiUrl: string | undefined = import.meta.env.PROD ? (rawApiUrl ?? '') : rawApiUrl;
    if (apiUrl === undefined) {
      window.history.replaceState({}, '', '/');
      return;
    }

    setManifestId(raw);
    setLoading(true);

    fetch(`${apiUrl}/api/dump/${raw}`)
      .then(async (res) => {
        if (res.ok) {
          // Capture expiry header before consuming the body.
          // `Expires` is a CORS-safe header (always exposed); fall back to custom `X-Expires-At`.
          const expiresHeader = res.headers.get('Expires') || res.headers.get('X-Expires-At');
          const blob = await res.blob();
          const file = new File([blob], `${raw}.zip`);
          await handleFile(file);
          const d = expiresHeader ? new Date(expiresHeader) : null;
          setExpiresAt(d && !isNaN(d.getTime()) ? d : null);
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
        <SimpleHeader />
        <NoDumpPage manifestId={manifestId} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="app">
        <SimpleHeader />
        <div className="empty-state" style={{ height: 'calc(100dvh - var(--header-h, 48px))' }}>
          <span className="empty-state-icon">⏳</span>
          <span className="empty-state-text">{manifestId ? `Loading dump for ${manifestId}…` : 'Parsing dump file…'}</span>
        </div>
      </div>
    );
  }

  if (!dump) {
    return (
      <div className="app">
        <SimpleHeader />
        <DropZone onFile={handleFile} error={error} />
      </div>
    );
  }

  const cat = categorizeFiles(dump.manifest, dump.files);

  return (
    <div className="app">
      <ManifestBanner
        manifest={dump.manifest}
        expiresAt={expiresAt}
        onReset={() => {
          setDump(null);
          setSelected(null);
          setExpiresAt(undefined);
          window.history.pushState({}, '', '/');
        }}
        onBurgerClick={() => setSidebarOpen(true)}
      />
      <div className="app-body">
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
        <FileTree
          cat={cat}
          files={dump.files}
          selected={selected}
          onSelect={(sel) => {
            setSelected(sel);
            setSidebarOpen(false);
          }}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <FileViewer selected={selected} dump={dump} />
      </div>
    </div>
  );
}
