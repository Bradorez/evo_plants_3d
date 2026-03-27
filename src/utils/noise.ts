import { lerp, smoothstep } from "./math";
import { mixSeed } from "./random";

/**
 * Deterministic value noise is sufficient for a starter terrain system.
 * It is cheap to evaluate, stable across browsers, and produces a coherent
 * procedural field that future systems like erosion can build upon.
 */
function hash2D(x: number, y: number, seed: number): number {
  let value = mixSeed(seed + Math.imul(x, 374761393) + Math.imul(y, 668265263));
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

export function valueNoise2D(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const tx = smoothstep(0, 1, x - x0);
  const ty = smoothstep(0, 1, y - y0);

  const n00 = hash2D(x0, y0, seed);
  const n10 = hash2D(x1, y0, seed);
  const n01 = hash2D(x0, y1, seed);
  const n11 = hash2D(x1, y1, seed);

  const nx0 = lerp(n00, n10, tx);
  const nx1 = lerp(n01, n11, tx);

  return lerp(nx0, nx1, ty);
}

export function fbm2D(
  x: number,
  y: number,
  seed: number,
  octaves = 5,
  lacunarity = 2,
  gain = 0.5,
): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let amplitudeSum = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise2D(x * frequency, y * frequency, seed + octave * 1013) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return amplitudeSum > 0 ? sum / amplitudeSum : 0;
}

export function ridgeNoise2D(x: number, y: number, seed: number, octaves = 4): number {
  return 1 - Math.abs(2 * fbm2D(x, y, seed, octaves) - 1);
}
