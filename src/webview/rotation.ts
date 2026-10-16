import { newElementWith } from '@excalidraw/excalidraw';

/** Excalidraw element; upstream typings are partial and the app glues through `any`. */
export type Element = any;
export type Pt = { x: number; y: number };

const DEG_PER_RAD = 180 / Math.PI;
const TAU = Math.PI * 2;

export const toDeg = (rad: number) => rad * DEG_PER_RAD;
export const toRad = (deg: number) => deg / DEG_PER_RAD;
export const normalizeRad = (rad: number) => ((rad % TAU) + TAU) % TAU;

const isFrame = (e: Element) => e.type === 'frame' || e.type === 'magic_frame';
const isElbowArrow = (e: Element) => e.type === 'arrow' && e.elbowed;
const isLinear = (e: Element) => Array.isArray(e.points) && e.points.length > 0;

/** Rotation pivot of an element: the center of its local bounding box (points-aware for linear elements). */
const pivotOf = (e: Element): Pt => {
  if (isLinear(e)) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [px, py] of e.points) {
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    return { x: e.x + (minX + maxX) / 2, y: e.y + (minY + maxY) / 2 };
  }
  if (!Number.isFinite(e.width) || !Number.isFinite(e.height)) return { x: e.x, y: e.y };
  return { x: e.x + e.width / 2, y: e.y + e.height / 2 };
};

/** Screen-aligned bounds of an element, including its own rotation (all corners considered). */
const visualBounds = (e: Element) => {
  const c = pivotOf(e);
  const angle = e.angle ?? 0;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const hw = (e.width ?? 0) / 2, hh = (e.height ?? 0) / 2;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [dx, dy] of [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]]) {
    const x = c.x + dx * cos - dy * sin;
    const y = c.y + dx * sin + dy * cos;
    x1 = Math.min(x1, x); y1 = Math.min(y1, y);
    x2 = Math.max(x2, x); y2 = Math.max(y2, y);
  }
  return { x1, y1, x2, y2 };
};

/** Mid-gesture flag, so heavyweight background passes (text re-measure) can hold off while rotating. */
let gestureCount = 0;
export const rotationActive = () => gestureCount > 0;
export const beginRotation = () => { gestureCount++; };
export const endRotation = () => { gestureCount--; };

export type RotationPlan = {
  ids: Set<string>;
  /** Fixed pivot of the whole gesture (center of the selection's united bounds). */
  pivot: Pt;
  /** Top-center of the same united bounds — where the grip is anchored. */
  topCenter: Pt;
  /** Angle of the lone selected element when exactly one specific element is selected, else null. */
  singletonAngle: number | null;
};

/**
 * Decides what a rotation gesture moves: everything selected, minus frames (not rotatable)
 * and elbow arrows (their points are owned by their bindings), plus arrows whose ends are
 * glued to moving elements so they follow rigidly instead of breaking loose.
 */
export function planRotation(scene: readonly Element[], selectedIds: Record<string, boolean>): RotationPlan | null {
  const picked = scene.filter((e) => selectedIds[e.id] && !e.isDeleted);
  if (!picked.length || picked.some(isFrame)) return null;
  const ids = new Set<string>();
  for (const e of picked) if (!isElbowArrow(e)) ids.add(e.id);
  if (!ids.size) return null;
  for (const e of scene) {
    if (e.isDeleted || ids.has(e.id) || (e.type !== 'arrow' && e.type !== 'line') || isElbowArrow(e)) continue;
    const from = e.startBinding?.elementId, to = e.endBinding?.elementId;
    if ((from && ids.has(from)) || (to && ids.has(to))) ids.add(e.id);
  }
  const bounds = picked.reduce(
    (acc, e) => {
      const b = visualBounds(e);
      return {
        x1: Math.min(acc.x1, b.x1), y1: Math.min(acc.y1, b.y1),
        x2: Math.max(acc.x2, b.x2), y2: Math.max(acc.y2, b.y2),
      };
    },
    { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity },
  );
  const pivot = { x: (bounds.x1 + bounds.x2) / 2, y: (bounds.y1 + bounds.y2) / 2 };
  return { ids, pivot, topCenter: { x: pivot.x, y: bounds.y1 }, singletonAngle: picked.length === 1 ? picked[0].angle ?? 0 : null };
}

/** Rigid body step: the element spins around its own pivot while that pivot orbits the gesture pivot. */
export function rotateElement(e: Element, delta: number, pivot: Pt): Element {
  const c = pivotOf(e);
  const dx = c.x - pivot.x, dy = c.y - pivot.y;
  const cos = Math.cos(delta), sin = Math.sin(delta);
  const nx = pivot.x + dx * cos - dy * sin;
  const ny = pivot.y + dx * sin + dy * cos;
  return newElementWith(e, { x: e.x + (nx - c.x), y: e.y + (ny - c.y), angle: normalizeRad((e.angle ?? 0) + delta) });
}

export function rotateScene(scene: readonly Element[], plan: RotationPlan, delta: number): Element[] {
  if (!delta) return [...scene];
  return scene.map((e) => (plan.ids.has(e.id) ? rotateElement(e, delta, plan.pivot) : e));
}

/** Re-lays out freshly generated shape parts so they reproduce a rotated shape (used by `updateShape`). */
export function rotateShapeParts(parts: readonly Element[], angle: number, shape: Element): Element[] {
  if (!angle) return [...parts];
  const pivot = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  return parts.map((p) => rotateElement(p, angle, pivot));
}
