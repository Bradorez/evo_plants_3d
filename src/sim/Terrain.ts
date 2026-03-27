import { clamp, inverseLerp, lerp } from "../utils/math";
import { fbm2D, ridgeNoise2D, valueNoise2D } from "../utils/noise";
import { Grid } from "./Grid";

export interface TerrainData {
  seed: number;
  grid: Grid;
  cellSize: number;
  heights: Float32Array;
  bedrockHeights: Float32Array;
  soilDepth: Float32Array;
  coarseRock: Float32Array;
  minHeight: number;
  maxHeight: number;
}

export interface TerrainOptions {
  resolution: number;
  cellSize: number;
  seed: number;
}

export const TERRAIN_MATERIAL_SETTINGS = {
  initialSoilDepthMin: 0.25,
  initialSoilDepthMax: 1.8,
  initialRockinessMin: 0.05,
  initialRockinessMax: 0.95,
} as const;

/**
 * Terrain bounds are used by the renderer for elevation-dependent coloring and
 * by the scene framing logic. Once erosion and deposition start mutating the
 * heightfield at runtime, those bounds need to be recomputed incrementally.
 */
export function recomputeTerrainBounds(terrain: TerrainData): void {
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < terrain.heights.length; index += 1) {
    const height = terrain.heights[index];
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
  }

  terrain.minHeight = minHeight;
  terrain.maxHeight = maxHeight;
}

/**
 * The terrain system owns heightmap generation only.
 * It produces a stable procedural landscape for the hydrology solver and the
 * renderer, but does not know anything about water or Babylon.js meshes.
 */
export class TerrainGenerator {
  public static generate(options: TerrainOptions): TerrainData {
    const grid = new Grid(options.resolution, options.resolution);
    const heights = new Float32Array(grid.cellCount);
    const bedrockHeights = new Float32Array(grid.cellCount);
    const soilDepth = new Float32Array(grid.cellCount);
    const coarseRock = new Float32Array(grid.cellCount);
    const featureSeed = options.seed >>> 0;
    const invWidth = 1 / Math.max(grid.width - 1, 1);
    const invHeight = 1 / Math.max(grid.height - 1, 1);

    let rawMin = Number.POSITIVE_INFINITY;
    let rawMax = Number.NEGATIVE_INFINITY;

    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const index = grid.index(x, y);
        const nx = x * invWidth - 0.5;
        const ny = y * invHeight - 0.5;

        const continent = fbm2D(nx * 2.1 + 15.2, ny * 2.1 - 9.7, featureSeed, 5, 2.05, 0.54);
        const ridges = ridgeNoise2D(nx * 5.4 - 4.5, ny * 5.4 + 3.2, featureSeed + 71, 4);
        const hills = fbm2D(nx * 10.5, ny * 10.5, featureSeed + 193, 4, 2.25, 0.48);
        const basinField = valueNoise2D(nx * 6.8 + 18, ny * 6.8 - 31, featureSeed + 509);

        const radialDistance = Math.sqrt(nx * nx + ny * ny);
        const edgeFalloff = clamp(1 - radialDistance * 1.28, 0, 1);
        const depression = Math.max(0, basinField - 0.62);

        let height =
          continent * 0.72 +
          ridges * 0.22 +
          hills * 0.12 +
          edgeFalloff * 0.09 -
          radialDistance * 0.2;

        // Intentional local depressions create natural lake basins once water
        // starts collecting, which makes the first simulator version visually
        // interesting without a more advanced watershed preprocessing step.
        height -= depression * depression * 1.2;

        heights[index] = height;
        rawMin = Math.min(rawMin, height);
        rawMax = Math.max(rawMax, height);
      }
    }

    for (let index = 0; index < heights.length; index += 1) {
      const normalized = inverseLerp(rawMin, rawMax, heights[index]);
      const shaped = Math.pow(normalized, 1.16);
      const scaled = shaped * 24;
      heights[index] = scaled;
    }

    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const index = grid.index(x, y);
        const normalizedElevation = inverseLerp(0, 24, heights[index]);
        const slope = sampleSlope(grid, heights, x, y);
        const soilNoise = valueNoise2D(x * 0.09 + 4.8, y * 0.09 - 11.2, featureSeed + 1207);
        const rockNoise = valueNoise2D(x * 0.13 - 7.4, y * 0.13 + 6.1, featureSeed + 8129);
        const valleyRetention = clamp((1 - slope) * 0.55 + (1 - normalizedElevation) * 0.28 + soilNoise * 0.17, 0, 1);
        const rockyExposure = clamp(slope * 0.48 + normalizedElevation * 0.22 + rockNoise * 0.3, 0, 1);
        const cellSoilDepth = lerp(
          TERRAIN_MATERIAL_SETTINGS.initialSoilDepthMin,
          TERRAIN_MATERIAL_SETTINGS.initialSoilDepthMax,
          valleyRetention * (1 - rockyExposure * 0.45),
        );

        soilDepth[index] = clamp(cellSoilDepth, TERRAIN_MATERIAL_SETTINGS.initialSoilDepthMin, TERRAIN_MATERIAL_SETTINGS.initialSoilDepthMax);
        coarseRock[index] = lerp(
          TERRAIN_MATERIAL_SETTINGS.initialRockinessMin,
          TERRAIN_MATERIAL_SETTINGS.initialRockinessMax,
          rockyExposure,
        );
        bedrockHeights[index] = Math.max(0, heights[index] - soilDepth[index]);
        heights[index] = bedrockHeights[index] + soilDepth[index];
      }
    }

    const terrain: TerrainData = {
      seed: featureSeed,
      grid,
      cellSize: options.cellSize,
      heights,
      bedrockHeights,
      soilDepth,
      coarseRock,
      minHeight: 0,
      maxHeight: 0,
    };
    recomputeTerrainBounds(terrain);
    return terrain;
  }
}

function sampleSlope(grid: Grid, heights: Float32Array, x: number, y: number): number {
  const left = heights[grid.index(Math.max(x - 1, 0), y)];
  const right = heights[grid.index(Math.min(x + 1, grid.width - 1), y)];
  const top = heights[grid.index(x, Math.max(y - 1, 0))];
  const bottom = heights[grid.index(x, Math.min(y + 1, grid.height - 1))];
  const dx = Math.abs(right - left);
  const dy = Math.abs(bottom - top);
  return Math.min(1, (dx + dy) / 10);
}
