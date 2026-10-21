import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  CropIcon,
  ImagePlusIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  PlusIcon,
  Redo2Icon,
  RefreshCwIcon,
  RotateCcwIcon,
  StarIcon,
  TagIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  centerGuides,
  clamp,
  nudgeStep,
  snapBoxDelta,
  snapRotation,
  toFraction,
} from "../../../src/editor-geom";
import type { Composition, CopyAlign } from "../../../src/layouts";
import { loadRedoInfo, type RedoAsset, restoreArt, runRedoArt, runRedoCapture } from "../lib/redo";
import type { ArtLibraryImage, Decoration, SceneTransform } from "../manifest";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * The full element editor: select any element in the lightbox (the copy
 * block, a device, or a scene decoration), drag it, resize it from a corner,
 * rotate it from the handle above it, or nudge it with the arrow keys.
 *
 * Geometry lives in two places and this module bridges them: the canonical
 * values the CLI renders from (a decoration's x/y/width/rotate fractions, or
 * a scene's dx/dy/scale/rotate ElementTransform for the copy block and each
 * device), and the measured on-screen box of the element currently selected
 * (read from the DOM via `data-edit`, which Strip.tsx tags onto the matching
 * elements). Dragging reads the DOM for feel - a scale-free ratio off the
 * measured box, an angle off the measured centre - and writes the canonical
 * fields, so the exported PNG lands exactly where the handle let go.
 */

export type Selection =
  | { kind: "copy" }
  | { kind: "device"; index: number }
  | { kind: "decoration"; index: number };

/** The data-edit attribute value for a selection; Strip.tsx tags the matching element with it. */
export function editKey(sel: Selection): string {
  return sel.kind === "copy" ? "copy" : `${sel.kind}:${sel.index}`;
}

export const ADD_KINDS = ["image", "bubble", "rating", "badge", "callout"] as const;
export type AddKind = (typeof ADD_KINDS)[number];

/** A fresh decoration of `kind`, centred-ish on the tile, ready to drag into place. */
export function defaultDecoration(kind: AddKind, locale: string, imageSrc?: string): Decoration {
  switch (kind) {
    case "image":
      return { kind: "image", src: imageSrc ?? "", x: 0.3, y: 0.32, width: 0.4 };
    case "bubble":
      return {
        kind: "bubble",
        text: { [locale]: "Edit me" },
        x: 0.1,
        y: 0.14,
        width: 0.55,
        tail: "bottom-left",
      };
    case "rating":
      return {
        kind: "rating",
        value: "4.9",
        label: { [locale]: "Loved by users" },
        x: 0.25,
        y: 0.8,
        width: 0.5,
      };
    case "badge":
      return { kind: "badge", text: { [locale]: "New" }, position: "top-right" };
    case "callout":
      return {
        kind: "callout",
        from: { x: 0.08, y: 0.3, width: 0.84, height: 0.16 },
        x: 0.08,
        y: 0.56,
        width: 0.84,
      };
  }
}

/** The scene's own decorations in canonical form: `configSrc` swapped back into `src` for image layers. */
export function canonicalDecorations(list: Decoration[]): Decoration[] {
  return list.map((d) => {
    if (d.kind !== "image") return d;
    const { configSrc, ...rest } = d;
    return configSrc ? { ...rest, src: configSrc } : d;
  });
}

/** A canonical decoration with `src` mapped to a browser-fetchable url, for rendering. */
export function displayDecoration(
  d: Decoration,
  resolveUrl: (configSrc: string) => string,
): Decoration {
  return d.kind === "image" ? { ...d, src: resolveUrl(d.src) } : d;
}

const SNAP_THRESHOLD_FRACTION = 0.012;

/**
 * Selection outline, drag/resize/rotate handles, and the keyboard shortcuts
 * (arrows, Delete, Escape), layered over the composed scene. Mounted only in
 * the lightbox - `containerRef` is the Canvas div the handled elements are
 * tagged inside (via data-edit), used both to measure them and to collect
 * every other element's box for the snapping guides.
 */
export function EditorOverlay({
  containerRef,
  tile,
  span,
  composition,
  baseComposition,
  decorations,
  onDecorations,
  transform,
  onTransform,
  selection,
  onSelect,
  pickRegionIndex,
  onPickRegionDone,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  tile: { width: number; height: number };
  span: number;
  /** The current (post-transform) composition, for the copy/device boxes a fresh selection starts from. */
  composition: Composition;
  /** The pre-transform composition, whose device rotate values are each device's zero point. */
  baseComposition: Composition;
  decorations: Decoration[];
  onDecorations: (list: Decoration[], fieldKey: string) => void;
  transform: SceneTransform;
  onTransform: (t: SceneTransform, fieldKey: string) => void;
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  /** Index of a callout decoration currently picking its source region, if any. */
  pickRegionIndex: number | null;
  onPickRegionDone: (from: { x: number; y: number; width: number; height: number }) => void;
}) {
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    rotate: number;
  } | null>(null);

  // Re-measure the selected element after every render that could move it:
  // its own data change, the scene transform, or a resize of the window.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!selection || !container) {
      setBox(null);
      return;
    }
    const el = container.querySelector<HTMLElement>(`[data-edit="${editKey(selection)}"]`);
    if (!el) {
      setBox(null);
      return;
    }
    const measure = () => {
      const containerRect = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      // getBoundingClientRect gives the rotated element's axis-aligned box,
      // which is wider than its real size; offsetWidth/Height are the
      // unrotated layout size, and the centre of a box rotated about itself
      // does not move, so the two combine into the true unrotated box.
      const cx = r.left + r.width / 2 - containerRect.left;
      const cy = r.top + r.height / 2 - containerRect.top;
      const w = el.offsetWidth || r.width;
      const h = el.offsetHeight || r.height;
      const rotate = rotationOf(selection, transform, baseComposition, decorations);
      setBox((prev) => {
        const next = { left: cx - w / 2, top: cy - h / 2, width: w, height: h, rotate };
        if (
          prev &&
          Math.abs(prev.left - next.left) < 0.5 &&
          Math.abs(prev.top - next.top) < 0.5 &&
          Math.abs(prev.width - next.width) < 0.5 &&
          Math.abs(prev.height - next.height) < 0.5 &&
          prev.rotate === next.rotate
        )
          return prev;
        return next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // decorations/transform change the element's position/size (composition
    // is transform applied to baseComposition, so transform already covers
    // it); baseComposition's device rotate values feed rotationOf() above.
  }, [selection, decorations, transform, baseComposition, containerRef]);

  // Arrow-key nudge and Delete/Escape, while something is selected and no
  // text field has focus (the lightbox's headline/subhead editing, or an
  // inspector input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selection) return;
      if (isTextTarget(e.target)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onSelect(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selection.kind === "decoration") {
        e.preventDefault();
        const next = decorations.filter((_, i) => i !== selection.index);
        onDecorations(next, `delete:${editKey(selection)}`);
        onSelect(null);
        return;
      }
      const step = nudgeStep(e.shiftKey);
      let dxFrac = 0;
      let dyFrac = 0;
      if (e.key === "ArrowLeft") dxFrac = -step;
      else if (e.key === "ArrowRight") dxFrac = step;
      else if (e.key === "ArrowUp") dyFrac = -step;
      else if (e.key === "ArrowDown") dyFrac = step;
      else return;
      e.preventDefault();
      moveBy(selection, dxFrac, dyFrac, tile, decorations, onDecorations, transform, onTransform);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, decorations, transform, tile, onDecorations, onTransform, onSelect]);

  if (pickRegionIndex !== null) {
    const d = decorations[pickRegionIndex];
    const which = d && d.kind === "callout" ? (d.capture ?? "primary") : "primary";
    const screen = composition.devices.find((dv) => dv.capture === which)?.screen;
    if (!screen) return null;
    return (
      <RegionPicker
        containerRef={containerRef}
        screen={screen}
        onDone={(from) => onPickRegionDone(from)}
      />
    );
  }

  if (!selection || !box) return null;
  const selectedDecoration =
    selection.kind === "decoration" ? decorations[selection.index] : undefined;
  // A badge has no x/y/width/rotate at all (it sits at a fixed corner) - the
  // inspector still edits its position/text/colors, but there is no box to
  // drag, resize or rotate here.
  if (selectedDecoration?.kind === "badge") return null;
  const rotatable =
    selection.kind === "device" ||
    (selection.kind === "decoration" && hasRotate(selectedDecoration));
  const resizable =
    selection.kind !== "decoration" || Boolean(selectedDecoration && "width" in selectedDecoration);

  const start =
    (type: "move" | "resize" | "rotate", corner?: { sx: number; sy: number }) =>
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const others =
        type === "move" ? otherBoxesCompPx(container, containerRect, selection, tile) : [];
      const startValues = currentValues(selection, decorations, transform);
      const pointerId = e.pointerId;
      (e.currentTarget as HTMLElement).setPointerCapture(pointerId);

      const onMove = (ev: PointerEvent) => {
        const dClientX = ev.clientX - e.clientX;
        const dClientY = ev.clientY - e.clientY;
        if (type === "move") {
          let dxFrac = dClientX / containerRect.width;
          let dyFrac = dClientY / containerRect.height;
          if (!ev.altKey) {
            const movedLeft = box.left + dClientX;
            const movedTop = box.top + dClientY;
            const guides = centerGuides(tile.width, tile.height, span, others);
            const threshold = tile.width * SNAP_THRESHOLD_FRACTION;
            const sx = snapBoxDelta(movedLeft, box.width, guides.x, threshold);
            const sy = snapBoxDelta(movedTop, box.height, guides.y, threshold);
            dxFrac += toFraction(sx.delta, tile.width);
            dyFrac += toFraction(sy.delta, tile.height);
          }
          applyMove(
            selection,
            startValues,
            dxFrac,
            dyFrac,
            decorations,
            onDecorations,
            transform,
            onTransform,
          );
        } else if (type === "resize" && corner) {
          const angle = (box.rotate * Math.PI) / 180;
          const localDx = dClientX * Math.cos(angle) + dClientY * Math.sin(angle);
          const growth = corner.sx * localDx;
          const ratio = clamp(1 + growth / (box.width / 2), 0.1, 10);
          applyResize(
            selection,
            startValues,
            ratio,
            decorations,
            onDecorations,
            transform,
            onTransform,
          );
        } else if (type === "rotate") {
          const cx = containerRect.left + box.left + box.width / 2;
          const cy = containerRect.top + box.top + box.height / 2;
          const angle = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
          const snapped = snapRotation(angle, ev.shiftKey);
          applyRotate(
            selection,
            snapped,
            decorations,
            onDecorations,
            transform,
            onTransform,
            baseComposition,
          );
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

  const corners: Array<{ sx: 1 | -1; sy: 1 | -1; cursor: string }> = [
    { sx: -1, sy: -1, cursor: "nwse-resize" },
    { sx: 1, sy: -1, cursor: "nesw-resize" },
    { sx: -1, sy: 1, cursor: "nesw-resize" },
    { sx: 1, sy: 1, cursor: "nwse-resize" },
  ];

  return (
    <div
      className="absolute"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      <div
        className="pointer-events-auto absolute cursor-move ring-2 ring-primary"
        style={{ inset: 0, transform: `rotate(${box.rotate}deg)` }}
        onPointerDown={start("move")}
      >
        {resizable &&
          corners.map((c) => (
            <button
              key={`${c.sx}-${c.sy}`}
              type="button"
              aria-label="Resize"
              onPointerDown={start("resize", c)}
              className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-white shadow"
              style={{
                left: c.sx === -1 ? 0 : "100%",
                top: c.sy === -1 ? 0 : "100%",
                cursor: c.cursor,
              }}
            />
          ))}
        {rotatable ? (
          <button
            type="button"
            aria-label="Rotate"
            onPointerDown={start("rotate")}
            className="absolute left-1/2 -translate-x-1/2 -translate-y-full rounded-full border-2 border-primary bg-white p-1 shadow"
            style={{ top: -18, cursor: "grab" }}
          >
            <RotateCcwIcon className="size-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Whether a decoration kind has a `rotate` field at all (rating and badge do not). */
function hasRotate(d: Decoration | undefined): boolean {
  return Boolean(d) && d!.kind !== "rating" && d!.kind !== "badge";
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}

/** Every other editable element's measured box, in composition pixels, for the snap guides. */
function otherBoxesCompPx(
  container: HTMLElement,
  containerRect: DOMRect,
  selection: Selection,
  tile: { width: number; height: number },
) {
  const scaleX = tile.width / containerRect.width;
  const scaleY = tile.height / containerRect.height;
  const boxes: Array<{ left: number; top: number; width: number; height: number }> = [];
  for (const el of container.querySelectorAll<HTMLElement>("[data-edit]")) {
    if (el.dataset.edit === editKey(selection)) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2 - containerRect.left;
    const cy = r.top + r.height / 2 - containerRect.top;
    const w = (el.offsetWidth || r.width) * scaleX;
    const h = (el.offsetHeight || r.height) * scaleY;
    boxes.push({ left: cx * scaleX - w / 2, top: cy * scaleY - h / 2, width: w, height: h });
  }
  return boxes;
}

type StartValues =
  | { kind: "copy"; dx: number; dy: number; scale: number }
  | { kind: "device"; index: number; dx: number; dy: number; scale: number }
  | { kind: "decoration"; index: number; x: number; y: number; width: number };

function currentValues(
  selection: Selection,
  decorations: Decoration[],
  transform: SceneTransform,
): StartValues {
  if (selection.kind === "copy") {
    const t = transform.copy;
    return { kind: "copy", dx: t?.dx ?? 0, dy: t?.dy ?? 0, scale: t?.scale ?? 1 };
  }
  if (selection.kind === "device") {
    const t = transform.devices?.[selection.index];
    return {
      kind: "device",
      index: selection.index,
      dx: t?.dx ?? 0,
      dy: t?.dy ?? 0,
      scale: t?.scale ?? 1,
    };
  }
  const d = decorations[selection.index];
  const x = "x" in d ? d.x : 0;
  const y = "y" in d ? d.y : 0;
  const width = "width" in d ? d.width : 0.3;
  return { kind: "decoration", index: selection.index, x, y, width };
}

function applyMove(
  selection: Selection,
  start: StartValues,
  dxFrac: number,
  dyFrac: number,
  decorations: Decoration[],
  onDecorations: (list: Decoration[], fieldKey: string) => void,
  transform: SceneTransform,
  onTransform: (t: SceneTransform, fieldKey: string) => void,
) {
  if (start.kind === "decoration" && selection.kind === "decoration") {
    const next = decorations.map((d, i) =>
      i === selection.index && "x" in d
        ? { ...d, x: clamp(start.x + dxFrac, -0.2, 2), y: clamp(start.y + dyFrac, -0.2, 1.2) }
        : d,
    );
    onDecorations(next, `move:${editKey(selection)}`);
    return;
  }
  if (start.kind === "copy") {
    onTransform(
      { ...transform, copy: { ...transform.copy, dx: start.dx + dxFrac, dy: start.dy + dyFrac } },
      `move:${editKey(selection)}`,
    );
    return;
  }
  if (start.kind === "device" && selection.kind === "device") {
    const devices = [...(transform.devices ?? [])];
    devices[selection.index] = {
      ...devices[selection.index],
      dx: start.dx + dxFrac,
      dy: start.dy + dyFrac,
    };
    onTransform({ ...transform, devices }, `move:${editKey(selection)}`);
  }
}

function applyResize(
  selection: Selection,
  start: StartValues,
  ratio: number,
  decorations: Decoration[],
  onDecorations: (list: Decoration[], fieldKey: string) => void,
  transform: SceneTransform,
  onTransform: (t: SceneTransform, fieldKey: string) => void,
) {
  if (start.kind === "decoration" && selection.kind === "decoration") {
    const next = decorations.map((d, i) =>
      i === selection.index && "width" in d
        ? { ...d, width: clamp(start.width * ratio, 0.02, 3) }
        : d,
    );
    onDecorations(next, `resize:${editKey(selection)}`);
    return;
  }
  if (start.kind === "copy") {
    onTransform(
      { ...transform, copy: { ...transform.copy, scale: clamp(start.scale * ratio, 0.3, 3) } },
      `resize:${editKey(selection)}`,
    );
    return;
  }
  if (start.kind === "device" && selection.kind === "device") {
    const devices = [...(transform.devices ?? [])];
    devices[selection.index] = {
      ...devices[selection.index],
      scale: clamp(start.scale * ratio, 0.2, 4),
    };
    onTransform({ ...transform, devices }, `resize:${editKey(selection)}`);
  }
}

function applyRotate(
  selection: Selection,
  absoluteDeg: number,
  decorations: Decoration[],
  onDecorations: (list: Decoration[], fieldKey: string) => void,
  transform: SceneTransform,
  onTransform: (t: SceneTransform, fieldKey: string) => void,
  baseComposition: Composition,
) {
  if (selection.kind === "decoration") {
    const next = decorations.map((d, i) =>
      i === selection.index && hasRotate(d) ? { ...d, rotate: round1(absoluteDeg) } : d,
    );
    onDecorations(next, `rotate:${editKey(selection)}`);
    return;
  }
  if (selection.kind === "device") {
    const base = baseComposition.devices[selection.index]?.rotate ?? 0;
    const devices = [...(transform.devices ?? [])];
    devices[selection.index] = { ...devices[selection.index], rotate: round1(absoluteDeg - base) };
    onTransform({ ...transform, devices }, `rotate:${editKey(selection)}`);
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function rotationOf(
  selection: Selection,
  transform: SceneTransform,
  baseComposition: Composition,
  decorations: Decoration[],
): number {
  if (selection.kind === "copy") return 0;
  if (selection.kind === "device") {
    const base = baseComposition.devices[selection.index]?.rotate ?? 0;
    return base + (transform.devices?.[selection.index]?.rotate ?? 0);
  }
  const d = decorations[selection.index];
  return d && hasRotate(d) ? ((d as { rotate?: number }).rotate ?? 0) : 0;
}

/** The same keyboard-nudge move, used both by arrow keys and (indirectly) drag. */
function moveBy(
  selection: Selection,
  dxFrac: number,
  dyFrac: number,
  _tile: { width: number; height: number },
  decorations: Decoration[],
  onDecorations: (list: Decoration[], fieldKey: string) => void,
  transform: SceneTransform,
  onTransform: (t: SceneTransform, fieldKey: string) => void,
) {
  const start = currentValues(selection, decorations, transform);
  applyMove(selection, start, dxFrac, dyFrac, decorations, onDecorations, transform, onTransform);
}

/**
 * Draws a rectangle over a device's screen to set a callout's `from` region.
 * `screen` is the device's current (post-transform) screen box, in
 * composition pixels; the drawn rectangle is reported as fractions of it.
 */
function RegionPicker({
  containerRef,
  screen,
  onDone,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  screen: { left: number; top: number; width: number; height: number };
  onDone: (from: { x: number; y: number; width: number; height: number }) => void;
}) {
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const draggingFrom = useRef<{ x: number; y: number } | null>(null);

  const toFrac = (px: { left: number; top: number; width: number; height: number }) => ({
    x: clamp(toFraction(px.left - screen.left, screen.width), 0, 1),
    y: clamp(toFraction(px.top - screen.top, screen.height), 0, 1),
    width: clamp(toFraction(px.width, screen.width), 0.02, 1),
    height: clamp(toFraction(px.height, screen.height), 0.02, 1),
  });

  const onPointerDown = (e: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const cr = container.getBoundingClientRect();
    const start = { x: e.clientX - cr.left, y: e.clientY - cr.top };
    draggingFrom.current = start;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const x = ev.clientX - cr.left;
      const y = ev.clientY - cr.top;
      setRect({
        left: Math.min(start.x, x),
        top: Math.min(start.y, y),
        width: Math.abs(x - start.x),
        height: Math.abs(y - start.y),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className="absolute inset-0 cursor-crosshair bg-black/10"
      onPointerDown={onPointerDown}
      role="presentation"
    >
      <div
        className="absolute rounded border-2 border-dashed border-primary bg-primary/10"
        style={{
          left: screen.left,
          top: screen.top,
          width: screen.width,
          height: screen.height,
        }}
      />
      {rect ? (
        <div
          className="absolute border-2 border-primary bg-primary/20"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      ) : null}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!rect || rect.width < 4 || rect.height < 4}
          onClick={() => rect && onDone(toFrac(rect))}
        >
          Use this region
        </Button>
      </div>
    </div>
  );
}

/**
 * Undo/redo and revert controls for the lightbox toolbar; always visible on
 * an editable (screenshot) tile so a mistake is always one click from fixed.
 */
export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRevertScene,
  onRevertAll,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRevertScene: () => void;
  onRevertAll: () => void;
}) {
  return (
    <div className="dark flex items-center gap-1 text-foreground">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        disabled={!canUndo}
        onClick={onUndo}
        aria-label="Undo"
      >
        <Undo2Icon />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        disabled={!canRedo}
        onClick={onRedo}
        aria-label="Redo"
      >
        <Redo2Icon />
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onRevertScene}>
        Revert scene
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onRevertAll}>
        Revert all
      </Button>
    </div>
  );
}

const ADD_MENU: Array<{ kind: AddKind; label: string; icon: typeof PlusIcon }> = [
  { kind: "bubble", label: "Speech bubble", icon: MessageSquareTextIcon },
  { kind: "rating", label: "Rating", icon: StarIcon },
  { kind: "badge", label: "Badge", icon: TagIcon },
  { kind: "callout", label: "Callout", icon: CropIcon },
];

/** The "Add" menu: a decoration kind, or an image picked from the art library. */
export function AddMenu({
  artLibrary,
  onAdd,
}: {
  artLibrary: ArtLibraryImage[];
  onAdd: (kind: AddKind, image?: ArtLibraryImage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="default" size="sm">
          <PlusIcon /> Add
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="dark w-56 p-1 text-foreground">
        <Popover open={imageOpen} onOpenChange={setImageOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <ImagePlusIcon className="size-4" /> Image
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="dark w-72 text-foreground">
            {artLibrary.length === 0 ? (
              <p className="p-2 text-xs text-muted-foreground">
                No images in the config's art dir or references yet.
              </p>
            ) : (
              <div className="grid max-h-72 grid-cols-4 gap-1.5 overflow-y-auto p-1">
                {artLibrary.map((img) => (
                  <button
                    key={img.src}
                    type="button"
                    title={img.src}
                    className="aspect-square overflow-hidden rounded-md border border-border bg-muted hover:ring-2 hover:ring-primary"
                    onClick={() => {
                      onAdd("image", img);
                      setImageOpen(false);
                      setOpen(false);
                    }}
                  >
                    <img src={img.url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
        {ADD_MENU.map(({ kind, label, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            onClick={() => {
              onAdd(kind);
              setOpen(false);
            }}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The inspector: numeric x/y/width/rotate for the current selection (where it
 * has them), layer and z-order, and the fields specific to its decoration
 * kind. Nothing here is rotate/position for a badge (it only has a corner),
 * and the copy block has no rotate at all.
 */
export function Inspector({
  selection,
  onSelect,
  decorations,
  onDecorations,
  transform,
  onTransform,
  baseComposition,
  locale,
  onReset,
  onPickRegion,
  copyText,
  onCopyText,
  defaultAlign,
}: {
  selection: Selection;
  onSelect: (sel: Selection) => void;
  decorations: Decoration[];
  onDecorations: (list: Decoration[], fieldKey: string) => void;
  transform: SceneTransform;
  onTransform: (t: SceneTransform, fieldKey: string) => void;
  baseComposition: Composition;
  locale: string;
  onReset: () => void;
  onPickRegion: () => void;
  copyText: { kicker: string; headline: string; subhead: string };
  onCopyText: (field: "headline" | "subhead" | "kicker", text: string) => void;
  defaultAlign: CopyAlign;
}) {
  const setDecoration = (patch: Partial<Decoration>, fieldKey: string) => {
    if (selection.kind !== "decoration") return;
    const next = decorations.map((d, i) =>
      i === selection.index ? ({ ...d, ...patch } as Decoration) : d,
    );
    onDecorations(next, `field:${editKey(selection)}:${fieldKey}`);
  };
  const move = (index: number, dz: -1 | 1) => {
    if (index + dz < 0 || index + dz >= decorations.length) return;
    const next = [...decorations];
    const [item] = next.splice(index, 1);
    next.splice(index + dz, 0, item!);
    onDecorations(next, `reorder:decoration:${index}`);
    onSelect({ kind: "decoration", index: index + dz });
  };

  const d = selection.kind === "decoration" ? decorations[selection.index] : undefined;

  return (
    <div className="dark flex w-64 flex-col gap-3 rounded-xl border border-border bg-popover p-3 text-foreground">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase">
          {selection.kind === "copy" ? "Copy" : selection.kind === "device" ? "Device" : d?.kind}
        </h3>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onReset}
            aria-label="Reset element"
          >
            <RotateCcwIcon className="size-3.5" />
          </Button>
          {selection.kind === "decoration" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Delete"
              onClick={() => {
                onDecorations(
                  decorations.filter((_, i) => i !== selection.index),
                  `delete:${editKey(selection)}`,
                );
              }}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {selection.kind !== "copy" && selection.kind !== "device" && d && "x" in d ? (
        <NumberRow d={d} onChange={(patch) => setDecoration(patch, "position")} />
      ) : null}

      {selection.kind === "decoration" ? (
        <div className="flex items-center gap-1">
          <Label className="flex-1 text-xs text-muted-foreground">Order</Label>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            onClick={() => move(selection.index, -1)}
            aria-label="Send backward"
          >
            <ArrowDownToLineIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            onClick={() => move(selection.index, 1)}
            aria-label="Bring forward"
          >
            <ArrowUpToLineIcon className="size-3.5" />
          </Button>
          <Select2
            value={(d as { layer?: string } | undefined)?.layer ?? "back"}
            onChange={(v) => setDecoration({ layer: v as "back" | "front" }, "layer")}
            options={[
              ["back", "Behind device"],
              ["front", "Over device"],
            ]}
          />
        </div>
      ) : null}

      {d?.kind === "image" ? (
        <>
          <Toggle
            label="Flip horizontally"
            checked={Boolean(d.flip)}
            onChange={(v) => setDecoration({ flip: v }, "flip")}
          />
          <Toggle
            label="Shadow"
            checked={Boolean(d.shadow)}
            onChange={(v) => setDecoration({ shadow: v }, "shadow")}
          />
          <SliderRow
            label="Opacity"
            value={d.opacity ?? 1}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setDecoration({ opacity: v }, "opacity")}
          />
        </>
      ) : null}

      {d?.kind === "bubble" ? (
        <>
          <TextRow
            label="Text"
            value={d.text[locale] ?? ""}
            onChange={(v) => setDecoration({ text: { ...d.text, [locale]: v } }, "text")}
          />
          <Select2
            value={d.tail ?? "bottom-left"}
            onChange={(v) => setDecoration({ tail: v as typeof d.tail }, "tail")}
            options={[
              ["bottom-left", "Tail bottom-left"],
              ["bottom-right", "Tail bottom-right"],
              ["top-left", "Tail top-left"],
              ["top-right", "Tail top-right"],
              ["none", "No tail"],
            ]}
          />
          <Select2
            value={d.font ?? "sans"}
            onChange={(v) => setDecoration({ font: v as "sans" | "script" }, "font")}
            options={[
              ["sans", "Sans font"],
              ["script", "Script font"],
            ]}
          />
          <ColorRow
            label="Background"
            value={d.background ?? "#FFFFFF"}
            onChange={(v) => setDecoration({ background: v }, "bg")}
          />
          <ColorRow
            label="Text color"
            value={d.color ?? "#111111"}
            onChange={(v) => setDecoration({ color: v }, "color")}
          />
        </>
      ) : null}

      {d?.kind === "rating" ? (
        <>
          <TextRow
            label="Value"
            value={d.value}
            onChange={(v) => setDecoration({ value: v }, "value")}
          />
          <TextRow
            label="Label"
            value={d.label?.[locale] ?? ""}
            onChange={(v) => setDecoration({ label: { ...(d.label ?? {}), [locale]: v } }, "label")}
          />
          <Toggle
            label="Laurels"
            checked={d.laurels !== false}
            onChange={(v) => setDecoration({ laurels: v }, "laurels")}
          />
          <ColorRow
            label="Color"
            value={d.color ?? "#111111"}
            onChange={(v) => setDecoration({ color: v }, "color")}
          />
        </>
      ) : null}

      {d?.kind === "badge" ? (
        <>
          <TextRow
            label="Text"
            value={d.text[locale] ?? ""}
            onChange={(v) => setDecoration({ text: { ...d.text, [locale]: v } }, "text")}
          />
          <Select2
            value={d.position}
            onChange={(v) => setDecoration({ position: v as typeof d.position }, "position")}
            options={[
              ["top-left", "Top left"],
              ["top-right", "Top right"],
              ["bottom-left", "Bottom left"],
              ["bottom-right", "Bottom right"],
            ]}
          />
          <ColorRow
            label="Background"
            value={d.background ?? "#0E1B2A"}
            onChange={(v) => setDecoration({ background: v }, "bg")}
          />
          <ColorRow
            label="Text color"
            value={d.color ?? "#FFFFFF"}
            onChange={(v) => setDecoration({ color: v }, "color")}
          />
        </>
      ) : null}

      {d?.kind === "callout" ? (
        <>
          <Button type="button" variant="outline" size="sm" onClick={onPickRegion}>
            <CropIcon /> Pick region
          </Button>
          <Toggle
            label="Shadow"
            checked={d.shadow !== false}
            onChange={(v) => setDecoration({ shadow: v }, "shadow")}
          />
          <NumberField
            label="Radius"
            value={d.radius ?? 0.03}
            step={0.005}
            onChange={(v) => setDecoration({ radius: v }, "radius")}
          />
          <ColorRow
            label="Border"
            value={d.border ?? "#FFFFFF"}
            onChange={(v) => setDecoration({ border: v }, "border")}
          />
        </>
      ) : null}

      {selection.kind === "device" ? (
        <TransformFields
          t={transform.devices?.[selection.index]}
          onChange={(t) => {
            const devices = [...(transform.devices ?? [])];
            devices[selection.index] = t;
            onTransform({ ...transform, devices }, `field:device:${selection.index}`);
          }}
          baseRotate={baseComposition.devices[selection.index]?.rotate ?? 0}
          rotatable
        />
      ) : null}
      {selection.kind === "copy" ? (
        <>
          <CopyFields text={copyText} onChange={onCopyText} />
          <AlignRow
            value={transform.copy?.align ?? defaultAlign}
            onChange={(align) =>
              onTransform({ ...transform, copy: { ...transform.copy, align } }, "field:copy:align")
            }
          />
          <TransformFields
            t={transform.copy}
            onChange={(t) => onTransform({ ...transform, copy: t }, "field:copy")}
            baseRotate={0}
            rotatable={false}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * The tile's kicker, headline and subhead in the current locale. Edits go
 * through the same copy override the lightbox used to edit in place, so they
 * save to goldie.design.json and undo like any other change.
 */
function CopyFields({
  text,
  onChange,
}: {
  text: { kicker: string; headline: string; subhead: string };
  onChange: (field: "headline" | "subhead" | "kicker", text: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <TextRow label="Kicker" value={text.kicker} onChange={(v) => onChange("kicker", v)} />
      <TextAreaRow
        label="Headline"
        hint="Wrap a word in *asterisks* to stress it. Enter starts a new line."
        value={text.headline}
        onChange={(v) => onChange("headline", v)}
      />
      <TextAreaRow label="Subhead" value={text.subhead} onChange={(v) => onChange("subhead", v)} />
    </div>
  );
}

function TextAreaRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <textarea
        id={id}
        value={value}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-12 resize-y rounded-md border border-input bg-transparent px-2 py-1 text-xs leading-snug outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** Left / centre / right for the copy block's lines. */
function AlignRow({ value, onChange }: { value: CopyAlign; onChange: (v: CopyAlign) => void }) {
  const options: Array<{ v: CopyAlign; label: string; Icon: typeof AlignLeftIcon }> = [
    { v: "left", label: "Align left", Icon: AlignLeftIcon },
    { v: "center", label: "Align centre", Icon: AlignCenterIcon },
    { v: "right", label: "Align right", Icon: AlignRightIcon },
  ];
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">Alignment</span>
      <div className="flex gap-1" role="radiogroup" aria-label="Alignment">
        {options.map(({ v, label, Icon }) => (
          <Button
            key={v}
            type="button"
            size="icon-sm"
            variant={value === v ? "default" : "outline"}
            role="radio"
            aria-checked={value === v}
            aria-label={label}
            title={label}
            onClick={() => onChange(v)}
          >
            <Icon />
          </Button>
        ))}
      </div>
    </div>
  );
}

function NumberRow({
  d,
  onChange,
}: {
  d: Decoration & { x: number; y: number; width: number };
  onChange: (patch: Partial<Decoration>) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <NumberField
        label="X"
        value={d.x}
        step={0.01}
        onChange={(v) => onChange({ x: v } as Partial<Decoration>)}
      />
      <NumberField
        label="Y"
        value={d.y}
        step={0.01}
        onChange={(v) => onChange({ y: v } as Partial<Decoration>)}
      />
      <NumberField
        label="W"
        value={d.width}
        step={0.01}
        onChange={(v) => onChange({ width: v } as Partial<Decoration>)}
      />
      {hasRotate(d) ? (
        <NumberField
          label="Rotate"
          value={(d as { rotate?: number }).rotate ?? 0}
          step={1}
          onChange={(v) => onChange({ rotate: v } as Partial<Decoration>)}
        />
      ) : null}
    </div>
  );
}

function TransformFields({
  t,
  onChange,
  baseRotate,
  rotatable,
}: {
  t: { dx?: number; dy?: number; scale?: number; rotate?: number } | undefined;
  onChange: (t: { dx?: number; dy?: number; scale?: number; rotate?: number }) => void;
  baseRotate: number;
  rotatable: boolean;
}) {
  const dx = t?.dx ?? 0;
  const dy = t?.dy ?? 0;
  const scale = t?.scale ?? 1;
  const rotate = (t?.rotate ?? 0) + baseRotate;
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <NumberField
        label="Move X"
        value={dx}
        step={0.01}
        onChange={(v) => onChange({ ...t, dx: v })}
      />
      <NumberField
        label="Move Y"
        value={dy}
        step={0.01}
        onChange={(v) => onChange({ ...t, dy: v })}
      />
      <NumberField
        label="Scale"
        value={scale}
        step={0.05}
        onChange={(v) => onChange({ ...t, scale: v })}
      />
      {rotatable ? (
        <NumberField
          label="Rotate"
          value={rotate}
          step={1}
          onChange={(v) => onChange({ ...t, rotate: v - baseRotate })}
        />
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Input
        id={id}
        type="number"
        step={step}
        value={Number.isFinite(value) ? round1(value * 1000) / 1000 : 0}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="h-7 text-xs"
      />
    </label>
  );
}

function TextRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs"
      />
    </label>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <input
        type="color"
        value={toHex(value)}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-10 cursor-pointer rounded border border-border bg-transparent"
      />
    </label>
  );
}

function toHex(v: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : "#000000";
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** A plain native select, for the small enum fields in the inspector (lighter than the Radix Select here). */
function Select2({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 flex-1 rounded-md border border-input bg-transparent px-1.5 text-xs"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

/** Which screen the Redo popover shows. */
type RedoMode = "menu" | "pick-art" | "running" | "done";

/**
 * The lightbox toolbar's "Redo" menu for one screenshot scene: recapture its
 * flow on the simulator (/api/redo/:sceneId/capture), or pick and regenerate
 * the AI art it draws (/api/redo/:sceneId/art), streaming the CLI log either
 * way. `onDone` refreshes the studio's manifest once a job finishes, so the
 * new pixels show without a manual reload.
 */
export function RedoMenu({
  sceneId,
  deviceKey,
  onDone,
}: {
  sceneId: string;
  deviceKey: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<RedoMode>("menu");
  const [assets, setAssets] = useState<RedoAsset[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [failed, setFailed] = useState(false);
  const [restored, setRestored] = useState<Set<string>>(new Set());
  // Which action the running/done panel is reporting on: only an art
  // regeneration offers "Restore previous" afterward.
  const [lastAction, setLastAction] = useState<"capture" | "art" | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the log text changes
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  function openChange(next: boolean) {
    if (busy) return; // never close out from under a running job
    setOpen(next);
    if (!next) {
      setMode("menu");
      setLog("");
      setFailed(false);
      setRestored(new Set());
      setLastAction(null);
      return;
    }
    if (assets === null) {
      loadRedoInfo(sceneId).then(
        (info) => {
          setAssets(info.assets);
          setSelected(new Set(info.assets.map((a) => a.id)));
        },
        () => setAssets([]),
      );
    }
  }

  async function recapture() {
    setLastAction("capture");
    setMode("running");
    setBusy(true);
    setFailed(false);
    setLog("");
    try {
      await runRedoCapture(sceneId, deviceKey, (line) => setLog((prev) => `${prev}${line}\n`));
      setMode("done");
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function regenerateArt() {
    setLastAction("art");
    setMode("running");
    setBusy(true);
    setFailed(false);
    setLog("");
    try {
      await runRedoArt(sceneId, [...selected], (line) => setLog((prev) => `${prev}${line}\n`));
      setMode("done");
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function restorePrevious(assetId: string) {
    await restoreArt(assetId);
    setRestored((prev) => new Set(prev).add(assetId));
    onDone();
  }

  const estimate = (assets ?? [])
    .filter((a) => selected.has(a.id))
    .reduce((sum, a) => sum + a.estimatedUsd, 0);

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={busy}>
          <RefreshCwIcon /> Redo
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="dark w-80 text-foreground">
        {mode === "menu" ? (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => void recapture()}
            >
              <span className="font-medium">Recapture screen</span>
              <span className="text-xs text-muted-foreground">
                Re-runs this tile's flow on the simulator and replaces its raw capture. The
                simulator (and Metro, for a dev-client app) must already be running.
              </span>
            </button>
            <button
              type="button"
              disabled={!assets || assets.length === 0}
              className="flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setMode("pick-art")}
            >
              <span className="font-medium">Regenerate art</span>
              <span className="text-xs text-muted-foreground">
                {assets === null
                  ? "Loading this tile's art assets…"
                  : assets.length === 0
                    ? "No AI art on this tile."
                    : `${assets.length} AI art asset${assets.length === 1 ? "" : "s"} on this tile.`}
              </span>
            </button>
          </div>
        ) : mode === "pick-art" ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Regenerates the checked assets with `goldie art --force`, then re-renders this tile.
            </p>
            <div className="flex flex-col gap-1">
              {(assets ?? []).map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(a.id);
                        else next.delete(a.id);
                        return next;
                      })
                    }
                  />
                  <span className="flex-1 truncate">{a.shared ? a.label : a.id}</span>
                  <span className="text-xs text-muted-foreground">
                    ~${a.estimatedUsd.toFixed(2)}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-xs text-muted-foreground">
                Estimated cost: ~${estimate.toFixed(2)}
              </span>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="xs" onClick={() => setMode("menu")}>
                  Back
                </Button>
                <Button
                  type="button"
                  size="xs"
                  disabled={selected.size === 0}
                  onClick={() => void regenerateArt()}
                >
                  Confirm
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {busy ? <Loader2Icon className="size-3 animate-spin" /> : null}
              {busy ? "Working…" : failed ? "Job failed." : "Done. New pixels are in the strip."}
            </p>
            <pre
              ref={logRef}
              className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2 font-mono text-[10px] leading-relaxed text-muted-foreground"
            >
              {log || "Starting…"}
            </pre>
            {!busy && mode === "done" && lastAction === "art" && selected.size > 0 ? (
              <div className="flex flex-col gap-1 border-t border-border pt-2">
                <p className="text-xs text-muted-foreground">Keep the new render, or go back:</p>
                {[...selected].map((assetId) => {
                  const asset = assets?.find((a) => a.id === assetId);
                  return (
                    <div key={assetId} className="flex items-center justify-between text-xs">
                      <span className="truncate">{asset?.shared ? asset.label : assetId}</span>
                      {restored.has(assetId) ? (
                        <span className="text-muted-foreground">Restored previous</span>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => void restorePrevious(assetId)}
                        >
                          Restore previous
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
            {!busy ? (
              <Button type="button" variant="outline" size="xs" onClick={() => setMode("menu")}>
                Close
              </Button>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
