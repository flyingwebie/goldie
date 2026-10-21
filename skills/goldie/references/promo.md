# Videos: the promo video and preview captions

goldie makes two different videos. Keep them apart:

| | App Store preview (`goldie preview`) | Promo video (`goldie promo`) |
|---|---|---|
| For | the App Store product page | TikTok, Reels, Shorts, X, ads, the Play Store promo link (YouTube), the website |
| Content | real screen recordings of the app, joined | the designed tiles animated: headlines, devices, art, callouts, outro |
| Rules | Apple: footage of the app itself, 15-30 s; captions allowed | none; aim for 12-25 s |
| Size | 886x1920 (iPhone), 1200x1600 (iPad) | 1080x1920 (9:16), 1080x1350 (4:5), 1080x1080 (1:1) |

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

```ts
promo: {
  formats: ["9:16", "4:5"],           // default ["9:16"]
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
```

Output: `goldie/out/promo/<9x16|4x5|1x1>/<locale>/promo.mp4`, also playable in
the studio's Promo view. Rendering takes seconds, so iterate freely.

- **Music**: `audio` wins when set; otherwise `music.prompt` generates a bed
  through fal (cached in the art dir, so it is made once); with neither the
  video is silent. Music fades in and out with the video. Ask the user before
  using a track whose rights are unclear.
- **Pacing**: 2.5-3 s per scene reads well; 4-6 scenes plus the outro lands
  at 15-20 s. Lead with the hook tile, end on proof, then the outro.
- **Type**: the promo sets copy larger than the store tiles (a phone screen,
  not a gallery). Long headlines wrap to more lines; prefer 2-4 words.
- **Layers in a new frame**: decoration positions are fractions of the frame,
  so a layer tuned for the tall store tile can sit differently in 4:5 or 1:1.
  Check one frame per scene (`ffmpeg -ss <t> -i promo.mp4 -frames:v 1 f.png`)
  and give the promo its own scene list if a tile does not survive the crop.
