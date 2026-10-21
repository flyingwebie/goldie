# Videos: the promo video and preview captions

goldie makes two different videos. Keep them apart:

| | App Store preview (`goldie preview`) | Promo video (`goldie promo`) |
|---|---|---|
| For | the App Store product page | TikTok, Reels, Shorts, X, ads, the Play Store promo link (YouTube), the website |
| Content | real screen recordings of the app, joined | the designed tiles animated: headlines, devices, art, callouts, outro |
| Rules | Apple: footage of the app itself, 15-30 s; captions allowed | none; aim for 12-25 s |
| Size | 886x1920 (iPhone), 1200x1600 (iPad) | 1080x1920 (9:16), 1080x1350 (4:5), 1080x1080 (1:1), 1920x1080 (16:9) |

## Preview captions

App Review Guideline 2.3.4 lets a preview add "narration and video or textual
overlays to help explain anything that isn't clear from the video alone".
Give each preview segment a short caption, in the same voice as the
headlines, with a stressed word:

```ts
{ kind: "preview", id: "preview", captionPosition: "bottom",   // or "top"
  segments: [
    { id: "open",   flow: "store-preview-01-open",   caption: { "en-US": "Your whole centre in *one app*" } },
    { id: "report", flow: "store-preview-02-report", caption: { "en-US": "Report an animal *in 10 seconds*" } },
    { id: "done",   flow: "store-preview-03-done",   caption: { "en-US": "Every rescue, *tracked*" }, holdSeconds: 2 },
  ] }
```

Captions fade in and out over their segment on a dark rounded plate; the
stressed word takes `theme.accentColor`. Keep them to six words or fewer and
let the footage do the rest. Re-render with `goldie preview` (no re-capture
needed for caption changes).

## The promo video

The promo plays the screenshot scenes in order, each composed for the video
frame and brought to life: kicker and headline lines rise in, the emphasis
mark draws itself, the device springs up, back layers pop, callouts and
front-layer art land and keep floating, panorama tiles pan across both
halves, and each scene pushes into the next. An outro card closes it.

It renders with [HyperFrames](https://github.com/heygen-com/hyperframes)
(Apache-2.0), not a hand-rolled ffmpeg pipeline: `goldie promo` slices each
composed scene into the same layers `drawScene` paints (background, every
copy line, every emphasis mark, every decoration, every device) as
transparent PNGs, writes a HyperFrames project with a GSAP timeline that
reproduces the choreography above, and hands it to HyperFrames to render -
one pass, music and all. The config is unchanged; only the engine is new.

```ts
promo: {
  formats: ["9:16", "4:5", "16:9"],   // default ["9:16"]; 16:9 for YouTube, websites, decks
  scenes: ["home", "report", "species", "offline"],   // default: every screenshot scene
  secondsPerScene: 2.8,               // default 3
  intro: "art/fox-rescuer.mp4",       // optional full-screen clip played first (an animated art asset)
  outro: {
    headline: { "en-US": "Rescue *more animals*" },
    cta: { "en-US": "Download CRAS Connect" },
    icon: "art/icon.png",             // the app icon, 1024x1024
  },
  audio: "music/bed.mp3",             // a track the user has rights to, or:
  music: { prompt: "warm hopeful acoustic guitar and soft percussion, 90 bpm, no vocals" },
},
```

```bash
GOLDIE_CONFIG=... npx -y goldie@0 promo                 # every format in the config
GOLDIE_CONFIG=... npx -y goldie@0 promo --format 1:1    # one format
GOLDIE_CONFIG=... npx -y goldie@0 promo --render-only   # re-render an edited composition, no regeneration
```

Output: `goldie/out/promo/<9x16|4x5|1x1>/<locale>/promo.mp4`, also playable in
the studio's Promo view.

**Requirements**: Node >= 22 on PATH (goldie's own floor is >= 20.12; only
`promo` needs the newer Node, because HyperFrames does) and network access the
first time, to fetch `npx hyperframes` and its headless Chrome. `goldie
doctor` checks both when the config has a `promo` block, and reports the fix
(`nvm install 22`, `npx hyperframes browser ensure`, ...).

- **Music**: `audio` wins when set; otherwise `music.prompt` generates a bed
  through fal (cached in the art dir, so it is made once); with neither the
  video is silent. Music fades in and out with the video. Ask the user before
  using a track whose rights are unclear.
- **16:9 (landscape)**: the portrait tile is split like a slide: the copy is
  recomposed in the left column at slide size, and the tile's phone with its
  mascots, callouts and bubbles is fitted into the right column (a phone that
  bleeds off the tile's bottom or right edge bleeds off the frame's too). The
  background art spans the frame and the scrim darkens from the left, behind
  the copy. Check one frame per scene: a tile whose layers sit far from its
  phone can leave the middle of the frame empty.
- **Pacing**: 2.5-3 s per scene reads well; 4-6 scenes plus the outro lands
  at 15-20 s. Lead with the hook tile, end on proof, then the outro.
- **Type**: the promo sets copy larger than the store tiles (a phone screen,
  not a gallery). Long headlines wrap to more lines; prefer 2-4 words.
- **Layers in a new frame**: decoration positions are fractions of the frame,
  so a layer tuned for the tall store tile can sit differently in 4:5 or 1:1.
  Check one frame per scene (`ffmpeg -ss <t> -i promo.mp4 -frames:v 1 f.png`)
  and give the promo its own scene list if a tile does not survive the crop.

### Customising the generated composition with HyperFrames' own tools

`goldie promo` keeps the project it generates at
`out/promo/<format>/<locale>/composition/` (an `index.html`, the layer PNGs
under `layers/`, and the copied intro clip and audio). Open it with
HyperFrames' own tooling to hand-tune a render without touching goldie:

```bash
cd out/promo/9x16/it-IT/composition
npx hyperframes preview                 # live preview server
npx hyperframes add flash-through-white # drop in a catalog transition
npx hyperframes@0.8.181 render -o ../promo.mp4   # or let goldie do it:
GOLDIE_CONFIG=... npx -y goldie@0 promo --render-only
```

`npx skills add heygen-com/hyperframes` installs HyperFrames' own agent
skills (the `/hyperframes` router, its catalog of transitions and overlays,
its frame.md design templates) for an agent editing the composition by hand.
A plain `goldie promo` (without `--render-only`) regenerates the composition
from the config and discards any hand edits - keep them in the config
(decorations, timing, outro) where they survive a re-run, and reach for
`--render-only` only after a one-off tweak you want to keep as-is.
