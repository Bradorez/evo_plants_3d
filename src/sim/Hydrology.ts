import { Grid } from "./Grid";

export interface HydrologyStepResult {
  transferredWater: number;
  maxAccumulation: number;
}

interface NeighborOffset {
  readonly x: number;
  readonly y: number;
  readonly distance: number;
}

const NEIGHBOR_OFFSETS: readonly NeighborOffset[] = [
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
 * Hydrology executes a stable surface-based redistribution pass over the grid.
 *
 * The important rule is that every cell reasons about water using the water
 * surface height `terrain + water`, not just the bare terrain height. That lets
 * depressions fill naturally into lakes and overflow once the pooled water
 * surface rises above a neighbouring spill point.
 *
 * The solver uses a two-buffer update model:
 * - `currentWater` is the state read for the whole tick
 * - `nextWater` accumulates all outgoing and incoming flow
 * - the buffers are swapped only after the tick is fully resolved
 *
 * This keeps the update mass-conserving and avoids the directional bias and
 * instability that come from mutating the water field in-place mid-iteration.
 */
export class HydrologyModel {
  private readonly grid: Grid;
  private readonly terrainHeights: Float32Array;
  private readonly flowAccumulation: Float32Array;
  private readonly surfaceHeights: Float32Array;
  private readonly outgoingFlow: Float32Array;
  private readonly neighborIndices = new Int32Array(8);
  private readonly neighborWeights = new Float32Array(8);
  private readonly neighborCapacities = new Float32Array(8);

  private currentWater: Float32Array;
  private nextWater: Float32Array;

  /**
   * `maxFlowPerTick` limits how much of a cell can leave in one simulation
   * update. The cap is the main stability control because it prevents cells from
   * fully draining and refilling in a single step, which is a common source of
   * oscillation in simple grid hydrology models.
   */
  private readonly maxFlowPerTick = 0.25;
  private readonly referenceStepSeconds = 1 / 30;
  private readonly minWaterDepth = 1e-6;
  private readonly maxSafeWaterDepth = 1e6;

  public constructor(
    grid: Grid,
    terrainHeights: Float32Array,
    initialWaterDepth: Float32Array,
    flowAccumulation: Float32Array,
  ) {
    this.grid = grid;
    this.terrainHeights = terrainHeights;
    this.flowAccumulation = flowAccumulation;
    this.currentWater = initialWaterDepth;
    this.nextWater = new Float32Array(grid.cellCount);
    this.surfaceHeights = new Float32Array(grid.cellCount);
    this.outgoingFlow = new Float32Array(grid.cellCount);
  }

  public getWaterDepth(): Float32Array {
    return this.currentWater;
  }

  public reset(): void {
    this.currentWater.fill(0);
    this.nextWater.fill(0);
    this.outgoingFlow.fill(0);
  }

  public step(dtSeconds: number): HydrologyStepResult {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return {
        transferredWater: 0,
        maxAccumulation: this.getMaxAccumulation(),
      };
    }

    const flowFraction = Math.min(
      0.95,
      this.maxFlowPerTick * (dtSeconds / this.referenceStepSeconds),
    );

    this.nextWater.set(this.currentWater);

    for (let index = 0; index < this.grid.cellCount; index += 1) {
      const waterDepth = this.sanitizeWaterValue(this.currentWater[index]);
      this.currentWater[index] = waterDepth;
      this.nextWater[index] = waterDepth;
      this.surfaceHeights[index] = this.terrainHeights[index] + waterDepth;
      this.outgoingFlow[index] = 0;
    }

    let transferredWater = 0;

    for (let y = 0; y < this.grid.height; y += 1) {
      for (let x = 0; x < this.grid.width; x += 1) {
        const index = this.grid.index(x, y);
        const availableWater = this.currentWater[index];

        if (availableWater <= this.minWaterDepth) {
          continue;
        }

        const currentSurface = this.surfaceHeights[index];
        let downhillCount = 0;
        let totalWeight = 0;
        let totalCapacity = 0;

        for (const neighbor of NEIGHBOR_OFFSETS) {
          const neighborX = x + neighbor.x;
          const neighborY = y + neighbor.y;

          if (!this.grid.isInside(neighborX, neighborY)) {
            continue;
          }

          const neighborIndex = this.grid.index(neighborX, neighborY);
          const neighborSurface = this.surfaceHeights[neighborIndex];
          const surfaceDrop = currentSurface - neighborSurface;

          if (!Number.isFinite(surfaceDrop) || surfaceDrop <= this.minWaterDepth) {
            continue;
          }

          const weight = surfaceDrop / neighbor.distance;
          const capacity = surfaceDrop * 0.5;

          this.neighborIndices[downhillCount] = neighborIndex;
          this.neighborWeights[downhillCount] = weight;
          this.neighborCapacities[downhillCount] = capacity;
          downhillCount += 1;
          totalWeight += weight;
          totalCapacity += capacity;
        }

        if (downhillCount === 0 || totalWeight <= 0 || totalCapacity <= this.minWaterDepth) {
          continue;
        }

        let remainingBudget = Math.min(availableWater * flowFraction, totalCapacity);

        if (remainingBudget <= this.minWaterDepth) {
          continue;
        }

        let iterationGuard = 0;

        while (remainingBudget > this.minWaterDepth && iterationGuard < 8) {
          let activeWeight = 0;

          for (let neighborOffset = 0; neighborOffset < downhillCount; neighborOffset += 1) {
            if (this.neighborCapacities[neighborOffset] > this.minWaterDepth) {
              activeWeight += this.neighborWeights[neighborOffset];
            }
          }

          if (activeWeight <= 0) {
            break;
          }

          let distributedThisPass = 0;

          for (let neighborOffset = 0; neighborOffset < downhillCount; neighborOffset += 1) {
            const remainingCapacity = this.neighborCapacities[neighborOffset];

            if (remainingCapacity <= this.minWaterDepth) {
              continue;
            }

            const desiredTransfer =
              remainingBudget * (this.neighborWeights[neighborOffset] / activeWeight);
            const transferAmount = Math.min(desiredTransfer, remainingCapacity);

            if (!Number.isFinite(transferAmount) || transferAmount <= this.minWaterDepth) {
              continue;
            }

            const neighborIndex = this.neighborIndices[neighborOffset];
            this.nextWater[index] -= transferAmount;
            this.nextWater[neighborIndex] += transferAmount;
            this.outgoingFlow[index] += transferAmount;
            this.neighborCapacities[neighborOffset] -= transferAmount;
            distributedThisPass += transferAmount;
          }

          if (distributedThisPass <= this.minWaterDepth) {
            break;
          }

          transferredWater += distributedThisPass;
          remainingBudget -= distributedThisPass;
          iterationGuard += 1;
        }
      }
    }

    let maxAccumulation = 0;

    for (let index = 0; index < this.grid.cellCount; index += 1) {
      const clampedWater = this.sanitizeWaterValue(this.nextWater[index]);
      this.nextWater[index] = clampedWater;

      const accumulationIncrement = this.outgoingFlow[index] / Math.max(dtSeconds, 1e-6);
      const nextAccumulation = this.flowAccumulation[index] + accumulationIncrement;
      this.flowAccumulation[index] = Number.isFinite(nextAccumulation) ? nextAccumulation : 0;
      maxAccumulation = Math.max(maxAccumulation, this.flowAccumulation[index]);
    }

    const previousWater = this.currentWater;
    this.currentWater = this.nextWater;
    this.nextWater = previousWater;

    return {
      transferredWater,
      maxAccumulation,
    };
  }

  private sanitizeWaterValue(value: number): number {
    if (!Number.isFinite(value) || value <= this.minWaterDepth) {
      return 0;
    }

    return Math.min(value, this.maxSafeWaterDepth);
  }

  private getMaxAccumulation(): number {
    let maxAccumulation = 0;

    for (let index = 0; index < this.flowAccumulation.length; index += 1) {
      maxAccumulation = Math.max(maxAccumulation, this.flowAccumulation[index]);
    }

    return maxAccumulation;
  }
}
