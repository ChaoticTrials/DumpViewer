import { useRef, useState } from 'react';
import * as React from "react";

interface Props {
  onFile: (file: File) => void;
  error?: string;
}

export default function DropZone({ onFile, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = '';
  }

  return (
    <div
      className={`dropzone${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="dropzone-box" onClick={() => inputRef.current?.click()}>
        <span className="dropzone-icon">📦</span>
        <p className="dropzone-title">Drop a dump .zip here</p>
        <p className="dropzone-sub">or click to browse</p>
      </div>
      {error && <p className="dropzone-error">⚠ {error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </div>
  );
}
