import type { ArtAsset, ArtConfig } from "../config.ts";
import { ART_STYLES, isArtStyleKey, stylePrompt } from "./styles.ts";

/** `character`, `object` and `sticker` assets come back as cutout-ready transparent PNGs. */
export function isTransparentKind(kind: ArtAsset["kind"]): boolean {
  return kind === "character" || kind === "object" || kind === "sticker";
}

/** `background` and `scene` fill a tile; the rest overlap the device. */
export function defaultAspect(kind: ArtAsset["kind"]): "portrait" | "square" {
  return isTransparentKind(kind) ? "square" : "portrait";
}

/** What the model must never draw, since goldie composites the real app capture around the art. */
const NEVER_DRAW =
  "never draw a phone, tablet, laptop or any device frame; never draw app UI, screens, " +
  "buttons or icons; never draw a logo or brand mark you were not given as a reference " +
  "image; never render any text, letters, numbers or words anywhere in the image";

function kindRules(kind: ArtAsset["kind"]): string {
  switch (kind) {
    case "background":
    case "scene":
      return (
        "full-bleed edge-to-edge composition filling the entire frame, leave the top " +
        "30% of the frame calm, uncluttered and visually quiet so a headline can sit " +
        "over it later, no text, no UI, no phone or device of any kind"
      );
    case "character":
      return (
        "a single isolated character, full body in frame, centered, plain flat " +
        "background behind it for an easy cutout, no text, no UI, no phone or device " +
        "of any kind"
      );
    case "object":
    case "sticker":
      return (
        "a single isolated object, centered, plain flat background behind it for an " +
        "easy cutout, no text, no UI, no phone or device of any kind"
      );
  }
}

/**
 * Style presets describe a medium and also how a lone subject sits in frame.
 * A background fills the frame instead, so the lone-subject clauses ("isolated
 * subject, centered, generous empty margin") would fight the kind rules; they
 * are dropped from opaque kinds and kept for cutouts.
 */
const SUBJECT_CLAUSE =
  /isolated|centered|empty margin|full body|white or paper-colored background/i;

export function styleForKind(fragment: string, transparent: boolean): string {
  if (transparent) return fragment;
  return fragment
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c && !SUBJECT_CLAUSE.test(c))
    .join(", ");
}

export type PromptContext = {
  /** The app's name on the store listing, e.g. "Ellie". */
  storeName?: string;
  /** The app's store category, e.g. "Productivity". */
  storeCategory?: string;
};

/**
 * The full prompt sent to an image provider: the asset's own description,
 * rules for its kind (background vs. isolated subject), the style fragment
 * (plus its avoid/transparency hints when the style is a preset key), the
 * brand palette, and a line of app context - never asking the model to draw
 * the device, its UI, a logo it was not given, or any text.
 */
export function buildPrompt(asset: ArtAsset, art: ArtConfig, ctx: PromptContext = {}): string {
  const preset = isArtStyleKey(art.style) ? ART_STYLES[art.style] : undefined;
  const transparent = isTransparentKind(asset.kind);

  const parts = [
    asset.prompt.trim(),
    kindRules(asset.kind),
    styleForKind(stylePrompt(art.style), transparent),
    preset?.avoid,
    transparent ? preset?.transparentHint : undefined,
    art.palette?.length ? `color palette: ${art.palette.join(", ")}` : undefined,
    ctx.storeName || ctx.storeCategory
      ? `art for the ${ctx.storeCategory ? `${ctx.storeCategory} ` : ""}app${
          ctx.storeName ? ` "${ctx.storeName}"` : ""
        }`
      : undefined,
    NEVER_DRAW,
  ];

  return parts.filter((p): p is string => Boolean(p && p.length > 0)).join(". ");
}
