import type { EmphasisStyle } from "../config.ts";
import type { FontKey } from "../fonts.ts";

/**
 * A preset art direction for `goldie art`: a rich, specific prompt fragment
 * (medium, lighting, rendering, line quality, composition rules) plus the
 * copy and layout choices that read well next to it. Modeled on the
 * @screenshotfirst-style store pages: Ellie's hand-drawn hamster, Victor's
 * bold comic portraits, Catchr's holographic photo-real scan, Flooz's puffy
 * 3D balloons, Lovi's flat warm illustration, Hezel's 3D album-art fan,
 * Peggy's notebook doodles, Golazo's halftone comic.
 */
export type ArtStyle = {
  label: string;
  description: string;
  /** App genres or audiences this style tends to suit. */
  bestFor: string[];
  /** Prompt fragment: medium, lighting, rendering, line quality, composition. */
  prompt: string;
  /** What to steer the model away from. */
  avoid: string;
  /** How to ask for an isolated subject that background removal can cut out cleanly. */
  transparentHint: string;
  /** Bundled goldie font keys (src/fonts.ts) that pair well with this style. */
  fonts: FontKey[];
  /** How a headline's stressed words should stand out next to this art. */
  emphasis: EmphasisStyle;
  /** A one-line note on using the config's palette with this style. */
  paletteTip: string;
};

export const ART_STYLES = {
  "3d-inflated": {
    label: "3D inflated",
    description:
      "Puffy, glossy, balloon-like 3D renders - letters, coins and objects look soft and " +
      "over-inflated, lit like a toy photographed in a studio.",
    bestFor: ["fintech", "crypto", "games", "playful consumer apps"],
    prompt:
      "3D render, puffy inflated balloon-like forms with rounded, over-stuffed silhouettes, " +
      "glossy soft-plastic material with bright specular highlights, smooth subsurface " +
      "scattering, octane/cinema4d studio lighting, soft shadows, shallow depth of field, " +
      "toy-like scale, isolated subject, generous empty margin around it, centered composition",
    avoid: "no text, no UI, no phone or device mockups, no logos, no harsh realism, no grit",
    transparentHint:
      "the subject floating on a plain flat white or single-color background with soft " +
      "contact shadow, nothing else in frame, so it can be cut out cleanly",
    fonts: ["bricolage", "anton"],
    emphasis: "highlight" as EmphasisStyle,
    paletteTip: "use the brightest palette color as the glossy highlight, not the fill",
  },
  "clay-3d": {
    label: "Claymation 3D",
    description:
      "Cute stop-motion clay 3D characters and mascots, matte sculpted surfaces with visible " +
      "thumb-pressed texture, warm soft studio light.",
    bestFor: ["kids apps", "planners", "wellness", "mascot-led brands"],
    prompt:
      "claymation 3D render, matte sculpted clay surface with soft fingerprint and tool " +
      "texture, rounded chubby proportions, warm three-point studio lighting, soft ambient " +
      "occlusion, pastel or saturated clay colors, isolated character, full body in frame, " +
      "centered, generous empty margin",
    avoid: "no text, no UI, no phone or device mockups, no photorealism, no sharp hard edges",
    transparentHint:
      "the character standing on a plain flat background with a soft ground shadow, nothing " +
      "else in frame, so it can be cut out cleanly",
    fonts: ["bricolage", "dm-sans"],
    emphasis: "circle" as EmphasisStyle,
    paletteTip: "give the clay itself one palette color and keep the backdrop neutral",
  },
  "hand-drawn": {
    label: "Hand-drawn ink",
    description:
      "Loose, confident ink doodles with a single flat fill color - sketchbook energy, not " +
      "polished illustration.",
    bestFor: ["planners", "journals", "indie tools", "creative apps"],
    prompt:
      "hand-drawn ink doodle, loose confident pen linework with varying line weight, single " +
      "flat fill color, visible sketchbook texture, playful imperfect proportions, isolated " +
      "subject, centered, generous empty margin, white or paper-colored background",
    avoid: "no text, no UI, no phone or device mockups, no photorealism, no gradients",
    transparentHint:
      "the doodle on a plain white background with no shadow, just ink lines and one flat " +
      "fill color, so it can be cut out cleanly",
    fonts: ["instrument-serif", "caveat"],
    emphasis: "circle" as EmphasisStyle,
    paletteTip: "use one palette color as the single ink fill, keep everything else monochrome",
  },
  "comic-ink": {
    label: "Comic ink",
    description:
      "Bold comic-book illustration: thick black outlines, flat cel-shaded color, halftone " +
      "dots, graphic-novel energy.",
    bestFor: ["sports apps", "language learning", "social apps", "youth brands"],
    prompt:
      "bold comic book illustration, thick confident black outlines, flat cel-shaded color " +
      "fills, halftone dot shading in the shadows, dynamic heroic pose, graphic novel " +
      "rendering, isolated subject, centered, generous empty margin",
    avoid: "no text, no speech bubbles, no UI, no phone or device mockups, no photorealism",
    transparentHint:
      "the subject on a plain flat background with no halftone outside its outline, so it " +
      "can be cut out cleanly along the thick black line",
    fonts: ["anton", "bricolage"],
    emphasis: "underline" as EmphasisStyle,
    paletteTip: "reserve the boldest palette color for the outline or a single accent block",
  },
  "flat-illustration": {
    label: "Flat illustration",
    description:
      "Warm, flat vector-style illustration with simple shapes, soft rounded forms and gentle " +
      "color blocking - the modern app-onboarding look.",
    bestFor: ["lifestyle", "health", "productivity", "finance for consumers"],
    prompt:
      "flat vector illustration, simple rounded shapes, soft gentle color blocking, minimal " +
      "shading with one soft gradient at most, friendly approachable character or object, " +
      "clean geometric composition, isolated subject, centered, generous empty margin",
    avoid: "no text, no UI, no phone or device mockups, no photorealism, no busy detail",
    transparentHint:
      "the subject on a plain flat background with no drop shadow, simple closed shapes, so " +
      "it can be cut out cleanly",
    fonts: ["dm-sans", "montserrat"],
    emphasis: "color" as EmphasisStyle,
    paletteTip: "the palette IS the illustration - block each shape in its own palette color",
  },
  "photo-real": {
    label: "Photo-real",
    description:
      "Genuine photography look - natural light, real materials, documentary or lifestyle " +
      "framing, optionally with a holographic scan/AI overlay.",
    bestFor: ["identification apps", "travel", "fitness", "social proof-heavy apps"],
    prompt:
      "photorealistic photograph, natural daylight or golden hour lighting, real material " +
      "texture and depth of field, documentary or lifestyle framing, candid genuine moment, " +
      "high production value, isolated subject or scene, generous empty margin at the top",
    avoid: "no text, no UI, no phone or device mockups, no illustration style, no cartoon look",
    transparentHint:
      "a clean studio photograph of the subject against a plain seamless background with a " +
      "soft contact shadow, so it can be cut out cleanly",
    fonts: ["merriweather", "dm-sans"],
    emphasis: "highlight" as EmphasisStyle,
    paletteTip: "use the palette only in a thin UI-style overlay graphic, never the photo itself",
  },
  "editorial-collage": {
    label: "Editorial collage",
    description:
      "Magazine-style paper collage - cut-paper shapes, torn edges, tape and pin accents, " +
      "confident editorial type energy even without drawing any words.",
    bestFor: ["news", "culture", "music", "creative tools"],
    prompt:
      "editorial paper collage illustration, layered cut-paper shapes with soft torn edges, " +
      "visible paper grain and subtle drop shadows between layers, tape or pin accents, " +
      "confident asymmetric composition, isolated collage subject, generous empty margin",
    avoid: "no text, no UI, no phone or device mockups, no photorealism, no 3D rendering",
    transparentHint:
      "the collage subject on a plain flat background with the paper-layer shadows kept " +
      "inside its silhouette, so it can be cut out cleanly",
    fonts: ["instrument-serif", "anton"],
    emphasis: "highlight" as EmphasisStyle,
    paletteTip: "give each paper layer a different palette color instead of shading them",
  },
  "notebook-doodle": {
    label: "Notebook doodle",
    description:
      "Lined or dot-grid notebook paper with pen and crayon doodles, paper planes and taped-on " +
      "cutouts - a kept-journal, personal-planner feeling.",
    bestFor: ["family organizers", "journals", "students", "planners"],
    prompt:
      "notebook paper background texture with faint lined or dot-grid pattern, hand-drawn pen " +
      "or crayon doodle subject, slightly imperfect childlike line quality, a few scattered " +
      "small doodles (stars, arrows, hearts) around the edges, isolated main subject, " +
      "generous empty margin",
    avoid: "no text, no UI, no phone or device mockups, no polished vector look, no 3D rendering",
    transparentHint:
      "the doodle subject on plain notebook paper with no ruled lines directly behind it, so " +
      "it can be cut out cleanly from the paper texture",
    fonts: ["caveat", "instrument-serif"],
    emphasis: "script" as EmphasisStyle,
    paletteTip: "keep the paper neutral and spend the palette on the pen/crayon ink itself",
  },
} as const satisfies Record<string, ArtStyle>;

export type ArtStyleKey = keyof typeof ART_STYLES;
export const ART_STYLE_KEYS = Object.keys(ART_STYLES) as ArtStyleKey[];

export function isArtStyleKey(key: string): key is ArtStyleKey {
  return key in ART_STYLES;
}

/**
 * The prompt fragment for a style: a preset key from the catalog above, or
 * free text written directly into the config's `art.style` / `--style` flag.
 */
export function stylePrompt(style: string): string {
  const preset = (ART_STYLES as Record<string, ArtStyle>)[style];
  return preset ? preset.prompt : style;
}
