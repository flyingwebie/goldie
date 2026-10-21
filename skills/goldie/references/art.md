# AI art layers: `goldie art` and `goldie concepts`

goldie can generate the art that surrounds the real screen: backgrounds,
scenes, mascots and characters, 3D objects, stickers. The app's UI always
comes from the capture, pixel-true; the model draws only what sits around it.
Art lives as files next to the config and is placed with the same fields as
any image (`theme.backgroundImage`, `theme.backdrop`, `scene.backgroundImage`,
image decorations).

## Keys

`OPENAI_API_KEY` for `provider: "openai"`, `FAL_KEY` for `provider: "fal"`
(fal also powers background removal, animated clips and music, so a fal key
is worth having either way). goldie reads them from the environment, then
`goldie/.env` next to the config, then the app root's `.env.local` / `.env`.

Set the user up in three moves, never asking them to paste a key into chat:

1. Write `goldie/.env.example` with both variable names, empty, and a comment
   saying where each key comes from (OpenAI: platform.openai.com/api-keys,
   "Create new secret key"; fal: fal.ai/dashboard/keys, "Add key").
2. Add `goldie/.env` (and `goldie/out/`) to the app's `.gitignore`.
3. Tell the user: copy `goldie/.env.example` to `goldie/.env`, paste the
   keys after the `=` signs, save, then say when done. Check with
   `goldie doctor`, which reports each key as found or missing without
   showing it.

Run everything up to the paid call with `--dry-run` meanwhile; it needs no key.

## The workflow

1. **Brief.** Write the brief (storytelling.md, section 1). The *who* and the
   *feeling* choose the art direction.
2. **Brand references.** Look for existing brand art in the repo: a mascot
   kit, an illustration set, the app icon, onboarding images (often under
   `assets/`, `design/`, `branding/`). List them in `art.references`; every
   generation sees them, so a generated scene keeps the real mascot and
   palette. Brand art that is already transparent (a mascot pose) can be used
   directly as an image decoration with no generation at all.
3. **Propose 2-3 directions.** Pick presets that fit the brief (table below),
   write the `art` block with 2-4 assets, then render cheap draft boards:

   ```bash
   GOLDIE_CONFIG=... npx -y goldie@0 concepts --styles hand-drawn,3d-inflated,flat-illustration
   ```

   Each board shows the first three tiles with that style's draft art, face and
   emphasis (`goldie/out/concepts/<style>/board.png`, also in the studio's
   Concepts view). Show the boards to the user and ask them to pick one. Drafts
   cost a few cents each; this is the moment for the user's taste, so wait for
   their answer before generating final art.
4. **Generate final art** in the chosen style: set `art.style`, then

   ```bash
   GOLDIE_CONFIG=... npx -y goldie@0 art --dry-run   # the plan, prompts and estimated cost
   GOLDIE_CONFIG=... npx -y goldie@0 art             # generates what is missing or changed
   ```

   Generated files and `art/art.lock.json` are cached by content hash: a
   re-run spends nothing unless a prompt, style, model or reference changed.
   `--only <id>` regenerates one asset, `--force` ignores the cache. A run
   above `art.budgetUsd` (default $5) stops and prints the estimate; re-run
   with `--yes` once the user agrees to the spend.
5. **Place, render, look.** Wire the files into the tiles, run `goldie frame`,
   open the result, and adjust `x`/`y`/`width`/`rotate`/`layer` until the art
   frames the headline and the UI without hiding either. Look at every tile;
   regenerate an asset whose drawing has defects (extra limbs, stray text,
   off-model mascot) with a sharper prompt.
6. **Commit the art.** `goldie/art/` holds the files and the lock; commit them
   with the config, so a later render needs no API at all.

## Config

```ts
art: {
  provider: "fal",                       // or "openai"
  style: "hand-drawn",                   // a preset key below, or free text
  palette: ["#5F7A37", "#E44B2A", "#F3EBDD"],
  references: ["../design/mascot/fox-front.png"],
  // model: "fal-ai/nano-banana-pro",    // override the provider default
  // budgetUsd: 5,
  assets: [
    { id: "meadow", kind: "background",
      prompt: "a quiet Italian countryside meadow at golden hour, a river, soft hills" },
    { id: "meadow-strip", kind: "background", aspect: "strip",
      prompt: "one continuous meadow landscape, low horizon, wildflowers along the bottom" },
    { id: "hedgehog", kind: "character",
      prompt: "a small injured hedgehog with a tiny bandage, looking hopeful" },
    { id: "fox-rescuer", kind: "character",
      prompt: "the fox mascot from the reference, kneeling, gently holding a small bird",
      animate: { prompt: "the bird flaps its wings and flies away from the fox's paws" } },
  ],
},
```

| Kind | Output | Place it as |
|---|---|---|
| `background`, `scene` | opaque, portrait (or `aspect: "strip"` for a backdrop), with a calm top band for the headline | `theme.backgroundImage`, `scene.backgroundImage`, `theme.backdrop` |
| `character`, `object`, `sticker` | transparent PNG, trimmed to the subject | image decoration, usually `layer: "front"` to break the frame |

`animate` turns the still into a 5-10 s clip (`art/<id>.mp4`) for the promo
video's intro (promo.md).

## Writing asset prompts

Describe the subject, its pose or action, and its emotion; the style, palette,
kind rules (full-bleed or isolated cutout) and the never-draw rules (no
devices, UI, logos or text) are added for you. Good prompts name a moment:
"kneeling, gently holding a small bird", "tossing coins into the air",
"holding up a freshly caught bass, proud grin". Characters that act out the
headline's feeling outperform characters that stand there.

## Style presets (`art.style`)

| Key | Look | Best for |
|---|---|---|
| `hand-drawn` | ink line doodles with one flat brand fill, sketchbook warmth | planners, journaling, productivity, family |
| `notebook-doodle` | pen doodles on lined paper, paper planes, arrows, stars | school, family organisers, notes |
| `clay-3d` | cute claymation mascots and props, soft studio light | mascot-led brands, kids, wellness, planners |
| `3d-inflated` | puffy glossy balloon letters and objects, bright sky | crypto, fintech, games, Gen-Z consumer |
| `comic-ink` | thick outlines, halftone, bold flat color, action lines | sports, games, social, language learning |
| `flat-illustration` | flat warm vector people and objects, saturated palette | lifestyle, beauty, health, home |
| `photo-real` | photographic hero subjects and scenes | outdoors, food, travel, beauty, fitness |
| `editorial-collage` | cut-paper collage, mixed photo and paint, magazine feel | culture, news, premium, creative tools |

Each preset suggests a headline face and emphasis style; concept boards
apply them, and you copy the chosen ones into `theme.fontFamily` and
`theme.emphasis`. A free-text style ("risograph print, two inks, grainy") works
too.

## Costs (approximate, per call)

| | draft | final |
|---|---|---|
| OpenAI `gpt-image-1.5` | $0.02 | $0.20 |
| fal `seedream v4` / `nano-banana-pro` | $0.03 | $0.15 |
| transparent cutout (fal birefnet) | +$0.01 | +$0.01 |
| animated clip (fal Kling, 5 s / 10 s) | | $0.35 / $0.70 |
| music bed (fal CassetteAI) | | ~$0.02 per minute |

A typical set (3 concept boards of 3 assets, then 4 final assets and one
clip) costs about $1.50-2.50.
