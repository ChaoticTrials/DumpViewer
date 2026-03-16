import type { DumpFile } from '../../types';
import { formatBytes } from '../../manifest';
import { FaCube } from 'react-icons/fa6';

interface Props {
  file: DumpFile;
}

const DESCRIPTIONS: Record<string, string> = {
  '.nbt': 'Binary NBT structure — cannot be displayed as text. Use an NBT editor to inspect.',
  '.dat': 'Binary data file — cannot be displayed as text.',
};

export default function BinaryViewer({ file }: Props) {
  const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
  const desc = DESCRIPTIONS[ext] ?? 'Binary file — cannot be displayed as text.';

  return (
    <div className="binary-viewer">
      <FaCube style={{ fontSize: '8rem', color: 'var(--text-muted)' }} />
      <span className="binary-name">{file.name}</span>
      <span className="binary-size">{formatBytes(file.size)}</span>
      <p className="binary-note">{desc}</p>
    </div>
  );
}
