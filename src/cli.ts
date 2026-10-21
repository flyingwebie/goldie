#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runConcepts } from "./art/concepts.ts";
import { ART_STYLE_KEYS, ensureMusic, runArt } from "./art/index.ts";
import { capture, captureLocales } from "./capture.ts";
import { renderConceptBoards } from "./concepts.ts";
import {
  applyDesign,
  FRAME_VARIANTS,
  type FrameVariant,
  isFrameVariant,
  type LoadedConfig,
  loadConfig,
  selectLocales,
  VARIANT_DEVICE,
  validateLayouts,
} from "./config.ts";
import * as device from "./device.ts";
import { runDiscover } from "./discover.ts";
import { doctor } from "./doctor.ts";
import { FONT_KEYS, fontStack } from "./fonts.ts";
import { LAYOUT_KEYS, type LayoutKey, TEMPLATE_KEYS } from "./layouts.ts";
import { writeManifest } from "./manifest.ts";
import { type PromoFormat, renderPromo } from "./promo.ts";
import { renderPreview, renderScreenshots, verify } from "./render.ts";
import { FlowFailure, repairBrief } from "./repair.ts";
import { DEVICE_KEYS, type DeviceKey, isDeviceKey } from "./specs.ts";
import { openInBrowser, serveStudio, studioPaths } from "./studio-server.ts";

const USAGE = `
goldie - App Store screenshots and previews, driven by argent

  goldie doctor     Check the toolchain, simulators, flags and flows
  goldie capture    Replay every scene flow and save raw captures
  goldie frame      Composite raw screenshots into framed, captioned PNGs
  goldie preview    Join the raw clips into the preview video (App Store upload; YouTube for Play)
  goldie verify     Check finished assets against the store spec tables
  goldie manifest   Write out/store.json for the studio app
  goldie studio     Serve the studio at http://localhost:4321 (--port <n>, --no-open)
  goldie all        capture -> frame -> preview -> manifest -> verify

Emotional screenshots
  goldie art        Generate the config's AI art layers (cached; --only <ids>, --force, --draft, --dry-run, --yes)
  goldie concepts   Draft the art in several styles and render comparison boards (--styles a,b,c)
  goldie promo      Render the social promo video with HyperFrames (--format 9:16,4:5,1:1; default the config's; --render-only to skip regenerating the composition)
  goldie discover   Scan the app for screens into goldie/discovery.json (--root <dir> to run without a config; --fresh to discard agent-written features)
  goldie version    Print the installed goldie version (-v, --version)

Options
  --config <path>   Config file (default ./goldie.config.ts)
  --device <key>    Only this device key (${DEVICE_KEYS.join(" | ")}; default: every device in the config)
  --locale <code>   Only this locale (default: every locale in the config)
  --background <css>  Override theme.background for this run (also clears per-scene backgrounds); "transparent" keeps alpha
  --frame <variant>   Override the bezel variant of its device for this run, repeatable (${FRAME_VARIANTS.join(" | ")})
  --font <key>        Override theme.fontFamily for this run (system | ${FONT_KEYS.join(" | ")} | a theme.fontFiles family)
  --template <key>    Override theme.template for this run (${TEMPLATE_KEYS.join(" | ")}; "none" for one layout)
  --layout <key>      Override theme.layout for this run (${LAYOUT_KEYS.join(" | ")})
  --screen-only       Render bare screens with no bezel for this run
`;

const list = (v: string | undefined) =>
  v
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const opt = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };

  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return 0;
  }

  if (command === "version" || command === "-v" || command === "--version") {
    console.log(packageVersion());
    return 0;
  }

  // Runs without a config - --root stands in for appRoot, so a repo with no
  // goldie.config.ts yet can still be scanned.
  if (command === "discover" && opt("root")) {
    await runDiscoverCommand(resolve(process.cwd(), opt("root")!), argv);
    return 0;
  }

  const cfg = await loadConfig(opt("config") ? resolve(process.cwd(), opt("config")!) : undefined);

  // One-run overrides on top of the config and goldie.design.json (the
  // studio's saved choices). Copy a value into the config to keep it.
  const font = opt("font");
  const frames: Partial<Record<DeviceKey, FrameVariant>> = {};
  argv.forEach((arg, i) => {
    const variant = argv[i + 1];
    if (arg !== "--frame" || variant === undefined) return;
    if (!isFrameVariant(variant)) {
      throw new Error(
        `Unknown frame variant "${variant}". Available: ${FRAME_VARIANTS.join(", ")}`,
      );
    }
    frames[VARIANT_DEVICE[variant]] = variant;
  });
  applyDesign(cfg, {
    background: opt("background"),
    frames,
    fontFamily: font ? fontStack(font, cfg.theme.fontFiles) : undefined, // throws on an unknown key
    template: opt("template") === "none" ? "" : opt("template"),
    layout: opt("layout") as LayoutKey | undefined,
    screenOnly: argv.includes("--screen-only") ? true : undefined,
  });
  validateLayouts(cfg);

  const only = opt("device");
  if (only !== undefined && !isDeviceKey(only)) {
    throw new Error(`Unknown device "${only}". Available: ${DEVICE_KEYS.join(", ")}`);
  }
  const devices = only ? [only] : cfg.devices;
  const locales = selectLocales(cfg.locales, opt("locale"));

  switch (command) {
    case "doctor":
      return (await doctor(cfg)) ? 0 : 1;

    case "capture":
      await runCapture(cfg, devices, locales);
      return 0;

    case "frame":
      for (const d of devices) for (const l of locales) await renderScreenshots(cfg, d, l);
      return 0;

    case "preview":
      for (const d of devices) for (const l of locales) await renderPreview(cfg, d, l);
      return 0;

    case "verify":
      return (await verifyAll(cfg, devices, locales)) ? 0 : 1;

    case "manifest":
      console.log(await writeManifest(cfg));
      return 0;

    case "studio": {
      await writeManifest(cfg);
      const url = await serveStudio(
        {
          paths: studioPaths(cfg.configPath),
          cli: [process.execPath, fileURLToPath(import.meta.url)],
        },
        opt("port") ? Number(opt("port")) : 4321,
      );
      console.log(`studio  ${url}`);
      if (!argv.includes("--no-open")) await openInBrowser(url);
      return new Promise<number>(() => {}); // serve until killed
    }

    case "art": {
      const results = await runArt(cfg, {
        only: list(opt("only")),
        force: argv.includes("--force"),
        draft: argv.includes("--draft"),
        dryRun: argv.includes("--dry-run"),
        yes: argv.includes("--yes"),
        log: (line) => console.log(line),
      });
      const spent = results.filter((r) => r.status === "generated");
      const usd = spent.reduce((sum, r) => sum + r.estimatedUsd, 0);
      console.log(
        `\n${spent.length} generated (~$${usd.toFixed(2)}), ${results.filter((r) => r.status === "cached").length} cached`,
      );
      return 0;
    }

    case "concepts": {
      const styles = list(opt("styles"));
      if (!styles?.length) {
        throw new Error(`Pass --styles <a,b,c>. Presets: ${ART_STYLE_KEYS.join(", ")}`);
      }
      const concepts = await runConcepts(cfg, styles, {
        dryRun: argv.includes("--dry-run"),
        yes: argv.includes("--yes"),
        log: (line) => console.log(line),
      });
      if (argv.includes("--dry-run")) return 0;
      const boards = await renderConceptBoards(cfg, devices[0]!, locales[0]!, concepts);
      await writeManifest(cfg);
      for (const b of boards) console.log(`board  ${b}`);
      return 0;
    }

    case "promo": {
      const formats = (list(opt("format")) ?? cfg.promo?.formats ?? ["9:16"]) as PromoFormat[];
      const music = cfg.promo?.music;
      for (const locale of locales) {
        for (const format of formats) {
          const file = await renderPromo(cfg, locale, format, {
            device: only,
            music:
              music && !cfg.promo?.audio
                ? (seconds) => ensureMusic(cfg, music.prompt, seconds, music.model)
                : undefined,
            renderOnly: argv.includes("--render-only"),
          });
          console.log(`promo  ${file}`);
        }
      }
      await writeManifest(cfg);
      return 0;
    }

    case "discover": {
      await runDiscoverCommand(cfg.appRoot, argv, cfg.root, cfg.flowsDir, cfg.store.name);
      return 0;
    }

    case "all": {
      if (!(await doctor(cfg))) return 1;
      await runCapture(cfg, devices, locales);
      for (const d of devices) {
        for (const l of locales) {
          await renderScreenshots(cfg, d, l);
          await renderPreview(cfg, d, l);
        }
      }
      await writeManifest(cfg);
      console.log("\nverify");
      return (await verifyAll(cfg, devices, locales)) ? 0 : 1;
    }

    default:
      console.error(`Unknown command "${command}"\n${USAGE}`);
      return 1;
  }
}

// Works from both src/cli.ts and the bundled dist/cli.js: package.json is one
// directory up from either.
function packageVersion(): string {
  const pkg = new URL("../package.json", import.meta.url);
  return JSON.parse(readFileSync(pkg, "utf8")).version;
}

async function runCapture(cfg: LoadedConfig, devices: DeviceKey[], locales: string[]) {
  for (const d of devices) {
    const udid = await device.resolveUdid(d);
    try {
      for (const locale of captureLocales(cfg, d, locales)) await capture(cfg, d, locale);
    } finally {
      // Leave the device as it was found; a pinned status bar is sticky.
      await device.clearStatusBar(d, udid);
    }
  }
}

async function verifyAll(cfg: LoadedConfig, devices: DeviceKey[], locales: string[]) {
  let ok = true;
  for (const d of devices) for (const l of locales) ok = (await verify(cfg, d, l)) && ok;
  return ok;
}

/**
 * Runs `goldie discover` and prints a short summary. `goldieDir` is the
 * directory discovery.json is written into: `cfg.root` on a config-driven
 * run, or `<appRoot>/goldie` for a bare `--root` scan with no config.
 */
async function runDiscoverCommand(
  appRoot: string,
  argv: string[],
  goldieDir: string = join(appRoot, "goldie"),
  flowsDir?: string,
  appName?: string,
) {
  const { file, discovery } = await runDiscover(goldieDir, {
    appRoot,
    appName,
    flowsDir,
    fresh: argv.includes("--fresh"),
    log: (line) => console.log(line),
  });
  const bySource = new Map<string, number>();
  for (const s of discovery.screens) bySource.set(s.source, (bySource.get(s.source) ?? 0) + 1);
  const summary = [...bySource.entries()].map(([k, v]) => `${v} ${k}`).join(", ");
  console.log(`\nwrote ${file}`);
  console.log(`${discovery.screens.length} screens (${summary || "none"})`);
  if (discovery.features.length === 0) {
    console.log(
      "No features yet - write 4-8 candidate features into discovery.json, or ask the user in chat.",
    );
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof FlowFailure) {
      console.error(repairBrief(err));
      process.exit(2);
    }
    console.error(`\n${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  });
