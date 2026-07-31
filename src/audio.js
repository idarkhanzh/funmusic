/**
 * audio.js — native Web Audio synth. No libraries.
 *
 * Signal path:
 *   voices -> voiceBus -> lowpass BiquadFilter (preset tone)
 *          -> WaveShaper (right-hand tilt drives this) -> makeup GainNode
 *          -> master GainNode (volume) -> DynamicsCompressor -> destination
 *
 * Voices are diffed on chord change: a note that is present in both the old
 * and new chord keeps ringing instead of being retriggered, which is what
 * makes moving between inversions sound like a chord change rather than a stab.
 */

export const PRESETS = {
  warm: {
    label: 'Warm Synth',
    blurb: 'Sines and triangle, soft attack, gentle filter.',
    oscs: [
      { type: 'sine', detune: 0, gain: 1.0 },
      { type: 'triangle', detune: 7, gain: 0.55 },
      { type: 'sine', detune: -7, gain: 0.35 },
    ],
    q: 0.8,
    cutoff: 1900,
    drive: 0.8, // how hard the tilt gesture pushes the waveshaper
    attack: 0.12,
    release: 0.3,
    level: 0.5,
  },
  bright: {
    label: 'Bright Synth',
    blurb: 'Stacked detuned saws, fast attack, wide-open filter.',
    oscs: [
      { type: 'sawtooth', detune: 0, gain: 0.7 },
      { type: 'sawtooth', detune: 11, gain: 0.5 },
      { type: 'square', detune: -11, gain: 0.22 },
    ],
    q: 3.2,
    cutoff: 4500,
    drive: 1.0,
    attack: 0.015,
    release: 0.18,
    level: 0.34,
  },
  retro: {
    label: 'Retro Synth',
    blurb: 'Squares plus a sub octave, heavy resonance, narrow range.',
    oscs: [
      { type: 'square', detune: 0, gain: 0.6 },
      { type: 'square', detune: -1200, gain: 0.42 },
      { type: 'sawtooth', detune: 6, gain: 0.25 },
    ],
    q: 9,
    cutoff: 1600,
    drive: 1.25,
    attack: 0.008,
    release: 0.12,
    level: 0.32,
  },
};

const KEY_OF = (f) => Math.round(f * 10); // frequency identity for voice diffing

/**
 * Typical signal amplitude spread, as a fraction of full scale. Musical
 * material sits well below peak most of the time (crest factor ~3), so the
 * makeup gain is estimated under this weighting rather than over a uniform
 * sweep of x — a soft-clip curve applies most of its gain to small samples,
 * which a uniform estimate badly underestimates.
 */
const SIGNAL_SIGMA = 0.3;

/**
 * Soft-clipping transfer curve. `amount` 0..1 maps to increasing drive.
 *
 * The shaped curve is normalised to unit peak, then crossfaded against the
 * identity line by `amount` so that amount->0 rejoins clean bypass smoothly;
 * without that the first touch of the gesture produces an audible jump.
 *
 * Returns the curve plus its RMS gain on a typical signal, which is what the
 * makeup gain divides out.
 */
function makeDistortionCurve(amount, drive = 1) {
  const k = amount * drive * 110;
  const n = 1024;
  const shaped = new Float32Array(n);
  let peak = 0;

  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    const y = ((3 + k) * x) / (1 + k * Math.abs(x));
    shaped[i] = y;
    if (Math.abs(y) > peak) peak = Math.abs(y);
  }

  const curve = new Float32Array(n);
  let sumSq = 0;
  let refSq = 0;
  let sumW = 0;

  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    const norm = peak > 0 ? shaped[i] / peak : x;
    const y = x * (1 - amount) + norm * amount;
    curve[i] = y;

    const w = Math.exp(-(x * x) / (2 * SIGNAL_SIGMA * SIGNAL_SIGMA));
    sumSq += w * y * y;
    refSq += w * x * x;
    sumW += w;
  }

  return {
    curve,
    rmsGain: Math.sqrt(sumSq / sumW),
    referenceRms: Math.sqrt(refSq / sumW),
  };
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.presetName = 'warm';
    this.preset = PRESETS.warm;
    this.voices = new Map(); // key -> { gain, oscs, freq }
    this.distortion = 0;
    this.volume = 0.7;
    this.running = false;
    this.offline = false;
  }

  get ready() {
    return this.running && this.ctx && this.ctx.state === 'running';
  }

  /**
   * Must be called from a user gesture — browsers block audio otherwise.
   *
   * @param {BaseAudioContext} [externalCtx] supply an OfflineAudioContext to
   *   render the graph headlessly; rendering is then the caller's business and
   *   we never touch resume().
   */
  async start(externalCtx = null) {
    if (this.ctx) {
      if (!this.offline && this.ctx.state === 'suspended') await this.ctx.resume();
      this.running = true;
      return;
    }
    if (externalCtx) {
      this.ctx = externalCtx;
      this.offline = true;
    } else {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.offline = false;
    }

    this.voiceBus = this.ctx.createGain();
    this.voiceBus.gain.value = 1;

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = this.preset.q;
    this.filter.frequency.value = this.preset.cutoff;

    this.shaper = this.ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.shaper.curve = null; // null == clean bypass

    this.makeup = this.ctx.createGain();
    this.makeup.gain.value = 1;

    this.master = this.ctx.createGain();
    this.master.gain.value = 0;

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;

    this.voiceBus.connect(this.filter);
    this.filter.connect(this.shaper);
    this.shaper.connect(this.makeup);
    this.makeup.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    if (!this.offline) await this.ctx.resume();
    this.running = true;
    this.setVolume(this.volume);
  }

  setPreset(name) {
    if (!PRESETS[name]) return;
    this.presetName = name;
    this.preset = PRESETS[name];
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.filter.Q.setTargetAtTime(this.preset.q, t, 0.03);
    this.filter.frequency.setTargetAtTime(this.preset.cutoff, t, 0.03);
    this._applyDistortion(this.distortion, true);
    // Existing voices keep their old waveforms; retrigger so the change is heard.
    const freqs = [...this.voices.values()].map((v) => v.freq);
    this.releaseAll();
    if (freqs.length) this.setChord(freqs);
  }

  /** 0 = clean, 1 = fully driven. Rebuilding the curve is cheap but not free,
   *  so we only regenerate it when the amount moves perceptibly. */
  setDistortion(amount) {
    const a = Math.min(1, Math.max(0, amount));
    if (Math.abs(a - this.distortion) < 0.01) return;
    this.distortion = a;
    this._applyDistortion(a);
  }

  _applyDistortion(a, force = false) {
    if (!this.ctx) return;

    let makeup = 1;
    if (a < 0.01) {
      this.shaper.curve = null; // clean bypass
    } else {
      const { curve, rmsGain, referenceRms } = makeDistortionCurve(a, this.preset.drive);
      this.shaper.curve = curve;
      // Undo the level the curve added, so sweeping drive changes timbre
      // rather than volume. Floored so it can never become a huge boost.
      makeup = Math.max(0.15, Math.min(1, referenceRms / rmsGain));
    }
    this.makeup.gain.setTargetAtTime(makeup, this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (!this.ctx) return;
    // Perceptual curve — linear gain feels top-heavy.
    const g = Math.pow(this.volume, 1.6) * 0.9;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
  }

  /** Replace the sounding chord with `freqs` (Hz). Pass [] for silence. */
  setChord(freqs) {
    if (!this.ctx) return;
    const wanted = new Map();
    for (const f of freqs) wanted.set(KEY_OF(f), f);

    for (const [key, voice] of this.voices) {
      if (!wanted.has(key)) this._releaseVoice(key, voice);
    }

    const total = Math.max(1, wanted.size);
    for (const [key, freq] of wanted) {
      if (this.voices.has(key)) continue;
      this._startVoice(key, freq, total);
    }

    // Rebalance held voices so chord density doesn't change the loudness.
    const perVoice = this._voiceLevel(total);
    const t = this.ctx.currentTime;
    for (const voice of this.voices.values()) {
      voice.gain.gain.setTargetAtTime(perVoice, t, 0.05);
    }
  }

  _voiceLevel(count) {
    return this.preset.level / Math.sqrt(count);
  }

  _startVoice(key, freq, total) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.connect(this.voiceBus);

    const oscs = this.preset.oscs.map((spec) => {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.frequency.setValueAtTime(freq, t);
      osc.detune.setValueAtTime(spec.detune, t);
      const og = ctx.createGain();
      og.gain.value = spec.gain;
      osc.connect(og);
      og.connect(gain);
      osc.start(t);
      return osc;
    });

    gain.gain.linearRampToValueAtTime(this._voiceLevel(total), t + this.preset.attack);
    this.voices.set(key, { gain, oscs, freq });
  }

  _releaseVoice(key, voice) {
    const t = this.ctx.currentTime;
    const rel = this.preset.release;
    this.voices.delete(key);
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), t);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + rel);
    for (const osc of voice.oscs) osc.stop(t + rel + 0.05);
    setTimeout(() => {
      try {
        voice.gain.disconnect();
      } catch {
        /* already torn down */
      }
    }, (rel + 0.2) * 1000);
  }

  releaseAll() {
    for (const [key, voice] of [...this.voices]) this._releaseVoice(key, voice);
  }

  async suspend() {
    this.releaseAll();
    this.running = false;
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }
}
