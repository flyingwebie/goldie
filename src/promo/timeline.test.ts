import { describe, expect, test } from "bun:test";
import { buildTimeline, PROMO, slots } from "./timeline.ts";

describe("slots", () => {
  test("the first scene has no entrance push; later ones push in and out", () => {
    const timeline = buildTimeline(3, 3, 2.5);
    const all = slots(timeline);
    expect(all.map((s) => s.slot)).toEqual([
      { kind: "scene", index: 0 },
      { kind: "scene", index: 1 },
      { kind: "scene", index: 2 },
      { kind: "outro" },
    ]);
    // Scene 0 starts in place: enterAt equals its start.
    expect(all[0]!.enterAt).toBe(0);
    expect(all[0]!.start).toBe(0);
    // Scene 1 pushes in `transition` seconds before its start.
    expect(all[1]!.enterAt).toBeCloseTo(3 - PROMO.transition, 6);
    expect(all[1]!.start).toBe(3);
    // Every slot's nextStart is the following slot's start.
    expect(all[0]!.nextStart).toBe(all[1]!.start);
    expect(all[2]!.nextStart).toBe(all[3]!.start);
    // The last slot (the outro) never pushes out.
    expect(all[3]!.nextStart).toBe(Infinity);
  });

  test("with no outro the last scene is the one that never pushes out", () => {
    const timeline = buildTimeline(2, 3, 0);
    const all = slots(timeline);
    expect(all).toHaveLength(2);
    expect(all[1]!.nextStart).toBe(Infinity);
  });
});
