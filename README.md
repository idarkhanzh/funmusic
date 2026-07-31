# funmusic

A browser instrument played entirely with webcam hand gestures. Your **left hand**
picks the chord; your **right hand** shapes how it sounds. Everything runs
client-side — the video never leaves the machine and there is no API key.

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
| Audio | Native Web Audio API — oscillators, `BiquadFilterNode`, `GainNode` |
| Analytics | `@vercel/analytics`, `@vercel/speed-insights` (production only) |
| Hosting | Vercel (static output) |

## Running locally

```bash
npm install
npm run dev
```

`predev` / `prebuild` run `scripts/prepare-assets.mjs`, which copies the MediaPipe
WASM runtime out of `node_modules` and downloads the HandLandmarker model into
`public/`. Both are gitignored — they are build inputs, not source — and the app
serves them itself rather than calling a CDN at runtime.

```bash
npm run build     # -> dist/
npm run preview
```

## Gesture reference

MediaPipe supplies only 21 raw landmarks per hand. All gesture logic —
finger curl, tilt, thumb abduction — is computed in `src/gestures.js` from joint
angles and distances, with hysteresis so readings do not chatter at the
thresholds.

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
frame: level hands sit near half volume and a quarter of the frame in either
direction covers the full range. With only the right hand visible it falls back
to absolute height so the instrument stays playable.

Distortion is a `WaveShaper` soft-clip stage. Its makeup gain is derived from the
curve's own RMS response under a realistic signal distribution, so sweeping the
tilt changes timbre rather than volume — measured level spread across the full
sweep is 1.9–4.7 dB while harmonic content rises 1.6–2.9×, with no clipping. The
curve crossfades against the identity line at low amounts so the clean-to-driven
transition has no audible step.

Handedness comes from the tracker and depends on the camera. If the panels react
to the wrong hand, press **Swap hands** in the control row.

## Songs tab

The 🎵 button opens "How to Play", which teaches three songs in the app's own
gesture vocabulary:

- **Perfect** — Ed Sheeran
- **Let Down** — Radiohead
- **Creep** — Radiohead

Song data lives in [`src/songs.js`](src/songs.js); append an entry with the same
shape to add more. The chord-to-gesture translation in
[`src/songTranslate.js`](src/songTranslate.js) is computed at runtime, so nothing
else needs editing.

The instrument can only produce diatonic triads (2 scales × 7 degrees) with four
voicings, and real songs step outside that. Every chord is therefore graded
**exact** or **approximate — nearest diatonic substitute**, with a note saying
what was lost. Nothing is silently faked. For example, in G:

- Creep's **Cm** is *exact* — flip the left hand to the minor scale and it is the `iv`.
- Creep's **B** major is *approximate* — it is not in the key, so the app plays `Bm` (the `iii`).
- Let Down's **D/F#** is *exact* — the 1st inversion is right-hand 2 fingers.
- Let Down's **Dsus2** is *approximate* — there is no suspended voicing, so the plain triad is closest.

Chords are transposed to whatever root you have selected, so the gestures shown
are always correct for your current setting; each card also has a one-click
button to switch the root to the song's own key.

**No lyrics anywhere in the app** — chord names, keys, tempo and section
structure only.

## Deploying to Vercel

Vercel auto-detects Vite; no serverless functions or environment variables are
needed. `prebuild` fetches the model during the Vercel build, so the 7.8 MB
binary stays out of the repo.

```bash
vercel
```

`vercel.json` only adds long-lived cache headers for `/models` and `/mediapipe`.

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
