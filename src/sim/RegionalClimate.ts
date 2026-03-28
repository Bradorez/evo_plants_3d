import { clamp, lerp } from "../utils/math";
import { fbm2D } from "../utils/noise";
import type { Grid } from "./Grid";

export interface RegionalClimateSettings {
  meanTemperatureGradientStrength: number;
  rainfallGradientStrength: number;
  seasonalAmplitudeVariation: number;
  evaporationGradientStrength: number;
  gradientNoiseScale: number;
  gradientNoiseStrength: number;
  refugiaCount: number;
  refugiaRadius: number;
  refugiaBlendWidth: number;
  stabilityStrength: number;
  phaseLockStrength: number;
  refugeSeasonWindow: number;
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
    refugiaCount: 5,
    refugiaRadius: 0.11,
    refugiaBlendWidth: 0.08,
    stabilityStrength: 1,
    phaseLockStrength: 0.985,
    refugeSeasonWindow: 0.04,
  };

  private meanTemperatureBias = new Float32Array();
  private rainfallBaseline = new Float32Array();
  private seasonalAmplitude = new Float32Array();
  private evaporationPressure = new Float32Array();
  private climateStability = new Float32Array();
  private seasonalPhaseAnchor = new Float32Array();
  private seasonalPhaseWindow = new Float32Array();

  public rebuild(grid: Grid, seed: number): void {
    this.meanTemperatureBias = new Float32Array(grid.cellCount);
    this.rainfallBaseline = new Float32Array(grid.cellCount);
    this.seasonalAmplitude = new Float32Array(grid.cellCount);
    this.evaporationPressure = new Float32Array(grid.cellCount);
    this.climateStability = new Float32Array(grid.cellCount);
    this.seasonalPhaseAnchor = new Float32Array(grid.cellCount);
    this.seasonalPhaseWindow = new Float32Array(grid.cellCount);

    const invWidth = 1 / Math.max(grid.width - 1, 1);
    const invHeight = 1 / Math.max(grid.height - 1, 1);
    const refugia = this.createRefugia(seed);

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
        const refugeBlend = this.sampleRefugiaInfluence(refugia, nx, ny);
        const refugeStrength = clamp(
          Math.pow(refugeBlend.strength, 0.9) * this.settings.stabilityStrength,
          0,
          1,
        );

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
          0.02,
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

        if (refugeStrength > 0) {
          const refugeCoreStrength = Math.pow(refugeStrength, 1.08);
          this.meanTemperatureBias[index] = lerp(
            this.meanTemperatureBias[index],
            refugeBlend.temperatureAnchor,
            refugeCoreStrength * 0.8,
          );
          this.rainfallBaseline[index] = lerp(
            this.rainfallBaseline[index],
            refugeBlend.rainfallAnchor,
            refugeCoreStrength * 0.76,
          );
          this.seasonalAmplitude[index] = lerp(
            this.seasonalAmplitude[index],
            refugeBlend.seasonalAmplitudeAnchor,
            refugeCoreStrength,
          );
          this.evaporationPressure[index] = lerp(
            this.evaporationPressure[index],
            refugeBlend.evaporationAnchor,
            refugeCoreStrength * 0.78,
          );
        }

        this.climateStability[index] = refugeStrength;
        this.seasonalPhaseAnchor[index] = refugeBlend.phaseAnchor;
        this.seasonalPhaseWindow[index] = refugeBlend.phaseWindow;
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

  public getClimateStability(): Float32Array {
    return this.climateStability;
  }

  public getSeasonalPhaseAnchor(): Float32Array {
    return this.seasonalPhaseAnchor;
  }

  public getSeasonalPhaseWindow(): Float32Array {
    return this.seasonalPhaseWindow;
  }

  public getPhaseLockStrength(): number {
    return this.settings.phaseLockStrength;
  }

  private createRefugia(seed: number): ClimateRefugium[] {
    const refugia: ClimateRefugium[] = [];

    for (let index = 0; index < this.settings.refugiaCount; index += 1) {
      const centerX = lerp(0.16, 0.84, pseudoRandom(seed, index * 7 + 1));
      const centerY = lerp(0.16, 0.84, pseudoRandom(seed, index * 7 + 2));
      const radius =
        this.settings.refugiaRadius *
        lerp(0.9, 1.24, pseudoRandom(seed, index * 7 + 3));
      const blendWidth =
        this.settings.refugiaBlendWidth *
        lerp(0.86, 1.24, pseudoRandom(seed, index * 7 + 4));
      const temperatureAnchor = lerp(-0.09, 0.07, pseudoRandom(seed, index * 7 + 5));
      const rainfallAnchor = lerp(1.04, 1.42, pseudoRandom(seed, index * 7 + 6));
      const phaseAnchor = this.pickSeasonAnchor(seed, index);

      refugia.push({
        centerX,
        centerY,
        radius,
        blendWidth,
        temperatureAnchor,
        rainfallAnchor,
        // Refuge cores should feel close to climate-fixed rather than merely
        // "less seasonal", so their local amplitude is pushed toward near-zero.
        seasonalAmplitudeAnchor: lerp(0.0, 0.08, pseudoRandom(seed, index * 7 + 8)),
        evaporationAnchor: lerp(0.76, 1.0, pseudoRandom(seed, index * 7 + 9)),
        phaseAnchor,
        phaseWindow:
          this.settings.refugeSeasonWindow *
          lerp(0.82, 1.08, pseudoRandom(seed, index * 7 + 10)),
      });
    }

    return refugia;
  }

  private sampleRefugiaInfluence(
    refugia: readonly ClimateRefugium[],
    nx: number,
    ny: number,
  ): RefugiaBlendResult {
    let weightSum = 0;
    let maxStrength = 0;
    let temperatureAnchorSum = 0;
    let rainfallAnchorSum = 0;
    let seasonalAmplitudeAnchorSum = 0;
    let evaporationAnchorSum = 0;
    let phaseWindowSum = 0;
    let phaseVectorX = 0;
    let phaseVectorY = 0;

    for (const refugium of refugia) {
      const dx = nx - refugium.centerX;
      const dy = ny - refugium.centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const innerRadius = refugium.radius;
      const outerRadius = refugium.radius + refugium.blendWidth;

      if (distance >= outerRadius) {
        continue;
      }

      let strength = 0;
      if (distance <= innerRadius) {
        strength = 1;
      } else {
        const t = clamp((outerRadius - distance) / Math.max(refugium.blendWidth, 0.0001), 0, 1);
        strength = t * t * (3 - 2 * t);
      }

      weightSum += strength;
      maxStrength = Math.max(maxStrength, strength);
      temperatureAnchorSum += refugium.temperatureAnchor * strength;
      rainfallAnchorSum += refugium.rainfallAnchor * strength;
      seasonalAmplitudeAnchorSum += refugium.seasonalAmplitudeAnchor * strength;
      evaporationAnchorSum += refugium.evaporationAnchor * strength;
      phaseWindowSum += refugium.phaseWindow * strength;
      phaseVectorX += Math.cos(refugium.phaseAnchor * Math.PI * 2) * strength;
      phaseVectorY += Math.sin(refugium.phaseAnchor * Math.PI * 2) * strength;
    }

    if (weightSum <= 0) {
      return {
        strength: 0,
        temperatureAnchor: 0,
        rainfallAnchor: 1,
        seasonalAmplitudeAnchor: 1,
      evaporationAnchor: 1,
      phaseAnchor: 0,
      phaseWindow: this.settings.refugeSeasonWindow,
    };
  }

    const phaseAnchor =
      ((Math.atan2(phaseVectorY, phaseVectorX) / (Math.PI * 2)) % 1 + 1) % 1;

    return {
      strength: maxStrength,
      temperatureAnchor: temperatureAnchorSum / weightSum,
      rainfallAnchor: rainfallAnchorSum / weightSum,
      seasonalAmplitudeAnchor: seasonalAmplitudeAnchorSum / weightSum,
      evaporationAnchor: evaporationAnchorSum / weightSum,
      phaseAnchor,
      phaseWindow: phaseWindowSum / weightSum,
    };
  }

  private pickSeasonAnchor(seed: number, index: number): number {
    const seasonCenters = [0.125, 0.375, 0.625, 0.875];
    const slot = Math.floor(pseudoRandom(seed, index * 11 + 3) * seasonCenters.length) % seasonCenters.length;
    return seasonCenters[slot];
  }
}

interface ClimateRefugium {
  centerX: number;
  centerY: number;
  radius: number;
  blendWidth: number;
  temperatureAnchor: number;
  rainfallAnchor: number;
  seasonalAmplitudeAnchor: number;
  evaporationAnchor: number;
  phaseAnchor: number;
  phaseWindow: number;
}

interface RefugiaBlendResult {
  strength: number;
  temperatureAnchor: number;
  rainfallAnchor: number;
  seasonalAmplitudeAnchor: number;
  evaporationAnchor: number;
  phaseAnchor: number;
  phaseWindow: number;
}

function pseudoRandom(seed: number, salt: number): number {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453123;
  return value - Math.floor(value);
}
