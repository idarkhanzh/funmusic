/**
 * tracking.js — webcam capture + MediaPipe HandLandmarker.
 *
 * The WASM runtime and the .task model are served from /public (see
 * scripts/prepare-assets.mjs) so the app makes no third-party requests at
 * runtime and works offline once loaded.
 */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL || '/';
const WASM_PATH = `${BASE}mediapipe/wasm`;
const MODEL_PATH = `${BASE}models/hand_landmarker.task`;

export async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);

  const options = {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };

  try {
    return await HandLandmarker.createFromOptions(fileset, options);
  } catch (err) {
    // Some machines have no usable WebGL context; CPU still runs fine at 30fps.
    console.warn('GPU delegate unavailable, falling back to CPU.', err);
    options.baseOptions.delegate = 'CPU';
    return await HandLandmarker.createFromOptions(fileset, options);
  }
}

export async function startCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: 'user' },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  // Metadata can lag the play() resolution on Safari.
  if (!videoEl.videoWidth) {
    await new Promise((resolve) => videoEl.addEventListener('loadeddata', resolve, { once: true }));
  }
  return stream;
}

export function stopCamera(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

/**
 * Drive `onFrame(result, video)` once per video frame.
 * Returns a stop function.
 */
export function runDetectionLoop(landmarker, video, onFrame) {
  let stopped = false;
  let lastTimestamp = -1;

  const tick = () => {
    if (stopped) return;

    if (video.readyState >= 2 && video.videoWidth > 0) {
      // detectForVideo requires strictly increasing timestamps.
      let ts = performance.now();
      if (ts <= lastTimestamp) ts = lastTimestamp + 1;
      lastTimestamp = ts;
      try {
        const result = landmarker.detectForVideo(video, ts);
        onFrame(result, video);
      } catch (err) {
        console.error('Hand detection failed for this frame.', err);
      }
    }

    schedule();
  };

  const schedule = () => {
    if (stopped) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(tick);
    } else {
      requestAnimationFrame(tick);
    }
  };

  schedule();
  return () => {
    stopped = true;
  };
}

/** Draw the hand skeleton. Landmarks arrive already in display space. */
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export function drawHand(ctx, points, aspect, color) {
  const { width, height } = ctx.canvas;
  const px = (p) => [(p.x / aspect) * width, p.y * height];

  ctx.lineWidth = Math.max(2, width / 320);
  ctx.strokeStyle = color;
  ctx.beginPath();
  for (const [a, b] of BONES) {
    const [x1, y1] = px(points[a]);
    const [x2, y2] = px(points[b]);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();

  ctx.fillStyle = color;
  const r = Math.max(2.5, width / 260);
  for (const p of points) {
    const [x, y] = px(p);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
