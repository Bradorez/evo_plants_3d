import { clamp } from "../utils/math";
import { fbm2D } from "../utils/noise";
import type { Grid } from "./Grid";

export interface RegionalClimateSettings {
  meanTemperatureGradientStrength: number;
  rainfallGradientStrength: number;
  seasonalAmplitudeVariation: number;
  evaporationGradientStrength: number;
  gradientNoiseScale: number;
  gradientNoiseStrength: number;
}

/**
 * RegionalClimateModel generates broad, smoothly blended long-term climate
 * fields. Unlike the seasonal model, these values do not oscillate over time.
 * They provide the stable environmental backdrop that makes one part of the
 * map warmer, drier, wetter, or more seasonal than another.
 */
export class RegionalClimateModel {
  public readonly settings: RegionalClimateSettings = {
    meanTemperatureGradientStrength: 0.12,
    rainfallGradientStrength: 0.42,
    seasonalAmplitudeVariation: 0.34,
    evaporationGradientStrength: 0.32,
    gradientNoiseScale: 1.35,
    gradientNoiseStrength: 0.28,
  };

  private meanTemperatureBias = new Float32Array();
  private rainfallBaseline = new Float32Array();
  private seasonalAmplitude = new Float32Array();
  private evaporationPressure = new Float32Array();

  public rebuild(grid: Grid, seed: number): void {
    this.meanTemperatureBias = new Float32Array(grid.cellCount);
    this.rainfallBaseline = new Float32Array(grid.cellCount);
    this.seasonalAmplitude = new Float32Array(grid.cellCount);
    this.evaporationPressure = new Float32Array(grid.cellCount);

    const invWidth = 1 / Math.max(grid.width - 1, 1);
    const invHeight = 1 / Math.max(grid.height - 1, 1);

    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const index = grid.index(x, y);
        const nx = x * invWidth;
        const ny = y * invHeight;
        const meridional = ny * 2 - 1;
        const zonal = nx * 2 - 1;
        const broadNoise =
          fbm2D(
            nx * this.settings.gradientNoiseScale + 13.7,
            ny * this.settings.gradientNoiseScale - 7.9,
            seed + 991,
            3,
            2,
            0.55,
          ) - 0.5;
        const humidityNoise =
          fbm2D(
            nx * (this.settings.gradientNoiseScale * 0.82) - 11.4,
            ny * (this.settings.gradientNoiseScale * 0.82) + 5.2,
            seed + 1777,
            3,
            2,
            0.58,
          ) - 0.5;

        const warmBias =
          meridional * 0.74 -
          zonal * 0.16 +
          broadNoise * this.settings.gradientNoiseStrength;
        const wetBias =
          -zonal * 0.46 -
          meridional * 0.12 +
          humidityNoise * (this.settings.gradientNoiseStrength + 0.08);
        const drynessBias = clamp((1 - (wetBias + 1) * 0.5) + Math.max(0, warmBias) * 0.24, 0, 1);

        this.meanTemperatureBias[index] = clamp(
          warmBias * this.settings.meanTemperatureGradientStrength,
          -0.18,
          0.18,
        );
        this.rainfallBaseline[index] = clamp(
          1 + wetBias * this.settings.rainfallGradientStrength,
          0.5,
          1.7,
        );
        this.seasonalAmplitude[index] = clamp(
          1 +
            (
              Math.abs(meridional) * 0.34 +
              drynessBias * 0.3 -
              wetBias * 0.12 +
              Math.abs(broadNoise) * 0.14
            ) *
              this.settings.seasonalAmplitudeVariation,
          0.72,
          1.48,
        );
        this.evaporationPressure[index] = clamp(
          1 +
            (
              Math.max(0, warmBias) * 0.42 +
              drynessBias * 0.36 -
              wetBias * 0.18 +
              Math.abs(humidityNoise) * 0.1
            ) *
              this.settings.evaporationGradientStrength,
          0.7,
          1.55,
        );
      }
    }
  }

  public getMeanTemperatureBias(): Float32Array {
    return this.meanTemperatureBias;
  }

  public getRainfallBaseline(): Float32Array {
    return this.rainfallBaseline;
  }

  public getSeasonalAmplitude(): Float32Array {
    return this.seasonalAmplitude;
  }

  public getEvaporationPressure(): Float32Array {
    return this.evaporationPressure;
  }
}
