import type { Manifest } from '../types';
import ThemeToggle from './ThemeToggle';
import * as React from 'react';
import { HeaderLogo } from './HeaderLogo.tsx';

interface Props {
  manifest: Manifest;
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

export default function ManifestBanner({ manifest, onReset, onUpload, fileInputRef }: Props) {
  return (
    <header className="header">
      <HeaderLogo />
      <span className="header-title">Dump Viewer</span>
      <span className="header-sep">|</span>
      <div className="header-meta">
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
