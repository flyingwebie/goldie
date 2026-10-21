import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateArt } from "./art/validate.ts";
import type { CustomFont } from "./fonts.ts";
import { ANDROID_FRAME, FRAMES, type FrameGeometry } from "./frame.ts";
import {
  type CopyAlign,
  isLayoutKey,
  isTemplateKey,
  LAYOUT_KEYS,
  type LayoutKey,
  needsSecondCapture,
  resolveScenes,
  type SceneTransform,
  TEMPLATE_KEYS,
  type TemplateChoice,
} from "./layouts.ts";
import { DEVICE_KEYS, DEVICES, type DeviceKey, isDeviceKey } from "./specs.ts";

/** Bezel art bundled in goldie's own assets/, one PNG per variant, each drawn for one device. */
export const FRAME_VARIANTS = [
  "17-pro-silver",
  "17-pro-blue",
  "17-pro-orange",
  "ipad-pro-13-silver",
  "ipad-pro-13-space-gray",
] as const;
export type FrameVariant = (typeof FRAME_VARIANTS)[number];

export const VARIANT_DEVICE: Record<FrameVariant, DeviceKey> = {
  "17-pro-silver": "iphone-6.9",
  "17-pro-blue": "iphone-6.9",
  "17-pro-orange": "iphone-6.9",
  "ipad-pro-13-silver": "ipad-13",
  "ipad-pro-13-space-gray": "ipad-13",
};

/** The variants drawn for a device, the first one its default. */
function deviceVariants(device: DeviceKey): FrameVariant[] {
  return FRAME_VARIANTS.filter((v) => VARIANT_DEVICE[v] === device);
}

export function isFrameVariant(key: string): key is FrameVariant {
  return (FRAME_VARIANTS as readonly string[]).includes(key);
}

export type Locale = string;

/** One still screenshot: a flow that navigates somewhere, plus the marketing copy around it. */
export type ScreenshotScene = {
  kind: "screenshot";
  id: string;
  /** Flow in the app's `.argent/flows`: a name ("home") or a path under it ("goldie/home.yaml"). Its final step captures the screenshot. */
  flow: string;
  /**
   * Headline per locale. Wrap words in asterisks to stress them ("Clear your
   * *head*"); theme.emphasis decides how a stressed word stands out.
   */
  headline: Record<Locale, string>;
  subhead?: Record<Locale, string>;
  /** A short handwritten line above the headline ("Accept and", "24/7"), per locale. */
  kicker?: Record<Locale, string>;
  /** Overrides the theme background for this scene. */
  background?: string;
  /**
   * An image cover-fitted over this tile's background, under everything else,
   * relative to the config. Overrides theme.backgroundImage; "none" clears it.
   */
  backgroundImage?: string;
  /** Overrides theme.layout for this scene; a key from src/layouts.ts. */
  layout?: LayoutKey;
  /** Aligns this scene's copy left, centre or right, overriding its layout's alignment. */
  align?: CopyAlign;
  /**
   * Id of another screenshot scene whose capture fills the second device in
   * the duo and panorama-duo layouts. Defaults to the next scene.
   */
  secondScene?: string;
  /** Badge and image layers drawn over the background, under the device, in addition to theme.decorations. */
  decorations?: Decoration[];
};

/**
 * A layer on a tile. `back` layers (the default for badges, images, bubbles
 * and ratings) sit over the background and copy, under the device; `front`
 * layers sit over the device, which is how art breaks the frame: a mascot
 * leaning on the phone, a card lifted out of the screen. Callouts default to
 * `front`.
 *
 * Every placed layer takes `x`/`y` (its left and top) and `width` as fractions
 * of one tile; a panorama's second tile starts at x = 1.
 */
export type Decoration =
  | {
      kind: "badge";
      text: Record<Locale, string>;
      position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
      /** Pill fill and text color; default to the headline color on a translucent white. */
      background?: string;
      color?: string;
      layer?: DecorationLayer;
    }
  | {
      kind: "image";
      /** PNG relative to the config file. */
      src: string;
      /** Left and top as fractions of the tile width and height. */
      x: number;
      y: number;
      /** Width as a fraction of the tile width; the height keeps the image's aspect. */
      width: number;
      /** Degrees, clockwise, around the image centre. */
      rotate?: number;
      /** Mirror horizontally, so one character art can face either way. */
      flip?: boolean;
      /** 0 to 1. */
      opacity?: number;
      /** A soft drop shadow under the art. */
      shadow?: boolean;
      layer?: DecorationLayer;
    }
  | {
      /**
       * A piece of the real screen, lifted out of the phone: a region of the
       * capture, enlarged, with rounded corners and a shadow. The most
       * effective way to point at one feature without a fake UI.
       */
      kind: "callout";
      /** Which device's capture to cut from; the scene's own by default. */
      capture?: "primary" | "secondary";
      /** The region as fractions of the capture's width and height. */
      from: { x: number; y: number; width: number; height: number };
      x: number;
      y: number;
      /** Width as a fraction of the tile width; the height keeps the region's aspect. */
      width: number;
      rotate?: number;
      /** Corner radius as a fraction of the tile width. Default 0.03. */
      radius?: number;
      /** Default true. */
      shadow?: boolean;
      /** A border color drawn around the card. */
      border?: string;
      layer?: DecorationLayer;
    }
  | {
      /** A speech bubble: the user's problem in their own words, or the mascot talking. */
      kind: "bubble";
      text: Record<Locale, string>;
      x: number;
      y: number;
      /** Maximum width as a fraction of the tile width; the bubble shrinks to its text. */
      width: number;
      /** Where the tail points from. Default "bottom-left". */
      tail?: "bottom-left" | "bottom-right" | "top-left" | "top-right" | "none";
      /** Default white fill, headline-colored text. */
      background?: string;
      color?: string;
      /** "script" uses theme.scriptFontFamily, "sans" the headline font. Default "sans". */
      font?: "sans" | "script";
      /** Type size as a fraction of the tile width. Default 0.045. */
      size?: number;
      rotate?: number;
      layer?: DecorationLayer;
    }
  | {
      /** Social proof: stars, a score and a line of text inside laurels. */
      kind: "rating";
      /** The big number, e.g. "4.8". */
      value: string;
      /** A line under the stars, e.g. "200k+ happy users", per locale. */
      label?: Record<Locale, string>;
      x: number;
      y: number;
      width: number;
      /** Stars and text color; the headline color by default. */
      color?: string;
      /** Default true. */
      laurels?: boolean;
      /** A rounded plate behind it, for legibility over art or UI. */
      background?: string;
      layer?: DecorationLayer;
    };

export type DecorationLayer = "back" | "front";

/** How a headline's *stressed* words stand out. */
export const EMPHASIS_STYLES = ["color", "highlight", "underline", "circle", "script"] as const;
export type EmphasisStyle = (typeof EMPHASIS_STYLES)[number];

/** Headline type beyond font and color. */
export type HeadlineStyle = {
  /** Multiplies the layout's headline size. 1.3 or more for poster-like tiles. Default 1. */
  scale?: number;
  /** CSS font weight. Default 700. */
  weight?: number;
  /** Set the headline in capitals. */
  uppercase?: boolean;
  /** An outline drawn behind the fill; width as a fraction of the tile width (0.006 is bold). */
  stroke?: { color: string; width: number };
  /** A drop shadow; blur and offsetY as fractions of the tile width. */
  shadow?: { color: string; blur: number; offsetY: number };
};

/**
 * The app preview video, built from short segments.
 *
 * Apple requires a preview to be a plain recording of the device screen, so
 * the segments are joined as captured: no bezel, background or captions.
 * Each segment is its own flow recorded into its own clip, which keeps a
 * single broken step from forcing a re-record of the whole story.
 */
export type PreviewScene = {
  kind: "preview";
  id: string;
  segments: Array<{
    id: string;
    /** Flow in the app's `.argent/flows`, same forms as a screenshot scene's. */
    flow: string;
    /** Hold the last frame this long after the flow ends, in seconds. */
    holdSeconds?: number;
    /**
     * A caption shown over this segment, per locale. App Review Guideline
     * 2.3.4 allows text overlays that explain the footage; the footage itself
     * stays a plain screen recording.
     */
    caption?: Record<Locale, string>;
  }>;
  /** Optional audio bed relative to the config file. A silent AAC track is written when absent. */
  audio?: string;
  /** Where segment captions sit. Default "bottom", clear of the navigation bar. */
  captionPosition?: "top" | "bottom";
};

/**
 * AI art for the tiles: backgrounds, mascots, 3D objects and stickers,
 * generated once by `goldie art` into files next to the config and then used
 * like any other image (theme.backgroundImage, theme.backdrop, image
 * decorations). The real app screen is never generated: art surrounds the
 * capture, it does not replace it.
 */
export type ArtConfig = {
  /** Which image API to call. Keys come from OPENAI_API_KEY / FAL_KEY or a .env next to the config. */
  provider: "openai" | "fal";
  /** Overrides the provider's default image model. */
  model?: string;
  /** Overrides the provider's default draft model (concept boards, `--draft`). */
  draftModel?: string;
  /** A style preset key from src/art/styles.ts, or a free-text art direction. */
  style: string;
  /** Brand colors woven into every prompt, as hex. */
  palette?: string[];
  /** Brand images every generation sees as references (mascot, logo, product), relative to the config. */
  references?: string[];
  /** Where generated files go, relative to the config. Default "art". */
  dir?: string;
  /** Refuse a run whose estimated cost exceeds this many US dollars. Default 5. */
  budgetUsd?: number;
  assets: ArtAsset[];
};

export type ArtAsset = {
  /** File stem: `art/<id>.png`. */
  id: string;
  /**
   * `background` and `scene` are opaque and fill a tile (`strip` aspect for a
   * backdrop); `character`, `object` and `sticker` come out as transparent
   * PNGs ready to overlap the device.
   */
  kind: "background" | "scene" | "character" | "object" | "sticker";
  /** What to draw. The style, palette and kind add the rest of the prompt. */
  prompt: string;
  /** Default: portrait for opaque kinds, square for transparent ones. "strip" is a very wide backdrop. */
  aspect?: "portrait" | "square" | "landscape" | "strip";
  /** More reference images for this asset only, relative to the config. */
  references?: string[];
  /**
   * Turn the still into a short video clip (fal image-to-video) for the promo
   * video: `art/<id>.mp4`.
   */
  animate?: { prompt: string; seconds?: number; model?: string };
};

/**
 * The social promo video (`goldie promo`): the designed tiles brought to life
 * with kinetic headlines, devices sliding in and callouts popping, for
 * TikTok, Reels, X, YouTube or the Play Store's promo link. Unlike the App
 * Store preview it is marketing, so anything goes.
 */
export type PromoConfig = {
  /** Output aspect ratios. Default ["9:16"]. */
  formats?: Array<"9:16" | "4:5" | "1:1">;
  /** Screenshot scene ids in play order. Default: every screenshot scene. */
  scenes?: string[];
  /** Seconds each scene holds, including its entrance. Default 3. */
  secondsPerScene?: number;
  /** A full-screen video (e.g. an animated art clip) played first, relative to the config. */
  intro?: string;
  /** The closing card. */
  outro?: {
    headline: Record<Locale, string>;
    /** A call to action under it, e.g. "Download on the App Store". */
    cta?: Record<Locale, string>;
    /** App icon PNG relative to the config. */
    icon?: string;
    seconds?: number;
  };
  /** A music file relative to the config. Takes precedence over `music`. */
  audio?: string;
  /** Generate a music bed (fal) when no `audio` is given; cached in the art dir. */
  music?: { prompt: string; model?: string };
};

export type Scene = ScreenshotScene | PreviewScene;

export type Theme = {
  background: string;
  headlineColor: string;
  subheadColor: string;
  fontFamily: string;
  /**
   * Extra typefaces to register alongside the bundled ones, so `fontFamily` can
   * name a face this machine does not have installed - a brand font, or a script
   * the bundled families do not cover (they are latin plus one CJK fallback, so
   * arabic, hebrew, thai and the rest export as tofu without this).
   *
   * Paths are relative to the config file, like every other path in it.
   */
  fontFiles?: CustomFont[];
  /** Fraction of the screenshot height reserved for copy above the device. */
  copyHeightRatio: number;
  /** Fraction of the screenshot width the device bezel occupies. */
  deviceWidthRatio: number;
  /**
   * The strip's rhythm: a built-in template key from src/layouts.ts, or a
   * custom sequence of layout keys applied to the scenes in order (repeating
   * when shorter). Scenes with their own `layout` are left alone.
   */
  template?: TemplateChoice;
  /** Layout for scenes the template does not cover; a key from src/layouts.ts. Defaults to "classic". */
  layout?: LayoutKey;
  /** Drop the bezel and show the bare screen with a soft shadow. */
  screenOnly?: boolean;
  /** Decoration layers added to every screenshot scene. */
  decorations?: Decoration[];
  /** Color of *stressed* headline words, their marks, and kickers. Defaults to headlineColor. */
  accentColor?: string;
  /** How *stressed* headline words stand out. Default "color". */
  emphasis?: EmphasisStyle;
  /** Font stack for kickers, script emphasis and script bubbles. Defaults to the bundled Caveat. */
  scriptFontFamily?: string;
  /** Headline size, weight, case, outline and shadow. */
  headline?: HeadlineStyle;
  /**
   * An image cover-fitted over every tile's background, relative to the
   * config, typically AI-generated art (`goldie art`).
   */
  backgroundImage?: string;
  /**
   * One wide image laid across the whole strip, each tile showing its slice,
   * so the store page reads as one continuous world. Drawn over the
   * background and any backgroundImage.
   */
  backdrop?: string;
  /**
   * A gradient from `color` at the top edge to transparent at `height` (a
   * fraction of the tile), drawn over background images and under the copy,
   * so light copy stays legible over a bright photo. Only tiles with a
   * background image or backdrop get it.
   */
  scrim?: { color: string; height: number };
};

/**
 * How the app presents itself on the App Store. Used by the studio to
 * render a realistic product page around the generated assets - it is the
 * surrounding chrome that tells you whether a headline still reads at
 * gallery size.
 */
export type StoreListing = {
  name: string;
  subtitle: Record<Locale, string>;
  developer: string;
  category: string;
  /** Shown in the ratings row; purely cosmetic. */
  rating: number;
  ratingCount: string;
  ageRating: string;
  price: string;
  description: Record<Locale, string>;
};

export type GoldieConfig = {
  /** Absolute path to the app repo. Holds `.argent/flows`; also used for messages and for locating the build. */
  appRoot: string;
  /**
   * Where the scene flows live. Defaults to `.argent/flows` inside `appRoot`,
   * so goldie and argent share one flow store: anything recorded with
   * `argent flow record` is replayable here by name, and vice versa. An
   * absolute path or a path relative to the config file overrides it.
   */
  flowsDir?: string;
  /** Simulator .app bundle to install. */
  appPath: string;
  bundleId: string;
  /** The .apk to install and its applicationId. Required when `devices` names an android key. */
  android?: {
    appPath: string;
    applicationId: string;
    /**
     * Bezel art for the android device, replacing the bundled Pixel 10 Pro
     * art, with its own geometry: the image (relative to the config), its
     * pixel size, the transparent screen cutout inside it, and the cutout's
     * corner radius. Android SDK emulator skins
     * (`$ANDROID_HOME/skins/<device>/`) carry exactly this: `back.webp` is the
     * frame and the `layout` file states the display rect and corner_radius;
     * punch the display rect transparent and point this at the result.
     */
    frame?: {
      image: string;
      width: number;
      height: number;
      screen: { x: number; y: number; width: number; height: number };
      screenRadius: number;
    };
  };
  devices: DeviceKey[];
  locales: Locale[];
  /**
   * Capture each locale in its own language. By default `capture` replays the
   * flows once, with the simulator pinned to the first locale, and every
   * locale renders those captures - fine when only the copy is translated.
   * With this on, iOS devices replay the flows once per locale, pinned to it,
   * into out/raw/<device>/<locale>/, and each locale renders its own captures,
   * so the app on screen speaks the headline's language. Android emulators are
   * not locale-pinned, so they keep one shared capture.
   */
  localizedCaptures?: boolean;
  /** Simulator appearance for every capture. */
  appearance: "light" | "dark";
  /**
   * Keep the installed app and its data instead of reinstalling before a
   * capture. For apps that need a signed-in session (or a dev client already
   * pointed at Metro) that a flow cannot recreate: sign in once on the
   * simulator, then capture. The app must already be installed; flows then
   * start from whatever state it was left in, so they must not assume a fresh
   * install. iOS devices only; android always reinstalls.
   */
  keepAppData?: boolean;
  /**
   * Device bezel art for the screenshots: one bundled variant from assets/,
   * which applies to the device it is drawn for while the others keep their
   * default, or one per device key, or a custom PNG with a transparent screen
   * cutout relative to the config file. Custom art means re-measuring the
   * geometry in src/frame.ts.
   */
  frame: { variant: FrameVariant | Partial<Record<DeviceKey, FrameVariant>> } | { image: string };
  theme: Theme;
  store: StoreListing;
  scenes: Scene[];
  /** AI-generated art layers; see `goldie art`. */
  art?: ArtConfig;
  /** The social promo video; see `goldie promo`. */
  promo?: PromoConfig;
};

export type LoadedConfig = GoldieConfig & {
  /** Directory the config file lives in; every relative path resolves against it. */
  root: string;
  /** Absolute path of the config file itself. */
  configPath: string;
  /** Absolute directory the scene flows resolve against. */
  flowsDir: string;
  outDir: string;
  /**
   * The studio's per-scene layout overrides (goldie.design.json). Kept apart
   * from the scenes so the manifest reports only the config's own layouts;
   * baked into `scene.layout` they would outrank every later template choice.
   */
  sceneLayouts?: Record<string, LayoutKey>;
  /** The studio editor's per-scene moves (goldie.design.json), applied after compose(). */
  sceneTransforms?: Record<string, SceneTransform>;
};

/**
 * Default config path: the GOLDIE_CONFIG env var when set, else
 * ./goldie.config.ts. The env var lets a config live in the app's own repo
 * while goldie and its studio run from this checkout.
 */
export function defaultConfigPath(): string {
  return process.env.GOLDIE_CONFIG
    ? resolve(process.env.GOLDIE_CONFIG)
    : resolve(process.cwd(), "goldie.config.ts");
}

/**
 * The config is TypeScript. Bun and Node >= 22.18 import it natively; older
 * Node lacks type stripping, so fall back to jiti, which transpiles on the fly.
 */
async function importConfig(path: string): Promise<any> {
  try {
    return await import(pathToFileURL(path).href);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (
      code !== "ERR_UNKNOWN_FILE_EXTENSION" &&
      code !== "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING"
    )
      throw err;
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import(path);
  }
}

export async function loadConfig(path = defaultConfigPath()): Promise<LoadedConfig> {
  if (!existsSync(path)) throw new Error(`No config at ${path}`);
  const mod = await importConfig(path);
  const cfg: GoldieConfig = mod.default ?? mod.config;
  if (!cfg) throw new Error(`${path} has no default export`);
  const root = dirname(path);
  const loaded: LoadedConfig = {
    ...cfg,
    root,
    configPath: path,
    flowsDir: cfg.flowsDir ? resolve(root, cfg.flowsDir) : resolve(cfg.appRoot, ".argent/flows"),
    outDir: resolve(root, "out"),
  };
  for (const key of loaded.devices) {
    if (!isDeviceKey(key)) {
      throw new Error(`Unknown device "${key}". Available: ${DEVICE_KEYS.join(", ")}`);
    }
  }
  resolveFontFiles(loaded); // config-relative font paths -> absolute, once
  applyDesign(loaded, readDesign(path));
  // Fail at load time on a bad variant or missing bezel PNG; android devices
  // never load one from cfg.frame (drawn generic bezel or cfg.android.frame).
  for (const d of loaded.devices) if (DEVICES[d].platform !== "android") framePath(loaded, d);
  validateLayouts(loaded);
  validateDesignLayers(loaded);
  validateArt(loaded);
  return loaded;
}

const DECORATION_KINDS = ["badge", "image", "callout", "bubble", "rating"] as const;

/**
 * Fails at load time on a misspelt emphasis style or decoration, a callout
 * region outside its capture, or an art path that does not exist, rather than
 * as a blank layer in the export.
 */
export function validateDesignLayers(cfg: LoadedConfig): void {
  const t = cfg.theme;
  if (t.emphasis && !(EMPHASIS_STYLES as readonly string[]).includes(t.emphasis)) {
    throw new Error(
      `Unknown theme.emphasis "${t.emphasis}". Available: ${EMPHASIS_STYLES.join(", ")}`,
    );
  }
  const exists = (where: string, src: string | undefined) => {
    if (!src || src === "none") return;
    if (!existsSync(resolve(cfg.root, src))) {
      throw new Error(
        `${where}: no image at ${resolve(cfg.root, src)}. Generated art? Run: goldie art`,
      );
    }
  };
  exists("theme.backgroundImage", t.backgroundImage);
  exists("theme.backdrop", t.backdrop);
  const check = (where: string, list: Decoration[] | undefined) => {
    for (const [i, d] of (list ?? []).entries()) {
      const at = `${where}[${i}]`;
      if (!(DECORATION_KINDS as readonly string[]).includes(d.kind)) {
        throw new Error(
          `${at}: unknown decoration kind "${(d as { kind: string }).kind}". Available: ${DECORATION_KINDS.join(", ")}`,
        );
      }
      if (d.layer && d.layer !== "back" && d.layer !== "front") {
        throw new Error(`${at}: layer must be "back" or "front".`);
      }
      if (d.kind === "image") exists(at, d.src);
      if (d.kind === "callout") {
        const { x, y, width, height } = d.from;
        const inside = [x, y, width, height].every((v) => v >= 0 && v <= 1);
        if (!inside || width <= 0 || height <= 0 || x + width > 1.0001 || y + height > 1.0001) {
          throw new Error(
            `${at}: callout "from" must be a region inside the capture, as fractions 0-1.`,
          );
        }
      }
    }
  };
  check("theme.decorations", t.decorations);
  for (const scene of cfg.scenes) {
    if (!isScreenshot(scene)) continue;
    check(`scene "${scene.id}" decorations`, scene.decorations);
    exists(`scene "${scene.id}" backgroundImage`, scene.backgroundImage);
  }
}

/**
 * Rewrites `theme.fontFiles` paths to absolute, resolved against the config's
 * directory, and fails here rather than at draw time on a missing file - a font
 * that never registers shows up as tofu in the export, which nothing else
 * catches.
 */
function resolveFontFiles(cfg: LoadedConfig): void {
  const fonts = cfg.theme.fontFiles;
  if (!fonts) return;
  cfg.theme.fontFiles = fonts.map((font) => {
    const files: Record<number, string> = {};
    for (const [weight, file] of Object.entries(font.files)) {
      const abs = resolve(cfg.root, file);
      if (!existsSync(abs)) {
        throw new Error(
          `theme.fontFiles: no font file at ${abs} (for "${font.family}" weight ${weight}).`,
        );
      }
      files[Number(weight)] = abs;
    }
    return { ...font, files };
  });
}

/**
 * Design choices made in the studio, kept next to the config as
 * goldie.design.json so they survive a reload and apply to CLI runs too.
 * Every field is optional; a missing one leaves the config's value alone.
 */
export type DesignOverrides = {
  background?: string;
  frame?: FrameVariant;
  /** A variant per device key, as the studio's frame picker saves them. */
  frames?: Partial<Record<DeviceKey, FrameVariant>>;
  /** A full CSS font stack, as the studio's font picker produces. */
  fontFamily?: string;
  /** Copy edited in the studio, per screenshot scene id, then locale. */
  copy?: Record<string, SceneCopy>;
  /** Screenshot scene ids in the order the studio arranged them. */
  order?: string[];
  /** A built-in template key; "" means none (the layout below applies to every scene). */
  template?: string;
  /** Default layout for scenes the template does not cover. */
  layout?: LayoutKey;
  screenOnly?: boolean;
  /** Layout overrides per screenshot scene id. */
  sceneLayouts?: Record<string, LayoutKey>;
  /**
   * Decorations edited in the studio, per screenshot scene id. Once the editor
   * touches a scene, its list here replaces the config's `scenes[].decorations`
   * (theme decorations still apply). Image `src` paths are relative to the config.
   */
  sceneDecorations?: Record<string, Decoration[]>;
  /** The editor's moves of each scene's copy block and devices, per screenshot scene id. */
  sceneTransforms?: Record<string, SceneTransform>;
  /** AI art choices made in the studio's settings; each overrides the config's `art` field. */
  art?: { provider?: "openai" | "fal"; model?: string; draftModel?: string; style?: string };
};

export type SceneCopy = {
  headline?: Record<string, string>;
  subhead?: Record<string, string>;
  kicker?: Record<string, string>;
};

/** Path of the design sidecar for a config file. */
export function designPath(configPath: string): string {
  return resolve(dirname(configPath), "goldie.design.json");
}

export function readDesign(configPath: string): DesignOverrides {
  const file = designPath(configPath);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as DesignOverrides) : {};
  } catch (err) {
    throw new Error(`Unreadable ${file}: ${err instanceof Error ? err.message : err}`);
  }
}

/** Layers design overrides (the sidecar, or CLI flags) onto a loaded config. */
export function applyDesign(cfg: LoadedConfig, design: DesignOverrides): void {
  if (design.background) {
    cfg.theme.background = design.background;
    for (const scene of cfg.scenes) if (isScreenshot(scene)) scene.background = undefined;
    // The config's copy colors assume its own background; a dark override
    // would render near-black headlines on a near-black gradient, and a
    // light override under light copy colors is just as unreadable.
    const lum = backgroundLuminance(design.background);
    if (lum !== null && lum < 0.5) {
      cfg.theme.headlineColor = "#FFFFFF";
      cfg.theme.subheadColor = "#D9E1EA";
    } else if (lum !== null) {
      if ((backgroundLuminance(cfg.theme.headlineColor) ?? 0) > 0.5) {
        cfg.theme.headlineColor = "#0E1B2A";
      }
      if ((backgroundLuminance(cfg.theme.subheadColor) ?? 0) > 0.5) {
        cfg.theme.subheadColor = "#5A6A7D";
      }
    }
  }
  const frames: Partial<Record<DeviceKey, FrameVariant>> = { ...design.frames };
  if (design.frame) {
    if (!isFrameVariant(design.frame)) {
      throw new Error(
        `Unknown frame variant "${design.frame}". Available: ${FRAME_VARIANTS.join(", ")}`,
      );
    }
    frames[VARIANT_DEVICE[design.frame]] = design.frame;
  }
  if (Object.keys(frames).length > 0) {
    cfg.frame = { variant: { ...configVariants(cfg), ...frames } };
    for (const d of cfg.devices) if (DEVICES[d].platform !== "android") framePath(cfg, d); // throws on an unknown variant
  }
  if (design.fontFamily) cfg.theme.fontFamily = design.fontFamily;
  if (design.copy) {
    for (const scene of cfg.scenes) {
      const copy = design.copy[scene.id];
      if (!isScreenshot(scene) || !copy) continue;
      if (copy.headline) scene.headline = { ...scene.headline, ...copy.headline };
      if (copy.subhead) scene.subhead = { ...scene.subhead, ...copy.subhead };
      if (copy.kicker) scene.kicker = { ...scene.kicker, ...copy.kicker };
    }
  }
  if (design.order) cfg.scenes = reorderScenes(cfg.scenes, design.order);
  if (design.template !== undefined) {
    cfg.theme.template = design.template ? checkedTemplate(design.template) : undefined;
  }
  if (design.layout) cfg.theme.layout = checkedLayout(design.layout);
  if (design.screenOnly !== undefined) cfg.theme.screenOnly = design.screenOnly;
  if (design.sceneLayouts) {
    const overrides: Record<string, LayoutKey> = {};
    for (const scene of cfg.scenes) {
      const key = design.sceneLayouts[scene.id];
      if (isScreenshot(scene) && key) overrides[scene.id] = checkedLayout(key);
    }
    cfg.sceneLayouts = { ...cfg.sceneLayouts, ...overrides };
  }
  if (design.sceneDecorations) {
    for (const scene of cfg.scenes) {
      const list = design.sceneDecorations[scene.id];
      if (isScreenshot(scene) && list) scene.decorations = list;
    }
  }
  if (design.sceneTransforms) {
    cfg.sceneTransforms = { ...cfg.sceneTransforms, ...design.sceneTransforms };
  }
  if (design.art && cfg.art) {
    const { provider, model, draftModel, style } = design.art;
    cfg.art = {
      ...cfg.art,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(draftModel ? { draftModel } : {}),
      ...(style ? { style } : {}),
    };
  }
}

function checkedLayout(key: string): LayoutKey {
  if (!isLayoutKey(key)) {
    throw new Error(`Unknown layout "${key}". Available: ${LAYOUT_KEYS.join(", ")}`);
  }
  return key;
}

function checkedTemplate(key: string): TemplateChoice {
  if (!isTemplateKey(key)) {
    throw new Error(`Unknown template "${key}". Available: ${TEMPLATE_KEYS.join(", ")}`);
  }
  return key;
}

/** Every screenshot scene with the layout and second capture it renders with, in strip order. */
export function resolvedScenes(cfg: LoadedConfig) {
  return resolveScenes(cfg.scenes.filter(isScreenshot), {
    template: cfg.theme.template,
    layout: cfg.theme.layout,
    sceneLayouts: cfg.sceneLayouts,
  });
}

/**
 * Fails early on a layout or template key the config misspelt, or a
 * two-device layout whose scene has no usable second capture.
 */
export function validateLayouts(cfg: LoadedConfig): void {
  if (cfg.theme.layout) checkedLayout(cfg.theme.layout);
  const template = cfg.theme.template;
  if (Array.isArray(template)) for (const key of template) checkedLayout(key);
  else if (template) checkedTemplate(template);
  const shots = cfg.scenes.filter(isScreenshot);
  for (const { scene, layout, secondScene } of resolvedScenes(cfg)) {
    if (scene.layout) checkedLayout(scene.layout);
    if (!needsSecondCapture(layout)) continue;
    if (!secondScene) {
      throw new Error(
        `Scene "${scene.id}" uses the "${layout.key}" layout, which shows two screens, but there is no other scene to borrow from.`,
      );
    }
    if (secondScene === scene.id || !shots.some((s) => s.id === secondScene)) {
      throw new Error(
        `Scene "${scene.id}": secondScene "${secondScene}" is not another screenshot scene.`,
      );
    }
  }
}

/**
 * The locales a command runs for: all of the config's, or the one --locale
 * asks for. A locale names output and capture directories, so a value outside
 * the config (a typo, or a path like "../x") is rejected rather than joined
 * into a path that could point anywhere on disk.
 */
export function selectLocales(locales: string[], requested?: string): string[] {
  if (requested === undefined) return locales;
  if (!locales.includes(requested)) {
    throw new Error(`Unknown locale "${requested}". Configured: ${locales.join(", ")}`);
  }
  return [requested];
}

/**
 * Puts the screenshot scenes in the saved order. Ids missing from the order
 * (scenes added to the config since) keep their config position relative to
 * each other and follow the ordered ones; unknown ids are ignored. Other
 * scenes (the preview) stay where they are.
 */
export function reorderScenes(scenes: Scene[], order: string[]): Scene[] {
  const shots = scenes.filter(isScreenshot);
  const rank = new Map(order.map((id, i) => [id, i]));
  const sorted = [...shots].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.POSITIVE_INFINITY;
    const rb = rank.get(b.id) ?? Number.POSITIVE_INFINITY;
    return ra === rb ? shots.indexOf(a) - shots.indexOf(b) : ra - rb;
  });
  let i = 0;
  return scenes.map((s) => (isScreenshot(s) ? sorted[i++]! : s));
}

/**
 * Mean relative luminance of the value's six-digit hex colors, or null when
 * it has none (keep the config's copy colors then).
 */
export function backgroundLuminance(css: string): number | null {
  const hexes = css.match(/#[0-9a-fA-F]{6}/g);
  if (!hexes || hexes.length === 0) return null;
  const luminance = (hex: string) => {
    const channel = (offset: number) => {
      const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  return hexes.reduce((sum, hex) => sum + luminance(hex), 0) / hexes.length;
}

const GOLDIE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Absolute path to a bundled bezel variant's PNG. */
export function variantFramePath(variant: FrameVariant): string {
  return resolve(GOLDIE_ROOT, "assets", `${variant}.png`);
}

/** The config's bundled variants by device; empty for custom art. */
function configVariants(cfg: LoadedConfig): Partial<Record<DeviceKey, FrameVariant>> {
  if (!("variant" in cfg.frame)) return {};
  const v = cfg.frame.variant;
  if (typeof v !== "string") return { ...v };
  if (!isFrameVariant(v)) {
    throw new Error(`Unknown frame variant "${v}". Available: ${FRAME_VARIANTS.join(", ")}`);
  }
  return { [VARIANT_DEVICE[v]]: v };
}

/** The variant a device renders with; null when the config points at custom art. */
export function frameVariantFor(cfg: LoadedConfig, device: DeviceKey): FrameVariant | null {
  if (!("variant" in cfg.frame)) return null;
  const chosen = configVariants(cfg)[device];
  if (chosen !== undefined) {
    if (!isFrameVariant(chosen)) {
      throw new Error(`Unknown frame variant "${chosen}". Available: ${FRAME_VARIANTS.join(", ")}`);
    }
    if (VARIANT_DEVICE[chosen] !== device) {
      throw new Error(
        `Frame variant "${chosen}" is drawn for ${VARIANT_DEVICE[chosen]}, not ${device}.`,
      );
    }
    return chosen;
  }
  return deviceVariants(device)[0]!;
}

/** Absolute path to the bezel PNG the config selects for a device. */
export function framePath(cfg: LoadedConfig, device: DeviceKey = "iphone-6.9"): string {
  const variant = frameVariantFor(cfg, device);
  const file = variant
    ? variantFramePath(variant)
    : resolve(cfg.root, (cfg.frame as { image: string }).image);
  if (!existsSync(file)) {
    throw new Error(`Frame image not found: ${file}`);
  }
  return file;
}

/**
 * Bezel art a device renders with: the config's `frame` on iOS, and on
 * android the bundled Pixel 10 Pro art unless the config supplies its own
 * `android.frame`. The geometry travels with the image, since the android art
 * has a different image box and cutout than the iOS variants.
 */
export function deviceFrame(
  cfg: LoadedConfig,
  deviceKey: DeviceKey,
): { image: string; geom: FrameGeometry } {
  if (DEVICES[deviceKey].platform !== "android")
    return { image: framePath(cfg, deviceKey), geom: FRAMES[deviceKey] };
  const custom = cfg.android?.frame;
  if (custom) {
    const image = resolve(cfg.root, custom.image);
    if (!existsSync(image)) throw new Error(`Frame image not found: ${image}`);
    return { image, geom: custom };
  }
  return { image: resolve(GOLDIE_ROOT, "assets", ANDROID_FRAME.file), geom: ANDROID_FRAME.geom };
}

/**
 * Absolute path to a scene's flow YAML. A name or a relative path resolves
 * against `flowsDir`; `.yaml` is added when the value has no extension.
 */
export function flowPath(cfg: LoadedConfig, flow: string): string {
  const file = flow.endsWith(".yaml") || flow.endsWith(".yml") ? flow : `${flow}.yaml`;
  return resolve(cfg.flowsDir, file);
}

export const isPreview = (s: Scene): s is PreviewScene => s.kind === "preview";
export const isScreenshot = (s: Scene): s is ScreenshotScene => s.kind === "screenshot";
