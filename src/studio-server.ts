import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runArt } from "./art/index.ts";
import { locateApiKey } from "./art/keys.ts";
import { ART_MODELS, refreshOpenAiModels } from "./art/models.ts";
import { ART_STYLES } from "./art/styles.ts";
import { assetsForScene } from "./art/tile-assets.ts";
import { isScreenshot, loadConfig } from "./config.ts";
import { deleteCredential, last4, setCredential } from "./credentials.ts";
import { type Plan, planPath, readDiscovery, readPlan, writePlan } from "./discover.ts";
import { exec } from "./exec.ts";
import { listHistory, readHistoryDesign, restoreHistory, snapshotBeforeWrite } from "./history.ts";
import { zipDirs } from "./zip.ts";

/**
 * The studio's HTTP surface, shared by `goldie studio` (a static server over
 * the prebuilt studio/dist) and the Vite dev server (studio/vite.config.ts).
 *
 * GET/PUT /api/design - the design choices saved next to the config as
 * goldie.design.json ({ background?, frames?, fontFamily?, copy?, order? }).
 * The CLI's loadConfig() applies the file, so a saved choice also shapes plain
 * `goldie frame` runs. The UI debounces its PUTs; the server writes the file
 * atomically so a half-written JSON never reaches the CLI.
 *
 * POST /api/export - renders the final assets from the raw captures with the
 * chosen background and frame (goldie frame + preview + manifest), zips
 * out/screenshots and out/previews, and streams the CLI log as plain text.
 * Body: { background?, frames?, font?, template?, layout?, screenOnly? };
 * per-scene layouts ride on goldie.design.json, which the CLI reads on its
 * own. The response ends with "[done]" on success or "[failed]" otherwise; on
 * "[done]" the UI downloads GET /api/export/download.
 *
 * GET /api/art-library - read-only: every image the config already
 * references (theme and scene backgroundImage/backdrop, every image
 * decoration) plus the files in the config's art dir (`art.dir`, default
 * "art"), as `{ images: [{ src, url }] }` with `src` config-relative and
 * `url` fetchable by the browser. GET /api/art-library/file?src=<path>
 * streams one of those files, used both for that url and to resolve an image
 * decoration's `src` the current out/web/decor copy does not cover yet (one
 * just added in the editor, before the next `goldie manifest`); the Plan
 * view's discovery thumbnails (goldie/discovery/<id>.png) reuse it too.
 *
 * GET /api/settings, PUT /api/settings/keys, DELETE /api/settings/keys/:provider,
 * POST /api/settings/models/refresh - the AI art keys and model/style
 * choices normally kept in a .env file or OS env vars, editable from the
 * studio instead (see src/credentials.ts, src/art/keys.ts, src/art/models.ts).
 *
 * GET /api/history, GET /api/history/:id, POST /api/history/:id/restore -
 * the timeline of past goldie.design.json saves (src/history.ts). Every
 * successful PUT /api/design (and /api/plan) snapshots the file it is about
 * to replace, so a mistake is always one restore away.
 *
 * GET/PUT /api/plan - the Discovery & Plan feature's `{ discovery, plan }`
 * (src/discover.ts): which features and screens to build the story
 * around, written by `goldie discover` and edited in the studio's Plan view.
 *
 * GET /api/redo/:sceneId - the lightbox's Redo menu, for one screenshot
 * scene: `{ assets: TileArtAsset[] & { estimatedUsd } }`, the AI art assets
 * that tile draws (src/art/tile-assets.ts) priced with a `runArt` dry run.
 *
 * POST /api/redo/:sceneId/capture `{ device? }` - re-runs just that scene's
 * flow on the simulator (`goldie capture --scene`), merging into the raw
 * manifest, then `frame` and `manifest`. Streams the CLI log like
 * /api/export.
 *
 * POST /api/redo/:sceneId/art `{ assets: string[] }` - regenerates the named
 * art assets (`goldie art --only <ids> --force --yes`), then `frame` and
 * `manifest`. Streamed the same way; `goldie art` already moves the
 * overwritten file to `<artDir>/.history/` first.
 *
 * POST /api/redo/art/:assetId/restore - swaps the newest
 * `<artDir>/.history/<assetId>-*` file back in over the current
 * `<artDir>/<assetId>.*`, snapshotting what it replaces first so the restore
 * itself is one more undo-able step.
 */

export type StudioPaths = {
  configPath: string;
  configDir: string;
  outDir: string;
  webDir: string;
  designFile: string;
  exportZip: string;
};

/** Every path the studio touches derives from the config file's location. */
export function studioPaths(configPath: string): StudioPaths {
  const configDir = dirname(resolve(configPath));
  const outDir = join(configDir, "out");
  return {
    configPath: resolve(configPath),
    configDir,
    outDir,
    webDir: join(outDir, "web"),
    designFile: join(configDir, "goldie.design.json"), // mirrors designPath() in config.ts
    exportZip: join(outDir, "export.zip"),
  };
}

export type ExportOptions = {
  background?: string;
  /** One bezel variant per device key. */
  frames?: Record<string, string>;
  font?: string;
  template?: string;
  layout?: string;
  screenOnly?: boolean;
};

export type StudioApi = {
  paths: StudioPaths;
  /** Command prefix that runs the goldie CLI, e.g. ["node", ".../dist/cli.js"]. */
  cli: string[];
};

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => done(body));
  });
}

/** Handles /api/design. */
export function designHandler({ paths }: StudioApi): Handler {
  return (req, res) => {
    if (req.method === "GET") {
      readFile(paths.designFile, "utf8").then(
        (json) => {
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(json);
        },
        () => {
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end("{}");
        },
      );
      return;
    }
    if (req.method !== "PUT") {
      res.statusCode = 405;
      res.end("GET or PUT only");
      return;
    }
    readBody(req).then(async (body) => {
      let design: Record<string, unknown>;
      try {
        design = JSON.parse(body);
        if (!design || typeof design !== "object") throw new Error();
      } catch {
        res.statusCode = 400;
        res.end("Body must be a JSON object.");
        return;
      }
      try {
        const previous = await readFile(paths.designFile, "utf8").catch(() => null);
        await snapshotBeforeWrite(paths.configPath, previous);
        const tmp = `${paths.designFile}.tmp`;
        await writeFile(tmp, `${JSON.stringify(design, null, 2)}\n`);
        await rename(tmp, paths.designFile);
        res.statusCode = 204;
        res.end();
      } catch (err) {
        res.statusCode = 500;
        res.end(err instanceof Error ? err.message : String(err));
      }
    });
  };
}

/** Handles /api/export and /api/export/download. `sub` is the path after /api/export. */
export function exportHandler({ paths, cli }: StudioApi): (sub: string) => Handler {
  let busy = false;

  return (sub) => (req, res) => {
    if (req.method === "GET" && sub === "/download") {
      if (!existsSync(paths.exportZip)) {
        res.statusCode = 404;
        res.end("No export yet. POST /api/export first.");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": statSync(paths.exportZip).size,
        "Content-Disposition": 'attachment; filename="appstore-assets.zip"',
        "Cache-Control": "no-store",
      });
      createReadStream(paths.exportZip).pipe(res);
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("POST only");
      return;
    }
    if (busy) {
      res.statusCode = 409;
      res.end("An export is already running.");
      return;
    }
    busy = true;

    readBody(req).then(async (body) => {
      let opts: ExportOptions;
      try {
        opts = JSON.parse(body || "{}");
      } catch {
        busy = false;
        res.statusCode = 400;
        res.end("Body must be JSON.");
        return;
      }

      const flags: string[] = [];
      if (opts.background) flags.push("--background", opts.background);
      for (const variant of Object.values(opts.frames ?? {})) {
        if (variant) flags.push("--frame", variant);
      }
      if (opts.font) flags.push("--font", opts.font);
      if (opts.template) flags.push("--template", opts.template);
      if (opts.layout) flags.push("--layout", opts.layout);
      if (opts.screenOnly) flags.push("--screen-only");

      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });

      const [bin, ...prefix] = cli;
      try {
        for (const command of ["frame", "preview", "manifest"]) {
          res.write(`$ goldie ${command}\n`);
          await stream(bin!, [...prefix, command, ...flags], paths.configDir, res, {
            GOLDIE_CONFIG: paths.configPath,
          });
        }
        res.write("$ zip screenshots + previews\n");
        await rm(paths.exportZip, { force: true });
        const count = await zipDirs(paths.outDir, ["screenshots", "previews"], paths.exportZip);
        res.write(`  ${count} files\n`);
        res.write("[done]\n");
      } catch (err) {
        res.write(`[failed] ${err instanceof Error ? err.message : err}\n`);
      } finally {
        busy = false;
        res.end();
      }
    });
  };
}

/** The art dir's assets this scene draws, each priced with a `runArt` dry run (spends nothing, needs no API key). */
async function getRedoAssets(configPath: string, sceneId: string) {
  const cfg = await loadConfig(configPath);
  const assets = assetsForScene(cfg, sceneId);
  if (!cfg.art || assets.length === 0) return { assets: [] };
  const plans = await runArt(cfg, { only: assets.map((a) => a.id), force: true, dryRun: true });
  const estimateOf = new Map(plans.map((p) => [p.id, p.estimatedUsd]));
  return {
    assets: assets.map((a) => ({ ...a, estimatedUsd: estimateOf.get(a.id) ?? 0 })),
  };
}

/**
 * Swaps the newest `<artDir>/.history/<assetId>-*` file back in over the
 * current `<artDir>/<assetId>.*`. The file currently in place (the
 * regeneration the user wants to undo) is snapshotted into `.history` first,
 * under the same naming `src/history.ts`'s snapshotArtFile uses, so this
 * restore is itself one more undo-able step rather than a dead end.
 */
async function restoreArtAsset(
  configPath: string,
  assetId: string,
): Promise<{ status: number; json: unknown }> {
  const cfg = await loadConfig(configPath);
  const artDir = resolve(cfg.root, cfg.art?.dir ?? "art");
  const historyDir = join(artDir, ".history");
  const prefix = `${assetId}-`;
  const names = (await readdir(historyDir).catch(() => [] as string[]))
    .filter((n) => n.startsWith(prefix))
    .sort(); // sanitized ISO timestamps, so lexical order is chronological
  const newest = names.at(-1);
  if (!newest) {
    return { status: 404, json: { error: `No previous version of "${assetId}" to restore.` } };
  }
  const ext = newest.slice(newest.lastIndexOf("."));
  const current = join(artDir, `${assetId}${ext}`);
  if (existsSync(current)) {
    const toId = (iso: string) => iso.replace(/[:.]/g, "-");
    await rename(current, join(historyDir, `${assetId}-${toId(new Date().toISOString())}${ext}`));
  }
  await rename(join(historyDir, newest), current);
  return { status: 200, json: { ok: true, file: `${assetId}${ext}` } };
}

/**
 * Handles the /api/redo/* surface (see the doc comment above): `sub` is the
 * path after /api/redo. One job (a capture or an art regeneration) runs at a
 * time; `cli`/`stream` mirror exportHandler's pattern exactly.
 */
export function redoHandler({ paths, cli }: StudioApi): (sub: string) => Handler {
  let busy = false;

  return (sub) => (req, res) => {
    const restoreMatch = sub.match(/^\/art\/([^/]+)\/restore$/);
    if (restoreMatch && req.method === "POST") {
      restoreArtAsset(paths.configPath, decodeURIComponent(restoreMatch[1]!)).then(
        ({ status, json }) => sendJson(res, status, json),
        (err) => sendJson(res, 500, { error: errorMessage(err) }),
      );
      return;
    }

    const captureMatch = sub.match(/^\/([^/]+)\/capture$/);
    const artMatch = sub.match(/^\/([^/]+)\/art$/);
    if ((captureMatch || artMatch) && req.method === "POST") {
      if (busy) {
        res.statusCode = 409;
        res.end("A redo job is already running.");
        return;
      }
      const sceneId = decodeURIComponent((captureMatch ?? artMatch)![1]!);
      busy = true;

      readBody(req).then(async (body) => {
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        });
        const [bin, ...prefix] = cli;
        const run = (args: string[]) => {
          res.write(`$ goldie ${args.join(" ")}\n`);
          return stream(bin!, [...prefix, ...args], paths.configDir, res, {
            GOLDIE_CONFIG: paths.configPath,
          });
        };
        try {
          if (captureMatch) {
            let device: string | undefined;
            try {
              device = JSON.parse(body || "{}").device;
            } catch {
              // No body, or not JSON: capture every configured device.
            }
            const deviceFlags = device ? ["--device", device] : [];
            await run(["capture", "--scene", sceneId, ...deviceFlags]);
            await run(["frame", ...deviceFlags]);
          } else {
            let assets: unknown;
            try {
              assets = JSON.parse(body || "{}").assets;
            } catch {
              assets = undefined;
            }
            if (!Array.isArray(assets) || assets.length === 0) {
              throw new Error("No art assets selected.");
            }
            await run(["art", "--only", assets.join(","), "--force", "--yes"]);
            await run(["frame"]);
          }
          await run(["manifest"]);
          res.write("[done]\n");
        } catch (err) {
          res.write(`[failed] ${errorMessage(err)}\n`);
        } finally {
          busy = false;
          res.end();
        }
      });
      return;
    }

    const infoMatch = sub.match(/^\/([^/]+)$/);
    if (infoMatch && req.method === "GET") {
      getRedoAssets(paths.configPath, decodeURIComponent(infoMatch[1]!)).then(
        (json) => sendJson(res, 200, json),
        (err) => sendJson(res, 500, { error: errorMessage(err) }),
      );
      return;
    }

    sendJson(res, 404, { error: "not found" });
  };
}

const ART_LIBRARY_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);

/**
 * Every image the loaded config already points at (deduplicated, as
 * config-relative paths), plus the files in its art dir. A path that resolves
 * outside the config's own directory is dropped - the file server below only
 * ever serves inside it.
 */
async function listArtLibrary(configPath: string): Promise<Array<{ src: string; url: string }>> {
  const cfg = await loadConfig(configPath);
  const root = cfg.root;
  const seen = new Set<string>();
  const add = (relPath: string | undefined) => {
    if (!relPath || relPath === "none") return;
    const rel = relative(root, resolve(root, relPath)).split(sep).join("/");
    if (!rel.startsWith("..")) seen.add(rel);
  };
  add(cfg.theme.backgroundImage);
  add(cfg.theme.backdrop);
  for (const d of cfg.theme.decorations ?? []) if (d.kind === "image") add(d.src);
  for (const scene of cfg.scenes) {
    if (!isScreenshot(scene)) continue;
    add(scene.backgroundImage);
    for (const d of scene.decorations ?? []) if (d.kind === "image") add(d.src);
  }
  const artDir = resolve(root, cfg.art?.dir ?? "art");
  for (const name of await readdir(artDir).catch(() => [] as string[])) {
    if (ART_LIBRARY_EXT.has(extname(name).toLowerCase())) add(relative(root, join(artDir, name)));
  }
  return [...seen]
    .sort()
    .map((src) => ({ src, url: `/api/art-library/file?src=${encodeURIComponent(src)}` }));
}

/** Handles /api/art-library and /api/art-library/file. `sub` is the path after /api/art-library. */
export function artLibraryHandler({ paths }: StudioApi): (sub: string) => Handler {
  return (sub) => (req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end("GET only");
      return;
    }
    if (sub === "/file") {
      const src = new URL(req.url ?? "/", "http://localhost").searchParams.get("src");
      const file = src ? fileIn(paths.configDir, src) : null;
      if (!file) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      sendFile(req, res, file);
      return;
    }
    listArtLibrary(paths.configPath).then(
      (images) => {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ images }));
      },
      (err) => {
        res.statusCode = 500;
        res.end(err instanceof Error ? err.message : String(err));
      },
    );
  };
}

function sendJson(res: ServerResponse, status: number, json: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(json === undefined ? undefined : JSON.stringify(json));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const CREDENTIAL_KEY = { openai: "OPENAI_API_KEY", fal: "FAL_KEY" } as const;

function isProvider(value: unknown): value is "openai" | "fal" {
  return value === "openai" || value === "fal";
}

/**
 * The effective `art` settings (after goldie.design.json overrides, as
 * applyDesign in src/config.ts already merges them into the loaded config),
 * each provider's key status, the model catalog, and a style summary.
 */
async function getSettings(configPath: string) {
  const cfg = await loadConfig(configPath);
  const keys: Record<
    "openai" | "fal",
    { set: boolean; source: "env" | "project" | "user" | "app" | null; last4?: string }
  > = {
    openai: { set: false, source: null },
    fal: { set: false, source: null },
  };
  for (const provider of ["openai", "fal"] as const) {
    const located = await locateApiKey(cfg, provider);
    keys[provider] = located
      ? { set: true, source: located.source, last4: last4(located.value) }
      : { set: false, source: null };
  }
  // Settings always offer the model and style pickers. With no art block
  // yet, the provider defaults to the one with a key (fal first: it also
  // covers cutouts, clips and music); saving creates the block via
  // goldie.design.json (applyDesign).
  const art = cfg.art;
  const defaultProvider = keys.fal.set || !keys.openai.set ? "fal" : "openai";
  return {
    keys,
    art: {
      configured: Boolean(art),
      hasAssets: Boolean(art?.assets.length),
      provider: art?.provider ?? defaultProvider,
      model: art?.model ?? null,
      draftModel: art?.draftModel ?? null,
      style: art?.style ?? "",
    },
    models: ART_MODELS,
    styles: Object.fromEntries(
      Object.entries(ART_STYLES).map(([key, s]) => [
        key,
        { label: s.label, description: s.description, bestFor: s.bestFor },
      ]),
    ),
  };
}

/**
 * Saves one provider's key to the user's credentials file
 * (src/credentials.ts). OpenAI keys are validated with a cheap
 * `GET /v1/models` call first; a clean rejection (bad key, reachable
 * network) is reported as an error and never saved. fal has no equivalently
 * cheap read-only endpoint, so its key is saved unvalidated. A network
 * error (offline) does not block saving either way - it only means the key
 * could not be confirmed yet.
 */
async function putSettingsKey(body: string): Promise<{ status: number; json: unknown }> {
  let parsed: { provider?: unknown; key?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    return { status: 400, json: { ok: false, error: "Body must be JSON." } };
  }
  if (!isProvider(parsed.provider)) {
    return { status: 400, json: { ok: false, error: 'provider must be "openai" or "fal".' } };
  }
  if (typeof parsed.key !== "string" || parsed.key.trim() === "") {
    return { status: 400, json: { ok: false, error: "key is required." } };
  }
  const key = parsed.key.trim();

  if (parsed.provider === "openai") {
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        return {
          status: 400,
          json: { ok: false, error: `OpenAI rejected this key (HTTP ${res.status}).` },
        };
      }
    } catch {
      // Unreachable network: save anyway, just unconfirmed.
    }
  }
  await setCredential(CREDENTIAL_KEY[parsed.provider], key);
  return { status: 200, json: { ok: true } };
}

async function deleteSettingsKey(provider: string): Promise<{ status: number; json: unknown }> {
  if (!isProvider(provider)) {
    return { status: 400, json: { ok: false, error: 'provider must be "openai" or "fal".' } };
  }
  await deleteCredential(CREDENTIAL_KEY[provider]);
  return { status: 200, json: { ok: true } };
}

async function refreshModels(configPath: string): Promise<{ status: number; json: unknown }> {
  const cfg = await loadConfig(configPath);
  const located = await locateApiKey(cfg, "openai");
  if (!located) {
    return { status: 400, json: { error: "No OpenAI key set yet." } };
  }
  try {
    const models = await refreshOpenAiModels(located.value);
    return { status: 200, json: { models } };
  } catch (err) {
    return { status: 502, json: { error: errorMessage(err) } };
  }
}

/** Handles /api/settings, /api/settings/keys, /api/settings/keys/:provider and /api/settings/models/refresh. */
export function settingsHandler({ paths }: StudioApi): (sub: string) => Handler {
  return (sub) => (req, res) => {
    if (sub === "" && req.method === "GET") {
      getSettings(paths.configPath).then(
        (json) => sendJson(res, 200, json),
        (err) => sendJson(res, 500, { error: errorMessage(err) }),
      );
      return;
    }
    if (sub === "/keys" && req.method === "PUT") {
      readBody(req).then((body) =>
        putSettingsKey(body).then(({ status, json }) => sendJson(res, status, json)),
      );
      return;
    }
    if (sub.startsWith("/keys/") && req.method === "DELETE") {
      deleteSettingsKey(sub.slice("/keys/".length)).then(({ status, json }) =>
        sendJson(res, status, json),
      );
      return;
    }
    if (sub === "/models/refresh" && req.method === "POST") {
      refreshModels(paths.configPath).then(({ status, json }) => sendJson(res, status, json));
      return;
    }
    sendJson(res, 404, { error: "not found" });
  };
}

/** Handles /api/history, /api/history/:id and /api/history/:id/restore. */
export function historyHandler({ paths }: StudioApi): (sub: string) => Handler {
  return (sub) => (req, res) => {
    const restoreMatch = sub.match(/^\/([^/]+)\/restore$/);
    if (restoreMatch && req.method === "POST") {
      (async () => {
        const previous = await readFile(paths.designFile, "utf8").catch(() => null);
        const restored = await restoreHistory(paths.configPath, restoreMatch[1]!, previous);
        if (!restored) return sendJson(res, 404, { error: "Unknown history id." });
        const tmp = `${paths.designFile}.tmp`;
        await writeFile(tmp, `${JSON.stringify(restored, null, 2)}\n`);
        await rename(tmp, paths.designFile);
        sendJson(res, 200, { design: restored });
      })().catch((err) => sendJson(res, 500, { error: errorMessage(err) }));
      return;
    }
    if (sub === "" && req.method === "GET") {
      readFile(paths.designFile, "utf8")
        .then((text) => JSON.parse(text))
        .catch(() => ({}))
        .then((current) =>
          listHistory(paths.configPath, current).then((entries) => sendJson(res, 200, { entries })),
        )
        .catch((err) => sendJson(res, 500, { error: errorMessage(err) }));
      return;
    }
    const idMatch = sub.match(/^\/([^/]+)$/);
    if (idMatch && req.method === "GET") {
      readHistoryDesign(paths.configPath, idMatch[1]!).then(
        (design) =>
          design
            ? sendJson(res, 200, { design })
            : sendJson(res, 404, { error: "Unknown history id." }),
        (err) => sendJson(res, 500, { error: errorMessage(err) }),
      );
      return;
    }
    sendJson(res, 404, { error: "not found" });
  };
}

/**
 * Handles /api/plan: `{ discovery, plan }`. A 404 (with the command to run)
 * when `goldie discover` has not run yet, matching the ManifestError pattern
 * the main manifest load already uses for its own empty state.
 */
export function planHandler({ paths }: StudioApi): Handler {
  return (req, res) => {
    if (req.method === "GET") {
      readDiscovery(paths.configDir).then(
        (discovery) => {
          if (!discovery) {
            return sendJson(res, 404, {
              error: "No goldie/discovery.json yet.",
              command: "goldie discover",
            });
          }
          readPlan(paths.configDir).then((plan) =>
            sendJson(res, 200, { discovery, plan: plan ?? null }),
          );
        },
        (err) => sendJson(res, 500, { error: errorMessage(err) }),
      );
      return;
    }
    if (req.method !== "PUT") {
      res.statusCode = 405;
      res.end("GET or PUT only");
      return;
    }
    readBody(req).then(async (body) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== "object") throw new Error();
      } catch {
        sendJson(res, 400, { error: "Body must be a JSON object." });
        return;
      }
      try {
        const plan: Plan = {
          updatedAt: new Date().toISOString(),
          decide: parsed.decide === "goldie" ? "goldie" : "user",
          features: Array.isArray(parsed.features)
            ? parsed.features.filter((x): x is string => typeof x === "string")
            : [],
          screens: Array.isArray(parsed.screens)
            ? parsed.screens.filter((x): x is string => typeof x === "string")
            : [],
          notes: typeof parsed.notes === "string" ? parsed.notes : undefined,
        };
        const previous = await readFile(planPath(paths.configDir), "utf8").catch(() => null);
        await snapshotBeforeWrite(paths.configPath, previous, "plan");
        await writePlan(paths.configDir, plan);
        sendJson(res, 200, { plan });
      } catch (err) {
        sendJson(res, 500, { error: errorMessage(err) });
      }
    });
  };
}

function stream(
  cmd: string,
  args: string[],
  cwd: string,
  res: ServerResponse,
  env: Record<string, string> = {},
): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    child.stdout.on("data", (d) => res.write(d));
    child.stderr.on("data", (d) => res.write(d));
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done() : fail(new Error(`exit code ${code}`))));
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** Serve `file` with Range support, so the preview video seeks in the browser. */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string) {
  const size = statSync(file).size;
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(res);
}

/** Resolve a URL path inside `root`, or null when it escapes or is missing. */
function fileIn(root: string, urlPath: string): string | null {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, rel);
  if (!file.startsWith(root)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

/** The studio bundle Vite emits; shipped in the npm package. */
export const STUDIO_DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "studio", "dist");

/**
 * Serve the prebuilt studio plus the app's out/web at `/`, with the API on top.
 * Resolves with the URL once listening.
 */
export function serveStudio(api: StudioApi, port = 4321): Promise<string> {
  if (!existsSync(join(STUDIO_DIST, "index.html"))) {
    throw new Error(
      `No studio build at ${STUDIO_DIST}. In a source checkout run: bun run studio:build`,
    );
  }
  const design = designHandler(api);
  const exp = exportHandler(api);
  const artLib = artLibraryHandler(api);
  const settings = settingsHandler(api);
  const history = historyHandler(api);
  const plan = planHandler(api);
  const redo = redoHandler(api);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    if (path === "/api/design") return design(req, res);
    if (path.startsWith("/api/export")) return exp(path.slice("/api/export".length))(req, res);
    if (path.startsWith("/api/art-library"))
      return artLib(path.slice("/api/art-library".length))(req, res);
    if (path.startsWith("/api/settings"))
      return settings(path.slice("/api/settings".length))(req, res);
    if (path.startsWith("/api/history"))
      return history(path.slice("/api/history".length))(req, res);
    if (path === "/api/plan") return plan(req, res);
    if (path.startsWith("/api/redo")) return redo(path.slice("/api/redo".length))(req, res);

    const file = fileIn(api.paths.webDir, path) ?? fileIn(STUDIO_DIST, path);
    if (file) return sendFile(req, res, file);
    if (path === "/store.json") {
      res.statusCode = 404;
      res.end("No out/web/store.json. Run: goldie manifest");
      return;
    }
    sendFile(req, res, join(STUDIO_DIST, "index.html"));
  });

  return new Promise((done, fail) => {
    server.on("error", fail);
    server.listen(port, "127.0.0.1", () => done(`http://localhost:${port}`));
  });
}

/** Open a URL in the default browser; best effort. */
export async function openInBrowser(url: string): Promise<void> {
  // `start` is a cmd.exe builtin, not a program; the empty string is its window title.
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", '""', url]]
        : ["xdg-open", [url]];
  await exec(cmd, args, { quiet: true });
}
