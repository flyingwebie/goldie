/**
 * Writes one promo format+locale as a HyperFrames project: an index.html
 * composition plus the layer PNGs it displays, under
 * out/promo/<format>/<locale>/composition/. render.ts then hands this
 * directory to the HyperFrames CLI, which renders it to promo.mp4.
 *
 * Every screenshot scene is sliced into the raster layers drawScene paints
 * (see draw.ts's sceneLayers) plus two layers done as plain CSS, where CSS
 * is exact and a raster would just cost a file: the background fill (already
 * a CSS color or linear-gradient()) and the scrim (a CSS gradient too). The
 * outro card's layers come from outro.ts the same way. A GSAP timeline,
 * built from choreography.ts's tween specs and registered at
 * window.__timelines.promo, reproduces the old frame-by-frame engine's
 * entrance choreography; HyperFrames scrubs it frame by frame and renders
 * the result with its own FFmpeg pass, audio and all - this module never
 * calls ffmpeg itself.
 */

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import type { Decoration, LoadedConfig } from "../config.ts";
import { type SceneLayer, sceneLayers } from "../draw.ts";
import type { PreparedScene } from "../scene.ts";
import type { Tween } from "./choreography.ts";
import * as choreo from "./choreography.ts";
import { type OutroContent, outroLayers } from "./outro.ts";
import { buildTimeline, EASE_SOURCE, PROMO, slots, type Timeline } from "./timeline.ts";

export type ComposeInput = {
  cfg: LoadedConfig;
  scenes: PreparedScene[];
  size: { width: number; height: number };
  perScene: number;
  outro: OutroContent | null;
  /** Absolute path of a full-screen intro clip, played before the scenes. */
  introPath: string | null;
  /** Absolute path of the music bed or narration track, spanning the whole video. */
  audioPath: string | null;
  /** The composition/ directory this writes into; cleared by the caller first. */
  outDir: string;
};

export type ComposeResult = { timeline: Timeline; totalSeconds: number };

const px = (n: number) => `${n.toFixed(2)}px`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const isTransparentCss = (css: string) => css.trim().toLowerCase() === "transparent";

export async function writeComposition(input: ComposeInput): Promise<ComposeResult> {
  const { cfg, scenes, size, perScene, outro, introPath, audioPath, outDir } = input;
  const layersDir = join(outDir, "layers");
  await mkdir(layersDir, { recursive: true });

  const timeline = buildTimeline(scenes.length, perScene, outro?.seconds ?? 0);
  const introSeconds = introPath ? await probeDuration(introPath) : 0;
  const total = introSeconds + timeline.total;
  const slotList = slots(timeline);

  const tweens: Tween[] = [];
  const sections: string[] = [];

  if (introPath) {
    const file = `intro${extname(introPath)}`;
    await copyFile(introPath, join(outDir, file));
    sections.push(
      `<video id="intro" data-start="0" data-duration="${introSeconds.toFixed(3)}" muted ` +
        `style="position:absolute;left:0;top:0;width:${px(size.width)};height:${px(size.height)};object-fit:cover;" ` +
        `src="${esc(file)}"></video>`,
    );
  }

  for (const [i, scene] of scenes.entries()) {
    const slot = slotList.find((s) => s.slot.kind === "scene" && s.slot.index === i);
    if (!slot) continue;
    const enterAt = introSeconds + slot.enterAt;
    const start = introSeconds + slot.start;
    const nextStart = Number.isFinite(slot.nextStart) ? introSeconds + slot.nextStart : Infinity;
    const visibleDur = (Number.isFinite(nextStart) ? nextStart : total) - enterAt;

    const { html, sceneTweens } = await writeSceneLayers(
      scene,
      i,
      size,
      perScene,
      enterAt,
      layersDir,
    );
    tweens.push(...sceneTweens);
    tweens.push(...choreo.scenePushTweens(`#scene-${i}`, size.width, enterAt, start, nextStart));

    sections.push(
      `<section id="scene-${i}" data-start="${enterAt.toFixed(3)}" data-duration="${visibleDur.toFixed(3)}" ` +
        `style="position:absolute;left:0;top:0;width:${px(size.width)};height:${px(size.height)};overflow:hidden;">` +
        `${html}</section>`,
    );
  }

  if (outro) {
    const slot = slotList.find((s) => s.slot.kind === "outro");
    if (slot) {
      const enterAt = introSeconds + slot.enterAt;
      const visibleDur = total - enterAt;
      const { html, outroTweens } = await writeOutro(cfg, outro, size, enterAt, layersDir);
      tweens.push(...outroTweens);
      sections.push(
        `<section id="scene-outro" data-start="${enterAt.toFixed(3)}" data-duration="${visibleDur.toFixed(3)}" ` +
          `style="position:absolute;left:0;top:0;width:${px(size.width)};height:${px(size.height)};overflow:hidden;` +
          `background:${esc(cfg.theme.background)};">${html}</section>`,
      );
    }
  }

  let audioTag = "";
  if (audioPath) {
    const file = `audio${extname(audioPath)}`;
    await copyFile(audioPath, join(outDir, file));
    const fadeOut = Math.max(0, total - 1.5);
    audioTag =
      `<audio data-start="0" data-duration="${total.toFixed(3)}" data-volume="1" ` +
      `data-fade-in="0.4" data-fade-out="${(total - fadeOut).toFixed(3)}" src="${esc(file)}"></audio>`;
  }

  const html = renderHtml({
    width: size.width,
    height: size.height,
    fps: PROMO.fps,
    duration: total,
    body: sections.join("\n"),
    audioTag,
    tweens,
  });
  await writeFile(join(outDir, "index.html"), html, "utf8");
  return { timeline, totalSeconds: total };
}

// ---------------------------------------------------------------- scenes

async function writeSceneLayers(
  scene: PreparedScene,
  index: number,
  frameSize: { width: number; height: number },
  perScene: number,
  enterAt: number,
  layersDir: string,
): Promise<{ html: string; sceneTweens: Tween[] }> {
  const s = scene.input;
  const c = s.c;
  const sceneDir = join(layersDir, `scene-${index}`);
  await mkdir(sceneDir, { recursive: true });
  const measure = createCanvas(c.width, c.height).getContext("2d");
  const layers = sceneLayers(measure, s);

  const H = frameSize.height;
  const divs: string[] = [];
  const tweens: Tween[] = [];
  const panId = `pan-${index}`;

  const bgCss = isTransparentCss(s.background) ? "" : `background:${esc(s.background)};`;
  divs.push(
    `<div style="position:absolute;left:0;top:0;width:${px(c.width)};height:${px(c.height)};${bgCss}"></div>`,
  );

  for (const layer of layers) {
    const canvas = createCanvas(c.width, c.height);
    layer.draw(canvas.getContext("2d"));
    const file = `${layer.id}.png`;
    await writeFile(join(sceneDir, file), canvas.toBuffer("image/png"));

    const elId = `l${index}-${layer.id}`;
    const cx = layer.box.left + layer.box.width / 2;
    const cy = layer.box.top + layer.box.height / 2;
    const isBackground = layer.meta.kind === "background";
    const isMarks = layer.meta.kind === "marks";
    const style =
      `position:absolute;left:0;top:0;width:${px(c.width)};height:${px(c.height)};` +
      `transform-origin:${px(cx)} ${px(cy)};opacity:${isBackground ? 1 : 0};` +
      (isMarks ? "clip-path:inset(0% 100% 0% 0%);" : "");
    divs.push(`<img id="${esc(elId)}" style="${style}" src="layers/scene-${index}/${file}">`);

    if (layer.id === "bg-image" && s.theme.scrim) {
      const scrim = s.theme.scrim;
      divs.push(
        `<div style="position:absolute;left:0;top:0;width:${px(c.width)};height:${px(c.height * scrim.height)};` +
          `background:linear-gradient(to bottom, ${esc(scrim.color)}, rgba(0,0,0,0));"></div>`,
      );
    }

    tweens.push(...tweensForLayer(layer, `#${elId}`, H, enterAt, s.decorations));
  }

  const isPanorama = c.width > frameSize.width;
  if (isPanorama) {
    tweens.push(choreo.panTween(`#${panId}`, c.width - frameSize.width, perScene, enterAt));
  }
  const html = `<div id="${panId}" style="position:absolute;left:0;top:0;width:${px(c.width)};height:${px(c.height)};">${divs.join("")}</div>`;
  return { html, sceneTweens: tweens };
}

function tweensForLayer(
  layer: SceneLayer,
  selector: string,
  H: number,
  enterAt: number,
  decorations: Decoration[],
): Tween[] {
  const meta = layer.meta;
  switch (meta.kind) {
    case "background":
      return [choreo.backgroundTween(layer, enterAt)];
    case "copy-line":
      return [choreo.copyLineRise(selector, meta.block, meta.index, H, enterAt)];
    case "marks": {
      // The marks layer rises with its paired text line, then draws itself in.
      const rise = choreo.copyLineRise(selector, meta.block, meta.index, H, enterAt);
      return [rise, choreo.marksReveal(selector, enterAt)];
    }
    case "device":
      return choreo.deviceTweens(selector, meta.deviceIndex, H, enterAt);
    case "decoration":
      return choreo.decorationTweens(
        selector,
        decorations[meta.decoIndex]!,
        meta.side,
        meta.order,
        H,
        enterAt,
      );
  }
}

// ---------------------------------------------------------------- outro

async function writeOutro(
  cfg: LoadedConfig,
  outro: OutroContent,
  size: { width: number; height: number },
  enterAt: number,
  layersDir: string,
): Promise<{ html: string; outroTweens: Tween[] }> {
  const dir = join(layersDir, "outro");
  await mkdir(dir, { recursive: true });
  const layers = outroLayers(cfg.theme, outro, size);
  const divs: string[] = [];
  const tweens: Tween[] = [];
  for (const layer of layers) {
    const canvas = createCanvas(size.width, size.height);
    layer.draw(canvas.getContext("2d"));
    await writeFile(join(dir, `${layer.id}.png`), canvas.toBuffer("image/png"));

    const elId = `outro-${layer.id}`;
    const cx = layer.box.left + layer.box.width / 2;
    const cy = layer.box.top + layer.box.height / 2;
    const style =
      `position:absolute;left:0;top:0;width:${px(size.width)};height:${px(size.height)};` +
      `transform-origin:${px(cx)} ${px(cy)};opacity:0;`;
    divs.push(`<img id="${esc(elId)}" style="${style}" src="layers/outro/${layer.id}.png">`);
    if (layer.id === "icon") tweens.push(...choreo.outroIconTweens(`#${elId}`, enterAt));
    else if (layer.id === "cta") tweens.push(...choreo.outroCtaTweens(`#${elId}`, enterAt));
    else {
      const index = Number(layer.id.split("-")[1]);
      tweens.push(choreo.outroHeadlineLineTween(`#${elId}`, index, size.height, enterAt));
    }
  }
  return { html: divs.join(""), outroTweens: tweens };
}

// ---------------------------------------------------------------- html shell

function renderHtml(params: {
  width: number;
  height: number;
  fps: number;
  duration: number;
  body: string;
  audioTag: string;
  tweens: Tween[];
}): string {
  const { width, height, fps, duration, body, audioTag, tweens } = params;
  const spec = JSON.stringify(tweens);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: #000; }
  #root { position: relative; width: ${px(width)}; height: ${px(height)}; overflow: hidden; background: #000; }
</style>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
</head>
<body>
<div id="root" data-composition-id="promo" data-start="0" data-duration="${duration.toFixed(3)}" data-width="${width}" data-height="${height}" data-fps="${fps}">
${body}
${audioTag}
</div>
<script>
${EASE_SOURCE}
(function () {
  var eases = {
    cubicOut: cubicOut,
    cubicInOut: cubicInOut,
    backOut: backOut,
    decoOpacityEase: decoOpacityEase,
    popOpacityEase: popOpacityEase,
    sineInOut: "sine.inOut",
  };
  var specs = ${spec};
  var tl = gsap.timeline({ paused: true });
  specs.forEach(function (t) {
    var ease = t.ease ? eases[t.ease] : undefined;
    if (!t.duration) {
      tl.set(t.selector, t.to, t.position);
      return;
    }
    var vars = Object.assign({}, t.to, { duration: t.duration });
    if (ease !== undefined) vars.ease = ease;
    if (t.repeat) vars.repeat = t.repeat;
    if (t.yoyo) vars.yoyo = t.yoyo;
    if (t.from) tl.fromTo(t.selector, t.from, vars, t.position);
    else tl.to(t.selector, vars, t.position);
  });
  window.__timelines = window.__timelines || {};
  window.__timelines.promo = tl;
})();
</script>
</body>
</html>
`;
}

export async function probeDuration(file: string): Promise<number> {
  const { execOrThrow } = await import("../exec.ts");
  const r = await execOrThrow("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    file,
  ]);
  return Number(r.stdout.trim());
}
