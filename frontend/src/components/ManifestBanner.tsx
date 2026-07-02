import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import type { AnyManifest } from '../manifest';
import { formatRelativeExpiry } from '../utils/formatExpiry';
import ThemeToggle from './ThemeToggle';
import { HeaderLogo } from './HeaderLogo.tsx';
import { useIsMobile } from '../utils/useIsMobile';
import { downloadBlob } from '../utils/download';
import { FaUpload, FaDownload, FaCheck, FaSpinner } from 'react-icons/fa6';

const _rawApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const API_URL: string = import.meta.env.PROD ? (_rawApiUrl ?? '') : (_rawApiUrl ?? '');
// In dev, no VITE_API_URL means browser-only mode (no backend to upload to).
const BACKEND_AVAILABLE = import.meta.env.PROD || _rawApiUrl !== undefined;

interface Props {
  manifest: AnyManifest;
  expiresAt?: Date | null;
  sourceFile: File | null;
  onReset: () => void;
  onBurgerClick?: () => void;
}

const SETTING_LABELS: Record<string, string> = {
  configs: 'Configs',
  templates: 'Templates',
  level_dat: 'level.dat',
  log: 'Log',
  crash_report: 'Crash Report',
  world_data: 'World Data',
};

const dividerStyle = { width: 1, height: 20, background: 'var(--border)', margin: '0 4px', flexShrink: 0 } as const;

function ExpiryBadge({ expiresAt }: { expiresAt: Date | null | undefined }) {
  if (expiresAt === undefined) {
    return (
      <span className="badge" style={{ opacity: 0.6 }} title="Not stored on any server — only available in this browser tab">
        Local
      </span>
    );
  }
  if (expiresAt === null) {
    return (
      <span className="badge" style={{ opacity: 0.6 }} title="Stored on this server with no expiry set">
        Temporary
      </span>
    );
  }
  const label = formatRelativeExpiry(expiresAt);
  return (
    <span className="badge" title={expiresAt.toLocaleString()}>
      {label}
    </span>
  );
}

export default function ManifestBanner({ manifest, expiresAt, sourceFile, onReset, onBurgerClick }: Props) {
  const isMobile = useIsMobile();
  const badgeContentRef = useRef<HTMLDivElement>(null);
  const [shouldCollapse, setShouldCollapse] = useState(false);
  const [badgesOpen, setBadgesOpen] = useState(false);

  const [modpackOpen, setModpackOpen] = useState(false);
  const [modpackLoading, setModpackLoading] = useState<'curseforge' | 'modrinth' | null>(null);
  const modpackRef = useRef<HTMLDivElement>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadToken, setUploadToken] = useState('');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>();
  const [uploadResult, setUploadResult] = useState<{ id: string; deleteUrl: string } | null>(null);
  const [deleteUrlCopied, setDeleteUrlCopied] = useState(false);
  const uploadRef = useRef<HTMLDivElement>(null);

  function closeUploadDropdown() {
    setUploadOpen(false);
    setUploadToken('');
    setUploadError(undefined);
    setUploadResult(null);
    setDeleteUrlCopied(false);
  }

  useEffect(() => {
    if (!modpackOpen) return;
    function handleOutside(e: MouseEvent) {
      if (modpackRef.current && !modpackRef.current.contains(e.target as Node)) {
        setModpackOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [modpackOpen]);

  useEffect(() => {
    if (!uploadOpen) return;
    function handleOutside(e: MouseEvent) {
      if (uploadRef.current && !uploadRef.current.contains(e.target as Node)) {
        closeUploadDropdown();
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadOpen]);

  async function triggerUpload() {
    if (!sourceFile) return;
    setUploadLoading(true);
    setUploadError(undefined);
    try {
      const formData = new FormData();
      formData.append('file', sourceFile);
      const resp = await fetch(`${API_URL}/api/dump/upload`, {
        method: 'POST',
        headers: { ...(uploadToken ? { Authorization: `Bearer ${uploadToken}` } : {}) },
        body: formData,
      });
      if (!resp.ok) {
        if (resp.status === 401) {
          setUploadError('Invalid auth token.');
          return;
        }
        let message: string;
        try {
          const body = await resp.json();
          message = body?.error ?? body?.message ?? `HTTP ${resp.status}: ${resp.statusText}`;
        } catch {
          message = `HTTP ${resp.status}: ${resp.statusText}`;
        }
        setUploadError(message);
        return;
      }
      const { id, deleteKey } = (await resp.json()) as { id: string; deleteKey: string };
      const deleteUrl = `${API_URL || window.location.origin}/api/delete/${deleteKey}`;
      setUploadResult({ id, deleteUrl });
    } catch {
      setUploadError('Could not reach the backend. Check your network connection.');
    } finally {
      setUploadLoading(false);
    }
  }

  async function copyDeleteUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setDeleteUrlCopied(true);
      setTimeout(() => setDeleteUrlCopied(false), 1500);
    } catch {
      /* clipboard API unavailable — user can still select the text manually */
    }
  }

  async function triggerModpackDownload(platform: 'curseforge' | 'modrinth') {
    setModpackOpen(false);
    setModpackLoading(platform);
    const ext = platform === 'modrinth' ? '.mrpack' : '.zip';
    try {
      const res = await fetch(`${API_URL}/api/dump/${manifest.manifest_id}/modpack?platform=${platform}`);
      if (!res.ok) throw new Error('Failed');
      const blob = await res.blob();
      downloadBlob(blob, `SkyBlock-modpack${ext}`);
    } catch {
      /* silent failure */
    } finally {
      setModpackLoading(null);
    }
  }

  const isServerStored = expiresAt !== undefined;

  useLayoutEffect(() => {
    function measure(): boolean {
      const content = badgeContentRef.current;
      if (!content) return false;
      return content.scrollHeight > 100;
    }

    const collapse = measure();
    setShouldCollapse(collapse);
    if (!collapse) setBadgesOpen(false);

    function handleResize() {
      setShouldCollapse(false);
      requestAnimationFrame(() => {
        const collapse = measure();
        setShouldCollapse(collapse);
        if (!collapse) setBadgesOpen(false);
      });
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [manifest, expiresAt]);

  // Version badges — used in flat measurement strip and in the dropdown's first section
  const versionBadges = (
    <>
      <span className="badge">
        <span className="badge-label">v{manifest.manifest_version}</span>
      </span>
      <span className="badge">
        <span className="badge-label">id</span>
        {manifest.manifest_id}
      </span>
      <span className="badge">
        <span className="badge-label">MC</span>
        {manifest.versions.minecraft}
      </span>
      {manifest.versions.forge && (
        <span className="badge">
          <span className="badge-label">Forge</span>
          {manifest.versions.forge}
        </span>
      )}
      {manifest.versions.neoforge && (
        <span className="badge">
          <span className="badge-label">NeoForge</span>
          {manifest.versions.neoforge}
        </span>
      )}
      <span className="badge">
        <span className="badge-label">Skyblock Builder</span>
        {manifest.versions.skyblockbuilder}
      </span>
      {manifest.versions.libx && (
        <span className="badge">
          <span className="badge-label">LibX</span>
          {manifest.versions.libx}
        </span>
      )}
      {manifest.versions.minemention && (
        <span className="badge">
          <span className="badge-label">MineMention</span>
          {manifest.versions.minemention}
        </span>
      )}
      {manifest.versions.skyguis && (
        <span className="badge">
          <span className="badge-label">Sky GUIs</span>
          {manifest.versions.skyguis}
        </span>
      )}
    </>
  );

  // Settings badges — second section
  const settingsBadges = (
    <>
      {Object.entries(manifest.settings).map(([key, enabled]) =>
        enabled ? (
          <span key={key} className="badge badge-green">
            ✓ {SETTING_LABELS[key] ?? key}
          </span>
        ) : (
          <span
            key={key}
            className="badge"
            style={{
              background: 'rgba(248,113,113,0.08)',
              color: '#f87171',
              borderColor: 'rgba(248,113,113,0.3)',
            }}
          >
            ✗ {SETTING_LABELS[key] ?? key}
          </span>
        ),
      )}
    </>
  );

  // Expiry badge — third section
  const expiryEl = <ExpiryBadge expiresAt={expiresAt} />;

  // Flat layout: used by the hidden measurement div and the always-visible badge strip
  const flatBadges = (
    <>
      {versionBadges}
      <span style={dividerStyle} />
      {settingsBadges}
      <span style={dividerStyle} />
      {expiryEl}
    </>
  );

  return (
    <header className="header">
      <div className="header-brand">
        {onBurgerClick && (
          <button className="burger-btn" onClick={onBurgerClick} aria-label="Open sidebar">
            ☰
          </button>
        )}
        <HeaderLogo />
        <span className="header-title">Dump Viewer</span>
      </div>

      <div className="header-meta">
        {/* Always in DOM for scrollHeight measurement; hidden via CSS when collapsed */}
        <div ref={badgeContentRef} className={`badge-content${shouldCollapse ? ' badge-content-hidden' : ''}`}>
          {flatBadges}
        </div>
        {shouldCollapse && (
          <button className="badge badge-collapse-btn" onClick={() => setBadgesOpen((v) => !v)}>
            {badgesOpen ? '✕ Hide' : '▼ Info'}
          </button>
        )}
      </div>

      <div className="header-actions">
        <ThemeToggle />
        {!isServerStored && sourceFile && BACKEND_AVAILABLE && (
          <div ref={uploadRef} style={{ position: 'relative' }}>
            <button
              className={isMobile ? 'icon-btn' : 'upload-btn'}
              onClick={() => (uploadOpen ? closeUploadDropdown() : setUploadOpen(true))}
              disabled={uploadLoading}
              title="Upload to server"
            >
              {uploadLoading ? <FaSpinner className="spin-icon" /> : <FaUpload />}
              {!isMobile && (uploadLoading ? ' Uploading…' : ' Upload')}
            </button>
            {uploadOpen &&
              (uploadResult ? (
                <div className="modpack-dropdown upload-dropdown">
                  <div className="upload-dropdown-content">
                    <span className="upload-success-heading">
                      <FaCheck /> Uploaded
                    </span>
                    <p className="upload-dropdown-hint">Save this delete link — it won't be shown again.</p>
                    <div className="upload-delete-url-row">
                      <input
                        readOnly
                        value={uploadResult.deleteUrl}
                        onFocus={(e) => e.target.select()}
                        className="upload-input upload-delete-url"
                      />
                      <button className="upload-btn" onClick={() => copyDeleteUrl(uploadResult.deleteUrl)}>
                        {deleteUrlCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <button
                      className="upload-btn"
                      style={{ width: '100%', justifyContent: 'center' }}
                      onClick={() => {
                        window.location.href = '/' + uploadResult.id;
                      }}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : (
                <div className="modpack-dropdown upload-dropdown">
                  <div className="upload-dropdown-content">
                    <span style={{ fontSize: 11, color: 'var(--text)', opacity: 0.7 }}>Auth token</span>
                    <input
                      type="password"
                      placeholder="Enter auth token"
                      value={uploadToken}
                      disabled={uploadLoading}
                      onChange={(e) => {
                        setUploadToken(e.target.value);
                        setUploadError(undefined);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') triggerUpload();
                      }}
                      className="upload-input"
                    />
                    <button
                      className="upload-btn"
                      onClick={triggerUpload}
                      disabled={uploadLoading}
                      style={{ width: '100%', justifyContent: 'center' }}
                    >
                      {uploadLoading ? 'Uploading…' : 'Upload'}
                    </button>
                    {uploadError && <p style={{ color: 'var(--log-error)', fontSize: 12, margin: 0 }}>{uploadError}</p>}
                  </div>
                </div>
              ))}
          </div>
        )}
        <div ref={modpackRef} style={{ position: 'relative' }}>
          <button
            className={isMobile ? 'icon-btn' : 'upload-btn'}
            onClick={() => isServerStored && setModpackOpen((v) => !v)}
            disabled={!isServerStored || modpackLoading !== null}
            title={!isServerStored ? 'Only available for server-stored dumps' : 'Download modpack'}
            style={!isServerStored ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
          >
            {modpackLoading ? <FaSpinner className="spin-icon" /> : <FaDownload />}
            {!isMobile && (modpackLoading ? ' Generating…' : ' Modpack')}
          </button>
          {modpackOpen && (
            <div className="modpack-dropdown">
              <button className="modpack-dropdown-item" onClick={() => triggerModpackDownload('curseforge')}>
                CurseForge
              </button>
              <button className="modpack-dropdown-item" onClick={() => triggerModpackDownload('modrinth')}>
                Modrinth
              </button>
            </div>
          )}
        </div>
        <button
          className={isMobile ? 'icon-btn' : 'upload-btn upload-btn--close'}
          onClick={onReset}
          title="Close dump"
          style={isMobile ? undefined : { background: 'rgba(255,255,255,0.05)', color: 'var(--text)', borderColor: 'var(--border)' }}
        >
          ✕{!isMobile && ' Close'}
        </button>
      </div>

      {/* Dropdown: position: absolute on .header (position: relative), so left: 50% = viewport center */}
      {shouldCollapse && badgesOpen && (
        <div className="badge-dropdown">
          <div className="badge-section">{versionBadges}</div>
          <hr className="badge-section-hr" />
          <div className="badge-section">{settingsBadges}</div>
          <hr className="badge-section-hr" />
          <div className="badge-section">{expiryEl}</div>
        </div>
      )}
    </header>
  );
}
