import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { FaArrowUpRightFromSquare, FaCheck, FaPen, FaTrash, FaXmark } from 'react-icons/fa6';
import { formatRelativeExpiry } from '../utils/formatExpiry';
import {
  applyDumpMetadata,
  type DumpListEntry,
  type DumpMetadata,
  formatDumpLabel,
  formatManifestFormat,
  isDisplayableLink,
  linkHostLabel,
  sortByExpirySoonest,
} from '../utils/adminDumps';

// In production (Docker), default to '' (relative same-origin paths) if VITE_API_URL is not set.
// In dev, no VITE_API_URL means browser-only mode (undefined disables backend features).
const _rawApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const API_URL: string | undefined = import.meta.env.PROD ? (_rawApiUrl ?? '') : _rawApiUrl;

// sessionStorage: token survives reloads in this tab, re-asked in new tabs / after closing
const TOKEN_STORAGE_KEY = 'dump-viewer-admin-token';

type Phase = 'prompt' | 'loading' | 'ready' | 'error';

/** The single open inline editor, if any. */
type EditTarget = { id: string; field: 'name' | 'link'; value: string };

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
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | undefined>();
  const confirmingRef = useRef<HTMLButtonElement | null>(null);
  const editingRef = useRef<HTMLDivElement | null>(null);

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

  // Dismiss a pending delete confirmation or an open inline editor when
  // clicking outside it. One listener for both, since they are mutually
  // exclusive by construction.
  useEffect(() => {
    if (!confirmingId && !editing) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (confirmingId && confirmingRef.current && !confirmingRef.current.contains(target)) {
        setConfirmingId(null);
      }
      if (editing && editingRef.current && !editingRef.current.contains(target)) {
        closeEdit();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [confirmingId, editing]);

  function handleTokenSubmit(e: FormEvent) {
    e.preventDefault();
    const entered = tokenInput.trim();
    if (!entered) return;
    sessionStorage.setItem(TOKEN_STORAGE_KEY, entered);
    setToken(entered);
    setTokenInput('');
    load(entered);
  }

  function startEdit(id: string, field: 'name' | 'link', current: string | null) {
    setConfirmingId(null);
    setEditError(undefined);
    setEditing({ id, field, value: current ?? '' });
  }

  function closeEdit() {
    setEditing(null);
    setEditError(undefined);
  }

  async function saveEdit() {
    if (!editing || savingEdit) return;
    const { id, field, value } = editing;
    const trimmed = value.trim();
    setSavingEdit(true);
    setEditError(undefined);
    try {
      const resp = await fetch(`${API_URL}/api/dump/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [field]: trimmed === '' ? null : trimmed }),
      });
      if (resp.status === 401) {
        invalidateToken();
        return;
      }
      if (!resp.ok) {
        // Keep the editor open with whatever was typed, so "name too long" is
        // fixable in place
        let message: string;
        try {
          const body = await resp.json();
          message = body?.error ?? `HTTP ${resp.status}: ${resp.statusText}`;
        } catch {
          message = `HTTP ${resp.status}: ${resp.statusText}`;
        }
        setEditError(message);
        return;
      }
      const body = (await resp.json()) as DumpMetadata;
      // Merge instead of refetching: a refetch would re-sort by expiry and
      // make the edited row jump
      setDumps((prev) => applyDumpMetadata(prev, id, { name: body.name, link: body.link }));
      setEditing(null);
    } catch {
      setEditError('Could not reach the backend. Check your network connection.');
    } finally {
      setSavingEdit(false);
    }
  }

  // The single open inline editor. Enter saves, Escape cancels; blur does
  // neither, which removes every mousedown-vs-blur ordering hazard with the
  // ✓/✕ buttons.
  function renderEditor(field: 'name' | 'link') {
    return (
      <div className="admin-cell-editor" ref={editingRef}>
        <div className="admin-cell-editor-row">
          <input
            className="admin-cell-input"
            autoFocus
            disabled={savingEdit}
            value={editing?.value ?? ''}
            placeholder={field === 'name' ? 'Dump name' : 'https://…'}
            aria-label={field === 'name' ? 'Dump name' : 'Dump link'}
            onChange={(e) => setEditing((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void saveEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeEdit();
              }
            }}
          />
          <button
            type="button"
            className="admin-cell-btn"
            disabled={savingEdit}
            onClick={() => void saveEdit()}
            title="Save"
            aria-label="Save"
          >
            <FaCheck size={11} />
          </button>
          <button type="button" className="admin-cell-btn" disabled={savingEdit} onClick={closeEdit} title="Cancel" aria-label="Cancel">
            <FaXmark size={11} />
          </button>
        </div>
        {editError && <div className="admin-cell-error">⚠ {editError}</div>}
      </div>
    );
  }

  async function handleDelete(id: string) {
    closeEdit();
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
                <th>Name</th>
                <th>Link</th>
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
                const editingName = editing?.id === dump.id && editing.field === 'name';
                const editingLink = editing?.id === dump.id && editing.field === 'link';
                return (
                  <tr key={dump.id}>
                    <td>
                      <span className="badge">
                        <span className="badge-label">{formatManifestFormat(dump.manifestVersion)}</span>
                      </span>
                    </td>
                    <td className="admin-cell-name">
                      {editingName ? (
                        renderEditor('name')
                      ) : (
                        <button
                          type="button"
                          className="admin-cell-edit"
                          onClick={() => startEdit(dump.id, 'name', dump.name)}
                          title={dump.name ? 'Edit name' : 'Add a name'}
                        >
                          <span className={dump.name?.trim() ? undefined : 'admin-name-fallback'}>{formatDumpLabel(dump)}</span>
                          <FaPen className="admin-edit-icon" size={9} aria-hidden />
                        </button>
                      )}
                    </td>
                    <td className="admin-cell-link">
                      {editingLink ? (
                        renderEditor('link')
                      ) : isDisplayableLink(dump.link) ? (
                        <>
                          <a href={dump.link as string} target="_blank" rel="noopener noreferrer" title={dump.link as string}>
                            {linkHostLabel(dump.link) ?? dump.link}
                          </a>
                          <button
                            type="button"
                            className="admin-cell-edit admin-cell-edit--icon"
                            onClick={() => startEdit(dump.id, 'link', dump.link)}
                            title="Edit link"
                            aria-label="Edit link"
                          >
                            <FaPen className="admin-edit-icon" size={9} aria-hidden />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="admin-cell-edit"
                          onClick={() => startEdit(dump.id, 'link', dump.link)}
                          title="Add a link"
                        >
                          <span className="admin-name-fallback">—</span>
                          <FaPen className="admin-edit-icon" size={9} aria-hidden />
                        </button>
                      )}
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
