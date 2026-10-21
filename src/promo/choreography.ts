/**
 * The promo's entrance choreography, as GSAP tween specs instead of
 * per-frame canvas states: copy lines rise, emphasis marks draw themselves,
 * devices spring up, decorations pop and float, panoramas pan, and scenes
 * push into each other. Every timing constant and easing here is ported
 * verbatim from the old frame-by-frame renderer (see timeline.ts's
 * EASE_SOURCE, embedded in the generated composition so GSAP scrubs the
 * identical curves). Pure data in, pure data out - no canvas, no DOM.
 */
import type { Decoration } from "../config.ts";
import type { SceneLayer } from "../draw.ts";
import { PROMO } from "./timeline.ts";

export type Ease =
  | "cubicOut"
  | "cubicInOut"
  | "backOut"
  | "decoOpacityEase"
  | "popOpacityEase"
  | "sineInOut";

export type Tween = {
  selector: string;
  /** Omit for a .set() (an instant, non-animated change) at `position`. */
  from?: Record<string, number | string>;
  to: Record<string, number | string>;
  duration?: number;
  /** Absolute seconds on the composition's global GSAP timeline. */
  position: number;
  ease?: Ease;
  repeat?: number;
  yoyo?: boolean;
};

const cssId = (id: string) => `#${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

/** The background image/backdrop's slow push-in: scale only, no entrance fade. */
export function backgroundTween(layer: SceneLayer, enterAt: number): Tween {
  return {
    selector: cssId(layer.id),
    from: { scale: 1.08 },
    to: { scale: 1 },
    duration: 3.2,
    position: enterAt,
    ease: "cubicOut",
  };
}

/** A copy line's (and its paired marks layer's, same params) rise: fade and settle up from below. */
export function copyLineRise(
  selector: string,
  block: "kicker" | "headline" | "subhead",
  index: number,
  H: number,
  enterAt: number,
): Tween {
  const offset =
    block === "kicker" ? 0 : block === "headline" ? 0.12 + index * 0.11 : 0.55 + index * 0.08;
  return {
    selector,
    from: { opacity: 0, y: H * 0.035 },
    to: { opacity: 1, y: 0 },
    duration: 0.5,
    position: enterAt + 0.08 + offset,
    ease: "cubicOut",
  };
}

/** A headline's emphasis mark drawing itself in: one shared reveal per scene. */
export function marksReveal(selector: string, enterAt: number): Tween {
  return {
    selector,
    from: { clipPath: "inset(0% 100% 0% 0%)" },
    to: { clipPath: "inset(0% 0% 0% 0%)" },
    duration: 0.55,
    position: enterAt + 0.75,
    ease: "cubicInOut",
  };
}

/** A device springing up, index `i` among the scene's devices (back to front). */
export function deviceTweens(selector: string, i: number, H: number, enterAt: number): Tween[] {
  const start = enterAt + 0.3 + i * 0.12;
  const duration = 0.85;
  return [
    { selector, to: { opacity: 1 }, position: start },
    { selector, from: { y: H * 0.55 }, to: { y: 0 }, duration, position: start, ease: "backOut" },
    {
      selector,
      from: { rotation: 5 },
      to: { rotation: 0 },
      duration,
      position: start,
      ease: "cubicOut",
    },
  ];
}

/**
 * A decoration popping in (and, for art and bubbles, floating afterward).
 * `order` counts this decoration among others on the same side (back/front),
 * as the old per-frame decorationMotion did.
 */
export function decorationTweens(
  selector: string,
  d: Decoration,
  side: "back" | "front",
  order: number,
  H: number,
  enterAt: number,
): Tween[] {
  const start =
    enterAt + (side === "front" ? 0.95 : 0.55) + order * 0.14 + (d.kind === "callout" ? 0.1 : 0);
  const duration = 0.55;
  const from = d.kind === "callout" ? 0.82 : d.kind === "badge" ? 0.9 : 0.55;
  const tweens: Tween[] = [
    {
      selector,
      from: { opacity: 0 },
      to: { opacity: 1 },
      duration,
      position: start,
      ease: "decoOpacityEase",
    },
    {
      selector,
      from: { scale: from },
      to: { scale: 1 },
      duration,
      position: start,
      ease: "backOut",
    },
    { selector, from: { y: H * 0.02 }, to: { y: 0 }, duration, position: start, ease: "cubicOut" },
  ];
  // Art and speech bubbles keep breathing once landed; UI cards (badges, callouts, ratings) stay put.
  if (d.kind === "image" || d.kind === "bubble") {
    const amplitude = H * 0.004;
    tweens.push({
      selector,
      to: { y: `+=${amplitude}` },
      duration: 1.2,
      position: start + duration,
      ease: "sineInOut",
      repeat: -1,
      yoyo: true,
    });
  }
  return tweens;
}

/** The scene's push-in from the right (first scene excepted) and push-out to the left. */
export function scenePushTweens(
  selector: string,
  width: number,
  enterAt: number,
  start: number,
  nextStart: number,
): Tween[] {
  const T = PROMO.transition;
  const tweens: Tween[] = [];
  if (start > enterAt) {
    tweens.push({
      selector,
      from: { x: width },
      to: { x: 0 },
      duration: T,
      position: enterAt,
      ease: "cubicInOut",
    });
  }
  if (Number.isFinite(nextStart)) {
    tweens.push({
      selector,
      from: { x: 0 },
      to: { x: -width },
      duration: T,
      position: nextStart - T,
      ease: "cubicInOut",
    });
  }
  return tweens;
}

/** A panorama's camera pan across its double-wide composition. */
export function panTween(
  selector: string,
  panDistance: number,
  perScene: number,
  enterAt: number,
): Tween {
  return {
    selector,
    from: { x: 0 },
    to: { x: -panDistance },
    duration: Math.max(0.5, perScene - 1.2),
    position: enterAt + 0.9,
    ease: "cubicInOut",
  };
}

// ---------------------------------------------------------------- outro

/** The outro icon's pop-in: a spring scale, with opacity finishing a touch earlier. */
export function outroIconTweens(selector: string, enterAt: number): Tween[] {
  const start = enterAt + 0.15;
  const duration = 0.6;
  return [
    {
      selector,
      from: { opacity: 0 },
      to: { opacity: 1 },
      duration,
      position: start,
      ease: "popOpacityEase",
    },
    {
      selector,
      from: { scale: 0.6 },
      to: { scale: 1 },
      duration,
      position: start,
      ease: "backOut",
    },
  ];
}

/** One line of the outro headline, rising the same way a scene's headline does. */
export function outroHeadlineLineTween(
  selector: string,
  index: number,
  height: number,
  enterAt: number,
): Tween {
  return {
    selector,
    from: { opacity: 0, y: height * 0.03 },
    to: { opacity: 1, y: 0 },
    duration: 0.5,
    position: enterAt + 0.35 + index * 0.1,
    ease: "cubicOut",
  };
}

/** The outro's call-to-action pill: the same pop as the icon, later. */
export function outroCtaTweens(selector: string, enterAt: number): Tween[] {
  const start = enterAt + 0.75;
  const duration = 0.5;
  return [
    {
      selector,
      from: { opacity: 0 },
      to: { opacity: 1 },
      duration,
      position: start,
      ease: "popOpacityEase",
    },
    {
      selector,
      from: { scale: 0.8 },
      to: { scale: 1 },
      duration,
      position: start,
      ease: "backOut",
    },
  ];
}
