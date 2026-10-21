import { resolve } from "node:path";
import type { LoadedConfig } from "../config.ts";
import { type RunArtOpts, runArt } from "./index.ts";

export type ConceptResult = { style: string; dir: string };

/**
 * Renders the same assets in several styles as cheap drafts, each into its
 * own `art/concepts/<style>/` directory, so a human can pick a direction
 * before any `final`-quality (and pricier) render happens.
 */
export async function runConcepts(
  cfg: LoadedConfig,
  styles: string[],
  opts: Omit<RunArtOpts, "draft" | "style" | "outDir"> = {},
): Promise<ConceptResult[]> {
  const art = cfg.art;
  if (!art) {
    throw new Error("No `art` config: add one to the goldie config before running `goldie art`.");
  }
  const baseDir = resolve(cfg.root, art.dir ?? "art");

  const results: ConceptResult[] = [];
  for (const style of styles) {
    const dir = resolve(baseDir, "concepts", style);
    await runArt(cfg, { ...opts, draft: true, style, outDir: dir });
    results.push({ style, dir });
  }
  return results;
}
