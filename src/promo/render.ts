/**
 * Renders a HyperFrames composition directory to an MP4 by spawning the
 * `hyperframes` CLI, pinned to an exact version via `npx -y hyperframes@<v>`
 * so a promo render is reproducible across machines and does not depend on
 * whatever happens to run goldie itself (Bun, or a Node older than
 * HyperFrames' own floor). HyperFrames needs Node >= 22 and a headless
 * Chrome it manages itself; goldie's own engines stay >= 20.12 (see
 * doctor.ts, README, skills/goldie/references/promo.md).
 */
import { spawn } from "node:child_process";

/** The HyperFrames version every goldie release renders with; bump deliberately. */
export const HYPERFRAMES_VERSION = "0.8.181";

function pkg(bin = "hyperframes"): string {
  return `${bin}@${HYPERFRAMES_VERSION}`;
}

/**
 * Spawns `npx -y hyperframes@<pinned> <args>`, streaming stdout/stderr
 * through `onLine` (one call per line) as the render progresses.
 */
function run(args: string[], onLine?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["-y", pkg(), ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const relay = (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      if (onLine) {
        for (const line of text.split("\n")) if (line.trim()) onLine(line);
      }
    };
    child.stdout.on("data", relay);
    child.stderr.on("data", relay);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`hyperframes ${args.join(" ")} exited ${code}\n${stderr.trim()}`)),
    );
  });
}

export type RenderQuality = "draft" | "looks" | "delivery" | "standard" | "high";

/**
 * Renders `compositionDir`'s index.html to `outputFile` (an .mp4) at `fps`
 * and `quality`, relaying HyperFrames' own progress lines through `onLine`.
 */
export async function renderComposition(
  compositionDir: string,
  outputFile: string,
  opts: { fps: number; quality: RenderQuality; onLine?: (line: string) => void },
): Promise<void> {
  await run(
    [
      "render",
      compositionDir,
      "-o",
      outputFile,
      "--fps",
      String(opts.fps),
      "--quality",
      opts.quality,
      "--format",
      "mp4",
    ],
    opts.onLine,
  );
}

export type HyperframesDoctorCheck = { name: string; ok: boolean; detail: string };

/**
 * Runs `hyperframes doctor --json` and reports only what a promo render
 * needs (Node, FFmpeg, FFprobe, Chrome) - not HyperFrames' optional
 * transcription/TTS/music/Docker checks, which goldie never uses.
 */
export async function hyperframesDoctor(): Promise<{
  ok: boolean;
  checks: HyperframesDoctorCheck[];
}> {
  const RELEVANT = ["Node.js", "FFmpeg", "FFprobe", "Chrome"];
  let stdout = "";
  try {
    await run(["doctor", "--json"], (line) => {
      stdout += `${line}\n`;
    });
  } catch {
    // doctor --json always exits 0 per HyperFrames' own docs; a non-zero
    // exit here means npx itself failed (no network, no Node, ...).
    return {
      ok: false,
      checks: [
        {
          name: "hyperframes doctor",
          ok: false,
          detail: stdout.trim() || "could not run `npx hyperframes doctor`",
        },
      ],
    };
  }
  try {
    const parsed = JSON.parse(stdout) as {
      checks: Array<{ name: string; ok: boolean; detail: string }>;
    };
    const checks = parsed.checks.filter((c) => RELEVANT.includes(c.name));
    return { ok: checks.every((c) => c.ok), checks };
  } catch {
    return {
      ok: false,
      checks: [{ name: "hyperframes doctor", ok: false, detail: `unparseable output:\n${stdout}` }],
    };
  }
}
