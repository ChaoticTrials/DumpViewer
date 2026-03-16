import { useState } from 'react';
import type { CategorizedFiles, ConfigEntry, DumpFile, SelectedFile } from '../types';
import { getConfigParseError } from '../utils/parseConfig';
import {
  FaFileCode,
  FaCodeCompare,
  FaCube,
  FaBug,
  FaCubes,
  FaDatabase,
  FaScroll,
  FaList,
  FaGlobe,
  FaCode,
  FaExclamation,
  FaTriangleExclamation,
} from 'react-icons/fa6';
import * as React from 'react';

interface Props {
  cat: CategorizedFiles;
  files: Map<string, DumpFile>;
  selected: SelectedFile | null;
  onSelect: (sel: SelectedFile) => void;
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ title, icon, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="tree-section">
      <button className="tree-section-header" onClick={() => setOpen(!open)}>
        <span className={`tree-chevron${open ? ' open' : ''}`}>▶</span>
        {icon}
        {title}
      </button>
      {open && <div className="tree-items">{children}</div>}
    </div>
  );
}

function configChangeBadge(entry: ConfigEntry, files: Map<string, DumpFile>): number | true {
  if (!entry.changedPath) return 0;
  const changed = files.get(entry.changedPath);
  if (!changed?.content) return 0;
  if (entry.changedFormat === 'diff') {
    return /^\+(?!\+\+)/m.test(changed.content) ? true : 0;
  }
  // v1 json5: indicate presence of changes (count can be misleading)
  return (changed.content.match(/^ {2}"[^"]+"\s*:/gm) ?? []).length > 0 ? true : 0;
}

function configHasParseError(entry: ConfigEntry, files: Map<string, DumpFile>): boolean {
  const file = files.get(entry.fullPath);
  if (!file?.content) return false;
  return getConfigParseError(file.content) !== undefined;
}

function configIsLarge(entry: ConfigEntry, files: Map<string, DumpFile>): boolean {
  const file = files.get(entry.fullPath);
  return (file?.size ?? 0) > LARGE_FILE_THRESHOLD;
}

function FileIcon({ file }: { file: DumpFile }) {
  const s = { fontSize: 12, opacity: 0.6, flexShrink: 0 as const };
  if (file.isBinary && file.name.endsWith('.dat')) return <FaDatabase style={s} />;
  if (file.isBinary) return <FaCube style={s} />;
  if (file.name === 'crash-report.txt') return <FaBug style={s} />;
  if (file.name.endsWith('.log')) return <FaList style={s} />;
  if (file.name.endsWith('.snbt')) return <FaScroll style={s} />;
  return <FaFileCode style={s} />;
}

const LARGE_FILE_THRESHOLD = 256 * 1024;

interface ItemProps {
  icon: React.ReactNode;
  name: string;
  active: boolean;
  badge?: number | true;
  hasError?: boolean;
  isLarge?: boolean;
  onClick: () => void;
}

function Item({ icon, name, active, badge, hasError, isLarge, onClick }: ItemProps) {
  return (
    <button className={`tree-item${active ? ' active' : ''}`} onClick={onClick} title={name}>
      {icon}
      <span className="tree-item-name">{name}</span>
      {hasError && (
        <span
          className="parse-error-badge"
          style={{
            background: 'rgba(248,113,113,0.1)',
            color: 'var(--log-error)',
            border: '1px solid rgba(248,113,113,0.3)',
          }}
        >
          <FaExclamation style={{ marginRight: 6 }} /> Error
        </span>
      )}
      {isLarge && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '1px 6px',
            borderRadius: 99,
            fontSize: 12,
            fontFamily: 'var(--mono)',
            background: 'rgba(251,191,36,0.12)',
            color: 'var(--log-warn)',
            border: '1px solid rgba(251,191,36,0.35)',
            flexShrink: 0,
            gap: 3,
          }}
        >
          <FaTriangleExclamation
            style={{
              fontSize: 16,
            }}
          />
          Large
        </span>
      )}
      {badge !== undefined && badge !== 0 && badge !== false && (
        <span className="diff-badge">
          <FaCodeCompare style={{ marginRight: badge === true ? 0 : 6 }} />
          {badge !== true && badge}
        </span>
      )}
    </button>
  );
}

function SubLabel({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: '6px 12px 2px 26px',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--text)',
        opacity: 0.45,
        userSelect: 'none',
      }}
    >
      {label}
    </div>
  );
}

function isConfigSelected(sel: SelectedFile | null, entry: ConfigEntry): boolean {
  if (!sel || sel.kind !== 'config') return false;
  return sel.entry.fullPath === entry.fullPath;
}

function isFileSelected(sel: SelectedFile | null, file: DumpFile): boolean {
  if (!sel || sel.kind !== 'file') return false;
  return sel.file.path === file.path;
}

export default function FileTree({ cat, files, selected, onSelect }: Props) {
  return (
    <nav className="sidebar">
      {cat.configs.length > 0 && (
        <Section title="Configs" icon={<FaCode style={{ fontSize: 12 }} />}>
          {cat.configs.map((entry) => (
            <Item
              key={entry.fullPath}
              icon={<FaCode style={{ fontSize: 12, opacity: 0.6, flexShrink: 0 }} />}
              name={entry.name}
              active={isConfigSelected(selected, entry)}
              badge={configChangeBadge(entry, files)}
              hasError={configHasParseError(entry, files)}
              isLarge={configIsLarge(entry, files)}
              onClick={() => onSelect({ kind: 'config', entry })}
            />
          ))}
        </Section>
      )}

      {(cat.islands.length > 0 || cat.spreads.length > 0 || cat.portals.length > 0 || cat.otherTemplates.length > 0) && (
        <Section title="Templates" icon={<FaCubes style={{ fontSize: 12 }} />} defaultOpen={false}>
          {cat.islands.length > 0 && (
            <>
              <SubLabel label="Islands" />
              {cat.islands.map((file) => (
                <Item
                  key={file.path}
                  icon={<FileIcon file={file} />}
                  name={file.name}
                  active={isFileSelected(selected, file)}
                  isLarge={file.size > LARGE_FILE_THRESHOLD}
                  onClick={() => onSelect({ kind: 'file', file })}
                />
              ))}
            </>
          )}
          {cat.spreads.length > 0 && (
            <>
              <SubLabel label="Spreads" />
              {cat.spreads.map((file) => (
                <Item
                  key={file.path}
                  icon={<FileIcon file={file} />}
                  name={file.name}
                  active={isFileSelected(selected, file)}
                  isLarge={file.size > LARGE_FILE_THRESHOLD}
                  onClick={() => onSelect({ kind: 'file', file })}
                />
              ))}
            </>
          )}
          {cat.portals.length > 0 && (
            <>
              <SubLabel label="Portals" />
              {cat.portals.map((file) => (
                <Item
                  key={file.path}
                  icon={<FileIcon file={file} />}
                  name={file.name}
                  active={isFileSelected(selected, file)}
                  onClick={() => onSelect({ kind: 'file', file })}
                />
              ))}
            </>
          )}
          {cat.otherTemplates.length > 0 && (
            <>
              <SubLabel label="Other" />
              {cat.otherTemplates.map((file) => (
                <Item
                  key={file.path}
                  icon={<FileIcon file={file} />}
                  name={file.name}
                  active={isFileSelected(selected, file)}
                  isLarge={file.size > LARGE_FILE_THRESHOLD}
                  onClick={() => onSelect({ kind: 'file', file })}
                />
              ))}
            </>
          )}
        </Section>
      )}

      {cat.logs.length > 0 && (
        <Section title="Logs" icon={<FaList style={{ fontSize: 12 }} />}>
          {cat.logs.map((file) => (
            <Item
              key={file.path}
              icon={<FileIcon file={file} />}
              name={file.name}
              active={isFileSelected(selected, file)}
              onClick={() => onSelect({ kind: 'file', file })}
            />
          ))}
        </Section>
      )}

      {cat.worldFiles.length > 0 && (
        <Section title="World" icon={<FaGlobe style={{ fontSize: 12 }} />} defaultOpen={true}>
          {cat.worldFiles.map((file) => (
            <Item
              key={file.path}
              icon={<FileIcon file={file} />}
              name={file.name}
              active={isFileSelected(selected, file)}
              onClick={() => onSelect({ kind: 'file', file })}
            />
          ))}
        </Section>
      )}
    </nav>
  );
}
