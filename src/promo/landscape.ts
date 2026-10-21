/**
 * Landscape (16:9) promo scenes. The store tiles are portrait, so a
 * landscape frame cannot show a tile as-is; instead it splits the tile in
 * two, the way a presentation slide does: the copy is recomposed for a wide
 * left column at slide size, and the tile's stage (devices and decorations,
 * composed at a portrait size by prepareScenes) is fitted into the right
 * column, keeping every mascot and callout where it sits relative to the
 * phone. The background spans the whole frame. Pure geometry plus SceneInput
 * variants; composition.ts writes the layers.
 */
import type { SKRSContext2D } from "@napi-rs/canvas";
import { type Box, copyLineLayouts, type SceneInput } from "../draw.ts";

export type Size = { width: number; height: number };

export const isLandscape = (size: Size) => size.width > size.height;

/** Copy column and stage column as fractions of the frame. */
export const LANDSCAPE = {
  copyLeft: 0.07,
  copyWidth: 0.4,
  /** The headline's type width as a fraction of the frame height (a store tile uses its width). */
  typeWidth: 0.92,
  stageLeft: 0.5,
  stageRight: 0.96,
  stageTop: 0.05,
  stageBottom: 0.95,
} as const;

/**
 * The portrait tile the stage is composed at: taller than the frame, so it
 * only ever scales down into its column and its layers stay sharp.
 */
export function landscapeStageTile(frame: Size): Size {
  const height = Math.round(frame.height * 1.5);
  return { width: Math.round((height * 9) / 16), height };
}

/** The scene recomposed as a frame-wide background only: no copy, no devices, no decorations. */
export function landscapeBackgroundInput(s: SceneInput, frame: Size): SceneInput {
  return {
    ...s,
    c: { ...s.c, width: frame.width, height: frame.height, copy: null, devices: [] },
    decorations: [],
  };
}

/**
 * The scene's copy recomposed for the left column at slide size, left
 * aligned and vertically centred; no devices or decorations.
 */
export function landscapeCopyInput(ctx: SKRSContext2D, s: SceneInput, frame: Size): SceneInput {
  const left = frame.width * LANDSCAPE.copyLeft;
  const maxWidth = frame.width * LANDSCAPE.copyWidth;
  const base: SceneInput = {
    ...s,
    c: {
      width: frame.width,
      height: frame.height,
      designWidth: frame.height,
      devices: [],
      copy: {
        position: "top",
        align: "left",
        x: left,
        y: 0,
        maxWidth,
        typeWidth: frame.height * LANDSCAPE.typeWidth,
        box: { left, top: 0, width: maxWidth, height: frame.height },
      },
    },
    decorations: [],
  };
  const lines = copyLineLayouts(ctx, base);
  if (lines.length === 0) return base;
  const top = lines[0]!.box.top;
  const last = lines[lines.length - 1]!.box;
  const height = last.top + last.height - top;
  const y = (frame.height - height) / 2 - top;
  return { ...base, c: { ...base.c, copy: { ...base.c.copy!, y } } };
}

/**
 * How to place the stage's layers (drawn on a `stage`-sized canvas) in the
 * right column: the union of the content boxes, clipped to the canvas,
 * scaled to fit the column (never up) and centred in it. Content that runs
 * off the tile's bottom edge (a hero phone) runs off the frame's bottom too,
 * rather than ending in a cut edge mid-frame.
 */
export function fitStage(
  boxes: Box[],
  stage: Size,
  frame: Size,
): { scale: number; x: number; y: number } {
  const clipped = boxes
    .map((b) => ({
      left: Math.max(0, b.left),
      top: Math.max(0, b.top),
      right: Math.min(stage.width, b.left + b.width),
      bottom: Math.min(stage.height, b.top + b.height),
    }))
    .filter((b) => b.right > b.left && b.bottom > b.top);
  const area = {
    left: frame.width * LANDSCAPE.stageLeft,
    top: frame.height * LANDSCAPE.stageTop,
    width: frame.width * (LANDSCAPE.stageRight - LANDSCAPE.stageLeft),
    height: frame.height * (LANDSCAPE.stageBottom - LANDSCAPE.stageTop),
  };
  if (clipped.length === 0) {
    const scale = Math.min(1, area.height / stage.height);
    return {
      scale,
      x: area.left + (area.width - stage.width * scale) / 2,
      y: (frame.height - stage.height * scale) / 2,
    };
  }
  const bbox = {
    left: Math.min(...clipped.map((b) => b.left)),
    top: Math.min(...clipped.map((b) => b.top)),
    right: Math.max(...clipped.map((b) => b.right)),
    bottom: Math.max(...clipped.map((b) => b.bottom)),
  };
  const w = bbox.right - bbox.left;
  const h = bbox.bottom - bbox.top;
  // Content cut by the tile's bottom or right edge keeps running off the
  // frame's, so the cut never shows mid-frame. A bleeding side may use the
  // frame's full extent; a contained one keeps the margin.
  const bleedsBottom = bbox.bottom >= stage.height - 1;
  const bleedsRight = bbox.right >= stage.width - 1;
  const availableHeight = bleedsBottom ? frame.height - area.top : area.height;
  const availableWidth = bleedsRight ? frame.width - area.left : area.width;
  const scale = Math.min(1, availableWidth / w, availableHeight / h);
  const x = bleedsRight
    ? frame.width - bbox.right * scale
    : area.left + (area.width - w * scale) / 2 - bbox.left * scale;
  const y = bleedsBottom
    ? frame.height - bbox.bottom * scale
    : area.top + (area.height - h * scale) / 2 - bbox.top * scale;
  return { scale, x, y };
}
