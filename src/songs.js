/**
 * songs.js — song reference data for the "How to Play" tab.
 *
 * DELIBERATELY NO LYRICS. Chord names, keys, tempo and section structure only.
 * Lyrics are copyrighted; chord progressions and song structure are what you
 * actually need in order to play along, so that is all this file carries.
 *
 * To add a song, append an entry with the same shape. The gesture translation
 * in songTranslate.js is computed at runtime, so nothing else needs editing.
 *
 *   {
 *     id, title, artist,
 *     key: 'G', mode: 'major',   // the key the chord names below are written in
 *     bpm, meter,
 *     keyNote: string | null,    // e.g. recorded key vs. common playing key
 *     structureNote: string | null,
 *     sections: [{ name, chords: ['G', 'Em', ...] }],
 *     sources: [{ label, url }]
 *   }
 */

export const SONGS = [
  {
    id: 'perfect',
    title: 'Perfect',
    artist: 'Ed Sheeran',
    key: 'G',
    mode: 'major',
    bpm: 63,
    meter: '12/8',
    keyNote:
      'Recorded in A♭ major. Almost every published chart writes it in G major with a capo on fret 1, so the chords below are in G — that is also the root to pick in setup.',
    structureNote:
      'One chord per bar throughout. The verse is I–vi–IV–V; the chorus rotates the same four chords to vi–IV–I–V.',
    sections: [
      { name: 'Intro', chords: ['G'] },
      { name: 'Verse', chords: ['G', 'Em', 'C', 'D'] },
      { name: 'Pre-Chorus', chords: ['G', 'Em', 'C', 'D'] },
      { name: 'Chorus', chords: ['Em', 'C', 'G', 'D'] },
      { name: 'Interlude', chords: ['G', 'Em', 'C', 'D'] },
      { name: 'Outro', chords: ['G', 'C', 'D'] },
    ],
    sources: [
      { label: 'Ultimate Guitar', url: 'https://tabs.ultimate-guitar.com/tab/ed-sheeran/perfect-chords-1956589' },
      { label: 'Lauren Bateman chord chart', url: 'https://www.laurenbateman.com/perfect-chord-chart/' },
    ],
  },

  {
    id: 'creep',
    title: 'Creep',
    artist: 'Radiohead',
    key: 'G',
    mode: 'major',
    bpm: 92,
    meter: '4/4',
    keyNote: 'G major, though two of the four chords deliberately step outside it.',
    structureNote:
      'A single four-bar loop — one bar per chord — runs unchanged through the intro, verses, choruses and bridge. The whole song is this one progression.',
    sections: [
      { name: 'Intro', chords: ['G', 'B', 'C', 'Cm'] },
      { name: 'Verse', chords: ['G', 'B', 'C', 'Cm'] },
      { name: 'Chorus', chords: ['G', 'B', 'C', 'Cm'] },
      { name: 'Bridge', chords: ['G', 'B', 'C', 'Cm'] },
    ],
    sources: [
      { label: 'Ultimate Guitar', url: 'https://tabs.ultimate-guitar.com/tab/radiohead/creep-chords-4169' },
      { label: 'UkuTabs', url: 'https://ukutabs.com/r/radiohead/creep/' },
    ],
  },

  {
    id: 'let-down',
    title: 'Let Down',
    artist: 'Radiohead',
    key: 'A',
    mode: 'major',
    bpm: 107,
    meter: '5/4 (verse), 4/4 (chorus)',
    keyNote:
      'A major. Jonny Greenwood plays his guitar part in a different metre from the rest of the band, which is where the phasing comes from — it does not change the harmony.',
    structureNote:
      'Harmonically the most straightforward of the three: every chord is diatonic to A major. The sus and slash chords are voicing colours on top of plain triads.',
    sections: [
      { name: 'Intro', chords: ['A'] },
      { name: 'Verse', chords: ['A', 'E', 'F#m', 'E'] },
      { name: 'Chorus', chords: ['D', 'Dsus2', 'A', 'D/F#', 'E'] },
      { name: 'Bridge / Outro', chords: ['Asus4', 'A'] },
    ],
    sources: [
      { label: 'Tab Fan', url: 'https://www.tabfan.com/en/radiohead/let-down/ok-computer' },
      { label: 'Guitar Tabs Explorer', url: 'https://www.guitartabsexplorer.com/radiohead-Tabs/let-down-crd.php' },
    ],
  },
];
