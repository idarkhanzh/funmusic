# moon-music

A browser instrument played entirely with webcam hand gestures. Your **left hand**
picks the chord; your **right hand** shapes how it sounds. Everything runs
client-side — the video never leaves the machine and there is no API key.

Point a webcam at yourself, raise two hands, and play chords in the air.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Then click **enable audio & camera** — nothing touches the webcam before that
click, because browsers require a user gesture to start audio anyway.

## How you play it

MediaPipe gives the app 21 raw landmarks per hand and nothing else. Every notion
of "a finger is extended", "the hand is tilted inward", "the thumb is tucked" is
computed in [`src/gestures.js`](src/gestures.js) from joint angles and distances,
with hysteresis so readings don't chatter at the thresholds.

### Left hand — which chord

| Gesture | Result |
| --- | --- |
| Tilt inward | Major scale |
| Tilt outward | Natural minor scale |
| 1–5 fingers | Scale degrees I–V |
| Pinky + thumb | Degree VI |
| Pinky + index + thumb | Degree VII |
| Closed fist | Silence |

The two combination shapes are matched before plain counting, since both would
otherwise be swallowed by it — pinky+thumb is also two extended fingers, and
pinky+index+thumb is three.

### Right hand — how it sounds

| Gesture | Result |
| --- | --- |
| Index | Major or minor triad, whichever the left hand selected |
| Index + middle | 1st inversion |
| Index + middle + ring | Major 7th or minor 7th, following the left hand |
| + pinky (all four) | Dominant 7th on major chords, diminished 7th on minor ones |
| Add the thumb | Shifts the chord up an octave |
| Tilt inward / outward | More / less distortion (`Distortion: X%` readout) |
| Right hand above / below left | Louder / quieter |

Major or minor always comes from the left hand; the right hand only decides how
that chord is voiced. Counting ignores the thumb, leaving it free to switch
octaves at any finger count.

Volume is the right hand's height **relative to the left**, not its position in
frame: level hands sit near half volume, and a quarter of the frame in either
direction covers the full range. With only the right hand visible it falls back
to absolute height so the instrument stays playable.

Handedness comes from the tracker and depends on the camera. If the panels react
to the wrong hand, press **Swap hands** in the control row.

## Songs tab

The 🎵 button opens "How to Play", which teaches three songs in the app's own
gesture vocabulary:

- **Perfect** — Ed Sheeran
- **Let Down** — Radiohead
- **Creep** — Radiohead

The instrument can only produce diatonic triads (2 scales × 7 degrees) with four
voicings, and real songs step outside that. Every chord is therefore graded
**exact** or **approximate — nearest diatonic substitute**, with a note saying
what was lost. Nothing is silently faked. For example, in G:

- Creep's **Cm** is *exact* — flip the left hand to the minor scale and it's the `iv`.
- Creep's **B** major is *approximate* — not in the key, so the app plays `Bm` (the `iii`).
- Let Down's **D/F#** is *exact* — the 1st inversion is right hand index + middle.
- Let Down's **Dsus2** is *approximate* — there's no suspended voicing, so the plain triad is closest.

Chords transpose to whatever root you've selected, so the gestures shown are
always correct for your current setting; each card also has a one-click button to
switch the root to the song's own key.

Song data lives in [`src/songs.js`](src/songs.js) — append an entry with the same
shape to add more. The chord-to-gesture translation in
[`src/songTranslate.js`](src/songTranslate.js) is computed at runtime, so nothing
else needs editing.

**No lyrics anywhere in the app** — chord names, keys, tempo and section
structure only.

## Sound

Native Web Audio, no libraries. Three presets (Warm / Bright / Retro) built from
oscillator stacks, each through a static per-preset lowpass, then a `WaveShaper`
the right hand drives, then volume and a limiter.

Voices are diffed on chord change, so a note present in both the old and new
chord keeps ringing instead of retriggering — that's what makes moving between
inversions sound like a chord change rather than a stab.

The distortion's makeup gain is derived from the curve's own RMS response under a
realistic signal distribution rather than a hand-tuned constant, and the curve
crossfades against the identity line at low drive. Without both, the first touch
of the gesture jumped about 9 dB. Measured across the full sweep: level spread
1.9–4.7 dB, harmonic content up 1.6–2.9×, no clipping on any preset.

## Design

Warm and bright: cream paper (`#faf7f0`), clay (`#d97757`) and amber (`#dd9a30`)
accents, deep warm ink for type. JetBrains Mono carries the wordmark and all
structural type — labels, data, chord names — with a system sans for long prose
so the modals stay readable. The font is self-hosted via `@fontsource-variable`,
so like the MediaPipe assets it needs no CDN and works offline.

Colour roles are split deliberately: `--clay` / `--amber` are the **bright fills**
and stay fully saturated, while `--clay-deep` / `--amber-deep` are the
**text-safe** variants, darkened only as far as contrast requires. Body text on
paper measures 14.8:1, and all 539 rendered text elements clear WCAG AA. Cream
text on the amber gradient measured 2.4:1, so buttons use deep ink on the bright
gradient instead — which keeps the colour brighter than darkening it would.

## Stack

| Concern | Choice |
| --- | --- |
| Bundler | Vite (vanilla JS, no framework) |
| Hand tracking | `@mediapipe/tasks-vision` `HandLandmarker`, WASM, in-browser |
| Audio | Native Web Audio API — oscillators, `BiquadFilterNode`, `WaveShaperNode`, `GainNode` |
| Type | JetBrains Mono via `@fontsource-variable` (self-hosted) |
| Analytics | `@vercel/analytics`, `@vercel/speed-insights` (production only) |
| Hosting | Vercel (static output) |

## Build

```bash
npm run build
```

`predev` / `prebuild` run [`scripts/prepare-assets.mjs`](scripts/prepare-assets.mjs),
which copies the MediaPipe WASM runtime out of `node_modules` and downloads the
7.8 MB HandLandmarker model into `public/`. Both are gitignored — they're build
inputs, not source — which keeps the repo small while the app still serves them
itself instead of calling a CDN at runtime.

## Deploying

Vercel auto-detects Vite. No serverless functions and no environment variables;
`prebuild` fetches the model during the Vercel build.

```bash
vercel
```

`vercel.json` only adds long-lived cache headers for `/models` and `/mediapipe`.
Enable Web Analytics in the Vercel project settings, or the `@vercel/analytics`
calls stay inert.

## Project layout

```
src/
  theory.js         scales, diatonic chords, voicings, chord naming (pure)
  gestures.js       landmarks -> musical intent (pure)
  audio.js          Web Audio engine, three presets, voice diffing
  tracking.js       getUserMedia + HandLandmarker + overlay drawing
  songs.js          song reference data (no lyrics)
  songTranslate.js  chord symbol parser + gesture solver
  songsPanel.js     renders the Songs tab
  main.js           wiring, HUD, modals
scripts/
  prepare-assets.mjs
```

`theory.js` and `gestures.js` are pure — no DOM, no audio — so the instrument and
the Songs tab build on the same code. A chord the Songs tab tells you to play is
literally the chord the synth produces.
