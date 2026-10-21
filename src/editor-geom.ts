/**
 * Pure geometry for the studio's element editor: snapping a dragged box to
 * guide lines, snapping rotation to 15° steps, keyboard nudge amounts, and
 * fraction/pixel conversions. No node or DOM imports, like layouts.ts and
 * marks.ts, so the studio bundles it straight from src/ and both sides agree
 * on where a drag lands.
 */

export type Box = { left: number; top: number; width: number; height: number };

/** The nearest value in `guides` to `value`, when within `threshold`; passes through otherwise. */
export function snapToGuides(
  value: number,
  guides: number[],
  threshold: number,
): { value: number; snapped: boolean; guide: number | null } {
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const g of guides) {
    const d = Math.abs(value - g);
    if (d < bestDist) {
      bestDist = d;
      best = g;
    }
  }
  if (best !== null && bestDist <= threshold) return { value: best, snapped: true, guide: best };
  return { value, snapped: false, guide: null };
}

/**
 * The offset to add to a dragged box's position so that its left edge,
 * centre, or right edge (whichever is closest) lands on a guide, when one is
 * within `threshold`. Zero when none is. `axis` picks the box's x or y span.
 */
export function snapBoxDelta(
  start: number,
  size: number,
  guides: number[],
  threshold: number,
): { delta: number; guide: number | null } {
  const candidates = [start, start + size / 2, start + size];
  let best = { delta: 0, guide: null as number | null, dist: Number.POSITIVE_INFINITY };
  for (const c of candidates) {
    const hit = snapToGuides(c, guides, threshold);
    if (hit.snapped) {
      const dist = Math.abs(hit.value - c);
      if (dist < best.dist) best = { delta: hit.value - c, guide: hit.guide, dist };
    }
  }
  return { delta: best.delta, guide: best.guide };
}

/**
 * Guide lines a dragged box's edges and centre snap to: the tile's own centre
 * lines and edges (one tile wide, or `span` of them side by side, as a
 * panorama composes), plus the edges and centres of every other box on the
 * same composition.
 */
export function centerGuides(
  tileWidth: number,
  tileHeight: number,
  span: number,
  others: Box[],
): { x: number[]; y: number[] } {
  const x: number[] = [];
  for (let i = 0; i <= span; i++) x.push(tileWidth * i);
  for (let i = 0; i < span; i++) x.push(tileWidth * (i + 0.5));
  const y = [0, tileHeight / 2, tileHeight];
  for (const o of others) {
    x.push(o.left, o.left + o.width / 2, o.left + o.width);
    y.push(o.top, o.top + o.height / 2, o.top + o.height);
  }
  return { x, y };
}

/** Rotation snapped to `step` degrees (default 15) when `enabled` (Shift held); passed through otherwise. */
export function snapRotation(degrees: number, enabled: boolean, step = 15): number {
  return enabled ? Math.round(degrees / step) * step : degrees;
}

/** Arrow-key nudge, as a fraction of the tile's width or height. Shift is the bigger step. */
export function nudgeStep(big: boolean): number {
  return big ? 0.02 : 0.002;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** A pixel length as a fraction of `size`; 0 rather than NaN/Infinity when `size` is 0. */
export function toFraction(px: number, size: number): number {
  return size === 0 ? 0 : px / size;
}

export function fromFraction(fraction: number, size: number): number {
  return fraction * size;
}
