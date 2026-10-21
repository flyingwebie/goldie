import { relative, resolve, sep } from "node:path";
import { isScreenshot, type LoadedConfig } from "../config.ts";

/**
 * One AI art asset (`goldie art`) a screenshot tile draws on screen, for the
 * studio's Redo > Regenerate art menu. `shared` marks an asset that every
 * tile draws (the theme's backgroundImage or backdrop, or a theme-level
 * decoration), as opposed to one this scene alone references.
 */
export type TileArtAsset = {
  id: string;
  kind: string;
  shared: boolean;
  /** A human label for a shared asset ("Backdrop (all tiles)"); the asset id otherwise. */
  label: string;
};

/**
 * The art dir's id for `src` (a config-relative path), when it names a file
 * directly inside `cfg.art.dir` that matches one of `cfg.art.assets`' ids -
 * i.e. the path `goldie art` itself would have written. Anything else (a
 * hand-placed image, a path outside the art dir, a subfolder) is not an art
 * asset and returns undefined.
 */
function assetIdFor(cfg: LoadedConfig, src: string | undefined): string | undefined {
  if (!src || src === "none") return undefined;
  if (!cfg.art) return undefined;
  const artDir = resolve(cfg.root, cfg.art.dir ?? "art");
  const rel = relative(artDir, resolve(cfg.root, src));
  if (rel.startsWith("..") || rel.includes(sep)) return undefined;
  if (!rel.endsWith(".png")) return undefined;
  const id = rel.slice(0, -".png".length);
  return cfg.art.assets.some((a) => a.id === id) ? id : undefined;
}

/**
 * Every AI art asset this screenshot scene's tile draws: its own
 * `backgroundImage`, image decorations on the scene or the theme, and the
 * theme's shared `backgroundImage`/`backdrop`. Deduplicated by asset id, in
 * no particular order. Throws on an id that is not a screenshot scene - the
 * studio's redo menu only ever opens for one of those.
 */
export function assetsForScene(cfg: LoadedConfig, sceneId: string): TileArtAsset[] {
  const scene = cfg.scenes.find((s) => s.id === sceneId);
  if (!scene || !isScreenshot(scene)) {
    throw new Error(`"${sceneId}" is not a screenshot scene.`);
  }

  const results: TileArtAsset[] = [];
  const seen = new Set<string>();
  const add = (src: string | undefined, shared: boolean, label?: string) => {
    const id = assetIdFor(cfg, src);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const asset = cfg.art?.assets.find((a) => a.id === id);
    results.push({ id, kind: asset?.kind ?? "unknown", shared, label: label ?? id });
  };

  add(scene.backgroundImage, false);
  for (const d of scene.decorations ?? []) if (d.kind === "image") add(d.src, false);

  add(cfg.theme.backgroundImage, true, "Background (all tiles)");
  add(cfg.theme.backdrop, true, "Backdrop (all tiles)");
  for (const d of cfg.theme.decorations ?? []) if (d.kind === "image") add(d.src, true);

  return results;
}
