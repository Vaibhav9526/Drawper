export type ColumnType = 'int' | 'bigint' | 'text' | 'varchar' | 'boolean' | 'timestamp' | 'date' | 'uuid' | 'json' | 'float';

export interface Column {
  name: string;
  type: ColumnType;
  pk?: boolean;
  nullable?: boolean;
  unique?: boolean;
  ref?: string;
}

export type ServiceKind = 'client' | 'api' | 'worker' | 'gateway' | 'db' | 'cache' | 'queue' | 'storage';

export interface TableElement {
  id: string;
  name: string;
  columns: Column[];
}

export interface ServiceElement {
  id: string;
  kind: ServiceKind;
  name: string;
  tech?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DprDocument {
  type: 'drawper';
  version: 2;
  elements: any[];
  appState: { viewBackgroundColor?: string; gridSize?: number | null };
  files: Record<string, unknown>;
}

export const emptyDocument = (): DprDocument => ({ type: 'drawper', version: 2, elements: [], appState: {}, files: {} });

export function parseDocument(text: string): DprDocument {
  if (!text.trim()) return emptyDocument();
  const raw = JSON.parse(text) as Partial<DprDocument>;
  if (raw.version !== 2 || !Array.isArray(raw.elements)) throw new Error('Unsupported .dpr file: expected a Drawper v2 document.');
  return { ...emptyDocument(), ...raw } as DprDocument;
}

const live = (doc: DprDocument) => doc.elements.filter((e) => !e.isDeleted);
const kindOf = (e: any): string | undefined => e.customData?.drawper;

export const tables = (doc: DprDocument): TableElement[] =>
  live(doc).filter((e) => kindOf(e) === 'table').map((e) => ({ id: e.id, name: e.customData.name, columns: e.customData.columns ?? [] }));

export const services = (doc: DprDocument): ServiceElement[] =>
  live(doc).filter((e) => kindOf(e) === 'service').map((e) => ({
    id: e.id, kind: e.customData.kind, name: e.customData.name, tech: e.customData.tech, x: e.x, y: e.y, width: e.width, height: e.height,
  }));

export function serviceEdges(doc: DprDocument): { from: ServiceElement; to: ServiceElement }[] {
  const nodes = services(doc);
  const byId = new Map(nodes.map((s) => [s.id, s]));
  const at = (px: number, py: number) => nodes.find((s) => px >= s.x && px <= s.x + s.width && py >= s.y && py <= s.y + s.height);
  const edges: { from: ServiceElement; to: ServiceElement }[] = [];
  for (const e of live(doc)) {
    if (e.type !== 'arrow' || !e.points || e.points.length < 2) continue;
    const a = e.points[0];
    const b = e.points[e.points.length - 1];
    const from = byId.get(e.startBinding?.elementId) ?? at(e.x + a[0], e.y + a[1]);
    const to = byId.get(e.endBinding?.elementId) ?? at(e.x + b[0], e.y + b[1]);
    if (from && to && from !== to) edges.push({ from, to });
  }
  return edges;
}
