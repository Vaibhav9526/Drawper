import { DprDocument } from './model';

export interface CodeSnippet {
  code: string;
  file: string;
  startLine: number;
  language?: string;
  /** Source document uri; set on live cards so they can be refreshed when the file changes. */
  uri?: string;
}

export interface CardOptions {
  /** A live card shows the whole file, is locked so drawing over it never grabs it, and follows edits to the file. */
  live?: boolean;
}

export const FONT = 14;
export const LINE = 1.25;
export const CHAR = 0.62;
const PAD = 16;
const HEADER = 34;
const MAX_LINES = 60;
const MAX_LIVE_LINES = 400;
const MAX_COLS = 110;
const GAP = 60;

const INK = '#2e2936';
const PAPER = '#1c1a22';
const YELLOW = '#ffd900';
const MUTED = '#8b8696';
const LIGHT = '#e9e6ef';

let counter = 0;
const nid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const base = (type: string, id: string, x: number, y: number, width: number, height: number, groupId: string, locked = false) => ({
  type, id, x, y, width, height, angle: 0, strokeColor: INK, backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
  roughness: 0, opacity: 100, groupIds: [groupId], frameId: null, roundness: null, seed: Math.floor(Math.random() * 2 ** 31), version: 1,
  versionNonce: Math.floor(Math.random() * 2 ** 31), isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked,
});

const text = (id: string, x: number, y: number, value: string, color: string, groupId: string, fontSize = FONT, locked = false) => {
  const lines = value.split('\n');
  const width = Math.ceil(Math.max(1, ...lines.map((l) => l.length)) * fontSize * CHAR);
  return {
    ...base('text', id, x, y, width, Math.ceil(lines.length * fontSize * LINE), groupId, locked), strokeColor: color, text: value, originalText: value, fontSize,
    fontFamily: 3, textAlign: 'left', verticalAlign: 'top', containerId: null, lineHeight: LINE, autoResize: true,
  };
};

export function prepareSnippet(code: string, maxLines = MAX_LINES): { lines: string[]; truncated: boolean } {
  const lines = code.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/\n+$/, '').split('\n');
  const clipped = lines.slice(0, maxLines).map((l) => (l.length > MAX_COLS ? `${l.slice(0, MAX_COLS - 1)}…` : l));
  return { lines: clipped, truncated: lines.length > maxLines };
}

/** A rounded card holding the code, a line-number gutter and a file:line header, all in one group. */
export function codeCardElements(snippet: CodeSnippet, x: number, y: number, { live = false }: CardOptions = {}): any[] {
  const { lines, truncated } = prepareSnippet(snippet.code, live ? MAX_LIVE_LINES : MAX_LINES);
  if (truncated) lines.push('…');
  const first = snippet.startLine;
  const last = first + lines.length - (truncated ? 2 : 1);
  const gutter = lines.map((_, i) => (truncated && i === lines.length - 1 ? '' : String(first + i))).join('\n');
  const gutterW = String(last).length * FONT * CHAR;
  const codeW = Math.max(...lines.map((l) => l.length), 1) * FONT * CHAR;
  const width = Math.ceil(PAD * 2 + gutterW + 14 + codeW);
  const height = Math.ceil(HEADER + PAD + lines.length * FONT * LINE);
  const group = nid('grp_code');
  const title = `${snippet.file}:${first}${last > first ? `-${last}` : ''}`;
  const customData = { drawper: 'code', file: snippet.file, startLine: first, endLine: last, language: snippet.language, uri: snippet.uri, live };

  const card = { ...base('rectangle', nid('code'), x, y, width, height, group), backgroundColor: PAPER, strokeColor: YELLOW, roundness: { type: 3 }, customData, locked: live };
  const bar = { ...base('rectangle', nid('code_bar'), x, y, width, HEADER, group), backgroundColor: YELLOW, strokeColor: YELLOW, roundness: { type: 3 }, locked: live };
  return [
    card,
    bar,
    text(nid('code_title'), x + PAD, y + 9, title, INK, group, 15, live),
    text(nid('code_gutter'), x + PAD, y + HEADER + 4, gutter, MUTED, group, FONT, live),
    text(nid('code_text'), x + PAD + gutterW + 14, y + HEADER + 4, lines.join('\n'), LIGHT, group, FONT, live),
  ];
}

/** Appends a code card below everything already on the canvas. */
export function addCodeCard(doc: DprDocument, snippet: CodeSnippet): DprDocument {
  const live = doc.elements.filter((e) => !e.isDeleted);
  const left = live.length ? Math.min(...live.map((e) => e.x ?? 0)) : 0;
  const bottom = live.length ? Math.max(...live.map((e) => (e.y ?? 0) + (e.height ?? 0))) : 0;
  return { ...doc, elements: [...doc.elements, ...codeCardElements(snippet, left, live.length ? bottom + GAP : 0)] };
}

const isLiveCard = (e: any, uri: string) => e.customData?.drawper === 'code' && e.customData.live && e.customData.uri === uri;

/** Adds the whole-file card, or refreshes the existing one in place so drawings made over it keep their position. */
export function upsertLiveCard(doc: DprDocument, snippet: CodeSnippet): DprDocument {
  const uri = snippet.uri ?? snippet.file;
  const old = doc.elements.find((e) => !e.isDeleted && isLiveCard(e, uri));
  if (!old) {
    const live = doc.elements.filter((e) => !e.isDeleted);
    const top = live.length ? Math.min(...live.map((e) => e.y ?? 0)) : 0;
    return { ...doc, elements: [...codeCardElements({ ...snippet, uri }, 0, top, { live: true }), ...doc.elements] };
  }
  const group = old.groupIds[0];
  const first = doc.elements.findIndex((e) => e.groupIds?.[0] === group);
  const rest = doc.elements.filter((e) => e.groupIds?.[0] !== group);
  const fresh = codeCardElements({ ...snippet, uri }, old.x, old.y, { live: true });
  return { ...doc, elements: [...rest.slice(0, first), ...fresh, ...rest.slice(first)] };
}

export const hasLiveCard = (doc: DprDocument, uri: string) => doc.elements.some((e) => !e.isDeleted && isLiveCard(e, uri));
