/**
 * Vector art drawn from code rather than shipped as images: hand-drawn
 * emphasis marks, stars, laurels and the geometry of callouts, bubbles and
 * ratings. Pure, with no node imports: every function returns SVG path data
 * or plain numbers, which the CLI draws with Path2D and the studio with
 * inline SVG, so both show the same strokes.
 */

export type Box = { left: number; top: number; width: number; height: number };

/** A tiny seeded PRNG so a hand-drawn mark wobbles the same way on every render. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

const f = (n: number) => Number(n.toFixed(2));

/**
 * A loose, hand-drawn ellipse around a word box: a little more than one turn,
 * so the start and end overlap the way a pen circle does.
 */
export function circleMarkPath(box: Box, seed = 7): string {
  const r = rng(seed);
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  // Hug the word: a fixed margin in line-height units, not a share of the
  // width, so a long word does not swallow its neighbours.
  const rx = box.width / 2 + box.height * 0.28;
  const ry = box.height / 2 + box.height * 0.16;
  const turns = 1.12;
  const steps = 48;
  const start = -Math.PI * 0.85;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = start + (i / steps) * Math.PI * 2 * turns;
    // The radius drifts over the stroke, so the end lands off the start.
    const drift = 1 + (i / steps) * 0.08 + (r() - 0.5) * 0.02;
    const x = cx + Math.cos(t) * rx * drift;
    const y = cy + Math.sin(t) * ry * drift - (i / steps) * box.height * 0.08;
    d += `${i === 0 ? "M" : "L"}${f(x)} ${f(y)} `;
  }
  return d.trim();
}

/** A brush swoosh under a word box, rising slightly to the right. */
export function underlineMarkPath(box: Box, seed = 3): string {
  const r = rng(seed);
  const y = box.top + box.height * 0.98;
  const x0 = box.left - box.width * 0.02;
  const x1 = box.left + box.width * 1.03;
  const lift = box.height * 0.1;
  const c1x = x0 + (x1 - x0) * 0.35;
  const c2x = x0 + (x1 - x0) * 0.7;
  return (
    `M${f(x0)} ${f(y + lift * 0.4)} ` +
    `C${f(c1x)} ${f(y - lift * (0.2 + r() * 0.2))} ${f(c2x)} ${f(y + lift * 0.1)} ${f(x1)} ${f(y - lift)}`
  );
}

/** Stroke width of a mark, as a fraction of the word box height. */
export const MARK_STROKE = { circle: 0.07, underline: 0.11 } as const;

/** The highlighter band behind a word, as fractions of the word box. */
export const HIGHLIGHT = { top: 0.52, height: 0.42, padX: 0.04, alpha: 0.38 } as const;

/** A five-point star centred in a box. */
export function starPath(cx: number, cy: number, outer: number): string {
  const inner = outer * 0.48;
  let d = "";
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    d += `${i === 0 ? "M" : "L"}${f(cx + Math.cos(a) * rad)} ${f(cy + Math.sin(a) * rad)} `;
  }
  return `${d}Z`;
}

/**
 * One laurel branch: paired leaves along a "(" arc, with a leaf at the tip.
 * The left branch opens toward the centre; `mirror` draws the right one.
 */
export function laurelPath(box: Box, mirror = false): { leaves: string; stem: string } {
  const { left, top, width, height } = box;
  const R = Math.min(width * 1.1, height * 0.56);
  const cx = left + width * 0.15 + R;
  const cy = top + height / 2;
  const leafLen = R * 0.36;
  const leafW = leafLen * 0.36;
  const mx = (x: number) => (mirror ? 2 * (left + width / 2) - x : x);
  const leaf = (px: number, py: number, dx: number, dy: number) => {
    const n = Math.hypot(dx, dy) || 1;
    const ux = dx / n;
    const uy = dy / n;
    const tipX = px + ux * leafLen;
    const tipY = py + uy * leafLen;
    const midX = (px + tipX) / 2;
    const midY = (py + tipY) / 2;
    const nx = -uy * leafW;
    const ny = ux * leafW;
    return (
      `M${f(mx(px))} ${f(py)} Q${f(mx(midX + nx))} ${f(midY + ny)} ${f(mx(tipX))} ${f(tipY)} ` +
      `Q${f(mx(midX - nx))} ${f(midY - ny)} ${f(mx(px))} ${f(py)} Z `
    );
  };
  const a0 = (115 * Math.PI) / 180;
  const a1 = (238 * Math.PI) / 180;
  const pairs = 6;
  let d = "";
  for (let i = 0; i < pairs; i++) {
    const t = a0 + ((a1 - a0) * i) / pairs;
    const px = cx + R * Math.cos(t);
    const py = cy + R * Math.sin(t);
    // Tangent toward the top of the branch, and the outward normal.
    const tx = -Math.sin(t);
    const ty = Math.cos(t);
    const ox = Math.cos(t);
    const oy = Math.sin(t);
    d += leaf(px, py, tx * 0.75 + ox * 0.65, ty * 0.75 + oy * 0.65);
    d += leaf(px, py, tx * 0.75 - ox * 0.55, ty * 0.75 - oy * 0.55);
  }
  const tipX = cx + R * Math.cos(a1);
  const tipY = cy + R * Math.sin(a1);
  d += leaf(tipX, tipY, -Math.sin(a1), Math.cos(a1));
  // The stem, as a thin arc stroked on its own (filling it would fill the chord).
  let stem = "";
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps;
    stem += `${i === 0 ? "M" : "L"}${f(mx(cx + R * Math.cos(t)))} ${f(cy + R * Math.sin(t))} `;
  }
  return { leaves: d.trim(), stem: stem.trim() };
}

/**
 * Layout of a rating decoration inside its box: laurels either side, the big
 * value, a row of stars and a label. Sizes are fractions of the box width, so
 * the canvas and the studio's SVG agree.
 */
export function ratingGeometry(box: Box, hasLabel: boolean) {
  const { left, top, width } = box;
  const height = width * (hasLabel ? 0.56 : 0.46);
  const laurelW = width * 0.2;
  const centre = left + width / 2;
  const valueSize = width * 0.2;
  const starR = width * 0.034;
  const starsY = top + height * (hasLabel ? 0.56 : 0.72);
  const stars = Array.from({ length: 5 }, (_, i) =>
    starPath(centre + (i - 2) * starR * 2.5, starsY, starR),
  );
  return {
    height,
    /** The optional backing plate: the box padded a little, fully rounded. */
    plate: {
      left: left - width * 0.04,
      top: top - width * 0.04,
      width: width * 1.08,
      height: height + width * 0.08,
      radius: width * 0.08,
    },
    laurels: [
      laurelPath({ left, top, width: laurelW, height }, false),
      laurelPath({ left: left + width - laurelW, top, width: laurelW, height }, true),
    ],
    laurelStroke: width * 0.008,
    value: { x: centre, y: top + height * (hasLabel ? 0.08 : 0.12), size: valueSize },
    stars,
    label: hasLabel
      ? { x: centre, y: starsY + starR * 1.9, size: width * 0.058, maxWidth: width - 2 * laurelW }
      : null,
  };
}

/** Bubble padding, tail and radius as fractions of its font size. */
export const BUBBLE = {
  padX: 0.75,
  padY: 0.48,
  radius: 1.1,
  tail: 0.9,
  lineHeight: 1.18,
  /** The tail's root sits this far in from the bubble's side, as a fraction of its width. */
  tailInset: 0.16,
} as const;

/**
 * The outline of a speech bubble: a rounded rectangle with a tail at one
 * corner. Box is the body; the tail extends outside it.
 */
export function bubblePath(
  box: Box,
  radius: number,
  tail: "bottom-left" | "bottom-right" | "top-left" | "top-right" | "none",
  tailSize: number,
): string {
  const { left: x, top: y, width: w, height: h } = box;
  const r = Math.min(radius, h / 2, w / 2);
  const t = tailSize;
  const inset = Math.max(r, w * BUBBLE.tailInset);
  const bottom = tail.startsWith("bottom");
  const onLeft = tail.endsWith("left");
  // Tail as three points along the top or bottom edge.
  const root = onLeft ? x + inset : x + w - inset;
  const tip = onLeft ? root - t * 0.9 : root + t * 0.9;
  const other = onLeft ? root + t * 0.9 : root - t * 0.9;

  let d = `M${f(x + r)} ${f(y)} `;
  if (tail !== "none" && !bottom) {
    const [a, b] = onLeft ? [root, other] : [other, root];
    d += `L${f(a)} ${f(y)} L${f(tip)} ${f(y - t)} L${f(b)} ${f(y)} `;
  }
  d += `L${f(x + w - r)} ${f(y)} Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)} `;
  d += `L${f(x + w)} ${f(y + h - r)} Q${f(x + w)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)} `;
  if (tail !== "none" && bottom) {
    const [a, b] = onLeft ? [other, root] : [root, other];
    d += `L${f(a)} ${f(y + h)} L${f(tip)} ${f(y + h + t)} L${f(b)} ${f(y + h)} `;
  }
  d += `L${f(x + r)} ${f(y + h)} Q${f(x)} ${f(y + h)} ${f(x)} ${f(y + h - r)} `;
  d += `L${f(x)} ${f(y + r)} Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)} Z`;
  return d;
}

/**
 * Where a callout lands and how its source maps in. `screen` is the device
 * screen the capture fills (cover-fitted), in composition pixels before any
 * rotation; the region is given as fractions of that screen. Returns the card
 * box and the transform that draws the full screen image so the region fills
 * the card: draw the screen at (imageLeft, imageTop) sized imageWidth x
 * imageHeight, clipped to the card.
 */
export function calloutGeometry(
  d: {
    from: Box | { x: number; y: number; width: number; height: number };
    x: number;
    y: number;
    width: number;
    radius?: number;
  },
  tile: { width: number; height: number },
  screen: { width: number; height: number },
) {
  const from =
    "left" in d.from
      ? { x: d.from.left, y: d.from.top, width: d.from.width, height: d.from.height }
      : d.from;
  const width = tile.width * d.width;
  const regionW = from.width * screen.width;
  const regionH = from.height * screen.height;
  const k = regionW > 0 ? width / regionW : 1;
  const height = regionH * k;
  const left = tile.width * d.x;
  const top = tile.height * d.y;
  return {
    box: { left, top, width, height },
    radius: tile.width * (d.radius ?? 0.03),
    image: {
      left: left - from.x * screen.width * k,
      top: top - from.y * screen.height * k,
      width: screen.width * k,
      height: screen.height * k,
    },
  };
}

/** Shadow under lifted cards and art, as fractions of the tile width. */
export const CARD_SHADOW = {
  blur: 0.045,
  offsetY: 0.018,
  color: "rgba(15, 23, 42, 0.28)",
} as const;

/**
 * Approximate length of SVG path data made of M, L, Q, C and Z commands (the
 * ones this module emits), for animating a stroke being drawn.
 */
export function pathLength(d: string): number {
  const tokens = d.match(/[MLQCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  let i = 0;
  let cmd = "M";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let length = 0;
  const num = () => Number(tokens[i++]);
  const sample = (pt: (t: number) => [number, number]) => {
    let px = x;
    let py = y;
    for (let k = 1; k <= 16; k++) {
      const [nx, ny] = pt(k / 16);
      length += Math.hypot(nx - px, ny - py);
      px = nx;
      py = ny;
    }
    x = px;
    y = py;
  };
  while (i < tokens.length) {
    if (/^[MLQCZ]$/i.test(tokens[i]!)) cmd = tokens[i++]!.toUpperCase();
    if (cmd === "Z") {
      length += Math.hypot(startX - x, startY - y);
      x = startX;
      y = startY;
      continue;
    }
    if (cmd === "M") {
      x = startX = num();
      y = startY = num();
      cmd = "L";
    } else if (cmd === "L") {
      const nx = num();
      const ny = num();
      length += Math.hypot(nx - x, ny - y);
      x = nx;
      y = ny;
    } else if (cmd === "Q") {
      const [x0, y0, cx, cy, ex, ey] = [x, y, num(), num(), num(), num()];
      sample((t) => [
        (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * ex,
        (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * ey,
      ]);
    } else if (cmd === "C") {
      const [x0, y0, c1x, c1y, c2x, c2y, ex, ey] = [x, y, num(), num(), num(), num(), num(), num()];
      sample((t) => [
        (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * c1x + 3 * (1 - t) * t * t * c2x + t ** 3 * ex,
        (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * c1y + 3 * (1 - t) * t * t * c2y + t ** 3 * ey,
      ]);
    } else {
      i++;
    }
  }
  return length;
}
