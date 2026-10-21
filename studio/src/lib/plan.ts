/**
 * Client for `/api/plan` (src/studio-server.ts, src/discover.ts). The types
 * below mirror Discovery/Plan rather than importing src/discover.ts
 * directly: that module reads the filesystem (node:fs/promises), which has
 * no place in the browser bundle.
 */

export type ScreenSource =
  | "expo-router"
  | "react-navigation"
  | "swiftui"
  | "compose"
  | "flutter"
  | "flow"
  | "agent";

export type DiscoveredScreen = {
  id: string;
  title: string;
  route?: string;
  file?: string;
  source: ScreenSource;
  /** Path relative to the goldie dir; fetchable via `thumbnailUrl`. */
  thumbnail?: string;
  featureIds?: string[];
  notes?: string;
};

export type DiscoveredFeature = {
  id: string;
  title: string;
  description: string;
  screenIds: string[];
  evidence?: string[];
};

export type Discovery = {
  generatedAt: string;
  app: { name: string; root: string };
  screens: DiscoveredScreen[];
  features: DiscoveredFeature[];
};

export type Plan = {
  updatedAt: string;
  decide: "user" | "goldie";
  features: string[];
  screens: string[];
  notes?: string;
};

export type PlanResponse = { discovery: Discovery; plan: Plan | null };

/** No goldie/discovery.json yet; `command` is what to run to create one. */
export class PlanError extends Error {
  constructor(
    message: string,
    readonly command: string,
  ) {
    super(message);
  }
}

export async function loadPlan(): Promise<PlanResponse> {
  const res = await fetch("/api/plan", { cache: "no-store" });
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    throw new PlanError(
      (body.error as string) ?? "No discovery yet.",
      (body.command as string) ?? "goldie discover",
    );
  }
  if (!res.ok) throw new Error(`Loading the plan failed: ${await res.text()}`);
  return (await res.json()) as PlanResponse;
}

export async function savePlan(plan: Omit<Plan, "updatedAt">): Promise<Plan> {
  const res = await fetch("/api/plan", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plan),
  });
  if (!res.ok) throw new Error(`Saving the plan failed: ${await res.text()}`);
  const body = await res.json();
  return body.plan as Plan;
}

/** A thumbnail's fetchable url, via the same traversal-safe endpoint the art library uses. */
export function thumbnailUrl(relPath: string): string {
  return `/api/art-library/file?src=${encodeURIComponent(relPath)}`;
}
