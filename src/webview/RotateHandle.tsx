import { useEffect, useRef } from 'react';
import { CaptureUpdateAction } from '@excalidraw/excalidraw';
import { beginRotation, endRotation, normalizeRad, planRotation, rotateScene, toDeg, toRad, type Element, type RotationPlan } from './rotation';

const FREE = { captureUpdate: CaptureUpdateAction.NEVER } as const;
const SNAP_DEG = [0, 90, 180, 270];
const SNAP_MAGNET = 3;
const SNAP_STEP = 15;
/** Below this screen-space distance from the pivot the angle is not trustworthy — freeze instead of jitter. */
const FREEZE_RADIUS = 24;

/** Pointer angle relative to the gesture pivot, in screen space (y down, clockwise positive). */
const angleAt = (ev: PointerEvent, pivot: { x: number; y: number }) => Math.atan2(ev.clientY - pivot.y, ev.clientX - pivot.x);
const nearestOf = (deg: number, steps: number[]) => steps.reduce((best, d) => (Math.abs(deg - d) < Math.abs(deg - best) ? d : best), steps[0]);

/** Scene coords → screen coords (mirrors Excalidraw's own sceneCoordsToViewportCoords layout math). */
const toScreen = (p: { x: number; y: number }, st: any) => {
  const zoom = st.zoom?.value ?? st.zoom ?? 1;
  return { x: (p.x + st.scrollX) * zoom + st.offsetLeft - window.scrollX, y: (p.y + st.scrollY) * zoom + st.offsetTop - window.scrollY };
};

type Drag = {
  plan: RotationPlan;
  pivot: { x: number; y: number };
  /** Grab-point angle at gesture start; every target angle is measured from it. */
  start: number;
  /** Cumulative rotation applied, radians — the history-free scene always matches this exactly. */
  applied: number;
  /** Continuous plate that keeps the shape glued to the pointer when Shift engages/disengages. */
  plate: number;
  /** Last Shift state, to detect engage/disengage and rotate smoothly across it. */
  shift: boolean;
  /** Pre-rotation copies of the moved elements, for Escape / pointercancel rollback. */
  snapshot: Element[];
};

const RESET = { plate: 0, shift: false, applied: 0 };

/**
 * Figma-style rotation grip. A DOM anchor parked above the current selection's top-center;
 * dragging the grip rotates the selection rigidly with the same pivot convention Excalidraw
 * itself uses for rotation, so stock tools, bindings and undo stay coherent.
 */
export function RotateHandle({ api }: { api: any }) {
  const anchor = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLSpanElement>(null);
  const ready = useRef<RotationPlan | null>(null);

  useEffect(() => {
    if (!api) return;
    let raf = 0;
    let drag: Drag | null = null;
    /** Latest pointer event; applied once inside the frame loop so fast mice can't flood the scene. */
    let pending: PointerEvent | null = null;

    const show = (on: boolean) => {
      const el = anchor.current;
      if (!el) return;
      el.style.visibility = on ? 'visible' : 'hidden';
      el.classList.toggle('dragging', !!drag);
    };

    const park = (point: { x: number; y: number }) => {
      const host = anchor.current?.parentElement;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const pos = toScreen(point, api.getAppState());
      Object.assign(anchor.current!.style, { left: `${pos.x - rect.left}px`, top: `${pos.y - rect.top}px` });
    };

    /** Applies one buffered pointer event: rotate to the snapped target, update the chip. */
    const apply = (ev: PointerEvent) => {
      if (!drag) return;
      const wanted = ev.shiftKey;
      const radius = Math.hypot(ev.clientX - drag.pivot.x, ev.clientY - drag.pivot.y);
      const raw = toDeg(angleAt(ev, drag.pivot) - drag.start);
      if (drag.shift && !wanted) {
        // Shift released: rebase so the free-hand angle continues exactly from the snapped one.
        drag.plate = toDeg(drag.applied) - raw;
      }
      drag.shift = wanted;
      if (radius < FREEZE_RADIUS) return; // keep the current pose; the formula is target-based, so no drift accumulates
      let total = raw + drag.plate;
      if (wanted) total = Math.round(total / SNAP_STEP) * SNAP_STEP; // Figma-style: one visible step onto the 15° grid
      else {
        const near = nearestOf(total, SNAP_DEG);
        if (Math.abs(total - near) <= SNAP_MAGNET) total = near;
      }
      const delta = toRad(total) - drag.applied;
      drag.applied = toRad(total);
      if (delta) api.updateScene({ elements: rotateScene(api.getSceneElements(), drag.plan, delta), ...FREE });
      const shown = drag.plan.singletonAngle === null ? drag.applied : normalizeRad(drag.plan.singletonAngle + drag.applied);
      if (chip.current) chip.current.textContent = `${Math.round(((toDeg(shown) % 360) + 360) % 360)}°`;
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const el = anchor.current;
      if (!el) return;
      if (drag) { // frozen grip while the user drags — position and pivot are captured at gesture start
        if (pending) { apply(pending); pending = null; }
        return;
      }
      const st = api.getAppState();
      const busy = st.isRotating || st.isResizing || !!st.editingTextElement || !!st.croppingElementId;
      const selectable = !busy && st.selectedElementIds && Object.keys(st.selectedElementIds).length > 0;
      const plan = selectable ? planRotation(api.getSceneElements(), st.selectedElementIds) : null;
      ready.current = plan;
      if (!plan) return show(false);
      park(plan.topCenter);
      show(true);
    };

    const down = (ev: PointerEvent) => {
      const plan = ready.current;
      if (!plan || !grip.current) return;
      ev.preventDefault();
      ev.stopPropagation();
      grip.current.setPointerCapture(ev.pointerId);
      pending = null;
      const pivot = toScreen(plan.pivot, api.getAppState());
      drag = {
        ...RESET,
        plan,
        pivot,
        start: angleAt(ev, pivot),
        snapshot: api.getSceneElements().filter((e: Element) => plan.ids.has(e.id)),
      };
      beginRotation();
      show(true);
      const initial = plan.singletonAngle === null ? 0 : normalizeRad(plan.singletonAngle);
      if (chip.current) chip.current.textContent = `${Math.round(toDeg(initial))}°`;
    };

    const restore = (snapshot: Element[]) => {
      const originals = new Map<string, Element>(snapshot.map((e) => [e.id, e] as [string, Element]));
      api.updateScene({ elements: api.getSceneElements().map((e: Element) => originals.get(e.id) ?? e), ...FREE });
    };

    /** Ends the gesture, rolling back to the snapshot when cancelled. */
    const end = (ev: PointerEvent) => {
      if (!drag) return;
      const cancelled = ev.type === 'pointercancel';
      const snapshot = drag.snapshot;
      drag = null;
      pending = null;
      endRotation();
      try { grip.current?.releasePointerCapture(ev.pointerId); } catch { /* capture already gone */ }
      if (cancelled) restore(snapshot);
      api.updateScene({ captureUpdate: CaptureUpdateAction.IMMEDIATELY }); // one clean undo step
    };

    const abort = (e: KeyboardEvent) => {
      if (!drag || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      const snapshot = drag.snapshot;
      drag = null;
      pending = null;
      endRotation();
      restore(snapshot);
      api.updateScene({ captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    };

    const move = (ev: PointerEvent) => {
      if (!drag) return;
      ev.preventDefault();
      pending = ev; // applied on the next frame — smooth regardless of the mouse's report rate
    };

    grip.current?.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', abort, true); // capture phase: preempts Excalidraw's own Escape handling
    raf = requestAnimationFrame(frame);

    return () => {
      if (drag) endRotation();
      cancelAnimationFrame(raf);
      grip.current?.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', abort, true);
    };
  }, [api]);

  return (
    <div ref={anchor} className="drawper-rotator">
      <span className="stem" />
      <span ref={grip} className="grip" role="button" aria-label="Rotate selection" tabIndex={-1}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.6-6.3" />
          <path d="M21 3v6h-6" />
        </svg>
      </span>
      <div ref={chip} className="deg" aria-live="polite" />
    </div>
  );
}
