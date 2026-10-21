import { existsSync } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { type CaptureManifest, capturesPerLocale, rawDirFor } from "./capture.ts";
import {
  type Decoration,
  deviceFrame,
  FRAME_VARIANTS,
  framePath,
  frameVariantFor,
  isPreview,
  isScreenshot,
  type LoadedConfig,
  type Theme,
  VARIANT_DEVICE,
  variantFramePath,
} from "./config.ts";
import { execOrThrow } from "./exec.ts";
import { CUSTOM_FONT_FALLBACK, FONTS, fontFilePath } from "./fonts.ts";
import type { FrameGeometry } from "./frame.ts";
import { imageSize } from "./image.ts";
import { LAYOUTS, TEMPLATES } from "./layouts.ts";
import { DEVICES, type DeviceKey, type DeviceType } from "./specs.ts";

/**
 * `out/web/` - the studio's static root. It holds the manifest, the
 * bezel art, and symlinks to the finished assets and the raw
 * captures. The raw captures and bezels are what the studio composites in
 * the browser (instant background/frame changes); the finished files under
 * screenshots/ and previews/ are what an export zips up.
 *
 * The `design` section carries everything the browser-side composition needs:
 * the theme, each scene's copy, and per-device raw capture urls. `assets`
 * still records the finished files so tooling can see what was last rendered.
 */
export type StoreManifest = {
  generatedAt: string;
  app: {
    name: string;
    subtitle: Record<string, string>;
    developer: string;
    category: string;
    rating: number;
    ratingCount: string;
    ageRating: string;
    price: string;
    description: Record<string, string>;
  };
  devices: Array<{
    key: DeviceKey;
    label: string;
    platform: "ios" | "android";
    type: DeviceType;
    copyScale: number;
    simulatorName: string | null;
    screenshot: { width: number; height: number };
    preview: { width: number; height: number } | null;
    /**
     * Bezel art fixed to this device (the android Pixel art), with the
     * geometry it composes at. null on devices that render the frame variant
     * the design picks.
     */
    frame: { url: string; geom: FrameGeometry } | null;
  }>;
  locales: string[];
  /** Keyed by device key, then locale. */
  assets: Record<string, Record<string, LocaleAssets>>;
  /** Rendered social promo videos (`goldie promo`), under out/promo. */
  promo: Array<{ format: string; locale: string; url: string; durationSeconds: number }>;
  /** Art-direction concept boards (`goldie concepts`), under out/concepts; newest run only. */
  concepts: Array<{ style: string; label: string; url: string }>;
  /** Everything the studio needs to composite scenes in the browser. */
  design: {
    theme: Theme;
    /** The bundled variant each device renders with; null when the config points at custom bezel art. */
    frames: Record<string, string | null>;
    /** Every bundled variant and the device it is drawn for. */
    frameVariants: Array<{ key: string; device: string }>;
    /** Url of the config's custom bezel art; null when bundled variants are used. */
    customFrameUrl: string | null;
    /** Bundled typefaces, with the @font-face sources the studio declares. */
    fonts: Array<{
      key: string;
      family: string;
      fallback: string;
      faces: Array<{ weight: number; url: string }>;
    }>;
    /** Every layout the studio can pick, in menu order. */
    layouts: Array<{ key: string; label: string; description: string; span: number }>;
    templates: Array<{ key: string; label: string; description: string; sequence: string[] }>;
    /** The theme's template: a built-in key, null for none, or the config's custom sequence. */
    template: string | string[] | null;
    /** The theme's default layout key. */
    layout: string;
    screenOnly: boolean;
    /** Theme-level decorations; image `src` values are urls under out/web. Theme image paths are urls too. */
    decorations: Decoration[];
    scenes: Array<{
      id: string;
      headline: Record<string, string>;
      subhead?: Record<string, string>;
      kicker?: Record<string, string>;
      /** The config's copy alignment for this scene, overriding its layout's. */
      align?: "left" | "center" | "right";
      /** The scene's own CSS background, overriding the theme's. */
      background?: string;
      /** Url under out/web, or "none". */
      backgroundImage?: string;
      layout?: string;
      secondScene?: string;
      decorations?: Decoration[];
      /** Devices the scene is not shot on. */
      skipDevices?: string[];
      /** Per-device decoration lists, replacing `decorations` on that device. */
      byDevice?: Record<string, { decorations?: Decoration[] }>;
    }>;
    preview: {
      sceneId: string;
      segments: Array<{ id: string }>;
    } | null;
    /** Raw capture urls per device key; a device is absent until `goldie capture` ran. */
    captures: Record<string, DeviceCaptureUrls & { byLocale?: Record<string, DeviceCaptureUrls> }>;
  };
};

/**
 * A device's raw capture urls. With localizedCaptures, `byLocale` holds each
 * captured locale's own set and the top level repeats the first locale's.
 */
export type DeviceCaptureUrls = {
  screenshots: Array<{ sceneId: string; url: string }>;
  clips: Array<{ segmentId: string; url: string; durationSeconds: number }> | null;
};

export type LocaleAssets = {
  screenshots: Array<{
    sceneId: string;
    url: string;
    width: number;
    height: number;
    bytes: number;
  }>;
  preview: {
    sceneId: string;
    url: string;
    width: number;
    height: number;
    bytes: number;
    durationSeconds: number;
  } | null;
};

export const WEB_DIR = "web";

export async function writeManifest(cfg: LoadedConfig): Promise<string> {
  const webDir = join(cfg.outDir, WEB_DIR);
  await mkdir(webDir, { recursive: true });
  await link(join(cfg.outDir, "screenshots"), join(webDir, "screenshots"));
  await link(join(cfg.outDir, "previews"), join(webDir, "previews"));
  await link(join(cfg.outDir, "raw"), join(webDir, "raw"));
  await link(join(cfg.outDir, "promo"), join(webDir, "promo"));
  await link(join(cfg.outDir, "concepts"), join(webDir, "concepts"));

  // Bezel art the browser composites with; every bundled variant so switching
  // frames never waits on a server.
  const framesDir = join(webDir, "frames");
  await mkdir(framesDir, { recursive: true });
  const frameVariants: StoreManifest["design"]["frameVariants"] = [];
  for (const variant of FRAME_VARIANTS) {
    await copyFile(variantFramePath(variant), join(framesDir, `${variant}.png`));
    frameVariants.push({ key: variant, device: VARIANT_DEVICE[variant] });
  }
  const custom = "variant" in cfg.frame ? null : "frames/custom.png";
  if (custom) await copyFile(framePath(cfg), join(webDir, custom));
  const frames: StoreManifest["design"]["frames"] = {};
  for (const device of cfg.devices) frames[device] = frameVariantFor(cfg, device);

  // Bezel art a device brings itself, copied under its device key: the
  // android Pixel art, which the frame picker does not apply to.
  const deviceFrames: Record<string, { url: string; geom: FrameGeometry }> = {};
  for (const key of cfg.devices) {
    if (DEVICES[key].platform !== "android") continue;
    const { image, geom } = deviceFrame(cfg, key);
    const url = `frames/${key}${extname(image)}`;
    await copyFile(image, join(webDir, url));
    deviceFrames[key] = { url, geom };
  }

  // Bundled typefaces, so the browser renders the same cuts the canvas does.
  const fontsDir = join(webDir, "fonts");
  await mkdir(fontsDir, { recursive: true });
  const fonts: StoreManifest["design"]["fonts"] = [];
  for (const [key, font] of Object.entries(FONTS)) {
    const faces: Array<{ weight: number; url: string }> = [];
    for (const [weight, file] of Object.entries(font.files)) {
      await copyFile(fontFilePath(file), join(fontsDir, file));
      faces.push({ weight: Number(weight), url: `fonts/${file}` });
    }
    fonts.push({ key, family: font.family, fallback: font.fallback, faces });
  }

  // Typefaces the config brought with it, copied next to the bundled ones so the
  // studio's preview and the exported PNGs use the same cuts. Without this the
  // browser would fall back to a system face and the studio would disagree with
  // the export for exactly the scripts theme.fontFiles exists to support.
  for (const [i, font] of (cfg.theme.fontFiles ?? []).entries()) {
    const faces: Array<{ weight: number; url: string }> = [];
    for (const [weight, file] of Object.entries(font.files)) {
      // A family is free text: it may hold a "/" or match a bundled file's
      // name, and two may share a slug, hence the prefix and the index.
      const name = `custom-${i}-${slug(font.family)}-${weight}${extname(file)}`;
      await copyFile(file, join(fontsDir, name));
      faces.push({ weight: Number(weight), url: `fonts/${name}` });
    }
    fonts.push({
      key: font.family,
      family: font.family,
      fallback: CUSTOM_FONT_FALLBACK,
      faces,
    });
  }

  // Art and decoration images, copied so the browser draws the same layers.
  // Two files may share a name in different folders, so each copy is keyed
  // by its source path and numbered.
  const decorDir = join(webDir, "decor");
  await rm(decorDir, { recursive: true, force: true });
  await mkdir(decorDir, { recursive: true });
  const copied = new Map<string, string>();
  const webAsset = async (src: string | undefined): Promise<string | undefined> => {
    if (!src || src === "none") return src;
    const abs = resolve(cfg.root, src);
    // Art `goldie art` has not generated yet: keep a url (the studio shows
    // nothing there) rather than failing the whole manifest.
    if (!existsSync(abs)) return `decor/pending-${basename(abs)}`;
    let url = copied.get(abs);
    if (!url) {
      url = `decor/${copied.size}-${basename(abs)}`;
      await copyFile(abs, join(webDir, url));
      copied.set(abs, url);
    }
    return url;
  };
  // Image decorations keep their config-relative src alongside the browser
  // url, under `configSrc`: the editor needs it to save a moved or newly
  // added image layer back to goldie.design.json in the same relative form
  // the config itself uses, rather than the out/web url it renders with.
  const webDecorations = async (list: Decoration[] | undefined) =>
    Promise.all(
      (list ?? []).map(async (d) =>
        d.kind === "image" ? { ...d, configSrc: d.src, src: (await webAsset(d.src))! } : d,
      ),
    );
  const scenes: StoreManifest["design"]["scenes"] = [];
  for (const scene of cfg.scenes.filter(isScreenshot)) {
    scenes.push({
      id: scene.id,
      headline: scene.headline,
      ...(scene.subhead ? { subhead: scene.subhead } : {}),
      ...(scene.kicker ? { kicker: scene.kicker } : {}),
      ...(scene.align ? { align: scene.align } : {}),
      ...(scene.background ? { background: scene.background } : {}),
      ...(scene.backgroundImage ? { backgroundImage: await webAsset(scene.backgroundImage) } : {}),
      ...(scene.layout ? { layout: scene.layout } : {}),
      ...(scene.secondScene ? { secondScene: scene.secondScene } : {}),
      ...(scene.decorations ? { decorations: await webDecorations(scene.decorations) } : {}),
      ...(scene.skipDevices?.length ? { skipDevices: scene.skipDevices } : {}),
      ...(scene.byDevice
        ? {
            byDevice: Object.fromEntries(
              await Promise.all(
                Object.entries(scene.byDevice).map(async ([device, o]) => [
                  device,
                  o?.decorations ? { decorations: await webDecorations(o.decorations) } : {},
                ]),
              ),
            ),
          }
        : {}),
    });
  }
  const theme: Theme = {
    ...cfg.theme,
    backgroundImage: await webAsset(cfg.theme.backgroundImage),
    backdrop: await webAsset(cfg.theme.backdrop),
  };

  const assets: StoreManifest["assets"] = {};
  for (const deviceKey of cfg.devices) {
    assets[deviceKey] = {};
    for (const locale of cfg.locales) {
      assets[deviceKey][locale] = await collect(cfg, deviceKey, locale);
    }
  }

  const captures: StoreManifest["design"]["captures"] = {};
  // Capture files sit under out/raw, which web/raw links to; a url keeps the
  // file's path below it, so per-locale dirs come along.
  const rawRoot = join(cfg.outDir, "raw");
  const rawUrl = (file: string) => `raw/${relative(rawRoot, file).split(sep).join("/")}`;
  const urlsOf = (raw: CaptureManifest): DeviceCaptureUrls => ({
    screenshots: raw.screenshots.map((s) => ({ sceneId: s.sceneId, url: rawUrl(s.file) })),
    clips: raw.preview
      ? raw.preview.clips.map((c) => ({
          segmentId: c.segmentId,
          url: rawUrl(c.file),
          durationSeconds: c.durationSeconds,
        }))
      : null,
  });
  for (const deviceKey of cfg.devices) {
    if (!capturesPerLocale(cfg, deviceKey)) {
      const raw = await readCaptureManifest(cfg, deviceKey, cfg.locales[0]!);
      if (raw) captures[deviceKey] = urlsOf(raw);
      continue;
    }
    const byLocale: Record<string, DeviceCaptureUrls> = {};
    for (const locale of cfg.locales) {
      const raw = await readCaptureManifest(cfg, deviceKey, locale);
      if (raw) byLocale[locale] = urlsOf(raw);
    }
    const first = byLocale[cfg.locales[0]!] ?? Object.values(byLocale)[0];
    if (first) captures[deviceKey] = { ...first, byLocale };
  }

  // Promo videos: out/promo/<format>/<locale>/promo.mp4, format "9x16" etc.
  const promo: StoreManifest["promo"] = [];
  for (const format of (await ls(join(cfg.outDir, "promo"))).sort()) {
    for (const locale of (await ls(join(cfg.outDir, "promo", format))).sort()) {
      const file = join(cfg.outDir, "promo", format, locale, "promo.mp4");
      if (!(await stat(file).catch(() => null))) continue;
      const { durationSeconds } = await videoInfo(file);
      promo.push({
        format: format.replace("x", ":"),
        locale,
        url: `promo/${format}/${locale}/promo.mp4`,
        durationSeconds,
      });
    }
  }
  // Concept boards: out/concepts/<style>/board.png.
  const concepts: StoreManifest["concepts"] = [];
  for (const style of (await ls(join(cfg.outDir, "concepts"))).sort()) {
    const file = join(cfg.outDir, "concepts", style, "board.png");
    if (!(await stat(file).catch(() => null))) continue;
    concepts.push({ style, label: conceptLabel(style), url: `concepts/${style}/board.png` });
  }

  const previewScene = cfg.scenes.find(isPreview);
  const manifest: StoreManifest = {
    generatedAt: new Date().toISOString(),
    app: { ...cfg.store },
    devices: cfg.devices.map((key) => ({
      key,
      label: DEVICES[key].label,
      platform: DEVICES[key].platform,
      type: DEVICES[key].type,
      copyScale: DEVICES[key].copyScale ?? 1,
      simulatorName: DEVICES[key].simulatorName ?? null,
      screenshot: DEVICES[key].screenshot,
      preview: DEVICES[key].preview,
      frame: deviceFrames[key] ?? null,
    })),
    locales: cfg.locales,
    assets,
    promo,
    concepts,
    design: {
      theme,
      frames,
      frameVariants,
      customFrameUrl: custom,
      fonts,
      layouts: Object.values(LAYOUTS).map(({ key, label, description, span }) => ({
        key,
        label,
        description,
        span,
      })),
      templates: Object.values(TEMPLATES),
      template: cfg.theme.template ?? null,
      layout: cfg.theme.layout ?? "classic",
      screenOnly: cfg.theme.screenOnly ?? false,
      decorations: await webDecorations(cfg.theme.decorations),
      scenes,
      preview: previewScene
        ? {
            sceneId: previewScene.id,
            segments: previewScene.segments.map(({ id }) => ({ id })),
          }
        : null,
      captures,
    },
  };

  const file = join(webDir, "store.json");
  await writeFile(file, JSON.stringify(manifest, null, 2));
  return file;
}

/** "3d-inflated" -> "3d inflated", for a concept board's caption. */
function conceptLabel(style: string): string {
  return style.replace(/-/g, " ");
}

/** A font family as a safe file-name segment. */
function slug(family: string): string {
  return (
    family
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "font"
  );
}

async function readCaptureManifest(
  cfg: LoadedConfig,
  deviceKey: DeviceKey,
  locale: string,
): Promise<CaptureManifest | null> {
  try {
    const dir = rawDirFor(cfg, deviceKey, locale);
    return JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  } catch {
    return null;
  }
}

async function collect(
  cfg: LoadedConfig,
  deviceKey: DeviceKey,
  locale: string,
): Promise<LocaleAssets> {
  const shotDir = join(cfg.outDir, "screenshots", deviceKey, locale);
  const previewDir = join(cfg.outDir, "previews", deviceKey, locale);
  const sceneOrder = cfg.scenes.filter(isScreenshot).map((s) => s.id);

  const screenshots: LocaleAssets["screenshots"] = [];
  for (const name of (await ls(shotDir)).filter((f) => f.endsWith(".png")).sort()) {
    const file = join(shotDir, name);
    const { width, height } = await imageSize(file);
    // Files are named "<index>-<sceneId>.png".
    const sceneId = sceneOrder.find((id) => name.includes(id)) ?? basename(name, ".png");
    screenshots.push({
      sceneId,
      url: `screenshots/${deviceKey}/${locale}/${name}`,
      width,
      height,
      bytes: (await stat(file)).size,
    });
  }

  const previewScene = cfg.scenes.find(isPreview);
  const previewName = (await ls(previewDir)).find((f) => f.endsWith(".mp4"));
  let preview: LocaleAssets["preview"] = null;
  if (previewScene && previewName) {
    const file = join(previewDir, previewName);
    const probe = await videoInfo(file);
    preview = {
      sceneId: previewScene.id,
      url: `previews/${deviceKey}/${locale}/${previewName}`,
      ...probe,
      bytes: (await stat(file)).size,
    };
  }

  return { screenshots, preview };
}

const ls = async (dir: string) => readdir(dir).catch(() => [] as string[]);

/**
 * Directory link, replaced on every run so a moved out/ never goes stale.
 * A relative symlink on macOS and Linux. On Windows a directory symlink needs
 * Developer Mode or a privilege most accounts lack, so an NTFS junction is
 * used instead; junctions need an absolute target and no special rights.
 */
async function link(target: string, path: string): Promise<void> {
  // Unlink an existing link by name; a recursive rm must never follow a
  // junction into the real captures on a rerun.
  const existing = await lstat(path).catch(() => null);
  if (existing?.isSymbolicLink()) await unlink(path);
  else if (existing) await rm(path, { recursive: true, force: true });
  if (process.platform === "win32") {
    await mkdir(target, { recursive: true }); // a junction to a missing dir is dangling
    await symlink(resolve(target), path, "junction");
  } else {
    await symlink(relative(dirname(path), target), path, "dir");
  }
}

async function videoInfo(file: string) {
  const r = await execOrThrow("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "json",
    file,
  ]);
  const probe = JSON.parse(r.stdout);
  return {
    width: probe.streams[0].width as number,
    height: probe.streams[0].height as number,
    durationSeconds: Number(probe.format.duration),
  };
}
