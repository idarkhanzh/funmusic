/**
 * gestures.js — turn 21 raw MediaPipe hand landmarks into musical intent.
 *
 * MediaPipe only gives us landmark coordinates; every notion of "finger is
 * extended", "hand is tilted inward" or "thumb is tucked" is computed here
 * from joint angles and distances.
 *
 * COORDINATE SPACE: callers pass landmarks already converted to *display*
 * space (x mirrored, x scaled by the video aspect ratio). That means left/right
 * and tilt direction match what the user sees on screen, which is what makes
 * the gestures feel right.
 */

// Landmark indices, per the MediaPipe hand model.
const JOINTS = {
  thumb: { mcp: 2, pip: 3, tip: 4 },
  index: { mcp: 5, pip: 6, tip: 8 },
  middle: { mcp: 9, pip: 10, tip: 12 },
  ring: { mcp: 13, pip: 14, tip: 16 },
  pinky: { mcp: 17, pip: 18, tip: 20 },
};

const WRIST = 0;
const MIDDLE_MCP = 9;
const INDEX_MCP = 5;

// Hysteresis bands: a finger must pass EXTEND to count as open, and drop below
// CURL to count as closed. The gap stops readings flickering on the boundary.
const EXTEND_DEG = 152;
const CURL_DEG = 125;

// Thumb "out" is measured as tip->index-knuckle distance over palm size.
const THUMB_OUT = 0.72;
const THUMB_IN = 0.58;

// Tilt band, in radians, for the left hand's major/minor switch.
const TILT_ON = 0.16;
const TILT_OFF = 0.06;

/** Convert MediaPipe normalised landmarks into aspect-corrected display space. */
export function toDisplaySpace(landmarks, aspect) {
  return landmarks.map((p) => ({ x: (1 - p.x) * aspect, y: p.y }));
}

function angleDeg(a, b, c) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-6 || m2 < 1e-6) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * 180) / Math.PI;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Per-hand state that needs to persist across frames (hysteresis latches).
 * One instance per hand so the two hands never interfere.
 */
export class HandInterpreter {
  constructor(side /* 'left' | 'right' */) {
    this.side = side;
    this.fingers = { thumb: false, index: false, middle: false, ring: false, pinky: false };
    this.tiltInward = true;
    this.smoothTilt = 0;
    this.smoothHeight = 0.5;
    this.initialised = false;
  }

  reset() {
    this.initialised = false;
  }

  /** @param {{x:number,y:number}[]} lm landmarks in display space */
  update(lm) {
    const palm = dist(lm[WRIST], lm[MIDDLE_MCP]) || 1e-6;

    // --- finger extension, from the PIP joint angle, with hysteresis ---
    for (const name of ['index', 'middle', 'ring', 'pinky']) {
      const j = JOINTS[name];
      const a = angleDeg(lm[j.mcp], lm[j.pip], lm[j.tip]);
      if (a >= EXTEND_DEG) this.fingers[name] = true;
      else if (a <= CURL_DEG) this.fingers[name] = false;
    }

    // --- thumb: abduction away from the index knuckle, normalised by palm ---
    const thumbSpread = dist(lm[JOINTS.thumb.tip], lm[INDEX_MCP]) / palm;
    if (thumbSpread >= THUMB_OUT) this.fingers.thumb = true;
    else if (thumbSpread <= THUMB_IN) this.fingers.thumb = false;

    // --- palm tilt: wrist -> middle knuckle, relative to straight up ---
    const vx = lm[MIDDLE_MCP].x - lm[WRIST].x;
    const vy = lm[MIDDLE_MCP].y - lm[WRIST].y;
    // 0 rad = pointing up; positive = leaning right on screen.
    const rawTilt = Math.atan2(vx, -vy);
    // "Inward" means toward the centre of the frame, so it flips per hand.
    const inward = this.side === 'left' ? rawTilt : -rawTilt;

    // --- hand height: wrist y, 0 at the top of the frame ---
    const height = 1 - Math.min(1, Math.max(0, lm[WRIST].y));

    if (!this.initialised) {
      this.smoothTilt = inward;
      this.smoothHeight = height;
      this.initialised = true;
    } else {
      this.smoothTilt += (inward - this.smoothTilt) * 0.25;
      this.smoothHeight += (height - this.smoothHeight) * 0.2;
    }

    if (this.smoothTilt > TILT_ON) this.tiltInward = true;
    else if (this.smoothTilt < -TILT_ON) this.tiltInward = false;
    else if (Math.abs(this.smoothTilt) < TILT_OFF) {
      // Near-vertical: hold whatever we last latched. No change.
    }

    return {
      fingers: { ...this.fingers },
      count: countFingers(this.fingers),
      thumbOut: this.fingers.thumb,
      tilt: this.smoothTilt,
      tiltInward: this.tiltInward,
      height: this.smoothHeight,
      thumbSpread,
    };
  }
}

function countFingers(f) {
  return ['thumb', 'index', 'middle', 'ring', 'pinky'].reduce((n, k) => n + (f[k] ? 1 : 0), 0);
}

/**
 * LEFT HAND -> scale + degree.
 *   tilt inward  = major scale, outward = minor scale
 *   1..5 fingers = degrees I..V
 *   index + pinky         = VI
 *   index + pinky + thumb = VII
 * A closed fist means "no chord" — it is how you stop the sound.
 *
 * The two combination gestures are tested first: index+pinky is also two
 * extended fingers, so plain counting would otherwise swallow it.
 */
export function readLeftHand(state) {
  const f = state.fingers;
  const mode = state.tiltInward ? 'major' : 'minor';

  const comboShape = f.index && f.pinky && !f.middle && !f.ring;
  if (comboShape) {
    return { mode, degree: f.thumb ? 7 : 6, gesture: f.thumb ? 'index+pinky+thumb' : 'index+pinky' };
  }

  const count = state.count;
  if (count === 0) return { mode, degree: 0, gesture: 'fist (silent)' };
  return { mode, degree: Math.min(5, count), gesture: `${count} finger${count === 1 ? '' : 's'}` };
}

/**
 * RIGHT HAND -> voicing + expression.
 *   1..4 extended fingers (thumb excluded) = chord quality / inversion
 *   thumb out = octave up, thumb tucked = octave down
 *   tilt inward = more lowpass filtering, outward = less
 *   hand height = volume
 */
export function readRightHand(state) {
  const f = state.fingers;
  const quality = Math.max(1, Math.min(4,
    (f.index ? 1 : 0) + (f.middle ? 1 : 0) + (f.ring ? 1 : 0) + (f.pinky ? 1 : 0)));

  // Tilt maps across roughly +/- 50 degrees onto a 0..1 filter amount, where
  // 1 = maximum lowpass (darkest) and 0 = wide open.
  const span = 0.9;
  const filter = Math.min(1, Math.max(0, (state.tilt + span) / (2 * span)));

  return {
    quality,
    octaveUp: state.thumbOut,
    filter,
    volume: Math.min(1, Math.max(0, (state.height - 0.1) / 0.75)),
  };
}
