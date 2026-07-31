/**
 * main.js — wiring: setup screen, tracking loop, HUD, modals.
 */

import './style.css';

import {
  ROOT_CHOICES,
  spellPitchClass,
  diatonicTriad,
  voicingFor,
  chordSymbol,
  midiToFreq,
  BASE_MIDI,
  ROMAN,
  RIGHT_QUALITY_LABELS,
} from './theory.js';
import { AudioEngine, PRESETS } from './audio.js';
import { HandInterpreter, toDisplaySpace, readLeftHand, readRightHand } from './gestures.js';
import { createLandmarker, startCamera, stopCamera, runDetectionLoop, drawHand } from './tracking.js';
import { renderSongsPanel } from './songsPanel.js';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state = {
  rootPc: 7, // G — the key both Radiohead songs and the common Perfect chart use
  preset: 'warm',
  /**
   * MediaPipe labels handedness assuming a mirrored image, but we feed it the
   * raw camera frame — so the label has to be flipped. Cameras and drivers
   * vary, hence the user-facing "Swap hands" escape hatch.
   */
  swapHands: false,
  started: false,
};

const engine = new AudioEngine();
const interpreters = { left: new HandInterpreter('left'), right: new HandInterpreter('right') };
let lastRight = { quality: 1, octaveUp: false, filter: 0.35, volume: 0.7 };
let stopLoop = null;
let stream = null;
let lastChordKey = '';

const preferFlats = () => [1, 3, 6, 8, 10].includes(state.rootPc);

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ */
/* Setup screen                                                        */
/* ------------------------------------------------------------------ */

function buildRootGrid() {
  const grid = $('root-grid');
  grid.replaceChildren();
  for (const choice of ROOT_CHOICES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'note-btn';
    btn.textContent = choice.label;
    btn.dataset.pc = String(choice.pc);
    btn.setAttribute('aria-pressed', String(choice.pc === state.rootPc));
    btn.addEventListener('click', () => setRoot(choice.pc));
    grid.append(btn);
  }
}

function buildPresetGrid() {
  const grid = $('preset-grid');
  grid.replaceChildren();
  for (const [key, p] of Object.entries(PRESETS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn';
    btn.dataset.preset = key;
    const strong = document.createElement('b');
    strong.textContent = p.label;
    const span = document.createElement('span');
    span.textContent = p.blurb;
    btn.append(strong, span);
    btn.setAttribute('aria-pressed', String(key === state.preset));
    btn.addEventListener('click', () => setPreset(key));
    grid.append(btn);
  }
}

function buildLiveSelects() {
  const rootSel = $('live-root');
  rootSel.replaceChildren();
  for (const choice of ROOT_CHOICES) {
    const opt = document.createElement('option');
    opt.value = String(choice.pc);
    opt.textContent = choice.label;
    rootSel.append(opt);
  }
  rootSel.value = String(state.rootPc);
  rootSel.addEventListener('change', () => setRoot(Number(rootSel.value)));

  const presetSel = $('live-preset');
  presetSel.replaceChildren();
  for (const [key, p] of Object.entries(PRESETS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = p.label;
    presetSel.append(opt);
  }
  presetSel.value = state.preset;
  presetSel.addEventListener('change', () => setPreset(presetSel.value));
}

function setRoot(pc) {
  state.rootPc = pc;
  lastChordKey = '';
  for (const btn of document.querySelectorAll('.note-btn')) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.pc) === pc));
  }
  $('live-root').value = String(pc);
}

function setPreset(key) {
  state.preset = key;
  for (const btn of document.querySelectorAll('.preset-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.preset === key));
  }
  $('live-preset').value = key;
  engine.setPreset(key);
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

async function start() {
  if (state.started) return;
  const btn = $('start-btn');
  const status = $('setup-status');
  btn.disabled = true;
  status.className = 'status';

  try {
    status.textContent = 'Starting audio…';
    await engine.start();
    engine.setPreset(state.preset);

    status.textContent = 'Loading the hand tracking model (about 8 MB, first time only)…';
    const landmarker = await createLandmarker();

    status.textContent = 'Requesting camera…';
    const video = $('video');
    stream = await startCamera(video);

    state.started = true;
    $('setup').hidden = true;
    $('stage').hidden = false;
    sizeCanvas();

    stopLoop = runDetectionLoop(landmarker, video, onFrame);
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    status.className = 'status status-error';
    status.textContent = describeStartError(err);
  }
}

function describeStartError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Allow it in your browser’s site settings, then try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is already in use by another application.';
  }
  return `Could not start: ${err && err.message ? err.message : err}`;
}

/* ------------------------------------------------------------------ */
/* Per-frame                                                           */
/* ------------------------------------------------------------------ */

function sizeCanvas() {
  const video = $('video');
  const canvas = $('overlay');
  if (!video.videoWidth) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

function onFrame(result, video) {
  sizeCanvas();
  const canvas = $('overlay');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const aspect = video.videoWidth / video.videoHeight || 1;
  const handednessList = result.handedness || result.handednesses || [];

  const hands = { left: null, right: null };

  for (let i = 0; i < (result.landmarks || []).length; i++) {
    const category = handednessList[i] && handednessList[i][0];
    if (!category) continue;

    // MediaPipe assumes a mirrored image; we feed the raw frame, so flip.
    let side = category.categoryName === 'Left' ? 'right' : 'left';
    if (state.swapHands) side = side === 'left' ? 'right' : 'left';

    const points = toDisplaySpace(result.landmarks[i], aspect);
    hands[side] = points;
    drawHand(ctx, points, aspect, side === 'left' ? 'rgba(122,215,255,0.95)' : 'rgba(255,167,120,0.95)');
  }

  updateFromHands(hands);
}

function updateFromHands(hands) {
  /* ---- right hand: voicing + expression (held when the hand drops out) ---- */
  if (hands.right) {
    lastRight = readRightHand(interpreters.right.update(hands.right));
  } else {
    interpreters.right.reset();
  }
  const right = lastRight;

  engine.setFilterAmount(right.filter);

  /* ---- left hand: which chord ---- */
  let left = null;
  if (hands.left) {
    left = readLeftHand(interpreters.left.update(hands.left));
  } else {
    interpreters.left.reset();
  }

  const silent = !left || left.degree === 0;

  if (silent) {
    engine.setVolume(0);
    if (lastChordKey !== 'silent') {
      engine.setChord([]);
      lastChordKey = 'silent';
    }
  } else {
    engine.setVolume(hands.right ? right.volume : 0.65);
    const triad = diatonicTriad(left.mode, left.degree);
    const intervals = voicingFor(triad, right.quality);
    const rootMidi = BASE_MIDI + state.rootPc + triad.rootOffset + (right.octaveUp ? 12 : 0);
    const key = `${state.rootPc}|${left.mode}|${left.degree}|${right.quality}|${right.octaveUp}`;
    if (key !== lastChordKey) {
      engine.setChord(intervals.map((iv) => midiToFreq(rootMidi + iv)));
      lastChordKey = key;
    }
  }

  updateHud(hands, left, right);
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

const hudCache = {};
function setText(id, value) {
  if (hudCache[id] === value) return;
  hudCache[id] = value;
  $(id).textContent = value;
}

function updateHud(hands, left, right) {
  if (left) {
    setText('r-scale', left.mode === 'major' ? 'Major (inward)' : 'Minor (outward)');
    setText('r-degree', left.degree === 0 ? '—' : ROMAN[left.mode][left.degree - 1]);
    setText('r-lgesture', left.gesture);
  } else {
    setText('r-scale', '—');
    setText('r-degree', '—');
    setText('r-lgesture', 'no left hand');
  }

  setText('r-quality', RIGHT_QUALITY_LABELS[right.quality]);
  setText('r-octave', right.octaveUp ? 'Up (thumb out)' : 'Down (thumb in)');

  const filterPct = Math.round(right.filter * 100);
  setText('r-filter', `${filterPct}%`);
  $('m-filter').style.width = `${filterPct}%`;

  const sounding = Boolean(left && left.degree > 0);
  const volPct = Math.round((sounding ? (hands.right ? right.volume : 0.65) : 0) * 100);
  setText('r-volume', `${volPct}%`);
  $('m-volume').style.width = `${volPct}%`;

  if (sounding) {
    const triad = diatonicTriad(left.mode, left.degree);
    const chordPc = (state.rootPc + triad.rootOffset) % 12;
    setText('r-chord', chordSymbol(chordPc, triad, right.quality, preferFlats()));
    setText(
      'r-notes',
      voicingFor(triad, right.quality)
        .map((iv) => spellPitchClass(chordPc + iv, preferFlats()))
        .join(' · ')
    );
  } else {
    setText('r-chord', '—');
    setText('r-notes', '');
  }

  let hint = '';
  if (!hands.left && !hands.right) hint = 'Raise both hands into frame.';
  else if (!hands.left) hint = 'Left hand not visible — it selects the chord.';
  else if (!hands.right) hint = 'Right hand not visible — holding the last voicing.';
  else if (left && left.degree === 0) hint = 'Left fist = silence. Open a finger to play.';
  setText('stage-hint', hint);
  $('stage-hint').style.opacity = hint ? '1' : '0';
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

function openModal(id) {
  if (id === 'songs-modal') refreshSongs();
  $(id).hidden = false;
  document.body.classList.add('modal-open');
}

function closeModal(id) {
  $(id).hidden = true;
  if (document.querySelectorAll('.modal:not([hidden])').length === 0) {
    document.body.classList.remove('modal-open');
  }
}

function refreshSongs() {
  renderSongsPanel(
    $('songs-body'),
    () => state.rootPc,
    (pc) => {
      setRoot(pc);
      refreshSongs();
    }
  );
}

function wireModals() {
  for (const modal of document.querySelectorAll('.modal')) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal.id);
    });
    modal.querySelector('.modal-close').addEventListener('click', () => closeModal(modal.id));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const modal of document.querySelectorAll('.modal:not([hidden])')) closeModal(modal.id);
  });

  $('setup-help').addEventListener('click', () => openModal('help-modal'));
  $('open-help').addEventListener('click', () => openModal('help-modal'));
  $('setup-songs').addEventListener('click', () => openModal('songs-modal'));
  $('open-songs').addEventListener('click', () => openModal('songs-modal'));
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  buildRootGrid();
  buildPresetGrid();
  buildLiveSelects();
  wireModals();

  $('start-btn').addEventListener('click', start);

  $('panic').addEventListener('click', () => {
    engine.releaseAll();
    lastChordKey = '';
  });

  $('swap-hands').addEventListener('click', () => {
    state.swapHands = !state.swapHands;
    $('swap-hands').classList.toggle('is-active', state.swapHands);
    interpreters.left.reset();
    interpreters.right.reset();
    lastChordKey = '';
  });

  window.addEventListener('pagehide', () => {
    if (stopLoop) stopLoop();
    stopCamera(stream);
  });

  if (import.meta.env.PROD) {
    Promise.all([import('@vercel/analytics'), import('@vercel/speed-insights')])
      .then(([analytics, speed]) => {
        analytics.inject();
        speed.injectSpeedInsights();
      })
      .catch(() => {
        /* analytics are optional — never break the instrument over them */
      });
  }
}

boot();
