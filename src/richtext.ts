/**
 * Headline emphasis: words wrapped in asterisks ("Clear your *head*") are
 * stressed, and the theme's emphasis style decides how they stand out. Pure,
 * with no node imports, so the CLI renderer and the studio parse copy the
 * same way.
 */

export type Run = { text: string; em: boolean };

/**
 * Splits copy into plain and stressed runs. An unmatched asterisk is kept as
 * text, so a stray "*" in a headline never swallows the rest of it, and `\*`
 * draws a literal asterisk.
 */
export function parseEmphasis(text: string): Run[] {
  const runs: Run[] = [];
  let buf = "";
  let em = false;
  const push = () => {
    if (buf) runs.push({ text: buf, em });
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\" && text[i + 1] === "*") {
      buf += "*";
      i++;
      continue;
    }
    if (ch === "*" && (em || hasClosing(text, i + 1))) {
      push();
      em = !em;
      continue;
    }
    buf += ch;
  }
  push();
  return merge(runs);
}

function hasClosing(text: string, from: number): boolean {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\\" && text[i + 1] === "*") i++;
    else if (text[i] === "*") return i > from;
  }
  return false;
}

function merge(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.em === r.em) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

/** The copy with its emphasis markers removed: what a reader sees. */
export function stripEmphasis(text: string): string {
  return parseEmphasis(text)
    .map((r) => r.text)
    .join("");
}

/** Applies a text transform (uppercase) to every run, keeping the stress. */
export function mapRuns(runs: Run[], fn: (s: string) => string): Run[] {
  return runs.map((r) => ({ ...r, text: fn(r.text) }));
}

export type Segment = Run;
export type RichLine = Segment[];

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/**
 * Splits a run at the points a line may break, keeping its stress. Spaces and
 * punctuation glue to the preceding unit, so a line never starts with them;
 * CJK copy, which uses no spaces, still breaks between words.
 */
function units(run: Run): Run[] {
  const out: Run[] = [];
  for (const s of segmenter.segment(run.text)) {
    if (s.isWordLike || out.length === 0) out.push({ text: s.segment, em: run.em });
    else out[out.length - 1]!.text += s.segment;
  }
  return out;
}

/**
 * Word-wraps runs to `maxWidth`, honouring explicit newlines. `measure` gives
 * the drawn width of a piece of text in its run's style, so a stressed word in
 * a wider script face wraps where it really ends.
 */
export function wrapRuns(
  runs: Run[],
  maxWidth: number,
  measure: (text: string, em: boolean) => number,
): RichLine[] {
  const paragraphs: Run[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) paragraphs.push([]);
      if (part) paragraphs[paragraphs.length - 1]!.push({ text: part, em: run.em });
    });
  }

  const lineWidth = (line: RichLine) =>
    line.reduce((sum, seg, i) => {
      const text = i === line.length - 1 ? seg.text.trimEnd() : seg.text;
      return sum + measure(text, seg.em);
    }, 0);

  const lines: RichLine[] = [];
  for (const paragraph of paragraphs) {
    let line: RichLine = [];
    const flat = paragraph.flatMap((r) => units({ text: r.text.replace(/\s+/g, " "), em: r.em }));
    // Leading whitespace of a paragraph never draws.
    if (flat[0]) flat[0] = { ...flat[0], text: flat[0].text.trimStart() };
    for (const unit of flat) {
      if (!unit.text) continue;
      const next = appendUnit(line, unit);
      if (line.length > 0 && lineWidth(next) > maxWidth) {
        lines.push(trimLine(line));
        line = [{ ...unit }];
      } else {
        line = next;
      }
    }
    lines.push(trimLine(line));
  }
  return lines;
}

function appendUnit(line: RichLine, unit: Run): RichLine {
  const last = line[line.length - 1];
  if (last && last.em === unit.em) {
    return [...line.slice(0, -1), { text: last.text + unit.text, em: last.em }];
  }
  return [...line, { ...unit }];
}

function trimLine(line: RichLine): RichLine {
  if (line.length === 0) return line;
  const out = line.map((s) => ({ ...s }));
  out[out.length - 1]!.text = out[out.length - 1]!.text.trimEnd();
  return out.filter((s) => s.text.length > 0);
}

/** Plain text of a wrapped line. */
export function lineText(line: RichLine): string {
  return line.map((s) => s.text).join("");
}
