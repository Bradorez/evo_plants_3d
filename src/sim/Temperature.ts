import { clamp, inverseLerp, lerp } from "../utils/math";
import { valueNoise2D } from "../utils/noise";
import type { TerrainData } from "./Terrain";

export interface TemperatureSettings {
  baseTemperature: number;
  elevationCoolingStrength: number;
  latitudinalGradientStrength: number;
  noiseStrength: number;
}

/**
 * TemperatureModel provides a stable environmental heat field shared by water
 * balance, ecological moisture, and plant fitness. The first version is
 * intentionally static and interpretable: broad heat is set by a map-wide base
 * temperature, large-scale gradients, and elevation cooling.
 */
export class TemperatureModel {
  public readonly settings: TemperatureSettings = {
    baseTemperature: 0.58,
    elevationCoolingStrength: 0.42,
    latitudinalGradientStrength: 0.1,
    noiseStrength: 0.06,
  };

  private readonly baseTemperature = new Float32Array();
  private readonly temperature = new Float32Array();

  public constructor(terrain: TerrainData) {
    this.baseTemperature = new Float32Array(terrain.grid.cellCount);
    this.temperature = new Float32Array(terrain.grid.cellCount);
    this.rebuild(terrain);
  }

  public getTemperature(): Float32Array {
    return this.temperature;
  }

  public applySeasonalOffset(offset: number): void {
    for (let index = 0; index < this.temperature.length; index += 1) {
      this.temperature[index] = clamp(this.baseTemperature[index] + offset, 0, 1);
    }
  }

  public applySeasonalOffsets(offsets: Float32Array): void {
    const count = Math.min(this.temperature.length, offsets.length);
    for (let index = 0; index < count; index += 1) {
      this.temperature[index] = clamp(this.baseTemperature[index] + offsets[index], 0, 1);
    }
  }

  public rebuild(terrain: TerrainData): void {
    const width = terrain.grid.width;
    const height = terrain.grid.height;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = terrain.grid.index(x, y);
        const elevation = inverseLerp(terrain.minHeight, terrain.maxHeight, terrain.heights[index]);
        const northSouth = height > 1 ? y / (height - 1) : 0.5;
        const latitudinalGradient = lerp(0.55, 1, northSouth);
        const noise = valueNoise2D(x * 0.05 + 14.3, y * 0.05 - 6.8, terrain.seed + 44021);

        const temperature =
          this.settings.baseTemperature +
          (latitudinalGradient - 0.75) * this.settings.latitudinalGradientStrength -
          elevation * this.settings.elevationCoolingStrength +
          (noise - 0.5) * this.settings.noiseStrength;

        this.baseTemperature[index] = clamp(temperature, 0, 1);
      }
    }

    this.applySeasonalOffset(0);
  }
}
