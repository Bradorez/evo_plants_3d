import { clamp } from "../utils/math";
import type { TerrainData } from "./Terrain";

export type SandboxToolMode =
  | "view"
  | "add_rock"
  | "uplift"
  | "lower"
  | "flatten"
  | "roughen"
  | "water_source"
  | "erase_water_source";

export interface SandboxSettings {
  rockAddRate: number;
  upliftRate: number;
  lowerRate: number;
  planarRate: number;
  roughenRate: number;
  waterSourceRate: number;
  maxCoarseDepth: number;
}

/**
 * SandboxModel owns lightweight persistent user edits. It is intentionally
 * simple:
 * - coarse material placement adds to the explicit coarse surface layer
 * - water sources store a per-cell supply rate and inject water every fast step
 *
 * Keeping these edits in simulation space means the terrain, hydrology, and
 * erosion systems all react naturally to what the user paints.
 */
export class SandboxModel {
  public readonly settings: SandboxSettings = {
    rockAddRate: 0.18,
    upliftRate: 0.65,
    lowerRate: 0.65,
    planarRate: 0.42,
    roughenRate: 0.36,
    waterSourceRate: 0.08,
    maxCoarseDepth: 2.2,
  };

  private readonly waterSources: Float32Array;

  public constructor(cellCount: number) {
    this.waterSources = new Float32Array(cellCount);
  }

  public reset(): void {
    this.waterSources.fill(0);
  }

  public getWaterSources(): Float32Array {
    return this.waterSources;
  }

  public getActiveSourceCount(): number {
    let activeCount = 0;

    for (let index = 0; index < this.waterSources.length; index += 1) {
      if (this.waterSources[index] > 1e-5) {
        activeCount += 1;
      }
    }

    return activeCount;
  }

  public applyWaterSources(waterDepth: Float32Array, dtSeconds: number): number {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return 0;
    }

    let addedWater = 0;

    for (let index = 0; index < waterDepth.length; index += 1) {
      const sourceRate = this.waterSources[index];

      if (sourceRate <= 0) {
        continue;
      }

      const amount = sourceRate * dtSeconds;
      waterDepth[index] += amount;
      addedWater += amount;
    }

    return addedWater;
  }

  public addWaterSource(
    terrain: TerrainData,
    centerX: number,
    centerY: number,
    radiusCells: number,
    strength: number,
  ): void {
    this.paintBrush(terrain, centerX, centerY, radiusCells, (index, weight) => {
      this.waterSources[index] += this.settings.waterSourceRate * strength * weight;
    });
  }

  public eraseWaterSource(
    terrain: TerrainData,
    centerX: number,
    centerY: number,
    radiusCells: number,
  ): void {
    this.paintBrush(terrain, centerX, centerY, radiusCells, (index) => {
      this.waterSources[index] = 0;
    });
  }

  public addCoarseRock(
    terrain: TerrainData,
    centerX: number,
    centerY: number,
    radiusCells: number,
    strength: number,
  ): void {
    this.paintBrush(terrain, centerX, centerY, radiusCells, (index, weight) => {
      terrain.coarseRock[index] = clamp(
        terrain.coarseRock[index] + this.settings.rockAddRate * strength * weight,
        0,
        this.settings.maxCoarseDepth,
      );
      terrain.heights[index] =
        terrain.bedrockHeights[index] + terrain.soilDepth[index] + terrain.coarseRock[index];
    });
  }

  public upliftTerrain(
    terrain: TerrainData,
    centerX: number,
    centerY: number,
    radiusCells: number,
    strength: number,
  ): void {
    this.paintBrush(terrain, centerX, centerY, radiusCells, (index, weight) => {
      const upliftAmount = this.settings.upliftRate * strength * weight;
      terrain.bedrockHeights[index] += upliftAmount;
      terrain.heights[index] =
        terrain.bedrockHeights[index] + terrain.soilDepth[index] + terrain.coarseRock[index];
    });
  }

  public lowerTerrain(
    terrain: TerrainData,
    centerX: number,
    centerY: number,
    radiusCells: number,
    strength: number,
  ): void {
    this.paintBrush(terrain, centerX, centerY, radiusCells, (index, weight) => {
      const lowerAmount = this.settings.lowerRate * strength * weight;
      terrain.bedrockHeights[index] = Math.max(0, terrain.bedrockHeights[index] - lowerAmount);
      terrain.heights[index] =
        terrain.bedrockHeights[index] + terrain.soilDepth[index] + terrain.coarseRock[index];
    });
  }

  /**
   * `planarizeTerrain` flattens the brushed area toward a local weighted mean
   * surface. It edits bedrock height rather than stripping soil, so the terrain
   * becomes more uniform without destroying the existing material layering.
   */
  public planarizeTerrain(
    terrain: TerrainData,
    centerX: number,
    centerY: number,
    radiusCells: number,
    strength: number,
  ): void {
    const targetSurface = this.sampleBrushWeightedSurface(
      terrain,
      centerX,
      centerY,
      radiusCells,
    );

    this.paintBrush(terrain, centerX, centerY, radiusCells, (index, weight) => {
      const currentSurface =
        terrain.bedrockHeights[index] + terrain.soilDepth[index] + terrain.coarseRock[index];
      const delta = (targetSurface - currentSurface) * this.settings.planarRate * strength * weight;
      terrain.bedrockHeights[index] = Math.max(0, terrain.bedrockHeights[index] + delta);
      terrain.heights[index] =
        terrain.bedrockHeights[index] + terrain.soilDepth[index] + terrain.coarseRock[index];
    });
  }

  /**
   * `roughenTerrain` applies deterministic local relief so the brushed area
   * becomes less uniform. The pattern is derived from cell coordinates, not
   * randomness, which keeps repeated edits stable and debuggable.
   */
  public roughenTerrain(
    terrain: TerrainData,
    centerX: number,
    centerY: number,
    radiusCells: number,
    strength: number,
  ): void {
    this.paintBrush(terrain, centerX, centerY, radiusCells, (index, weight, x, y) => {
      const signedNoise = this.sampleSignedBrushNoise(x, y, centerX, centerY);
      const roughenAmount = signedNoise * this.settings.roughenRate * strength * weight;
      terrain.bedrockHeights[index] = Math.max(0, terrain.bedrockHeights[index] + roughenAmount);
      terrain.heights[index] =
        terrain.bedrockHeights[index] + terrain.soilDepth[index] + terrain.coarseRock[index];
    });
  }

  private sampleBrushWeightedSurface(
    terrain: TerrainData,
    centerX: number,
    centerY: number,
    radiusCells: number,
  ): number {
    let weightedHeightSum = 0;
    let weightSum = 0;

    this.paintBrush(terrain, centerX, centerY, radiusCells, (index, weight) => {
      weightedHeightSum += terrain.heights[index] * weight;
      weightSum += weight;
    });

    if (weightSum <= 0) {
      return terrain.heights[terrain.grid.index(centerX, centerY)];
    }

    return weightedHeightSum / weightSum;
  }

  private sampleSignedBrushNoise(x: number, y: number, centerX: number, centerY: number): number {
    const dx = x - centerX;
    const dy = y - centerY;
    const ring = Math.sin(dx * 0.91 + dy * 1.27);
    const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const jitter = (hash - Math.floor(hash)) * 2 - 1;
    return clamp(ring * 0.55 + jitter * 0.45, -1, 1);
  }

  private paintBrush(
    terrain: TerrainData,
    centerX: number,
    centerY: number,
    radiusCells: number,
    apply: (index: number, weight: number, x: number, y: number) => void,
  ): void {
    const radius = Math.max(0, radiusCells);
    const radiusSquared = Math.max(1, radius * radius);

    for (let y = Math.max(0, centerY - radius); y <= Math.min(terrain.grid.height - 1, centerY + radius); y += 1) {
      for (let x = Math.max(0, centerX - radius); x <= Math.min(terrain.grid.width - 1, centerX + radius); x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared > radiusSquared) {
          continue;
        }

        const distance = Math.sqrt(distanceSquared);
        const weight = radius <= 0 ? 1 : Math.max(0, 1 - distance / (radius + 0.5));
        apply(terrain.grid.index(x, y), weight, x, y);
      }
    }
  }
}
