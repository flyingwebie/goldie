import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  diffSummary,
  listHistory,
  readHistoryDesign,
  restoreHistory,
  snapshotBeforeWrite,
} from "./history.ts";

async function tmpConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "goldie-history-"));
  return join(dir, "goldie.config.ts");
}

describe("diffSummary", () => {
  test("reports no change for identical designs", () => {
    expect(diffSummary({ background: "a" }, { background: "a" })).toBe("no change");
  });

  test("names the changed fields", () => {
    expect(diffSummary({ background: "a" }, { background: "b", fontFamily: "x" })).toContain(
      "background",
    );
  });

  test("counts tiles with edited copy", () => {
    const from = { copy: { home: { headline: { en: "old" } } } };
    const to = { copy: { home: { headline: { en: "new" } }, search: { headline: { en: "x" } } } };
    expect(diffSummary(from, to)).toBe("copy edited on 2 tiles");
  });
});

describe("snapshotBeforeWrite + listHistory", () => {
  test("skips the first write (nothing to preserve)", async () => {
    const configPath = await tmpConfigPath();
    await snapshotBeforeWrite(configPath, null);
    expect(await listHistory(configPath, {})).toEqual([]);
  });

  test("snapshots the previous content once it changes", async () => {
    const configPath = await tmpConfigPath();
    await snapshotBeforeWrite(configPath, JSON.stringify({ background: "a" }));
    const entries = await listHistory(configPath, { background: "b" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.summary).toContain("background");
  });

  test("skips an identical consecutive snapshot", async () => {
    const configPath = await tmpConfigPath();
    const content = JSON.stringify({ background: "a" });
    await snapshotBeforeWrite(configPath, content);
    await snapshotBeforeWrite(configPath, content); // same content again
    const entries = await listHistory(configPath, { background: "a" });
    expect(entries).toHaveLength(1);
  });

  test("keeps multiple snapshots, newest first", async () => {
    const configPath = await tmpConfigPath();
    await snapshotBeforeWrite(configPath, JSON.stringify({ background: "a" }));
    await new Promise((r) => setTimeout(r, 5));
    await snapshotBeforeWrite(configPath, JSON.stringify({ background: "b" }));
    const entries = await listHistory(configPath, { background: "c" });
    expect(entries).toHaveLength(2);
    expect(Date.parse(entries[0]!.timestamp)).toBeGreaterThan(Date.parse(entries[1]!.timestamp));
  });
});

describe("restoreHistory", () => {
  test("returns the snapshot's design and snapshots the current content first", async () => {
    const configPath = await tmpConfigPath();
    await snapshotBeforeWrite(configPath, JSON.stringify({ background: "a" }));
    const entries = await listHistory(configPath, { background: "b" });
    const targetId = entries[0]!.id;

    const restored = await restoreHistory(
      configPath,
      targetId,
      JSON.stringify({ background: "b" }),
    );
    expect(restored).toEqual({ background: "a" });

    // The "current" (b) content is now itself a snapshot, so restoring is undoable.
    const after = await listHistory(configPath, { background: "a" });
    expect(after.length).toBe(2);
  });

  test("returns null for an unknown id", async () => {
    const configPath = await tmpConfigPath();
    expect(await restoreHistory(configPath, "nope", null)).toBeNull();
  });
});

describe("readHistoryDesign", () => {
  test("reads one snapshot's raw payload", async () => {
    const configPath = await tmpConfigPath();
    await snapshotBeforeWrite(configPath, JSON.stringify({ background: "a" }));
    const [entry] = await listHistory(configPath, {});
    expect(await readHistoryDesign(configPath, entry!.id)).toEqual({ background: "a" });
  });

  test("returns null for an unknown id", async () => {
    const configPath = await tmpConfigPath();
    expect(await readHistoryDesign(configPath, "nope")).toBeNull();
  });
});
