/**
 * The promo's closing card - icon, headline, call to action - as isolated
 * raster layers for the HyperFrames composition, ported from the old
 * per-frame drawOutro. Each layer draws its content at rest (no motion); the
 * generator animates it with the box this module returns as the pivot,
 * exactly like a screenshot scene's layers (see draw.ts's sceneLayers).
 */
import { createCanvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { Theme } from "../config.ts";
import type { Box } from "../draw.ts";
import { withGlyphFallback } from "../fonts.ts";
import { TYPE } from "../layouts.ts";
import { parseEmphasis, wrapRuns } from "../richtext.ts";

export type OutroContent = {
  headline: string;
  cta?: string;
  icon: Image | null;
  seconds: number;
};

export type OutroLayer = { id: string; box: Box; draw: (ctx: SKRSContext2D) => void };

export function outroLayers(
  theme: Theme,
  outro: OutroContent,
  size: { width: number; height: number },
): OutroLayer[] {
  const { width, height } = size;
  const out: OutroLayer[] = [];
  const family = withGlyphFallback(theme.fontFamily);
  const accent = theme.accentColor ?? theme.headlineColor;
  const measure = createCanvas(width, height).getContext("2d");
  let y = height * 0.3;

  if (outro.icon) {
    const iconSize = width * 0.26;
    const box: Box = { left: width / 2 - iconSize / 2, top: y, width: iconSize, height: iconSize };
    const icon = outro.icon;
    out.push({
      id: "icon",
      box,
      draw: (ctx) => {
        ctx.save();
        ctx.shadowColor = "rgba(15, 23, 42, 0.25)";
        ctx.shadowBlur = width * 0.04;
        ctx.shadowOffsetY = width * 0.015;
        ctx.beginPath();
        ctx.roundRect(box.left, box.top, box.width, box.height, box.width * 0.225);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.beginPath();
        ctx.roundRect(box.left, box.top, box.width, box.height, box.width * 0.225);
        ctx.clip();
        ctx.drawImage(icon, box.left, box.top, box.width, box.height);
        ctx.restore();
      },
    });
    y += iconSize + height * 0.05;
  }

  const headlineSize = width * TYPE.headlineSize * 1.25 * (theme.headline?.scale ?? 1);
  const weight = theme.headline?.weight ?? TYPE.headlineWeight;
  const font = `${weight} ${headlineSize}px ${family}`;
  measure.font = font;
  measure.letterSpacing = "0px";
  const text = theme.headline?.uppercase ? outro.headline.toLocaleUpperCase() : outro.headline;
  const lines = wrapRuns(parseEmphasis(text), width * 0.82, (t) => measure.measureText(t).width);
  const lineHeight = headlineSize * TYPE.headlineLineHeight;
  for (const [i, line] of lines.entries()) {
    measure.font = font;
    const w = line.reduce((sum, seg) => sum + measure.measureText(seg.text).width, 0);
    const box: Box = { left: width / 2 - w / 2, top: y, width: w, height: lineHeight };
    out.push({
      id: `headline-${i}`,
      box,
      draw: (ctx) => {
        ctx.font = font;
        ctx.letterSpacing = "0px";
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        let x = box.left;
        for (const seg of line) {
          ctx.fillStyle = seg.em ? accent : theme.headlineColor;
          ctx.fillText(seg.text, x, box.top);
          x += ctx.measureText(seg.text).width;
        }
      },
    });
    y += lineHeight;
  }

  if (outro.cta) {
    y += height * 0.04;
    const ctaSize = width * 0.045;
    const ctaFont = `700 ${ctaSize}px ${family}`;
    measure.font = ctaFont;
    const w = measure.measureText(outro.cta).width + ctaSize * 2.4;
    const h = ctaSize * 2.3;
    const box: Box = { left: width / 2 - w / 2, top: y, width: w, height: h };
    const cta = outro.cta;
    out.push({
      id: "cta",
      box,
      draw: (ctx) => {
        ctx.save();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.roundRect(box.left, box.top, box.width, box.height, box.height / 2);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.font = ctaFont;
        ctx.letterSpacing = "0px";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(cta, box.left + box.width / 2, box.top + box.height / 2);
        ctx.restore();
      },
    });
  }

  return out;
}
