import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Persistent version history for `goldie.design.json`, so a mistake made in
 * the studio survives a reload and can be undone even after the session's
 * in-memory undo stack (useHistory.ts, owned by the editor agent) is gone.
 *
 * Every successful write snapshots the *previous* content into
 * `<configDir>/.history/design-<sanitized-iso>.json`, oldest-first, capped
 * at the newest 100 and skipping a snapshot identical to the one before it
 * (a debounced save that produced no real change). Each snapshot file wraps
 * the design payload with its true ISO timestamp, so the filename can be
 * URL-safe without losing precision.
 */

export type HistoryEntry = { id: string; timestamp: string; summary: string };

type SnapshotFile = { timestamp: string; data: Record<string, unknown> };

const MAX_SNAPSHOTS = 100;

/** "design" for goldie.design.json (the only kind the History view lists); "plan" for plan.json's own safety-net snapshots. */
export type HistoryKind = "design" | "plan";

function historyDir(configPath: string): string {
  return join(dirname(configPath), ".history");
}

/** Filesystem- and URL-safe id for a moment in time: no colons or dots. */
function toId(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

function snapshotFile(configPath: string, kind: HistoryKind, id: string): string {
  return join(historyDir(configPath), `${kind}-${id}.json`);
}

async function listSnapshotIds(configPath: string, kind: HistoryKind): Promise<string[]> {
  try {
    const names = await readdir(historyDir(configPath));
    const prefix = `${kind}-`;
    return names
      .filter((n) => n.startsWith(prefix) && n.endsWith(".json"))
      .map((n) => n.slice(prefix.length, -".json".length))
      .sort(); // ids are sanitized ISO timestamps, so lexical order is chronological
  } catch {
    return [];
  }
}

async function readSnapshot(
  configPath: string,
  kind: HistoryKind,
  id: string,
): Promise<SnapshotFile | null> {
  try {
    const text = await readFile(snapshotFile(configPath, kind, id), "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as SnapshotFile) : null;
  } catch {
    return null;
  }
}

/**
 * Snapshots `currentContent` (the file's text about to be replaced) before
 * a write goes through. Pass `null` when there is no existing file yet -
 * nothing to preserve. Call this with the *old* content, before the new one
 * is written. `kind` defaults to "design" (goldie.design.json); plan.json's
 * writes pass "plan" so the two timelines never mix.
 */
export async function snapshotBeforeWrite(
  configPath: string,
  currentContent: string | null,
  kind: HistoryKind = "design",
): Promise<void> {
  if (currentContent === null) return;
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(currentContent);
    if (!parsed || typeof parsed !== "object") return;
    data = parsed as Record<string, unknown>;
  } catch {
    return; // a corrupt file is not worth preserving a snapshot of
  }

  const ids = await listSnapshotIds(configPath, kind);
  const latest = ids.at(-1);
  if (latest) {
    const prev = await readSnapshot(configPath, kind, latest);
    if (prev && JSON.stringify(prev.data) === JSON.stringify(data)) return; // no real change
  }

  const dir = historyDir(configPath);
  await mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString();
  // Two writes in the same millisecond (a fast double-save) would otherwise
  // collide on one filename and silently overwrite each other; disambiguate
  // with a numeric suffix that keeps the lexical (and chronological) order.
  const existing = new Set(ids);
  let id = toId(timestamp);
  for (let n = 2; existing.has(id); n++) id = `${toId(timestamp)}-${n}`;
  const payload: SnapshotFile = { timestamp, data };
  const file = snapshotFile(configPath, kind, id);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2));
  await rename(tmp, file);

  const all = [...ids, id];
  const stale = all.slice(0, Math.max(0, all.length - MAX_SNAPSHOTS));
  await Promise.all(
    stale.map((staleId) => rm(snapshotFile(configPath, kind, staleId), { force: true })),
  );
}

/**
 * The timeline, oldest-first-in-storage but returned newest-first for
 * display, each with a short summary of what changed *to* the next version
 * (the following snapshot, or the live file for the most recent entry) -
 * i.e. what restoring this entry would undo.
 */
export async function listHistory(
  configPath: string,
  current: Record<string, unknown>,
  kind: HistoryKind = "design",
): Promise<HistoryEntry[]> {
  const ids = await listSnapshotIds(configPath, kind);
  const entries: HistoryEntry[] = [];
  for (let i = 0; i < ids.length; i++) {
    const snap = await readSnapshot(configPath, kind, ids[i]!);
    if (!snap) continue;
    const next =
      i + 1 < ids.length ? (await readSnapshot(configPath, kind, ids[i + 1]!))?.data : current;
    entries.push({
      id: ids[i]!,
      timestamp: snap.timestamp,
      summary: diffSummary(snap.data, next ?? snap.data),
    });
  }
  return entries.reverse();
}

/** The raw saved payload for one snapshot, for `GET /api/history/:id`. */
export async function readHistoryDesign(
  configPath: string,
  id: string,
  kind: HistoryKind = "design",
): Promise<Record<string, unknown> | null> {
  const snap = await readSnapshot(configPath, kind, id);
  return snap?.data ?? null;
}

/**
 * Restores a snapshot: snapshots the current content first (so the restore
 * itself can be undone), then returns the restored payload for the caller
 * to write as the new file.
 */
export async function restoreHistory(
  configPath: string,
  id: string,
  currentContent: string | null,
  kind: HistoryKind = "design",
): Promise<Record<string, unknown> | null> {
  const snap = await readSnapshot(configPath, kind, id);
  if (!snap) return null;
  await snapshotBeforeWrite(configPath, currentContent, kind);
  return snap.data;
}

const KEY_LABELS: Record<string, string> = {
  background: "background",
  frame: "bezel",
  frames: "bezel",
  fontFamily: "font",
  order: "tile order",
  template: "template",
  layout: "layout",
  screenOnly: "screen-only mode",
  sceneLayouts: "per-tile layout",
  sceneDecorations: "decorations",
  sceneTransforms: "layout moves",
  art: "AI art settings",
};

/** A short, human summary of which top-level design.json fields differ. */
export function diffSummary(from: Record<string, unknown>, to: Record<string, unknown>): string {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  const parts: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(from[key]) === JSON.stringify(to[key])) continue;
    if (key === "copy") {
      const fromCopy = (from.copy as Record<string, unknown>) ?? {};
      const toCopy = (to.copy as Record<string, unknown>) ?? {};
      const ids = new Set([...Object.keys(fromCopy), ...Object.keys(toCopy)]);
      let changed = 0;
      for (const id of ids) {
        if (JSON.stringify(fromCopy[id]) !== JSON.stringify(toCopy[id])) changed++;
      }
      if (changed > 0) parts.push(`copy edited on ${changed} tile${changed === 1 ? "" : "s"}`);
      continue;
    }
    parts.push(KEY_LABELS[key] ?? key);
  }
  return parts.length > 0 ? parts.join(", ") : "no change";
}

/**
 * Moves an about-to-be-overwritten generated art file into
 * `<artDir>/.history/<id>-<sanitized-iso><ext>`, so `goldie art --force` (or
 * a changed prompt) never silently loses the previous render. A no-op when
 * the file does not exist yet.
 */
export async function snapshotArtFile(artDir: string, id: string, file: string): Promise<void> {
  const dir = join(artDir, ".history");
  const ext = file.slice(file.lastIndexOf("."));
  const dest = join(dir, `${id}-${toId(new Date().toISOString())}${ext}`);
  try {
    await mkdir(dir, { recursive: true });
    await rename(file, dest);
  } catch (err) {
    if ((err as { code?: string }).code !== "ENOENT") throw err;
  }
}
