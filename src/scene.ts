/**
 * Everything one screenshot composition needs before it can be drawn: its
 * layout's geometry, its copy in a locale, and every image it shows, loaded.
 * The still renderer composes at the store tile size; the promo video
 * composes the same scenes at a video frame size.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Image, loadImage } from "@napi-rs/canvas";
import { type CaptureManifest, capturesPerLocale, rawDirFor } from "./capture.ts";
import {
  type Decoration,
  deviceFrame,
  type LoadedConfig,
  resolvedScenes,
  type ScreenshotScene,
} from "./config.ts";
import type { SceneInput } from "./draw.ts";
import { registerFonts } from "./fonts.ts";
import type { FrameGeometry } from "./frame.ts";
import { applyTransform, compose, type LayoutSpec } from "./layouts.ts";
import { DEVICES, type DeviceKey } from "./specs.ts";

export type PreparedScene = {
  scene: ScreenshotScene;
  layout: LayoutSpec;
  /** The first store slot this composition fills; a panorama fills `layout.span`. */
  first: number;
  input: SceneInput;
};

export type PrepareOptions = {
  /** Compose at this size instead of the device's store tile (the promo's frame). */
  tile?: { width: number; height: number };
  /** Overrides the device's copy scale (the promo sets larger type for small screens). */
  copyScale?: number;
  /**
   * Maps an art path from the config to the file to load instead; concept
   * boards point the same config at draft art this way.
   */
  resolveArt?: (src: string) => string;
};

export async function readCaptureManifest(
  cfg: LoadedConfig,
  deviceKey: DeviceKey,
  locale: string,
): Promise<CaptureManifest> {
  const file = join(rawDirFor(cfg, deviceKey, locale), "manifest.json");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    const run = capturesPerLocale(cfg, deviceKey)
      ? `goldie capture --device ${deviceKey} --locale ${locale}`
      : "goldie capture";
    throw new Error(`No capture manifest at ${file}. Run: ${run}`);
  }
}

/** Every screenshot composition of a device and locale, ready for drawScene. */
export async function prepareScenes(
  cfg: LoadedConfig,
  deviceKey: DeviceKey,
  locale: string,
  opts: PrepareOptions = {},
): Promise<PreparedScene[]> {
  const spec = DEVICES[deviceKey];
  const manifest = await readCaptureManifest(cfg, deviceKey, locale);
  const { image, geom } = deviceFrame(cfg, deviceKey);
  const screenOnly = Boolean(cfg.theme.screenOnly || spec.screenOnly);
  const bezel = screenOnly ? null : await loadImage(image);
  registerFonts(cfg.theme.fontFiles);
  const tile = opts.tile ?? spec.screenshot;
  const load = imageLoader(cfg, opts.resolveArt);

  const findShot = (sceneId: string) => {
    const shot = manifest.screenshots.find((s) => s.sceneId === sceneId);
    if (!shot)
      throw new Error(`Scene "${sceneId}" is in the config but not in the capture manifest.`);
    return shot;
  };

  const resolved = resolvedScenes(cfg);
  const totalSlots = resolved.reduce((n, r) => n + r.layout.span, 0);
  const backdrop = cfg.theme.backdrop ? await load(cfg.theme.backdrop) : null;

  let slot = 0;
  const out: PreparedScene[] = [];
  for (const { scene, layout, secondScene } of resolved) {
    const first = slot;
    slot += layout.span;
    // The studio editor's moves apply after compose(), as they do in the studio.
    const c = applyTransform(
      compose(layout, tile, cfg.theme, {
        screenOnly,
        geom,
        copyScale: opts.copyScale ?? spec.copyScale,
      }),
      cfg.sceneTransforms?.[scene.id],
      tile,
    );
    const decorations: Decoration[] = [
      ...(cfg.theme.decorations ?? []),
      ...(scene.decorations ?? []),
    ];
    const images = new Map<string, Image>();
    for (const d of decorations) if (d.kind === "image") images.set(d.src, await load(d.src));
    const bgSrc = scene.backgroundImage ?? cfg.theme.backgroundImage;
    const needsSecond =
      c.devices.some((d) => d.capture === "secondary") ||
      decorations.some((d) => d.kind === "callout" && d.capture === "secondary");

    out.push({
      scene,
      layout,
      first,
      input: {
        c,
        tile,
        theme: cfg.theme,
        headlineColor: cfg.theme.headlineColor,
        subheadColor: cfg.theme.subheadColor,
        background: scene.background ?? cfg.theme.background,
        backgroundImage: bgSrc && bgSrc !== "none" ? await load(bgSrc) : null,
        backdrop: backdrop ? { image: backdrop, slot: first, totalSlots } : null,
        text: {
          kicker: scene.kicker ? pick(scene.kicker, locale, scene.id, "kicker") : undefined,
          headline: pick(scene.headline, locale, scene.id, "headline"),
          subhead: scene.subhead ? pick(scene.subhead, locale, scene.id, "subhead") : undefined,
        },
        locale,
        decorations,
        images,
        captures: {
          primary: await loadImage(findShot(scene.id).file),
          secondary:
            needsSecond && secondScene ? await loadImage(findShot(secondScene).file) : undefined,
        },
        bezel,
        geom: geom as FrameGeometry,
      },
    });
  }
  return out;
}

/** Loads config-relative images once each. */
function imageLoader(cfg: LoadedConfig, resolveArt?: (src: string) => string) {
  const cache = new Map<string, Promise<Image>>();
  return (src: string) => {
    const file = resolve(cfg.root, resolveArt ? resolveArt(src) : src);
    let p = cache.get(file);
    if (!p) {
      p = loadImage(file).catch((err) => {
        throw new Error(
          `Could not load image ${file} (${err instanceof Error ? err.message : err}). ` +
            `Generated art? Run: goldie art`,
        );
      });
      cache.set(file, p);
    }
    return p;
  };
}

function pick(map: Record<string, string>, locale: string, sceneId: string, field: string): string {
  const value = map[locale];
  if (value === undefined)
    throw new Error(`Scene "${sceneId}" has no ${field} for locale "${locale}".`);
  return value;
}
