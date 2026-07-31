/**
 * songTranslate.js — turn a published chord symbol into this app's gestures.
 *
 * The instrument can only produce diatonic triads (2 scales x 7 degrees) with
 * four right-hand voicings. Real songs do not stay inside that box, so every
 * translation is graded:
 *
 *   exact       — the app reproduces this chord precisely
 *   approximate — the nearest thing the app can reach, and we say why
 *
 * Nothing is silently faked.
 */

import {
  pitchClassOf,
  spellPitchClass,
  allDiatonicChords,
  diatonicTriad,
  chordSymbol,
  ROMAN,
} from './theory.js';

/* ------------------------------------------------------------------ */
/* Chord symbol parsing                                                */
/* ------------------------------------------------------------------ */

/**
 * Suffix -> { quality, seventh, extra }
 *  quality: triad type the app would need
 *  seventh: interval of the 7th above the root, or null
 *  extra:   a note explaining anything the app cannot represent
 */
const SUFFIXES = [
  ['maj7', { quality: 'maj', seventh: 11 }],
  ['M7', { quality: 'maj', seventh: 11 }],
  ['m7b5', { quality: 'dim', seventh: 10 }],
  ['min7', { quality: 'min', seventh: 10 }],
  ['m7', { quality: 'min', seventh: 10 }],
  ['dim7', { quality: 'dim', seventh: 9 }],
  ['dim', { quality: 'dim', seventh: null }],
  ['aug', { quality: 'aug', seventh: null }],
  ['sus2', { quality: 'maj', seventh: null, extra: 'sus2 — the app has no suspended voicing, so the plain triad is the closest shape.' }],
  ['sus4', { quality: 'maj', seventh: null, extra: 'sus4 — the app has no suspended voicing, so the plain triad is the closest shape.' }],
  ['add9', { quality: 'maj', seventh: null, extra: 'add9 — the added 9th is not reachable; play the plain triad.' }],
  ['m6', { quality: 'min', seventh: null, extra: 'The added 6th is not reachable; play the plain minor triad.' }],
  ['6', { quality: 'maj', seventh: null, extra: 'The added 6th is not reachable; play the plain triad.' }],
  ['9', { quality: 'maj', seventh: 10, extra: 'The 9th is not reachable; the dominant 7th is the closest shape.' }],
  ['7', { quality: 'maj', seventh: 10 }],
  ['5', { quality: 'maj', seventh: null, extra: 'Power chord — the app always sounds a full triad.' }],
  ['min', { quality: 'min', seventh: null }],
  ['m', { quality: 'min', seventh: null }],
  ['maj', { quality: 'maj', seventh: null }],
  ['', { quality: 'maj', seventh: null }],
];

/** Parse "F#m7/A" into its root, quality, 7th and bass note. */
export function parseChord(symbol) {
  const raw = String(symbol).trim();
  const [main, bassPart] = raw.split('/');

  const m = /^([A-Ga-g][#b]?)(.*)$/.exec(main.trim());
  if (!m) return null;

  const rootPc = pitchClassOf(m[1]);
  if (rootPc === null) return null;

  const suffix = m[2].trim();
  const entry = SUFFIXES.find(([s]) => s === suffix);
  if (!entry) return null;

  const bassPc = bassPart ? pitchClassOf(bassPart.trim()) : null;

  return {
    symbol: raw,
    rootPc,
    quality: entry[1].quality,
    seventh: entry[1].seventh,
    extra: entry[1].extra || null,
    bassPc,
  };
}

/** Transpose a chord symbol by `semitones`, keeping any slash bass. */
export function transposeSymbol(symbol, semitones, preferFlats = false) {
  const raw = String(symbol).trim();
  const [main, bassPart] = raw.split('/');
  const m = /^([A-Ga-g][#b]?)(.*)$/.exec(main.trim());
  if (!m) return raw;

  const pc = pitchClassOf(m[1]);
  if (pc === null) return raw;

  let out = spellPitchClass(pc + semitones, preferFlats) + m[2];
  if (bassPart) {
    const bpc = pitchClassOf(bassPart.trim());
    if (bpc !== null) out += '/' + spellPitchClass(bpc + semitones, preferFlats);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Gesture translation                                                 */
/* ------------------------------------------------------------------ */

const LEFT_FINGER_TEXT = {
  1: '1 finger',
  2: '2 fingers',
  3: '3 fingers',
  4: '4 fingers',
  5: '5 fingers',
  6: 'pinky + thumb',
  7: 'pinky + index + thumb',
};

const RIGHT_FINGER_TEXT = {
  1: 'index — plain triad',
  2: 'index + middle — 1st inversion',
  3: 'index + middle + ring — major/minor 7th',
  4: 'all four fingers — dominant / diminished 7th',
};

/** Semitone distance on the circle of fifths — a better "nearest" than chromatic. */
function fifthsDistance(a, b) {
  const idx = (pc) => (pc * 7) % 12; // map pc onto fifths order
  const d = Math.abs(idx(a) - idx(b));
  return Math.min(d, 12 - d);
}

/**
 * @param {string} symbol   published chord name, e.g. "Cm" or "D/F#"
 * @param {string|number} appRoot  the root note currently selected in the app
 * @returns {object} translation with `exact` flag and human-readable notes
 */
export function translateChord(symbol, appRoot) {
  const appRootPc = typeof appRoot === 'number' ? appRoot : pitchClassOf(appRoot);
  const parsed = parseChord(symbol);

  if (parsed === null || appRootPc === null) {
    return {
      symbol: String(symbol),
      exact: false,
      unplayable: true,
      notes: ['Could not parse this chord symbol.'],
    };
  }

  const notes = [];
  const candidates = allDiatonicChords(appRootPc);

  // 1. exact root + exact triad quality
  let match = candidates.find((c) => c.pc === parsed.rootPc && c.quality === parsed.quality);
  let grade = 'exact';

  // 2. right root, wrong triad quality
  if (!match) {
    match = candidates.find((c) => c.pc === parsed.rootPc);
    if (match) {
      grade = 'approx';
      notes.push(
        `${spellPitchClass(parsed.rootPc)} ${qualityWord(parsed.quality)} is not in this key. ` +
          `The app's ${ROMAN[match.mode][match.degree - 1]} on the same root gives ` +
          `${spellPitchClass(match.pc)} ${qualityWord(match.quality)} instead.`
      );
    }
  }

  // 3. nearest reachable root
  if (!match) {
    let best = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      const score = fifthsDistance(c.pc, parsed.rootPc) * 10 + (c.quality === parsed.quality ? 0 : 3)
        + (c.mode === 'major' ? 0 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    match = best;
    grade = 'approx';
    notes.push(
      `${parsed.symbol} has no counterpart in this key. ` +
        `${spellPitchClass(match.pc)} ${qualityWord(match.quality)} is the nearest diatonic chord.`
    );
  }

  const triad = diatonicTriad(match.mode, match.degree);

  // --- right hand: voicing ---
  let rightFingers = 1;

  if (parsed.bassPc !== null) {
    const thirdPc = (match.pc + triad.third) % 12;
    const fifthPc = (match.pc + triad.fifth) % 12;
    if (parsed.bassPc === thirdPc) {
      rightFingers = 2; // 1st inversion — exactly what 2 fingers does
    } else if (parsed.bassPc === fifthPc) {
      grade = 'approx';
      notes.push('2nd inversion (fifth in the bass) is not available — 1 finger plays root position.');
    } else if (parsed.bassPc !== match.pc) {
      grade = 'approx';
      notes.push(
        `The ${spellPitchClass(parsed.bassPc)} bass note is not a chord tone and cannot be voiced separately.`
      );
    }
  }

  if (parsed.seventh !== null && rightFingers !== 2) {
    if (parsed.seventh === triad.seventh) {
      rightFingers = 3; // the diatonic 7th already is the one we want
    } else if (parsed.seventh === 10 && (triad.quality === 'maj' || triad.quality === 'aug')) {
      rightFingers = 4; // dominant 7th
    } else if (parsed.seventh === 9 && triad.quality !== 'maj') {
      rightFingers = 4; // fully diminished 7th
    } else {
      rightFingers = 3;
      grade = 'approx';
      notes.push('The exact 7th is not reachable — 3 fingers gives the diatonic 7th of this degree.');
    }
  }

  if (parsed.extra) {
    grade = 'approx';
    notes.push(parsed.extra);
  }

  return {
    symbol: parsed.symbol,
    exact: grade === 'exact',
    unplayable: false,
    mode: match.mode,
    degree: match.degree,
    roman: ROMAN[match.mode][match.degree - 1],
    // What the synth will actually sound — same naming the live HUD uses, so
    // an inversion or 7th chosen above is reflected here rather than dropped.
    producedSymbol: chordSymbol(match.pc, triad, rightFingers),
    leftTilt: match.mode === 'major' ? 'inward' : 'outward',
    leftTiltLabel: match.mode === 'major' ? 'tilt inward — major scale' : 'tilt outward — minor scale',
    leftFingers: match.degree,
    leftFingersLabel: LEFT_FINGER_TEXT[match.degree],
    rightFingers,
    rightFingersLabel: RIGHT_FINGER_TEXT[rightFingers],
    notes,
  };
}

function qualityWord(q) {
  return { maj: 'major', min: 'minor', dim: 'diminished', aug: 'augmented' }[q] || q;
}

/**
 * Translate a whole song for the app's currently selected root.
 * If the selected root differs from the song's key the chords are transposed,
 * so the gestures shown are always correct for what the user actually has set.
 */
export function translateSong(song, appRoot) {
  const appRootPc = typeof appRoot === 'number' ? appRoot : pitchClassOf(appRoot);
  const songRootPc = pitchClassOf(song.key);
  const shift = ((appRootPc - songRootPc) % 12 + 12) % 12;
  const transposed = shift !== 0;
  const preferFlats = /b/.test(spellPitchClass(appRootPc, true)) && [1, 3, 6, 8, 10].includes(appRootPc);

  const sections = song.sections.map((section) => ({
    name: section.name,
    chords: section.chords.map((original) => {
      const played = transposed ? transposeSymbol(original, shift, preferFlats) : original;
      return { original, played, transposed, ...translateChord(played, appRootPc) };
    }),
  }));

  const allChords = sections.flatMap((s) => s.chords);

  return {
    song,
    transposed,
    shift,
    appRootLabel: spellPitchClass(appRootPc, preferFlats),
    sections,
    exactCount: allChords.filter((c) => c.exact).length,
    totalCount: allChords.length,
  };
}
