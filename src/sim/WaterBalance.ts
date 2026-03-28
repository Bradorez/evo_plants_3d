import { clamp } from "../utils/math";
import type { TerrainData } from "./Terrain";

export interface WaterBalanceSettings {
  evaporationRate: number;
  shallowEvaporationBoost: number;
  hotEvaporationSensitivity: number;
  edgeDrainRate: number;
  edgeDrainThreshold: number;
}

export interface WaterBalanceStepResult {
  evaporatedWater: number;
  drainedWater: number;
}

/**
 * WaterBalanceModel owns the external sinks that remove water from the map.
 * Hydrology still governs in-domain movement, but this module gives water two
 * stable ways to leave the system:
 * - a small evaporation term everywhere
 * - controlled drainage on the outer map boundary
 *
 * Keeping loss terms separate from the downhill solver preserves the clarity
 * of the hydrology code while making long-running worlds approach a dynamic
 * balance instead of only accumulating water forever.
 */
export class WaterBalanceModel {
  public readonly settings: WaterBalanceSettings = {
    evaporationRate: 0.00016,
    shallowEvaporationBoost: 1.8,
    hotEvaporationSensitivity: 0.9,
    edgeDrainRate: 0.055,
    edgeDrainThreshold: 0.0025,
  };

  private readonly referenceStepSeconds = 1 / 30;

  public step(
    terrain: TerrainData,
    waterDepth: Float32Array,
    temperature: Float32Array,
    evaporationMultiplier: number | Float32Array,
    dtSeconds: number,
  ): WaterBalanceStepResult {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return { evaporatedWater: 0, drainedWater: 0 };
    }

    const evaporatedWater = this.applyEvaporation(
      waterDepth,
      temperature,
      evaporationMultiplier,
      dtSeconds,
    );
    const drainedWater = this.applyBoundaryDrainage(terrain, waterDepth, dtSeconds);

    return { evaporatedWater, drainedWater };
  }

  /**
   * Evaporation is intentionally mild. It removes a small amount everywhere,
   * with a larger relative effect on shallow films so incidental flooding can
   * dry back out while larger lakes remain persistent.
   */
  private applyEvaporation(
    waterDepth: Float32Array,
    temperature: Float32Array,
    evaporationMultiplier: number | Float32Array,
    dtSeconds: number,
  ): number {
    let evaporatedWater = 0;

    for (let index = 0; index < waterDepth.length; index += 1) {
      const depth = waterDepth[index];

      if (depth <= 0) {
        continue;
      }

      const seasonalMultiplier = clamp(
        typeof evaporationMultiplier === "number"
          ? evaporationMultiplier
          : evaporationMultiplier[index] ?? 1,
        0.45,
        2.2,
      );
      const shallowFactor = clamp((0.025 - depth) / 0.025, 0, 1);
      const heatFactor =
        1 + (temperature[index] - 0.5) * this.settings.hotEvaporationSensitivity;
      const evaporationAmount = Math.min(
        depth,
        this.settings.evaporationRate *
          dtSeconds *
          (1 + shallowFactor * this.settings.shallowEvaporationBoost) *
          clamp(heatFactor, 0.45, 1.8) *
          seasonalMultiplier,
      );

      waterDepth[index] = Math.max(0, depth - evaporationAmount);
      evaporatedWater += evaporationAmount;
    }

    return evaporatedWater;
  }

  /**
   * Boundary drainage provides a way for rivers and pooled edge water to leave
   * the simulated plane. Drainage is stronger where the boundary cell is lower
   * than the terrain immediately inland, but every edge still allows gradual
   * escape so the map does not become a sealed basin.
   */
  private applyBoundaryDrainage(
    terrain: TerrainData,
    waterDepth: Float32Array,
    dtSeconds: number,
  ): number {
    const drainScale = Math.min(0.75, this.settings.edgeDrainRate * (dtSeconds / this.referenceStepSeconds));
    let drainedWater = 0;

    for (let y = 0; y < terrain.grid.height; y += 1) {
      for (let x = 0; x < terrain.grid.width; x += 1) {
        const exposure = this.getBoundaryExposure(terrain, x, y);

        if (exposure === 0) {
          continue;
        }

        const index = terrain.grid.index(x, y);
        const depth = waterDepth[index];

        if (depth <= this.settings.edgeDrainThreshold) {
          continue;
        }

        const outletBias = this.sampleOutletBias(terrain, x, y, exposure);
        const drainFraction = drainScale * exposure * outletBias;
        const drainAmount = Math.min(
          depth,
          Math.max(0, depth - this.settings.edgeDrainThreshold) * drainFraction,
        );

        if (drainAmount <= 0) {
          continue;
        }

        waterDepth[index] = Math.max(0, depth - drainAmount);
        drainedWater += drainAmount;
      }
    }

    return drainedWater;
  }

  private getBoundaryExposure(terrain: TerrainData, x: number, y: number): number {
    let exposure = 0;

    if (x === 0 || x === terrain.grid.width - 1) {
      exposure += 1;
    }

    if (y === 0 || y === terrain.grid.height - 1) {
      exposure += 1;
    }

    return exposure;
  }

  private sampleOutletBias(terrain: TerrainData, x: number, y: number, exposure: number): number {
    const centerHeight = terrain.heights[terrain.grid.index(x, y)];
    let biasSum = 0;
    let sampleCount = 0;

    if (x === 0 && terrain.grid.isInside(x + 1, y)) {
      const inlandHeight = terrain.heights[terrain.grid.index(x + 1, y)];
      biasSum += clamp(0.35 + (inlandHeight - centerHeight) / 4, 0.2, 1.1);
      sampleCount += 1;
    }

    if (x === terrain.grid.width - 1 && terrain.grid.isInside(x - 1, y)) {
      const inlandHeight = terrain.heights[terrain.grid.index(x - 1, y)];
      biasSum += clamp(0.35 + (inlandHeight - centerHeight) / 4, 0.2, 1.1);
      sampleCount += 1;
    }

    if (y === 0 && terrain.grid.isInside(x, y + 1)) {
      const inlandHeight = terrain.heights[terrain.grid.index(x, y + 1)];
      biasSum += clamp(0.35 + (inlandHeight - centerHeight) / 4, 0.2, 1.1);
      sampleCount += 1;
    }

    if (y === terrain.grid.height - 1 && terrain.grid.isInside(x, y - 1)) {
      const inlandHeight = terrain.heights[terrain.grid.index(x, y - 1)];
      biasSum += clamp(0.35 + (inlandHeight - centerHeight) / 4, 0.2, 1.1);
      sampleCount += 1;
    }

    if (sampleCount === 0) {
      return 0.35;
    }

    return clamp(biasSum / sampleCount, 0.2, 1.15);
  }
}
