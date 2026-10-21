/**
 * Concept boards: the same first tiles rendered in several art directions, so
 * a human picks one before any final (pricier) art is generated. Each style's
 * draft art (from `goldie art concepts`) is swapped in for the config's art
 * paths, the style's suggested face and emphasis are applied, and the first
 * tiles are laid side by side with the style's name under them.
 */
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ART_STYLES, isArtStyleKey } from "./art/index.ts";
import type { LoadedConfig } from "./config.ts";
import { fontStack, registerFonts } from "./fonts.ts";
import { renderScreenshots } from "./render.ts";
import type { DeviceKey } from "./specs.ts";

/** Tiles per board: the first screen and a half of the store page. */
export const CONCEPT_TILES = 3;

export async function renderConceptBoards(
  cfg: LoadedConfig,
  deviceKey: DeviceKey,
  locale: string,
  concepts: Array<{ style: string; dir: string }>,
): Promise<string[]> {
  const artDir = resolve(cfg.root, cfg.art?.dir ?? "art");
  const root = join(cfg.outDir, "concepts");
  await rm(root, { recursive: true, force: true });
  const boards: string[] = [];
  for (const { style, dir } of concepts) {
    // Art paths inside the art dir resolve to this style's draft of the same file.
    const resolveArt = (src: string) => {
      const abs = resolve(cfg.root, src);
      const rel = relative(artDir, abs);
      if (rel.startsWith("..")) return src;
      const draft = join(dir, rel);
      return existsSync(draft) ? draft : src;
    };
    const preset = isArtStyleKey(style) ? ART_STYLES[style] : null;
    const styled: LoadedConfig = preset
      ? {
          ...cfg,
          theme: {
            ...cfg.theme,
            fontFamily: fontStack(preset.fonts[0]!),
            emphasis: preset.emphasis,
          },
        }
      : cfg;
    const outDir = join(root, slug(style));
    console.log(`  concept ${style}`);
    const files = await renderScreenshots(styled, deviceKey, locale, {
      outDir,
      only: CONCEPT_TILES,
      resolveArt,
    });
    boards.push(
      await writeBoard(
        join(outDir, "board.png"),
        files.slice(0, CONCEPT_TILES),
        preset?.label ?? style,
        cfg,
      ),
    );
  }
  return boards;
}

async function writeBoard(
  file: string,
  tiles: string[],
  label: string,
  cfg: LoadedConfig,
): Promise<string> {
  const images = await Promise.all(tiles.map((t) => loadImage(t)));
  const tileH = 1200;
  const scale = tileH / images[0]!.height;
  const tileW = images[0]!.width * scale;
  const gap = 36;
  const pad = 60;
  const caption = 120;
  const width = pad * 2 + images.length * tileW + (images.length - 1) * gap;
  const height = pad * 2 + tileH + caption;
  const canvas = createCanvas(Math.round(width), height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#F2F2F4";
  ctx.fillRect(0, 0, width, height);
  images.forEach((img, i) => {
    const x = pad + i * (tileW + gap);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
    ctx.beginPath();
    ctx.roundRect(x, pad, tileW, tileH, 36);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, pad, tileW, tileH, 36);
    ctx.clip();
    ctx.drawImage(img, x, pad, tileW, tileH);
    ctx.restore();
  });
  registerFonts(cfg.theme.fontFiles);
  ctx.fillStyle = "#111";
  ctx.font = '700 56px "DM Sans", sans-serif';
  ctx.textBaseline = "middle";
  ctx.fillText(label, pad, pad + tileH + caption / 2 + 10);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, await canvas.encode("png"));
  return file;
}

function slug(style: string): string {
  return (
    style
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "style"
  );
}
