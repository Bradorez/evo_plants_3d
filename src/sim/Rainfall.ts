import { clamp } from "../utils/math";
import { fbm2D } from "../utils/noise";
import { Grid } from "./Grid";

/**
 * Rainfall owns the external water source term for the simulation.
 * A mild spatial mask prevents the terrain from filling perfectly uniformly,
 * which helps channels emerge earlier and makes the water motion easier to read.
 */
export class RainfallModel {
  public readonly distribution: Float32Array;

  private intensity: number;

  public constructor(grid: Grid, seed: number, initialIntensity: number) {
    this.distribution = new Float32Array(grid.cellCount);
    this.intensity = initialIntensity;

    const invWidth = 1 / Math.max(grid.width - 1, 1);
    const invHeight = 1 / Math.max(grid.height - 1, 1);

    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const index = grid.index(x, y);
        const nx = x * invWidth;
        const ny = y * invHeight;
        const variation = fbm2D(nx * 4.2, ny * 4.2, seed + 911, 3, 2.1, 0.56);
        this.distribution[index] = 0.7 + variation * 0.6;
      }
    }
  }

  public setIntensity(intensity: number): void {
    this.intensity = clamp(intensity, 0, 2);
  }

  public getIntensity(): number {
    return this.intensity;
  }

  public apply(waterDepth: Float32Array, dtSeconds: number): number {
    if (this.intensity <= 0 || dtSeconds <= 0) {
      return 0;
    }

    let addedWater = 0;

    for (let index = 0; index < waterDepth.length; index += 1) {
      const amount = this.intensity * this.distribution[index] * dtSeconds * 0.02;
      waterDepth[index] += amount;
      addedWater += amount;
    }

    return addedWater;
  }
}
