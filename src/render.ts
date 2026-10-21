import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { type Canvas, createCanvas } from "@napi-rs/canvas";
import { isPreview, type LoadedConfig } from "./config.ts";
import { drawScene, isTransparent } from "./draw.ts";
import { execOrThrow } from "./exec.ts";
import { pngInfo } from "./image.ts";
import { type PrepareOptions, prepareScenes, readCaptureManifest } from "./scene.ts";
import { DEVICES, type DeviceKey, PREVIEW, SCREENSHOT_PIXEL_FORMAT } from "./specs.ts";

/**
 * Composites each raw screenshot into its layout: background and art, copy,
 * decorations behind the device, the device(s) with their bezel, then the
 * decorations in front. Drawn by drawScene (draw.ts) from the geometry
 * compose() returns, the same call the studio's ScreenshotScene makes, so the
 * export is what the browser showed. A panorama layout draws once at span x
 * width and is sliced into store-sized tiles.
 */
export async function renderScreenshots(
  cfg: LoadedConfig,
  deviceKey: DeviceKey,
  locale: string,
  opts: PrepareOptions & { outDir?: string; only?: number } = {},
) {
  const spec = DEVICES[deviceKey];
  // Releases before 0.3 keyed this dir by spec.label; a stale label dir
  // would otherwise ride along into the export zip.
  if (spec.label !== deviceKey && !opts.outDir)
    await rm(join(cfg.outDir, "screenshots", spec.label), { recursive: true, force: true });
  const outDir = opts.outDir ?? join(cfg.outDir, "screenshots", deviceKey, locale);
  await mkdir(outDir, { recursive: true });
  // A layout change renumbers the files; stale ones would otherwise be exported.
  for (const name of await readdir(outDir)) {
    if (name.endsWith(".png")) await rm(join(outDir, name), { force: true });
  }

  const tile = opts.tile ?? spec.screenshot;
  let scenes = await prepareScenes(cfg, deviceKey, locale, opts);
  if (opts.only !== undefined) scenes = scenes.filter((s) => s.first < opts.only!);

  const files = await Promise.all(
    scenes.map(async ({ scene, layout, first, input }) => {
      console.log(`  frame ${scene.id}`);
      const canvas = createCanvas(input.c.width, input.c.height);
      drawScene(canvas.getContext("2d"), input);
      const transparent = isTransparent(input.background);
      const out: string[] = [];
      for (let i = 0; i < layout.span; i++) {
        const slice = createCanvas(tile.width, tile.height);
        slice.getContext("2d").drawImage(canvas, -i * tile.width, 0);
        const suffix = layout.span > 1 ? `-${i + 1}` : "";
        const name = `${String(first + i + 1).padStart(2, "0")}-${scene.id}${suffix}.png`;
        out.push(await writePng(slice, outDir, name, transparent));
      }
      return out;
    }),
  );
  return files.flat();
}

/**
 * Writes the canvas as an opaque PNG. App Store rejects screenshots carrying
 * an alpha channel, and the canvas always encodes RGBA, so ffmpeg strips it
 * on the way out. A transparent background keeps the alpha channel: those
 * files are for compositing elsewhere, not for upload.
 */
async function writePng(
  canvas: Canvas,
  outDir: string,
  name: string,
  keepAlpha = false,
): Promise<string> {
  const final = join(outDir, name);
  if (keepAlpha) {
    await writeFile(final, await canvas.encode("png"));
    return final;
  }
  const raw = join(outDir, `.${name}.rgba.png`);
  await writeFile(raw, await canvas.encode("png"));
  await execOrThrow("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    raw,
    "-pix_fmt",
    SCREENSHOT_PIXEL_FORMAT,
    final,
  ]);
  await rm(raw, { force: true });
  return final;
}

/**
 * Joins the raw segment clips into one plain screen recording at the spec's
 * preview size. App Store previews must be the device screen and nothing
 * else, so no bezel, background or captions are added; only an audio track,
 * which Apple requires even when it is silent. The android video follows the
 * same shape, destined for the YouTube promo link the user posts themselves.
 */
export async function renderPreview(cfg: LoadedConfig, deviceKey: DeviceKey, locale: string) {
  const spec = DEVICES[deviceKey];
  const scene = cfg.scenes.find(isPreview);
  if (!scene) return null;
  if (!spec.preview) {
    console.log(`  ${deviceKey} has no preview pipeline`);
    return null;
  }
  const manifest = await readCaptureManifest(cfg, deviceKey, locale);
  if (!manifest.preview)
    throw new Error("No preview clips in the capture manifest. Run: goldie capture");

  const clips = scene.segments.map((segment) => {
    const clip = manifest.preview!.clips.find((c) => c.segmentId === segment.id);
    if (!clip)
      throw new Error(`Segment "${segment.id}" is in the config but not in the capture manifest.`);
    return clip;
  });

  const seconds = clips.reduce((s, c) => s + c.durationSeconds, 0);
  // The 15-30s window is Apple's upload rule; a YouTube video has no bounds.
  if (spec.platform === "ios" && (seconds < PREVIEW.minSeconds || seconds > PREVIEW.maxSeconds)) {
    throw new Error(
      `Preview is ${seconds.toFixed(1)}s; Apple requires ${PREVIEW.minSeconds}-${PREVIEW.maxSeconds}s. ` +
        `Adjust the segment flows or their holdSeconds and re-capture.`,
    );
  }

  if (spec.label !== deviceKey)
    await rm(join(cfg.outDir, "previews", spec.label), { recursive: true, force: true });
  const outDir = join(cfg.outDir, "previews", deviceKey, locale);
  await mkdir(outDir, { recursive: true });
  const list = join(outDir, `.${scene.id}.clips.txt`);
  await writeFile(list, clips.map((c) => `file '${c.file.replace(/'/g, "'\\''")}'`).join("\n"));
  const final = join(outDir, `${scene.id}.mp4`);

  const { width, height } = spec.preview;
  const audio = scene.audio
    ? ["-i", resolve(cfg.root, scene.audio), "-filter:a", "volume=0.35"]
    : ["-f", "lavfi", "-i", `anullsrc=r=${PREVIEW.audioSampleRate}:cl=stereo`];

  console.log(`  render preview (${seconds.toFixed(1)}s)`);
  await execOrThrow("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    ...audio,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    // Cover the upload size and crop the sliver the aspect ratios disagree on.
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},fps=${PREVIEW.fps},format=yuv420p`,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-b:v",
    PREVIEW.videoBitrate,
    "-c:a",
    "aac",
    "-b:a",
    PREVIEW.audioBitrate,
    "-ar",
    String(PREVIEW.audioSampleRate),
    "-shortest",
    "-movflags",
    "+faststart",
    final,
  ]);
  await rm(list, { force: true });

  return final;
}

function pick(map: Record<string, string>, locale: string, sceneId: string, field: string): string {
  const value = map[locale];
  if (value === undefined)
    throw new Error(`Scene "${sceneId}" has no ${field} for locale "${locale}".`);
  return value;
}

/** Compares finished assets against the Apple spec table and prints a report. */
export async function verify(
  cfg: LoadedConfig,
  deviceKey: DeviceKey,
  locale: string,
): Promise<boolean> {
  const spec = DEVICES[deviceKey];
  let ok = true;

  const shotDir = join(cfg.outDir, "screenshots", deviceKey, locale);
  for (const file of await filesWithExt(shotDir, ".png")) {
    const { width, height, hasAlpha: alpha } = await pngInfo(file);
    // A transparent theme background keeps its alpha on purpose.
    const alphaOk = !alpha || isTransparent(cfg.theme.background);
    const good = width === spec.screenshot.width && height === spec.screenshot.height && alphaOk;
    ok &&= good;
    console.log(
      `  ${good ? "ok  " : "FAIL"} ${basename(file)}  ${width}x${height}` +
        `${alpha ? (alphaOk ? "  transparent (not for upload)" : "  alpha channel present") : ""}` +
        `${good ? "" : `  expected ${spec.screenshot.width}x${spec.screenshot.height}, no alpha`}`,
    );
  }

  // A null preview spec means no video pipeline; screenshots are the whole story.
  const previewSpec = spec.preview;
  if (!previewSpec) return ok;

  const previewDir = join(cfg.outDir, "previews", deviceKey, locale);
  for (const file of await filesWithExt(previewDir, ".mp4")) {
    const r = await execOrThrow("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels:format=duration",
      "-of",
      "json",
      file,
    ]);
    const probe = JSON.parse(r.stdout);
    const video = probe.streams.find((s: any) => s.codec_type === "video");
    const audio = probe.streams.find((s: any) => s.codec_type === "audio");
    const duration = Number(probe.format.duration);
    const fps = evalRatio(video?.avg_frame_rate ?? "0/1");
    const bytes = (await stat(file)).size;

    // Duration and file-size bounds are Apple upload rules; the android video
    // goes to YouTube, so only the pipeline's own output is checked there.
    const appleBounds = spec.platform === "ios";
    const checks: Array<[string, boolean, string]> = [
      [
        "size",
        video?.width === previewSpec.width && video?.height === previewSpec.height,
        `${video?.width}x${video?.height} (need ${previewSpec.width}x${previewSpec.height})`,
      ],
      ["codec", video?.codec_name === "h264", String(video?.codec_name)],
      ["fps", fps <= PREVIEW.fps + 0.01, fps.toFixed(2)],
      [
        "duration",
        !appleBounds || (duration >= PREVIEW.minSeconds && duration <= PREVIEW.maxSeconds),
        `${duration.toFixed(1)}s`,
      ],
      [
        "audio",
        Boolean(audio) && audio.codec_name === "aac",
        audio ? `${audio.codec_name} ${audio.sample_rate}Hz` : "none",
      ],
      [
        "filesize",
        !appleBounds || bytes <= PREVIEW.maxBytes,
        `${(bytes / 1024 / 1024).toFixed(1)} MB`,
      ],
    ];
    for (const [name, good, detail] of checks) {
      ok &&= good;
      console.log(`  ${good ? "ok  " : "FAIL"} ${basename(file)}  ${name}: ${detail}`);
    }
  }

  return ok;
}

/** Absolute paths of the files in `dir` with the extension, sorted; empty when the dir is missing. */
async function filesWithExt(dir: string, ext: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names
    .filter((n) => n.endsWith(ext))
    .sort()
    .map((n) => join(dir, n));
}

const evalRatio = (r: string) => {
  const [n, d] = r.split("/").map(Number);
  return d ? n / d : 0;
};
