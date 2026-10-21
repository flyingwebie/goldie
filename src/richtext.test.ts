import { describe, expect, test } from "bun:test";
import { lineText, mapRuns, parseEmphasis, stripEmphasis, wrapRuns } from "./richtext.ts";

describe("parseEmphasis", () => {
  test("splits stressed runs from plain ones", () => {
    expect(parseEmphasis("Clear your *head*")).toEqual([
      { text: "Clear your ", em: false },
      { text: "head", em: true },
    ]);
  });

  test("keeps an unmatched asterisk as text", () => {
    expect(parseEmphasis("5* rated")).toEqual([{ text: "5* rated", em: false }]);
  });

  test("an escaped asterisk draws literally", () => {
    expect(stripEmphasis("Top \\*10\\* *apps*")).toBe("Top *10* apps");
  });

  test("an empty pair is not emphasis", () => {
    expect(parseEmphasis("a ** b")).toEqual([{ text: "a ** b", em: false }]);
  });

  test("uppercasing keeps the stress", () => {
    const runs = mapRuns(parseEmphasis("your *music* is safe"), (s) => s.toUpperCase());
    expect(runs.map((r) => r.em)).toEqual([false, true, false]);
    expect(runs[1]!.text).toBe("MUSIC");
  });
});

describe("wrapRuns", () => {
  // Every character is 10 units wide; stressed ones 15, like a wider script face.
  const measure = (t: string, em: boolean) => t.length * (em ? 15 : 10);

  test("wraps at word boundaries within the width", () => {
    const lines = wrapRuns(parseEmphasis("Find any item in seconds"), 120, measure);
    expect(lines.map(lineText)).toEqual(["Find any", "item in", "seconds"]);
  });

  test("measures stressed words in their own style", () => {
    const lines = wrapRuns(parseEmphasis("ab *cdef* gh"), 90, measure);
    // "ab " = 30, "cdef" = 60: fits exactly at 90; " gh" moves down.
    expect(lines.map(lineText)).toEqual(["ab cdef", "gh"]);
    expect(lines[0]!.at(-1)).toEqual({ text: "cdef", em: true });
  });

  test("honours explicit newlines and trims line ends", () => {
    const lines = wrapRuns(parseEmphasis("One\n*two* three "), 1000, measure);
    expect(lines.map(lineText)).toEqual(["One", "two three"]);
  });

  test("a stressed phrase can break across lines and stays stressed", () => {
    const lines = wrapRuns(parseEmphasis("in *ten short seconds*"), 130, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(
      lines
        .flat()
        .filter((s) => s.em)
        .map((s) => s.text.trim()),
    ).toContain("seconds");
  });
});
