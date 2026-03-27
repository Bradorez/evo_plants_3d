import { clamp } from "../utils/math";
import { Grid } from "./Grid";
import type { TerrainData } from "./Terrain";

export interface ErosionSettings {
  erosionRate: number;
  depositionRate: number;
  sedimentCapacityFactor: number;
  sedimentTransportRate: number;
  maxTerrainDeltaPerTick: number;
  settlingRate: number;
  maxSettlingDeltaPerTick: number;
}

export interface ErosionStepResult {
  totalEroded: number;
  totalDeposited: number;
  maxTerrainDelta: number;
}

export interface TerrainSettlingResult {
  maxTerrainDelta: number;
}

const CARDINAL_OFFSETS = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
] as const;

const ALL_NEIGHBOR_OFFSETS = [
  { x: -1, y: -1, distance: Math.SQRT2 },
  { x: 0, y: -1, distance: 1 },
  { x: 1, y: -1, distance: Math.SQRT2 },
  { x: -1, y: 0, distance: 1 },
  { x: 1, y: 0, distance: 1 },
  { x: -1, y: 1, distance: Math.SQRT2 },
  { x: 0, y: 1, distance: 1 },
  { x: 1, y: 1, distance: Math.SQRT2 },
] as const;

/**
 * ErosionModel adds slow landscape evolution on top of the stable hydrology
 * solver. It intentionally stays lightweight:
 * - active flow and persistent accumulation define transport energy
 * - cells erode only by very small clamped amounts
 * - a simple suspended-sediment proxy is moved downhill
 * - low-energy, flatter zones receive weak deposition
 *
 * The model mutates `terrain.heights` in place so the next hydrology step sees
 * the updated landscape, but all changes are strictly bounded per tick.
 */
export class ErosionModel {
  public readonly settings: ErosionSettings = {
    erosionRate: 0.16,
    depositionRate: 0.075,
    sedimentCapacityFactor: 0.02,
    sedimentTransportRate: 0.42,
    maxTerrainDeltaPerTick: 0.0012,
    settlingRate: 0.09,
    maxSettlingDeltaPerTick: 0.00045,
  };

  private readonly grid: Grid;
  private readonly terrainHeights: Float32Array;
  private waterDepth: Float32Array;
  private readonly flowAccumulation: Float32Array;
  private readonly flowIntensity: Float32Array;
  private readonly suspendedSediment: Float32Array;
  private readonly nextSediment: Float32Array;
  private readonly terrainDelta: Float32Array;
  private readonly smoothedTerrainDelta: Float32Array;
  private readonly referenceStepSeconds = 1 / 30;

  public constructor(
    grid: Grid,
    terrainHeights: Float32Array,
    waterDepth: Float32Array,
    flowAccumulation: Float32Array,
    flowIntensity: Float32Array,
  ) {
    this.grid = grid;
    this.terrainHeights = terrainHeights;
    this.waterDepth = waterDepth;
    this.flowAccumulation = flowAccumulation;
    this.flowIntensity = flowIntensity;
    this.suspendedSediment = new Float32Array(grid.cellCount);
    this.nextSediment = new Float32Array(grid.cellCount);
    this.terrainDelta = new Float32Array(grid.cellCount);
    this.smoothedTerrainDelta = new Float32Array(grid.cellCount);
  }

  /**
   * Hydrology swaps between water buffers internally. The erosion model only
   * reads water, so it updates its reference to the active hydrology buffer
   * whenever the simulation step swaps to a new one.
   */
  public setWaterDepthBuffer(waterDepth: Float32Array): void {
    this.waterDepth = waterDepth;
  }

  public reset(): void {
    this.suspendedSediment.fill(0);
    this.nextSediment.fill(0);
    this.terrainDelta.fill(0);
    this.smoothedTerrainDelta.fill(0);
  }

  public step(dtSeconds: number, terrain: TerrainData): ErosionStepResult {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return {
        totalEroded: 0,
        totalDeposited: 0,
        maxTerrainDelta: 0,
      };
    }

    const dtScale = dtSeconds / this.referenceStepSeconds;
    const perTickLimit = this.settings.maxTerrainDeltaPerTick * dtScale;
    const maxFlowIntensity = this.getMaxValue(this.flowIntensity);
    const maxAccumulation = this.getMaxValue(this.flowAccumulation);
    const maxLogAccumulation = Math.max(1e-6, Math.log1p(maxAccumulation));

    this.nextSediment.fill(0);
    this.terrainDelta.fill(0);

    let totalEroded = 0;
    let totalDeposited = 0;

    for (let y = 0; y < this.grid.height; y += 1) {
      for (let x = 0; x < this.grid.width; x += 1) {
        const index = this.grid.index(x, y);
        const water = this.waterDepth[index];
        const activeFlow = maxFlowIntensity > 0 ? this.flowIntensity[index] / maxFlowIntensity : 0;
        const accumulatedFlow =
          maxAccumulation > 0 ? Math.log1p(this.flowAccumulation[index]) / maxLogAccumulation : 0;
        const waterFactor = clamp(water / 0.12, 0, 1);
        const slope = this.sampleSlope(x, y);
        const transportEnergy = clamp(
          activeFlow * 0.46 + accumulatedFlow * 0.34 + slope * 0.14 + waterFactor * 0.12,
          0,
          1,
        );
        const channelBias = clamp(accumulatedFlow * 0.65 + activeFlow * 0.35, 0, 1);
        const capacity =
          this.settings.sedimentCapacityFactor *
          (0.25 + waterFactor * 0.75) *
          (0.3 + transportEnergy * 0.7) *
          (0.4 + channelBias * 0.6);

        let sediment = this.suspendedSediment[index];

        if (transportEnergy > 0.08 && waterFactor > 0.03) {
          const erosionDemand = Math.max(0, capacity - sediment);
          const erosionAmount = Math.min(
            erosionDemand * this.settings.erosionRate * dtScale,
            perTickLimit * (0.35 + transportEnergy * 0.65),
          );

          if (erosionAmount > 0) {
            sediment += erosionAmount;
            this.terrainDelta[index] -= erosionAmount;
            totalEroded += erosionAmount;
          }
        }

        const lowEnergy = clamp((0.42 - transportEnergy) / 0.42, 0, 1);
        const spreadWater = clamp(waterFactor * 0.9 - activeFlow * 0.55, 0, 1);
        const depositionDemand = Math.max(0, sediment - capacity);
        const depositionAmount = Math.min(
          (depositionDemand + capacity * spreadWater * 0.35) *
            this.settings.depositionRate *
            dtScale *
            (0.45 + lowEnergy * 0.55),
          perTickLimit * 0.82 * (0.35 + lowEnergy * 0.65),
        );

        if (depositionAmount > 0) {
          sediment -= depositionAmount;
          this.terrainDelta[index] += depositionAmount;
          totalDeposited += depositionAmount;
        }

        const downhillNeighbor = this.findSteepestDownhillNeighbor(x, y, terrainHeightsSurfaceAt(this.terrainHeights, this.waterDepth, index));
        const transportFraction = clamp(
          this.settings.sedimentTransportRate * dtScale * (transportEnergy * 0.75 + waterFactor * 0.15),
          0,
          0.7,
        );
        const movedSediment =
          downhillNeighbor >= 0 ? Math.min(sediment, sediment * transportFraction) : 0;

        this.nextSediment[index] += sediment - movedSediment;
        if (downhillNeighbor >= 0 && movedSediment > 0) {
          this.nextSediment[downhillNeighbor] += movedSediment;
        }
      }
    }

    this.smoothTerrainDelta();

    let maxTerrainDelta = 0;

    for (let index = 0; index < this.grid.cellCount; index += 1) {
      const delta = clamp(this.smoothedTerrainDelta[index], -perTickLimit, perTickLimit);
      this.terrainHeights[index] += delta;
      this.suspendedSediment[index] = Math.max(0, this.nextSediment[index]);
      maxTerrainDelta = Math.max(maxTerrainDelta, Math.abs(delta));
    }

    return {
      totalEroded,
      totalDeposited,
      maxTerrainDelta,
    };
  }

  /**
   * Slow terrain settling acts as a long-timescale clean-up pass. It does not
   * compete with channel incision; it only nudges calm, mostly dry, low-flow
   * cells toward their local neighborhood average to reduce isolated bumps or
   * pits created by many tiny erosion/deposition steps.
   */
  public settleTerrain(dtSeconds: number): TerrainSettlingResult {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return { maxTerrainDelta: 0 };
    }

    const dtScale = dtSeconds / this.referenceStepSeconds;
    const perTickLimit = this.settings.maxSettlingDeltaPerTick * dtScale;
    const maxFlowIntensity = this.getMaxValue(this.flowIntensity);

    this.terrainDelta.fill(0);
    this.smoothedTerrainDelta.fill(0);

    for (let y = 0; y < this.grid.height; y += 1) {
      for (let x = 0; x < this.grid.width; x += 1) {
        const index = this.grid.index(x, y);
        const waterFactor = clamp(this.waterDepth[index] / 0.02, 0, 1);
        const flowFactor = maxFlowIntensity > 0 ? this.flowIntensity[index] / maxFlowIntensity : 0;
        const calmFactor = clamp(1 - Math.max(waterFactor, flowFactor), 0, 1);

        if (calmFactor <= 0.15) {
          continue;
        }

        let neighborSum = 0;
        let neighborCount = 0;

        for (const offset of CARDINAL_OFFSETS) {
          const sampleX = x + offset.x;
          const sampleY = y + offset.y;

          if (!this.grid.isInside(sampleX, sampleY)) {
            continue;
          }

          neighborSum += this.terrainHeights[this.grid.index(sampleX, sampleY)];
          neighborCount += 1;
        }

        if (neighborCount === 0) {
          continue;
        }

        const localAverage = neighborSum / neighborCount;
        const heightDifference = localAverage - this.terrainHeights[index];

        if (Math.abs(heightDifference) <= 1e-4) {
          continue;
        }

        this.terrainDelta[index] = clamp(
          heightDifference * this.settings.settlingRate * calmFactor * dtScale,
          -perTickLimit,
          perTickLimit,
        );
      }
    }

    this.smoothTerrainDelta();

    let maxTerrainDelta = 0;

    for (let index = 0; index < this.grid.cellCount; index += 1) {
      const delta = clamp(this.smoothedTerrainDelta[index], -perTickLimit, perTickLimit);
      this.terrainHeights[index] += delta;
      maxTerrainDelta = Math.max(maxTerrainDelta, Math.abs(delta));
    }

    return { maxTerrainDelta };
  }

  private sampleSlope(x: number, y: number): number {
    const centerHeight = this.terrainHeights[this.grid.index(x, y)];
    let largestDrop = 0;

    for (const offset of ALL_NEIGHBOR_OFFSETS) {
      const sampleX = x + offset.x;
      const sampleY = y + offset.y;

      if (!this.grid.isInside(sampleX, sampleY)) {
        continue;
      }

      const sampleHeight = this.terrainHeights[this.grid.index(sampleX, sampleY)];
      largestDrop = Math.max(largestDrop, (centerHeight - sampleHeight) / offset.distance);
    }

    return clamp(largestDrop / 2.8, 0, 1);
  }

  private findSteepestDownhillNeighbor(x: number, y: number, centerSurface: number): number {
    let bestDrop = 0;
    let bestIndex = -1;

    for (const offset of ALL_NEIGHBOR_OFFSETS) {
      const sampleX = x + offset.x;
      const sampleY = y + offset.y;

      if (!this.grid.isInside(sampleX, sampleY)) {
        continue;
      }

      const sampleIndex = this.grid.index(sampleX, sampleY);
      const sampleSurface = terrainHeightsSurfaceAt(this.terrainHeights, this.waterDepth, sampleIndex);
      const drop = (centerSurface - sampleSurface) / offset.distance;

      if (drop > bestDrop) {
        bestDrop = drop;
        bestIndex = sampleIndex;
      }
    }

    return bestIndex;
  }

  /**
   * A light smoothing pass prevents noisy single-cell artifacts while keeping
   * channels coherent. The center keeps most of its value, and the four
   * cardinal neighbors only soften the local delta rather than flatten it away.
   */
  private smoothTerrainDelta(): void {
    for (let y = 0; y < this.grid.height; y += 1) {
      for (let x = 0; x < this.grid.width; x += 1) {
        const index = this.grid.index(x, y);
        let valueSum = this.terrainDelta[index] * 0.58;
        let weightSum = 0.58;

        for (const offset of CARDINAL_OFFSETS) {
          const sampleX = x + offset.x;
          const sampleY = y + offset.y;

          if (!this.grid.isInside(sampleX, sampleY)) {
            continue;
          }

          valueSum += this.terrainDelta[this.grid.index(sampleX, sampleY)] * 0.105;
          weightSum += 0.105;
        }

        this.smoothedTerrainDelta[index] = weightSum > 0 ? valueSum / weightSum : 0;
      }
    }
  }

  private getMaxValue(values: Float32Array): number {
    let maxValue = 0;

    for (let index = 0; index < values.length; index += 1) {
      maxValue = Math.max(maxValue, values[index]);
    }

    return maxValue;
  }
}

function terrainHeightsSurfaceAt(
  terrainHeights: Float32Array,
  waterDepth: Float32Array,
  index: number,
): number {
  return terrainHeights[index] + waterDepth[index];
}
