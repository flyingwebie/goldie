import { type Dirent, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";

/**
 * `goldie discover`: a static scan of the app repo for screens, so the
 * skill (and the studio's Plan view) can ask "which features, which
 * screens" from a list goldie already found, instead of a blank page.
 * Nothing here drives a simulator; it only reads source files.
 *
 * The scan fills `screens[]` (and prints feature hints to the log) from
 * whatever framework markers it recognizes. `features[]` is never written
 * by the scan itself - the agent (or the studio's Plan view) writes it, and
 * merge mode (the default) keeps that, and any screen thumbnail/notes/
 * featureIds the agent added, across a re-run.
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
  /** A URL-style route, for router-based sources. */
  route?: string;
  /** Path relative to `app.root`. */
  file?: string;
  source: ScreenSource;
  /** Path relative to the goldie dir, per the Discovery type's doc comment. */
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

export type DiscoverOptions = {
  appRoot: string;
  appName?: string;
  /** Defaults to `<appRoot>/.argent/flows`. */
  flowsDir?: string;
  /** The previous discovery.json, when merging forward. */
  existing?: Discovery;
  /** Discard every agent-written field and rescan clean. Default false (merge). */
  fresh?: boolean;
  log?: (line: string) => void;
};

const IGNORED_DIRS = new Set([
  "node_modules",
  "build",
  "dist",
  "out",
  "coverage",
  "ios",
  "android",
  ".expo",
  ".next",
  ".turbo",
  ".cache",
  ".git",
]);

type FileVisitor = (file: string) => void;

async function walk(dir: string, onFile: FileVisitor): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, onFile);
    else onFile(full);
  }
}

async function collectFiles(root: string, exts: string[]): Promise<string[]> {
  const files: string[] = [];
  await walk(root, (f) => {
    if (exts.includes(extname(f))) files.push(f);
  });
  return files;
}

/** "my-cool_thing" / "myCoolThing" -> "My Cool Thing". */
function humanize(s: string): string {
  const spaced = s
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return s;
  return spaced
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function idFromFile(root: string, file: string, prefix: string): string {
  const rel = relative(root, file).replace(/\.[^./]+$/, "");
  return `${prefix}-${slug(rel)}`;
}

async function readSafe(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Expo Router
// ---------------------------------------------------------------------------

const EXPO_ROUTE_SKIP = /^(_layout|\+not-found|\+html)\./;
const EXPO_API_ROUTE = /\+api\.(t|j)sx?$/;
const EXPO_EXTS = [".tsx", ".ts", ".jsx", ".js"];

/** `app/` and `src/app/` at the root, plus `apps/<name>/app` and `apps/<name>/src/app` for a monorepo. */
async function expoRouterDirs(appRoot: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const rel of ["app", "src/app"]) {
    const dir = join(appRoot, rel);
    if (existsSync(dir)) dirs.push(dir);
  }
  const appsDir = join(appRoot, "apps");
  if (existsSync(appsDir)) {
    let entries: Dirent[] = [];
    try {
      entries = await readdir(appsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      for (const rel of ["app", "src/app"]) {
        const dir = join(appsDir, entry.name, rel);
        if (existsSync(dir)) dirs.push(dir);
      }
    }
  }
  return dirs;
}

/** `(app)/(tabs)/index` -> "/"; `missioni/[missionId]` -> "/missioni/[missionId]". */
function expoRoute(appDir: string, file: string): string {
  const rel = relative(appDir, file).replace(/\.[^./]+$/, "");
  const segments = rel.split("/").filter((s) => !/^\(.*\)$/.test(s));
  if (segments.at(-1) === "index") segments.pop();
  return `/${segments.join("/")}`;
}

function expoTitle(content: string, route: string, file: string): string {
  const fn = content.match(/export\s+default\s+function\s+([A-Za-z0-9_]+)/);
  if (fn) return humanize(fn[1]!.replace(/(Screen|Page)$/, ""));
  const option = content.match(/(?:title|headerTitle)\s*:\s*["'`]([^"'`]+)["'`]/);
  if (option) return option[1]!;
  const last = route.split("/").filter(Boolean).pop();
  const seg = last ?? basename(file).replace(/\.[^./]+$/, "");
  return humanize(seg.replace(/^\[\.{3}/, "").replace(/^\[|\]$/g, ""));
}

async function scanExpoRouter(appRoot: string): Promise<DiscoveredScreen[]> {
  const dirs = await expoRouterDirs(appRoot);
  const screens: DiscoveredScreen[] = [];
  for (const appDir of dirs) {
    const files = await collectFiles(appDir, EXPO_EXTS);
    for (const file of files.sort()) {
      const name = basename(file);
      if (EXPO_ROUTE_SKIP.test(name) || EXPO_API_ROUTE.test(file)) continue;
      const route = expoRoute(appDir, file);
      const content = await readSafe(file);
      screens.push({
        id: idFromFile(appRoot, file, "expo"),
        title: expoTitle(content, route, file),
        route,
        file: relative(appRoot, file),
        source: "expo-router",
      });
    }
  }
  return screens;
}

// ---------------------------------------------------------------------------
// React Navigation
// ---------------------------------------------------------------------------

/**
 * `<Stack.Screen name="Home" component={HomeScreen} options={{ title: "..." }} />`,
 * from `createNativeStackNavigator`/`createStackNavigator`/`createBottomTabNavigator`
 * screens. Expo Router's own `_layout.tsx` files use the same `<Stack.Screen>`
 * JSX to configure a route it already found, so those are skipped here too -
 * otherwise every Expo Router project would double-report its routes.
 */
const RN_SCREEN = /<\s*[\w.]*Screen\b([^>]*)\/?>/g;

function scanReactNavigationFile(
  content: string,
  file: string,
  appRoot: string,
): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];
  for (const m of content.matchAll(RN_SCREEN)) {
    const attrs = m[1] ?? "";
    const name = attrs.match(/\bname\s*=\s*["'{]([^"'}]+)/)?.[1];
    if (!name) continue;
    const component = attrs.match(/\bcomponent\s*=\s*\{?\s*([A-Za-z0-9_.]+)/)?.[1];
    const title = attrs.match(/title\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    screens.push({
      id: `rn-${slug(relative(appRoot, file))}-${slug(name)}`,
      title: title ?? humanize(name),
      source: "react-navigation",
      file: relative(appRoot, file),
      notes: component ? `component ${component}` : undefined,
    });
  }
  return screens;
}

// ---------------------------------------------------------------------------
// SwiftUI / Jetpack Compose / Flutter
// ---------------------------------------------------------------------------

const SWIFTUI_STRUCT = /struct\s+([A-Za-z0-9_]+(?:View|Screen))\s*:\s*[^{]*\bView\b/g;
const COMPOSE_FUN = /@Composable[\s\S]{0,80}?fun\s+([A-Za-z0-9_]+Screen)\s*\(/g;
const FLUTTER_CLASS =
  /class\s+([A-Za-z0-9_]+Screen)\s+extends\s+(StatelessWidget|StatefulWidget)\b/g;
/** `'/path': (context) => const SomeScreen()` inside a Flutter `routes:` map. */
const FLUTTER_ROUTE = /['"]([^'"]+)['"]\s*:\s*\([^)]*\)\s*=>[^,}]*?([A-Za-z0-9_]+Screen)\b/g;

function scanWithRegex(
  content: string,
  file: string,
  appRoot: string,
  source: ScreenSource,
  re: RegExp,
  extraNotes?: (name: string) => string | undefined,
): DiscoveredScreen[] {
  const screens: DiscoveredScreen[] = [];
  for (const m of content.matchAll(re)) {
    const name = m[1]!;
    screens.push({
      id: `${source}-${slug(relative(appRoot, file))}-${slug(name)}`,
      title: humanize(name.replace(/(View|Screen)$/, "")),
      file: relative(appRoot, file),
      source,
      notes: extraNotes?.(name),
    });
  }
  return screens;
}

function flutterRoutes(content: string): Map<string, string> {
  const routes = new Map<string, string>();
  for (const m of content.matchAll(FLUTTER_ROUTE)) routes.set(m[2]!, m[1]!);
  return routes;
}

// ---------------------------------------------------------------------------
// argent flows
// ---------------------------------------------------------------------------

/** Short, distinct `text:` hints a flow's steps mention, as a loose "what it reaches". */
function flowTextHints(yaml: string): string[] {
  const seen = new Set<string>();
  for (const m of yaml.matchAll(/text:\s*["']?([^"'\n]{2,40})["']?/g)) {
    const text = m[1]!.trim();
    if (text) seen.add(text);
    if (seen.size >= 5) break;
  }
  return [...seen];
}

async function scanFlows(appRoot: string, flowsDir: string): Promise<DiscoveredScreen[]> {
  if (!existsSync(flowsDir)) return [];
  const files = await collectFiles(flowsDir, [".yaml", ".yml"]);
  const screens: DiscoveredScreen[] = [];
  for (const file of files.sort()) {
    const content = await readSafe(file);
    const hints = flowTextHints(content);
    screens.push({
      id: idFromFile(flowsDir, file, "flow"),
      title: humanize(basename(file).replace(/\.ya?ml$/, "")),
      file: relative(appRoot, file),
      source: "flow",
      notes: hints.length > 0 ? `reaches: ${hints.join(", ")}` : undefined,
    });
  }
  return screens;
}

// ---------------------------------------------------------------------------
// Feature hints (printed, not written to discovery.json - see module doc)
// ---------------------------------------------------------------------------

async function readmeBullets(appRoot: string): Promise<string[]> {
  for (const name of ["README.md", "readme.md"]) {
    const file = join(appRoot, name);
    if (!existsSync(file)) continue;
    const content = await readSafe(file);
    const bullets = content
      .split("\n")
      .filter((l) => /^\s*[-*]\s+/.test(l))
      .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
      .filter(Boolean);
    return bullets.slice(0, 20);
  }
  return [];
}

async function i18nPresence(appRoot: string): Promise<string[]> {
  const found: string[] = [];
  await walk(appRoot, (f) => {
    if (/[/\\]i18n[/\\]|[/\\]locales[/\\]/.test(f) && /\.(json|ts|js)$/.test(f)) found.push(f);
  });
  return [...new Set(found.map((f) => dirname(f)))].slice(0, 5);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** `goldieDir` is the directory discovery.json lives directly inside - normally `cfg.root`. */
export function discoveryPath(goldieDir: string): string {
  return join(goldieDir, "discovery.json");
}

/** Runs every parser and returns the discovery result; does not write a file. */
export async function discover(opts: DiscoverOptions): Promise<Discovery> {
  const { appRoot } = opts;
  const log = opts.log ?? (() => {});
  const flowsDir = opts.flowsDir ?? join(appRoot, ".argent", "flows");

  const screens: DiscoveredScreen[] = [];
  screens.push(...(await scanExpoRouter(appRoot)));

  const tsFiles = await collectFiles(appRoot, [".tsx", ".ts", ".jsx", ".js"]);
  for (const file of tsFiles) {
    if (/^_layout\./.test(basename(file))) continue; // owned by Expo Router's own pass
    const content = await readSafe(file);
    if (content.includes("Screen"))
      screens.push(...scanReactNavigationFile(content, file, appRoot));
  }

  const swiftFiles = await collectFiles(appRoot, [".swift"]);
  for (const file of swiftFiles) {
    const content = await readSafe(file);
    screens.push(...scanWithRegex(content, file, appRoot, "swiftui", SWIFTUI_STRUCT));
  }

  const ktFiles = await collectFiles(appRoot, [".kt"]);
  for (const file of ktFiles) {
    const content = await readSafe(file);
    screens.push(...scanWithRegex(content, file, appRoot, "compose", COMPOSE_FUN));
  }

  const dartFiles = await collectFiles(appRoot, [".dart"]);
  for (const file of dartFiles) {
    const content = await readSafe(file);
    const routes = flutterRoutes(content);
    screens.push(
      ...scanWithRegex(content, file, appRoot, "flutter", FLUTTER_CLASS, (name) =>
        routes.has(name) ? `route ${routes.get(name)}` : undefined,
      ).map((s) => {
        const route = [...routes.entries()].find(([widget]) => s.id.endsWith(slug(widget)));
        return route ? { ...s, route: route[1] } : s;
      }),
    );
  }

  screens.push(...(await scanFlows(appRoot, flowsDir)));

  const bullets = await readmeBullets(appRoot);
  if (bullets.length > 0) {
    log(`README feature hints:\n${bullets.map((b) => `  - ${b}`).join("\n")}`);
  }
  const i18nDirs = await i18nPresence(appRoot);
  if (i18nDirs.length > 0) log(`i18n files found under: ${i18nDirs.join(", ")}`);

  const existing = opts.fresh ? undefined : opts.existing;
  const merged = mergeScreens(screens, existing?.screens ?? []);

  return {
    generatedAt: new Date().toISOString(),
    app: { name: opts.appName ?? basename(appRoot), root: appRoot },
    screens: merged,
    features: opts.fresh ? [] : (existing?.features ?? []),
  };
}

/** Keeps the agent-written thumbnail/featureIds/notes for a screen id the fresh scan still finds. */
function mergeScreens(fresh: DiscoveredScreen[], previous: DiscoveredScreen[]): DiscoveredScreen[] {
  const byId = new Map(previous.map((s) => [s.id, s]));
  const merged = fresh.map((s) => {
    const prev = byId.get(s.id);
    if (!prev) return s;
    return {
      ...s,
      thumbnail: prev.thumbnail ?? s.thumbnail,
      featureIds: prev.featureIds ?? s.featureIds,
      notes: s.notes ?? prev.notes,
    };
  });
  // Agent-added screens (source: "agent") have no file for the scan to
  // rediscover; keep them as they were.
  for (const prev of previous) {
    if (prev.source === "agent" && !merged.some((s) => s.id === prev.id)) merged.push(prev);
  }
  return merged;
}

export async function readDiscovery(goldieDir: string): Promise<Discovery | undefined> {
  try {
    const text = await readFile(discoveryPath(goldieDir), "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Discovery) : undefined;
  } catch {
    return undefined;
  }
}

export async function writeDiscovery(goldieDir: string, discovery: Discovery): Promise<string> {
  const file = discoveryPath(goldieDir);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(discovery, null, 2)}\n`);
  await rename(tmp, file);
  return file;
}

/** Runs the scan against whatever discovery.json already exists at `goldieDir`, and writes the result. */
export async function runDiscover(
  goldieDir: string,
  opts: Omit<DiscoverOptions, "existing">,
): Promise<{ file: string; discovery: Discovery }> {
  const existing = opts.fresh ? undefined : await readDiscovery(goldieDir);
  const discovery = await discover({ ...opts, existing });
  const file = await writeDiscovery(goldieDir, discovery);
  return { file, discovery };
}

// ---------------------------------------------------------------------------
// Plan: which features and screens to build the story around - the user's
// choice, or "let goldie decide" (src/discover.ts owns the type and the
// file I/O; src/studio-server.ts exposes it as GET/PUT /api/plan).
// ---------------------------------------------------------------------------

export type Plan = {
  updatedAt: string;
  decide: "user" | "goldie";
  /** Feature ids, in story order. */
  features: string[];
  /** Screen ids, in story order. */
  screens: string[];
  notes?: string;
};

/** `goldieDir` is the directory plan.json lives directly inside - normally `cfg.root`. */
export function planPath(goldieDir: string): string {
  return join(goldieDir, "plan.json");
}

export async function readPlan(goldieDir: string): Promise<Plan | undefined> {
  try {
    const text = await readFile(planPath(goldieDir), "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Plan) : undefined;
  } catch {
    return undefined;
  }
}

export async function writePlan(goldieDir: string, plan: Plan): Promise<string> {
  const file = planPath(goldieDir);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(plan, null, 2)}\n`);
  await rename(tmp, file);
  return file;
}
