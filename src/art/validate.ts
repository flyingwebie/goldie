import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ArtConfig } from "../config.ts";

const VALID_KINDS = new Set(["background", "scene", "character", "object", "sticker"]);
const ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * Checks an `art` config before any money is spent: asset ids are unique and
 * safe to use as a file name (`art/<id>.png`), every kind is one goldie
 * knows how to prompt and post-process, and every reference image - the
 * shared ones and each asset's own - actually exists on disk.
 */
export function validateArt(cfg: { root: string; art?: ArtConfig }): void {
  const art = cfg.art;
  if (!art) return;

  for (const ref of art.references ?? []) {
    const file = resolve(cfg.root, ref);
    if (!existsSync(file)) throw new Error(`art.references has a missing file: ${file}`);
  }

  const seen = new Set<string>();
  for (const asset of art.assets) {
    if (!ID_PATTERN.test(asset.id)) {
      throw new Error(
        `art asset id "${asset.id}" must match ${ID_PATTERN.source} - it becomes the file name art/${asset.id}.png.`,
      );
    }
    if (seen.has(asset.id)) throw new Error(`Duplicate art asset id "${asset.id}".`);
    seen.add(asset.id);

    if (!VALID_KINDS.has(asset.kind)) {
      throw new Error(
        `art asset "${asset.id}" has an unknown kind "${asset.kind}". ` +
          `Valid kinds: ${[...VALID_KINDS].join(", ")}.`,
      );
    }

    for (const ref of asset.references ?? []) {
      const file = resolve(cfg.root, ref);
      if (!existsSync(file)) {
        throw new Error(`art asset "${asset.id}" references a missing file: ${file}`);
      }
    }
  }
}
