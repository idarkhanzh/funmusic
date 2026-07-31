/**
 * theory.js — note names, diatonic scale/chord construction, voicings, naming.
 *
 * Everything here is pure: no audio, no DOM. The instrument and the Songs tab
 * both build on this so a chord shown in "How to play" is literally the same
 * chord the synth will produce.
 */

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Root picker order, as specified: A through G#/Ab. */
export const ROOT_CHOICES = [
  { pc: 9, label: 'A' },
  { pc: 10, label: 'A#/Bb' },
  { pc: 11, label: 'B' },
  { pc: 0, label: 'C' },
  { pc: 1, label: 'C#/Db' },
  { pc: 2, label: 'D' },
  { pc: 3, label: 'D#/Eb' },
  { pc: 4, label: 'E' },
  { pc: 5, label: 'F' },
  { pc: 6, label: 'F#/Gb' },
  { pc: 7, label: 'G' },
  { pc: 8, label: 'G#/Ab' },
];

const PITCH_CLASS_LOOKUP = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4,
  'E#': 5, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9,
  'A#': 10, Bb: 10, B: 11, Cb: 11,
};

/** "F#" | "Bb" | "g" -> 0..11, or null if unparseable. */
export function pitchClassOf(name) {
  if (typeof name !== 'string') return null;
  const key = name.trim().replace(/^([a-g])/, (m) => m.toUpperCase());
  const pc = PITCH_CLASS_LOOKUP[key];
  return pc === undefined ? null : pc;
}

/** Spell a pitch class, preferring flats when the surrounding key uses them. */
export function spellPitchClass(pc, preferFlats = false) {
  const table = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  return table[((pc % 12) + 12) % 12];
}

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
};

export const ROMAN = {
  major: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
  minor: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'],
};

/** Semitone offset of the n-th scale step, wrapping into higher octaves. */
function scaleStep(scale, index) {
  const octave = Math.floor(index / 7);
  const within = ((index % 7) + 7) % 7;
  return scale[within] + 12 * octave;
}

/**
 * Stack diatonic thirds on `degree` (1-based) of `mode`.
 * Returns intervals measured from the CHORD root, plus the chord root's
 * offset from the key root.
 */
export function diatonicTriad(mode, degree) {
  const scale = SCALES[mode] || SCALES.major;
  const i = degree - 1;
  const rootOffset = scaleStep(scale, i);
  const third = scaleStep(scale, i + 2) - rootOffset;
  const fifth = scaleStep(scale, i + 4) - rootOffset;
  const seventh = scaleStep(scale, i + 6) - rootOffset;

  let quality = 'maj';
  if (third === 3 && fifth === 7) quality = 'min';
  else if (third === 3 && fifth === 6) quality = 'dim';
  else if (third === 4 && fifth === 8) quality = 'aug';

  return { mode, degree, rootOffset, third, fifth, seventh, quality };
}

/** All 14 chords the left hand can reach (2 scales x 7 degrees). */
export function allDiatonicChords(keyRootPc) {
  const out = [];
  for (const mode of ['major', 'minor']) {
    for (let degree = 1; degree <= 7; degree++) {
      const triad = diatonicTriad(mode, degree);
      out.push({ ...triad, pc: (keyRootPc + triad.rootOffset) % 12 });
    }
  }
  return out;
}

/**
 * Right-hand finger count -> voicing, as intervals above the chord root.
 *   1 = root position triad
 *   2 = 1st inversion (third in the bass)
 *   3 = diatonic 7th  (maj7 / min7 / m7b5 depending on the degree)
 *   4 = dominant 7th on major triads, diminished 7th on minor/dim triads
 */
export function voicingFor(triad, rightFingers) {
  const { third, fifth, seventh, quality } = triad;
  switch (rightFingers) {
    case 2:
      return [third, fifth, 12];
    case 3:
      return [0, third, fifth, seventh];
    case 4:
      return quality === 'maj' || quality === 'aug'
        ? [0, 4, 7, 10]
        : [0, 3, 6, 9];
    case 1:
    default:
      return [0, third, fifth];
  }
}

export const RIGHT_QUALITY_LABELS = {
  1: 'Triad (root position)',
  2: '1st inversion',
  3: 'Major / minor 7th',
  4: 'Dominant / diminished 7th',
};

const QUALITY_SUFFIX = { maj: '', min: 'm', dim: 'dim', aug: 'aug' };

/** Human-readable chord symbol for the HUD, e.g. "Am7", "G/B", "Bdim7". */
export function chordSymbol(rootPc, triad, rightFingers, preferFlats = false) {
  const root = spellPitchClass(rootPc, preferFlats);
  const { quality, third, seventh } = triad;

  if (rightFingers === 2) {
    const bass = spellPitchClass(rootPc + third, preferFlats);
    return `${root}${QUALITY_SUFFIX[quality]}/${bass}`;
  }
  if (rightFingers === 3) {
    if (quality === 'maj') return `${root}maj7`;
    if (quality === 'min') return `${root}m7`;
    if (quality === 'dim') return `${root}m7b5`;
    return `${root}aug${seventh === 11 ? 'maj7' : '7'}`;
  }
  if (rightFingers === 4) {
    return quality === 'maj' || quality === 'aug' ? `${root}7` : `${root}dim7`;
  }
  return `${root}${QUALITY_SUFFIX[quality]}`;
}

/** MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** C3 = MIDI 48. The low octave sits here; thumb-out shifts up 12. */
export const BASE_MIDI = 48;
