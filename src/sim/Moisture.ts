import { clamp, lerp } from "../utils/math";
import type { TerrainData } from "./Terrain";
import type { RainfallModel } from "./Rainfall";

export interface MoistureSettings {
  rainfallToMoisture: number;
  waterToMoistureInfluence: number;
  nearbyWaterInfluence: number;
  channelMoistureInfluence: number;
  dryingRate: number;
  hotDryingSensitivity: number;
  drainageRate: number;
  moistureSmoothingStrength: number;
  persistentWetnessRise: number;
  persistentWetnessDecay: number;
  floodMemoryRise: number;
  floodMemoryDecay: number;
}

/**
 * MoistureModel provides a persistent ecological wetness layer that is
 * separate from visible surface water. It reacts to rainfall, flooding,
 * nearby water bodies, and drainage tendencies, but changes on a slower
 * ecology timescale than the hydrology solver.
 */
export class MoistureModel {
  public readonly settings: MoistureSettings = {
    rainfallToMoisture: 0.11,
    waterToMoistureInfluence: 0.38,
    nearbyWaterInfluence: 0.18,
    channelMoistureInfluence: 0.08,
    dryingRate: 0.018,
    hotDryingSensitivity: 0.9,
    drainageRate: 0.022,
    moistureSmoothingStrength: 0.22,
    persistentWetnessRise: 0.2,
    persistentWetnessDecay: 0.035,
    floodMemoryRise: 0.28,
    floodMemoryDecay: 0.05,
  };

  private readonly moisture = new Float32Array();
  private readonly nextMoisture = new Float32Array();
  private readonly persistentWetness = new Float32Array();
  private readonly floodProne = new Float32Array();
  private readonly waterSignal = new Float32Array();
  private readonly nearbyWater = new Float32Array();
  private readonly flowSignal = new Float32Array();
  private readonly blurredFlowSignal = new Float32Array();

  public constructor(cellCount: number) {
    this.moisture = new Float32Array(cellCount);
    this.nextMoisture = new Float32Array(cellCount);
    this.persistentWetness = new Float32Array(cellCount);
    this.floodProne = new Float32Array(cellCount);
    this.waterSignal = new Float32Array(cellCount);
    this.nearbyWater = new Float32Array(cellCount);
    this.flowSignal = new Float32Array(cellCount);
    this.blurredFlowSignal = new Float32Array(cellCount);
  }

  public getMoisture(): Float32Array {
    return this.moisture;
  }

  public getPersistentWetness(): Float32Array {
    return this.persistentWetness;
  }

  public getFloodProne(): Float32Array {
    return this.floodProne;
  }

  public reset(): void {
    this.moisture.fill(0);
    this.nextMoisture.fill(0);
    this.persistentWetness.fill(0);
    this.floodProne.fill(0);
    this.waterSignal.fill(0);
    this.nearbyWater.fill(0);
    this.flowSignal.fill(0);
    this.blurredFlowSignal.fill(0);
  }

  public step(
    terrain: TerrainData,
    rainfall: RainfallModel,
    waterDepth: Float32Array,
    temperature: Float32Array,
    flowAccumulation: Float32Array,
    flowIntensity: Float32Array,
    rainfallMultiplier: number,
    soilDryingMultiplier: number,
    dtSeconds: number,
  ): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return;
    }

    const maxFlowIntensity = this.getMaxValue(flowIntensity);
    const maxAccumulation = this.getMaxValue(flowAccumulation);
    const maxLogAccumulation = Math.max(1e-6, Math.log1p(maxAccumulation));

    for (let index = 0; index < terrain.grid.cellCount; index += 1) {
      const depth = waterDepth[index];
      const normalizedAccumulation =
        maxAccumulation > 0 ? Math.log1p(flowAccumulation[index]) / maxLogAccumulation : 0;
      const normalizedIntensity = maxFlowIntensity > 0 ? flowIntensity[index] / maxFlowIntensity : 0;
      this.waterSignal[index] = clamp((depth - 0.0008) / 0.05, 0, 1);
      this.flowSignal[index] = clamp(normalizedAccumulation * 0.65 + normalizedIntensity * 0.35, 0, 1);
    }

    this.blurScalarField(terrain, this.waterSignal, this.nearbyWater);
    this.blurScalarField(terrain, this.flowSignal, this.blurredFlowSignal);

    for (let y = 0; y < terrain.grid.height; y += 1) {
      for (let x = 0; x < terrain.grid.width; x += 1) {
        const index = terrain.grid.index(x, y);
        const localWater = this.waterSignal[index];
        const nearbyWater = this.nearbyWater[index];
        const nearbyChannel = this.blurredFlowSignal[index];
        const slope = this.sampleSlope(terrain, x, y);
        const basinFactor = this.sampleBasinFactor(terrain, x, y);
        const retention = clamp(0.34 + basinFactor * 0.48 + (1 - slope) * 0.18, 0.2, 1);
        const rainfallInput =
          rainfall.getIntensity() *
          clamp(rainfallMultiplier, 0.15, 2.25) *
          rainfall.distribution[index] *
          this.settings.rainfallToMoisture *
          retention *
          dtSeconds;
        const waterInput =
          localWater * this.settings.waterToMoistureInfluence * (0.4 + retention * 0.6) * dtSeconds;
        const nearbyWaterInput =
          nearbyWater * this.settings.nearbyWaterInfluence * (0.35 + retention * 0.65) * dtSeconds;
        const channelInput =
          nearbyChannel *
          this.settings.channelMoistureInfluence *
          (0.4 + basinFactor * 0.6) *
          dtSeconds;
        const source = rainfallInput + waterInput + nearbyWaterInput + channelInput;

        const dryExposure = clamp(1 - nearbyWater * 0.7 - localWater * 0.9, 0.12, 1);
        const heatDryingMultiplier = clamp(
          1 + (temperature[index] - 0.5) * this.settings.hotDryingSensitivity,
          0.55,
          1.9,
        );
        const dryingLoss =
          this.settings.dryingRate *
          dryExposure *
          heatDryingMultiplier *
          clamp(soilDryingMultiplier, 0.5, 2) *
          (0.35 + slope * 0.65) *
          dtSeconds;
        const drainageLoss =
          this.settings.drainageRate * (slope * 0.75 + (1 - retention) * 0.25) * dtSeconds;
        const nextMoisture = clamp(
          this.moisture[index] + source - Math.min(this.moisture[index], dryingLoss + drainageLoss),
          0,
          1,
        );

        this.nextMoisture[index] = nextMoisture;

        const wetTarget = clamp(nextMoisture * 0.72 + nearbyWater * 0.24 + localWater * 0.34, 0, 1);
        const wetBlend =
          wetTarget >= this.persistentWetness[index]
            ? clamp(this.settings.persistentWetnessRise * dtSeconds, 0, 1)
            : clamp(this.settings.persistentWetnessDecay * dtSeconds, 0, 1);
        this.persistentWetness[index] = lerp(this.persistentWetness[index], wetTarget, wetBlend);

        const floodTarget = clamp(localWater * 0.75 + nearbyWater * 0.35 + nearbyChannel * 0.12, 0, 1);
        const floodBlend =
          floodTarget >= this.floodProne[index]
            ? clamp(this.settings.floodMemoryRise * dtSeconds, 0, 1)
            : clamp(this.settings.floodMemoryDecay * dtSeconds, 0, 1);
        this.floodProne[index] = lerp(this.floodProne[index], floodTarget, floodBlend);
      }
    }

    this.applyMoistureSmoothing(terrain, dtSeconds);
  }

  private applyMoistureSmoothing(terrain: TerrainData, dtSeconds: number): void {
    const smoothingBlend = clamp(this.settings.moistureSmoothingStrength * dtSeconds, 0, 1);

    for (let y = 0; y < terrain.grid.height; y += 1) {
      for (let x = 0; x < terrain.grid.width; x += 1) {
        const index = terrain.grid.index(x, y);
        let valueSum = this.nextMoisture[index] * 0.52;
        let weightSum = 0.52;

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) {
              continue;
            }

            const sampleX = x + offsetX;
            const sampleY = y + offsetY;

            if (!terrain.grid.isInside(sampleX, sampleY)) {
              continue;
            }

            const sampleIndex = terrain.grid.index(sampleX, sampleY);
            const weight = offsetX === 0 || offsetY === 0 ? 0.085 : 0.035;
            valueSum += this.nextMoisture[sampleIndex] * weight;
            weightSum += weight;
          }
        }

        const smoothed = weightSum > 0 ? valueSum / weightSum : this.nextMoisture[index];
        this.moisture[index] = lerp(this.nextMoisture[index], smoothed, smoothingBlend);
      }
    }
  }

  private blurScalarField(
    terrain: TerrainData,
    source: Float32Array,
    target: Float32Array,
  ): void {
    for (let y = 0; y < terrain.grid.height; y += 1) {
      for (let x = 0; x < terrain.grid.width; x += 1) {
        let weightSum = 0;
        let valueSum = 0;

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = x + offsetX;
            const sampleY = y + offsetY;

            if (!terrain.grid.isInside(sampleX, sampleY)) {
              continue;
            }

            const sampleIndex = terrain.grid.index(sampleX, sampleY);
            const weight =
              offsetX === 0 && offsetY === 0
                ? 0.36
                : offsetX === 0 || offsetY === 0
                  ? 0.11
                  : 0.04;

            valueSum += source[sampleIndex] * weight;
            weightSum += weight;
          }
        }

        target[terrain.grid.index(x, y)] = weightSum > 0 ? valueSum / weightSum : 0;
      }
    }
  }

  private sampleSlope(terrain: TerrainData, x: number, y: number): number {
    const left = terrain.heights[terrain.grid.index(Math.max(x - 1, 0), y)];
    const right = terrain.heights[terrain.grid.index(Math.min(x + 1, terrain.grid.width - 1), y)];
    const top = terrain.heights[terrain.grid.index(x, Math.max(y - 1, 0))];
    const bottom = terrain.heights[terrain.grid.index(x, Math.min(y + 1, terrain.grid.height - 1))];
    const dx = Math.abs(right - left);
    const dy = Math.abs(bottom - top);
    return Math.min(1, (dx + dy) / 10);
  }

  private sampleBasinFactor(terrain: TerrainData, x: number, y: number): number {
    const center = terrain.heights[terrain.grid.index(x, y)];
    let neighborSum = 0;
    let neighborCount = 0;

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) {
          continue;
        }

        const sampleX = x + offsetX;
        const sampleY = y + offsetY;

        if (!terrain.grid.isInside(sampleX, sampleY)) {
          continue;
        }

        neighborSum += terrain.heights[terrain.grid.index(sampleX, sampleY)];
        neighborCount += 1;
      }
    }

    if (neighborCount === 0) {
      return 0;
    }

    const localAverage = neighborSum / neighborCount;
    return clamp((localAverage - center) / 2.8, 0, 1);
  }

  private getMaxValue(values: Float32Array): number {
    let maxValue = 0;

    for (let index = 0; index < values.length; index += 1) {
      maxValue = Math.max(maxValue, values[index]);
    }

    return maxValue;
  }
}
