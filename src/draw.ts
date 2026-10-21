/**
 * Draws one screenshot composition onto a 2D canvas: background, art, copy,
 * decorations and devices, in that order. The still renderer (render.ts)
 * calls it once per tile; the promo video (promo.ts) calls it once per frame
 * with a Motion that moves each layer, so a video frame and the exported PNG
 * come from the same code. Geometry comes from compose() (layouts.ts) and the
 * pure helpers in marks.ts and richtext.ts, which the studio's DOM twin uses
 * too.
 */
import { type CanvasGradient, type Image, Path2D, type SKRSContext2D } from "@napi-rs/canvas";
import type { Decoration, EmphasisStyle, Theme } from "./config.ts";
import { withGlyphFallback } from "./fonts.ts";
import type { FrameGeometry } from "./frame.ts";
import { BADGE, type Composition, SCREEN_SHADOW, TYPE } from "./layouts.ts";
import {
  BUBBLE,
  bubblePath,
  CARD_SHADOW,
  calloutGeometry,
  circleMarkPath,
  HIGHLIGHT,
  MARK_STROKE,
  pathLength,
  ratingGeometry,
  underlineMarkPath,
} from "./marks.ts";
import { mapRuns, parseEmphasis, type RichLine, wrapRuns } from "./richtext.ts";

/** The script face behind kickers, script emphasis and script bubbles when the theme names none. */
export const DEFAULT_SCRIPT_FONT = '"Caveat", cursive';

/** How far along a layer is: everything at rest is the identity. */
export type LayerState = {
  opacity?: number;
  dx?: number;
  dy?: number;
  scale?: number;
  /** Degrees, added to the layer's own rotation. */
  rotate?: number;
};

/**
 * Per-layer animation for one frame. Every hook is optional; a missing hook
 * leaves its layer at rest, so drawScene with no Motion draws the still.
 */
export type Motion = {
  /** The background art: a slow push-in reads as life. */
  background?: LayerState;
  /** One line of copy; `index` counts lines within the block. */
  copyLine?: (block: "kicker" | "headline" | "subhead", index: number) => LayerState;
  /** A decoration, by its index in the scene's list. */
  decoration?: (index: number, d: Decoration) => LayerState;
  /** A device, by its index in the composition (back to front). */
  device?: (index: number) => LayerState;
  /** 0 to 1: how much of each hand-drawn emphasis mark has been drawn. */
  marks?: number;
};

export type SceneInput = {
  c: Composition;
  /** The store tile size; decoration fractions and type sizes refer to it. */
  tile: { width: number; height: number };
  theme: Theme;
  headlineColor: string;
  subheadColor: string;
  /** A CSS background: a color, a linear-gradient(), or "transparent". */
  background: string;
  backgroundImage?: Image | null;
  /** The strip-wide backdrop and where this composition sits in the strip. */
  backdrop?: { image: Image; slot: number; totalSlots: number } | null;
  text: { kicker?: string; headline: string; subhead?: string };
  locale: string;
  decorations: Decoration[];
  /** Loaded decoration images, by their `src` as written in the decoration. */
  images: Map<string, Image>;
  captures: { primary: Image; secondary?: Image };
  bezel: Image | null;
  /** The device's bezel geometry; sizes callouts on tiles with no device. */
  geom: FrameGeometry;
};

export function drawScene(ctx: SKRSContext2D, s: SceneInput, motion: Motion = {}): void {
  const { c } = s;
  if (!isTransparent(s.background)) {
    ctx.fillStyle = paint(ctx, s.background, c.width, c.height);
    ctx.fillRect(0, 0, c.width, c.height);
  }
  const bgBox = { left: 0, top: 0, width: c.width, height: c.height };
  if (s.backgroundImage) {
    withState(ctx, motion.background, bgBox, () =>
      drawCover(ctx, s.backgroundImage!, 0, 0, c.width, c.height),
    );
  }
  if (s.backdrop) {
    const { image, slot, totalSlots } = s.backdrop;
    withState(ctx, motion.background, bgBox, () =>
      drawCover(ctx, image, -slot * s.tile.width, 0, totalSlots * s.tile.width, c.height),
    );
  }

  const scrim = s.theme.scrim;
  if (scrim && (s.backgroundImage || s.backdrop)) {
    const g = ctx.createLinearGradient(0, 0, 0, c.height * scrim.height);
    g.addColorStop(0, scrim.color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height * scrim.height);
  }

  if (c.copy) drawCopy(ctx, s, motion);

  const layered = s.decorations.map((d, index) => ({ d, index }));
  for (const { d, index } of layered) {
    if (layerOf(d) === "back") drawDecoration(ctx, s, d, motion.decoration?.(index, d));
  }
  c.devices.forEach((device, i) => {
    const capture = device.capture === "secondary" ? s.captures.secondary : s.captures.primary;
    if (!capture) return;
    withState(ctx, motion.device?.(i), device.frame, () =>
      drawDevice(ctx, device, capture, s.bezel, { width: c.designWidth }),
    );
  });
  for (const { d, index } of layered) {
    if (layerOf(d) === "front") drawDecoration(ctx, s, d, motion.decoration?.(index, d));
  }
}

/** Which side of the device a decoration draws on; callouts lift out by default. */
export function layerOf(d: Decoration): "back" | "front" {
  return d.layer ?? (d.kind === "callout" ? "front" : "back");
}

/**
 * Applies a layer state around the centre of `box`: scale and rotation pivot
 * there, the offset moves it, the opacity multiplies.
 */
function withState(
  ctx: SKRSContext2D,
  state: LayerState | undefined,
  box: { left: number; top: number; width: number; height: number },
  draw: () => void,
) {
  if (!state) return draw();
  const opacity = state.opacity ?? 1;
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha *= Math.min(1, opacity);
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  ctx.translate(cx + (state.dx ?? 0), cy + (state.dy ?? 0));
  if (state.rotate) ctx.rotate((state.rotate * Math.PI) / 180);
  if (state.scale !== undefined && state.scale !== 1) ctx.scale(state.scale, state.scale);
  ctx.translate(-cx, -cy);
  draw();
  ctx.restore();
}

/** Cover-fits an image into a box, cropping the overflow evenly. */
function drawCover(
  ctx: SKRSContext2D,
  image: Image,
  left: number,
  top: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, left + (width - w) / 2, top + (height - h) / 2, w, h);
}

// ---------------------------------------------------------------- copy

type Block = {
  kind: "kicker" | "headline" | "subhead";
  lines: RichLine[];
  size: number;
  font: (em: boolean) => string;
  color: (em: boolean) => string;
  lineHeight: number;
  letterSpacing: number;
};

/** The kicker, headline and subhead, top-anchored or bottom-anchored per the composition. */
function drawCopy(ctx: SKRSContext2D, s: SceneInput, motion: Motion) {
  const copy = s.c.copy!;
  const blocks = copyBlocks(ctx, s);
  const gap = s.c.height * TYPE.gap;
  const total =
    blocks.reduce((sum, b) => sum + b.lines.length * b.size * b.lineHeight, 0) +
    gap * (blocks.length - 1);
  let y = copy.position === "top" ? copy.y : copy.y - total;
  for (const b of blocks) {
    y = drawBlock(ctx, s, b, copy.x, y, copy.align, motion);
    y += gap;
  }
}

/** Font, color and wrapped lines of each copy block; shared with the promo for timing. */
export function copyBlocks(ctx: SKRSContext2D, s: SceneInput): Block[] {
  const copy = s.c.copy!;
  const { theme } = s;
  const typeWidth = copy.typeWidth;
  const family = withGlyphFallback(theme.fontFamily);
  const script = withGlyphFallback(theme.scriptFontFamily ?? DEFAULT_SCRIPT_FONT);
  const accent = theme.accentColor ?? s.headlineColor;
  const emphasis: EmphasisStyle = theme.emphasis ?? "color";
  const hs = theme.headline ?? {};
  const upper = (t: string) => (hs.uppercase ? t.toLocaleUpperCase(s.locale) : t);
  const headlineSize = typeWidth * TYPE.headlineSize * (hs.scale ?? 1);
  const weight = hs.weight ?? TYPE.headlineWeight;

  const blocks: Block[] = [];
  const wrap = (block: Omit<Block, "lines">, text: string) => {
    const runs = mapRuns(parseEmphasis(text), block.kind === "headline" ? upper : (t) => t);
    const lines = wrapRuns(runs, copy.maxWidth, (t, em) => {
      ctx.font = block.font(em);
      ctx.letterSpacing = `${block.letterSpacing}px`;
      return ctx.measureText(t).width;
    });
    blocks.push({ ...block, lines });
  };

  if (s.text.kicker) {
    const size = typeWidth * TYPE.kickerSize;
    wrap(
      {
        kind: "kicker",
        size,
        font: () => `${TYPE.kickerWeight} ${size}px ${script}`,
        color: () => accent,
        lineHeight: TYPE.kickerLineHeight,
        letterSpacing: 0,
      },
      s.text.kicker,
    );
  }
  wrap(
    {
      kind: "headline",
      size: headlineSize,
      font: (em) =>
        em && emphasis === "script"
          ? `${TYPE.kickerWeight} ${headlineSize * 1.14}px ${script}`
          : `${weight} ${headlineSize}px ${family}`,
      color: (em) =>
        em && (emphasis === "color" || emphasis === "script") ? accent : s.headlineColor,
      lineHeight: TYPE.headlineLineHeight,
      letterSpacing: typeWidth * TYPE.headlineTracking,
    },
    s.text.headline,
  );
  if (s.text.subhead) {
    const size = typeWidth * TYPE.subheadSize;
    wrap(
      {
        kind: "subhead",
        size,
        font: (em) => `${em ? 700 : TYPE.subheadWeight} ${size}px ${family}`,
        color: (em) => (em ? accent : s.subheadColor),
        lineHeight: TYPE.subheadLineHeight,
        letterSpacing: 0,
      },
      s.text.subhead,
    );
  }
  return blocks;
}

/** Draws a block's lines from `y` down, with its marks. Returns the y below the last line. */
function drawBlock(
  ctx: SKRSContext2D,
  s: SceneInput,
  b: Block,
  x: number,
  y: number,
  align: "left" | "center",
  motion: Motion,
): number {
  const { theme } = s;
  const emphasis: EmphasisStyle = theme.emphasis ?? "color";
  const accent = theme.accentColor ?? s.headlineColor;
  const hs = b.kind === "headline" ? (theme.headline ?? {}) : {};
  const step = b.size * b.lineHeight;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  b.lines.forEach((line, index) => {
    // Measure each segment in its own face so the line centres as drawn.
    const widths = line.map((seg) => {
      ctx.font = b.font(seg.em);
      ctx.letterSpacing = `${b.letterSpacing}px`;
      return ctx.measureText(seg.text).width;
    });
    const lineWidth = widths.reduce((a, w) => a + w, 0);
    const left = align === "center" ? x - lineWidth / 2 : x;
    const glyphTop = y + (step - b.size) / 2;
    const box = { left, top: y, width: lineWidth, height: step };

    withState(ctx, motion.copyLine?.(b.kind, index), box, () => {
      let cursor = left;
      const marks: Array<{ left: number; width: number }> = [];
      line.forEach((seg, i) => {
        const w = widths[i]!;
        if (seg.em && b.kind === "headline") marks.push({ left: cursor, width: w });
        cursor += w;
      });

      // Highlighter bands go under the text.
      if (b.kind === "headline" && emphasis === "highlight") {
        ctx.save();
        ctx.fillStyle = accent;
        ctx.globalAlpha *= HIGHLIGHT.alpha;
        for (const m of marks) {
          const pad = m.width * HIGHLIGHT.padX;
          ctx.fillRect(
            m.left - pad,
            glyphTop + b.size * HIGHLIGHT.top,
            (m.width + 2 * pad) * clamp01(motion.marks ?? 1),
            b.size * HIGHLIGHT.height,
          );
        }
        ctx.restore();
      }

      cursor = left;
      line.forEach((seg, i) => {
        // A script word sits on the same baseline as the sans run around it.
        const segSize = fontSize(b.font(seg.em));
        const segTop = glyphTop + (b.size - segSize) * 0.78;
        ctx.font = b.font(seg.em);
        ctx.letterSpacing = `${b.letterSpacing}px`;
        if (hs.stroke) {
          ctx.save();
          ctx.lineJoin = "round";
          ctx.lineWidth = s.tile.width * hs.stroke.width * 2;
          ctx.strokeStyle = hs.stroke.color;
          applyShadow(ctx, hs.shadow, s.tile.width);
          ctx.strokeText(seg.text, cursor, segTop);
          ctx.restore();
        }
        ctx.save();
        if (!hs.stroke) applyShadow(ctx, hs.shadow, s.tile.width);
        ctx.fillStyle = b.color(seg.em);
        ctx.fillText(seg.text, cursor, segTop);
        ctx.restore();
        cursor += widths[i]!;
      });

      // Pen marks go over the text.
      if (b.kind === "headline" && (emphasis === "circle" || emphasis === "underline")) {
        for (const [i, m] of marks.entries()) {
          const wordBox = {
            left: m.left,
            top: glyphTop + b.size * 0.06,
            width: m.width,
            height: b.size * 0.86,
          };
          const d =
            emphasis === "circle"
              ? circleMarkPath(wordBox, 7 + i)
              : underlineMarkPath(wordBox, 3 + i);
          strokeMark(ctx, d, accent, wordBox.height * MARK_STROKE[emphasis], motion.marks ?? 1);
        }
      }
    });
    y += step;
  });
  return y;
}

function strokeMark(ctx: SKRSContext2D, d: string, color: string, width: number, progress: number) {
  const p = clamp01(progress);
  if (p <= 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (p < 1) {
    const length = pathLength(d);
    ctx.setLineDash([length, length]);
    ctx.lineDashOffset = length * (1 - p);
  }
  ctx.stroke(new Path2D(d));
  ctx.restore();
}

function applyShadow(
  ctx: SKRSContext2D,
  shadow: { color: string; blur: number; offsetY: number } | undefined,
  tileWidth: number,
) {
  if (!shadow) return;
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = tileWidth * shadow.blur;
  ctx.shadowOffsetY = tileWidth * shadow.offsetY;
}

// ---------------------------------------------------------------- devices

/**
 * One device: the capture cover-fitted and clipped to the rounded screen,
 * then the bezel over it (its cutout is transparent), or a drop shadow
 * under the bare screen when there is no bezel. Rotated about its centre.
 */
export function drawDevice(
  ctx: SKRSContext2D,
  device: Composition["devices"][number],
  capture: Image,
  bezel: Image | null,
  tile: { width: number },
) {
  const { frame, screen } = device;
  ctx.save();
  if (device.rotate) {
    const cx = frame.left + frame.width / 2;
    const cy = frame.top + frame.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((device.rotate * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  if (!bezel) {
    ctx.save();
    ctx.shadowColor = SCREEN_SHADOW.color;
    ctx.shadowBlur = tile.width * SCREEN_SHADOW.blur;
    ctx.shadowOffsetY = tile.width * SCREEN_SHADOW.offsetY;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.roundRect(screen.left, screen.top, screen.width, screen.height, screen.radius);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(screen.left, screen.top, screen.width, screen.height, screen.radius);
  ctx.clip();
  drawCover(ctx, capture, screen.left, screen.top, screen.width, screen.height);
  ctx.restore();
  if (bezel) ctx.drawImage(bezel, frame.left, frame.top, frame.width, frame.height);
  ctx.restore();
}

// ---------------------------------------------------------------- decorations

function drawDecoration(
  ctx: SKRSContext2D,
  s: SceneInput,
  d: Decoration,
  state: LayerState | undefined,
) {
  const { tile } = s;
  switch (d.kind) {
    case "badge": {
      const text = pick(d.text, s.locale, "badge");
      const font = `${BADGE.weight} ${tile.width * BADGE.fontSize}px ${withGlyphFallback(s.theme.fontFamily)}`;
      ctx.font = font;
      ctx.letterSpacing = "0px";
      const size = fontSize(font);
      const w = ctx.measureText(text).width + 2 * tile.width * BADGE.padX;
      const h = size * 1.2 + 2 * tile.width * BADGE.padY;
      const inset = Math.min(tile.width, tile.height) * BADGE.inset;
      const left = d.position.endsWith("left") ? inset : s.c.width - inset - w;
      const top = d.position.startsWith("top") ? inset : s.c.height - inset - h;
      withState(ctx, state, { left, top, width: w, height: h }, () => {
        ctx.fillStyle = d.background ?? "rgba(255, 255, 255, 0.85)";
        ctx.beginPath();
        ctx.roundRect(left, top, w, h, h / 2);
        ctx.fill();
        ctx.font = font;
        ctx.fillStyle = d.color ?? s.headlineColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, left + w / 2, top + h / 2);
      });
      return;
    }
    case "image": {
      const image = s.images.get(d.src);
      if (!image) throw new Error(`Decoration image "${d.src}" was not loaded.`);
      const w = tile.width * d.width;
      const h = (w * image.height) / image.width;
      const left = tile.width * d.x;
      const top = tile.height * d.y;
      const box = { left, top, width: w, height: h };
      withState(ctx, state, box, () => {
        ctx.save();
        if (d.opacity !== undefined) ctx.globalAlpha *= clamp01(d.opacity);
        rotateAbout(ctx, box, d.rotate);
        if (d.shadow) {
          ctx.shadowColor = CARD_SHADOW.color;
          ctx.shadowBlur = tile.width * CARD_SHADOW.blur;
          ctx.shadowOffsetY = tile.width * CARD_SHADOW.offsetY;
        }
        if (d.flip) {
          ctx.translate(left + w, top);
          ctx.scale(-1, 1);
          ctx.drawImage(image, 0, 0, w, h);
        } else {
          ctx.drawImage(image, left, top, w, h);
        }
        ctx.restore();
      });
      return;
    }
    case "callout": {
      const which = d.capture ?? "primary";
      const capture = which === "secondary" ? s.captures.secondary : s.captures.primary;
      if (!capture) throw new Error("A callout cuts from a secondary capture this layout lacks.");
      const screen = calloutScreen(s, which);
      const g = calloutGeometry(d, tile, screen);
      withState(ctx, state, g.box, () => {
        ctx.save();
        rotateAbout(ctx, g.box, d.rotate);
        if (d.shadow !== false) {
          ctx.save();
          ctx.shadowColor = CARD_SHADOW.color;
          ctx.shadowBlur = tile.width * CARD_SHADOW.blur;
          ctx.shadowOffsetY = tile.width * CARD_SHADOW.offsetY;
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.roundRect(g.box.left, g.box.top, g.box.width, g.box.height, g.radius);
          ctx.fill();
          ctx.restore();
        }
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(g.box.left, g.box.top, g.box.width, g.box.height, g.radius);
        ctx.clip();
        drawCover(ctx, capture, g.image.left, g.image.top, g.image.width, g.image.height);
        ctx.restore();
        if (d.border) {
          ctx.strokeStyle = d.border;
          ctx.lineWidth = tile.width * 0.004;
          ctx.beginPath();
          ctx.roundRect(g.box.left, g.box.top, g.box.width, g.box.height, g.radius);
          ctx.stroke();
        }
        ctx.restore();
      });
      return;
    }
    case "bubble": {
      const text = pick(d.text, s.locale, "bubble");
      const size = tile.width * (d.size ?? 0.045);
      const family = withGlyphFallback(
        d.font === "script"
          ? (s.theme.scriptFontFamily ?? DEFAULT_SCRIPT_FONT)
          : s.theme.fontFamily,
      );
      const font = `700 ${size}px ${family}`;
      const g = bubbleGeometry(ctx, d, tile, text, font, size);
      withState(ctx, state, g.box, () => {
        ctx.save();
        rotateAbout(ctx, g.box, d.rotate);
        ctx.save();
        ctx.shadowColor = CARD_SHADOW.color;
        ctx.shadowBlur = tile.width * CARD_SHADOW.blur * 0.6;
        ctx.shadowOffsetY = tile.width * CARD_SHADOW.offsetY * 0.6;
        ctx.fillStyle = d.background ?? "#FFFFFF";
        ctx.fill(new Path2D(g.path));
        ctx.restore();
        ctx.font = font;
        ctx.letterSpacing = "0px";
        ctx.fillStyle = d.color ?? s.headlineColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const step = size * BUBBLE.lineHeight;
        g.lines.forEach((line, i) => {
          ctx.fillText(
            line,
            g.box.left + g.box.width / 2,
            g.box.top + size * BUBBLE.padY + i * step + (step - size) / 2,
          );
        });
        ctx.restore();
      });
      return;
    }
    case "rating": {
      const label = d.label ? pick(d.label, s.locale, "rating label") : undefined;
      const left = tile.width * d.x;
      const top = tile.height * d.y;
      const width = tile.width * d.width;
      const g = ratingGeometry({ left, top, width, height: 0 }, Boolean(label));
      const color = d.color ?? s.headlineColor;
      const family = withGlyphFallback(s.theme.fontFamily);
      withState(ctx, state, { left, top, width, height: g.height }, () => {
        ctx.save();
        if (d.background) {
          ctx.save();
          ctx.shadowColor = CARD_SHADOW.color;
          ctx.shadowBlur = tile.width * CARD_SHADOW.blur * 0.6;
          ctx.shadowOffsetY = tile.width * CARD_SHADOW.offsetY * 0.6;
          ctx.fillStyle = d.background;
          ctx.beginPath();
          ctx.roundRect(g.plate.left, g.plate.top, g.plate.width, g.plate.height, g.plate.radius);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        if (d.laurels !== false) {
          ctx.lineWidth = g.laurelStroke;
          ctx.lineCap = "round";
          for (const p of g.laurels) {
            ctx.fill(new Path2D(p.leaves));
            ctx.stroke(new Path2D(p.stem));
          }
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.letterSpacing = "0px";
        ctx.font = `800 ${g.value.size}px ${family}`;
        ctx.fillText(d.value, g.value.x, g.value.y);
        for (const star of g.stars) ctx.fill(new Path2D(star));
        if (label && g.label) {
          ctx.font = `600 ${g.label.size}px ${family}`;
          ctx.fillText(label, g.label.x, g.label.y, g.label.maxWidth);
        }
        ctx.restore();
      });
      return;
    }
  }
}

/** The screen a callout cuts from: its device's, or the bezel's proportions on a tile without one. */
function calloutScreen(s: SceneInput, which: "primary" | "secondary") {
  const device = s.c.devices.find((d) => d.capture === which) ?? s.c.devices[0];
  if (device) return { width: device.screen.width, height: device.screen.height };
  const width = s.tile.width * 0.8;
  return { width, height: (width * s.geom.screen.height) / s.geom.screen.width };
}

/** The bubble's body box, outline and wrapped lines. */
export function bubbleGeometry(
  ctx: SKRSContext2D,
  d: Extract<Decoration, { kind: "bubble" }>,
  tile: { width: number; height: number },
  text: string,
  font: string,
  size: number,
) {
  ctx.font = font;
  ctx.letterSpacing = "0px";
  const padX = size * BUBBLE.padX;
  const maxText = tile.width * d.width - 2 * padX;
  const lines = wrapRuns([{ text, em: false }], maxText, (t) => ctx.measureText(t).width).map((l) =>
    l.map((seg) => seg.text).join(""),
  );
  const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const box = {
    left: tile.width * d.x,
    top: tile.height * d.y,
    width: textWidth + 2 * padX,
    height: lines.length * size * BUBBLE.lineHeight + 2 * size * BUBBLE.padY,
  };
  const path = bubblePath(box, size * BUBBLE.radius, d.tail ?? "bottom-left", size * BUBBLE.tail);
  return { box, path, lines };
}

function rotateAbout(
  ctx: SKRSContext2D,
  box: { left: number; top: number; width: number; height: number },
  degrees: number | undefined,
) {
  if (!degrees) return;
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  ctx.translate(cx, cy);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.translate(-cx, -cy);
}

// ---------------------------------------------------------------- helpers

export const fontSize = (font: string) => Number(font.match(/(\d+(?:\.\d+)?)px/)?.[1]);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function pick(map: Record<string, string>, locale: string, field: string): string {
  const value = map[locale];
  if (value === undefined) throw new Error(`No ${field} for locale "${locale}".`);
  return value;
}

/** Whether a CSS background asks for no fill at all. */
export function isTransparent(css: string): boolean {
  return css.trim().toLowerCase() === "transparent";
}

/**
 * A canvas fill for a CSS background: a plain color, or a `linear-gradient()`
 * with an optional angle / `to <side>` and color stops with optional
 * percentages. Anything else is handed to the canvas as-is.
 */
export function paint(
  ctx: SKRSContext2D,
  css: string,
  width: number,
  height: number,
): string | CanvasGradient {
  const m = css.trim().match(/^linear-gradient\((.*)\)$/s);
  if (!m) return css;
  const parts = splitTopLevel(m[1]!);

  let angle = 180;
  const first = parts[0]!.trim();
  const deg = first.match(/^(-?\d+(?:\.\d+)?)deg$/);
  if (deg) {
    angle = Number(deg[1]);
    parts.shift();
  } else if (first.startsWith("to ")) {
    const sides: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270 };
    const words = first.slice(3).split(/\s+/);
    const angles = words.map((w) => sides[w]).filter((a): a is number => a !== undefined);
    if (angles.length === 2 && angles.includes(0) && angles.includes(270)) angle = 315;
    else if (angles.length === 2) angle = (angles[0]! + angles[1]!) / 2;
    else if (angles.length === 1) angle = angles[0]!;
    parts.shift();
  }

  // CSS gradient line: through the centre, long enough that the corners meet
  // the first and last stop exactly.
  const rad = (angle * Math.PI) / 180;
  const length = Math.abs(width * Math.sin(rad)) + Math.abs(height * Math.cos(rad));
  const dx = (Math.sin(rad) * length) / 2;
  const dy = (-Math.cos(rad) * length) / 2;
  const gradient = ctx.createLinearGradient(
    width / 2 - dx,
    height / 2 - dy,
    width / 2 + dx,
    height / 2 + dy,
  );

  const stops = parts.map((p) => {
    const s = p.trim().match(/^(.*?)(?:\s+(-?\d+(?:\.\d+)?)%)?$/);
    return { color: s![1]!.trim(), at: s![2] !== undefined ? Number(s![2]) / 100 : undefined };
  });
  if (stops.length && stops[0]!.at === undefined) stops[0]!.at = 0;
  if (stops.length && stops[stops.length - 1]!.at === undefined) stops[stops.length - 1]!.at = 1;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i]!.at !== undefined) continue;
    let j = i;
    while (stops[j]!.at === undefined) j++;
    const from = stops[i - 1]!.at!;
    const to = stops[j]!.at!;
    for (let k = i; k < j; k++) stops[k]!.at = from + ((to - from) * (k - i + 1)) / (j - i + 1);
  }
  let last = 0;
  for (const s of stops) {
    last = Math.min(1, Math.max(last, s.at!));
    gradient.addColorStop(last, s.color);
  }
  return gradient;
}

/** Splits on commas that are not inside parentheses (rgb(), hsl()). */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
