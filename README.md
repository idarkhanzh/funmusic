# Gesture Synth

A browser instrument played entirely with webcam hand gestures. Your **left hand**
picks the chord; your **right hand** shapes how it sounds. Everything runs
client-side — the video never leaves the machine and there is no API key.

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
| Index + pinky | Degree VI |
| Index + pinky + thumb | Degree VII |
| Closed fist | Silence |

### Right hand — how it sounds

| Gesture | Result |
| --- | --- |
| 1 finger | Root-position triad |
| 2 fingers | 1st inversion |
| 3 fingers | Diatonic 7th (maj7 / m7 / m7♭5 by degree) |
| 4 fingers | Dominant 7th on major triads, diminished 7th otherwise |
| Thumb out / tucked | Octave up / down |
| Tilt inward / outward | More / less lowpass filtering (`Filter: X%` readout) |
| Hand height | Volume |

The right hand counts index–pinky only, leaving the thumb free for the octave.

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
