export interface Manifest {
  manifest_version: 1;
  manifest_id: string;
  settings: Record<string, boolean>;
  versions: {
    skyblockbuilder: string;
    forge?: string;
    neoforge?: string;
    minecraft: string;
    libx?: string;
    minemention?: string;
    skyguis?: string;
  };
  files: Array<{ name: string; path: string }>;
}

export interface DumpFile {
  path: string;
  name: string;
  content: string | null;
  isBinary: boolean;
  size: number;
  rawBuffer?: ArrayBuffer;
}

export interface ParsedDump {
  manifest: Manifest;
  files: Map<string, DumpFile>;
}

export interface ConfigEntry {
  name: string;
  fullPath: string;
  changedPath: string | null;
  /** 'json5' = v1 changed-values file; 'diff' = v2 unified diff; null = no changed file */
  changedFormat: 'json5' | 'diff' | null;
}

export interface CategorizedFiles {
  configs: ConfigEntry[];
  islands: DumpFile[];
  spreads: DumpFile[];
  portals: DumpFile[];
  otherTemplates: DumpFile[];
  logs: DumpFile[];
  worldFiles: DumpFile[];
}

export type SelectedFile = { kind: 'config'; entry: ConfigEntry } | { kind: 'file'; file: DumpFile };
