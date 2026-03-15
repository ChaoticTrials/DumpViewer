import { useState, useEffect } from 'react';
import * as React from 'react';

type BaseTheme = 'dark' | 'light' | 'system';

const BASE_CYCLE: BaseTheme[] = ['dark', 'light', 'system'];

function getSystemPref(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function buildTheme(base: BaseTheme, hc: boolean): string {
  const resolved = base === 'system' ? getSystemPref() : base;
  return hc ? `${resolved}-hc` : resolved;
}

function readBase(): BaseTheme {
  const v = localStorage.getItem('dump-viewer-base') as BaseTheme | null;
  if (v && BASE_CYCLE.includes(v)) return v;
  // migrate from old single-key storage
  const old = localStorage.getItem('dump-viewer-theme') ?? '';
  if (old.startsWith('light')) return 'light';
  return 'dark';
}

function readHc(): boolean {
  const v = localStorage.getItem('dump-viewer-hc');
  if (v !== null) return v === 'true';
  return (localStorage.getItem('dump-viewer-theme') ?? '').includes('hc');
}

// Apply immediately on module load to avoid flash
const _b = readBase();
const _h = readHc();
document.documentElement.setAttribute('data-theme', buildTheme(_b, _h));

// ── Icons ────────────────────────────────────────────────

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
      <path d="M12,9c1.65,0,3,1.35,3,3s-1.35,3-3,3s-3-1.35-3-3S10.35,9,12,9 M12,7c-2.76,0-5,2.24-5,5s2.24,5,5,5s5-2.24,5-5S14.76,7,12,7L12,7z M2,13l2,0c0.55,0,1-0.45,1-1s-0.45-1-1-1l-2,0c-0.55,0-1,0.45-1,1S1.45,13,2,13z M20,13l2,0c0.55,0,1-0.45,1-1s-0.45-1-1-1l-2,0c-0.55,0-1,0.45-1,1S19.45,13,20,13z M11,2v2c0,0.55,0.45,1,1,1s1-0.45,1-1V2c0-0.55-0.45-1-1-1S11,1.45,11,2z M11,20v2c0,0.55,0.45,1,1,1s1-0.45,1-1v-2c0-0.55-0.45-1-1-1C11.45,19,11,19.45,11,20z M5.99,4.58c-0.39-0.39-1.03-0.39-1.41,0c-0.39,0.39-0.39,1.03,0,1.41l1.06,1.06c0.39,0.39,1.03,0.39,1.41,0s0.39-1.03,0-1.41L5.99,4.58z M18.36,16.95c-0.39-0.39-1.03-0.39-1.41,0c-0.39,0.39-0.39,1.03,0,1.41l1.06,1.06c0.39,0.39,1.03,0.39,1.41,0c0.39-0.39,0.39-1.03,0-1.41L18.36,16.95z M19.42,5.99c0.39-0.39,0.39-1.03,0-1.41c-0.39-0.39-1.03-0.39-1.41,0l-1.06,1.06c-0.39,0.39-0.39,1.03,0,1.41s1.03,0.39,1.41,0L19.42,5.99z M7.05,18.36c0.39-0.39,0.39-1.03,0-1.41c-0.39-0.39-1.03-0.39-1.41,0l-1.06,1.06c-0.39,0.39-0.39,1.03,0,1.41s1.03,0.39,1.41,0L7.05,18.36z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
      <path d="M9.37,5.51C9.19,6.15,9.1,6.82,9.1,7.5c0,4.08,3.32,7.4,7.4,7.4c0.68,0,1.35-0.09,1.99-0.27C17.45,17.19,14.93,19,12,19c-3.86,0-7-3.14-7-7C5,9.07,6.81,6.55,9.37,5.51z M12,3c-4.97,0-9,4.03-9,9s4.03,9,9,9s9-4.03,9-9c0-0.46-0.04-0.92-0.1-1.36c-0.98,1.37-2.58,2.26-4.4,2.26c-2.98,0-5.4-2.42-5.4-5.4c0-1.81,0.89-3.42,2.26-4.4C12.92,3.04,12.46,3,12,3L12,3z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
      <path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h3l-1 1v1h12v-1l-1-1h3c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z" />
    </svg>
  );
}

function ContrastIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
      <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 16V5c3.86 0 7 3.14 7 7s-3.14 7-7 7z" />
    </svg>
  );
}

// ── Component ────────────────────────────────────────────

const BASE_TITLES: Record<BaseTheme, string> = {
  dark: 'Dark mode — click for light',
  light: 'Light mode — click for system',
  system: 'System mode — click for dark',
};

export default function ThemeToggle() {
  const [base, setBase] = useState<BaseTheme>(readBase);
  const [hc, setHc] = useState<boolean>(readHc);

  useEffect(() => {
    const apply = () => {
      document.documentElement.setAttribute('data-theme', buildTheme(base, hc));
    };
    apply();
    localStorage.setItem('dump-viewer-base', base);
    localStorage.setItem('dump-viewer-hc', String(hc));

    if (base !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [base, hc]);

  function cycleBase() {
    setBase((prev) => BASE_CYCLE[(BASE_CYCLE.indexOf(prev) + 1) % BASE_CYCLE.length]);
  }

  const BaseIcon = base === 'light' ? SunIcon : base === 'dark' ? MoonIcon : SystemIcon;

  const halfBtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 12px',
    background: 'var(--surface-subtle)',
    color: 'var(--text)',
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  };

  return (
    <div
      style={{
        display: 'flex',
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
        flexShrink: 0,
        height: 34,
      }}
    >
      <button style={halfBtn} onClick={cycleBase} title={BASE_TITLES[base]}>
        <BaseIcon />
      </button>
      <button
        style={{
          ...halfBtn,
          borderLeft: '1px solid var(--border)',
          ...(hc ? { color: 'var(--accent)', background: 'var(--accent-bg)' } : {}),
        }}
        onClick={() => setHc((v) => !v)}
        title={hc ? 'High contrast on — click to disable' : 'High contrast off — click to enable'}
      >
        <ContrastIcon />
      </button>
    </div>
  );
}
