import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { FaArrowUpRightFromSquare, FaTrash } from 'react-icons/fa6';
import { formatRelativeExpiry } from '../utils/formatExpiry';
import { type DumpListEntry, formatManifestFormat, sortByExpirySoonest } from '../utils/adminDumps';

// In production (Docker), default to '' (relative same-origin paths) if VITE_API_URL is not set.
// In dev, no VITE_API_URL means browser-only mode (undefined disables backend features).
const _rawApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const API_URL: string | undefined = import.meta.env.PROD ? (_rawApiUrl ?? '') : _rawApiUrl;

// sessionStorage: token survives reloads in this tab, re-asked in new tabs / after closing
const TOKEN_STORAGE_KEY = 'dump-viewer-admin-token';

type Phase = 'prompt' | 'loading' | 'ready' | 'error';

// Locale-aware but always zero-padded (plain toLocaleString pads only in some locales)
function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function AdminPanel() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_STORAGE_KEY));
  const [tokenInput, setTokenInput] = useState('');
  const [phase, setPhase] = useState<Phase>(token ? 'loading' : 'prompt');
  const [dumps, setDumps] = useState<DumpListEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const confirmingRef = useRef<HTMLButtonElement | null>(null);

  const invalidateToken = useCallback(() => {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setPhase('prompt');
    setErrorMsg('Invalid auth token.');
  }, []);

  const load = useCallback(
    async (authToken: string) => {
      setPhase('loading');
      setErrorMsg(undefined);
      try {
        const resp = await fetch(`${API_URL}/api/dumps`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (resp.status === 401) {
          invalidateToken();
          return;
        }
        if (!resp.ok) {
          let message: string;
          try {
            const body = await resp.json();
            message = body?.error ?? body?.message ?? `HTTP ${resp.status}: ${resp.statusText}`;
          } catch {
            message = `HTTP ${resp.status}: ${resp.statusText}`;
          }
          setErrorMsg(message);
          setPhase('error');
          return;
        }
        const body = (await resp.json()) as { dumps: DumpListEntry[] };
        setDumps(sortByExpirySoonest(body.dumps));
        setPhase('ready');
      } catch {
        setErrorMsg('Could not reach the backend. Check your network connection.');
        setPhase('error');
      }
    },
    [invalidateToken],
  );

  useEffect(() => {
    if (token && API_URL !== undefined) load(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset a pending delete confirmation when clicking anywhere else
  useEffect(() => {
    if (!confirmingId) return;
    function handleClick(e: MouseEvent) {
      if (confirmingRef.current && !confirmingRef.current.contains(e.target as Node)) {
        setConfirmingId(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [confirmingId]);

  function handleTokenSubmit(e: FormEvent) {
    e.preventDefault();
    const entered = tokenInput.trim();
    if (!entered) return;
    sessionStorage.setItem(TOKEN_STORAGE_KEY, entered);
    setToken(entered);
    setTokenInput('');
    load(entered);
  }

  async function handleDelete(id: string) {
    if (confirmingId !== id) {
      setConfirmingId(id);
      return;
    }
    setConfirmingId(null);
    setDeletingId(id);
    setErrorMsg(undefined);
    try {
      const resp = await fetch(`${API_URL}/api/dump/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.status === 401) {
        invalidateToken();
        return;
      }
      if (!resp.ok) {
        setErrorMsg(`Failed to delete ${id} (HTTP ${resp.status}).`);
        return;
      }
      setDumps((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setErrorMsg(`Failed to delete ${id}. Check your network connection.`);
    } finally {
      setDeletingId(null);
    }
  }

  if (API_URL === undefined) {
    return (
      <div className="empty-state" style={{ flex: 1 }}>
        <span className="empty-state-icon">🔌</span>
        <span className="empty-state-text">No backend configured — the admin panel needs VITE_API_URL.</span>
      </div>
    );
  }

  if (phase === 'prompt') {
    return (
      <div className="admin-gate">
        <span style={{ fontSize: 32 }}>🔐</span>
        <span style={{ fontSize: 13, opacity: 0.7 }}>Enter the auth token to manage stored dumps.</span>
        <form onSubmit={handleTokenSubmit} style={{ display: 'flex', gap: 8, marginTop: 12, width: 320, maxWidth: '90%' }}>
          <input
            type="password"
            placeholder="Enter auth token"
            value={tokenInput}
            autoFocus
            onChange={(e) => setTokenInput(e.target.value)}
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
              minWidth: 0,
            }}
          />
          <button className="upload-btn" type="submit" disabled={!tokenInput.trim()} style={{ opacity: tokenInput.trim() ? 1 : 0.6 }}>
            Unlock
          </button>
        </form>
        {errorMsg && <p style={{ color: 'var(--log-error)', fontSize: 12, margin: '8px 0 0' }}>⚠ {errorMsg}</p>}
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div className="empty-state" style={{ flex: 1 }}>
        <span className="empty-state-icon">⏳</span>
        <span className="empty-state-text">Loading stored dumps…</span>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="empty-state" style={{ flex: 1 }}>
        <span className="empty-state-icon">⚠️</span>
        <span className="empty-state-text">{errorMsg}</span>
        <button className="upload-btn" style={{ marginTop: 12 }} onClick={() => token && load(token)}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-panel-title">Stored dumps</h2>
        <span className="admin-panel-count">
          {dumps.length} dump{dumps.length !== 1 ? 's' : ''}, expiring soonest first
        </span>
      </div>
      {errorMsg && <p style={{ color: 'var(--log-error)', fontSize: 13, margin: '0 0 10px' }}>⚠ {errorMsg}</p>}
      {dumps.length === 0 ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <span className="empty-state-icon">📭</span>
          <span className="empty-state-text">No dumps stored on this server.</span>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Format</th>
                <th>Manifest ID</th>
                <th>Minecraft</th>
                <th>Skyblock Builder</th>
                <th>Created</th>
                <th>Expires</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {dumps.map((dump) => {
                const created = new Date(dump.createdAt);
                const expires = new Date(dump.expiresAt);
                const confirming = confirmingId === dump.id;
                return (
                  <tr key={dump.id}>
                    <td>
                      <span className="badge">
                        <span className="badge-label">{formatManifestFormat(dump.manifestVersion)}</span>
                      </span>
                    </td>
                    <td className="admin-cell-id">{dump.id}</td>
                    <td>{dump.versions?.minecraft ?? '—'}</td>
                    <td>{dump.versions?.skyblockbuilder ?? '—'}</td>
                    <td title={formatTimestamp(created)}>{formatDate(created)}</td>
                    <td title={formatTimestamp(expires)}>{formatRelativeExpiry(expires)}</td>
                    <td className="admin-cell-actions">
                      <a
                        className="admin-action-btn"
                        href={`/${dump.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View this dump in a new tab"
                      >
                        <FaArrowUpRightFromSquare size={11} /> View
                      </a>
                      <button
                        ref={confirming ? confirmingRef : undefined}
                        className={`admin-action-btn admin-action-btn--danger${confirming ? ' is-confirming' : ''}`}
                        disabled={deletingId === dump.id}
                        onClick={() => handleDelete(dump.id)}
                        title={confirming ? 'Click again to permanently delete' : 'Delete this dump'}
                      >
                        <FaTrash size={11} /> {deletingId === dump.id ? 'Deleting…' : confirming ? 'Confirm delete?' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
