# goldie.config.ts

One file holds everything app-specific. It exports a `GoldieConfig` (type from
`$GOLDIE/src/config.ts`). Every relative path in it resolves against the config
file itself, and `out/` is created next to it. Scene flows are the exception:
they are argent flow names resolved against `flowsDir`, which defaults to
`.argent/flows` inside `appRoot`.

## Annotated example

```ts
import type { GoldieConfig } from "/Users/<you>/Dev/goldie/src/config.ts";

const APP_ROOT = "/absolute/path/to/the/app/repo";

const config: GoldieConfig = {
  appRoot: APP_ROOT,
  // The Release simulator build found in Step 1. Absolute path.
  appPath: `${process.env.HOME}/Library/Developer/Xcode/DerivedData/<App>-<hash>/Build/Products/Release-iphonesimulator/<App>.app`,
  bundleId: "com.example.app",

  // Google Play too: add "pixel-10-pro" and the android block below. Scenes
  // and flows are shared across devices; argent flows replay on Android when
  // their selectors match. The emulator must already be running.
  // android: { appPath: "/path/to/app-release.apk", applicationId: "com.example.app" },

  // "iphone-6.9" (iPhone 17 Pro Max), "ipad-13" (iPad Pro 13-inch), "pixel-10-pro" (Google Play); keys from $GOLDIE/src/specs.ts.
  // Every device replays the same flows and gets its own raw captures, output folder and studio view.
  devices: ["iphone-6.9", "ipad-13"],
  locales: ["en-US"],
  // Capture each locale in its own language (iOS): the flows replay once per locale with the
  // simulator pinned to it, into out/raw/<device>/<locale>/. Off: one capture, in the first locale.
  // localizedCaptures: true,
  appearance: "light",           // simulator appearance for every capture
  // keepAppData: true,          // capture the installed app as it is (a signed-in session,
  //                             // a dev client on Metro) instead of reinstalling it; iOS only

  // Bundled bezels: "17-pro-silver" | "17-pro-blue" | "17-pro-orange" for the iPhone,
  // "ipad-pro-13-silver" | "ipad-pro-13-space-gray" for the iPad. Pick the finish
  // that contrasts with the background. One variant applies to its own device and
  // the others keep their first variant; or give one per device key. The android
  // device is framed with the bundled Pixel 10 Pro bezel instead.
  frame: { variant: { "iphone-6.9": "17-pro-blue", "ipad-13": "ipad-pro-13-space-gray" } },

  theme: {
    // Any CSS background. Soft brand-tinted gradients read best at store size.
    // "transparent" exports PNGs with alpha (for compositing; not uploadable as-is).
    background: "linear-gradient(160deg, #E8F1FF 0%, #F7FAFF 55%, #FFFFFF 100%)",
    headlineColor: "#0E1B2A",    // must contrast with the background;
    subheadColor: "#5A6A7D",     // light text on a dark background and vice versa
    // The system stack, or a bundled typeface named first: "Merriweather",
    // "DM Mono", "Lato", "DM Sans", "Montserrat" (files in $GOLDIE/assets/fonts).
    fontFamily: '-apple-system, "SF Pro Display", system-ui, sans-serif',
    copyHeightRatio: 0.24,       // fraction of frame height reserved for copy (classic layout)
    deviceWidthRatio: 0.84,      // fraction of frame width the bezel occupies (classic layout)
    template: "editorial",       // the strip's rhythm, see "Templates and layouts" below
    layout: "classic",           // layout for scenes the template leaves out
    // screenOnly: true,         // bare screens with a soft shadow instead of a bezel
    // decorations: [...],       // layers on every tile, see "Decorations" below
  },

  // Renders the realistic store page around the assets in the studio.
  store: {
    name: "AppName",
    subtitle: { "en-US": "Under 30 characters, Apple's limit" },
    developer: "Company Name",
    category: "Productivity",
    rating: 4.8,                 // cosmetic, studio only
    ratingCount: "1.2K Ratings",
    ageRating: "4+",
    price: "Free",
    description: { "en-US": "Two or three short paragraphs, store voice." },
  },

  // flowsDir: "../.argent/flows" by default, resolved from appRoot. Every
  // scene names a flow there, the way `argent flow run <name>` does.

  scenes: [
    // One entry per screenshot, in store-page order. The first two tiles are
    // what most visitors ever see, so lead with the strongest screens.
    {
      kind: "screenshot",
      id: "issues",
      flow: "store-01-issues",
      headline: { "en-US": "Every issue, one list" },
      subhead: { "en-US": "Grouped by status, sorted the way your team works." },
      // background: "..."     optional per-scene override
      // layout: "hero",        optional per-scene layout
      // align: "left",         copy alignment: left | center | right (overrides the layout's)
      // secondScene: "detail", the second screen for duo / panorama-duo
      // decorations: [...],    layers on this tile only
    },
    // ... 3 or 4 more screenshot scenes ...

    // Exactly one preview scene. Each segment is its own flow and clip; the
    // clips are joined as recorded (Apple allows no bezel or captions).
    {
      kind: "preview",
      id: "preview",
      segments: [
        { id: "open",    flow: "store-preview-01-open" },
        { id: "compose", flow: "store-preview-02-compose" },
        { id: "create",  flow: "store-preview-03-create", holdSeconds: 2 },
      ],
    },
  ],
};

export default config;
```

Import the type with an absolute path to the goldie checkout, since the config
lives in the app repo.

## Templates and layouts

`theme.template` sets the layout of each screenshot in store order, so a
strip can mix a panorama, a hero, a tilted device and a breather. Use a
built-in key or a custom array of layout keys; a sequence shorter than the
scene list repeats. Built-ins:

| Template | Sequence |
|---|---|
| `editorial` | panorama, hero, offset, minimal, tilt |
| `showcase` | hero, tilt, duo, tilt-right, minimal |
| `magazine` | offset, copy-below, tilt-right, hero, minimal |
| `storyboard` | panorama-duo, copy-below, hero, minimal, tilt |
| `dynamic` | tilt, duo-tilt, panorama, minimal, tilt-right |

Precedence per scene: `scenes[].layout`, then the template's entry, then
`theme.layout`, then `classic`. Default to `editorial` for a 4 to 5 scene
strip, or write a sequence when the user describes the rhythm they want
("start with a panorama, then tilt the rest"). Layout keys, from
`$GOLDIE/src/layouts.ts`:

| Key | Composition | Needs |
|---|---|---|
| `classic` | centred copy above a centred device (default) | |
| `copy-below` | device hanging from the top, copy underneath | |
| `hero` | copy on top, large device running off the bottom | |
| `offset` | left-aligned copy, device pushed bottom right | |
| `tilt` | copy on top, device tilted off the bottom | |
| `tilt-right` | left-aligned copy, device tilted into the bottom right | |
| `duo` | two screens, the second smaller and behind | a second capture |
| `duo-tilt` | two tilted screens stepping diagonally | a second capture |
| `panorama` | two tiles, copy left, one big tilted device across the seam | takes 2 of the 10 slots |
| `panorama-duo` | two tiles sharing a headline, a screen each side | a second capture, 2 slots |
| `minimal` | no copy, a large centred device | |
| `poster` | copy on top, no device: the art carries the tile | art layers or a backgroundImage |

`poster` suits the opener, a story turn or a founder tile, built from a
`backgroundImage` or image layers. Two-screen layouts borrow the next scene's capture unless the scene sets
`secondScene`. Choosing: lead with `classic`, `hero` or a `panorama` pair,
since the first two tiles are what most visitors see. Use `duo` with
`secondScene` for a list-and-detail pair. Keep tilted tiles to one in a row, and `minimal` for a
breather mid-strip. Panorama copy must read on the left tile alone.
`theme.screenOnly: true` removes the bezel in every layout.

## Emotional type and art

Theme fields for the storytelling layer (see `storytelling.md` for when to use
which):

```ts
theme: {
  accentColor: "#E44B2A",            // stressed words, marks, kickers
  emphasis: "circle",                // color | highlight | underline | circle | script
  scriptFontFamily: '"Caveat", cursive',   // kickers and script emphasis (the default)
  headline: {
    scale: 1.2,                      // multiplies the layout's headline size
    weight: 800,
    uppercase: true,
    stroke: { color: "#000000", width: 0.006 },                 // fractions of the tile width
    shadow: { color: "rgba(0,0,0,0.35)", blur: 0.02, offsetY: 0.006 },
  },
  backgroundImage: "art/meadow.png", // cover-fitted under every tile
  backdrop: "art/meadow-strip.png",  // one wide image sliced across the whole strip
  scrim: { color: "rgba(0,0,0,0.8)", height: 0.4 },  // keeps copy legible over bright art
}
```

Per scene: `kicker` (a handwritten line above the headline, per locale),
`backgroundImage` (overrides the theme's; `"none"` clears it), and stressed
words in the headline itself: `"Clear your *head*"` (`\*` for a literal
asterisk). Bundled display faces for headlines: `bricolage` (Bricolage
Grotesque), `anton` (condensed, heavy; pair with `uppercase`),
`instrument-serif` (editorial serif); `caveat` is the handwritten face.

## Decorations

Layers on a tile. `theme.decorations` applies to every tile,
`scenes[].decorations` to one; both stack. `layer: "back"` (the default, and
callouts' exception) draws between the copy and the device; `layer: "front"`
draws over the device, which is how art breaks the frame. Positioned layers
take `x`/`y` (left and top) and `width` as fractions of one tile; a
panorama's second tile starts at `x: 1`.

```ts
{ kind: "badge", text: { "en-US": "Editors' Choice" }, position: "top-right",
  background: "#0E1B2A", color: "#FFFFFF" }          // colors optional
{ kind: "image", src: "art/fox.png",                  // relative to the config
  x: 0.55, y: 0.6, width: 0.45, rotate: 6,            // fractions of the tile
  layer: "front", flip: true, shadow: true, opacity: 1 }
// A piece of the real screen, enlarged over the phone's edge. `from` is the
// region as fractions of the capture; the card keeps its aspect.
{ kind: "callout", from: { x: 0.03, y: 0.40, width: 0.94, height: 0.13 },
  x: 0.02, y: 0.60, width: 0.96, rotate: -3,
  capture: "primary",                                 // or "secondary" in duo layouts
  radius: 0.03, shadow: true, border: "#FFFFFF" }     // optional, defaults shown
{ kind: "bubble", text: { "en-US": "I can't find anything!" },
  x: 0.08, y: 0.22, width: 0.6,                       // width is the maximum; it shrinks to the text
  tail: "bottom-left",                                // bottom-right | top-left | top-right | none
  font: "script", size: 0.05, rotate: -4,
  background: "#FFFFFF", color: "#111111", layer: "front" }
{ kind: "rating", value: "4.9", label: { "en-US": "200k+ happy users" },
  x: 0.25, y: 0.82, width: 0.5, color: "#111111",
  laurels: true, background: "#FFFFFF" }              // the plate keeps it legible over art
```

## Editing in the studio

The lightbox's element editor (click a decoration, the copy block or a device
to select it, then drag, resize from a corner, rotate from the handle above
it, nudge with the arrow keys, or use the inspector) never touches the
config. It writes `goldie.design.json`, next to `sceneLayouts` and the rest of
the Design panel's choices:

- `sceneDecorations[sceneId]`: that scene's full decoration list, once the
  editor has touched it - it replaces `scenes[].decorations` for that scene
  the same way `sceneLayouts` replaces `theme.layout` (theme-level decorations
  still apply on top, and are not editable here). Image `src` stays
  config-relative, exactly as the config writes it.
- `sceneTransforms[sceneId]`: `{ copy?, devices? }`, each an
  `{ dx?, dy?, scale?, rotate? }` nudge (`dx`/`dy` as fractions of the tile)
  applied after `compose()`, via `applyTransform` in `src/layouts.ts` - the
  CLI calls the same function, so a dragged phone exports where it was
  dropped.

As with the rest of the Design panel: if the user wants an edit permanent,
copy it into the config (`sceneDecorations[id]` into that scene's own
`decorations`, `sceneTransforms[id]` folded into the layout's numbers or left
as a one-off override) rather than leaving it only in `goldie.design.json`.

## Art and video

The `art` block (generated art layers) is documented in `art.md`, the `promo`
block and preview `caption`s in `promo.md`.

## Writing the copy

`storytelling.md` holds the full playbook; in short:

- **Headlines**: 2 to 5 words, an outcome or a feeling, with one stressed
  word. Name what the user gets ("Find anything, fast"), never what the UI is
  ("Search screen").
- **Subheads**: one short sentence expanding the headline. Optional; drop it
  when the headline stands alone.
- **Badges**: two or three words at most ("Editors' Choice", "New in 2.0").
- Match the app's existing voice (website, onboarding text) when the repo
  shows one.

## Output

| Asset | Spec | Location |
|---|---|---|
| 6.9" screenshots | 1320x2868 PNG, no alpha | `out/screenshots/iphone-6.9/<locale>/` |
| 6.9" preview | 886x1920 H.264 30fps AAC, 15 to 30 s | `out/previews/iphone-6.9/<locale>/` |
| 13" screenshots | 2064x2752 PNG, no alpha | `out/screenshots/ipad-13/<locale>/` |
| 13" preview | 1200x1600 H.264 30fps AAC, 15 to 30 s | `out/previews/ipad-13/<locale>/` |
| Play phone screenshots | 1080x1920 PNG, no alpha | `out/screenshots/pixel-10-pro/<locale>/` |

`goldie verify` checks the finished files against these with `sips` and
`ffprobe` and fails on any mismatch.
