import { ErosionModel } from "./Erosion";
import { HydrologyModel } from "./Hydrology";
import { MoistureModel } from "./Moisture";
import { RainfallModel } from "./Rainfall";
import { recomputeTerrainBounds, TerrainData, TerrainGenerator } from "./Terrain";
import { WaterBalanceModel } from "./WaterBalance";

export interface SimulationSchedule {
  hydrologyStepSeconds: number;
  erosionStepSeconds: number;
  ecologyStepSeconds: number;
  slowProcessStepSeconds: number;
  maxHydrologySubstepsPerAdvance: number;
  maxErosionSubstepsPerAdvance: number;
  maxEcologySubstepsPerAdvance: number;
  maxSlowSubstepsPerAdvance: number;
  maxAdvanceSeconds: number;
}

export interface SimulationOptions {
  resolution?: number;
  cellSize?: number;
  initialSeed?: number;
  initialRainIntensity?: number;
  schedule?: Partial<SimulationSchedule>;
}

export interface SimulationStats {
  seed: number;
  elapsedTimeSeconds: number;
  totalWater: number;
  peakFlow: number;
  rainIntensity: number;
}

const DEFAULT_SCHEDULE: SimulationSchedule = {
  hydrologyStepSeconds: 1 / 30,
  erosionStepSeconds: 1 / 6,
  ecologyStepSeconds: 0.25,
  slowProcessStepSeconds: 0.5,
  maxHydrologySubstepsPerAdvance: 10,
  maxErosionSubstepsPerAdvance: 4,
  maxEcologySubstepsPerAdvance: 3,
  maxSlowSubstepsPerAdvance: 2,
  maxAdvanceSeconds: 0.2,
};

/**
 * Simulation coordinates terrain, rainfall, hydrology, water sinks, erosion,
 * and slower long-timescale terrain maintenance. The scheduler is explicit:
 * - fast cadence: rainfall + hydrology + water balance
 * - medium cadence: erosion/deposition
 * - slow cadence: terrain settling / relaxation
 *
 * Rendering remains frame-based, but simulation advances by fixed internal
 * steps so behavior is much less sensitive to render frame time.
 */
export class Simulation {
  public terrain: TerrainData;
  public waterDepth: Float32Array;
  public readonly flowAccumulation: Float32Array;
  public soilMoisture: Float32Array;
  public persistentWetness: Float32Array;
  public floodProne: Float32Array;
  public readonly rainfall: RainfallModel;
  public readonly schedule: SimulationSchedule;

  private hydrology: HydrologyModel;
  private erosion: ErosionModel;
  private moisture: MoistureModel;
  private readonly waterBalance: WaterBalanceModel;
  private elapsedTimeSeconds = 0;
  private peakFlow = 0;
  private hydrologyAccumulator = 0;
  private erosionAccumulator = 0;
  private ecologyAccumulator = 0;
  private slowProcessAccumulator = 0;
  private readonly resolution: number;
  private readonly cellSize: number;

  public constructor(options: SimulationOptions = {}) {
    this.resolution = options.resolution ?? 128;
    this.cellSize = options.cellSize ?? 1;
    this.schedule = {
      ...DEFAULT_SCHEDULE,
      ...options.schedule,
    };

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
    this.waterBalance = new WaterBalanceModel();
    this.erosion = new ErosionModel(
      this.terrain.grid,
      this.terrain.heights,
      this.waterDepth,
      this.flowAccumulation,
      this.hydrology.getFlowIntensity(),
    );
    this.moisture = new MoistureModel(this.terrain.grid.cellCount);
    this.soilMoisture = this.moisture.getMoisture();
    this.persistentWetness = this.moisture.getPersistentWetness();
    this.floodProne = this.moisture.getFloodProne();
  }

  public static createSeed(): number {
    return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  }

  /**
   * Advances the simulation by wall-clock time scaled by the caller. The method
   * converts that delta into multiple fixed-step subsystem updates.
   */
  public step(dtSeconds: number): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return;
    }

    const clampedAdvance = Math.min(dtSeconds, this.schedule.maxAdvanceSeconds);
    this.hydrologyAccumulator += clampedAdvance;
    this.erosionAccumulator += clampedAdvance;
    this.ecologyAccumulator += clampedAdvance;
    this.slowProcessAccumulator += clampedAdvance;

    this.runHydrologyCadence();
    this.runErosionCadence();
    this.runEcologyCadence();
    this.runSlowProcessCadence();
  }

  public reset(): void {
    this.hydrology.reset();
    this.erosion.reset();
    this.moisture.reset();
    this.waterDepth = this.hydrology.getWaterDepth();
    this.erosion.setWaterDepthBuffer(this.waterDepth);
    this.flowAccumulation.fill(0);
    this.elapsedTimeSeconds = 0;
    this.peakFlow = 0;
    this.hydrologyAccumulator = 0;
    this.erosionAccumulator = 0;
    this.ecologyAccumulator = 0;
    this.slowProcessAccumulator = 0;
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
    this.hydrologyAccumulator = 0;
    this.erosionAccumulator = 0;
    this.ecologyAccumulator = 0;
    this.slowProcessAccumulator = 0;

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
    this.erosion = new ErosionModel(
      this.terrain.grid,
      this.terrain.heights,
      this.waterDepth,
      this.flowAccumulation,
      this.hydrology.getFlowIntensity(),
    );
    this.moisture = new MoistureModel(this.terrain.grid.cellCount);
    this.waterDepth = this.hydrology.getWaterDepth();
    this.erosion.setWaterDepthBuffer(this.waterDepth);
    this.soilMoisture = this.moisture.getMoisture();
    this.persistentWetness = this.moisture.getPersistentWetness();
    this.floodProne = this.moisture.getFloodProne();
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

  private runHydrologyCadence(): void {
    let steps = 0;

    while (
      this.hydrologyAccumulator >= this.schedule.hydrologyStepSeconds &&
      steps < this.schedule.maxHydrologySubstepsPerAdvance
    ) {
      this.runHydrologyStep(this.schedule.hydrologyStepSeconds);
      this.hydrologyAccumulator -= this.schedule.hydrologyStepSeconds;
      steps += 1;
    }

    if (steps >= this.schedule.maxHydrologySubstepsPerAdvance) {
      this.hydrologyAccumulator = Math.min(
        this.hydrologyAccumulator,
        this.schedule.hydrologyStepSeconds,
      );
    }
  }

  private runErosionCadence(): void {
    let steps = 0;

    while (
      this.erosionAccumulator >= this.schedule.erosionStepSeconds &&
      steps < this.schedule.maxErosionSubstepsPerAdvance
    ) {
      this.runErosionStep(this.schedule.erosionStepSeconds);
      this.erosionAccumulator -= this.schedule.erosionStepSeconds;
      steps += 1;
    }

    if (steps >= this.schedule.maxErosionSubstepsPerAdvance) {
      this.erosionAccumulator = Math.min(
        this.erosionAccumulator,
        this.schedule.erosionStepSeconds,
      );
    }
  }

  private runEcologyCadence(): void {
    let steps = 0;

    while (
      this.ecologyAccumulator >= this.schedule.ecologyStepSeconds &&
      steps < this.schedule.maxEcologySubstepsPerAdvance
    ) {
      this.runEcologyStep(this.schedule.ecologyStepSeconds);
      this.ecologyAccumulator -= this.schedule.ecologyStepSeconds;
      steps += 1;
    }

    if (steps >= this.schedule.maxEcologySubstepsPerAdvance) {
      this.ecologyAccumulator = Math.min(
        this.ecologyAccumulator,
        this.schedule.ecologyStepSeconds,
      );
    }
  }

  private runSlowProcessCadence(): void {
    let steps = 0;

    while (
      this.slowProcessAccumulator >= this.schedule.slowProcessStepSeconds &&
      steps < this.schedule.maxSlowSubstepsPerAdvance
    ) {
      this.runSlowProcessStep(this.schedule.slowProcessStepSeconds);
      this.slowProcessAccumulator -= this.schedule.slowProcessStepSeconds;
      steps += 1;
    }

    if (steps >= this.schedule.maxSlowSubstepsPerAdvance) {
      this.slowProcessAccumulator = Math.min(
        this.slowProcessAccumulator,
        this.schedule.slowProcessStepSeconds,
      );
    }
  }

  private runHydrologyStep(stepSeconds: number): void {
    this.rainfall.apply(this.waterDepth, stepSeconds);
    const hydrologyResult = this.hydrology.step(stepSeconds);
    this.waterDepth = this.hydrology.getWaterDepth();
    this.waterBalance.step(this.terrain, this.waterDepth, stepSeconds);
    this.erosion.setWaterDepthBuffer(this.waterDepth);
    this.elapsedTimeSeconds += stepSeconds;
    this.peakFlow = Math.max(this.peakFlow, hydrologyResult.maxAccumulation);
  }

  private runErosionStep(stepSeconds: number): void {
    this.erosion.setWaterDepthBuffer(this.waterDepth);
    this.erosion.step(stepSeconds, this.terrain);
    recomputeTerrainBounds(this.terrain);
  }

  private runSlowProcessStep(stepSeconds: number): void {
    this.erosion.setWaterDepthBuffer(this.waterDepth);
    const settlingResult = this.erosion.settleTerrain(stepSeconds);

    if (settlingResult.maxTerrainDelta > 0) {
      recomputeTerrainBounds(this.terrain);
    }
  }

  private runEcologyStep(stepSeconds: number): void {
    this.moisture.step(
      this.terrain,
      this.rainfall,
      this.waterDepth,
      this.flowAccumulation,
      this.hydrology.getFlowIntensity(),
      stepSeconds,
    );
  }
}
