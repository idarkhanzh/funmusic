/**
 * songsPanel.js — renders the "How to Play" tab.
 *
 * Chord names, keys, tempo and structure only. No lyrics — see songs.js.
 */

import { SONGS } from './songs.js';
import { translateSong } from './songTranslate.js';
import { spellPitchClass, pitchClassOf } from './theory.js';

const el = (tag, className, text) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
};

/**
 * @param {HTMLElement} container
 * @param {() => number} getRootPc      current app root, as a pitch class
 * @param {(pc:number) => void} setRootPc
 */
export function renderSongsPanel(container, getRootPc, setRootPc) {
  const rootPc = getRootPc();
  container.replaceChildren();

  const intro = el('p', 'songs-intro');
  intro.append(
    'Each chord below is translated into the gestures that produce it. Translations follow ',
    (() => {
      const b = el('strong', null, `your selected root: ${spellPitchClass(rootPc)}`);
      return b;
    })(),
    ' — switch a song to its own key with the button on its card to match the published chord names.'
  );
  container.append(intro);

  for (const song of SONGS) {
    container.append(renderSong(song, rootPc, setRootPc));
  }

  const foot = el('p', 'songs-foot');
  foot.textContent =
    'Chord names, keys, tempos and section structure only — this app contains no lyrics.';
  container.append(foot);
}

function renderSong(song, rootPc, setRootPc) {
  const data = translateSong(song, rootPc);
  const card = el('article', 'song-card');

  /* --- header --- */
  const head = el('header', 'song-head');
  const titleWrap = el('div');
  titleWrap.append(el('h3', 'song-title', song.title));
  titleWrap.append(el('p', 'song-artist', song.artist));
  head.append(titleWrap);

  const badges = el('div', 'song-badges');
  badges.append(el('span', 'badge', `Key: ${song.key} ${song.mode}`));
  if (song.bpm) badges.append(el('span', 'badge', `${song.bpm} BPM`));
  if (song.meter) badges.append(el('span', 'badge', song.meter));
  badges.append(
    el('span', `badge ${data.exactCount === data.totalCount ? 'badge-ok' : 'badge-warn'}`,
      `${data.exactCount}/${data.totalCount} exact`)
  );
  head.append(badges);
  card.append(head);

  /* --- key / structure notes --- */
  if (song.keyNote) card.append(el('p', 'song-note', song.keyNote));
  if (song.structureNote) card.append(el('p', 'song-note', song.structureNote));

  /* --- transposition banner --- */
  if (data.transposed) {
    const banner = el('div', 'song-banner');
    banner.append(
      el('span', null,
        `Your root is ${data.appRootLabel}, this song is written in ${song.key}. ` +
        `Chords below are transposed into ${data.appRootLabel} so the gestures are correct for your current setting.`)
    );
    const btn = el('button', 'btn btn-small', `Switch root to ${song.key}`);
    btn.type = 'button';
    btn.addEventListener('click', () => setRootPc(pitchClassOf(song.key)));
    banner.append(btn);
    card.append(banner);
  } else {
    const banner = el('div', 'song-banner song-banner-ok');
    banner.append(el('span', null,
      `Your root is set to ${song.key} — the chord names below are the published ones.`));
    card.append(banner);
  }

  /* --- sections --- */
  for (const section of data.sections) {
    const sec = el('section', 'song-section');
    const h = el('div', 'section-head');
    h.append(el('h4', null, section.name));
    h.append(el('span', 'section-prog', section.chords.map((c) => c.played).join('  →  ')));
    sec.append(h);

    const grid = el('div', 'chord-grid');
    for (const chord of section.chords) grid.append(renderChord(chord));
    sec.append(grid);
    card.append(sec);
  }

  /* --- sources --- */
  if (song.sources?.length) {
    const src = el('p', 'song-sources');
    src.append(el('span', null, 'Chords referenced from: '));
    song.sources.forEach((s, i) => {
      if (i > 0) src.append(document.createTextNode(', '));
      const a = el('a', null, s.label);
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      src.append(a);
    });
    card.append(src);
  }

  return card;
}

function renderChord(chord) {
  const box = el('div', `chord-card ${chord.exact ? 'is-exact' : 'is-approx'}`);

  const top = el('div', 'chord-top');
  const name = el('span', 'chord-name', chord.played);
  top.append(name);
  if (chord.transposed && chord.original !== chord.played) {
    top.append(el('span', 'chord-orig', `(${chord.original} in original key)`));
  }
  box.append(top);

  if (chord.unplayable) {
    box.append(el('p', 'chord-note', chord.notes.join(' ')));
    return box;
  }

  const tag = el('span', `chord-tag ${chord.exact ? 'tag-exact' : 'tag-approx'}`,
    chord.exact ? 'exact' : 'approximate — nearest diatonic substitute');
  box.append(tag);

  const rows = el('dl', 'chord-rows');

  rows.append(el('dt', null, 'Left hand'));
  const ldd = el('dd');
  ldd.append(el('span', 'pill pill-left', chord.leftTiltLabel));
  ldd.append(el('span', 'pill pill-left', `${chord.leftFingersLabel} → ${chord.roman}`));
  rows.append(ldd);

  rows.append(el('dt', null, 'Right hand'));
  const rdd = el('dd');
  rdd.append(el('span', 'pill pill-right', chord.rightFingersLabel));
  rows.append(rdd);

  rows.append(el('dt', null, 'Sounds as'));
  rows.append(el('dd', null, chord.producedSymbol));

  box.append(rows);

  for (const note of chord.notes) {
    box.append(el('p', 'chord-note', note));
  }

  return box;
}
