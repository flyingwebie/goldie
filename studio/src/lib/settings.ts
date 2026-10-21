/**
 * Client for `/api/settings*` (src/studio-server.ts): the AI art keys and
 * model/style choices, editable from the studio's Settings view instead of
 * a `.env` file. Keys never round-trip in full - only `last4` for a status
 * chip.
 */

export type KeySource = "env" | "project" | "user" | "app" | null;
export type KeyStatus = { set: boolean; source: KeySource; last4?: string };

export type ModelRole = "final" | "draft" | "both";

export type ArtModel = {
  id: string;
  label: string;
  provider: "openai" | "fal";
  role: ModelRole;
  approxCostUsd: number;
  supportsReferenceImages: boolean;
  nativeTransparency: boolean;
  notes?: string;
};

export type StyleSummary = { label: string; description: string; bestFor: string[] };

export type ArtSettings = {
  /** Whether an art block exists (in the config, or created from these settings). */
  configured: boolean;
  /** Whether it lists any art assets to generate yet. */
  hasAssets: boolean;
  provider: "openai" | "fal";
  model: string | null;
  draftModel: string | null;
  style: string;
};

export type Settings = {
  keys: { openai: KeyStatus; fal: KeyStatus };
  art: ArtSettings;
  models: ArtModel[];
  styles: Record<string, StyleSummary>;
};

export async function loadSettings(): Promise<Settings | null> {
  try {
    const res = await fetch("/api/settings", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Settings;
  } catch {
    return null; // a static build has no API
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function saveKey(
  provider: "openai" | "fal",
  key: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/settings/keys", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, key }),
  });
  const body = await readJson(res);
  if (!res.ok) return { ok: false, error: (body.error as string) ?? `HTTP ${res.status}` };
  return { ok: true };
}

export async function removeKey(provider: "openai" | "fal"): Promise<void> {
  const res = await fetch(`/api/settings/keys/${provider}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Removing the ${provider} key failed: ${await res.text()}`);
}

export async function refreshOpenAiModels(): Promise<{ models?: ArtModel[]; error?: string }> {
  const res = await fetch("/api/settings/models/refresh", { method: "POST" });
  const body = await readJson(res);
  if (!res.ok) return { error: (body.error as string) ?? `HTTP ${res.status}` };
  return { models: body.models as ArtModel[] };
}
