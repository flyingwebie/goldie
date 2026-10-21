import { describe, expect, test } from "bun:test";
import {
  backgroundTween,
  copyLineRise,
  decorationTweens,
  deviceTweens,
  marksReveal,
  outroCtaTweens,
  outroHeadlineLineTween,
  outroIconTweens,
  panTween,
  scenePushTweens,
} from "./choreography.ts";

const H = 1920;

describe("copyLineRise", () => {
  test("the headline rises later than the kicker, each line after the one before", () => {
    const kicker = copyLineRise("#k", "kicker", 0, H, 0);
    const headline0 = copyLineRise("#h0", "headline", 0, H, 0);
    const headline1 = copyLineRise("#h1", "headline", 1, H, 0);
    const subhead0 = copyLineRise("#s0", "subhead", 0, H, 0);
    expect(kicker.position).toBeLessThan(headline0.position);
    expect(headline0.position).toBeLessThan(headline1.position);
    expect(headline1.position).toBeLessThan(subhead0.position);
  });

  test("offsets shift by the scene's global entrance time", () => {
    const a = copyLineRise("#h", "headline", 0, H, 0);
    const b = copyLineRise("#h", "headline", 0, H, 5);
    expect(b.position - a.position).toBeCloseTo(5, 6);
  });
});

describe("marksReveal", () => {
  test("starts after the headline has risen and reveals via clip-path", () => {
    const rise = copyLineRise("#h", "headline", 0, H, 0);
    const reveal = marksReveal("#m", 0);
    expect(reveal.position).toBeGreaterThan(rise.position + (rise.duration ?? 0));
    expect(reveal.from?.clipPath).toBe("inset(0% 100% 0% 0%)");
    expect(reveal.to.clipPath).toBe("inset(0% 0% 0% 0%)");
  });
});

describe("deviceTweens", () => {
  test("a later device index starts later, and carries an instant opacity set plus two eased tweens", () => {
    const first = deviceTweens("#d0", 0, H, 0);
    const second = deviceTweens("#d1", 1, H, 0);
    expect(first[0]!.duration).toBeUndefined(); // the opacity .set()
    expect(second[0]!.position).toBeGreaterThan(first[0]!.position);
    expect(first.some((t) => t.ease === "backOut")).toBe(true);
    expect(first.some((t) => t.ease === "cubicOut")).toBe(true);
  });
});

describe("decorationTweens", () => {
  test("a front decoration starts later than a back one at the same order", () => {
    const back = decorationTweens("#b", { kind: "badge" } as never, "back", 0, H, 0);
    const front = decorationTweens("#f", { kind: "badge" } as never, "front", 0, H, 0);
    expect(front[0]!.position).toBeGreaterThan(back[0]!.position);
  });

  test("a callout starts a touch later than a same-order image", () => {
    const image = decorationTweens("#i", { kind: "image" } as never, "back", 0, H, 0);
    const callout = decorationTweens("#c", { kind: "callout" } as never, "back", 0, H, 0);
    expect(callout[0]!.position).toBeGreaterThan(image[0]!.position);
  });

  test("only image and bubble decorations keep floating once landed", () => {
    const image = decorationTweens("#i", { kind: "image" } as never, "back", 0, H, 0);
    const bubble = decorationTweens("#u", { kind: "bubble" } as never, "back", 0, H, 0);
    const badge = decorationTweens("#b", { kind: "badge" } as never, "back", 0, H, 0);
    expect(image.some((t) => t.repeat === -1)).toBe(true);
    expect(bubble.some((t) => t.repeat === -1)).toBe(true);
    expect(badge.some((t) => t.repeat === -1)).toBe(false);
  });
});

describe("scenePushTweens", () => {
  test("the first slot (enterAt === start) has no entrance push", () => {
    const tweens = scenePushTweens("#scene-0", 1080, 0, 0, 3);
    expect(tweens).toHaveLength(1); // exit only
    expect(tweens[0]!.to).toEqual({ x: -1080 });
  });

  test("a later slot pushes in from the right and out to the left", () => {
    const tweens = scenePushTweens("#scene-1", 1080, 2.6, 3, 6);
    expect(tweens).toHaveLength(2);
    expect(tweens[0]!.from).toEqual({ x: 1080 });
    expect(tweens[0]!.to).toEqual({ x: 0 });
    expect(tweens[1]!.to).toEqual({ x: -1080 });
  });

  test("the final slot (nextStart Infinity) never pushes out", () => {
    const tweens = scenePushTweens("#scene-outro", 1080, 10, 10.4, Number.POSITIVE_INFINITY);
    expect(tweens).toHaveLength(1);
    expect(tweens[0]!.to).toEqual({ x: 0 });
  });
});

describe("panTween", () => {
  test("pans the full overhang distance, starting 0.9s into the scene", () => {
    const t = panTween("#pan-0", 1080, 3, 5);
    expect(t.position).toBeCloseTo(5.9, 6);
    expect(t.to).toEqual({ x: -1080 });
  });
});

describe("outro tweens", () => {
  test("icon pops in before the cta, headline lines rise in order", () => {
    const icon = outroIconTweens("#icon", 0);
    const cta = outroCtaTweens("#cta", 0);
    const h0 = outroHeadlineLineTween("#h0", 0, 1920, 0);
    const h1 = outroHeadlineLineTween("#h1", 1, 1920, 0);
    expect(icon[0]!.position).toBeLessThan(cta[0]!.position);
    expect(h0.position).toBeLessThan(h1.position);
  });
});

describe("backgroundTween", () => {
  test("zooms from 1.08 to 1 with no opacity change", () => {
    const t = backgroundTween(
      { id: "bg-image", box: { left: 0, top: 0, width: 1, height: 1 } } as never,
      0,
    );
    expect(t.from).toEqual({ scale: 1.08 });
    expect(t.to).toEqual({ scale: 1 });
    expect(t.to.opacity).toBeUndefined();
  });
});
