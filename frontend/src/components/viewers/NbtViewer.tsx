import { useState, useEffect } from 'react';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { useHighlighterTheme } from '../../utils/useHighlighterTheme';

// NBT tag type constants
const TAG_END = 0;
const TAG_BYTE = 1;
const TAG_SHORT = 2;
const TAG_INT = 3;
const TAG_LONG = 4;
const TAG_FLOAT = 5;
const TAG_DOUBLE = 6;
const TAG_BYTE_ARRAY = 7;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;
const TAG_INT_ARRAY = 11;
const TAG_LONG_ARRAY = 12;

const MAX_NBT_DEPTH = 64;
const MAX_ARRAY_LENGTH = 1_000_000;
const MAX_COMPOUND_KEYS = 100_000;
const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024; // 256 MB gzip output cap
const MAX_SNBT_CHARS = 5_000_000; // 5 MB string cap to prevent main-thread freeze

class NBTReader {
  private view: DataView;
  private offset: number = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  readByte() {
    return this.view.getInt8(this.offset++);
  }
  readUByte() {
    return this.view.getUint8(this.offset++);
  }
  readShort() {
    const v = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return v;
  }
  readInt() {
    const v = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return v;
  }
  readLong() {
    const hi = this.view.getInt32(this.offset, false);
    const lo = this.view.getUint32(this.offset + 4, false);
    this.offset += 8;
    return hi * 4294967296 + lo;
  }
  readFloat() {
    const v = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return v;
  }
  readDouble() {
    const v = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    return v;
  }
  readString() {
    const len = this.view.getUint16(this.offset, false);
    this.offset += 2;
    const bytes = new Uint8Array(this.view.buffer, this.offset, len);
    this.offset += len;
    return new TextDecoder().decode(bytes);
  }

  readPayload(type: number, depth: number = 0): unknown {
    if (depth > MAX_NBT_DEPTH) throw new Error('NBT structure too deeply nested');
    switch (type) {
      case TAG_BYTE:
        return this.readByte();
      case TAG_SHORT:
        return this.readShort();
      case TAG_INT:
        return this.readInt();
      case TAG_LONG:
        return this.readLong();
      case TAG_FLOAT:
        return this.readFloat();
      case TAG_DOUBLE:
        return this.readDouble();
      case TAG_BYTE_ARRAY: {
        const len = this.readInt();
        if (len < 0 || len > MAX_ARRAY_LENGTH) throw new Error(`TAG_BYTE_ARRAY length out of range: ${len}`);
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(this.readByte());
        return arr;
      }
      case TAG_STRING:
        return this.readString();
      case TAG_LIST: {
        const elemType = this.readUByte();
        const len = this.readInt();
        if (len < 0 || len > MAX_ARRAY_LENGTH) throw new Error(`TAG_LIST length out of range: ${len}`);
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(this.readPayload(elemType, depth + 1));
        return { __list: true, elemType, values: arr };
      }
      case TAG_COMPOUND: {
        // Object.create(null) prevents prototype pollution via __proto__/constructor keys
        const obj: Record<string, unknown> = Object.create(null);
        let keyCount = 0;
        while (true) {
          const tagType = this.readUByte();
          if (tagType === TAG_END) break;
          if (++keyCount > MAX_COMPOUND_KEYS) throw new Error('TAG_COMPOUND has too many keys');
          const name = this.readString();
          obj[name] = { __type: tagType, value: this.readPayload(tagType, depth + 1) };
        }
        return obj;
      }
      case TAG_INT_ARRAY: {
        const len = this.readInt();
        if (len < 0 || len > MAX_ARRAY_LENGTH) throw new Error(`TAG_INT_ARRAY length out of range: ${len}`);
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(this.readInt());
        return arr;
      }
      case TAG_LONG_ARRAY: {
        const len = this.readInt();
        if (len < 0 || len > MAX_ARRAY_LENGTH) throw new Error(`TAG_LONG_ARRAY length out of range: ${len}`);
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(this.readLong());
        return arr;
      }
      default:
        throw new Error(`Unknown tag type: ${type}`);
    }
  }

  readRoot() {
    const type = this.readUByte();
    if (type === TAG_END) return null;
    const name = this.readString();
    return { name, value: this.readPayload(type), type };
  }
}

function toSnbt(value: unknown, type: number, indent: number = 0, full = false): string {
  const pad = '  '.repeat(indent);
  const pad1 = '  '.repeat(indent + 1);

  if (type === TAG_COMPOUND) {
    const obj = value as Record<string, { __type: number; value: unknown }>;
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';
    const lines = entries.map(([k, v]) => `${pad1}${JSON.stringify(k)}: ${toSnbt(v.value, v.__type, indent + 1, full)}`);
    return `{\n${lines.join(',\n')}\n${pad}}`;
  }
  if (type === TAG_LIST) {
    const list = value as { __list: true; elemType: number; values: unknown[] };
    if (list.values.length === 0) return '[]';
    if (!full && list.values.length > 100) return `[... ${list.values.length} elements ...]`;
    const items = list.values.map((v) => `${pad1}${toSnbt(v, list.elemType, indent + 1, full)}`);
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (type === TAG_BYTE_ARRAY || type === TAG_INT_ARRAY || type === TAG_LONG_ARRAY) {
    const arr = value as number[];
    if (!full && arr.length > 32) return `[... ${arr.length} values ...]`;
    return `[${arr.join(', ')}]`;
  }
  if (type === TAG_STRING) return JSON.stringify(value);
  if (type === TAG_FLOAT) return `${value}f`;
  if (type === TAG_DOUBLE) return `${value}d`;
  if (type === TAG_LONG) return `${value}L`;
  if (type === TAG_BYTE) return `${value}b`;
  if (type === TAG_SHORT) return `${value}s`;
  return String(value);
}

async function decompress(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(buffer));
  writer.close();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_DECOMPRESSED_BYTES) {
      reader.cancel();
      throw new Error('Decompressed NBT data exceeds size limit');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result.buffer;
}

interface Props {
  rawBuffer: ArrayBuffer;
}

interface ParsedRoot {
  value: unknown;
  type: number;
}

export default function NbtViewer({ rawBuffer }: Props) {
  const hlStyle = useHighlighterTheme();
  const [root, setRoot] = useState<ParsedRoot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRoot(null);
    setError(null);
    setFull(false);

    async function parse() {
      try {
        const decompressed = await decompress(rawBuffer);
        const reader = new NBTReader(decompressed);
        const parsed = reader.readRoot();
        if (!cancelled) setRoot(parsed ? { value: parsed.value, type: parsed.type } : { value: {}, type: TAG_COMPOUND });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    parse();
    return () => {
      cancelled = true;
    };
  }, [rawBuffer]);

  if (error) {
    const isLimitError = /too deeply nested|out of range|too many keys|exceeds size limit|too large/i.test(error);
    return (
      <div style={{ padding: '16px', color: isLimitError ? '#e5c07b' : '#e06c75', fontFamily: 'var(--mono)', fontSize: '13px' }}>
        {isLimitError
          ? 'This NBT file is too large or complex to display. You can download the raw file to inspect it.'
          : `Failed to parse NBT: ${error}`}
      </div>
    );
  }

  if (root === null) {
    return <div style={{ padding: '16px', color: '#abb2bf', fontFamily: 'var(--mono)', fontSize: '13px' }}>Parsing NBT data...</div>;
  }

  let snbt = toSnbt(root.value, root.type, 0, full);
  let wasTruncated = false;
  if (snbt.length > MAX_SNBT_CHARS) {
    snbt = snbt.slice(0, MAX_SNBT_CHARS) + '\n\n[... output truncated — too large to display ...]';
    wasTruncated = true;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 14px',
          background: 'var(--bg2)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button
          className={`action-btn${full ? ' action-btn-primary' : ''}`}
          onClick={() => setFull((v) => !v)}
          title={full ? 'Click to trim large arrays again' : 'Click to expand all arrays without truncation'}
        >
          {full ? 'Trimming disabled' : 'Expand all arrays'}
        </button>
      </div>
      {wasTruncated && (
        <div
          style={{
            background: '#3d3008',
            color: '#e5c07b',
            padding: '6px 14px',
            fontSize: '12px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          Output truncated at 5 MB. Download the raw file to inspect the full content.
        </div>
      )}
      <div className="code-wrap" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <SyntaxHighlighter
          language="json"
          style={hlStyle}
          showLineNumbers
          customStyle={{
            margin: 0,
            borderRadius: 0,
            fontSize: '12.5px',
            lineHeight: '1.6',
            minHeight: '100%',
            padding: '8px 0',
          }}
          codeTagProps={{ style: { fontFamily: 'var(--mono)' } }}
        >
          {snbt}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
