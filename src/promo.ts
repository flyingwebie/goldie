/**
 * The social promo video: the designed screenshot tiles brought to life for
 * TikTok, Reels, X, YouTube or the Play Store's promo link, rendered by
 * HyperFrames (https://github.com/heygen-com/hyperframes) rather than the
 * ffmpeg frame-by-frame engine this replaces.
 *
 * Every scene is composed once by prepareScenes (scene.ts), exactly like a
 * store tile, then sliced into transparent PNG layers by draw.ts's
 * sceneLayers - background art, each copy line, each emphasis mark, each
 * decoration, each device - and written into a HyperFrames project
 * (src/promo/composition.ts) with a GSAP timeline reproducing the old
 * engine's choreography (src/promo/choreography.ts). HyperFrames then
 * renders that project to promo.mp4 in one pass, audio and all
 * (src/promo/render.ts): no separate ffmpeg mux step.
 *
 * The composition folder survives the render at
 * out/promo/<format>/<locale>/composition/, so it can be opened with
 * HyperFrames' own tools (`npx hyperframes preview`, its catalog of
 * transitions and overlays, its skills) and re-rendered without
 * regenerating it - see `goldie promo --render-only`.
 *
 * Unlike the App Store preview this is marketing, so no store rule limits it.
 */

import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadImage } from "@napi-rs/canvas";
import type { LoadedConfig, PromoConfig } from "./config.ts";
import { registerFonts } from "./fonts.ts";
import { probeDuration, writeComposition } from "./promo/composition.ts";
import { isLandscape, landscapeStageTile } from "./promo/landscape.ts";
import { renderComposition } from "./promo/render.ts";
import { type PreparedScene, prepareScenes } from "./scene.ts";
import type { DeviceKey } from "./specs.ts";

export { HYPERFRAMES_VERSION, hyperframesDoctor } from "./promo/render.ts";
export {
  buildTimeline,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  PROMO,
  PROMO_FORMATS,
  type PromoFormat,
  promoDevice,
  type Timeline,
} from "./promo/timeline.ts";

import {
  buildTimeline,
  PROMO,
  PROMO_FORMATS,
  type PromoFormat,
  promoDevice,
} from "./promo/timeline.ts";

export async function renderPromo(
  cfg: LoadedConfig,
  locale: string,
  format: PromoFormat,
  opts: {
    device?: DeviceKey;
    music?: (seconds: number) => Promise<string | null>;
    /** Skip regenerating the composition folder; render whatever is already there (an agent may have hand-tweaked it with HyperFrames' own tools). */
    renderOnly?: boolean;
    /** Relays HyperFrames' own render progress lines. Defaults to console.log. */
    onProgress?: (line: string) => void;
  } = {},
): Promise<string> {
  const promo: PromoConfig = cfg.promo ?? {};
  const size = PROMO_FORMATS[format];
  if (!size) {
    throw new Error(
      `Unknown promo format "${format}". Available: ${Object.keys(PROMO_FORMATS).join(", ")}`,
    );
  }
  const deviceKey = promoDevice(cfg, opts.device);
  registerFonts(cfg.theme.fontFiles);

  const outDir = join(cfg.outDir, "promo", format.replace(":", "x"), locale);
  const compositionDir = join(outDir, "composition");
  const final = join(outDir, "promo.mp4");
  await mkdir(outDir, { recursive: true });

  if (opts.renderOnly) {
    if (!existsSync(join(compositionDir, "index.html"))) {
      throw new Error(
        `--render-only was passed but there is no composition at ${compositionDir}. Run goldie promo once without it first.`,
      );
    }
  } else {
    // Landscape composes each tile at a portrait stage size and recomposes
    // its copy for the frame (promo/landscape.ts); the rest compose at the frame.
    const all = await prepareScenes(cfg, deviceKey, locale, {
      tile: isLandscape(size) ? landscapeStageTile(size) : size,
      copyScale: PROMO.copyScale,
    });
    const order = promo.scenes ?? all.map((s) => s.scene.id);
    const scenes: PreparedScene[] = order.map((id) => {
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

    const introPath = promo.intro ? resolve(cfg.root, promo.intro) : null;
    const introSeconds = introPath ? await probeDuration(introPath) : 0;
    const timeline = buildTimeline(scenes.length, perScene, outro?.seconds ?? 0);
    const total = introSeconds + timeline.total;

    const audioPath = promo.audio
      ? resolve(cfg.root, promo.audio)
      : opts.music
        ? await opts.music(Math.ceil(total))
        : null;

    console.log(
      `  promo ${format} ${locale}: ${scenes.length} scenes, ${total.toFixed(1)}s - generating composition`,
    );
    await rm(compositionDir, { recursive: true, force: true });
    await writeComposition({
      cfg,
      scenes,
      size,
      perScene,
      outro,
      introPath,
      audioPath,
      outDir: compositionDir,
    });
  }

  console.log(`  promo ${format} ${locale}: rendering with HyperFrames`);
  await renderComposition(compositionDir, final, {
    fps: PROMO.fps,
    quality: PROMO.quality,
    onLine: opts.onProgress ?? ((line) => console.log(`    ${line}`)),
  });
  return final;
}

function pickLocale(map: Record<string, string>, locale: string, field: string): string {
  const v = map[locale];
  if (v === undefined) throw new Error(`${field} has no text for locale "${locale}".`);
  return v;
}
