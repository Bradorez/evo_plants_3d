import { Grid } from "./Grid";

export interface HydrologyStepResult {
  transferredWater: number;
  maxAccumulation: number;
}

/**
 * Hydrology executes the local water redistribution step on the terrain grid.
 * The model is intentionally simple: each cell compares its water surface with
 * its neighbours, releases only a limited fraction of its stored water, and
 * distributes that amount proportionally downhill. This conserves mass, allows
 * depressions to fill into lakes, and naturally spills them once a lower outlet
 * becomes reachable by the water surface.
 */
export class HydrologyModel {
  private readonly grid: Grid;
  private readonly terrainHeights: Float32Array;
  private readonly waterDepth: Float32Array;
  private readonly flowAccumulation: Float32Array;
  private readonly surfaceHeights: Float32Array;
  private readonly deltaWater: Float32Array;
  private readonly movedWater: Float32Array;
  private readonly neighbourIndices = new Int32Array(8);
  private readonly neighbourWeights = new Float32Array(8);

  public constructor(
    grid: Grid,
    terrainHeights: Float32Array,
    waterDepth: Float32Array,
    flowAccumulation: Float32Array,
  ) {
    this.grid = grid;
    this.terrainHeights = terrainHeights;
    this.waterDepth = waterDepth;
    this.flowAccumulation = flowAccumulation;
    this.surfaceHeights = new Float32Array(grid.cellCount);
    this.deltaWater = new Float32Array(grid.cellCount);
    this.movedWater = new Float32Array(grid.cellCount);
  }

  public step(dtSeconds: number): HydrologyStepResult {
    this.surfaceHeights.set(this.terrainHeights);

    for (let index = 0; index < this.surfaceHeights.length; index += 1) {
      this.surfaceHeights[index] += this.waterDepth[index];
      this.deltaWater[index] = 0;
      this.movedWater[index] = 0;
    }

    let transferredWater = 0;
    const releaseFraction = 1 - Math.exp(-8 * dtSeconds);

    for (let y = 0; y < this.grid.height; y += 1) {
      for (let x = 0; x < this.grid.width; x += 1) {
        const index = this.grid.index(x, y);
        const availableWater = this.waterDepth[index];

        if (availableWater < 1e-5) {
          continue;
        }

        const currentSurface = this.surfaceHeights[index];
        let downhillCount = 0;
        let totalWeight = 0;

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) {
              continue;
            }

            const neighbourX = x + offsetX;
            const neighbourY = y + offsetY;

            if (!this.grid.isInside(neighbourX, neighbourY)) {
              continue;
            }

            const neighbourIndex = this.grid.index(neighbourX, neighbourY);
            const neighbourSurface = this.surfaceHeights[neighbourIndex];
            const surfaceDrop = currentSurface - neighbourSurface;

            if (surfaceDrop <= 1e-4) {
              continue;
            }

            const distance = offsetX === 0 || offsetY === 0 ? 1 : Math.SQRT2;
            const weight = surfaceDrop / distance;
            this.neighbourIndices[downhillCount] = neighbourIndex;
            this.neighbourWeights[downhillCount] = weight;
            totalWeight += weight;
            downhillCount += 1;
          }
        }

        if (downhillCount === 0 || totalWeight <= 0) {
          continue;
        }

        const transferableWater = Math.min(availableWater, availableWater * releaseFraction);

        if (transferableWater <= 0) {
          continue;
        }

        for (let neighbourOffset = 0; neighbourOffset < downhillCount; neighbourOffset += 1) {
          const neighbourIndex = this.neighbourIndices[neighbourOffset];
          const transferWeight = this.neighbourWeights[neighbourOffset] / totalWeight;
          const transferAmount = transferableWater * transferWeight;

          this.deltaWater[index] -= transferAmount;
          this.deltaWater[neighbourIndex] += transferAmount;
          this.movedWater[index] += transferAmount;
          transferredWater += transferAmount;
        }
      }
    }

    let maxAccumulation = 0;
    const accumulationBlend = 1 - Math.exp(-3.5 * dtSeconds);
    const accumulationDecay = Math.exp(-0.85 * dtSeconds);

    for (let index = 0; index < this.waterDepth.length; index += 1) {
      this.waterDepth[index] = Math.max(0, this.waterDepth[index] + this.deltaWater[index]);

      const blendedFlow = this.movedWater[index] * 160;
      this.flowAccumulation[index] =
        this.flowAccumulation[index] * accumulationDecay * (1 - accumulationBlend) +
        blendedFlow * accumulationBlend;
      maxAccumulation = Math.max(maxAccumulation, this.flowAccumulation[index]);
    }

    return {
      transferredWater,
      maxAccumulation,
    };
  }
}
