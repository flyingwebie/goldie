/**
 * Client for the lightbox's Redo menu (/api/redo/*, src/studio-server.ts):
 * recapture one scene's flow on the simulator, or regenerate its AI art
 * assets, then re-render and reload. The two "run a job, stream the log"
 * calls mirror ExportPanel.tsx's own fetch/reader loop.
 */

export type RedoAsset = {
  id: string;
  kind: string;
  /** True for an asset every tile draws (the theme's background/backdrop, or a theme-level decoration). */
  shared: boolean;
  /** A human label for a shared asset ("Backdrop (all tiles)"); the asset id otherwise. */
  label: string;
  estimatedUsd: number;
};

export type RedoInfo = { assets: RedoAsset[] };

export async function loadRedoInfo(sceneId: string): Promise<RedoInfo> {
  const res = await fetch(`/api/redo/${encodeURIComponent(sceneId)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load this tile's art assets: ${await res.text()}`);
  return res.json();
}

/** POSTs `url` and streams the plain-text CLI log to `onLine`, one line at a time. Throws on a non-2xx response or a trailing "[failed]" line. */
async function streamJob(
  url: string,
  body: unknown,
  onLine: (line: string) => void,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.body) {
    const text = await res.text();
    if (text) onLine(text);
    throw new Error(res.ok ? "No response body." : text || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let failed = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      onLine(line);
      if (line.startsWith("[failed]")) failed = true;
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer) onLine(buffer);
  if (!res.ok) throw new Error("Request failed; see the log above.");
  if (failed) throw new Error("Job failed; see the log above.");
}

/** Recaptures one scene's flow on `device` (or every configured device, when omitted), then re-renders and refreshes the manifest. */
export function runRedoCapture(
  sceneId: string,
  device: string | undefined,
  onLine: (line: string) => void,
): Promise<void> {
  return streamJob(`/api/redo/${encodeURIComponent(sceneId)}/capture`, { device }, onLine);
}

/** Regenerates the named art assets (`goldie art --force --yes`), then re-renders and refreshes the manifest. */
export function runRedoArt(
  sceneId: string,
  assets: string[],
  onLine: (line: string) => void,
): Promise<void> {
  return streamJob(`/api/redo/${encodeURIComponent(sceneId)}/art`, { assets }, onLine);
}

/** Restores the previous render of one art asset from `<artDir>/.history/`. */
export async function restoreArt(assetId: string): Promise<void> {
  const res = await fetch(`/api/redo/art/${encodeURIComponent(assetId)}/restore`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Restore failed: ${await res.text()}`);
}
