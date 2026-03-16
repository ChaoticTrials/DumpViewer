import { type ChangeEvent, type DragEvent, useRef, useState } from 'react';

// In production (Docker), default to '' (relative same-origin paths) if VITE_API_URL is not set.
// In dev, no VITE_API_URL means browser-only mode (undefined disables backend features).
const _rawApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const API_URL: string | undefined = import.meta.env.PROD ? (_rawApiUrl ?? '') : _rawApiUrl;

interface Props {
  onFile: (file: File) => void;
  error?: string;
}

function getHintText(apiUrl: string | undefined, token: string): string {
  if (apiUrl === undefined) return 'No backend — dropped files are processed entirely in your browser.';
  if (token) return 'File will be saved to server and accessible via its manifest ID.';
  return 'Add an auth token to use the URL importer.';
}

export default function DropZone({ onFile, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | undefined>();
  const [urlLoading, setUrlLoading] = useState(false);
  const [token, setToken] = useState('');

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = '';
  }

  async function handleUrl() {
    const url = urlInput.trim();
    if (!url) return;
    setUrlLoading(true);
    setUrlError(undefined);

    if (API_URL !== undefined) {
      // Backend-assisted download
      try {
        const resp = await fetch(`${API_URL}/api/dump/import`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ url }),
        });
        if (!resp.ok) {
          if (resp.status === 401) {
            setUrlError('Invalid auth token.');
            setUrlLoading(false);
            return;
          }
          let message: string;
          try {
            const body = await resp.json();
            message = body?.error ?? body?.message ?? `HTTP ${resp.status}: ${resp.statusText}`;
          } catch {
            message = `HTTP ${resp.status}: ${resp.statusText}`;
          }
          setUrlError(message);
          setUrlLoading(false);
          return;
        }
        const { id } = (await resp.json()) as { id: string; url: string };
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
          setUrlError('Server returned an invalid dump ID.');
          setUrlLoading(false);
          return;
        }
        window.location.href = '/' + id;
      } catch {
        setUrlError('Could not reach the backend. Check your network connection.');
        setUrlLoading(false);
      }
    } else {
      // Direct fetch fallback (no proxy)
      try {
        const resp = await fetch(url);
        if (!resp.ok) {
          setUrlError(`HTTP ${resp.status}: ${resp.statusText}`);
          setUrlLoading(false);
          return;
        }
        const blob = await resp.blob();
        const filename = url.split('/').pop()?.split('?')[0] ?? 'dump.zip';
        onFile(new File([blob], filename, { type: 'application/zip' }));
        setUrlInput('');
        setUrlLoading(false);
      } catch {
        setUrlError(
          'Could not fetch the file. Configure the backend (VITE_API_URL) to load files from URLs that do not send CORS headers.',
        );
        setUrlLoading(false);
      }
    }
  }

  return (
    <div
      className={`dropzone${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="dropzone-box" onClick={() => inputRef.current?.click()}>
        <span className="dropzone-icon">📦</span>
        <p className="dropzone-title">Drop a dump .zip here</p>
        <p className="dropzone-sub">or click to browse</p>
        <p className="dropzone-sub" style={{ marginTop: 4, opacity: 0.5, fontSize: 11 }}>
          Your file never leaves this browser
        </p>
      </div>
      {error && <p className="dropzone-error">⚠ {error}</p>}
      <input ref={inputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={handleChange} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          maxWidth: 480,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            fontSize: 12,
            opacity: 0.5,
          }}
        >
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          or open from URL
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>
        {API_URL !== undefined && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
            <span style={{ fontSize: 11, color: 'var(--text)', opacity: 0.7 }}>Auth token</span>
            <input
              type="password"
              placeholder="Enter auth token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              style={{
                flex: 1,
                padding: '7px 12px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg2)',
                color: 'var(--text-h)',
                fontSize: 13,
                outline: 'none',
                fontFamily: 'var(--mono)',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <input
            type="url"
            placeholder="https://…/dump.zip"
            value={urlInput}
            disabled={urlLoading}
            onChange={(e) => {
              setUrlInput(e.target.value);
              setUrlError(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && urlInput.trim()) handleUrl();
            }}
            style={{
              flex: 1,
              padding: '7px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg2)',
              color: 'var(--text-h)',
              fontSize: 13,
              outline: 'none',
              fontFamily: 'var(--mono)',
              opacity: urlLoading ? 0.6 : 1,
            }}
          />
          <button
            className="upload-btn"
            onClick={handleUrl}
            disabled={!urlInput.trim() || urlLoading}
            style={{
              background: 'var(--accent-bg)',
              color: 'var(--accent)',
              borderColor: 'var(--accent-border)',
              cursor: urlLoading ? 'wait' : 'pointer',
              opacity: !urlInput.trim() || urlLoading ? 0.6 : 1,
            }}
          >
            {urlLoading ? 'Loading…' : 'Open'}
          </button>
        </div>
        {urlError && <p style={{ color: 'var(--log-error)', fontSize: 12, margin: 0, textAlign: 'center' }}>{urlError}</p>}
        <p style={{ fontSize: 11, opacity: 0.5, margin: 0, textAlign: 'center' }}>{getHintText(API_URL, token)}</p>
      </div>
    </div>
  );
}
