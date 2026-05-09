import { RegionalClimateModel } from "./RegionalClimate";
import { ErosionModel, type ErosionStabilityInputs } from "./Erosion";
import { HydrologyModel } from "./Hydrology";
import { MoistureModel } from "./Moisture";
import type { PlantSelectionDiagnostics } from "./PlantDiagnostics";
import type { PlantSpeciesDefinition } from "./PlantSpecies";
import { RainfallModel } from "./Rainfall";
import { SandboxModel, type SandboxToolMode } from "./Sandbox";
import { SeasonModel, type SeasonState } from "./Season";
import { SoilStabilityModel } from "./SoilStability";
import { TemperatureModel } from "./Temperature";
import { recomputeTerrainBounds, TerrainData, TerrainGenerator } from "./Terrain";
import { type VegetationDebugSummary, VegetationModel } from "./Vegetation";
import { WaterBalanceModel } from "./WaterBalance";
import { lerp } from "../utils/math";

export interface SimulationSchedule {
  hydrologyStepSeconds: number;
  erosionStepSeconds: number;
  ecologyStepSeconds: number;
  vegetationStepSeconds: number;
  slowProcessStepSeconds: number;
  maxHydrologySubstepsPerAdvance: number;
  maxErosionSubstepsPerAdvance: number;
  maxEcologySubstepsPerAdvance: number;
  maxVegetationSubstepsPerAdvance: number;
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
  activeWaterSources: number;
  seasonLabel: string;
  seasonPhase: number;
  rainfallMultiplier: number;
  temperatureOffset: number;
  evaporationMultiplier: number;
}

const DEFAULT_SCHEDULE: SimulationSchedule = {
  hydrologyStepSeconds: 1 / 30,
  erosionStepSeconds: 1 / 6,
  ecologyStepSeconds: 0.25,
  vegetationStepSeconds: 0.75,
  slowProcessStepSeconds: 0.5,
  maxHydrologySubstepsPerAdvance: 90,
  maxErosionSubstepsPerAdvance: 18,
  maxEcologySubstepsPerAdvance: 10,
  maxVegetationSubstepsPerAdvance: 6,
  maxSlowSubstepsPerAdvance: 6,
  maxAdvanceSeconds: 2,
};

/**
 * Simulation coordinates terrain, rainfall, hydrology, water sinks, erosion,
 * and slower long-timescale terrain maintenance. The scheduler is explicit:
 * - fast cadence: rainfall + hydrology + water balance
 * - medium cadence: erosion/deposition
 * - ecological cadences: moisture response and slower vegetation dynamics
 * - slow cadence: terrain settling / relaxation
 *
 * Rendering remains frame-based, but simulation advances by fixed internal
 * steps so behavior is much less sensitive to render frame time.
 */
export class Simulation {
  public terrain: TerrainData;
  public waterDepth: Float32Array;
  public readonly flowAccumulation: Float32Array;
  public temperature: Float32Array;
  public soilMoisture: Float32Array;
  public persistentWetness: Float32Array;
  public floodProne: Float32Array;
  public vegetationBiomass: Float32Array;
  public vegetationDensity: Uint8Array;
  public vegetationProfile: Uint8Array;
  public vegetationSpeciesId: Uint16Array;
  public vegetationPhenotype: Uint8Array;
  public vegetationRevision = 0;
  public readonly rainfall: RainfallModel;
  public readonly schedule: SimulationSchedule;

  private hydrology: HydrologyModel;
  private erosion: ErosionModel;
  private moisture: MoistureModel;
  private soilStability: SoilStabilityModel;
  private sandbox: SandboxModel;
  private readonly seasonModel: SeasonModel;
  private readonly regionalClimate: RegionalClimateModel;
  private temperatureModel: TemperatureModel;
  private vegetation: VegetationModel;
  private readonly waterBalance: WaterBalanceModel;
  private localRainfallField: Float32Array;
  private localEvaporationField: Float32Array;
  private localSoilDryingField: Float32Array;
  private elapsedTimeSeconds = 0;
  private peakFlow = 0;
  private hydrologyAccumulator = 0;
  private erosionAccumulator = 0;
  private ecologyAccumulator = 0;
  private vegetationAccumulator = 0;
  private slowProcessAccumulator = 0;
  private readonly resolution: number;
  private readonly cellSize: number;
  private vegetationInitialized = false;
  private seasonState: SeasonState;

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
      options.initialRainIntensity ?? 0,
    );
    this.localRainfallField = new Float32Array(this.terrain.grid.cellCount);
    this.localEvaporationField = new Float32Array(this.terrain.grid.cellCount);
    this.localSoilDryingField = new Float32Array(this.terrain.grid.cellCount);

    this.hydrology = new HydrologyModel(
      this.terrain.grid,
      this.terrain.heights,
      this.waterDepth,
      this.flowAccumulation,
    );
    this.waterBalance = new WaterBalanceModel();
    this.sandbox = new SandboxModel(this.terrain.grid.cellCount);
    this.regionalClimate = new RegionalClimateModel();
    this.regionalClimate.rebuild(this.terrain.grid, this.terrain.seed);
    this.seasonModel = new SeasonModel();
    this.seasonModel.rebuild(
      this.terrain.grid,
      this.terrain.seed,
      this.regionalClimate.getSeasonalAmplitude(),
      this.regionalClimate.getClimateStability(),
      this.regionalClimate.getSeasonalPhaseAnchor(),
      this.regionalClimate.getSeasonalPhaseWindow(),
      this.regionalClimate.getPhaseLockStrength(),
    );
    this.erosion = new ErosionModel(
      this.terrain.grid,
      this.terrain.heights,
      this.terrain.bedrockHeights,
      this.terrain.soilDepth,
      this.terrain.coarseRock,
      this.waterDepth,
      this.flowAccumulation,
      this.hydrology.getFlowIntensity(),
    );
    this.moisture = new MoistureModel(this.terrain.grid.cellCount);
    this.soilStability = new SoilStabilityModel(this.terrain.grid.cellCount);
    this.temperatureModel = new TemperatureModel(
      this.terrain,
      this.regionalClimate.getMeanTemperatureBias(),
    );
    this.seasonState = this.seasonModel.getState();
    this.refreshClimateForcingFields();
    this.temperatureModel.applySeasonalOffsets(this.getLocalTemperatureOffsetField());
    this.vegetation = new VegetationModel(this.terrain.grid.cellCount, this.terrain.seed);
    this.temperature = this.temperatureModel.getTemperature();
    this.soilMoisture = this.moisture.getMoisture();
    this.persistentWetness = this.moisture.getPersistentWetness();
    this.floodProne = this.moisture.getFloodProne();
    this.vegetationBiomass = this.vegetation.getBiomass();
    this.vegetationDensity = this.vegetation.getDensityClass();
    this.vegetationProfile = this.vegetation.getProfileId();
    this.vegetationSpeciesId = this.vegetation.getDominantSpeciesId();
    this.vegetationPhenotype = this.vegetation.getPhenotypeClass();
    this.refreshSoilStability(0);
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
    this.vegetationAccumulator += clampedAdvance;
    this.slowProcessAccumulator += clampedAdvance;

    this.runHydrologyCadence();
    this.runErosionCadence();
    this.runEcologyCadence();
    this.runVegetationCadence();
    this.runSlowProcessCadence();
  }

  public reset(): void {
    this.hydrology.reset();
    this.erosion.reset();
    this.moisture.reset();
    this.soilStability.reset();
    this.vegetation.reset();
    this.waterDepth = this.hydrology.getWaterDepth();
    this.erosion.setWaterDepthBuffer(this.waterDepth);
    this.flowAccumulation.fill(0);
    this.elapsedTimeSeconds = 0;
    this.peakFlow = 0;
    this.hydrologyAccumulator = 0;
    this.erosionAccumulator = 0;
    this.ecologyAccumulator = 0;
    this.vegetationAccumulator = 0;
    this.slowProcessAccumulator = 0;
    this.vegetationInitialized = false;
    // Reset keeps persistent sandbox edits in the current world. Use terrain
    // regeneration or the erase tool if you want to clear user-made springs.
    this.seasonModel.reset();
    this.seasonState = this.seasonModel.getState();
    this.refreshClimateForcingFields();
    this.temperatureModel.applySeasonalOffsets(this.getLocalTemperatureOffsetField());
    this.temperature = this.temperatureModel.getTemperature();
    this.refreshSoilStability(0);
    this.syncVegetationState();
  }

  public regenerate(seed = Simulation.createSeed()): void {
    this.terrain = TerrainGenerator.generate({
      resolution: this.resolution,
      cellSize: this.cellSize,
      seed,
    });

    this.waterDepth = new Float32Array(this.terrain.grid.cellCount);
    this.localRainfallField = new Float32Array(this.terrain.grid.cellCount);
    this.localEvaporationField = new Float32Array(this.terrain.grid.cellCount);
    this.localSoilDryingField = new Float32Array(this.terrain.grid.cellCount);
    this.flowAccumulation.fill(0);
    this.elapsedTimeSeconds = 0;
    this.peakFlow = 0;
    this.hydrologyAccumulator = 0;
    this.erosionAccumulator = 0;
    this.ecologyAccumulator = 0;
    this.vegetationAccumulator = 0;
    this.slowProcessAccumulator = 0;
    this.seasonModel.reset();
    this.regionalClimate.rebuild(this.terrain.grid, this.terrain.seed);
    this.seasonModel.rebuild(
      this.terrain.grid,
      this.terrain.seed,
      this.regionalClimate.getSeasonalAmplitude(),
      this.regionalClimate.getClimateStability(),
      this.regionalClimate.getSeasonalPhaseAnchor(),
      this.regionalClimate.getSeasonalPhaseWindow(),
      this.regionalClimate.getPhaseLockStrength(),
    );

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
      this.terrain.bedrockHeights,
      this.terrain.soilDepth,
      this.terrain.coarseRock,
      this.waterDepth,
      this.flowAccumulation,
      this.hydrology.getFlowIntensity(),
    );
    this.moisture = new MoistureModel(this.terrain.grid.cellCount);
    this.soilStability = new SoilStabilityModel(this.terrain.grid.cellCount);
    this.sandbox = new SandboxModel(this.terrain.grid.cellCount);
    this.temperatureModel = new TemperatureModel(
      this.terrain,
      this.regionalClimate.getMeanTemperatureBias(),
    );
    this.seasonState = this.seasonModel.getState();
    this.refreshClimateForcingFields();
    this.temperatureModel.applySeasonalOffsets(this.getLocalTemperatureOffsetField());
    this.vegetation = new VegetationModel(this.terrain.grid.cellCount, this.terrain.seed);
    this.waterDepth = this.hydrology.getWaterDepth();
    this.erosion.setWaterDepthBuffer(this.waterDepth);
    this.temperature = this.temperatureModel.getTemperature();
    this.soilMoisture = this.moisture.getMoisture();
    this.persistentWetness = this.moisture.getPersistentWetness();
    this.floodProne = this.moisture.getFloodProne();
    this.vegetationBiomass = this.vegetation.getBiomass();
    this.vegetationDensity = this.vegetation.getDensityClass();
    this.vegetationProfile = this.vegetation.getProfileId();
    this.vegetationSpeciesId = this.vegetation.getDominantSpeciesId();
    this.vegetationPhenotype = this.vegetation.getPhenotypeClass();
    this.vegetationInitialized = false;
    this.refreshSoilStability(0);
    this.syncVegetationState();
  }

  public setRainIntensity(intensity: number): void {
    this.rainfall.setIntensity(intensity);
  }

  public getPlantSpeciesCatalog(): readonly PlantSpeciesDefinition[] {
    return this.vegetation.getSpeciesCatalog();
  }

  public initializeVegetationNow(): void {
    if (this.vegetationInitialized) {
      return;
    }

    this.initializeVegetation();
  }

  public getVegetationDebugSummary(): VegetationDebugSummary {
    return this.vegetation.getDebugSummary();
  }

  /**
   * Plant inspection is routed through the simulation so the UI can query one
   * coherent object that already combines vegetation, terrain, water, moisture,
   * temperature, and seasonal state.
   */
  public inspectPlantCell(cellX: number, cellY: number): PlantSelectionDiagnostics | null {
    if (!this.terrain.grid.isInside(cellX, cellY)) {
      return null;
    }

    const cellIndex = this.terrain.grid.index(cellX, cellY);
    const localSeason = this.seasonModel.getLocalFields();

    return this.vegetation.inspectCell(
      this.terrain,
      cellX,
      cellY,
      this.soilMoisture,
      this.temperature,
      this.persistentWetness,
      this.floodProne,
      this.waterDepth,
      this.soilStability.getRunoffShare(),
      this.soilStability.getInfiltrationShare(),
      this.soilStability.getSoilCohesion(),
      this.soilStability.getRootStabilization(),
      this.soilStability.getOrganicCover(),
      this.soilStability.getCombinedResistance(),
      this.soilStability.getBankStability(),
      this.soilStability.getDetachmentThreshold(),
      this.erosion.getArmoringField(),
      this.erosion.getErosivePowerField(),
      {
        phase: localSeason.phase[cellIndex],
        rainfallMultiplier: localSeason.rainfallMultiplier[cellIndex],
        temperatureOffset: localSeason.temperatureOffset[cellIndex],
        evaporationMultiplier: localSeason.evaporationMultiplier[cellIndex],
        seasonLabel: describeLocalSeason(localSeason.phase[cellIndex], this.seasonState.seasonLabel),
      },
    );
  }

  public getLocalSeasonPhaseField(): Float32Array {
    return this.seasonModel.getLocalFields().phase;
  }

  public getClimateMeanTemperatureField(): Float32Array {
    return this.regionalClimate.getMeanTemperatureBias();
  }

  public getClimateRainfallBaselineField(): Float32Array {
    return this.regionalClimate.getRainfallBaseline();
  }

  public getClimateSeasonalityField(): Float32Array {
    return this.regionalClimate.getSeasonalAmplitude();
  }

  public getClimateEvaporationPressureField(): Float32Array {
    return this.regionalClimate.getEvaporationPressure();
  }

  public getClimateStabilityField(): Float32Array {
    return this.regionalClimate.getClimateStability();
  }

  public getPlantActivityField(): Float32Array {
    return this.vegetation.getActivityField();
  }

  public getPlantReproductionReadinessField(): Float32Array {
    return this.vegetation.getReproductionReadinessField();
  }

  public getPlantStressField(): Float32Array {
    return this.vegetation.getStressField();
  }

  public getPlantSuitabilityField(): Float32Array {
    return this.vegetation.getSuitabilityField();
  }

  public applySandboxTool(
    mode: SandboxToolMode,
    cellX: number,
    cellY: number,
    brushRadiusCells: number,
    strength: number,
  ): void {
    if (!this.terrain.grid.isInside(cellX, cellY) || mode === "view") {
      return;
    }

    if (mode === "add_rock") {
      this.sandbox.addCoarseRock(this.terrain, cellX, cellY, brushRadiusCells, strength);
      recomputeTerrainBounds(this.terrain);
      return;
    }

    if (mode === "uplift") {
      this.sandbox.upliftTerrain(this.terrain, cellX, cellY, brushRadiusCells, strength);
      recomputeTerrainBounds(this.terrain);
      return;
    }

    if (mode === "lower") {
      this.sandbox.lowerTerrain(this.terrain, cellX, cellY, brushRadiusCells, strength);
      recomputeTerrainBounds(this.terrain);
      return;
    }

    if (mode === "flatten") {
      this.sandbox.planarizeTerrain(this.terrain, cellX, cellY, brushRadiusCells, strength);
      recomputeTerrainBounds(this.terrain);
      return;
    }

    if (mode === "roughen") {
      this.sandbox.roughenTerrain(this.terrain, cellX, cellY, brushRadiusCells, strength);
      recomputeTerrainBounds(this.terrain);
      return;
    }

    if (mode === "water_source") {
      this.sandbox.addWaterSource(this.terrain, cellX, cellY, brushRadiusCells, strength);
      return;
    }

    if (mode === "erase_water_source") {
      this.sandbox.eraseWaterSource(this.terrain, cellX, cellY, brushRadiusCells);
    }
  }

  public getMaterialResistanceField(): Float32Array {
    return this.erosion.getMaterialResistanceField();
  }

  public getArmoringField(): Float32Array {
    return this.erosion.getArmoringField();
  }

  public getSpillwayResistanceField(): Float32Array {
    return this.erosion.getSpillwayResistanceField();
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
      activeWaterSources: this.sandbox.getActiveSourceCount(),
      seasonLabel: this.seasonState.seasonLabel,
      seasonPhase: this.seasonState.phase,
      rainfallMultiplier: this.seasonState.rainfallMultiplier,
      temperatureOffset: this.seasonState.temperatureOffset,
      evaporationMultiplier: this.seasonState.evaporationMultiplier,
    };
  }

  private advanceSeason(dtSeconds: number): void {
    this.seasonModel.step(dtSeconds);
    this.seasonState = this.seasonModel.getState();
    this.refreshClimateForcingFields();
    this.temperatureModel.applySeasonalOffsets(this.getLocalTemperatureOffsetField());
    this.temperature = this.temperatureModel.getTemperature();
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

  private runVegetationCadence(): void {
    let steps = 0;

    while (
      this.vegetationAccumulator >= this.schedule.vegetationStepSeconds &&
      steps < this.schedule.maxVegetationSubstepsPerAdvance
    ) {
      this.runVegetationStep(this.schedule.vegetationStepSeconds);
      this.vegetationAccumulator -= this.schedule.vegetationStepSeconds;
      steps += 1;
    }

    if (steps >= this.schedule.maxVegetationSubstepsPerAdvance) {
      this.vegetationAccumulator = Math.min(
        this.vegetationAccumulator,
        this.schedule.vegetationStepSeconds,
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
    this.advanceSeason(stepSeconds);
    this.sandbox.applyWaterSources(this.waterDepth, stepSeconds);
    this.soilStability.applyRainfallPartition(
      this.rainfall,
      this.waterDepth,
      this.soilMoisture,
      this.getLocalRainfallField(),
      stepSeconds,
    );
    const hydrologyResult = this.hydrology.step(stepSeconds);
    this.waterDepth = this.hydrology.getWaterDepth();
    this.waterBalance.step(
      this.terrain,
      this.waterDepth,
      this.temperature,
      this.getLocalEvaporationField(),
      stepSeconds,
    );
    this.erosion.setWaterDepthBuffer(this.waterDepth);
    this.elapsedTimeSeconds += stepSeconds;
    this.peakFlow = Math.max(this.peakFlow, hydrologyResult.maxAccumulation);
  }

  private runErosionStep(stepSeconds: number): void {
    this.erosion.setWaterDepthBuffer(this.waterDepth);
    this.erosion.step(stepSeconds, this.terrain, this.getErosionStabilityInputs());
    recomputeTerrainBounds(this.terrain);
  }

  private runSlowProcessStep(stepSeconds: number): void {
    // Reserved for future hydrology-aware settling. The current simulation keeps
    // long-term terrain changes tied to explicit erosion and sandbox tools.
    void stepSeconds;
  }

  private runEcologyStep(stepSeconds: number): void {
    this.moisture.step(
      this.terrain,
      this.rainfall,
      this.waterDepth,
      this.temperature,
      this.flowAccumulation,
      this.hydrology.getFlowIntensity(),
      this.soilStability.getInfiltrationRecharge(),
      this.soilStability.getOrganicCover(),
      this.getLocalRainfallField(),
      this.getLocalSoilDryingField(),
      stepSeconds,
    );
    this.soilStability.clearHydrologySignals();
    this.soilMoisture = this.moisture.getMoisture();
    this.persistentWetness = this.moisture.getPersistentWetness();
    this.floodProne = this.moisture.getFloodProne();
    this.refreshSoilStability(stepSeconds);

  }

  private runVegetationStep(stepSeconds: number): void {
    if (!this.vegetationInitialized) {
      return;
    }

    this.vegetation.step(
      this.terrain,
      this.soilMoisture,
      this.temperature,
      this.persistentWetness,
      this.floodProne,
      this.waterDepth,
      this.seasonModel.getLocalFields().plantGrowthMultiplier,
      this.seasonModel.getLocalFields().plantStressMultiplier,
      stepSeconds,
    );
    this.vegetationBiomass = this.vegetation.getBiomass();
    this.vegetationDensity = this.vegetation.getDensityClass();
    this.vegetationProfile = this.vegetation.getProfileId();
    this.vegetationSpeciesId = this.vegetation.getDominantSpeciesId();
    this.vegetationPhenotype = this.vegetation.getPhenotypeClass();
    this.vegetationRevision += 1;
    this.refreshSoilStability(0);
  }

  private initializeVegetation(): void {
    this.vegetationInitialized = true;
    this.vegetation.initialize(
      this.terrain,
      this.rainfall.distribution,
      this.rainfall.getIntensity(),
      this.soilMoisture,
      this.temperature,
      this.persistentWetness,
      this.floodProne,
    );
    this.vegetationBiomass = this.vegetation.getBiomass();
    this.vegetationDensity = this.vegetation.getDensityClass();
    this.vegetationProfile = this.vegetation.getProfileId();
    this.vegetationSpeciesId = this.vegetation.getDominantSpeciesId();
    this.vegetationPhenotype = this.vegetation.getPhenotypeClass();
    this.vegetationRevision += 1;
    this.refreshSoilStability(0);
  }

  private syncVegetationState(): void {
    this.vegetationBiomass = this.vegetation.getBiomass();
    this.vegetationDensity = this.vegetation.getDensityClass();
    this.vegetationProfile = this.vegetation.getProfileId();
    this.vegetationSpeciesId = this.vegetation.getDominantSpeciesId();
    this.vegetationPhenotype = this.vegetation.getPhenotypeClass();
    this.vegetationRevision += 1;
  }

  private refreshSoilStability(stepSeconds: number): void {
    this.soilStability.updateEcology(
      this.terrain,
      this.soilMoisture,
      this.persistentWetness,
      this.temperature,
      this.vegetationBiomass,
      this.vegetationSpeciesId,
      this.vegetation.getSpeciesCatalog(),
      stepSeconds,
    );
  }

  private getErosionStabilityInputs(): ErosionStabilityInputs {
    return {
      runoffShare: this.soilStability.getRunoffShare(),
      infiltrationShare: this.soilStability.getInfiltrationShare(),
      soilCohesion: this.soilStability.getSoilCohesion(),
      rootStabilization: this.soilStability.getRootStabilization(),
      organicCover: this.soilStability.getOrganicCover(),
      combinedResistance: this.soilStability.getCombinedResistance(),
      bankStability: this.soilStability.getBankStability(),
      detachmentThreshold: this.soilStability.getDetachmentThreshold(),
    };
  }

  private getLocalTemperatureOffsetField(): Float32Array {
    return this.seasonModel.getLocalFields().temperatureOffset;
  }

  private getLocalRainfallField(): Float32Array {
    return this.localRainfallField;
  }

  private getLocalEvaporationField(): Float32Array {
    return this.localEvaporationField;
  }

  private getLocalSoilDryingField(): Float32Array {
    return this.localSoilDryingField;
  }

  private refreshClimateForcingFields(): void {
    const localSeason = this.seasonModel.getLocalFields();
    const climateRain = this.regionalClimate.getRainfallBaseline();
    const climateEvap = this.regionalClimate.getEvaporationPressure();

    for (let index = 0; index < this.localRainfallField.length; index += 1) {
      this.localRainfallField[index] = localSeason.rainfallMultiplier[index] * climateRain[index];
      this.localEvaporationField[index] =
        localSeason.evaporationMultiplier[index] * climateEvap[index];
      this.localSoilDryingField[index] =
        localSeason.soilDryingMultiplier[index] * lerp(0.85, climateEvap[index], 0.9);
    }
  }
}

function describeLocalSeason(localPhase: number, fallback: string): string {
  const wrapped = ((localPhase % 1) + 1) % 1;
  if (wrapped < 0.125) {
    return "Early Spring";
  }
  if (wrapped < 0.25) {
    return "Late Spring";
  }
  if (wrapped < 0.375) {
    return "Early Summer";
  }
  if (wrapped < 0.5) {
    return "Late Summer";
  }
  if (wrapped < 0.625) {
    return "Early Autumn";
  }
  if (wrapped < 0.75) {
    return "Late Autumn";
  }
  if (wrapped < 0.875) {
    return "Early Winter";
  }
  if (wrapped < 1) {
    return "Late Winter";
  }
  return fallback;
}
