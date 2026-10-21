/**
 * Captions over the App Store preview. App Review Guideline 2.3.4 lets a
 * preview carry "narration and video or textual overlays to help explain
 * anything that isn't clear from the video alone", so a segment may name what
 * it shows. Each caption is drawn once as a transparent PNG the size of the
 * video, in the theme's face with its stressed words in the accent color,
 * then faded in and out over its segment by ffmpeg.
 */
import { writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import type { Theme } from "./config.ts";
import { withGlyphFallback } from "./fonts.ts";
import { parseEmphasis, wrapRuns } from "./richtext.ts";

/** Caption type and plate, as fractions of the video width. */
export const CAPTION = {
  size: 0.062,
  weight: 700,
  lineHeight: 1.18,
  padX: 0.05,
  padY: 0.028,
  radius: 0.05,
  maxWidth: 0.84,
  /** Plate centre line as a fraction of the video height. */
  top: 0.115,
  bottom: 0.83,
  fade: 0.3,
} as const;

export async function writeCaptionPng(
  file: string,
  text: string,
  video: { width: number; height: number },
  theme: Theme,
  position: "top" | "bottom",
): Promise<void> {
  const { width, height } = video;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const size = width * CAPTION.size;
  const family = withGlyphFallback(theme.fontFamily);
  const font = `${CAPTION.weight} ${size}px ${family}`;
  ctx.font = font;
  ctx.letterSpacing = "0px";
  const lines = wrapRuns(
    parseEmphasis(text),
    width * CAPTION.maxWidth - 2 * width * CAPTION.padX,
    (t) => ctx.measureText(t).width,
  );
  const widths = lines.map((l) => l.reduce((w, s) => w + ctx.measureText(s.text).width, 0));
  const step = size * CAPTION.lineHeight;
  const plateW = Math.max(...widths) + 2 * width * CAPTION.padX;
  const plateH = lines.length * step + 2 * width * CAPTION.padY;
  const cy = height * (position === "top" ? CAPTION.top : CAPTION.bottom);
  const left = (width - plateW) / 2;
  const top = cy - plateH / 2;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
  ctx.shadowBlur = width * 0.03;
  ctx.shadowOffsetY = width * 0.008;
  ctx.fillStyle = "rgba(14, 18, 24, 0.82)";
  ctx.beginPath();
  ctx.roundRect(left, top, plateW, plateH, width * CAPTION.radius);
  ctx.fill();
  ctx.restore();

  const accent = theme.accentColor ?? "#FFD54A";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  lines.forEach((line, i) => {
    let x = (width - widths[i]!) / 2;
    const y = top + width * CAPTION.padY + i * step + (step - size) / 2;
    for (const seg of line) {
      ctx.fillStyle = seg.em ? accent : "#FFFFFF";
      ctx.fillText(seg.text, x, y);
      x += ctx.measureText(seg.text).width;
    }
  });
  await writeFile(file, await canvas.encode("png"));
}

/**
 * The ffmpeg filter graph that lays timed captions over the base video.
 * `inputs` are the ffmpeg input indexes of the looped caption PNGs, in the
 * same order as `spans`. Returns the graph and the label of its output.
 */
export function captionFilter(
  base: string,
  spans: Array<{ input: number; start: number; end: number }>,
): { graph: string; out: string } {
  let label = base;
  const parts: string[] = [];
  spans.forEach((s, i) => {
    const fadeOut = Math.max(s.start, s.end - CAPTION.fade);
    const c = `cap${i}`;
    parts.push(
      `[${s.input}:v]format=rgba,fade=t=in:st=${s.start.toFixed(3)}:d=${CAPTION.fade}:alpha=1,` +
        `fade=t=out:st=${fadeOut.toFixed(3)}:d=${CAPTION.fade}:alpha=1[${c}]`,
    );
    const next = `v${i}`;
    parts.push(
      `[${label}][${c}]overlay=0:0:enable='between(t,${s.start.toFixed(3)},${s.end.toFixed(3)})'[${next}]`,
    );
    label = next;
  });
  return { graph: parts.join(";"), out: label };
}
