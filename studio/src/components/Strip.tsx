import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { AnimatePresence, Reorder } from "motion/react";
import type React from "react";
import { Fragment, forwardRef, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FRAMES, type FrameGeometry } from "../../../src/frame";
import {
  applyTransform,
  BADGE,
  type Composition,
  compose,
  isTemplateKey,
  type LAYOUTS,
  type LayoutKey,
  resolveScenes,
  SCREEN_SHADOW,
  type SceneTransform,
  TYPE,
} from "../../../src/layouts";
import {
  BUBBLE,
  CARD_SHADOW,
  calloutGeometry,
  circleMarkPath,
  HIGHLIGHT,
  MARK_STROKE,
  ratingGeometry,
  underlineMarkPath,
} from "../../../src/marks";
import { mapRuns, parseEmphasis, type Run } from "../../../src/richtext";
import type {
  ArtLibraryImage,
  Decoration,
  Design,
  DesignScene,
  DeviceCaptures,
  DeviceEntry,
  EmphasisStyle,
  HeadlineStyle,
  SceneCopy,
  Theme,
} from "../manifest";
import { CHECKERBOARD, layoutOptions, TRANSPARENT } from "./DesignPanel";
import {
  AddMenu,
  canonicalDecorations,
  defaultDecoration,
  displayDecoration,
  EditorOverlay,
  EditorToolbar,
  Inspector,
  type Selection,
} from "./Editor";
import { Select } from "./Sidebar";
import { Button } from "./ui/button";

/**
 * Tiles per strip page, and per grid row; the App Store product page shows
 * this many before scrolling.
 */
const PAGE_SIZE = 5;
/** Apple's cap on screenshots per device family. Extra tiles stay visible, dimmed. */
const MAX_SCREENSHOTS = 10;
const GAP = "1rem";

/** The script face behind kickers, script emphasis and script bubbles when the theme names none; mirrors DEFAULT_SCRIPT_FONT in src/draw.ts. */
const DEFAULT_SCRIPT_FONT = '"Caveat", cursive';

/** A 0-100 normalized box, for the underline/circle mark paths; stretched non-uniformly onto the real word box by the SVG's viewBox. */
const MARK_BOX = { left: 0, top: 0, width: 100, height: 100 };

/** Flex basis for a grid cell that occupies `span` screenshot slots in a PAGE_SIZE row. */
const cellBasis = (span: number) =>
  `calc((100% - ${PAGE_SIZE - 1} * ${GAP}) / ${PAGE_SIZE} * ${span} + ${span - 1} * ${GAP})`;

/**
/**
 * Page-turn animation: the incoming page slides in from the side the arrow
 * points at while the outgoing page leaves through the opposite edge. 110%
 * keeps a page's tile shadows clear of the clip edge until it is in motion.
 */
const pageSlide = {
  enter: (direction: number) => ({ x: direction > 0 ? "110%" : "-110%" }),
  center: { x: "0%" },
  exit: (direction: number) => ({ x: direction > 0 ? "-110%" : "110%" }),
};

/** How the tiles are laid out: one paged row like the store's carousel, or a wrapping grid. */
export type StripView = "strip" | "grid";

/**
 * The screenshot strip, composited in the browser: each tile is the raw device
 * capture inside the bezel art on the chosen background, laid out with the
 * exact geometry the CLI renders with (src/frame.ts), so what you see is what
 * an export renders. Background and frame arrive as props from React state -
 * changing them repaints instantly, no CLI involved. The preview tile plays
 * the raw clips as they are: Apple requires a plain screen recording.
 *
 * Two views, picked in the sidebar. The strip shows five tiles at a time and,
 * when there are more, arrows page through them like the store's own
 * carousel. The grid wraps five to a row and the stage scrolls. Either way
 * every scene with a capture is shown; tiles past Apple's ten-screenshot cap
 * are dimmed so the limit is visible without hiding work.
 *
 * Tiles wrap in a five-up row and the stage scrolls when there are more.
 * Every scene with a capture is shown; tiles past Apple's ten-screenshot
 * cap are dimmed so the limit is visible without hiding work.
 *
 * Every tile is a size-container: the geometry is computed in the device's
 * spec pixels and expressed in cqw/cqh, so the tile is the composition scaled
 * down. Captions under the tiles show the spec size the export will produce;
 * the video's turns red when the clips sum outside Apple's 15-30s window
 * (iOS only; the android video goes to YouTube, which has no bounds).
 *
 * In the lightbox the headline and subhead are editable in place; a change
 * is reported through onCopy for the current locale and layered over the
 * config's copy here and in the CLI, via goldie.design.json. The headline
 * supports `*word*` emphasis markup: focused, the raw text (asterisks and
 * all) is shown for editing; blurred, it renders the theme's emphasis style,
 * so the markers stay round-trippable through goldie.design.json.
 *
 * Screenshot tiles can be dragged into a new order; the resulting scene id
 * list is reported through onReorder and saved the same way, so an export
 * numbers the files in the order shown. The preview tile stays first, as
 * the store shows it.
 */

/**
 * One screenshot scene's share of the element editor's state: everything the
 * lightbox's toolbar, the inspector, and the in-scene EditorOverlay need to
 * select, move and edit its copy block, devices and decorations. Built once
 * per scene in Strip() and handed to every slice's ScreenshotScene and Entry.
 */
export type EditorEntryInfo = {
  sceneId: string;
  /** 2 for a panorama/panorama-duo scene; 1 otherwise. */
  span: number;
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  pickRegionIndex: number | null;
  onPickRegion: (index: number | null) => void;
  /** The scene's own decorations currently in effect (a live override, or the config's), canonical (config-relative) form. */
  decorations: Decoration[];
  /** The config's own decorations for this scene, untouched - what "Reset element" restores a surviving index to. */
  baselineDecorations: Decoration[];
  onDecorations: (list: Decoration[], fieldKey: string) => void;
  transform: SceneTransform;
  onTransform: (t: SceneTransform, fieldKey: string) => void;
  /** The scene's pre-transform composition, for the device rotate values ElementTransform.rotate is relative to. */
  baseComposition: Composition;
  artLibrary: ArtLibraryImage[];
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  onResetScene: () => void;
  onRevertAll: () => void;
};
export function Strip({
  design,
  captures,
  spec: tileSpec,
  locale,
  background,
  backgroundOverridden,
  frameUrl,
  fontFamily,
  copy,
  onCopy,
  order,
  onReorder,
  template,
  layout,
  screenOnly,
  sceneLayouts,
  onSceneLayout,
  view,
  sceneDecorations,
  onSceneDecorations,
  sceneTransforms,
  onSceneTransform,
  artLibrary,
  history,
  onRevertScene,
  onRevertAll,
}: {
  design: Design;
  captures: DeviceCaptures;
  spec: DeviceEntry;
  locale: string;
  background: string;
  /**
   * Whether a studio background choice overrides every scene's own
   * `background`, mirroring the CLI's applyDesign (a design.background
   * clears every scene.background and may flip the copy colors).
   */
  backgroundOverridden: boolean;
  frameUrl: string;
  fontFamily: string;
  copy: Record<string, SceneCopy>;
  onCopy: (sceneId: string, field: "headline" | "subhead", text: string) => void;
  /** Screenshot scene ids in display order; empty means the config's order. */
  order: string[];
  onReorder: (order: string[]) => void;
  /** A built-in template key, "" for none, or a custom layout sequence. */
  template: string | string[];
  /** The default layout key, and per-scene overrides by scene id. */
  layout: string;
  screenOnly: boolean;
  sceneLayouts: Record<string, string>;
  onSceneLayout: (sceneId: string, key: string | undefined) => void;
  view: StripView;
  /**
   * The element editor's live decorations per screenshot scene id, config-
   * relative `src`; a scene absent here still shows its config decorations,
   * untouched. `fieldKey` names the edit for the undo stack (see useHistory).
   */
  sceneDecorations: Record<string, Decoration[]>;
  onSceneDecorations: (sceneId: string, list: Decoration[], fieldKey: string) => void;
  /** The editor's moves of each scene's copy block and devices, per screenshot scene id. */
  sceneTransforms: Record<string, SceneTransform>;
  onSceneTransform: (sceneId: string, t: SceneTransform, fieldKey: string) => void;
  /** Every image the config references or keeps in its art dir, for the Add > Image picker. */
  artLibrary: ArtLibraryImage[];
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  onRevertScene: (sceneId: string) => void;
  onRevertAll: () => void;
}) {
  const theme = design.theme;
  const frameGeometry = FRAMES[tileSpec.key as keyof typeof FRAMES] ?? FRAMES["iphone-6.9"];

  // Every image decoration's config-relative path the last `goldie manifest`
  // already copied into out/web/decor, keyed by that path: the editor's own
  // added images (not covered yet) fall back to the art-library file route.
  const knownImageUrls = useMemo(() => {
    const map = new Map<string, string>();
    const collect = (list: Decoration[] | undefined) => {
      for (const d of list ?? []) {
        if (d.kind === "image" && d.configSrc) map.set(d.configSrc, d.src);
      }
    };
    collect(design.decorations);
    for (const scene of design.scenes) collect(scene.decorations);
    return map;
  }, [design.decorations, design.scenes]);
  const resolveArtUrl = (configSrc: string) =>
    knownImageUrls.get(configSrc) ?? `/api/art-library/file?src=${encodeURIComponent(configSrc)}`;

  // The current selection in the lightbox's element editor, and a callout
  // mid-"pick region"; neither survives a scene change or closing the lightbox.
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pickRegionIndex, setPickRegionIndex] = useState<number | null>(null);
  const clearSelection = () => {
    setSelection(null);
    setPickRegionIndex(null);
  };
  const scenes =
    order.length > 0
      ? [...design.scenes].sort((a, b) => rankOf(order, a.id) - rankOf(order, b.id))
      : design.scenes;
  // The same resolution the CLI runs, on the scenes in their displayed order.
  const resolved = resolveScenes(scenes, {
    template: Array.isArray(template)
      ? (template as LayoutKey[])
      : isTemplateKey(template)
        ? template
        : undefined,
    layout,
    sceneLayouts,
  });
  const layoutOf = (scene: DesignScene) => resolved.find((r) => r.scene.id === scene.id)!;
  // The same resolution with no per-scene overrides: what the template (or
  // theme layout) gives each scene, which the lightbox names as "Default".
  const unforced = resolveScenes(scenes, {
    template: Array.isArray(template)
      ? (template as LayoutKey[])
      : isTemplateKey(template)
        ? template
        : undefined,
    layout,
  });
  const defaultLayoutOf = (scene: DesignScene) =>
    unforced.find((r) => r.scene.id === scene.id)!.layout.key;

  // The first store slot each scene's composition fills, and the strip's
  // total slot count (a panorama fills two); mirrors the `slot` counter in
  // src/scene.ts, which a theme.backdrop slices itself against.
  const slotOf: Record<string, number> = {};
  let slotCounter = 0;
  for (const r of resolved) {
    slotOf[r.scene.id] = slotCounter;
    slotCounter += r.layout.span;
  }
  const totalSlots = slotCounter;

  // Mirrors the CLI's --background handling: a dark background flips the copy
  // to light, a light background flips light copy colors to dark. Only an
  // active override does this - mirroring applyDesign, which computes the
  // luminance off design.background alone and leaves per-scene backgrounds
  // (and their authored copy colors) untouched otherwise.
  const bgLum = backgroundOverridden ? backgroundLuminance(background) : null;
  const dark = bgLum !== null && bgLum < 0.5;
  const light = bgLum !== null && bgLum >= 0.5;
  const lightColor = (c: string) => (backgroundLuminance(c) ?? 0) > 0.5;
  const headlineColor = dark
    ? "#FFFFFF"
    : light && lightColor(theme.headlineColor)
      ? "#0E1B2A"
      : theme.headlineColor;
  const subheadColor = dark
    ? "#D9E1EA"
    : light && lightColor(theme.subheadColor)
      ? "#5A6A7D"
      : theme.subheadColor;

  const shots = scenes.flatMap((scene) => {
    const capture = captures.screenshots.find((s) => s.sceneId === scene.id);
    return capture ? [{ scene, capture }] : [];
  });

  const segments =
    design.preview && captures.clips
      ? design.preview.segments.flatMap((seg) => {
          const clip = captures.clips!.find((c) => c.segmentId === seg.id);
          return clip ? [{ url: clip.url, durationSeconds: clip.durationSeconds }] : [];
        })
      : [];

  const totalSeconds = segments.reduce((s, c) => s + c.durationSeconds, 0);

  // A device with its own bezel art (android) ignores the frame picker: the
  // picker's variants are iPhone art, with iPhone geometry.
  const deviceFrameUrl = tileSpec.frame?.url ?? frameUrl;
  const geom = tileSpec.frame?.geom;

  type Entry = {
    key: string;
    width: number;
    height: number;
    bad: boolean;
    badReason?: string;
    /** Whether the lightbox offers in-place copy editing (screenshots only). */
    editable: boolean;
    /** The composition; editable renders the copy as editable text (lightbox only). */
    scene: (editable: boolean) => ReactNode;
    /** Set on screenshot tiles, which can be dragged into a new order. */
    sceneId?: string;
    /** Past Apple's per-device screenshot cap; still shown, dimmed. */
    overLimit?: boolean;
    /** The lightbox's per-scene layout override control (screenshots only). */
    layout?: {
      value: string | undefined;
      /** The layout the scene gets with no override: the template's pick, or the theme layout. */
      defaultKey: string;
      onChange: (key: string | undefined) => void;
    };
    /** The element editor's state for this scene (screenshots only); the lightbox's toolbar and inspector read it. */
    editor?: EditorEntryInfo;
  };
  const entries: Entry[] = [];
  if (segments.length > 0 && tileSpec.preview) {
    // The 15-30s window is Apple's upload rule; the android video goes to
    // YouTube, which has no duration bounds.
    const outOfBounds = tileSpec.platform === "ios" && (totalSeconds < 15 || totalSeconds > 30);
    entries.push({
      key: "preview",
      width: tileSpec.preview.width,
      height: tileSpec.preview.height,
      bad: outOfBounds,
      badReason: "Clips sum outside the 15-30s Apple allows for previews.",
      editable: false,
      scene: () => <PreviewScene segments={segments} />,
    });
  }
  let shotCount = 0;
  for (const { scene, capture } of shots) {
    const { layout: spec, secondScene } = layoutOf(scene);
    const second = secondScene
      ? captures.screenshots.find((s) => s.sceneId === secondScene)
      : undefined;
    const layoutControl = {
      value: sceneLayouts[scene.id],
      defaultKey: defaultLayoutOf(scene),
      onChange: (key: string | undefined) => onSceneLayout(scene.id, key),
    };
    // The scene's own decorations as the editor sees them: a live override
    // once it has touched this scene, else the config's (manifest baseline),
    // in canonical (config-relative image src) form.
    const sceneDecosCanonical =
      sceneDecorations[scene.id] ?? canonicalDecorations(scene.decorations ?? []);
    const sceneTransform = sceneTransforms[scene.id] ?? {};
    const editorInfo: EditorEntryInfo = {
      sceneId: scene.id,
      span: spec.span,
      selection,
      onSelect: setSelection,
      pickRegionIndex,
      onPickRegion: setPickRegionIndex,
      decorations: sceneDecosCanonical,
      baselineDecorations: canonicalDecorations(scene.decorations ?? []),
      onDecorations: (list, fieldKey) => onSceneDecorations(scene.id, list, fieldKey),
      transform: sceneTransform,
      onTransform: (t, fieldKey) => onSceneTransform(scene.id, t, fieldKey),
      baseComposition: compose(spec, tileSpec.screenshot, theme, {
        screenOnly,
        geom: geom ?? frameGeometry,
        copyScale: tileSpec.copyScale,
      }),
      artLibrary,
      history,
      onResetScene: () => {
        onRevertScene(scene.id);
        clearSelection();
      },
      onRevertAll: () => {
        onRevertAll();
        clearSelection();
      },
    };

    for (let slice = 0; slice < spec.span; slice++) {
      shotCount += 1;
      entries.push({
        key: spec.span > 1 ? `${scene.id}#${slice + 1}` : scene.id,
        width: tileSpec.screenshot.width,
        height: tileSpec.screenshot.height,
        bad: false,
        overLimit: shotCount > MAX_SCREENSHOTS,
        editable: true,
        // Only the first slice drags; the second follows it.
        sceneId: slice === 0 ? scene.id : undefined,
        layout: layoutControl,
        editor: editorInfo,
        scene: (editable) => (
          <ScreenshotScene
            spec={spec}
            slice={slice}
            first={slotOf[scene.id] ?? 0}
            totalSlots={totalSlots}
            tile={tileSpec.screenshot}
            frame={frameGeometry}
            theme={theme}
            screenOnly={screenOnly}
            background={background}
            backgroundOverridden={backgroundOverridden}
            sceneBackground={scene.background}
            sceneBackgroundImage={scene.backgroundImage}
            backdropUrl={theme.backdrop}
            frameUrl={deviceFrameUrl}
            geom={geom}
            copyScale={tileSpec.copyScale}
            fontFamily={fontFamily}
            kicker={scene.kicker?.[locale]}
            headline={copy[scene.id]?.headline?.[locale] ?? scene.headline[locale] ?? ""}
            subhead={copy[scene.id]?.subhead?.[locale] ?? scene.subhead?.[locale]}
            headlineColor={headlineColor}
            subheadColor={subheadColor}
            captureUrl={capture.url}
            secondCaptureUrl={second?.url}
            secondSceneId={secondScene}
            themeDecorations={design.decorations}
            sceneDecorations={sceneDecosCanonical}
            resolveArtUrl={resolveArtUrl}
            sceneTransform={sceneTransform}
            locale={locale}
            onEdit={editable ? (field, text) => onCopy(scene.id, field, text) : undefined}
            editor={editable ? editorInfo : undefined}
          />
        ),
      });
    }
  }

  const [open, setOpenState] = useState<number | null>(null);
  // The tile that shares its view-transition-name with the lightbox scene.
  // It must already be named in the frame *before* the transition starts,
  // or the old snapshot has nothing to morph from; so it is committed
  // synchronously first, and only cleared once the closing morph is done.
  const [named, setNamed] = useState<number | null>(null);
  const setOpen = (next: number | null) => {
    if (typeof document.startViewTransition !== "function") {
      setNamed(next);
      setOpenState(next);
      return;
    }
    if (next !== null) flushSync(() => setNamed(next));
    const transition = document.startViewTransition(() => flushSync(() => setOpenState(next)));
    if (next === null) transition.finished.finally(() => setNamed(null));
  };
  // A pointer drag on a tile also produces a click when it ends; the click
  // is dropped while a drag is underway or just finished.
  const dragged = useRef(false);
  // The scene being dragged, lifted with a slight scale. Driven through
  // `animate` rather than whileDrag, which can stay applied when the drop
  // coincides with the item's layout animation.
  const [lifting, setLifting] = useState<string | null>(null);
  const tileAt = (i: number) => {
    const entry = entries[i];
    return (
      <Tile
        key={entry.key}
        draggable={entry.sceneId !== undefined}
        width={entry.width}
        height={entry.height}
        bad={entry.bad}
        badReason={entry.badReason}
        overLimit={entry.overLimit}
        onOpen={() => {
          if (!dragged.current) setOpen(i);
        }}
        // Named only while the lightbox is closed: once open, the scene inside
        // it carries the name, and a duplicate would abort the transition.
        transitionName={named === i && open === null ? "lightbox-scene" : undefined}
      >
        {entry.scene(false)}
      </Tile>
    );
  };

  // Cells: the preview tile, then one cell per scene holding its tile(s),
  // so a panorama's two slices drag together. Cells are paged so a strip
  // page holds at most PAGE_SIZE tiles without splitting a scene.
  type Cell = { sceneId?: string; tiles: number[] };
  const cells: Cell[] = [];
  entries.forEach((entry, i) => {
    const last = cells[cells.length - 1];
    if (entry.sceneId === undefined && last?.sceneId !== undefined && entry.key.includes("#")) {
      last.tiles.push(i);
    } else {
      cells.push({ sceneId: entry.sceneId, tiles: [i] });
    }
  });
  const pageCells: Cell[][] = [[]];
  for (const cell of cells) {
    const current = pageCells[pageCells.length - 1];
    const used = current.reduce((n, c) => n + c.tiles.length, 0);
    if (used + cell.tiles.length > PAGE_SIZE && current.length > 0) pageCells.push([cell]);
    else current.push(cell);
  }
  const pages = pageCells.length;
  const [page, setPage] = useState(0);
  // Which way the last page turn went, so the incoming page slides in from
  // that side and the outgoing one leaves through the other.
  const [direction, setDirection] = useState(0);
  const turnPage = (delta: number) => {
    setDirection(delta);
    setPage((p) => p + delta);
  };
  // A device switch can shrink the tile count; keep the page in range.
  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [page, pages]);
  useEffect(() => {
    if (open !== null && open > entries.length - 1) {
      setOpenState(null);
      setNamed(null);
    }
  }, [open, entries.length]);

  if (entries.length === 0) return null;

  const pastLimit = entries.filter((e) => e.overLimit).length;
  // Scenes without a capture stay in place; captured ones take the new
  // order: the whole grid's, or the current page's spliced back into it.
  const reorderWithin = (ids: string[]) => (next: string[]) => {
    const queue = [...next];
    onReorder(scenes.map((s) => (ids.includes(s.id) ? queue.shift()! : s.id)));
  };
  const sceneIds = cells.flatMap((c) => (c.sceneId ? [c.sceneId] : []));
  const reorderAll = reorderWithin(sceneIds);
  const visible = pageCells[Math.min(page, pages - 1)];
  const visibleIds = visible.flatMap((c) => (c.sceneId ? [c.sceneId] : []));
  const reorderPage = reorderWithin(visibleIds);
  // Pad the last page so tiles keep the same width as on a full page.
  const columns = pages > 1 ? PAGE_SIZE : entries.length;

  return (
    <div className="flex w-full flex-col gap-3">
      {view === "grid" ? (
        <Reorder.Group
          axis="xy"
          values={sceneIds}
          onReorder={reorderAll}
          aria-label="Screenshots, drag to reorder"
          className="flex w-full list-none flex-wrap items-start gap-4 p-0"
        >
          {cells.map((cell) =>
            cell.sceneId ? (
              <Reorder.Item
                key={cell.sceneId}
                value={cell.sceneId}
                className="relative flex min-w-0 gap-4"
                style={{
                  zIndex: lifting === cell.sceneId ? 10 : undefined,
                  flex: `0 0 ${cellBasis(cell.tiles.length)}`,
                }}
                animate={{ scale: lifting === cell.sceneId ? 1.04 : 1 }}
                onDragStart={() => {
                  dragged.current = true;
                  setLifting(cell.sceneId ?? null);
                }}
                onDragEnd={() => {
                  setLifting(null);
                  setTimeout(() => {
                    dragged.current = false;
                  }, 0);
                }}
              >
                {cell.tiles.map(tileAt)}
              </Reorder.Item>
            ) : (
              <li
                key={entries[cell.tiles[0]].key}
                className="min-w-0"
                style={{ flex: `0 0 ${cellBasis(1)}` }}
              >
                {tileAt(cell.tiles[0])}
              </li>
            ),
          )}
        </Reorder.Group>
      ) : (
        <div className="relative">
          {/* Clips only horizontally, so a sliding page vanishes at the strip's
              edge while tile shadows and the hover lift stay visible; the small
              padding keeps the edge tiles' own shadows out of the clip. */}
          <div className="-mx-2 overflow-x-clip px-2">
            <AnimatePresence mode="popLayout" initial={false} custom={direction}>
              <Reorder.Group
                key={page}
                axis="x"
                values={visibleIds}
                onReorder={reorderPage}
                aria-label="Screenshots, drag to reorder"
                className="grid w-full list-none items-start gap-4 p-0"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                custom={direction}
                variants={pageSlide}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "tween", duration: 0.25, ease: "easeInOut" }}
              >
                {visible.map((cell) =>
                  cell.sceneId ? (
                    <Reorder.Item
                      key={cell.sceneId}
                      value={cell.sceneId}
                      className="relative grid gap-4"
                      style={{
                        zIndex: lifting === cell.sceneId ? 10 : undefined,
                        gridColumn: `span ${cell.tiles.length}`,
                        gridTemplateColumns: `repeat(${cell.tiles.length}, minmax(0, 1fr))`,
                      }}
                      animate={{ scale: lifting === cell.sceneId ? 1.04 : 1 }}
                      onDragStart={() => {
                        dragged.current = true;
                        setLifting(cell.sceneId ?? null);
                      }}
                      onDragEnd={() => {
                        setLifting(null);
                        setTimeout(() => {
                          dragged.current = false;
                        }, 0);
                      }}
                    >
                      {cell.tiles.map(tileAt)}
                    </Reorder.Item>
                  ) : (
                    <li key={entries[cell.tiles[0]].key}>{tileAt(cell.tiles[0])}</li>
                  ),
                )}
              </Reorder.Group>
            </AnimatePresence>
          </div>

          {pages > 1 ? (
            <>
              <PagerButton
                side="left"
                label="Previous screenshots"
                disabled={page === 0}
                onClick={() => turnPage(-1)}
              />
              <PagerButton
                side="right"
                label="Next screenshots"
                disabled={page === pages - 1}
                onClick={() => turnPage(1)}
              />
            </>
          ) : null}
        </div>
      )}

      {pastLimit > 0 ? (
        <p className="text-center text-[11px] font-medium text-destructive">
          The App Store allows {MAX_SCREENSHOTS} screenshots; {pastLimit} sit past that limit.
        </p>
      ) : null}

      {open !== null && entries[open] ? (
        <Lightbox
          entry={entries[open]}
          layouts={design.layouts}
          locale={locale}
          index={open}
          count={entries.length}
          onClose={() => {
            clearSelection();
            setOpen(null);
          }}
          // Stepping swaps the scene in place with no morph.
          onStep={(delta) => {
            if (open === null) return;
            clearSelection();
            const next = Math.min(entries.length - 1, Math.max(0, open + delta));
            setNamed(next);
            setOpenState(next);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Full-viewport view of one tile: the same composition, rendered as large as
 * the window allows at the spec's aspect ratio. Click outside, Escape, or the
 * close button dismiss it; arrow keys step between tiles. Keys typed into the
 * editable copy are left to the text.
 */
function Lightbox({
  entry,
  layouts,
  locale,
  index,
  count,
  onClose,
  onStep,
}: {
  entry: {
    width: number;
    height: number;
    editable: boolean;
    scene: (editable: boolean) => ReactNode;
    layout?: {
      value: string | undefined;
      /** The layout the scene gets with no override: the template's pick, or the theme layout. */
      defaultKey: string;
      onChange: (key: string | undefined) => void;
    };
    editor?: EditorEntryInfo;
  };
  layouts: Design["layouts"];
  locale: string;
  index: number;
  count: number;
  onClose: () => void;
  onStep: (delta: number) => void;
}) {
  const editor = entry.editor;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
      const selected = editor?.selection;
      if (e.key === "Escape") {
        if (selected) editor?.onSelect(null);
        else onClose();
        return;
      }
      // While something is selected, the arrow keys nudge it (EditorOverlay's
      // own listener does that) instead of paging the lightbox.
      if (
        selected &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Delete", "Backspace"].includes(e.key)
      )
        return;
      if (e.key === "ArrowLeft") onStep(-1);
      else if (e.key === "ArrowRight") onStep(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep, editor]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot preview"
      className="animate-in fade-in fixed inset-0 z-50 flex duration-150 flex-col items-center justify-center gap-3 bg-black/80 p-8 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10"
        style={{
          viewTransitionName: "lightbox-scene",
          aspectRatio: `${entry.width} / ${entry.height}`,
          // Sized by width alone so the aspect ratio always holds: a height
          // cap plus flex shrinking would squash the box, stretching the bezel
          // art off the cover-fitted capture (a misaligned camera cutout). The
          // 7.5rem clears the padding, gap and layout row below the scene.
          flexShrink: 0,
          width: `min(calc(100vw - 4rem), calc((100vh - 7.5rem) * ${entry.width / entry.height}))`,
        }}
      >
        {entry.scene(true)}
      </div>
      <div className="flex items-center gap-3 text-[11px] text-neutral-300">
        {entry.layout ? (
          <div className="dark w-44 text-foreground">
            <Select
              value={entry.layout.value ?? ""}
              onChange={(v) => entry.layout?.onChange(v || undefined)}
              options={[
                [
                  "",
                  `Default (${layouts.find((l) => l.key === entry.layout?.defaultKey)?.label ?? entry.layout.defaultKey})`,
                ],
                ...layoutOptions(layouts),
              ]}
            />
          </div>
        ) : null}
        {editor ? (
          <>
            <AddMenu
              artLibrary={editor.artLibrary}
              onAdd={(kind, image) => {
                const next = [...editor.decorations, defaultDecoration(kind, locale, image?.src)];
                editor.onDecorations(next, `add:${editor.sceneId}`);
                editor.onSelect({ kind: "decoration", index: next.length - 1 });
              }}
            />
            <EditorToolbar
              canUndo={editor.history.canUndo}
              canRedo={editor.history.canRedo}
              onUndo={editor.history.undo}
              onRedo={editor.history.redo}
              onRevertScene={editor.onResetScene}
              onRevertAll={editor.onRevertAll}
            />
          </>
        ) : null}
      </div>

      {editor?.selection ? (
        <div className="absolute top-20 right-6 bottom-20">
          <Inspector
            selection={editor.selection}
            onSelect={editor.onSelect}
            decorations={editor.decorations}
            onDecorations={editor.onDecorations}
            transform={editor.transform}
            onTransform={editor.onTransform}
            baseComposition={editor.baseComposition}
            locale={locale}
            onReset={() => resetSelected(editor)}
            onPickRegion={() => {
              if (editor.selection?.kind === "decoration")
                editor.onPickRegion(editor.selection.index);
            }}
          />
        </div>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        aria-label="Close"
        className="absolute top-4 right-4 rounded-full"
        onClick={onClose}
      >
        <X />
      </Button>
      {count > 1 ? (
        <>
          <PagerButton
            side="left"
            label="Previous"
            disabled={index === 0}
            onClick={() => onStep(-1)}
            inset
          />
          <PagerButton
            side="right"
            label="Next"
            disabled={index === count - 1}
            onClick={() => onStep(1)}
            inset
          />
        </>
      ) : null}
    </div>
  );
}

/** Round arrow floating over the lightbox's edge. */
function PagerButton({
  side,
  label,
  disabled,
  onClick,
  inset = false,
}: {
  side: "left" | "right";
  label: string;
  disabled: boolean;
  onClick: () => void;
  /** Sit inside the edge instead of overhanging it (used in the lightbox). */
  inset?: boolean;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  const offset = inset
    ? side === "left"
      ? "left-4"
      : "right-4"
    : side === "left"
      ? "-left-5"
      : "-right-5";
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-lg"
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`absolute top-1/2 -translate-y-1/2 rounded-full bg-popover shadow-md transition-none hover:bg-popover focus-visible:ring-0 active:not-aria-[haspopup]:-translate-y-1/2 ${offset}`}
    >
      <Icon />
    </Button>
  );
}

/** Container-query units: 1cqw / 1cqh is one percent of a single tile. */
const cq = (tile: { width: number; height: number }) => ({
  w: (v: number) => `${(v / tile.width) * 100}cqw`,
  h: (v: number) => `${(v / tile.height) * 100}cqh`,
});

/**
 * Forwards its ref to the size-container div: the element editor measures
 * everything it tags with `data-edit` relative to this box, so it needs a
 * handle on the box itself, not just its children.
 */
const Canvas = forwardRef<
  HTMLDivElement,
  { background: string; fontFamily: string; children: ReactNode }
>(function Canvas({ background, fontFamily, children }, ref) {
  return (
    <div
      ref={ref}
      className="absolute inset-0 overflow-hidden"
      style={{ containerType: "size", background, fontFamily }}
    >
      {children}
    </div>
  );
});

/**
 * Browser twin of renderScreenshots in src/render.ts: the same compose()
 * geometry, expressed in container-query units of one tile. A panorama
 * layout renders the whole span-wide composition and shifts it left by
 * `slice` tiles, so each tile shows its own slice. With onEdit set, the
 * headline and subhead are editable in place.
 */
function ScreenshotScene({
  spec,
  slice,
  first,
  totalSlots,
  tile,
  frame,
  theme,
  screenOnly,
  background,
  backgroundOverridden,
  sceneBackground,
  sceneBackgroundImage,
  backdropUrl,
  frameUrl,
  geom,
  copyScale,
  fontFamily,
  kicker,
  headline,
  subhead,
  headlineColor,
  subheadColor,
  captureUrl,
  secondCaptureUrl,
  secondSceneId,
  themeDecorations,
  sceneDecorations,
  resolveArtUrl,
  sceneTransform,
  locale,
  onEdit,
  editor,
}: {
  spec: (typeof LAYOUTS)[keyof typeof LAYOUTS];
  slice: number;
  /** This scene's first store slot, and the strip's slot count; a theme.backdrop slices itself against these. */
  first: number;
  totalSlots: number;
  tile: { width: number; height: number };
  frame: FrameGeometry;
  theme: Theme;
  screenOnly: boolean;
  background: string;
  backgroundOverridden: boolean;
  /** The scene's own CSS background; honoured unless a studio override is active. */
  sceneBackground: string | undefined;
  /** Url under out/web, or "none" to clear the theme's backgroundImage; honoured unless overridden. */
  sceneBackgroundImage: string | undefined;
  backdropUrl: string | undefined;
  frameUrl: string;
  /** The bezel art's geometry; the iOS bundled art's when the device brings none. */
  geom: FrameGeometry | undefined;
  copyScale: number;
  fontFamily: string;
  kicker: string | undefined;
  headline: string;
  subhead: string | undefined;
  headlineColor: string;
  subheadColor: string;
  captureUrl: string;
  secondCaptureUrl: string | undefined;
  secondSceneId: string | undefined;
  /** theme.decorations - drawn on every scene, never selectable here. */
  themeDecorations: Decoration[];
  /** This scene's own decorations, canonical (config-relative image src) form - the element editor's model. */
  sceneDecorations: Decoration[];
  resolveArtUrl: (configSrc: string) => string;
  sceneTransform: SceneTransform;
  locale: string;
  onEdit?: (field: "headline" | "subhead", text: string) => void;
  /** Set only for the lightbox's own render; mounts the selection/drag/resize/rotate overlay. */
  editor?: EditorEntryInfo;
}) {
  const effectiveGeom = geom ?? frame;
  const base = compose(spec, tile, theme, { screenOnly, geom: effectiveGeom, copyScale });
  const c = applyTransform(base, sceneTransform, tile);
  const displayDecorations = sceneDecorations.map((d) => displayDecoration(d, resolveArtUrl));
  const containerRef = useRef<HTMLDivElement>(null);
  const { w, h } = cq(tile);
  // Wider-than-reference tiles compose at a narrower design width; type
  // follows it, times the device's copy scale.
  const typeScale = (c.copy?.typeWidth ?? c.designWidth) / tile.width;
  const copy = c.copy;

  // Mirrors applyDesign: a studio background override replaces every scene's
  // own background; otherwise the scene's stands (falling back to the
  // theme's), exactly as the CLI composes it.
  const rawBackground = backgroundOverridden ? background : (sceneBackground ?? background);
  const resolvedBackground = rawBackground === TRANSPARENT ? CHECKERBOARD : rawBackground;
  const bgImageUrl =
    sceneBackgroundImage === "none" ? undefined : (sceneBackgroundImage ?? theme.backgroundImage);

  const accent = theme.accentColor ?? headlineColor;
  const emphasis: EmphasisStyle = theme.emphasis ?? "color";
  const scriptFamily = theme.scriptFontFamily ?? DEFAULT_SCRIPT_FONT;
  const hs: HeadlineStyle = theme.headline ?? {};
  const headlineSizeCqw = TYPE.headlineSize * (hs.scale ?? 1) * typeScale * 100;
  const headlineWeight = hs.weight ?? TYPE.headlineWeight;

  const compositionBox: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: `${-slice * 100}%`,
    width: `${spec.span * 100}%`,
    height: "100%",
  };

  return (
    <Canvas ref={containerRef} background="transparent" fontFamily={fontFamily}>
      {/* Background color/gradient and theme/scene backgroundImage, spanning
          the whole composition (both panorama tiles together), as drawScene
          fills and covers before anything else. */}
      <div style={{ ...compositionBox, background: resolvedBackground }}>
        {bgImageUrl ? (
          <img
            src={`/${bgImageUrl}`}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : null}
      </div>

      {/* The strip-wide backdrop, over the background as drawScene draws it. */}
      {backdropUrl ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: `${-(first + slice) * 100}cqw`,
            width: `${totalSlots * 100}cqw`,
            height: "100cqh",
            overflow: "hidden",
          }}
        >
          <img
            src={`/${backdropUrl}`}
            alt=""
            draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </div>
      ) : null}

      {/* The scrim over background art, under the copy (drawScene's theme.scrim). */}
      {theme.scrim && (bgImageUrl || backdropUrl) ? (
        <div
          style={{
            ...compositionBox,
            height: `${theme.scrim.height * 100}%`,
            background: `linear-gradient(180deg, ${theme.scrim.color} 0%, rgba(0,0,0,0) 100%)`,
          }}
        />
      ) : null}

      {/* Copy, decorations and devices, over the backdrop and backgrounds. */}
      <div style={compositionBox}>
        {copy ? (
          <div
            data-edit="copy"
            onPointerDown={editor ? () => editor.onSelect({ kind: "copy" }) : undefined}
            style={{
              position: "absolute",
              left: w(copy.box.left),
              width: w(copy.box.width),
              ...(copy.position === "top"
                ? { top: 0, paddingTop: h(copy.y), justifyContent: "flex-start" }
                : {
                    bottom: 0,
                    paddingBottom: h(tile.height - copy.y),
                    justifyContent: "flex-end",
                  }),
              height: h(copy.box.height),
              display: "flex",
              flexDirection: "column",
              alignItems: copy.align === "left" ? "flex-start" : "center",
              gap: h(tile.height * TYPE.gap),
              textAlign: copy.align,
            }}
          >
            {kicker ? (
              <p
                style={{
                  margin: 0,
                  color: accent,
                  fontFamily: scriptFamily,
                  fontSize: `${TYPE.kickerSize * typeScale * 100}cqw`,
                  lineHeight: TYPE.kickerLineHeight,
                  fontWeight: TYPE.kickerWeight,
                }}
              >
                {kicker}
              </p>
            ) : null}
            <Headline
              text={headline}
              locale={locale}
              uppercase={hs.uppercase}
              emphasis={emphasis}
              accent={accent}
              scriptFamily={scriptFamily}
              headlineSizeCqw={headlineSizeCqw}
              color={headlineColor}
              fontSize={`${headlineSizeCqw}cqw`}
              lineHeight={TYPE.headlineLineHeight}
              weight={headlineWeight}
              letterSpacing={`${TYPE.headlineTracking * typeScale * 100}cqw`}
              stroke={
                hs.stroke
                  ? { color: hs.stroke.color, widthCqw: hs.stroke.width * 2 * 100 }
                  : undefined
              }
              shadow={
                hs.shadow
                  ? {
                      color: hs.shadow.color,
                      blurCqw: hs.shadow.blur * 100,
                      offsetYCqw: hs.shadow.offsetY * 100,
                    }
                  : undefined
              }
              onEdit={onEdit ? (text) => onEdit("headline", text) : undefined}
            />
            {subhead || onEdit ? (
              <p
                style={{
                  margin: 0,
                  color: subheadColor,
                  fontSize: `${TYPE.subheadSize * typeScale * 100}cqw`,
                  lineHeight: TYPE.subheadLineHeight,
                  fontWeight: TYPE.subheadWeight,
                  minWidth: "30cqw",
                }}
                {...(onEdit
                  ? editableProps((text) => onEdit("subhead", text), subhead ?? "", "Subhead")
                  : {})}
              >
                {subhead}
              </p>
            ) : null}
          </div>
        ) : null}

        <Decorations
          decorations={themeDecorations}
          layer="back"
          tile={tile}
          locale={locale}
          headlineColor={headlineColor}
          fontFamily={fontFamily}
          scriptFamily={scriptFamily}
          captureUrl={captureUrl}
          secondCaptureUrl={secondCaptureUrl}
          devices={c.devices}
          geom={effectiveGeom}
        />
        <Decorations
          decorations={displayDecorations}
          layer="back"
          tile={tile}
          locale={locale}
          headlineColor={headlineColor}
          fontFamily={fontFamily}
          scriptFamily={scriptFamily}
          captureUrl={captureUrl}
          secondCaptureUrl={secondCaptureUrl}
          devices={c.devices}
          geom={effectiveGeom}
          onSelect={editor?.onSelect}
        />

        {c.devices.map((device, i) => {
          const url = device.capture === "secondary" ? secondCaptureUrl : captureUrl;
          return (
            <DeviceView
              key={device.capture}
              index={i}
              device={device}
              tile={tile}
              frameUrl={screenOnly ? null : frameUrl}
              captureUrl={url}
              missing={url ? undefined : (secondSceneId ?? "secondScene")}
              onSelect={editor?.onSelect}
            />
          );
        })}

        <Decorations
          decorations={themeDecorations}
          layer="front"
          tile={tile}
          locale={locale}
          headlineColor={headlineColor}
          fontFamily={fontFamily}
          scriptFamily={scriptFamily}
          captureUrl={captureUrl}
          secondCaptureUrl={secondCaptureUrl}
          devices={c.devices}
          geom={effectiveGeom}
        />
        <Decorations
          decorations={displayDecorations}
          layer="front"
          tile={tile}
          locale={locale}
          headlineColor={headlineColor}
          fontFamily={fontFamily}
          scriptFamily={scriptFamily}
          captureUrl={captureUrl}
          secondCaptureUrl={secondCaptureUrl}
          devices={c.devices}
          geom={effectiveGeom}
          onSelect={editor?.onSelect}
        />
      </div>

      {editor ? (
        <EditorOverlay
          containerRef={containerRef}
          tile={tile}
          span={spec.span}
          composition={c}
          baseComposition={base}
          decorations={sceneDecorations}
          onDecorations={editor.onDecorations}
          transform={sceneTransform}
          onTransform={editor.onTransform}
          selection={editor.selection}
          onSelect={editor.onSelect}
          pickRegionIndex={editor.pickRegionIndex}
          onPickRegionDone={(from) => {
            const sel = editor.selection;
            if (sel?.kind === "decoration") {
              const next = sceneDecorations.map((d, i) =>
                i === sel.index && d.kind === "callout" ? { ...d, from } : d,
              );
              editor.onDecorations(next, `pick-region:${editor.sceneId}`);
            }
            editor.onPickRegion(null);
          }}
        />
      ) : null}
    </Canvas>
  );
}

/**
 * One device: the capture cover-fitted inside the rounded screen, the bezel
 * over it, or a drop shadow under the bare screen when there is no bezel.
 * The box rotates about its centre, matching the canvas transform.
 */
function DeviceView({
  device,
  index,
  tile,
  frameUrl,
  captureUrl,
  missing,
  onSelect,
}: {
  device: Composition["devices"][number];
  /** This device's position among the scene's devices, back to front; matches SceneTransform.devices and Selection. */
  index: number;
  tile: { width: number; height: number };
  frameUrl: string | null;
  captureUrl: string | undefined;
  /** Scene id to name in the placeholder when the capture is missing. */
  missing: string | undefined;
  onSelect?: (sel: Selection) => void;
}) {
  const { w, h } = cq(tile);
  const { frame, screen } = device;
  // The screen as fractions of the device box, so it rotates with it.
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div
      data-edit={`device:${index}`}
      onPointerDown={onSelect ? () => onSelect({ kind: "device", index }) : undefined}
      style={{
        position: "absolute",
        left: w(frame.left),
        top: h(frame.top),
        width: w(frame.width),
        height: h(frame.height),
        transform: device.rotate ? `rotate(${device.rotate}deg)` : undefined,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: pct(screen.left - frame.left, frame.width),
          top: pct(screen.top - frame.top, frame.height),
          width: pct(screen.width, frame.width),
          height: pct(screen.height, frame.height),
          borderRadius: w(screen.radius),
          overflow: "hidden",
          background: "#000",
          boxShadow: frameUrl
            ? undefined
            : `0 ${w(tile.width * SCREEN_SHADOW.offsetY)} ${w(tile.width * SCREEN_SHADOW.blur)} ${SCREEN_SHADOW.color}`,
        }}
      >
        {captureUrl ? (
          <img
            src={`/${captureUrl}`}
            alt=""
            draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div
            className="grid h-full w-full place-items-center border-4 border-dashed border-neutral-500 bg-neutral-800 text-center text-neutral-300"
            style={{ fontSize: "3cqw", padding: "4cqw" }}
          >
            no capture for {missing}
          </div>
        )}
      </div>
      {frameUrl ? (
        <img
          src={`/${frameUrl}`}
          alt=""
          draggable={false}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      ) : null}
    </div>
  );
}

/** Which side of the device a decoration draws on; callouts lift out by default. Mirrors layerOf in src/draw.ts. */
function layerOf(d: Decoration): "back" | "front" {
  return d.layer ?? (d.kind === "callout" ? "front" : "back");
}

/** The screen a callout cuts from: its device's, or the bezel's proportions on a tile without one. Mirrors calloutScreen in src/draw.ts. */
function calloutScreen(
  devices: Composition["devices"],
  tile: { width: number; height: number },
  geom: FrameGeometry,
  which: "primary" | "secondary",
) {
  const device = devices.find((d) => d.capture === which) ?? devices[0];
  if (device) return { width: device.screen.width, height: device.screen.height };
  const width = tile.width * 0.8;
  return { width, height: (width * geom.screen.height) / geom.screen.width };
}

/**
 * Badge, image, callout, bubble and rating layers, in the composition's own
 * coordinates (tile fractions). `layer` filters to the back or front half, so
 * the caller can draw devices between the two calls, as drawDecoration does.
 */
function Decorations({
  decorations,
  layer,
  tile,
  locale,
  headlineColor,
  fontFamily,
  scriptFamily,
  captureUrl,
  secondCaptureUrl,
  devices,
  geom,
  onSelect,
}: {
  decorations: Decoration[];
  layer: "back" | "front";
  tile: { width: number; height: number };
  locale: string;
  headlineColor: string;
  fontFamily: string;
  scriptFamily: string;
  captureUrl: string;
  secondCaptureUrl: string | undefined;
  devices: Composition["devices"];
  geom: FrameGeometry;
  /** Set only for the editor's own (live, scene-level) decorations, which become selectable. */
  onSelect?: (sel: Selection) => void;
}) {
  const { w, h } = cq(tile);
  const inset = Math.min(tile.width, tile.height) * BADGE.inset;
  return (
    <>
      {decorations.map((d, i) => {
        if (layerOf(d) !== layer) return null;
        const key = `${d.kind}-${i}`;
        const editProps = onSelect
          ? {
              "data-edit": `decoration:${i}`,
              onPointerDown: () => onSelect({ kind: "decoration", index: i }),
            }
          : {};
        switch (d.kind) {
          case "badge":
            return (
              <div
                key={key}
                {...editProps}
                style={{
                  position: "absolute",
                  ...(d.position.endsWith("left") ? { left: w(inset) } : { right: w(inset) }),
                  ...(d.position.startsWith("top") ? { top: h(inset) } : { bottom: h(inset) }),
                  padding: `${w(tile.width * BADGE.padY)} ${w(tile.width * BADGE.padX)}`,
                  borderRadius: "999cqw",
                  background: d.background ?? "rgba(255, 255, 255, 0.85)",
                  color: d.color ?? headlineColor,
                  fontSize: `${BADGE.fontSize * 100}cqw`,
                  lineHeight: 1.2,
                  fontWeight: BADGE.weight,
                  whiteSpace: "nowrap",
                }}
              >
                {d.text[locale] ?? ""}
              </div>
            );
          case "image":
            return (
              <img
                key={key}
                {...editProps}
                src={`/${d.src}`}
                alt=""
                draggable={false}
                style={{
                  position: "absolute",
                  left: w(tile.width * d.x),
                  top: h(tile.height * d.y),
                  width: w(tile.width * d.width),
                  height: "auto",
                  opacity:
                    d.opacity !== undefined ? Math.max(0, Math.min(1, d.opacity)) : undefined,
                  transformOrigin: "center",
                  transform:
                    [d.rotate ? `rotate(${d.rotate}deg)` : "", d.flip ? "scaleX(-1)" : ""]
                      .filter(Boolean)
                      .join(" ") || undefined,
                  filter: d.shadow
                    ? `drop-shadow(0 ${w(tile.width * CARD_SHADOW.offsetY)} ${w(tile.width * CARD_SHADOW.blur)} ${CARD_SHADOW.color})`
                    : undefined,
                }}
              />
            );
          case "callout": {
            const which = d.capture ?? "primary";
            const url = which === "secondary" ? secondCaptureUrl : captureUrl;
            if (!url) return null;
            const screen = calloutScreen(devices, tile, geom, which);
            const g = calloutGeometry(d, tile, screen);
            return (
              <div
                key={key}
                {...editProps}
                style={{
                  position: "absolute",
                  left: w(g.box.left),
                  top: h(g.box.top),
                  width: w(g.box.width),
                  height: h(g.box.height),
                  borderRadius: w(g.radius),
                  overflow: "hidden",
                  transformOrigin: "center",
                  transform: d.rotate ? `rotate(${d.rotate}deg)` : undefined,
                  boxShadow:
                    d.shadow !== false
                      ? `0 ${w(tile.width * CARD_SHADOW.offsetY)} ${w(tile.width * CARD_SHADOW.blur)} ${CARD_SHADOW.color}`
                      : undefined,
                  border: d.border ? `${w(tile.width * 0.004)} solid ${d.border}` : undefined,
                  background: "#fff",
                }}
              >
                <img
                  src={`/${url}`}
                  alt=""
                  draggable={false}
                  style={{
                    position: "absolute",
                    left: w(g.image.left - g.box.left),
                    top: h(g.image.top - g.box.top),
                    width: w(g.image.width),
                    height: h(g.image.height),
                  }}
                />
              </div>
            );
          }
          case "bubble": {
            const text = d.text[locale] ?? "";
            const size = tile.width * (d.size ?? 0.045);
            const family = d.font === "script" ? scriptFamily : fontFamily;
            return (
              <div
                key={key}
                {...editProps}
                style={{
                  position: "absolute",
                  left: w(tile.width * d.x),
                  top: h(tile.height * d.y),
                  maxWidth: w(tile.width * d.width),
                  transformOrigin: "center",
                  transform: d.rotate ? `rotate(${d.rotate}deg)` : undefined,
                }}
              >
                <div
                  style={{
                    position: "relative",
                    display: "inline-block",
                    maxWidth: "100%",
                    background: d.background ?? "#FFFFFF",
                    color: d.color ?? headlineColor,
                    fontFamily: family,
                    fontWeight: 700,
                    fontSize: w(size),
                    lineHeight: BUBBLE.lineHeight,
                    padding: `${w(size * BUBBLE.padY)} ${w(size * BUBBLE.padX)}`,
                    borderRadius: w(size * BUBBLE.radius),
                    boxShadow: `0 ${w(tile.width * CARD_SHADOW.offsetY * 0.6)} ${w(tile.width * CARD_SHADOW.blur * 0.6)} ${CARD_SHADOW.color}`,
                    whiteSpace: "pre-wrap",
                    textAlign: "center",
                  }}
                >
                  {text}
                  <BubbleTail tail={d.tail ?? "bottom-left"} size={w(size * BUBBLE.tail * 0.9)} />
                </div>
              </div>
            );
          }
          case "rating": {
            const label = d.label ? d.label[locale] : undefined;
            const left = tile.width * d.x;
            const top = tile.height * d.y;
            const width = tile.width * d.width;
            const g = ratingGeometry({ left, top, width, height: 0 }, Boolean(label));
            const color = d.color ?? headlineColor;
            return (
              <svg
                key={key}
                {...editProps}
                aria-hidden
                viewBox={`${left} ${top} ${width} ${g.height}`}
                style={{
                  position: "absolute",
                  left: w(left),
                  top: h(top),
                  width: w(width),
                  height: h(g.height),
                  overflow: "visible",
                }}
              >
                {d.background ? (
                  <rect
                    x={g.plate.left}
                    y={g.plate.top}
                    width={g.plate.width}
                    height={g.plate.height}
                    rx={g.plate.radius}
                    fill={d.background}
                  />
                ) : null}
                {d.laurels !== false
                  ? (["left", "right"] as const).map((side, li) => (
                      <g key={side}>
                        <path d={g.laurels[li]!.leaves} fill={color} />
                        <path
                          d={g.laurels[li]!.stem}
                          fill="none"
                          stroke={color}
                          strokeWidth={g.laurelStroke}
                          strokeLinecap="round"
                        />
                      </g>
                    ))
                  : null}
                <text
                  x={g.value.x}
                  y={g.value.y}
                  fontSize={g.value.size}
                  fontWeight={800}
                  fill={color}
                  fontFamily={fontFamily}
                  textAnchor="middle"
                  dominantBaseline="hanging"
                >
                  {d.value}
                </text>
                {g.stars.map((s, si) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static star row
                  <path key={si} d={s} fill={color} />
                ))}
                {label && g.label ? (
                  <text
                    x={g.label.x}
                    y={g.label.y}
                    fontSize={g.label.size}
                    fontWeight={600}
                    fill={color}
                    fontFamily={fontFamily}
                    textAnchor="middle"
                    dominantBaseline="hanging"
                  >
                    {label}
                  </text>
                ) : null}
              </svg>
            );
          }
          default:
            return null;
        }
      })}
    </>
  );
}

/** A simple CSS triangle at a bubble's tail corner; `size` is the triangle's half-width/height, in cqw. */
function BubbleTail({
  tail,
  size,
}: {
  tail: "bottom-left" | "bottom-right" | "top-left" | "top-right" | "none";
  size: string;
}) {
  if (tail === "none") return null;
  const bottom = tail.startsWith("bottom");
  const onLeft = tail.endsWith("left");
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        [onLeft ? "left" : "right"]: `${BUBBLE.tailInset * 100}%`,
        [bottom ? "top" : "bottom"]: "100%",
        width: 0,
        height: 0,
        borderLeft: `${size} solid transparent`,
        borderRight: `${size} solid transparent`,
        borderTop: bottom ? `${size} solid currentColor` : undefined,
        borderBottom: !bottom ? `${size} solid currentColor` : undefined,
        color: "inherit",
      }}
    />
  );
}

/**
 * The headline: `*word*` emphasis markup rendered per the theme's style when
 * blurred, and the raw text (asterisks visible) in a plain contentEditable
 * field while focused, so editing keeps the markers round-trippable through
 * goldie.design.json. Non-editable (grid thumbnails) always renders the rich
 * text.
 */
function Headline({
  text,
  locale,
  uppercase,
  emphasis,
  accent,
  scriptFamily,
  headlineSizeCqw,
  color,
  fontSize,
  lineHeight,
  weight,
  letterSpacing,
  stroke,
  shadow,
  onEdit,
}: {
  text: string;
  locale: string;
  uppercase: boolean | undefined;
  emphasis: EmphasisStyle;
  accent: string;
  scriptFamily: string;
  /** The headline font size, in cqw (a plain number); scales the script and mark sizes. */
  headlineSizeCqw: number;
  color: string;
  fontSize: string;
  lineHeight: number;
  weight: number;
  letterSpacing: string;
  stroke: { color: string; widthCqw: number } | undefined;
  shadow: { color: string; blurCqw: number; offsetYCqw: number } | undefined;
  onEdit?: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const richStyle: React.CSSProperties = {
    margin: 0,
    color,
    fontSize,
    lineHeight,
    fontWeight: weight,
    letterSpacing,
    WebkitTextStroke: stroke ? `${stroke.widthCqw}cqw ${stroke.color}` : undefined,
    paintOrder: stroke ? "stroke fill" : undefined,
    textShadow: shadow
      ? `0 ${shadow.offsetYCqw}cqw ${shadow.blurCqw}cqw ${shadow.color}`
      : undefined,
  };

  const rich = renderHeadlineRuns(text, {
    uppercase,
    locale,
    emphasis,
    accent,
    scriptFamily,
    headlineSizeCqw,
  });

  if (!onEdit) return <h1 style={richStyle}>{rich}</h1>;

  if (editing) {
    return (
      <h1
        ref={ref}
        style={{ margin: 0, color, fontSize, lineHeight, fontWeight: weight, letterSpacing }}
        {...editableHeadlineProps(onEdit, () => setEditing(false), text)}
      >
        {text}
      </h1>
    );
  }

  return (
    <h1 style={richStyle} {...focusToEditProps(() => setEditing(true), "Headline")}>
      {rich}
    </h1>
  );
}

/**
 * Splits `*word*` markup into runs and renders each per the theme's emphasis
 * style: a plain accent color, the script face, a highlighter band, or a
 * hand-drawn underline/circle traced over the word in an inline SVG. Mirrors
 * drawBlock in src/draw.ts.
 */
function renderHeadlineRuns(
  text: string,
  opts: {
    uppercase: boolean | undefined;
    locale: string;
    emphasis: EmphasisStyle;
    accent: string;
    scriptFamily: string;
    headlineSizeCqw: number;
  },
): ReactNode[] {
  const upper = (s: string) => (opts.uppercase ? s.toLocaleUpperCase(opts.locale) : s);
  const runs: Run[] = mapRuns(parseEmphasis(text), upper);
  const wordBoxHeightCqw = opts.headlineSizeCqw * 0.86;
  let markIndex = 0;
  // Runs are a stable parse of this one headline string, in order; the index
  // is a fine key.
  return runs.map((r, i) => {
    // biome-ignore lint/suspicious/noArrayIndexKey: stable parse of one fixed string
    if (!r.em) return <Fragment key={i}>{r.text}</Fragment>;
    const seed = markIndex++;
    switch (opts.emphasis) {
      case "script":
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: stable parse of one fixed string
            key={i}
            style={{
              color: opts.accent,
              fontFamily: opts.scriptFamily,
              fontWeight: TYPE.kickerWeight,
              fontSize: `${opts.headlineSizeCqw * 1.14}cqw`,
            }}
          >
            {r.text}
          </span>
        );
      case "highlight":
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable parse of one fixed string
          <span key={i} style={{ position: "relative", display: "inline-block" }}>
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: `${-HIGHLIGHT.padX * 100}%`,
                width: `${(1 + 2 * HIGHLIGHT.padX) * 100}%`,
                top: `${HIGHLIGHT.top * 100}%`,
                height: `${HIGHLIGHT.height * 100}%`,
                background: opts.accent,
                opacity: HIGHLIGHT.alpha,
              }}
            />
            <span style={{ position: "relative" }}>{r.text}</span>
          </span>
        );
      case "underline":
      case "circle": {
        const d =
          opts.emphasis === "circle"
            ? circleMarkPath(MARK_BOX, 7 + seed)
            : underlineMarkPath(MARK_BOX, 3 + seed);
        const strokeWidth = `${MARK_STROKE[opts.emphasis] * wordBoxHeightCqw}cqw`;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable parse of one fixed string
          <span key={i} style={{ position: "relative", display: "inline-block" }}>
            {r.text}
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden
              style={{
                position: "absolute",
                left: 0,
                top: "6%",
                width: "100%",
                height: "86%",
                overflow: "visible",
                pointerEvents: "none",
              }}
            >
              <path
                d={d}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ stroke: opts.accent, strokeWidth }}
              />
            </svg>
          </span>
        );
      }
      default:
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable parse of one fixed string
          <span key={i} style={{ color: opts.accent }}>
            {r.text}
          </span>
        );
    }
  });
}

/**
 * Props that make a copy element editable in place. The text is committed
 * on blur or Enter (Shift+Enter keeps a line break, as the export honours
 * newlines); Escape restores the current value and leaves the field.
 */
function editableProps(commit: (text: string) => void, current: string, label: string) {
  return {
    contentEditable: "plaintext-only" as const,
    suppressContentEditableWarning: true,
    role: "textbox",
    "aria-label": label,
    "data-placeholder": label,
    spellCheck: false,
    className: "editable-copy",
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      const text = e.currentTarget.innerText.replace(/\n+$/, "");
      if (text !== current) commit(text);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.currentTarget.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.currentTarget.innerText = current;
        e.currentTarget.blur();
      }
    },
  };
}

/**
 * Props for the headline's editing field: like editableProps, but always
 * leaves edit mode on blur (not only when the text changed), so an unedited
 * blur still returns to the rendered, emphasis-aware preview.
 */
function editableHeadlineProps(
  commit: (text: string) => void,
  stopEditing: () => void,
  current: string,
) {
  const base = editableProps(commit, current, "Headline");
  return {
    ...base,
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      base.onBlur(e);
      stopEditing();
    },
  };
}

/** Props that turn a rendered (non-editing) headline into a focusable field that starts editing. */
function focusToEditProps(startEditing: () => void, label: string) {
  return {
    role: "textbox",
    "aria-label": label,
    "data-placeholder": label,
    tabIndex: 0,
    className: "editable-copy",
    onClick: startEditing,
    onFocus: startEditing,
  };
}

/**
 * Plays the raw clips back to back, unframed, exactly as the exported video
 * joins them. Always muted - the configured audio bed only exists in the
 * exported video.
 */
function PreviewScene({ segments }: { segments: Array<{ url: string; durationSeconds: number }> }) {
  const [index, setIndex] = useState(0);
  const segment = segments[index % segments.length]!;
  return (
    // Remounting on every advance restarts playback even with one clip.
    <video
      key={index}
      src={`/${segment.url}`}
      autoPlay
      muted
      playsInline
      preload="auto"
      onEnded={() => setIndex((i) => i + 1)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

/**
 * One strip tile. Screenshot tiles sit inside a Reorder.Item, which handles
 * the drag; a click still opens the lightbox.
 */
function Tile({
  width,
  height,
  bad,
  badReason,
  overLimit,
  onOpen,
  transitionName,
  draggable,
  children,
}: {
  width: number;
  height: number;
  bad: boolean;
  badReason?: string;
  overLimit?: boolean;
  onOpen: () => void;
  transitionName?: string;
  draggable: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`min-w-0 flex-1 ${overLimit ? "opacity-40" : ""}`}>
      <button
        type="button"
        aria-label={
          overLimit
            ? "Open full-size preview (past the App Store screenshot limit)"
            : draggable
              ? "Open full-size preview (drag to reorder)"
              : "Open full-size preview"
        }
        title={draggable ? "Drag to reorder" : undefined}
        onClick={onOpen}
        className={`tile-shadow relative block w-full overflow-hidden rounded-2xl bg-neutral-200 ring-1 ring-black/10 transition-[transform,box-shadow,--tw-ring-color] duration-150 select-none hover:-translate-y-0.5 hover:ring-black/25 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none dark:bg-neutral-800 dark:ring-white/10 dark:hover:ring-white/30 ${
          draggable ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
        }`}
        style={{ aspectRatio: `${width} / ${height}`, viewTransitionName: transitionName }}
      >
        {children}
      </button>
      {bad ? (
        <p className="pt-2 text-center text-[11px] font-medium text-destructive">{badReason}</p>
      ) : null}
    </div>
  );
}

/**
 * "Reset element" in the inspector: the copy block or a device drops its
 * transform back to the layout's own geometry; a decoration still present in
 * the config restores to its config values, one newly added by the editor is
 * removed instead (there is nothing to fall back to).
 */
function resetSelected(editor: EditorEntryInfo): void {
  const sel = editor.selection;
  if (!sel) return;
  if (sel.kind === "copy") {
    const t = { ...editor.transform };
    delete t.copy;
    editor.onTransform(t, "reset:copy");
    return;
  }
  if (sel.kind === "device") {
    const devices = [...(editor.transform.devices ?? [])];
    devices[sel.index] = {};
    editor.onTransform({ ...editor.transform, devices }, `reset:device:${sel.index}`);
    return;
  }
  if (sel.index < editor.baselineDecorations.length) {
    const next = editor.decorations.map((d, i) =>
      i === sel.index ? editor.baselineDecorations[i]! : d,
    );
    editor.onDecorations(next, `reset:decoration:${sel.index}`);
  } else {
    editor.onDecorations(
      editor.decorations.filter((_, i) => i !== sel.index),
      `reset:decoration:${sel.index}`,
    );
    editor.onSelect(null);
  }
}

/** Position of a scene id in the saved order; unlisted ids sort last, in config order. */
function rankOf(order: string[], id: string): number {
  const i = order.indexOf(id);
  return i === -1 ? Number.POSITIVE_INFINITY : i;
}

/**
 * Mirror of the CLI's backgroundLuminance: mean relative luminance of the
 * value's six-digit hex colors, or null when it has none.
 */
function backgroundLuminance(css: string): number | null {
  const hexes = css.match(/#[0-9a-fA-F]{6}/g);
  if (!hexes || hexes.length === 0) return null;
  const luminance = (hex: string) => {
    const channel = (offset: number) => {
      const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  return hexes.reduce((sum, hex) => sum + luminance(hex), 0) / hexes.length;
}
