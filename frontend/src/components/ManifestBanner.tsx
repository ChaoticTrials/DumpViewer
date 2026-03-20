import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import type { AnyManifest } from '../manifest';
import { formatRelativeExpiry } from '../utils/formatExpiry';
import ThemeToggle from './ThemeToggle';
import { HeaderLogo } from './HeaderLogo.tsx';
import { useIsMobile } from '../utils/useIsMobile';

const _rawApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const API_URL: string = import.meta.env.PROD ? (_rawApiUrl ?? '') : (_rawApiUrl ?? '');

interface Props {
  manifest: AnyManifest;
  expiresAt?: Date | null;
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

export default function ManifestBanner({ manifest, expiresAt, onReset, onBurgerClick }: Props) {
  const isMobile = useIsMobile();
  const badgeContentRef = useRef<HTMLDivElement>(null);
  const [shouldCollapse, setShouldCollapse] = useState(false);
  const [badgesOpen, setBadgesOpen] = useState(false);

  const [modpackOpen, setModpackOpen] = useState(false);
  const [modpackLoading, setModpackLoading] = useState<'curseforge' | 'modrinth' | null>(null);
  const modpackRef = useRef<HTMLDivElement>(null);

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

  async function triggerModpackDownload(platform: 'curseforge' | 'modrinth') {
    setModpackOpen(false);
    setModpackLoading(platform);
    const ext = platform === 'modrinth' ? '.mrpack' : '.zip';
    try {
      const res = await fetch(`${API_URL}/api/dump/${manifest.manifest_id}/modpack?platform=${platform}`);
      if (!res.ok) throw new Error('Failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SkyBlock-modpack${ext}`;
      a.click();
      URL.revokeObjectURL(url);
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
        <div ref={modpackRef} style={{ position: 'relative' }}>
          <button
            className={isMobile ? 'icon-btn' : 'upload-btn'}
            onClick={() => isServerStored && setModpackOpen((v) => !v)}
            disabled={!isServerStored || modpackLoading !== null}
            title={!isServerStored ? 'Only available for server-stored dumps' : 'Download modpack'}
            style={!isServerStored ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
          >
            {modpackLoading ? '⏳' : '⬇'}{!isMobile && (modpackLoading ? ' Generating…' : ' Modpack')}
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
          className={isMobile ? 'icon-btn' : 'upload-btn'}
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
