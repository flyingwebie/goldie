import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Aspect, Quality } from "./providers/types.ts";

export type LockEntry = {
  hash: string;
  provider: "openai" | "fal";
  model: string;
  quality: Quality;
  prompt: string;
  /** File name relative to the art dir, e.g. `mascot.png` or `mascot.mp4`. */
  file: string;
  createdAt: string;
  estimatedUsd: number;
};

/** `<artDir>/art.lock.json`: asset id (or `<id>:video`, `<id>:music-<hash8>`) to its last generation. */
export type ArtLock = Record<string, LockEntry>;

export function lockPath(artDir: string): string {
  return join(artDir, "art.lock.json");
}

export async function loadLock(artDir: string): Promise<ArtLock> {
  try {
    return JSON.parse(await readFile(lockPath(artDir), "utf8"));
  } catch {
    return {};
  }
}

export async function saveLock(artDir: string, lock: ArtLock): Promise<void> {
  const file = lockPath(artDir);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(lock, null, 2)}\n`);
}

/** Hashes an ordered list of parts, each a string or a buffer's bytes. */
export function hashParts(...parts: Array<string | Buffer>): string {
  const h = createHash("sha256");
  for (const part of parts) {
    h.update(part);
    h.update("\u0000");
  }
  return h.digest("hex");
}

/**
 * Everything that affects what an image asset renders to: the final prompt,
 * provider, model, aspect, transparency, quality and the bytes of every
 * reference image. Re-ordering references changes the hash on purpose -
 * providers can be order-sensitive (the first reference often anchors the
 * edit the most).
 */
export function computeHash(input: {
  prompt: string;
  provider: string;
  model: string;
  aspect: Aspect;
  transparent: boolean;
  quality: Quality;
  references: Buffer[];
}): string {
  return hashParts(
    input.prompt,
    input.provider,
    input.model,
    input.aspect,
    String(input.transparent),
    input.quality,
    ...input.references,
  );
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * An asset is fresh when its lock entry's hash matches the plan and its
 * output file is still on disk - a `force` run or a missing file (e.g. a
 * deleted `art/` directory) always counts as stale.
 */
export async function isFresh(
  lock: ArtLock,
  key: string,
  file: string,
  hash: string,
  force: boolean,
): Promise<boolean> {
  if (force) return false;
  const entry = lock[key];
  if (!entry || entry.hash !== hash) return false;
  return fileExists(file);
}
