/**
 * The social promo video: the designed screenshot tiles brought to life for
 * TikTok, Reels, X, YouTube or the Play Store's promo link. Every frame is
 * drawn by drawScene (draw.ts) with a Motion, so the video shows exactly the
 * tiles the store gets: headlines rise in line by line and their marks draw
 * themselves, devices spring up, stickers and callouts pop and float,
 * panoramas pan, and scenes push one into the next. Frames are piped raw into
 * ffmpeg; an optional intro clip and a music bed are joined at the end.
 *
 * Unlike the App Store preview this is marketing, so no store rule limits it.
 */
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createCanvas, type Image, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { Decoration, LoadedConfig, PromoConfig } from "./config.ts";
import { drawScene, type LayerState, layerOf, type Motion, paint } from "./draw.ts";
import { execOrThrow } from "./exec.ts";
import { registerFonts, withGlyphFallback } from "./fonts.ts";
import { TYPE } from "./layouts.ts";
import { parseEmphasis, wrapRuns } from "./richtext.ts";
import { type PreparedScene, prepareScenes } from "./scene.ts";
import { DEVICES, type DeviceKey } from "./specs.ts";

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
  videoBitrate: "12M",
} as const;

/** The device whose captures the promo shows: the first iPhone, else the config's first device. */
export function promoDevice(cfg: LoadedConfig, requested?: DeviceKey): DeviceKey {
  if (requested) return requested;
  return cfg.devices.find((d) => DEVICES[d].type === "iphone") ?? cfg.devices[0]!;
}

export async function renderPromo(
  cfg: LoadedConfig,
  locale: string,
  format: PromoFormat,
  opts: { device?: DeviceKey; music?: (seconds: number) => Promise<string | null> } = {},
): Promise<string> {
  const promo: PromoConfig = cfg.promo ?? {};
  const size = PROMO_FORMATS[format];
  if (!size)
    throw new Error(
      `Unknown promo format "${format}". Available: ${Object.keys(PROMO_FORMATS).join(", ")}`,
    );
  const deviceKey = promoDevice(cfg, opts.device);
  registerFonts(cfg.theme.fontFiles);

  const all = await prepareScenes(cfg, deviceKey, locale, {
    tile: size,
    copyScale: PROMO.copyScale,
  });
  const order = promo.scenes ?? all.map((s) => s.scene.id);
  const scenes = order.map((id) => {
    const found = all.find((s) => s.scene.id === id);
    if (!found) throw new Error(`promo.scenes names "${id}", which is not a screenshot scene.`);
    return found;
  });
  if (scenes.length === 0) throw new Error("The promo has no scenes to show.");

  const perScene = promo.secondsPerScene ?? PROMO.secondsPerScene;
  const outro = promo.outro
    ? {
        headline: pickLocale(promo.outro.headline, locale, "promo.outro.headline"),
        cta: promo.outro.cta ? pickLocale(promo.outro.cta, locale, "promo.outro.cta") : undefined,
        icon: promo.outro.icon ? await loadImage(resolve(cfg.root, promo.outro.icon)) : null,
        seconds: promo.outro.seconds ?? PROMO.outroSeconds,
      }
    : null;
  const timeline = buildTimeline(scenes.length, perScene, outro?.seconds ?? 0);

  const outDir = join(cfg.outDir, "promo", format.replace(":", "x"), locale);
  await mkdir(outDir, { recursive: true });
  const motionFile = join(outDir, ".motion.mp4");
  const final = join(outDir, "promo.mp4");

  console.log(
    `  promo ${format} ${locale}: ${scenes.length} scenes, ${timeline.total.toFixed(1)}s`,
  );
  await encodeFrames(motionFile, size, timeline.frames, (ctx, frame) =>
    drawFrame(ctx, frame / PROMO.fps, { scenes, timeline, size, cfg, outro }),
  );

  // Intro clip, then the motion graphics, then the music bed.
  const intro = promo.intro ? resolve(cfg.root, promo.intro) : null;
  const introSeconds = intro ? await durationOf(intro) : 0;
  const total = introSeconds + timeline.total;
  const audio = promo.audio
    ? resolve(cfg.root, promo.audio)
    : opts.music
      ? await opts.music(Math.ceil(total))
      : null;

  const { width, height } = size;
  const fit = `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},fps=${PROMO.fps},setsar=1,format=yuv420p`;
  const inputs: string[] = [];
  const parts: string[] = [];
  let n = 0;
  if (intro) {
    inputs.push("-i", intro);
    parts.push(`[${n}:v]${fit}[p${n}]`);
    n++;
  }
  inputs.push("-i", motionFile);
  parts.push(`[${n}:v]${fit}[p${n}]`);
  n++;
  const concat = `${Array.from({ length: n }, (_, i) => `[p${i}]`).join("")}concat=n=${n}:v=1:a=0[v]`;
  const fadeOut = Math.max(0, total - 1.5);
  if (audio) inputs.push("-i", audio);
  else inputs.push("-f", "lavfi", "-t", total.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
  const audioChain = `[${n}:a]atrim=0:${total.toFixed(3)},afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOut.toFixed(3)}:d=1.5[a]`;

  await execOrThrow("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    `${parts.join(";")};${concat};${audioChain}`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-b:v",
    PROMO.videoBitrate,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-ar",
    "48000",
    "-t",
    total.toFixed(3),
    "-movflags",
    "+faststart",
    final,
  ]);
  await rm(motionFile, { force: true });
  return final;
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
const phase = (t: number, start: number, dur: number) => clamp01((t - start) / dur);

/**
 * The entrance choreography of one scene at local time `t` (0 = it starts
 * arriving). Copy first, then the device, then what sits around and on it.
 */
export function sceneMotion(
  t: number,
  s: PreparedScene,
  size: { width: number; height: number },
): Motion {
  const H = size.height;
  const decorations = s.input.decorations;
  const backIndex = (i: number) =>
    decorations.slice(0, i).filter((d) => layerOf(d) === "back").length;
  const frontIndex = (i: number) =>
    decorations.slice(0, i).filter((d) => layerOf(d) === "front").length;
  return {
    background: { scale: 1.08 - 0.08 * easeOutCubic(t / 3.2) },
    copyLine: (block, index) => {
      const offset =
        block === "kicker" ? 0 : block === "headline" ? 0.12 + index * 0.11 : 0.55 + index * 0.08;
      const p = easeOutCubic(phase(t, 0.08 + offset, 0.5));
      return { opacity: p, dy: (1 - p) * H * 0.035 };
    },
    marks: easeInOutCubic(phase(t, 0.75, 0.55)),
    device: (i) => {
      const p = phase(t, 0.3 + i * 0.12, 0.85);
      return {
        dy: (1 - easeOutBack(p)) * H * 0.55,
        rotate: (1 - easeOutCubic(p)) * 5,
        opacity: p > 0 ? 1 : 0,
      };
    },
    decoration: (i, d) =>
      decorationMotion(t, d, layerOf(d) === "front" ? frontIndex(i) : backIndex(i), H),
  };
}

function decorationMotion(t: number, d: Decoration, order: number, H: number): LayerState {
  const front = layerOf(d) === "front";
  const start = (front ? 0.95 : 0.55) + order * 0.14 + (d.kind === "callout" ? 0.1 : 0);
  const p = phase(t, start, 0.55);
  if (p <= 0) return { opacity: 0 };
  const settled = Math.max(0, t - start - 0.55);
  // Art keeps breathing once it has landed; UI cards stay put.
  const float =
    d.kind === "image" || d.kind === "bubble"
      ? Math.sin((settled / 2.4) * Math.PI * 2 + order) * H * 0.004
      : 0;
  const from = d.kind === "callout" ? 0.82 : d.kind === "badge" ? 0.9 : 0.55;
  return {
    opacity: easeOutCubic(p * 1.6),
    scale: from + (1 - from) * easeOutBack(p),
    dy: (1 - easeOutCubic(p)) * H * 0.02 + float,
  };
}

// ---------------------------------------------------------------- frames

type FrameContext = {
  scenes: PreparedScene[];
  timeline: Timeline;
  size: { width: number; height: number };
  cfg: LoadedConfig;
  outro: { headline: string; cta?: string; icon: Image | null; seconds: number } | null;
};

/** Draws the frame at time `time`: one scene, or two mid-push. */
function drawFrame(ctx: SKRSContext2D, time: number, f: FrameContext) {
  const { width, height } = f.size;
  const { starts, perScene, outroStart } = f.timeline;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  const T = PROMO.transition;

  // Which slots are visible: the current one, and the next while it pushes in.
  const slots: Array<{ kind: "scene"; index: number } | { kind: "outro" }> = [];
  for (let i = 0; i < starts.length; i++) slots.push({ kind: "scene", index: i });
  if (outroStart !== null) slots.push({ kind: "outro" });
  const startOf = (k: number) => (k < starts.length ? starts[k]! : (outroStart ?? Infinity));

  for (let k = 0; k < slots.length; k++) {
    const start = startOf(k);
    const nextStart = k + 1 < slots.length ? startOf(k + 1) : Infinity;
    // A slot is visible from `start - T` (pushing in; the first has no push) to its successor's arrival.
    const enterAt = k === 0 ? 0 : start - T;
    if (time < enterAt || time >= nextStart) continue;
    const enter = k === 0 ? 1 : easeInOutCubic((time - enterAt) / T);
    const exit = nextStart === Infinity ? 0 : easeInOutCubic((time - (nextStart - T)) / T);
    const dx = (1 - enter) * width - exit * width;
    ctx.save();
    ctx.translate(dx, 0);
    const slot = slots[k]!;
    if (slot.kind === "scene")
      drawSceneAt(ctx, f.scenes[slot.index]!, time - enterAt, perScene, f.size);
    else drawOutro(ctx, f, time - enterAt);
    ctx.restore();
  }
}

function drawSceneAt(
  ctx: SKRSContext2D,
  s: PreparedScene,
  t: number,
  perScene: number,
  size: { width: number; height: number },
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size.width, size.height);
  ctx.clip();
  // A panorama is two tiles wide: the camera pans across it.
  if (s.layout.span > 1) {
    const pan = easeInOutCubic(phase(t, 0.9, Math.max(0.5, perScene - 1.2)));
    ctx.translate(-pan * (s.input.c.width - size.width), 0);
  }
  drawScene(ctx, s.input, sceneMotion(t, s, size));
  ctx.restore();
}

/** The closing card: icon, headline, call to action, on the theme background. */
function drawOutro(ctx: SKRSContext2D, f: FrameContext, t: number) {
  const { width, height } = f.size;
  const { theme } = f.cfg;
  const outro = f.outro!;
  ctx.fillStyle = paint(ctx, theme.background, width, height);
  ctx.fillRect(0, 0, width, height);
  const family = withGlyphFallback(theme.fontFamily);
  const accent = theme.accentColor ?? theme.headlineColor;
  let y = height * 0.3;

  if (outro.icon) {
    const p = easeOutBack(phase(t, 0.15, 0.6));
    const s = width * 0.26;
    const cx = width / 2;
    ctx.save();
    ctx.globalAlpha = clamp01(p * 1.5);
    ctx.translate(cx, y + s / 2);
    ctx.scale(0.6 + 0.4 * p, 0.6 + 0.4 * p);
    ctx.shadowColor = "rgba(15, 23, 42, 0.25)";
    ctx.shadowBlur = width * 0.04;
    ctx.shadowOffsetY = width * 0.015;
    ctx.beginPath();
    ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.225);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.clip();
    ctx.drawImage(outro.icon, -s / 2, -s / 2, s, s);
    ctx.restore();
    y += s + height * 0.05;
  }

  const size = width * TYPE.headlineSize * 1.25 * (theme.headline?.scale ?? 1);
  const weight = theme.headline?.weight ?? TYPE.headlineWeight;
  const font = `${weight} ${size}px ${family}`;
  ctx.font = font;
  ctx.letterSpacing = "0px";
  const text = theme.headline?.uppercase ? outro.headline.toUpperCase() : outro.headline;
  const lines = wrapRuns(parseEmphasis(text), width * 0.82, (s) => ctx.measureText(s).width);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  lines.forEach((line, i) => {
    const p = easeOutCubic(phase(t, 0.35 + i * 0.1, 0.5));
    const w = line.reduce((sum, seg) => sum + ctx.measureText(seg.text).width, 0);
    let x = (width - w) / 2;
    ctx.save();
    ctx.globalAlpha = p;
    for (const seg of line) {
      ctx.fillStyle = seg.em ? accent : theme.headlineColor;
      ctx.fillText(seg.text, x, y + (1 - p) * height * 0.03);
      x += ctx.measureText(seg.text).width;
    }
    ctx.restore();
    y += size * TYPE.headlineLineHeight;
  });

  if (outro.cta) {
    y += height * 0.04;
    const p = easeOutBack(phase(t, 0.75, 0.5));
    const ctaSize = width * 0.045;
    ctx.font = `700 ${ctaSize}px ${family}`;
    const w = ctx.measureText(outro.cta).width + ctaSize * 2.4;
    const h = ctaSize * 2.3;
    ctx.save();
    ctx.globalAlpha = clamp01(p * 1.5);
    ctx.translate(width / 2, y + h / 2);
    ctx.scale(0.8 + 0.2 * p, 0.8 + 0.2 * p);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(outro.cta, 0, 0);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- encoding

/** Draws `frames` frames and pipes them as raw RGBA into an H.264 encode. */
async function encodeFrames(
  file: string,
  size: { width: number; height: number },
  frames: number,
  draw: (ctx: SKRSContext2D, frame: number) => void,
): Promise<void> {
  const { width, height } = size;
  const ff = spawn(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      `${width}x${height}`,
      "-r",
      String(PROMO.fps),
      "-i",
      "pipe:0",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "16",
      "-pix_fmt",
      "yuv420p",
      file,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  ff.stderr.on("data", (d) => {
    stderr += d;
  });
  const done = new Promise<void>((res, rej) => {
    ff.on("error", rej);
    ff.on("close", (code) =>
      code === 0 ? res() : rej(new Error(`ffmpeg failed encoding the promo: ${stderr.trim()}`)),
    );
  });
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < frames; i++) {
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    draw(ctx, i);
    ctx.restore();
    const ok = ff.stdin.write(canvas.data());
    if (!ok) await new Promise<void>((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
}

async function durationOf(file: string): Promise<number> {
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

function pickLocale(map: Record<string, string>, locale: string, field: string): string {
  const v = map[locale];
  if (v === undefined) throw new Error(`${field} has no text for locale "${locale}".`);
  return v;
}
