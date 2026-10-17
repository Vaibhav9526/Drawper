import { CHAR, FONT, LINE } from './codeCard';
import { DprDocument } from './model';

export interface OverlayMetrics {
  /** Width of one monospace column in the editor, in px. */
  charWidth: number;
  /** Height of one editor line, in px. */
  lineHeight: number;
}

export interface Overlay {
  svg: string;
  /** Zero-based editor line the drawing is anchored to. */
  line: number;
  /** Offset of the drawing's top-left from the start of that line, in px. */
  top: number;
  left: number;
  width: number;
  height: number;
}

const DRAWABLE = new Set(['freedraw', 'line', 'arrow', 'rectangle', 'ellipse', 'diamond', 'text']);
const PAD = 8;

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const n = (v: number) => Math.round(v * 10) / 10;

/** The canvas stores near-black ink that its dark theme flips to light; the editor needs the same flip. */
function ink(color: string | undefined): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color ?? '')?.[1];
  if (!hex) return color && color !== 'transparent' ? color : 'none';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 70 ? '#ffd900' : `#${hex}`;
}

/**
 * Turns the drawings that sit on a live code card into one SVG positioned in editor pixels,
 * so it can be laid over the real text editor. Returns undefined when there is nothing to draw.
 */
export function buildOverlay(doc: DprDocument, uri: string, m: OverlayMetrics): Overlay | undefined {
  const live = doc.elements.filter((e) => !e.isDeleted);
  const card = live.find((e) => e.customData?.drawper === 'code' && e.customData.live && e.customData.uri === uri);
  const code = card && live.find((e) => e.groupIds?.[0] === card.groupIds[0] && String(e.id).startsWith('code_text'));
  if (!card || !code) return undefined;

  const cardGroups = new Set(live.filter((e) => e.customData?.drawper === 'code').map((e) => e.groupIds?.[0]));
  const shapes = live.filter((e) => DRAWABLE.has(e.type) && !cardGroups.has(e.groupIds?.[0]));
  if (!shapes.length) return undefined;

  const sx = m.charWidth / (FONT * CHAR);
  const sy = m.lineHeight / (FONT * LINE);
  const X = (v: number) => (v - code.x) * sx;
  const Y = (v: number) => (v - code.y) * sy;

  type Item = { svg: (dx: number, dy: number) => string; box: [number, number, number, number] };
  const items: Item[] = shapes.map((e): Item => {
    const stroke = ink(e.strokeColor);
    const fill = e.backgroundColor && e.backgroundColor !== 'transparent' ? ink(e.backgroundColor) : 'none';
    const sw = Math.max(1, (e.strokeWidth ?? 2) * ((sx + sy) / 2));
    const dash = e.strokeStyle === 'dashed' ? ' stroke-dasharray="8 6"' : e.strokeStyle === 'dotted' ? ' stroke-dasharray="2 5"' : '';
    const common = `fill="${fill}" stroke="${stroke}" stroke-width="${n(sw)}" stroke-linecap="round" stroke-linejoin="round" opacity="${(e.opacity ?? 100) / 100}"${dash}`;
    const x = X(e.x), y = Y(e.y), w = (e.width ?? 0) * sx, h = (e.height ?? 0) * sy;
    const rot = (dx: number, dy: number) => (e.angle ? ` transform="rotate(${n((e.angle * 180) / Math.PI)} ${n(x + w / 2 - dx)} ${n(y + h / 2 - dy)})"` : '');

    if (e.type === 'freedraw' || e.type === 'line' || e.type === 'arrow') {
      const pts: [number, number][] = (e.points ?? []).map(([px, py]: number[]) => [x + px * sx, y + py * sy]);
      if (pts.length < 2 && e.type !== 'freedraw') return { svg: () => '', box: [x, y, x, y] };
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const box: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      return {
        box,
        svg: (dx, dy) => {
          const q = pts.map((p) => [p[0] - dx, p[1] - dy]);
          const d = e.type === 'arrow' || q.length < 3
            ? q.map((p, i) => `${i ? 'L' : 'M'}${n(p[0])} ${n(p[1])}`).join(' ')
            : `M${n(q[0][0])} ${n(q[0][1])} ${q.slice(1, -1).map((p, i) => `Q${n(p[0])} ${n(p[1])} ${n((p[0] + q[i + 2][0]) / 2)} ${n((p[1] + q[i + 2][1]) / 2)}`).join(' ')} L${n(q[q.length - 1][0])} ${n(q[q.length - 1][1])}`;
          let head = '';
          if (e.type === 'arrow' && e.endArrowhead !== null && pts.length >= 2) {
            const [bx, by] = pts[pts.length - 2], [ex, ey] = pts[pts.length - 1];
            const a = Math.atan2(ey - by, ex - bx), len = 12;
            const p1 = [ex - len * Math.cos(a - 0.5) - dx, ey - len * Math.sin(a - 0.5) - dy];
            const p2 = [ex - len * Math.cos(a + 0.5) - dx, ey - len * Math.sin(a + 0.5) - dy];
            head = `<path d="M${n(p1[0])} ${n(p1[1])} L${n(ex - dx)} ${n(ey - dy)} L${n(p2[0])} ${n(p2[1])}" ${common} fill="none"/>`;
          }
          return `<path d="${d}" ${e.type === 'freedraw' ? `${common} fill="${fill}"` : `${common} fill="none"`}/>${head}`;
        },
      };
    }
    if (e.type === 'text') {
      const size = (e.fontSize ?? 20) * sy;
      const lines = String(e.text ?? '').split('\n');
      return {
        box: [x, y, x + Math.max(...lines.map((l) => l.length), 1) * size * 0.6, y + lines.length * size * 1.25],
        svg: (dx, dy) => `<text${rot(dx, dy)} x="${n(x - dx)}" y="${n(y - dy)}" font-family="Consolas, Menlo, monospace" font-size="${n(size)}" fill="${stroke === 'none' ? '#ffd900' : stroke}" opacity="${(e.opacity ?? 100) / 100}" dominant-baseline="hanging">${lines.map((l, i) => `<tspan x="${n(x - dx)}" dy="${i ? n(size * 1.25) : 0}">${esc(l)}</tspan>`).join('')}</text>`,
      };
    }
    const box: [number, number, number, number] = [x, y, x + w, y + h];
    return {
      box,
      svg: (dx, dy) => {
        const rx = x - dx, ry = y - dy;
        if (e.type === 'ellipse') return `<ellipse${rot(dx, dy)} cx="${n(rx + w / 2)}" cy="${n(ry + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${common}/>`;
        if (e.type === 'diamond') return `<polygon${rot(dx, dy)} points="${n(rx + w / 2)},${n(ry)} ${n(rx + w)},${n(ry + h / 2)} ${n(rx + w / 2)},${n(ry + h)} ${n(rx)},${n(ry + h / 2)}" ${common}/>`;
        return `<rect${rot(dx, dy)} x="${n(rx)}" y="${n(ry)}" width="${n(w)}" height="${n(h)}" rx="${e.roundness ? 8 : 0}" ${common}/>`;
      },
    };
  }).filter((i) => Number.isFinite(i.box[0] + i.box[1] + i.box[2] + i.box[3]));
  if (!items.length) return undefined;

  const minX = Math.min(...items.map((i) => i.box[0])) - PAD, minY = Math.min(...items.map((i) => i.box[1])) - PAD;
  const maxX = Math.max(...items.map((i) => i.box[2])) + PAD, maxY = Math.max(...items.map((i) => i.box[3])) + PAD;
  const width = Math.ceil(maxX - minX), height = Math.ceil(maxY - minY);
  const line = Math.max(0, Math.floor(minY / m.lineHeight));
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="glow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="0" stdDeviation="1.6" flood-color="#000" flood-opacity=".55"/></filter></defs><g filter="url(#glow)">${items.map((i) => i.svg(minX, minY)).join('')}</g></svg>`,
    line, top: Math.round(minY - line * m.lineHeight), left: Math.round(minX), width, height,
  };
}
