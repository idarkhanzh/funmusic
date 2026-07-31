/**
 * Copies the MediaPipe WASM runtime out of node_modules and downloads the
 * HandLandmarker model into public/, so the deployed app serves both itself
 * instead of hitting a third-party CDN at runtime.
 *
 * Runs automatically via the `predev` and `prebuild` npm scripts. Both outputs
 * are gitignored — they are build inputs, not source.
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const WASM_SRC = resolve(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm');
const WASM_DEST = resolve(ROOT, 'public/mediapipe/wasm');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODEL_DEST = resolve(ROOT, 'public/models/hand_landmarker.task');
const MODEL_MIN_BYTES = 1_000_000; // a truncated download should not be trusted

async function copyWasm() {
  if (!existsSync(WASM_SRC)) {
    throw new Error(
      `Could not find ${WASM_SRC}. Run "npm install" before building.`
    );
  }
  await mkdir(dirname(WASM_DEST), { recursive: true });
  await cp(WASM_SRC, WASM_DEST, { recursive: true });
  console.log('✓ MediaPipe WASM runtime copied to public/mediapipe/wasm');
}

async function fetchModel() {
  if (existsSync(MODEL_DEST)) {
    const { size } = await stat(MODEL_DEST);
    if (size >= MODEL_MIN_BYTES) {
      console.log(`✓ HandLandmarker model already present (${(size / 1e6).toFixed(1)} MB)`);
      return;
    }
    console.warn('! Existing model file looks truncated — re-downloading.');
  }

  console.log('… downloading HandLandmarker model');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: ${res.status} ${res.statusText}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < MODEL_MIN_BYTES) {
    throw new Error(`Model download was only ${buf.byteLength} bytes — aborting.`);
  }

  await mkdir(dirname(MODEL_DEST), { recursive: true });
  await writeFile(MODEL_DEST, buf);
  console.log(`✓ HandLandmarker model saved (${(buf.byteLength / 1e6).toFixed(1)} MB)`);
}

await copyWasm();
await fetchModel();
