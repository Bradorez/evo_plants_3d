import { RainfallModel } from "./Rainfall";
import { HydrologyModel } from "./Hydrology";
import { TerrainData, TerrainGenerator } from "./Terrain";

export interface SimulationOptions {
  resolution?: number;
  cellSize?: number;
  initialSeed?: number;
  initialRainIntensity?: number;
}

export interface SimulationStats {
  seed: number;
  elapsedTimeSeconds: number;
  totalWater: number;
  peakFlow: number;
  rainIntensity: number;
}

/**
 * Simulation coordinates terrain state, rainfall injection, and hydrology.
 * It exposes a compact API that the app and renderer can consume without
 * knowing how the underlying arrays are generated or updated.
 */
export class Simulation {
  public terrain: TerrainData;
  public waterDepth: Float32Array;
  public readonly flowAccumulation: Float32Array;
  public readonly rainfall: RainfallModel;

  private hydrology: HydrologyModel;
  private elapsedTimeSeconds = 0;
  private peakFlow = 0;
  private readonly resolution: number;
  private readonly cellSize: number;

  public constructor(options: SimulationOptions = {}) {
    this.resolution = options.resolution ?? 128;
    this.cellSize = options.cellSize ?? 1;

    this.terrain = TerrainGenerator.generate({
      resolution: this.resolution,
      cellSize: this.cellSize,
      seed: options.initialSeed ?? Simulation.createSeed(),
    });

    this.waterDepth = new Float32Array(this.terrain.grid.cellCount);
    this.flowAccumulation = new Float32Array(this.terrain.grid.cellCount);
    this.rainfall = new RainfallModel(
      this.terrain.grid,
      this.terrain.seed,
      options.initialRainIntensity ?? 0.18,
    );
    this.hydrology = new HydrologyModel(
      this.terrain.grid,
      this.terrain.heights,
      this.waterDepth,
      this.flowAccumulation,
    );
  }

  public static createSeed(): number {
    return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  }

  public step(dtSeconds: number): void {
    if (dtSeconds <= 0) {
      return;
    }

    this.rainfall.apply(this.waterDepth, dtSeconds);
    const hydrologyResult = this.hydrology.step(dtSeconds);
    this.waterDepth = this.hydrology.getWaterDepth();
    this.elapsedTimeSeconds += dtSeconds;
    this.peakFlow = Math.max(this.peakFlow, hydrologyResult.maxAccumulation);
  }

  public reset(): void {
    this.hydrology.reset();
    this.waterDepth = this.hydrology.getWaterDepth();
    this.flowAccumulation.fill(0);
    this.elapsedTimeSeconds = 0;
    this.peakFlow = 0;
  }

  public regenerate(seed = Simulation.createSeed()): void {
    this.terrain = TerrainGenerator.generate({
      resolution: this.resolution,
      cellSize: this.cellSize,
      seed,
    });

    this.waterDepth = new Float32Array(this.terrain.grid.cellCount);
    this.flowAccumulation.fill(0);
    this.elapsedTimeSeconds = 0;
    this.peakFlow = 0;

    const nextRainfall = new RainfallModel(
      this.terrain.grid,
      this.terrain.seed,
      this.rainfall.getIntensity(),
    );

    this.rainfall.distribution.set(nextRainfall.distribution);
    this.hydrology = new HydrologyModel(
      this.terrain.grid,
      this.terrain.heights,
      this.waterDepth,
      this.flowAccumulation,
    );
    this.waterDepth = this.hydrology.getWaterDepth();
  }

  public setRainIntensity(intensity: number): void {
    this.rainfall.setIntensity(intensity);
  }

  public getStats(): SimulationStats {
    let totalWater = 0;
    let peakFlow = 0;

    for (let index = 0; index < this.waterDepth.length; index += 1) {
      totalWater += this.waterDepth[index];
      peakFlow = Math.max(peakFlow, this.flowAccumulation[index]);
    }

    return {
      seed: this.terrain.seed,
      elapsedTimeSeconds: this.elapsedTimeSeconds,
      totalWater,
      peakFlow,
      rainIntensity: this.rainfall.getIntensity(),
    };
  }
}
