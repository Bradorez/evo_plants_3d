import { clamp } from "../utils/math";
import { Grid } from "./Grid";
import type { TerrainData } from "./Terrain";

export interface ErosionSettings {
  soilErodibility: number;
  depositionRate: number;
  sedimentCapacityFactor: number;
  sedimentTransportRate: number;
  coarseMaterialMobility: number;
  coarseDepositionRate: number;
  bedrockIncisionRate: number;
  rockExposureThreshold: number;
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
 * ErosionModel now works against a lightweight layered ground model:
 * - `bedrockHeights` is the slow, resistant substrate
 * - `soilDepth` is the fast-moving fine material
 * - `coarseRock` is a bulk surface-rock field that resists erosion and only
 *   moves a little in strong channels
 *
 * This keeps the simulation grid-based and cheap while making erosion much
 * less uniformly soft everywhere.
 */
export class ErosionModel {
  public readonly settings: ErosionSettings = {
    soilErodibility: 0.16,
    depositionRate: 0.075,
    sedimentCapacityFactor: 0.02,
    sedimentTransportRate: 0.42,
    coarseMaterialMobility: 0.018,
    coarseDepositionRate: 0.05,
    bedrockIncisionRate: 0.012,
    rockExposureThreshold: 0.42,
    maxTerrainDeltaPerTick: 0.0012,
    settlingRate: 0.09,
    maxSettlingDeltaPerTick: 0.00045,
  };

  private readonly grid: Grid;
  private readonly terrainHeights: Float32Array;
  private readonly bedrockHeights: Float32Array;
  private readonly soilDepth: Float32Array;
  private readonly coarseRock: Float32Array;
  private waterDepth: Float32Array;
  private readonly flowAccumulation: Float32Array;
  private readonly flowIntensity: Float32Array;
  private readonly suspendedSediment: Float32Array;
  private readonly nextSediment: Float32Array;
  private readonly suspendedCoarse: Float32Array;
  private readonly nextCoarse: Float32Array;
  private readonly terrainDelta: Float32Array;
  private readonly smoothedTerrainDelta: Float32Array;
  private readonly coarseDelta: Float32Array;
  private readonly referenceStepSeconds = 1 / 30;

  public constructor(
    grid: Grid,
    terrainHeights: Float32Array,
    bedrockHeights: Float32Array,
    soilDepth: Float32Array,
    coarseRock: Float32Array,
    waterDepth: Float32Array,
    flowAccumulation: Float32Array,
    flowIntensity: Float32Array,
  ) {
    this.grid = grid;
    this.terrainHeights = terrainHeights;
    this.bedrockHeights = bedrockHeights;
    this.soilDepth = soilDepth;
    this.coarseRock = coarseRock;
    this.waterDepth = waterDepth;
    this.flowAccumulation = flowAccumulation;
    this.flowIntensity = flowIntensity;
    this.suspendedSediment = new Float32Array(grid.cellCount);
    this.nextSediment = new Float32Array(grid.cellCount);
    this.suspendedCoarse = new Float32Array(grid.cellCount);
    this.nextCoarse = new Float32Array(grid.cellCount);
    this.terrainDelta = new Float32Array(grid.cellCount);
    this.smoothedTerrainDelta = new Float32Array(grid.cellCount);
    this.coarseDelta = new Float32Array(grid.cellCount);
  }

  public setWaterDepthBuffer(waterDepth: Float32Array): void {
    this.waterDepth = waterDepth;
  }

  public reset(): void {
    this.suspendedSediment.fill(0);
    this.nextSediment.fill(0);
    this.suspendedCoarse.fill(0);
    this.nextCoarse.fill(0);
    this.terrainDelta.fill(0);
    this.smoothedTerrainDelta.fill(0);
    this.coarseDelta.fill(0);
  }

  public step(dtSeconds: number, terrain: TerrainData): ErosionStepResult {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return { totalEroded: 0, totalDeposited: 0, maxTerrainDelta: 0 };
    }

    const dtScale = dtSeconds / this.referenceStepSeconds;
    const perTickLimit = this.settings.maxTerrainDeltaPerTick * dtScale;
    const maxFlowIntensity = this.getMaxValue(this.flowIntensity);
    const maxAccumulation = this.getMaxValue(this.flowAccumulation);
    const maxLogAccumulation = Math.max(1e-6, Math.log1p(maxAccumulation));

    this.nextSediment.fill(0);
    this.nextCoarse.fill(0);
    this.terrainDelta.fill(0);
    this.coarseDelta.fill(0);

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
          activeFlow * 0.44 + accumulatedFlow * 0.3 + slope * 0.16 + waterFactor * 0.1,
          0,
          1,
        );
        const channelBias = clamp(accumulatedFlow * 0.62 + activeFlow * 0.38, 0, 1);
        const exposedRock = this.getExposedRockiness(index);
        const erosionResistance = clamp(
          exposedRock * 0.62 + this.coarseRock[index] * 0.18,
          0,
          0.92,
        );

        let fineSediment = this.suspendedSediment[index];
        let coarseSediment = this.suspendedCoarse[index];

        const fineCapacity =
          this.settings.sedimentCapacityFactor *
          (0.24 + waterFactor * 0.76) *
          (0.28 + transportEnergy * 0.72) *
          (0.4 + channelBias * 0.6) *
          (1 - erosionResistance * 0.58);

        if (transportEnergy > 0.08 && waterFactor > 0.03) {
          const erosionDemand = Math.max(0, fineCapacity - fineSediment);
          const projectedSoil = Math.max(0, this.soilDepth[index] + this.terrainDelta[index]);
          const fineErosion = Math.min(
            erosionDemand * this.settings.soilErodibility * dtScale,
            projectedSoil,
            perTickLimit * (0.42 + transportEnergy * 0.58),
          );

          if (fineErosion > 0) {
            fineSediment += fineErosion;
            this.terrainDelta[index] -= fineErosion;
            totalEroded += fineErosion;
          }

          const exposedAfterFine = this.getProjectedExposedRockiness(index, this.terrainDelta[index]);
          const bedrockIncision = Math.min(
            this.settings.bedrockIncisionRate *
              dtScale *
              transportEnergy *
              exposedAfterFine *
              (0.4 + channelBias * 0.6),
            this.bedrockHeights[index],
            perTickLimit * 0.22,
          );

          if (bedrockIncision > 0) {
            fineSediment += bedrockIncision * 0.82;
            coarseSediment += bedrockIncision * 0.18;
            this.terrainDelta[index] -= bedrockIncision;
            totalEroded += bedrockIncision;
          }

          const coarseMobilized = Math.min(
            this.coarseRock[index],
            this.settings.coarseMaterialMobility *
              dtScale *
              Math.max(0, transportEnergy - 0.55) *
              (0.45 + channelBias * 0.55),
          );

          if (coarseMobilized > 0) {
            this.coarseDelta[index] -= coarseMobilized;
            coarseSediment += coarseMobilized;
          }
        }

        const lowEnergy = clamp((0.42 - transportEnergy) / 0.42, 0, 1);
        const spreadWater = clamp(waterFactor * 0.9 - activeFlow * 0.55, 0, 1);
        const fineDepositionDemand = Math.max(0, fineSediment - fineCapacity);
        const fineDeposition = Math.min(
          (fineDepositionDemand + fineCapacity * spreadWater * 0.35) *
            this.settings.depositionRate *
            dtScale *
            (0.45 + lowEnergy * 0.55),
          perTickLimit * 0.82 * (0.35 + lowEnergy * 0.65),
        );

        if (fineDeposition > 0) {
          fineSediment -= fineDeposition;
          this.terrainDelta[index] += fineDeposition;
          totalDeposited += fineDeposition;
        }

        const coarseDeposition = Math.min(
          coarseSediment,
          this.settings.coarseDepositionRate *
            dtScale *
            Math.max(0, lowEnergy) *
            (0.4 + exposedRock * 0.6),
        );

        if (coarseDeposition > 0) {
          coarseSediment -= coarseDeposition;
          this.coarseDelta[index] += coarseDeposition;
          totalDeposited += coarseDeposition * 0.15;
        }

        const downhillNeighbor = this.findSteepestDownhillNeighbor(
          x,
          y,
          terrainSurfaceAt(this.terrainHeights, this.waterDepth, index),
        );
        const fineTransportFraction = clamp(
          this.settings.sedimentTransportRate *
            dtScale *
            (transportEnergy * 0.74 + waterFactor * 0.16),
          0,
          0.72,
        );
        const coarseTransportFraction = clamp(
          fineTransportFraction * this.settings.coarseMaterialMobility * 2.2,
          0,
          0.18,
        );
        const movedFine = downhillNeighbor >= 0 ? Math.min(fineSediment, fineSediment * fineTransportFraction) : 0;
        const movedCoarse =
          downhillNeighbor >= 0 ? Math.min(coarseSediment, coarseSediment * coarseTransportFraction) : 0;

        this.nextSediment[index] += fineSediment - movedFine;
        this.nextCoarse[index] += coarseSediment - movedCoarse;
        if (downhillNeighbor >= 0) {
          this.nextSediment[downhillNeighbor] += movedFine;
          this.nextCoarse[downhillNeighbor] += movedCoarse;
        }
      }
    }

    this.smoothTerrainDelta();

    let maxTerrainDelta = 0;

    for (let index = 0; index < this.grid.cellCount; index += 1) {
      const delta = clamp(this.smoothedTerrainDelta[index], -perTickLimit, perTickLimit);
      this.applyTerrainDelta(index, delta);
      this.coarseRock[index] = clamp(this.coarseRock[index] + this.coarseDelta[index], 0, 1);
      this.terrainHeights[index] = this.bedrockHeights[index] + this.soilDepth[index];
      this.suspendedSediment[index] = Math.max(0, this.nextSediment[index]);
      this.suspendedCoarse[index] = Math.max(0, this.nextCoarse[index]);
      maxTerrainDelta = Math.max(maxTerrainDelta, Math.abs(delta));
    }

    return { totalEroded, totalDeposited, maxTerrainDelta };
  }

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
      this.applyTerrainDelta(index, delta);
      this.terrainHeights[index] = this.bedrockHeights[index] + this.soilDepth[index];
      maxTerrainDelta = Math.max(maxTerrainDelta, Math.abs(delta));
    }

    return { maxTerrainDelta };
  }

  private applyTerrainDelta(index: number, delta: number): void {
    if (delta >= 0) {
      this.soilDepth[index] += delta;
      return;
    }

    let remainingRemoval = -delta;
    const soilRemoval = Math.min(this.soilDepth[index], remainingRemoval);
    this.soilDepth[index] -= soilRemoval;
    remainingRemoval -= soilRemoval;

    if (remainingRemoval > 0) {
      this.bedrockHeights[index] = Math.max(0, this.bedrockHeights[index] - remainingRemoval);
    }
  }

  private getExposedRockiness(index: number): number {
    return clamp(
      this.coarseRock[index] * 0.55 +
        Math.max(0, 1 - this.soilDepth[index] / this.settings.rockExposureThreshold) * 0.45,
      0,
      1,
    );
  }

  private getProjectedExposedRockiness(index: number, pendingDelta: number): number {
    const projectedSoil = Math.max(0, this.soilDepth[index] + Math.min(0, pendingDelta));
    return clamp(
      this.coarseRock[index] * 0.55 +
        Math.max(0, 1 - projectedSoil / this.settings.rockExposureThreshold) * 0.45,
      0,
      1,
    );
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
      const sampleSurface = terrainSurfaceAt(this.terrainHeights, this.waterDepth, sampleIndex);
      const drop = (centerSurface - sampleSurface) / offset.distance;

      if (drop > bestDrop) {
        bestDrop = drop;
        bestIndex = sampleIndex;
      }
    }

    return bestIndex;
  }

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

function terrainSurfaceAt(
  terrainHeights: Float32Array,
  waterDepth: Float32Array,
  index: number,
): number {
  return terrainHeights[index] + waterDepth[index];
}
