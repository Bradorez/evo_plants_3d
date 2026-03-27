/**
 * Shared scalar helpers keep small numerical operations readable throughout the
 * simulation and rendering code without pulling unrelated responsibilities into
 * the domain modules themselves.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function inverseLerp(min: number, max: number, value: number): number {
  if (Math.abs(max - min) < 1e-8) {
    return 0;
  }

  return clamp((value - min) / (max - min), 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = inverseLerp(edge0, edge1, value);
  return t * t * (3 - 2 * t);
}
