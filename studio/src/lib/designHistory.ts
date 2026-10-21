/**
 * Client for `/api/history*` (src/studio-server.ts, src/history.ts):
 * persistent version history for goldie.design.json, so a mistake survives
 * a reload - separate from useHistory.ts's in-session undo/redo stack.
 */

export type HistoryEntry = { id: string; timestamp: string; summary: string };

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const res = await fetch("/api/history", { cache: "no-store" });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body?.entries) ? (body.entries as HistoryEntry[]) : [];
  } catch {
    return []; // a static build has no API
  }
}

/** The raw design payload for one snapshot - loaded into the strip as a preview, not saved. */
export async function loadHistoryDesign(id: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json();
  return (body?.design as Record<string, unknown>) ?? null;
}

/** Snapshots the current design first, then restores; returns the restored payload to apply. */
export async function restoreHistoryEntry(id: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}/restore`, { method: "POST" });
  if (!res.ok) return null;
  const body = await res.json();
  return (body?.design as Record<string, unknown>) ?? null;
}

/** "2 min ago", "3 hours ago", "just now" - coarse enough for a history timeline. */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  const units: Array<[string, number]> = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [label, secondsPerUnit] of units) {
    const value = Math.floor(seconds / secondsPerUnit);
    if (value >= 1) return `${value} ${label}${value === 1 ? "" : "s"} ago`;
  }
  return "just now";
}
