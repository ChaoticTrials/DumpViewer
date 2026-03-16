import type { AnyManifest } from '../manifest/index';
import { formatRelativeExpiry } from '../utils/formatExpiry';
import ThemeToggle from './ThemeToggle';
import * as React from 'react';
import { HeaderLogo } from './HeaderLogo.tsx';

interface Props {
  manifest: AnyManifest;
  expiresAt?: Date | null;
  onReset: () => void;
  onUpload: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

const SETTING_LABELS: Record<string, string> = {
  configs: 'Configs',
  templates: 'Templates',
  level_dat: 'level.dat',
  log: 'Log',
  crash_report: 'Crash Report',
  world_data: 'World Data',
};

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

export default function ManifestBanner({ manifest, expiresAt, onReset, onUpload, fileInputRef }: Props) {
  return (
    <header className="header">
      <HeaderLogo />
      <span className="header-title">Dump Viewer</span>
      <span className="header-sep">|</span>
      <div className="header-meta" style={{ flexWrap: 'wrap' }}>
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
        <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
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
        <>
          <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
          <ExpiryBadge expiresAt={expiresAt} />
        </>
      </div>
      <div className="header-spacer" />
      <ThemeToggle />
      <button className="upload-btn" onClick={onUpload}>
        ↑ Open Dump
      </button>
      <button
        className="upload-btn"
        onClick={onReset}
        style={{
          background: 'rgba(255,255,255,0.05)',
          color: 'var(--text)',
          borderColor: 'var(--border)',
        }}
      >
        ✕ Close
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            const event = new CustomEvent('dump-upload', { detail: file });
            window.dispatchEvent(event);
          }
          e.target.value = '';
        }}
      />
    </header>
  );
}
