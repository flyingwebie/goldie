# Emotional screenshots: the storytelling playbook

Feature lists don't convert. Feelings do. A store visitor gives the first two
tiles about a second each, at thumbnail size, before scrolling on. In that
second they must feel *this app is for me, and my life gets better with it*.
Every choice below serves that one feeling; a choice that only describes the
UI is wasted space.

This playbook distils store pages that convert (the @screenshotfirst school:
Ellie, Victor AI, Catchr, Flooz, Lovi, Hezel, Peggy, Golazo and others) into
rules you apply with goldie's config.

## 1. Write the brief first

Before any copy, fill these five lines from the repo, the website and the app
itself. Put them in a comment at the top of `goldie.config.ts`, so every later
prompt starts from them:

```ts
// BRIEF
// Who:      volunteers at wildlife rescue centres, on their feet, phone in one hand
// Pain:     an injured animal, a caller waiting, paperwork that loses details
// Promise:  every rescue tracked from the roadside call to the release
// Feeling:  calm competence; pride in saving animals
// Proof:    40+ centres, 4.9 rating, works offline in the field
```

The **pain** and the **feeling** drive the copy; the **who** drives the art
direction; the **proof** becomes the social-proof layer.

## 2. Shape the strip as a story

A strip is read left to right like a comic. Pick one arc and give every tile
one beat of it:

| Arc | Beats | Fits |
|---|---|---|
| Promise first | hook (the feeling) -> how (2-3 features as outcomes) -> proof -> identity | most apps |
| Problem -> fix | the pain in the user's words -> the moment it's fixed -> life after | utilities, organisers, backup, finance |
| Transformation | before -> the guide (app or mascot) -> after ("Meet the new you") | learning, fitness, wellness |
| Founder story | the maker and why -> what it does -> who it's for | indie apps, family and community apps |

The **first tile is the hook**, never a feature. Lead with the promise or the
pain, a big headline, and one hero visual: a character, a photo, a 3D object,
or the device bleeding off the edge. Hezel opens on "YOUR MUSIC IS SAFE", Ellie
on "Clear your head", Catchr on "Most accurate Fish ID app" next to a fisherman
holding his catch. The **second tile** proves the promise with the single most
loved feature. Proof (ratings, user counts, press) goes in tile 1 or the
closing tile.

## 3. Headlines

- **2 to 5 words, an outcome or a feeling, in the user's language.** "Find any
  item in seconds", not "Search screen". "Never lose a rescue", not "Case
  management". Verbs and second person pull ("Clear your head", "Shock locals
  with fluency").
- **Stress one word** with asterisks: `"Clear your *head*"`. The stressed word
  is the emotional payload; theme.emphasis decides how it stands out (see
  section 5). One stressed word or short phrase per headline.
- **A kicker** (scene.kicker) adds a handwritten aside above the headline:
  "Accept and", "24/7", "with", "almost there!". It reads as a human voice and
  makes the big line land harder. Use it on two or three tiles, not all.
- **Subheads are optional.** Drop them on emotional tiles; keep them only when
  a fact earns the space ("Over 500 species, even offline").
- Read the strip aloud as one sentence per tile; the sequence should tell the
  arc without the screens.

## 4. Break the frame

A device sitting politely in the middle of every tile reads as a manual. Make
at least half the tiles do one of these:

- **Lift the feature out of the screen** with a `callout`: cut the one card,
  row or chip that proves the headline from the real capture, enlarge it
  over the phone's edge, tilt it 2-4 degrees. Ellie's task card mid-drag,
  Hezel's songs with green checks, the inventory app's "Small box" chip. It is
  the strongest move in the playbook and costs no AI.
- **Let a character or object overlap the device** with a `front`-layer image:
  a mascot leaning on the phone, coins tumbling past it, fish swimming around
  it, a crowd cheering below it.
- **Speak in bubbles** (`bubble`): the user's pain in their own words ("I
  can't find anything!"), the mascot cheering ("Perfect! Let's schedule
  it!"), or a chat line the app answers.
- **Bleed the device** off the bottom or side (`hero`, `tilt`, `offset`
  layouts, `screenOnly: true` for a bare, modern screen).
- **Run one world across tiles**: a `backdrop` image sliced across the whole
  strip (one meadow, one pitch, one notebook page), or a `panorama` layout
  whose device straddles two tiles. Scrolling then feels like walking through
  a place.
- **Give the story a breather**: a `poster` tile (no device; the art and a
  headline carry it) as the opener, the turning point, or the founder tile.

## 5. One visual system

Pick one art direction for the whole strip and hold it: one palette, one
illustration style, one type pairing, one emphasis style. A strip that changes
style per tile reads as five different apps.

| Direction | Feels | Type | Emphasis | Seen in |
|---|---|---|---|---|
| Hand-drawn ink + one brand fill | calm, personal, thoughtful | `instrument-serif` headline, `caveat` kicker | `circle` | Ellie, Peggy |
| Bold comic / halftone, thick outlines | loud, fun, competitive | `anton` uppercase with `headline.stroke` | `underline` or `color` | Golazo, Victor AI |
| 3D inflated / glossy toys, bright sky | playful, Gen-Z, optimistic | `bricolage`, big scale, white with `headline.shadow` | `highlight` | Flooz |
| Photo-real hero + illustrated accents | credible, outdoors, premium | `bricolage` or system bold | `color` | Catchr, Lovi |
| Flat warm illustration, saturated palette | friendly, relatable, inclusive | `dm-sans` / `montserrat` | `color` | Lovi, inventory app |
| Bold flat color, heavy uppercase | urgent, confident, simple | `anton` or `bricolage` uppercase | `color` | Hezel |

Colors: one dominant brand color for backgrounds, one accent (`accentColor`)
for stressed words, marks and kickers, and neutral headline text with strong
contrast. Two-tone headlines (one word in the accent) are the cheapest premium
look there is.

## 6. Proof and trust

- A `rating` layer (laurels, stars, the score, "200k+ fishermen") on tile 1 or
  the last tile. Give it a `background` plate when it sits over busy art or UI.
- A `badge` for an award or a "Designed for Apple Music"-style endorsement.
- A founder or community tile (`poster` layout, a photo or drawing, a
  one-line quote) when the maker is part of the story.
- Integration logos (calendars, Apple Health) as image layers when they answer
  "does it work with what I use?".

Use only true claims: ratings, counts and awards the app actually has.

## 7. Check the strip before showing it

Open the studio and view the strip at gallery size, then answer each:

- **Squint test**: blur your eyes. Does tile 1 still read as a feeling, with
  one headline and one hero?
- **Arc test**: read only the headlines left to right. Is it one story?
- **Frame test**: do at least half the tiles break the frame (callout,
  overlapping art, bleed, bubble, backdrop)?
- **System test**: one palette, one art style, one type pairing throughout?
- **Truth test**: is every screen the real app, and every claim true?
- **Space test**: do art and layers leave the headline and the key UI clear?
  Nudge `x`/`y`/`width` until nothing important hides behind a layer.

Fix and re-render (`goldie frame`, seconds) until every answer is yes.

## 8. Recipes in goldie

Hook tile with a mascot breaking the frame and proof:

```ts
{ kind: "screenshot", id: "home", flow: "store-01-home", layout: "hero",
  kicker: { "en-US": "for wildlife rescuers" },
  headline: { "en-US": "Every animal *counts*" },
  decorations: [
    { kind: "image", src: "art/fox-wave.png", x: 0.55, y: 0.58, width: 0.5, layer: "front" },
    { kind: "rating", value: "4.9", label: { "en-US": "Trusted by 40+ centres" },
      x: 0.05, y: 0.8, width: 0.5, background: "#FFFFFF", layer: "front" },
  ] }
```

Feature tile with the proof lifted out of the screen and the user's voice:

```ts
{ kind: "screenshot", id: "report", flow: "store-02-report", layout: "tilt",
  headline: { "en-US": "Report in *10 seconds*" },
  decorations: [
    // from: the region of the capture, as fractions of the screen; x/y/width: where the card lands on the tile
    { kind: "callout", from: { x: 0.03, y: 0.40, width: 0.94, height: 0.13 },
      x: 0.02, y: 0.60, width: 0.96, rotate: -3 },
    { kind: "bubble", text: { "en-US": "I found a hurt hedgehog!" }, x: 0.3, y: 0.2, width: 0.66,
      font: "script", tail: "bottom-left", rotate: 4, layer: "front" },
  ] }
```

Theme for a calm, hand-drawn system:

```ts
theme: {
  background: "linear-gradient(170deg, #F3EBDD 0%, #FFFFFF 100%)",
  headlineColor: "#1F2A14", subheadColor: "#5B6450", accentColor: "#E44B2A",
  fontFamily: '"Instrument Serif", Georgia, serif', emphasis: "circle",
  headline: { scale: 1.15 },
  template: ["hero", "tilt", "offset", "copy-below", "poster"], screenOnly: true,
  backdrop: "art/meadow-strip.png",      // optional: one world across the strip
},
```

To find a callout's `from` region, open the raw capture
(`goldie/out/raw/<device>/<scene>.png`), note the card's top and bottom as
fractions of the image height, and use nearly the full width (x 0.02-0.04,
width 0.92-0.96) for list rows and cards.
