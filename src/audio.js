/**
 * audio.js — native Web Audio synth. No libraries.
 *
 * Signal path:
 *   voices -> voiceBus -> lowpass BiquadFilter -> master GainNode
 *          -> DynamicsCompressor (safety limiter) -> destination
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
    cutoffMax: 5200,
    cutoffMin: 180,
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
    cutoffMax: 14000,
    cutoffMin: 320,
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
    cutoffMax: 3400,
    cutoffMin: 260,
    attack: 0.008,
    release: 0.12,
    level: 0.32,
  },
};

const KEY_OF = (f) => Math.round(f * 10); // frequency identity for voice diffing

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.presetName = 'warm';
    this.preset = PRESETS.warm;
    this.voices = new Map(); // key -> { gain, oscs, freq }
    this.filterAmount = 0.35;
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
    this.filter.frequency.value = this._cutoff(this.filterAmount);

    this.master = this.ctx.createGain();
    this.master.gain.value = 0;

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;

    this.voiceBus.connect(this.filter);
    this.filter.connect(this.master);
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
    this.filter.frequency.setTargetAtTime(this._cutoff(this.filterAmount), t, 0.03);
    // Existing voices keep their old waveforms; retrigger so the change is heard.
    const freqs = [...this.voices.values()].map((v) => v.freq);
    this.releaseAll();
    if (freqs.length) this.setChord(freqs);
  }

  _cutoff(amount) {
    const { cutoffMin, cutoffMax } = this.preset;
    const a = Math.min(1, Math.max(0, amount));
    return cutoffMax * Math.pow(cutoffMin / cutoffMax, a);
  }

  /** 0 = filter wide open, 1 = maximum lowpass. */
  setFilterAmount(amount) {
    this.filterAmount = amount;
    if (!this.ctx) return;
    this.filter.frequency.setTargetAtTime(this._cutoff(amount), this.ctx.currentTime, 0.04);
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
