import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { ArtAsset, LoadedConfig } from "../config.ts";
import { pngInfo } from "../image.ts";
import { resolveApiKey, tryResolveApiKey } from "./keys.ts";
import {
  type ArtLock,
  computeHash,
  fileExists,
  hashParts,
  isFresh,
  loadLock,
  saveLock,
} from "./lock.ts";
import {
  audioExtension,
  estimateMusicUsd,
  estimateVideoUsd,
  generateMusic,
  imageToVideo,
} from "./media.ts";
import { buildPrompt, defaultAspect, isTransparentKind } from "./prompt.ts";
import { falProvider, removeBackground } from "./providers/fal.ts";
import { openaiProvider } from "./providers/openai.ts";
import type { ImageProvider, ImageRequest, Quality } from "./providers/types.ts";
import { trimTransparentMargins } from "./trim.ts";
import { validateArt } from "./validate.ts";

export { buildPrompt } from "./prompt.ts";
export type { ImageProvider, ImageRequest } from "./providers/types.ts";
export type { ArtStyle, ArtStyleKey } from "./styles.ts";
export { ART_STYLE_KEYS, ART_STYLES, isArtStyleKey, stylePrompt } from "./styles.ts";
export { validateArt } from "./validate.ts";

export type RunArtOpts = {
  /** Only these asset ids; defaults to every asset in `art.assets`. */
  only?: string[];
  /** Regenerate even when the cache says an asset is fresh. */
  force?: boolean;
  /** Cheap/fast model, for exploring concepts before spending on a final render. */
  draft?: boolean;
  /** Overrides `art.dir`. */
  outDir?: string;
  /** Overrides `art.style` for this run. */
  style?: string;
  /** Print the plan and full prompts; call no provider, spend nothing. */
  dryRun?: boolean;
  /** Proceed even when the estimated spend exceeds `art.budgetUsd`. */
  yes?: boolean;
  log?: (line: string) => void;
};

export type ArtRunResult = {
  id: string;
  file: string;
  status: "generated" | "cached" | "planned";
  estimatedUsd: number;
};

function provider(name: "openai" | "fal", apiKey: string): ImageProvider {
  return name === "openai" ? openaiProvider(apiKey) : falProvider(apiKey);
}

async function loadReferenceFiles(root: string, paths: string[]): Promise<Buffer[]> {
  return Promise.all(paths.map((p) => readFile(resolve(root, p))));
}

type Plan = {
  asset: ArtAsset;
  aspect: ImageRequest["aspect"];
  transparent: boolean;
  prompt: string;
  hash: string;
  file: string;
  req: ImageRequest;
  stale: boolean;
  cost: number;
};

type VideoPlan = {
  asset: ArtAsset;
  file: string;
  hash: string;
  stale: boolean;
  cost: number;
  seconds: number;
  model?: string;
};

/**
 * Generates (or reuses) every art asset the config declares. References
 * resolve as `art.references` first, then the asset's own `references`, so
 * a brand mascot/logo supplied once at the top still reaches every prompt.
 * Nothing is spent until the estimate clears `art.budgetUsd` (or `opts.yes`
 * is set); `opts.dryRun` prints the plan and full prompts and calls no
 * provider at all.
 */
export async function runArt(cfg: LoadedConfig, opts: RunArtOpts = {}): Promise<ArtRunResult[]> {
  const art = cfg.art;
  if (!art) {
    throw new Error("No `art` config: add one to the goldie config before running `goldie art`.");
  }
  validateArt(cfg);
  if (opts.only) {
    for (const id of opts.only) {
      if (!art.assets.some((a) => a.id === id)) throw new Error(`Unknown art asset id "${id}".`);
    }
  }

  const log = opts.log ?? (() => {});
  const artDir = resolve(opts.outDir ?? resolve(cfg.root, art.dir ?? "art"));
  await mkdir(artDir, { recursive: true });

  const quality: Quality = opts.draft ? "draft" : "final";
  const styleKey = opts.style ?? art.style;
  // A dry run only prices and prints the plan, so it works before any key is set.
  const apiKey = opts.dryRun
    ? ((await tryResolveApiKey(cfg, art.provider)) ?? "")
    : await resolveApiKey(cfg, art.provider);
  const imageProvider = provider(art.provider, apiKey);

  const globalReferences = await loadReferenceFiles(cfg.root, art.references ?? []);
  const assets = opts.only ? art.assets.filter((a) => opts.only?.includes(a.id)) : art.assets;

  const lock = await loadLock(artDir);
  const force = Boolean(opts.force);

  const plans: Plan[] = [];
  for (const asset of assets) {
    const aspect = asset.aspect ?? defaultAspect(asset.kind);
    const transparent = isTransparentKind(asset.kind);
    const references = [
      ...globalReferences,
      ...(await loadReferenceFiles(cfg.root, asset.references ?? [])),
    ];
    const prompt = buildPrompt(
      asset,
      { ...art, style: styleKey },
      { storeName: cfg.store.name, storeCategory: cfg.store.category },
    );
    const model = art.model;
    const req: ImageRequest = { prompt, aspect, transparent, references, quality, model };
    const hash = computeHash({
      prompt,
      provider: art.provider,
      model: model ?? "default",
      aspect,
      transparent,
      quality,
      references,
    });
    const file = join(artDir, `${asset.id}.png`);
    const stale = !(await isFresh(lock, asset.id, file, hash, force));
    const cost = stale ? imageProvider.estimateUsd(req) : 0;
    plans.push({ asset, aspect, transparent, prompt, hash, file, req, stale, cost });
  }

  const videoPlans: VideoPlan[] = [];
  for (const p of plans) {
    if (!p.asset.animate) continue;
    const seconds = p.asset.animate.seconds ?? 5;
    const model = p.asset.animate.model;
    const file = join(artDir, `${p.asset.id}.mp4`);
    const hash = hashParts(p.hash, p.asset.animate.prompt, String(seconds), model ?? "default");
    const stale = !(await isFresh(lock, `${p.asset.id}:video`, file, hash, force));
    const cost = stale ? estimateVideoUsd(seconds) : 0;
    videoPlans.push({ asset: p.asset, file, hash, stale, cost, seconds, model });
  }

  const estimate =
    plans.reduce((sum, p) => sum + p.cost, 0) + videoPlans.reduce((sum, v) => sum + v.cost, 0);

  if (opts.dryRun) {
    for (const p of plans) {
      const tag = p.stale ? "would generate" : "cached";
      log(
        `[${tag}] ${p.asset.id} (${p.asset.kind}, ${p.aspect}${p.transparent ? ", transparent" : ""})`,
      );
      log(`  prompt: ${p.prompt}`);
      if (p.stale) log(`  estimated cost: $${p.cost.toFixed(2)}`);
    }
    for (const v of videoPlans) {
      log(`[${v.stale ? "would animate" : "cached"}] ${v.asset.id}.mp4 (${v.seconds}s)`);
    }
    log(`Estimated total: $${estimate.toFixed(2)}`);
    return plans.map((p) => ({
      id: p.asset.id,
      file: p.file,
      status: p.stale ? "planned" : "cached",
      estimatedUsd: p.cost,
    }));
  }

  const budget = art.budgetUsd ?? 5;
  if (estimate > budget && !opts.yes) {
    throw new Error(
      `goldie art would spend an estimated $${estimate.toFixed(2)}, over the $${budget.toFixed(2)} budget ` +
        `(art.budgetUsd). Re-run with --yes to spend it anyway.`,
    );
  }

  const results: ArtRunResult[] = [];
  for (const p of plans) {
    if (!p.stale) {
      results.push({ id: p.asset.id, file: p.file, status: "cached", estimatedUsd: 0 });
      continue;
    }
    log(`generating ${p.asset.id}...`);
    let bytes = await imageProvider.generate(p.req);
    await writeFile(p.file, bytes);

    if (p.transparent) {
      bytes = await ensureTransparent(cfg, p.asset.id, p.file, bytes, log);
      bytes = await trimTransparentMargins(bytes);
      await writeFile(p.file, bytes);
    }

    lock[p.asset.id] = {
      hash: p.hash,
      provider: art.provider,
      model: p.req.model ?? "default",
      quality,
      prompt: p.prompt,
      file: basename(p.file),
      createdAt: new Date().toISOString(),
      estimatedUsd: p.cost,
    };
    await saveLock(artDir, lock);
    results.push({ id: p.asset.id, file: p.file, status: "generated", estimatedUsd: p.cost });
  }

  for (const v of videoPlans) {
    if (!v.stale) continue;
    log(`animating ${v.asset.id}...`);
    const falKey = await resolveApiKey(cfg, "fal");
    const image = await readFile(join(artDir, `${v.asset.id}.png`));
    const clip = await imageToVideo(falKey, {
      image,
      prompt: v.asset.animate!.prompt,
      seconds: v.seconds,
      model: v.model,
    });
    await writeFile(v.file, clip);
    lock[`${v.asset.id}:video`] = {
      hash: v.hash,
      provider: "fal",
      model: v.model ?? "default",
      quality,
      prompt: v.asset.animate!.prompt,
      file: basename(v.file),
      createdAt: new Date().toISOString(),
      estimatedUsd: v.cost,
    };
    await saveLock(artDir, lock);
  }

  return results;
}

/**
 * If a transparent-kind asset came back opaque (a provider that cannot draw
 * real alpha, or one that silently ignored the request), cuts it out with
 * fal's birefnet when a FAL_KEY is available - OpenAI assets fall back to it
 * too, per the module's providers; fal's own provider already self-cuts.
 */
async function ensureTransparent(
  cfg: LoadedConfig,
  assetId: string,
  file: string,
  bytes: Buffer,
  log: (line: string) => void,
): Promise<Buffer> {
  const info = await pngInfo(file);
  if (info.hasAlpha) return bytes;

  const falKey = await tryResolveApiKey(cfg, "fal");
  if (!falKey) {
    log(
      `  warning: "${assetId}" is a transparent asset but came back opaque and FAL_KEY is unset; ` +
        "it will composite with a solid background.",
    );
    return bytes;
  }
  log(`  "${assetId}" came back opaque; cutting it out with fal birefnet`);
  const cut = await removeBackground(falKey, bytes);
  await writeFile(file, cut);
  return cut;
}

/**
 * A cached music bed for the promo video: generated once per
 * (prompt, seconds, model) and reused on every later `goldie promo` run.
 */
export async function ensureMusic(
  cfg: LoadedConfig,
  prompt: string,
  seconds: number,
  model?: string,
): Promise<string> {
  const art = cfg.art;
  const artDir = resolve(cfg.root, art?.dir ?? "art");
  await mkdir(artDir, { recursive: true });

  const hash = hashParts(prompt, String(seconds), model ?? "default");
  const key = `music-${hash.slice(0, 8)}`;
  const lock: ArtLock = await loadLock(artDir);

  const entry = lock[key];
  if (entry && (await fileExists(join(artDir, entry.file)))) {
    return join(artDir, entry.file);
  }

  const apiKey = await resolveApiKey(cfg, "fal");
  const bytes = await generateMusic(apiKey, { prompt, seconds, model });
  const fileName = `${key}.${audioExtension(bytes)}`;
  const file = join(artDir, fileName);
  await writeFile(file, bytes);

  lock[key] = {
    hash,
    provider: "fal",
    model: model ?? "default",
    quality: "final",
    prompt,
    file: fileName,
    createdAt: new Date().toISOString(),
    estimatedUsd: estimateMusicUsd(seconds, model),
  };
  await saveLock(artDir, lock);
  return file;
}
