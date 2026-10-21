import {
  CameraIcon,
  type LucideIcon,
  SmartphoneIcon,
  TabletIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConceptsView } from "./components/ConceptsView";
import { EmptyState } from "./components/EmptyState";
import { HistoryView } from "./components/HistoryView";
import { PlanView } from "./components/PlanView";
import { PromoView } from "./components/PromoView";
import { SettingsView } from "./components/SettingsView";
import { Sidebar, type Stage } from "./components/Sidebar";
import { Strip, type StripView } from "./components/Strip";
import {
  type HistoryEntry,
  loadHistoryDesign,
  restoreHistoryEntry,
  timeAgo,
} from "./lib/designHistory";
import { useHistory } from "./lib/useHistory";
import {
  type ArtLibraryImage,
  type BundledFont,
  type Decoration,
  type Design,
  type DeviceEntry,
  type DeviceType,
  loadArtLibrary,
  loadDesign,
  loadManifest,
  ManifestError,
  type SavedDesign,
  type SceneCopy,
  type SceneTransform,
  type StoreManifest,
  saveDesign,
} from "./manifest";

/** Sentinel for the config's own layout sequence, which the studio can show but not edit. */
export const CUSTOM_TEMPLATE = "__custom__";

const DEVICE_TYPES: DeviceType[] = ["iphone", "ipad", "android"];

/**
 * Shown when a device-type tab is selected but its device is not in the
 * config. The chip holds the ask to hand a coding agent, which knows the
 * config changes and capture steps from the goldie skill.
 */
const ENABLE_DEVICE_TYPE: Record<
  DeviceType,
  { icon: LucideIcon; title: string; body: string; command: string }
> = {
  iphone: {
    icon: SmartphoneIcon,
    title: "No App Store screenshots yet",
    body: "Ask your coding agent to set them up:",
    command: "create App Store screenshots using goldie",
  },
  ipad: {
    icon: TabletIcon,
    title: "No iPad screenshots yet",
    body: 'Add "ipad-13" to devices in goldie.config.ts, or ask your coding agent:',
    command: "add iPad screenshots using goldie",
  },
  android: {
    icon: SmartphoneIcon,
    title: "No Google Play screenshots yet",
    body: "Ask your coding agent to set them up:",
    command: "create Google Play screenshots using goldie",
  },
};

/** How long the design must sit still before it is written to disk. */
const SAVE_DEBOUNCE_MS = 500;

export function App() {
  const [loaded, setLoaded] = useState<{ manifest: StoreManifest; design: SavedDesign } | null>(
    null,
  );
  const [error, setError] = useState<Error | null>(null);

  // Reloads just the manifest (not the saved design) after a lightbox Redo
  // job finishes: a recapture or an art regeneration changes the pixels
  // `goldie manifest` already wrote, not goldie.design.json.
  const reloadManifest = () =>
    loadManifest().then(
      (manifest) => setLoaded((prev) => (prev ? { ...prev, manifest } : prev)),
      (e: Error) => setError(e),
    );

  useEffect(() => {
    Promise.all([loadManifest(), loadDesign()])
      .then(([manifest, design]) => setLoaded({ manifest, design }))
      .catch((e: Error) => setError(e));
  }, []);

  if (error)
    return (
      <EmptyState
        icon={TriangleAlertIcon}
        title="The studio could not load"
        body={error.message}
        command={error instanceof ManifestError ? error.command : undefined}
      />
    );
  if (!loaded) return null;
  return (
    <Loaded manifest={loaded.manifest} saved={loaded.design} onReloadManifest={reloadManifest} />
  );
}

/**
 * All design state lives here as plain React state: the strip composites the
 * scenes in the browser, so a background or frame change repaints instantly.
 * The CLI only runs when the sidebar's Export button asks for the final files.
 *
 * Two things survive a reload. The design choices (background, frame, font,
 * layout and screen-only mode, per-scene layout overrides, copy edited in the
 * lightbox, the order tiles were dragged into)
 * are written to goldie.design.json next to the config, debounced, so the
 * CLI picks them up too. The view choices (device type, device, locale, dark) only matter
 * here and live in localStorage under the app's name, as does the strip view. Either falls back to
 * the config when a stored value no longer applies (a device or frame
 * variant removed from the config, for instance).
 */
function Loaded({
  manifest,
  saved,
  onReloadManifest,
}: {
  manifest: StoreManifest;
  saved: SavedDesign;
  /** Refetches /store.json after a lightbox Redo job (recapture or art regen) finishes. */
  onReloadManifest: () => void;
}) {
  const design = manifest.design;
  const view = loadView(manifest.app.name);
  // Every device-type tab renders even when only one is configured, so the
  // type is view state of its own: an unconfigured tab has no device key to
  // derive it from. Sessions saved before the iPad tab stored the platform
  // instead; its "ios" is no type, so the saved device picks the tab then.
  const initialType: DeviceType = isDeviceType(view.platform)
    ? view.platform
    : (manifest.devices.find((d) => d.key === view.device)?.type ??
      manifest.devices[0]?.type ??
      "iphone");
  const [deviceType, setDeviceType] = useState(initialType);
  const [device, setDevice] = useState(() => {
    const devices = manifest.devices.filter((d) => d.type === initialType);
    return devices.some((d) => d.key === view.device)
      ? (view.device as string)
      : (devices[0]?.key ?? manifest.devices[0]?.key ?? "");
  });
  const selectDeviceType = (t: DeviceType) => {
    setDeviceType(t);
    const devices = manifest.devices.filter((d) => d.type === t);
    if (devices.length > 0 && !devices.some((d) => d.key === device)) setDevice(devices[0]!.key);
  };
  const [locale, setLocale] = useState(
    view.locale && manifest.locales.includes(view.locale)
      ? view.locale
      : (manifest.locales[0] ?? ""),
  );
  const [dark, setDark] = useState(
    new URLSearchParams(window.location.search).get("dark") === "1" || view.dark === true,
  );
  const [stripView, setStripView] = useState<StripView>(view.view === "grid" ? "grid" : "strip");
  const [stage, setStage] = useState<Stage>("strip");
  const {
    state,
    set: rawSet,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useHistory<DesignState>(() => designStateFromSaved(design, saved));
  // A version-history row loaded into the strip to look at, without saving
  // (the banner below carries Restore/Cancel); any live edit cancels it, so
  // the control the user just touched is never shadowed by a stale preview.
  const [historyPreview, setHistoryPreview] = useState<{
    id: string;
    timestamp: string;
    saved: SavedDesign;
  } | null>(null);
  const set: typeof rawSet = (key, update) => {
    setHistoryPreview(null);
    rawSet(key, update);
  };
  const effectiveState = historyPreview
    ? designStateFromSaved(design, historyPreview.saved)
    : state;
  const {
    background,
    backgroundOverridden,
    frames,
    fontFamily,
    copy,
    layout,
    template,
    screenOnly,
    sceneLayouts,
    order,
    sceneDecorations,
    sceneTransforms,
  } = effectiveState;
  const [artLibrary, setArtLibrary] = useState<ArtLibraryImage[]>([]);
  useEffect(() => {
    loadArtLibrary().then(setArtLibrary);
  }, []);
  // Each setter names its field so a burst of edits to one control (a drag
  // on the gradient picker) collapses into a single undo step.
  const field =
    <K extends keyof DesignState>(key: K) =>
    (value: DesignState[K]) =>
      set(key, (prev) => ({ ...prev, [key]: value }));
  // Picking a background turns the override on for the rest of the session;
  // every scene's own background is cleared from then on, matching the CLI's
  // applyDesign.
  const setBackground = (value: string) =>
    set("background", (prev) => ({ ...prev, background: value, backgroundOverridden: true }));
  // The frame picker edits the variant of the device on show; "" means custom art.
  const frame = frames[device] ?? "";
  const setFrame = (value: string) =>
    set(`frame:${device}`, (prev) => ({ ...prev, frames: { ...prev.frames, [device]: value } }));
  const setFontFamily = field("fontFamily");
  const setLayout = field("layout");
  // Picking a template replaces the strip's layout sequence, so any per-scene
  // overrides made against the previous one are dropped with it.
  const setTemplate = (value: string) =>
    set("template", (prev) => ({ ...prev, template: value, sceneLayouts: {} }));
  const setScreenOnly = field("screenOnly");
  const setOrder = field("order");
  // Per-scene layout overrides; a scene absent there follows the default above.
  const setSceneLayout = (sceneId: string, key: string | undefined) =>
    set("sceneLayouts", (prev) => {
      const next = { ...prev.sceneLayouts };
      if (key) next[sceneId] = key;
      else delete next[sceneId];
      return { ...prev, sceneLayouts: next };
    });
  const setSceneCopy = (
    sceneId: string,
    fieldName: "headline" | "subhead" | "kicker",
    text: string,
  ) =>
    set(`copy:${sceneId}:${fieldName}`, (prev) => ({
      ...prev,
      copy: {
        ...prev.copy,
        [sceneId]: {
          ...prev.copy[sceneId],
          [fieldName]: { ...prev.copy[sceneId]?.[fieldName], [locale]: text },
        },
      },
    }));
  // The element editor's writes: `fieldKey` (e.g. "move:decoration:2") lets a
  // continuous drag coalesce into one undo step, same idea as the controls
  // above - see useHistory's COALESCE_MS.
  const setSceneDecorations = (sceneId: string, list: Decoration[], fieldKey: string) =>
    set(`decorations:${sceneId}:${fieldKey}`, (prev) => ({
      ...prev,
      sceneDecorations: { ...prev.sceneDecorations, [sceneId]: list },
    }));
  const setSceneTransform = (sceneId: string, t: SceneTransform, fieldKey: string) =>
    set(`transform:${sceneId}:${fieldKey}`, (prev) => ({
      ...prev,
      sceneTransforms: { ...prev.sceneTransforms, [sceneId]: t },
    }));
  // "Revert scene"/"Revert all" in the lightbox toolbar: drop the editor's
  // overrides so the scene (or every scene) renders the config's own layout
  // and decorations again.
  const revertScene = (sceneId: string) =>
    set(`revert:${sceneId}`, (prev) => {
      const sceneDecorations = { ...prev.sceneDecorations };
      delete sceneDecorations[sceneId];
      const sceneTransforms = { ...prev.sceneTransforms };
      delete sceneTransforms[sceneId];
      return { ...prev, sceneDecorations, sceneTransforms };
    });
  const revertAll = () =>
    set("revert:all", (prev) => ({ ...prev, sceneDecorations: {}, sceneTransforms: {} }));

  // History view: "Preview" loads a row into the strip without touching
  // the saved design or the undo stack; "Restore" (here or from the
  // banner) snapshots the current design server-side, then applies the
  // restored one as a single undo step, same as any other edit.
  const previewHistory = (entry: HistoryEntry) => {
    loadHistoryDesign(entry.id).then((design_) => {
      if (design_) {
        setHistoryPreview({
          id: entry.id,
          timestamp: entry.timestamp,
          saved: design_ as SavedDesign,
        });
      }
    });
  };
  const cancelHistoryPreview = () => setHistoryPreview(null);
  const restoreHistory = (id: string) => {
    restoreHistoryEntry(id).then((restored) => {
      if (restored) {
        // The server already wrote this restore (and snapshotted what it
        // replaced); the save effect below would otherwise write the exact
        // same content right back a moment later, leaving a pointless extra
        // "no-op" entry in the history it is trying to curate.
        skipNextSave.current = true;
        set("history-restore", () => designStateFromSaved(design, restored as SavedDesign));
      }
    });
  };

  useEffect(() => {
    storeView(manifest.app.name, { platform: deviceType, device, locale, dark, view: stripView });
  }, [manifest.app.name, deviceType, device, locale, dark, stripView]);

  // Write the design to disk once it has sat still for a moment; a drag on
  // the gradient picker fires many changes a second. Skips the initial mount
  // so opening the studio never creates the file by itself. An empty frame
  // means the config's custom bezel art, which has nothing to save. This
  // always saves `state`, never `effectiveState` - a history Preview must
  // never get written to disk just because it sat on screen for a moment.
  const [saveError, setSaveError] = useState<string | null>(null);
  const mounted = useRef(false);
  const skipNextSave = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (historyPreview) return; // previewing: nothing here to persist
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      const chosen = Object.fromEntries(Object.entries(state.frames).filter(([, v]) => v));
      // Read-merge-write: the Settings view saves `art` straight to
      // goldie.design.json between renders of this effect, and a plain
      // overwrite here would wipe it out the next time anything else changes.
      const onDisk = await loadDesign().catch(() => ({}) as SavedDesign);
      saveDesign({
        ...onDisk,
        background: state.backgroundOverridden ? state.background : undefined,
        frames: Object.keys(chosen).length > 0 ? chosen : undefined,
        fontFamily: state.fontFamily,
        copy: Object.keys(state.copy).length > 0 ? state.copy : undefined,
        order: state.order.length > 0 ? state.order : undefined,
        template: state.template === CUSTOM_TEMPLATE ? undefined : state.template,
        layout: state.layout,
        screenOnly: state.screenOnly,
        sceneLayouts: Object.keys(state.sceneLayouts).length > 0 ? state.sceneLayouts : undefined,
        sceneDecorations:
          Object.keys(state.sceneDecorations).length > 0 ? state.sceneDecorations : undefined,
        sceneTransforms:
          Object.keys(state.sceneTransforms).length > 0 ? state.sceneTransforms : undefined,
      }).then(
        () => setSaveError(null),
        (e: Error) => setSaveError(e.message),
      );
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state, historyPreview]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // The bundled typefaces' @font-face rules, declared once in <head>.
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = fontFaces(design.fonts);
    document.head.append(style);
    return () => style.remove();
  }, [design.fonts]);

  // The exporter appends the bundled fallback typefaces as per-glyph last
  // resorts, so the preview does the same; otherwise the browser would silently
  // substitute a system font for characters the chosen stack cannot draw - and
  // the preview would look right where the export does not. Only the bare stack
  // is saved to goldie.design.json.
  const previewFontFamily = ["noto-sans-sc", "noto-sans-arabic"].reduce((stack, key) => {
    const font = design.fonts.find((f) => f.key === key);
    return font && !stack.includes(font.family) ? `${stack}, "${font.family}"` : stack;
  }, fontFamily);

  const typeDevices = manifest.devices.filter((d) => d.type === deviceType);
  const spec = typeDevices.find((d) => d.key === device) ?? typeDevices[0];
  const deviceCaptures = spec ? design.captures[spec.key] : undefined;
  // With localizedCaptures a locale shows only its own captures: falling back to
  // another locale's would put the wrong language on screen.
  const captures = deviceCaptures?.byLocale ? deviceCaptures.byLocale[locale] : deviceCaptures;
  const missingLocale = Boolean(deviceCaptures?.byLocale) && !captures;
  const firstVariant = design.frameVariants.find((v) => v.device === device)?.key;
  const frameUrl = frame
    ? `frames/${frame}.png`
    : (design.customFrameUrl ?? `frames/${firstVariant ?? design.frameVariants[0]?.key}.png`);

  return (
    <div className="flex h-full bg-stage p-3 text-foreground">
      <Sidebar
        manifest={manifest}
        deviceType={deviceType}
        device={device}
        locale={locale}
        dark={dark}
        onDeviceType={selectDeviceType}
        onDevice={setDevice}
        onLocale={setLocale}
        onDark={setDark}
        view={stripView}
        onView={setStripView}
        stage={stage}
        onStage={setStage}
        background={background}
        frame={frame}
        frames={frames}
        fontFamily={fontFamily}
        template={template}
        layout={layout}
        screenOnly={screenOnly}
        onBackground={setBackground}
        onFrame={setFrame}
        onFontFamily={setFontFamily}
        onTemplate={setTemplate}
        onLayout={setLayout}
        onScreenOnly={setScreenOnly}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="relative grid min-h-0 flex-1 place-items-center-safe overflow-auto p-10">
          {historyPreview ? (
            <div className="sticky top-0 z-30 col-span-full mb-4 flex w-full max-w-[1400px] items-center justify-center gap-3 rounded-xl border border-ring bg-popover px-4 py-2 text-xs text-foreground shadow-md">
              <span>
                Previewing version from {timeAgo(historyPreview.timestamp)} ·{" "}
                {new Date(historyPreview.timestamp).toLocaleString()}
              </span>
              <Button size="xs" onClick={() => restoreHistory(historyPreview.id)}>
                Restore
              </Button>
              <Button size="xs" variant="ghost" onClick={cancelHistoryPreview}>
                Cancel
              </Button>
            </div>
          ) : null}
          {stage === "settings" ? (
            <SettingsView />
          ) : stage === "history" ? (
            <HistoryView
              previewingId={historyPreview?.id ?? null}
              onPreview={previewHistory}
              onRestore={restoreHistory}
            />
          ) : stage === "plan" ? (
            <PlanView />
          ) : stage === "promo" && manifest.promo ? (
            <PromoView promo={manifest.promo} locale={locale} />
          ) : stage === "concepts" && manifest.concepts ? (
            <ConceptsView concepts={manifest.concepts} />
          ) : spec && captures ? (
            <div className="w-full max-w-[1400px]">
              <Strip
                design={design}
                captures={captures}
                spec={spec}
                locale={locale}
                background={background}
                backgroundOverridden={backgroundOverridden}
                frameUrl={frameUrl}
                fontFamily={previewFontFamily}
                copy={copy}
                onCopy={setSceneCopy}
                order={order}
                onReorder={setOrder}
                template={
                  template === CUSTOM_TEMPLATE && Array.isArray(design.template)
                    ? design.template
                    : template
                }
                layout={layout}
                screenOnly={screenOnly}
                sceneLayouts={sceneLayouts}
                onSceneLayout={setSceneLayout}
                view={stripView}
                sceneDecorations={sceneDecorations}
                onSceneDecorations={setSceneDecorations}
                sceneTransforms={sceneTransforms}
                onSceneTransform={setSceneTransform}
                artLibrary={artLibrary}
                history={{ canUndo, canRedo, undo, redo }}
                onRevertScene={revertScene}
                onRevertAll={revertAll}
                onReloadManifest={onReloadManifest}
              />
            </div>
          ) : spec ? (
            <EmptyState
              icon={CameraIcon}
              title={
                missingLocale
                  ? `No ${locale} screenshots for the ${deviceLabel(spec)} yet`
                  : `No screenshots for the ${deviceLabel(spec)} yet`
              }
              body={`Ask your coding agent to capture the ${deviceLabel(spec)}, or run:`}
              command={
                missingLocale
                  ? `goldie capture --device ${spec.key} --locale ${locale} && goldie manifest`
                  : "goldie capture && goldie manifest"
              }
            />
          ) : (
            <EmptyState {...ENABLE_DEVICE_TYPE[deviceType]} />
          )}
        </main>
      </div>

      {saveError ? <Toast message={`Could not save design: ${saveError}`} /> : null}
    </div>
  );
}

/** Everything the undo stack tracks: the design choices saved to goldie.design.json. */
type DesignState = {
  background: string;
  /** Whether `background` overrides every scene's own background. */
  backgroundOverridden: boolean;
  /** Bezel variant per device key; "" or absent means the config's custom art. */
  frames: Record<string, string>;
  fontFamily: string;
  copy: Record<string, SceneCopy>;
  layout: string;
  /** A built-in template key, "" for none, or CUSTOM_TEMPLATE for the config's own sequence. */
  template: string;
  screenOnly: boolean;
  /** Per-scene layout overrides; a scene absent here follows `layout`. */
  sceneLayouts: Record<string, string>;
  /** Screenshot scene ids as arranged by dragging tiles; empty means the config's order. */
  order: string[];
  /** The element editor's live decorations per screenshot scene id; a scene absent here still shows its config decorations. */
  sceneDecorations: Record<string, Decoration[]>;
  /** The editor's moves of each scene's copy block and devices, per screenshot scene id. */
  sceneTransforms: Record<string, SceneTransform>;
};

/** The saved variant per device when it is drawn for that device, else the config's. */
/**
 * Builds a full DesignState from a SavedDesign-shaped payload (a loaded
 * goldie.design.json, or a version-history snapshot): the mount-time
 * initializer and a history restore/preview both go through this, so the
 * two never drift apart.
 */
function designStateFromSaved(design: Design, saved: SavedDesign): DesignState {
  const knownLayout = (key: string | undefined) =>
    key && design.layouts.some((l) => l.key === key) ? key : undefined;
  return {
    background: saved.background ?? design.theme.background,
    // Whether a studio background choice is in force; unset, every scene's
    // own `background` stands, as the CLI composes it.
    backgroundOverridden: saved.background !== undefined,
    frames: initialFrames(design, saved),
    fontFamily: saved.fontFamily ?? design.theme.fontFamily,
    copy: saved.copy ?? {},
    layout: knownLayout(saved.layout) ?? design.layout,
    template: initialTemplate(design, saved),
    screenOnly: saved.screenOnly ?? design.screenOnly,
    sceneLayouts: initialSceneLayouts(design, saved, knownLayout),
    order: initialOrder(design, saved),
    sceneDecorations: saved.sceneDecorations ?? {},
    sceneTransforms: saved.sceneTransforms ?? {},
  };
}

function initialFrames(design: Design, saved: SavedDesign): Record<string, string> {
  const known = (device: string, key: string | undefined) =>
    key && design.frameVariants.some((v) => v.key === key && v.device === device) ? key : undefined;
  const out: Record<string, string> = {};
  for (const [device, variant] of Object.entries(design.frames)) {
    const legacy = design.frameVariants.find((v) => v.key === saved.frame)?.device;
    const pick =
      known(device, saved.frames?.[device]) ??
      (legacy === device ? saved.frame : undefined) ??
      variant ??
      "";
    out[device] = pick;
  }
  return out;
}

function initialTemplate(design: Design, saved: SavedDesign): string {
  if (saved.template !== undefined && design.templates.some((t) => t.key === saved.template))
    return saved.template;
  if (saved.template === "") return "";
  if (Array.isArray(design.template)) return CUSTOM_TEMPLATE;
  return design.template ?? "";
}

function initialSceneLayouts(
  design: Design,
  saved: SavedDesign,
  knownLayout: (key: string | undefined) => string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const scene of design.scenes) {
    const key = knownLayout(saved.sceneLayouts?.[scene.id]);
    if (key) out[scene.id] = key;
  }
  return out;
}

/** Ids no longer in the config are dropped, new ones follow the saved order. */
function initialOrder(design: Design, saved: SavedDesign): string[] {
  const ids = design.scenes.map((s) => s.id);
  if (!saved.order) return [];
  const kept = saved.order.filter((id) => ids.includes(id));
  return [...kept, ...ids.filter((id) => !kept.includes(id))];
}

/** Bottom-center notice; the save retries on the next change, so it needs no dismiss. */
function Toast({ message }: { message: string }) {
  return (
    <output className="animate-in fade-in slide-in-from-bottom-2 fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-destructive/30 bg-popover px-3.5 py-2 text-xs text-destructive shadow-lg duration-200">
      {message}
    </output>
  );
}

type SavedView = {
  /** A DeviceType; older sessions stored the platform ("ios" | "android") here. */
  platform?: string;
  device?: string;
  locale?: string;
  dark?: boolean;
  view?: string;
};

const storageKey = (appName: string) => `goldie-studio:${appName}`;

function isDeviceType(value: string | undefined): value is DeviceType {
  return DEVICE_TYPES.includes(value as DeviceType);
}

function loadView(appName: string): SavedView {
  try {
    const raw = localStorage.getItem(storageKey(appName));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as SavedView) : {};
  } catch {
    return {};
  }
}

function storeView(appName: string, saved: SavedView): void {
  try {
    localStorage.setItem(storageKey(appName), JSON.stringify(saved));
  } catch {
    // Storage may be unavailable (private mode); the session still works.
  }
}

/** @font-face rules for the bundled typefaces the manifest lists. */
function fontFaces(fonts: BundledFont[]): string {
  return fonts
    .flatMap((font) =>
      font.faces.map((face) => {
        const format = face.url.endsWith(".otf") ? "opentype" : "truetype";
        return `@font-face{font-family:"${font.family}";font-weight:${face.weight};font-style:normal;src:url("${face.url}") format("${format}")}`;
      }),
    )
    .join("\n");
}

/** iOS devices are sizes ("iPhone 6.9"), so they carry an inch mark, as in the sidebar. */
function deviceLabel(d: DeviceEntry): string {
  return d.platform === "ios" ? `${d.label}"` : d.label;
}
