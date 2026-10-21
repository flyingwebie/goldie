/**
 * Pure timing: the promo's output sizes, pacing constants, the scene
 * schedule (buildTimeline) and the easing curves the choreography uses. No
 * drawing, no file I/O - safe to unit test and to port into the generated
 * composition's own JS verbatim (composition.ts embeds the same formulas as
 * source text, see EASE_SOURCE), so a HyperFrames render reproduces the same
 * curves the old ffmpeg frame-pipe drew.
 */
import type { LoadedConfig } from "../config.ts";
import { DEVICES, type DeviceKey } from "../specs.ts";

export const PROMO_FORMATS = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
} as const;
export type PromoFormat = keyof typeof PROMO_FORMATS;

export const PROMO = {
  fps: 30,
  secondsPerScene: 3,
  /** The push from one scene to the next. */
  transition: 0.4,
  outroSeconds: 2.6,
  /** Type is set larger than on a store tile: a phone screen, not a gallery. */
  copyScale: 1.22,
  /** HyperFrames quality preset for the final render; draft/looks/delivery/standard/high. */
  quality: "standard",
} as const;

/** The device whose captures the promo shows: the first iPhone, else the config's first device. */
export function promoDevice(cfg: LoadedConfig, requested?: DeviceKey): DeviceKey {
  if (requested) return requested;
  return cfg.devices.find((d) => DEVICES[d].type === "iphone") ?? cfg.devices[0]!;
}

// ---------------------------------------------------------------- timeline

export type Timeline = {
  /** Start time of each scene; scene i is fully on screen from starts[i] + transition. */
  starts: number[];
  perScene: number;
  outroStart: number | null;
  total: number;
  frames: number;
};

/**
 * Scenes follow each other with an overlapping push: scene i+1 starts sliding
 * in `transition` seconds before scene i's slot ends. The outro pushes in the
 * same way.
 */
export function buildTimeline(count: number, perScene: number, outroSeconds: number): Timeline {
  const starts = Array.from({ length: count }, (_, i) => i * perScene);
  const scenesEnd = count * perScene;
  const outroStart = outroSeconds > 0 ? scenesEnd : null;
  const total = scenesEnd + outroSeconds + (outroSeconds > 0 ? 0 : PROMO.transition);
  return { starts, perScene, outroStart, total, frames: Math.round(total * PROMO.fps) };
}

/** One slot of the push sequence: a scene index, or the outro. */
export type Slot = { kind: "scene"; index: number } | { kind: "outro" };

/** Every slot with its visible window: `enterAt` (push-in starts) to `nextStart` (the next slot arrives). */
export function slots(
  timeline: Timeline,
): Array<{ slot: Slot; enterAt: number; start: number; nextStart: number }> {
  const { starts, outroStart } = timeline;
  const all: Slot[] = starts.map((_, index) => ({ kind: "scene", index }) as Slot);
  if (outroStart !== null) all.push({ kind: "outro" });
  const startOf = (k: number) => (k < starts.length ? starts[k]! : (outroStart ?? Infinity));
  return all.map((slot, k) => {
    const start = startOf(k);
    const nextStart = k + 1 < all.length ? startOf(k + 1) : Infinity;
    const enterAt = k === 0 ? 0 : start - PROMO.transition;
    return { slot, enterAt, start, nextStart };
  });
}

// ---------------------------------------------------------------- easing

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const easeOutCubic = (t: number) => 1 - (1 - clamp01(t)) ** 3;
export const easeInOutCubic = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
/** Overshoots a little before settling: a spring-like arrival. */
export const easeOutBack = (t: number) => {
  const x = clamp01(t);
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};
/** Progress of an animation that starts at `start` and lasts `dur`, at local time t. */
export const phase = (t: number, start: number, dur: number) => clamp01((t - start) / dur);

/**
 * The exact JS source of the easings above, embedded verbatim in every
 * generated composition's <script> so the GSAP timeline that HyperFrames
 * renders scrubs the identical curves this module exposes to buildTimeline's
 * callers and to promo.test.ts. Keep this in sync with the functions above -
 * composition.test.ts checks the two agree at a set of sample points.
 */
export const EASE_SOURCE = `
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function cubicOut(t) { return 1 - Math.pow(1 - clamp01(t), 3); }
function cubicInOut(t) { var x = clamp01(t); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
function backOut(t) { var x = clamp01(t); var c1 = 1.5; var c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
/** easeOutCubic(p*1.6), clamped - the decoration pop's opacity finishes before its scale settles. */
function decoOpacityEase(t) { return cubicOut(Math.min(1, t * 1.6)); }
/** clamp01(easeOutBack(p)*1.5) - the outro icon/CTA's opacity finishes before their spring settles. */
function popOpacityEase(t) { return clamp01(backOut(t) * 1.5); }
`.trim();
