import { clamp, lerp } from "../utils/math";
import { valueNoise2D } from "../utils/noise";
import type {
  PlantPopulationDiagnostics,
  PlantSelectionDiagnostics,
} from "./PlantDiagnostics";
import type { TerrainData } from "./Terrain";
import {
  computePlantSeasonalResponse,
  getInitialPlantSeasonalState,
  type PlantSeasonalitySettings,
} from "./PlantSeasonality";
import {
  buildHabitatPressureProfile,
  classifyPhenotype,
  createInitialSpeciesCatalog,
  deriveMorphologyEcologyEffects,
  dominantHabitatPressure,
  ECOLOGY_PROFILE_DRYLAND,
  ECOLOGY_PROFILE_MESIC,
  ECOLOGY_PROFILE_WETLAND,
  evaluateMorphologyHabitatFit,
  type HabitatPressureProfile,
  type PlantMorphologyEcologyEffects,
  mutateSpecies,
  summarizeMorphology,
  type PlantSpeciesDefinition,
  SPECIES_NONE,
} from "./PlantSpecies";

export const VEGETATION_PROFILE_NONE = 255;
export const VEGETATION_PROFILE_DRYLAND = ECOLOGY_PROFILE_DRYLAND;
export const VEGETATION_PROFILE_MESIC = ECOLOGY_PROFILE_MESIC;
export const VEGETATION_PROFILE_WETLAND = ECOLOGY_PROFILE_WETLAND;

export interface VegetationSettings {
  growthRate: number;
  declineRate: number;
  spreadRate: number;
  colonizationThreshold: number;
  reselectionThreshold: number;
  carryingCapacityStrength: number;
  standingWaterTolerance: number;
  floodStressStrength: number;
  droughtStressStrength: number;
  slopeStressStrength: number;
  mutationRate: number;
  mutationSupportThreshold: number;
  maxSpeciesCount: number;
  morphologyMaintenanceStrength: number;
  morphologyCompetitionStrength: number;
  morphologyDroughtStrength: number;
  morphologyFloodStrength: number;
  morphologyTerrainStrength: number;
  morphologySpreadStrength: number;
  morphologyEstablishmentStrength: number;
  establishmentDurationSeconds: number;
  establishmentBiomassFloor: number;
  establishmentTargetBiomass: number;
  establishmentMaintenanceShield: number;
  establishmentStressShield: number;
  establishmentCompetitionShield: number;
  establishmentGrowthBoost: number;
  establishmentCapacityBoost: number;
  establishmentReserveReliefBoost: number;
  seasonality: PlantSeasonalitySettings;
}

export interface VegetationDebugSummary {
  speciesCount: number;
  activeSpeciesCount: number;
  livingCellCount: number;
  denseCellCount: number;
  occupiedPercent: number;
  averageBiomass: number;
  averageLiveAgeSeconds: number;
  averageCompletedLifespanSeconds: number;
  oldestLiveAgeSeconds: number;
  dominantLineage: string;
  dominantPressure: string;
  lineageCounts: Record<string, number>;
  pressureCounts: Record<string, number>;
  averageMaintenanceCost: number;
  averageCompetitionStrength: number;
  averageDroughtBurden: number;
  averageFloodSuitability: number;
  averageTerrainStability: number;
  averageSpreadDrive: number;
  averageWoodiness: number;
  averageStature: number;
  averageCoverage: number;
  averageActivityLevel: number;
  averageReserveLevel: number;
  averageFoliageLevel: number;
  averageDormancyPressure: number;
  seasonalActivitySummary: string;
  seasonalSuppressionSummary: string;
  population: PlantPopulationDiagnostics;
}

const DEATH_REASON_NONE = 0;
const DEATH_REASON_CAPACITY = 1;
const DEATH_REASON_DROUGHT = 2;
const DEATH_REASON_FLOOD = 3;
const DEATH_REASON_TEMPERATURE = 4;
const DEATH_REASON_SLOPE = 5;
const DEATH_REASON_STANDING_WATER = 6;
const DEATH_REASON_MAINTENANCE = 7;
const DEATH_REASON_SEASONAL = 8;
const DEATH_REASON_MULTI = 9;
const DEATH_REASON_ESTABLISHMENT = 10;

interface PlantDevelopmentState {
  progress: number;
  stageLabel: string;
  establishmentBuffer: number;
  maintenanceShield: number;
  stressShield: number;
  competitionShield: number;
  growthBoost: number;
  capacityBonus: number;
  reserveReliefBoost: number;
}

/**
 * VegetationModel now bridges ecological fields and heritable species data.
 * Cells still keep a lightweight dominant-plant state, but that state now
 * points to a species definition with separate ecological and morphology
 * traits. This keeps the growth logic readable while giving rendering a stable
 * species-level morphology target to visualize.
 */
export class VegetationModel {
  public readonly settings: VegetationSettings = {
    growthRate: 0.17,
    declineRate: 0.11,
    spreadRate: 0.08,
    colonizationThreshold: 0.34,
    reselectionThreshold: 0.28,
    carryingCapacityStrength: 0.28,
    standingWaterTolerance: 0.14,
    floodStressStrength: 0.22,
    droughtStressStrength: 0.2,
    slopeStressStrength: 0.18,
    mutationRate: 0.022,
    mutationSupportThreshold: 0.48,
    maxSpeciesCount: 48,
    morphologyMaintenanceStrength: 0.16,
    morphologyCompetitionStrength: 0.18,
    morphologyDroughtStrength: 0.2,
    morphologyFloodStrength: 0.18,
    morphologyTerrainStrength: 0.17,
    morphologySpreadStrength: 0.18,
    morphologyEstablishmentStrength: 0.16,
    establishmentDurationSeconds: 22,
    establishmentBiomassFloor: 0.018,
    establishmentTargetBiomass: 0.12,
    establishmentMaintenanceShield: 0.58,
    establishmentStressShield: 0.52,
    establishmentCompetitionShield: 0.62,
    establishmentGrowthBoost: 0.55,
    establishmentCapacityBoost: 0.12,
    establishmentReserveReliefBoost: 0.8,
    seasonality: {
      activityResponseRate: 0.42,
      dormancyResponseRate: 0.38,
      foliageGrowthRate: 0.34,
      foliageDropRate: 0.42,
      storageGainRate: 0.26,
      storageUseRate: 0.3,
      dormancyStressRelief: 0.34,
      persistenceMaintenancePenalty: 0.18,
      reserveGrowthTradeoff: 0.34,
      reserveSpreadBenefit: 0.28,
    },
  };

  private readonly seed: number;
  private speciesCatalog: PlantSpeciesDefinition[];
  private nextSpeciesId: number;
  private vegetationStepCounter = 0;

  private readonly biomass: Float32Array;
  private readonly nextBiomass: Float32Array;
  private readonly densityClass: Uint8Array;
  private readonly ecologyProfileId: Uint8Array;
  private readonly dominantSpeciesId: Uint16Array;
  private readonly phenotypeClass: Uint8Array;
  private readonly ageSeconds: Float32Array;
  private readonly nextAgeSeconds: Float32Array;
  private readonly activityLevel: Float32Array;
  private readonly nextActivityLevel: Float32Array;
  private readonly reserveLevel: Float32Array;
  private readonly nextReserveLevel: Float32Array;
  private readonly foliageLevel: Float32Array;
  private readonly nextFoliageLevel: Float32Array;
  private readonly dormancyPressure: Float32Array;
  private readonly suitabilityField: Float32Array;
  private readonly carryingCapacityField: Float32Array;
  private readonly reproductionReadinessField: Float32Array;
  private readonly activityField: Float32Array;
  private readonly stressField: Float32Array;
  private readonly maintenanceField: Float32Array;
  private readonly droughtStressField: Float32Array;
  private readonly floodStressField: Float32Array;
  private readonly temperatureStressField: Float32Array;
  private readonly slopeStressField: Float32Array;
  private readonly standingWaterStressField: Float32Array;
  private readonly biomassNetDeltaField: Float32Array;
  private readonly growthGainField: Float32Array;
  private readonly colonizationGainField: Float32Array;
  private readonly declineLossField: Float32Array;
  private readonly maintenanceLossField: Float32Array;
  private readonly droughtLossField: Float32Array;
  private readonly floodLossField: Float32Array;
  private readonly slopeLossField: Float32Array;
  private readonly standingWaterLossField: Float32Array;
  private readonly storageReliefField: Float32Array;
  private readonly reserveDeltaField: Float32Array;
  private readonly reserveGainField: Float32Array;
  private readonly reserveUseField: Float32Array;
  private readonly storageDemandField: Float32Array;
  private readonly storageRecoveryField: Float32Array;
  private readonly opportunityField: Float32Array;
  private readonly unfavorablePressureField: Float32Array;
  private readonly maintenanceScaleField: Float32Array;
  private readonly waterDemandScaleField: Float32Array;
  private readonly growthScaleField: Float32Array;
  private readonly stressScaleField: Float32Array;
  private readonly targetActivityField: Float32Array;
  private readonly targetFoliageField: Float32Array;
  private readonly growthPotentialField: Float32Array;
  private readonly declinePressureField: Float32Array;
  private readonly effectiveCarryingCapacityField: Float32Array;
  private readonly establishmentBufferField: Float32Array;
  private readonly establishmentCapacityBonusField: Float32Array;
  private readonly establishmentBiomassFloorField: Float32Array;
  private readonly reserveReliefBoostField: Float32Array;
  private readonly competitionField: Float32Array;
  private readonly competitionAdvantageField: Float32Array;
  private readonly activityDeltaField: Float32Array;
  private readonly foliageDeltaField: Float32Array;
  private readonly growthSuppressionField: Float32Array;
  private readonly spreadScaleField: Float32Array;
  private readonly spreadDriveField: Float32Array;
  private readonly neighborSupport: Float32Array;
  private readonly nearbyWetness: Float32Array;
  private readonly recentDeathSpeciesId: Uint16Array;
  private readonly recentDeathGeneration: Uint8Array;
  private readonly recentDeathAgeSeconds: Float32Array;
  private readonly recentDeathBiomass: Float32Array;
  private readonly recentDeathReason: Uint8Array;
  private readonly historyLength = 16;
  private historyCursor = 0;
  private historySamples = 0;
  private readonly biomassHistory: Float32Array;
  private readonly reserveHistory: Float32Array;
  private readonly moistureHistory: Float32Array;
  private readonly stressHistory: Float32Array;
  private readonly reproductionHistory: Float32Array;
  private readonly recentColonizationsHistory: Uint16Array;
  private readonly recentDeathsHistory: Uint16Array;
  private readonly recentExtinctionsHistory: Uint16Array;
  private readonly previousOccupancyCounts: Int16Array;
  private readonly currentOccupancyCounts: Int16Array;
  private topExpandingLineages = "none";
  private topDecliningLineages = "none";
  private completedLifespanSeconds = 0;
  private completedLives = 0;

  public constructor(cellCount: number, seed: number) {
    this.seed = seed >>> 0;
    this.speciesCatalog = createInitialSpeciesCatalog(this.seed);
    this.nextSpeciesId = this.speciesCatalog.length;

    this.biomass = new Float32Array(cellCount);
    this.nextBiomass = new Float32Array(cellCount);
    this.densityClass = new Uint8Array(cellCount);
    this.ecologyProfileId = new Uint8Array(cellCount);
    this.ecologyProfileId.fill(VEGETATION_PROFILE_NONE);
    this.dominantSpeciesId = new Uint16Array(cellCount);
    this.dominantSpeciesId.fill(SPECIES_NONE);
    this.phenotypeClass = new Uint8Array(cellCount);
    this.ageSeconds = new Float32Array(cellCount);
    this.nextAgeSeconds = new Float32Array(cellCount);
    this.activityLevel = new Float32Array(cellCount);
    this.nextActivityLevel = new Float32Array(cellCount);
    this.reserveLevel = new Float32Array(cellCount);
    this.nextReserveLevel = new Float32Array(cellCount);
    this.foliageLevel = new Float32Array(cellCount);
    this.nextFoliageLevel = new Float32Array(cellCount);
    this.dormancyPressure = new Float32Array(cellCount);
    this.suitabilityField = new Float32Array(cellCount);
    this.carryingCapacityField = new Float32Array(cellCount);
    this.reproductionReadinessField = new Float32Array(cellCount);
    this.activityField = new Float32Array(cellCount);
    this.stressField = new Float32Array(cellCount);
    this.maintenanceField = new Float32Array(cellCount);
    this.droughtStressField = new Float32Array(cellCount);
    this.floodStressField = new Float32Array(cellCount);
    this.temperatureStressField = new Float32Array(cellCount);
    this.slopeStressField = new Float32Array(cellCount);
    this.standingWaterStressField = new Float32Array(cellCount);
    this.biomassNetDeltaField = new Float32Array(cellCount);
    this.growthGainField = new Float32Array(cellCount);
    this.colonizationGainField = new Float32Array(cellCount);
    this.declineLossField = new Float32Array(cellCount);
    this.maintenanceLossField = new Float32Array(cellCount);
    this.droughtLossField = new Float32Array(cellCount);
    this.floodLossField = new Float32Array(cellCount);
    this.slopeLossField = new Float32Array(cellCount);
    this.standingWaterLossField = new Float32Array(cellCount);
    this.storageReliefField = new Float32Array(cellCount);
    this.reserveDeltaField = new Float32Array(cellCount);
    this.reserveGainField = new Float32Array(cellCount);
    this.reserveUseField = new Float32Array(cellCount);
    this.storageDemandField = new Float32Array(cellCount);
    this.storageRecoveryField = new Float32Array(cellCount);
    this.opportunityField = new Float32Array(cellCount);
    this.unfavorablePressureField = new Float32Array(cellCount);
    this.maintenanceScaleField = new Float32Array(cellCount);
    this.waterDemandScaleField = new Float32Array(cellCount);
    this.growthScaleField = new Float32Array(cellCount);
    this.stressScaleField = new Float32Array(cellCount);
    this.targetActivityField = new Float32Array(cellCount);
    this.targetFoliageField = new Float32Array(cellCount);
    this.growthPotentialField = new Float32Array(cellCount);
    this.declinePressureField = new Float32Array(cellCount);
    this.effectiveCarryingCapacityField = new Float32Array(cellCount);
    this.establishmentBufferField = new Float32Array(cellCount);
    this.establishmentCapacityBonusField = new Float32Array(cellCount);
    this.establishmentBiomassFloorField = new Float32Array(cellCount);
    this.reserveReliefBoostField = new Float32Array(cellCount);
    this.competitionField = new Float32Array(cellCount);
    this.competitionAdvantageField = new Float32Array(cellCount);
    this.activityDeltaField = new Float32Array(cellCount);
    this.foliageDeltaField = new Float32Array(cellCount);
    this.growthSuppressionField = new Float32Array(cellCount);
    this.spreadScaleField = new Float32Array(cellCount);
    this.spreadDriveField = new Float32Array(cellCount);
    this.neighborSupport = new Float32Array(cellCount);
    this.nearbyWetness = new Float32Array(cellCount);
    this.recentDeathSpeciesId = new Uint16Array(cellCount);
    this.recentDeathSpeciesId.fill(SPECIES_NONE);
    this.recentDeathGeneration = new Uint8Array(cellCount);
    this.recentDeathAgeSeconds = new Float32Array(cellCount);
    this.recentDeathBiomass = new Float32Array(cellCount);
    this.recentDeathReason = new Uint8Array(cellCount);
    this.biomassHistory = new Float32Array(cellCount * this.historyLength);
    this.reserveHistory = new Float32Array(cellCount * this.historyLength);
    this.moistureHistory = new Float32Array(cellCount * this.historyLength);
    this.stressHistory = new Float32Array(cellCount * this.historyLength);
    this.reproductionHistory = new Float32Array(cellCount * this.historyLength);
    this.recentColonizationsHistory = new Uint16Array(this.historyLength);
    this.recentDeathsHistory = new Uint16Array(this.historyLength);
    this.recentExtinctionsHistory = new Uint16Array(this.historyLength);
    this.previousOccupancyCounts = new Int16Array(this.settings.maxSpeciesCount);
    this.currentOccupancyCounts = new Int16Array(this.settings.maxSpeciesCount);
  }

  public getBiomass(): Float32Array {
    return this.biomass;
  }

  public getDensityClass(): Uint8Array {
    return this.densityClass;
  }

  public getProfileId(): Uint8Array {
    return this.ecologyProfileId;
  }

  public getDominantSpeciesId(): Uint16Array {
    return this.dominantSpeciesId;
  }

  public getPhenotypeClass(): Uint8Array {
    return this.phenotypeClass;
  }

  public getSpeciesCatalog(): readonly PlantSpeciesDefinition[] {
    return this.speciesCatalog;
  }

  public getActivityField(): Float32Array {
    return this.activityField;
  }

  public getReproductionReadinessField(): Float32Array {
    return this.reproductionReadinessField;
  }

  public getStressField(): Float32Array {
    return this.stressField;
  }

  public getSuitabilityField(): Float32Array {
    return this.suitabilityField;
  }

  public getDebugSummary(): VegetationDebugSummary {
    const lineageCounts: Record<string, number> = {};
    const pressureCounts: Record<string, number> = {};
    const activeSpecies = new Set<number>();
    let livingCellCount = 0;
    let denseCellCount = 0;
    let biomassSum = 0;
    let ageSum = 0;
    let oldestLiveAgeSeconds = 0;
    let maintenanceSum = 0;
    let competitionSum = 0;
    let droughtSum = 0;
    let floodSum = 0;
    let terrainSum = 0;
    let spreadSum = 0;
    let woodinessSum = 0;
    let statureSum = 0;
    let coverageSum = 0;
    let activitySum = 0;
    let reserveSum = 0;
    let foliageSum = 0;
    let dormancySum = 0;

    for (let index = 0; index < this.dominantSpeciesId.length; index += 1) {
      const speciesId = this.dominantSpeciesId[index];
      if (speciesId === SPECIES_NONE || this.biomass[index] < 0.05) {
        continue;
      }

      const species = this.speciesCatalog[speciesId];
      if (!species) {
        continue;
      }

      const lineageLabel = `S${species.id} · G${species.generation}`;
      lineageCounts[lineageLabel] = (lineageCounts[lineageLabel] ?? 0) + 1;
      const habitat = buildHabitatPressureProfile(
        species.ecology.moisturePreference,
        species.ecology.optimalTemperature,
        species.ecology.persistentWetnessPreference,
        species.ecology.floodTolerance,
        species.ecology.standingWaterTolerance,
        1 - species.ecology.slopeTolerance,
        species.ecology.persistentWetnessPreference,
        1 - species.ecology.moisturePreference,
      );
      const pressureLabel = dominantHabitatPressure(habitat);
      const functionEffects = deriveMorphologyEcologyEffects(species);
      const morphologySummary = summarizeMorphology(species);
      pressureCounts[pressureLabel] = (pressureCounts[pressureLabel] ?? 0) + 1;
      activeSpecies.add(speciesId);
      livingCellCount += 1;
      if (this.densityClass[index] >= 3) {
        denseCellCount += 1;
      }
      biomassSum += this.biomass[index];
      ageSum += this.ageSeconds[index];
      oldestLiveAgeSeconds = Math.max(oldestLiveAgeSeconds, this.ageSeconds[index]);
      maintenanceSum += functionEffects.maintenanceCost;
      competitionSum += functionEffects.competitionStrength;
      droughtSum += functionEffects.droughtBurden;
      floodSum += functionEffects.floodSuitability;
      terrainSum += functionEffects.terrainStability;
      spreadSum += functionEffects.spreadDrive;
      woodinessSum += morphologySummary.woodiness;
      statureSum += morphologySummary.stature;
      coverageSum += morphologySummary.coverage;
      activitySum += this.activityLevel[index];
      reserveSum += this.reserveLevel[index];
      foliageSum += this.foliageLevel[index];
      dormancySum += this.dormancyPressure[index];
    }

    const dominantLineageEntry = Object.entries(lineageCounts).sort((left, right) => right[1] - left[1])[0];
    const dominantPressureEntry = Object.entries(pressureCounts).sort((left, right) => right[1] - left[1])[0];
    const averageActivityLevel = livingCellCount > 0 ? activitySum / livingCellCount : 0;
    const averageReserveLevel = livingCellCount > 0 ? reserveSum / livingCellCount : 0;
    const averageFoliageLevel = livingCellCount > 0 ? foliageSum / livingCellCount : 0;
    const averageDormancyPressure = livingCellCount > 0 ? dormancySum / livingCellCount : 0;

    return {
      speciesCount: this.speciesCatalog.length,
      activeSpeciesCount: activeSpecies.size,
      livingCellCount,
      denseCellCount,
      occupiedPercent:
        this.dominantSpeciesId.length > 0 ? (livingCellCount / this.dominantSpeciesId.length) * 100 : 0,
      averageBiomass: livingCellCount > 0 ? biomassSum / livingCellCount : 0,
      averageLiveAgeSeconds: livingCellCount > 0 ? ageSum / livingCellCount : 0,
      averageCompletedLifespanSeconds:
        this.completedLives > 0 ? this.completedLifespanSeconds / this.completedLives : 0,
      oldestLiveAgeSeconds,
      dominantLineage: dominantLineageEntry?.[0] ?? "none",
      dominantPressure: dominantPressureEntry?.[0] ?? "mixed",
      lineageCounts,
      pressureCounts,
      averageMaintenanceCost: livingCellCount > 0 ? maintenanceSum / livingCellCount : 0,
      averageCompetitionStrength: livingCellCount > 0 ? competitionSum / livingCellCount : 0,
      averageDroughtBurden: livingCellCount > 0 ? droughtSum / livingCellCount : 0,
      averageFloodSuitability: livingCellCount > 0 ? floodSum / livingCellCount : 0,
      averageTerrainStability: livingCellCount > 0 ? terrainSum / livingCellCount : 0,
      averageSpreadDrive: livingCellCount > 0 ? spreadSum / livingCellCount : 0,
      averageWoodiness: livingCellCount > 0 ? woodinessSum / livingCellCount : 0,
      averageStature: livingCellCount > 0 ? statureSum / livingCellCount : 0,
      averageCoverage: livingCellCount > 0 ? coverageSum / livingCellCount : 0,
      averageActivityLevel,
      averageReserveLevel,
      averageFoliageLevel,
      averageDormancyPressure,
      seasonalActivitySummary: this.describeSeasonalActivity(
        averageActivityLevel,
        averageReserveLevel,
        averageFoliageLevel,
      ),
      seasonalSuppressionSummary: this.describeSeasonalSuppression(
        averageDormancyPressure,
        averageReserveLevel,
        dominantPressureEntry?.[0] ?? "mixed",
      ),
      population: {
        recentColonizations: this.sumRecentHistory(this.recentColonizationsHistory),
        recentDeaths: this.sumRecentHistory(this.recentDeathsHistory),
        recentExtinctions: this.sumRecentHistory(this.recentExtinctionsHistory),
        averageReproductionReadiness:
          livingCellCount > 0 ? this.sumVisibleField(this.reproductionReadinessField) / livingCellCount : 0,
        topExpandingLineages: this.topExpandingLineages,
        topDecliningLineages: this.topDecliningLineages,
      },
    };
  }

  public reset(): void {
    this.speciesCatalog = createInitialSpeciesCatalog(this.seed);
    this.nextSpeciesId = this.speciesCatalog.length;
    this.vegetationStepCounter = 0;
    this.completedLifespanSeconds = 0;
    this.completedLives = 0;
    this.biomass.fill(0);
    this.nextBiomass.fill(0);
    this.densityClass.fill(0);
    this.ecologyProfileId.fill(VEGETATION_PROFILE_NONE);
    this.dominantSpeciesId.fill(SPECIES_NONE);
    this.phenotypeClass.fill(0);
    this.ageSeconds.fill(0);
    this.nextAgeSeconds.fill(0);
    this.activityLevel.fill(0);
    this.nextActivityLevel.fill(0);
    this.reserveLevel.fill(0);
    this.nextReserveLevel.fill(0);
    this.foliageLevel.fill(0);
    this.nextFoliageLevel.fill(0);
    this.dormancyPressure.fill(0);
    this.suitabilityField.fill(0);
    this.carryingCapacityField.fill(0);
    this.reproductionReadinessField.fill(0);
    this.activityField.fill(0);
    this.stressField.fill(0);
    this.maintenanceField.fill(0);
    this.droughtStressField.fill(0);
    this.floodStressField.fill(0);
    this.temperatureStressField.fill(0);
    this.slopeStressField.fill(0);
    this.standingWaterStressField.fill(0);
    this.biomassNetDeltaField.fill(0);
    this.growthGainField.fill(0);
    this.colonizationGainField.fill(0);
    this.declineLossField.fill(0);
    this.maintenanceLossField.fill(0);
    this.droughtLossField.fill(0);
    this.floodLossField.fill(0);
    this.slopeLossField.fill(0);
    this.standingWaterLossField.fill(0);
    this.storageReliefField.fill(0);
    this.reserveDeltaField.fill(0);
    this.reserveGainField.fill(0);
    this.reserveUseField.fill(0);
    this.storageDemandField.fill(0);
    this.storageRecoveryField.fill(0);
    this.opportunityField.fill(0);
    this.unfavorablePressureField.fill(0);
    this.maintenanceScaleField.fill(0);
    this.waterDemandScaleField.fill(0);
    this.growthScaleField.fill(0);
    this.stressScaleField.fill(0);
    this.targetActivityField.fill(0);
    this.targetFoliageField.fill(0);
    this.growthPotentialField.fill(0);
    this.declinePressureField.fill(0);
    this.effectiveCarryingCapacityField.fill(0);
    this.establishmentBufferField.fill(0);
    this.establishmentCapacityBonusField.fill(0);
    this.establishmentBiomassFloorField.fill(0);
    this.reserveReliefBoostField.fill(0);
    this.competitionField.fill(0);
    this.competitionAdvantageField.fill(0);
    this.activityDeltaField.fill(0);
    this.foliageDeltaField.fill(0);
    this.growthSuppressionField.fill(0);
    this.spreadScaleField.fill(0);
    this.spreadDriveField.fill(0);
    this.neighborSupport.fill(0);
    this.nearbyWetness.fill(0);
    this.recentDeathSpeciesId.fill(SPECIES_NONE);
    this.recentDeathGeneration.fill(0);
    this.recentDeathAgeSeconds.fill(0);
    this.recentDeathBiomass.fill(0);
    this.recentDeathReason.fill(0);
    this.historyCursor = 0;
    this.historySamples = 0;
    this.biomassHistory.fill(0);
    this.reserveHistory.fill(0);
    this.moistureHistory.fill(0);
    this.stressHistory.fill(0);
    this.reproductionHistory.fill(0);
    this.recentColonizationsHistory.fill(0);
    this.recentDeathsHistory.fill(0);
    this.recentExtinctionsHistory.fill(0);
    this.previousOccupancyCounts.fill(0);
    this.currentOccupancyCounts.fill(0);
    this.topExpandingLineages = "none";
    this.topDecliningLineages = "none";
  }

  /**
   * Initial seeding chooses a dominant species for each plausible cell. The
   * choice is deterministic and ecology-driven, so repeated seeds produce the
   * same starting biomes while still leaving room for later mutation.
   */
  public initialize(
    terrain: TerrainData,
    rainfallDistribution: Float32Array,
    rainIntensity: number,
    soilMoisture: Float32Array,
    temperature: Float32Array,
    persistentWetness: Float32Array,
    floodProne: Float32Array,
  ): void {
    this.reset();

    for (let y = 0; y < terrain.grid.height; y += 1) {
      for (let x = 0; x < terrain.grid.width; x += 1) {
        const index = terrain.grid.index(x, y);
        const slope = this.sampleSlope(terrain, x, y);
        const basinFactor = this.sampleBasinFactor(terrain, x, y);
        const normalizedElevation = this.normalizeElevation(terrain, index);
        const seededMoisture = clamp(
          soilMoisture[index] * 0.42 +
            persistentWetness[index] * 0.24 +
            rainIntensity * rainfallDistribution[index] * 0.24 +
            basinFactor * 0.1,
          0,
          1,
        );
        const seededWetness = clamp(
          persistentWetness[index] * 0.52 + basinFactor * 0.28 + seededMoisture * 0.2,
          0,
          1,
        );
        const seededHabitat = buildHabitatPressureProfile(
          seededMoisture,
          temperature[index],
          seededWetness,
          floodProne[index],
          0,
          slope,
          seededWetness,
          normalizedElevation,
        );
        const selection = this.pickBestSpecies(
          seededHabitat,
          seededMoisture,
          temperature[index],
          seededWetness,
          floodProne[index],
          0,
          slope,
          normalizedElevation,
        );
        const seedNoise = valueNoise2D(x * 0.18 + 11.7, y * 0.18 - 6.4, this.seed + 9011);
        const occupancyNoise = valueNoise2D(x * 0.31 - 17.4, y * 0.31 + 9.8, this.seed + 27191);
        const terrainSupport = clamp(
          (1 - slope) * 0.55 + basinFactor * 0.25 + (1 - normalizedElevation) * 0.2,
          0,
          1,
        );
        const establishment = selection.score * 0.68 + terrainSupport * 0.22 + seedNoise * 0.1;

        if (
          selection.speciesId === SPECIES_NONE ||
          selection.score < 0.22 ||
          establishment < 0.31 ||
          occupancyNoise < 0.75
        ) {
          continue;
        }

        // Keep the initial landscape noticeably sparser so vegetation has room
        // to expand through the simulation instead of starting close to a
        // mature cover state.
        const initialBiomass = clamp(
          (
            0.1 +
            selection.score * 0.32 +
            terrainSupport * 0.14 -
            Math.max(0, floodProne[index] - 0.58) * 0.18
          ) * 0.5,
          0,
          0.38,
        );

        this.biomass[index] = initialBiomass;
        this.assignSpeciesToCell(index, selection.speciesId);
        const species = this.speciesCatalog[selection.speciesId];
        if (species) {
          const seasonalState = getInitialPlantSeasonalState(species);
          this.activityLevel[index] = seasonalState.activityLevel;
          this.reserveLevel[index] = seasonalState.reserveLevel;
          this.foliageLevel[index] = seasonalState.foliageLevel;
          this.dormancyPressure[index] = seasonalState.dormancyPressure;
        }
      }
    }

    this.refreshDerivedState();
    this.pushHistorySamples(soilMoisture);
  }

  /**
   * Vegetation updates on its own ecological cadence. Cells only hold one
   * dominant species at a time, but that species can spread, get replaced by a
   * better adapted neighbor, or mutate during colonization into a descendant
   * species with slightly altered morphology and ecology.
   */
  public step(
    terrain: TerrainData,
    soilMoisture: Float32Array,
    temperature: Float32Array,
    persistentWetness: Float32Array,
    floodProne: Float32Array,
    waterDepth: Float32Array,
    seasonalGrowthMultiplier: number,
    seasonalStressMultiplier: number,
    dtSeconds: number,
  ): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return;
    }

    this.vegetationStepCounter += 1;
    const growthMultiplier = clamp(seasonalGrowthMultiplier, 0.6, 1.5);
    const stressMultiplier = clamp(seasonalStressMultiplier, 0.7, 1.8);
    let colonizationsThisStep = 0;
    let deathsThisStep = 0;
    this.updateNeighborhoodSignals(terrain, soilMoisture, persistentWetness);

    for (let y = 0; y < terrain.grid.height; y += 1) {
      for (let x = 0; x < terrain.grid.width; x += 1) {
        const index = terrain.grid.index(x, y);
        const slope = this.sampleSlope(terrain, x, y);
        const normalizedElevation = this.normalizeElevation(terrain, index);
        const moisture = soilMoisture[index];
        const wetness = persistentWetness[index];
        const flood = floodProne[index];
        const standingWater = clamp(waterDepth[index] / 0.05, 0, 1);
        const support = this.neighborSupport[index];
        const wetAdjacency = this.nearbyWetness[index];
        const habitat = buildHabitatPressureProfile(
          moisture,
          temperature[index],
          wetness,
          flood,
          standingWater,
          slope,
          wetAdjacency,
          normalizedElevation,
        );
        const neighborCandidate = this.selectNeighborSpeciesCandidate(terrain, x, y);
        const environmentCandidate = this.pickBestSpecies(
          habitat,
          moisture,
          temperature[index],
          wetness,
          flood,
          standingWater,
          slope,
          normalizedElevation,
        );
        const currentSpeciesId = this.dominantSpeciesId[index];
        const currentSpecies = currentSpeciesId === SPECIES_NONE ? null : this.speciesCatalog[currentSpeciesId];
        const currentBiomass = this.biomass[index];
        const currentAgeSeconds = this.ageSeconds[index];
        const currentActivity = this.activityLevel[index];
        const currentReserve = this.reserveLevel[index];
        const currentFoliage = this.foliageLevel[index];
        const currentSuitability = currentSpecies
          ? this.evaluateSpeciesSuitability(
              currentSpecies,
              habitat,
              moisture,
              temperature[index],
              wetness,
              flood,
              standingWater,
              slope,
              normalizedElevation,
            )
          : 0;
        let targetSpeciesId = currentSpeciesId;
        let targetSuitability = currentSuitability;

        if (neighborCandidate.score > targetSuitability + this.settings.reselectionThreshold) {
          targetSpeciesId = neighborCandidate.speciesId;
          targetSuitability = neighborCandidate.score;
        }

        if (
          environmentCandidate.score > targetSuitability + this.settings.reselectionThreshold * 1.12 &&
          currentBiomass < 0.14
        ) {
          targetSpeciesId = environmentCandidate.speciesId;
          targetSuitability = environmentCandidate.score;
        }

        let establishedSpeciesId = currentSpeciesId;
        if (
          currentSpeciesId !== SPECIES_NONE &&
          targetSpeciesId !== SPECIES_NONE &&
          currentSpeciesId !== targetSpeciesId &&
          currentBiomass < 0.1
        ) {
          this.assignSpeciesToCell(index, targetSpeciesId);
          establishedSpeciesId = targetSpeciesId;
        }

        const activeStressSpeciesId =
          establishedSpeciesId !== SPECIES_NONE ? establishedSpeciesId : targetSpeciesId;
        const activeStressSpecies =
          activeStressSpeciesId === SPECIES_NONE ? null : this.speciesCatalog[activeStressSpeciesId] ?? null;
        const baseSeasonalState =
          activeStressSpecies && activeStressSpeciesId !== currentSpeciesId
            ? getInitialPlantSeasonalState(activeStressSpecies)
            : {
                activityLevel: currentActivity,
                reserveLevel: currentReserve,
                foliageLevel: currentFoliage,
                dormancyPressure: this.dormancyPressure[index],
              };
        const seasonalResponse = activeStressSpecies
          ? computePlantSeasonalResponse(
              activeStressSpecies,
              habitat,
              baseSeasonalState.activityLevel,
              baseSeasonalState.reserveLevel,
              baseSeasonalState.foliageLevel,
              growthMultiplier,
              stressMultiplier,
              dtSeconds,
              this.settings.seasonality,
            )
          : this.getNeutralSeasonalResponse(currentActivity, currentReserve, currentFoliage);
        const morphologyEffects = activeStressSpecies
          ? deriveMorphologyEcologyEffects(activeStressSpecies)
          : this.getNeutralMorphologyEffects();
        const developmentState = activeStressSpecies
          ? this.resolveDevelopmentState(
              activeStressSpecies,
              currentBiomass,
              currentAgeSeconds,
              currentReserve,
            )
          : this.getNeutralDevelopmentState();
        const competitionAdvantage =
          habitat.fertileMoisture *
          habitat.stability *
          morphologyEffects.competitionStrength *
          this.settings.morphologyCompetitionStrength;
        const competition =
          support *
          this.settings.carryingCapacityStrength *
          (1.02 - competitionAdvantage * 0.34) *
          (1 - developmentState.establishmentBuffer * this.settings.establishmentCompetitionShield);
        const morphologyPerformance = activeStressSpecies
          ? evaluateMorphologyHabitatFit(activeStressSpecies, habitat)
          : 0.5;
        const establishmentCapacityBonus =
          developmentState.capacityBonus *
          (0.4 + targetSuitability * 0.38 + wetAdjacency * 0.12 + support * 0.1);
        const carryingCapacity = clamp(
          targetSuitability *
            (0.78 + morphologyPerformance * 0.14 + competitionAdvantage * 0.12) *
            (1 - competition * 0.45) *
            (
              0.86 +
              wetAdjacency * 0.08 +
              morphologyEffects.floodSuitability * habitat.channelInfluence * 0.06
            ) +
            establishmentCapacityBonus,
          0,
          1,
        );
        const droughtStress = activeStressSpecies
          ? this.computeDroughtStress(
              activeStressSpecies,
              moisture,
              morphologyEffects,
              habitat,
              seasonalResponse.waterDemandScale,
            )
          : 0;
        const floodStress = activeStressSpecies
          ? this.computeFloodStress(
              activeStressSpecies,
              flood,
              standingWater,
              morphologyEffects,
              seasonalResponse.stressScale,
            )
          : 0;
        const slopeStress = activeStressSpecies
          ? this.computeSlopeStress(
              activeStressSpecies,
              slope,
              morphologyEffects,
              seasonalResponse.stressScale,
            )
          : 0;
        const temperatureStress = activeStressSpecies
          ? this.computeTemperatureStress(activeStressSpecies, temperature[index], seasonalResponse.stressScale)
          : 0;

        let nextBiomass = currentBiomass;
        let nextActivity = 0;
        let nextReserve = 0;
        let nextFoliage = 0;
        let nextDormancyPressure = 0;
        let maintenancePressure = 0;
        let standingWaterStress = 0;
        let diagnosticSpreadScale = 0;
        let diagnosticSpreadDrive = 0;
        let diagnosticReproductionReadiness = seasonalResponse.reproductionReadiness;
        let growthPotential = 0;
        let declinePressure = 0;
        let effectiveCarryingCapacity = carryingCapacity;
        let growthGain = 0;
        let colonizationGain = 0;
        let declineLoss = 0;
        let maintenanceLoss = 0;
        let droughtLoss = 0;
        let floodLoss = 0;
        let slopeLoss = 0;
        let standingWaterLoss = 0;
        let storageRelief = 0;
        let growthSuppression = 0;
        let establishmentBiomassFloor = 0;

        if (currentSpeciesId !== SPECIES_NONE && targetSpeciesId !== SPECIES_NONE) {
          effectiveCarryingCapacity = clamp(
            carryingCapacity + developmentState.establishmentBuffer * 0.025,
            0,
            1,
          );
          growthPotential = clamp(effectiveCarryingCapacity - currentBiomass, 0, 1);
          declinePressure =
            clamp(currentBiomass - effectiveCarryingCapacity, 0, 1) *
            (1 - developmentState.establishmentBuffer * 0.72);
          standingWaterStress = Math.max(
            0,
            standingWater - this.resolveStandingWaterTolerance(this.dominantSpeciesId[index]),
          );
          maintenancePressure =
            morphologyEffects.maintenanceCost *
            this.settings.morphologyMaintenanceStrength *
            (0.42 + habitat.dryness * 0.34 + habitat.slope * 0.16 + standingWater * 0.08) *
            seasonalResponse.maintenanceScale *
            developmentState.maintenanceShield;
          diagnosticSpreadScale = seasonalResponse.spreadScale;
          diagnosticSpreadDrive = morphologyEffects.spreadDrive;
          growthSuppression = clamp(
            maintenancePressure * 0.28 + seasonalResponse.storageInvestmentCost * 0.3,
            0,
            0.95,
          );
          growthGain =
            growthPotential *
            this.settings.growthRate *
            (0.32 + support * 0.68) *
            (0.74 + morphologyPerformance * 0.16 + competitionAdvantage * 0.1) *
            (1 - growthSuppression) *
            seasonalResponse.growthScale *
            developmentState.growthBoost *
            growthMultiplier *
            this.resolveVigor(activeStressSpeciesId) *
            dtSeconds;
          declineLoss = declinePressure * this.settings.declineRate * dtSeconds;
          maintenanceLoss = maintenancePressure * dtSeconds;
          droughtLoss =
            droughtStress *
            this.settings.droughtStressStrength *
            stressMultiplier *
            seasonalResponse.stressScale *
            developmentState.stressShield *
            dtSeconds;
          floodLoss =
            floodStress *
            this.settings.floodStressStrength *
            stressMultiplier *
            lerp(seasonalResponse.stressScale, 1, 0.35) *
            developmentState.stressShield *
            dtSeconds;
          slopeLoss =
            slopeStress *
            this.settings.slopeStressStrength *
            lerp(stressMultiplier, 1, 0.5) *
            lerp(seasonalResponse.stressScale, 1, 0.45) *
            developmentState.stressShield *
            dtSeconds;
          standingWaterLoss =
            standingWaterStress *
            0.16 *
            seasonalResponse.stressScale *
            developmentState.stressShield *
            dtSeconds;
          storageRelief =
            seasonalResponse.storageSupport *
            0.12 *
            developmentState.reserveReliefBoost *
            dtSeconds;

          nextBiomass += growthGain;
          nextBiomass -=
            declineLoss +
            maintenanceLoss +
            droughtLoss +
            floodLoss +
            slopeLoss +
            standingWaterLoss -
            storageRelief;

          if (developmentState.establishmentBuffer > 0.02) {
            nextBiomass = Math.max(nextBiomass, currentBiomass * 0.78);
          }

          nextActivity = seasonalResponse.activityLevel;
          nextReserve = seasonalResponse.reserveLevel;
          nextFoliage = seasonalResponse.foliageLevel;
          nextDormancyPressure = seasonalResponse.dormancyPressure;
        } else {
          const colonizer = neighborCandidate.speciesId !== SPECIES_NONE ? neighborCandidate : environmentCandidate;

          if (colonizer.speciesId !== SPECIES_NONE && colonizer.score >= this.settings.colonizationThreshold) {
            const colonizerSpeciesId = this.maybeMutateColonizer(
              colonizer.speciesId,
              x,
              y,
              habitat,
              support,
              colonizer.score,
            );
            const spreadAbility = this.resolveSpreadAbility(colonizerSpeciesId);
            const vigor = this.resolveVigor(colonizerSpeciesId);
            const colonizerSpecies = this.speciesCatalog[colonizerSpeciesId];
            const colonizerEffects = colonizerSpecies
              ? deriveMorphologyEcologyEffects(colonizerSpecies)
              : this.getNeutralMorphologyEffects();
            const colonizerInitialSeasonalState = colonizerSpecies
              ? getInitialPlantSeasonalState(colonizerSpecies)
              : this.getNeutralSeasonalResponse(0.42, 0.1, 0.38);
            const colonizerSeasonalResponse = colonizerSpecies
              ? computePlantSeasonalResponse(
                  colonizerSpecies,
                  habitat,
                  colonizerInitialSeasonalState.activityLevel,
                  colonizerInitialSeasonalState.reserveLevel,
                  colonizerInitialSeasonalState.foliageLevel,
                  growthMultiplier,
                  stressMultiplier,
                  dtSeconds,
                  this.settings.seasonality,
                )
              : this.getNeutralSeasonalResponse(0.42, 0.1, 0.38);
            const spreadDrive =
              0.56 +
              colonizerEffects.spreadDrive * this.settings.morphologySpreadStrength * 1.6 -
              colonizerEffects.establishmentCost * this.settings.morphologyEstablishmentStrength * 0.8;
            const colonization =
              colonizer.score *
              support *
              this.settings.spreadRate *
              spreadAbility *
              spreadDrive *
              colonizerSeasonalResponse.spreadScale *
              (0.45 + colonizerSeasonalResponse.reproductionReadiness * 0.55) *
              growthMultiplier *
              (0.58 + vigor * 0.42) *
              dtSeconds;
            establishmentBiomassFloor = this.resolveColonizationBiomassFloor(
              colonizer.score,
              support,
              spreadAbility,
              vigor,
              colonizerEffects,
              colonizerSeasonalResponse,
            );
            nextBiomass = Math.max(colonization, establishmentBiomassFloor);
            colonizationGain = nextBiomass;
            if (nextBiomass >= 0.01) {
              this.assignSpeciesToCell(index, colonizerSpeciesId);
              colonizationsThisStep += 1;
              nextActivity = colonizerSeasonalResponse.activityLevel;
              nextReserve = colonizerSeasonalResponse.reserveLevel;
              nextFoliage = colonizerSeasonalResponse.foliageLevel;
              nextDormancyPressure = colonizerSeasonalResponse.dormancyPressure;
              diagnosticSpreadScale = colonizerSeasonalResponse.spreadScale;
              diagnosticSpreadDrive = colonizerEffects.spreadDrive;
              diagnosticReproductionReadiness = colonizerSeasonalResponse.reproductionReadiness;
            }
          }
        }

        nextBiomass = clamp(nextBiomass, 0, 1);

        if (nextBiomass < 0.01) {
          const deathReason = this.resolveDeathReason(
            declineLoss,
            maintenanceLoss,
            droughtLoss,
            floodLoss,
            temperatureStress,
            slopeLoss,
            standingWaterLoss,
            nextDormancyPressure,
            currentAgeSeconds,
            developmentState.establishmentBuffer,
          );
          this.recordRecentDeath(
            index,
            currentSpeciesId,
            currentAgeSeconds,
            currentBiomass,
            deathReason,
          );
          nextBiomass = 0;
          this.recordCompletedLife(currentSpeciesId, currentAgeSeconds);
          if (currentSpeciesId !== SPECIES_NONE) {
            deathsThisStep += 1;
          }
          this.clearCellSpecies(index);
          nextActivity = 0;
          nextReserve = 0;
          nextFoliage = 0;
          nextDormancyPressure = 0;
        }

        this.nextBiomass[index] = nextBiomass;
        this.nextAgeSeconds[index] = this.resolveNextAge(
          currentSpeciesId,
          this.dominantSpeciesId[index],
          currentAgeSeconds,
          nextBiomass,
          dtSeconds,
        );
        this.nextActivityLevel[index] = nextActivity;
        this.nextReserveLevel[index] = nextReserve;
        this.nextFoliageLevel[index] = nextFoliage;
        this.dormancyPressure[index] = nextDormancyPressure;
        this.suitabilityField[index] = targetSuitability;
        this.carryingCapacityField[index] = carryingCapacity;
        this.reproductionReadinessField[index] = diagnosticReproductionReadiness;
        this.activityField[index] = nextActivity;
        this.maintenanceField[index] = maintenancePressure;
        this.droughtStressField[index] = droughtStress;
        this.floodStressField[index] = floodStress;
        this.temperatureStressField[index] = temperatureStress;
        this.slopeStressField[index] = slopeStress;
        this.standingWaterStressField[index] = standingWaterStress;
        this.biomassNetDeltaField[index] = nextBiomass - currentBiomass;
        this.growthGainField[index] = growthGain;
        this.colonizationGainField[index] = colonizationGain;
        this.declineLossField[index] = declineLoss;
        this.maintenanceLossField[index] = maintenanceLoss;
        this.droughtLossField[index] = droughtLoss;
        this.floodLossField[index] = floodLoss;
        this.slopeLossField[index] = slopeLoss;
        this.standingWaterLossField[index] = standingWaterLoss;
        this.storageReliefField[index] = storageRelief;
        this.reserveDeltaField[index] = nextReserve - currentReserve;
        this.reserveGainField[index] = seasonalResponse.reserveGain;
        this.reserveUseField[index] = seasonalResponse.reserveUse;
        this.storageDemandField[index] = seasonalResponse.storageDemand;
        this.storageRecoveryField[index] = seasonalResponse.storageRecovery;
        this.opportunityField[index] = seasonalResponse.opportunity;
        this.unfavorablePressureField[index] = seasonalResponse.unfavorablePressure;
        this.maintenanceScaleField[index] = seasonalResponse.maintenanceScale;
        this.waterDemandScaleField[index] = seasonalResponse.waterDemandScale;
        this.growthScaleField[index] = seasonalResponse.growthScale;
        this.stressScaleField[index] = seasonalResponse.stressScale;
        this.targetActivityField[index] = seasonalResponse.targetActivity;
        this.targetFoliageField[index] = seasonalResponse.targetFoliage;
        this.growthPotentialField[index] = growthPotential;
        this.declinePressureField[index] = declinePressure;
        this.effectiveCarryingCapacityField[index] = effectiveCarryingCapacity;
        this.establishmentBufferField[index] = developmentState.establishmentBuffer;
        this.establishmentCapacityBonusField[index] = establishmentCapacityBonus;
        this.establishmentBiomassFloorField[index] = establishmentBiomassFloor;
        this.reserveReliefBoostField[index] = developmentState.reserveReliefBoost;
        this.competitionField[index] = competition;
        this.competitionAdvantageField[index] = competitionAdvantage;
        this.activityDeltaField[index] = nextActivity - currentActivity;
        this.foliageDeltaField[index] = nextFoliage - currentFoliage;
        this.growthSuppressionField[index] = growthSuppression;
        this.spreadScaleField[index] = diagnosticSpreadScale;
        this.spreadDriveField[index] = diagnosticSpreadDrive;
        this.stressField[index] = clamp(
          this.maintenanceField[index] * 0.35 +
            droughtStress * 0.28 +
            floodStress * 0.16 +
            temperatureStress * 0.1 +
            slopeStress * 0.07 +
            this.standingWaterStressField[index] * 0.04 +
            nextDormancyPressure * 0.18,
          0,
          1,
        );
      }
    }

    this.biomass.set(this.nextBiomass);
    this.ageSeconds.set(this.nextAgeSeconds);
    this.activityLevel.set(this.nextActivityLevel);
    this.reserveLevel.set(this.nextReserveLevel);
    this.foliageLevel.set(this.nextFoliageLevel);
    const extinctionsThisStep = this.updatePopulationChangeTracking();
    this.pushRecentCounts(colonizationsThisStep, deathsThisStep, extinctionsThisStep);
    this.pushHistorySamples(soilMoisture);
    this.refreshDerivedState();
  }

  public inspectCell(
    terrain: TerrainData,
    cellX: number,
    cellY: number,
    soilMoisture: Float32Array,
    temperature: Float32Array,
    persistentWetness: Float32Array,
    floodProne: Float32Array,
    waterDepth: Float32Array,
    runoffShare: Float32Array,
    infiltrationShare: Float32Array,
    soilCohesion: Float32Array,
    rootStabilization: Float32Array,
    organicCover: Float32Array,
    combinedResistance: Float32Array,
    bankStability: Float32Array,
    detachmentThreshold: Float32Array,
    armoring: Float32Array,
    erosivePower: Float32Array,
    season: {
      phase: number;
      rainfallMultiplier: number;
      temperatureOffset: number;
      evaporationMultiplier: number;
      seasonLabel: string;
    },
  ): PlantSelectionDiagnostics {
    const index = terrain.grid.index(cellX, cellY);
    const speciesId = this.dominantSpeciesId[index];
    const occupied = speciesId !== SPECIES_NONE && this.biomass[index] >= 0.01;
    const slope = this.sampleSlope(terrain, cellX, cellY);
    const normalizedElevation = this.normalizeElevation(terrain, index);
    const habitat = buildHabitatPressureProfile(
      soilMoisture[index],
      temperature[index],
      persistentWetness[index],
      floodProne[index],
      clamp(waterDepth[index] / 0.05, 0, 1),
      slope,
      this.nearbyWetness[index],
      normalizedElevation,
    );
    const bestCandidate = this.pickBestSpecies(
      habitat,
      soilMoisture[index],
      temperature[index],
      persistentWetness[index],
      floodProne[index],
      clamp(waterDepth[index] / 0.05, 0, 1),
      slope,
      normalizedElevation,
    );
    const species = occupied ? this.speciesCatalog[speciesId] ?? null : null;
    const suitability = occupied ? this.suitabilityField[index] : bestCandidate.score;
    const carryingCapacity = occupied ? this.carryingCapacityField[index] : 0;
    const effectiveCarryingCapacity = occupied ? this.effectiveCarryingCapacityField[index] : 0;
    const blockedReason = this.describeReproductionBlockReason(
      occupied,
      this.reproductionReadinessField[index],
      suitability,
      this.reserveLevel[index],
      species?.seasonal.reproductionThreshold ?? 0,
      this.neighborSupport[index],
      this.activityLevel[index],
    );
    const maturityLevel = species
      ? clamp(this.biomass[index] / Math.max(species.seasonal.reproductionThreshold, 0.08), 0, 1)
      : 0;
    const developmentProgress = occupied ? 1 - this.establishmentBufferField[index] : 0;
    const developmentStage = occupied
      ? this.describeDevelopmentStage(this.establishmentBufferField[index])
      : "empty";
    const dominantStress = this.getDominantStressLabel(
      this.droughtStressField[index],
      this.floodStressField[index],
      this.temperatureStressField[index],
      this.slopeStressField[index],
      this.maintenanceField[index],
      this.dormancyPressure[index],
      this.standingWaterStressField[index],
    );
    const explanation = occupied
      ? this.describeCellOutcome(index, suitability, effectiveCarryingCapacity, dominantStress)
      : this.describeEmptyCell(index, bestCandidate.score, dominantStress);
    const history = this.extractCellHistory(index);
    const ecologyTraits = species
      ? {
          moisturePreference: species.ecology.moisturePreference,
          moistureTolerance: species.ecology.moistureTolerance,
          floodTolerance: species.ecology.floodTolerance,
          droughtTolerance: species.ecology.droughtTolerance,
          temperatureOptimal: species.ecology.optimalTemperature,
          temperatureTolerance: species.ecology.temperatureTolerance,
          heatStressResistance: species.ecology.heatStressResistance,
          slopeTolerance: species.ecology.slopeTolerance,
          rootDepth: species.ecology.rootDepth,
          rootSpread: species.ecology.rootSpread,
          soilBindingStrength: species.ecology.soilBindingStrength,
          spreadAbility: species.ecology.spreadAbility,
          vigor: species.ecology.vigor,
        }
      : undefined;
    const morphologyTraits = species
      ? {
          maxHeight: species.morphology.maxHeight,
          woodiness: species.morphology.woodiness,
          stemCount: species.morphology.stemCount,
          trunkThickness: species.morphology.trunkThickness,
          branchingRate: species.morphology.branchingRate,
          crownRadius: species.morphology.crownRadius,
          crownDensity: species.morphology.crownDensity,
          foliageDensity: species.morphology.foliageDensity,
          lateralSpread: species.morphology.lateralSpread,
          groundCoverFactor: species.morphology.groundCoverFactor,
          clumping: species.morphology.clumping,
        }
      : undefined;
    const seasonalTraits = species
      ? {
          dormancyTendency: species.seasonal.dormancyTendency,
          drynessTrigger: species.seasonal.dormancyTriggerDryness,
          coldTrigger: species.seasonal.dormancyTriggerColdOrLowTemperature,
          storageCapacity: species.seasonal.resourceStorageCapacity,
          reactivationSpeed: species.seasonal.reactivationSpeed,
          growthWindowFlexibility: species.seasonal.growthWindowFlexibility,
          leafPersistence: species.seasonal.leafPersistence,
          leafDropBias: species.seasonal.leafDropBias,
          regrowthRate: species.seasonal.regrowthRate,
          reproductionThreshold: species.seasonal.reproductionThreshold,
        }
      : undefined;

    return {
      cellX,
      cellY,
      occupied,
      speciesId: occupied ? speciesId : null,
      parentSpeciesId: species?.parentId ?? null,
      generation: species?.generation ?? null,
      lineageLabel: occupied ? `S${speciesId} · G${species?.generation ?? 0}` : "empty habitat",
      explanation,
      currentState: {
        ageSeconds: this.ageSeconds[index],
        biomass: this.biomass[index],
        health: clamp(effectiveCarryingCapacity * (1 - this.stressField[index] * 0.72), 0, 1),
        vigor: species?.ecology.vigor ?? 0,
        developmentStage,
        developmentProgress,
        reserveLevel: this.reserveLevel[index],
        activityLevel: this.activityLevel[index],
        dormancyPressure: this.dormancyPressure[index],
        foliageLevel: this.foliageLevel[index],
        maturityLevel,
        reproductionReadiness: this.reproductionReadinessField[index],
      },
      reproduction: {
        allowedLikely:
          occupied &&
          this.reproductionReadinessField[index] >= 0.2 &&
          suitability >= this.settings.colonizationThreshold,
        blockedReason,
        spreadAbility: species?.ecology.spreadAbility ?? 0,
        spreadDrive: this.spreadDriveField[index],
        spreadScale: this.spreadScaleField[index],
        colonizationThreshold: this.settings.colonizationThreshold,
        localSuitability: suitability,
        reproductionThreshold: species?.seasonal.reproductionThreshold ?? 0,
        reserveSufficiency: species
          ? clamp(
              (this.reserveLevel[index] - species.seasonal.reproductionThreshold) /
                Math.max(1 - species.seasonal.reproductionThreshold, 0.08),
              0,
              1,
            )
          : 0,
        neighborSupport: this.neighborSupport[index],
      },
      decline: {
        maintenanceBurden: this.maintenanceField[index],
        droughtStress: this.droughtStressField[index],
        floodStress: this.floodStressField[index],
        temperatureStress: this.temperatureStressField[index],
        seasonalSuppression: this.dormancyPressure[index],
        slopeStress: this.slopeStressField[index],
        standingWaterStress: this.standingWaterStressField[index],
        carryingCapacityPressure: clamp(this.biomass[index] - effectiveCarryingCapacity, 0, 1),
        survivalMargin: effectiveCarryingCapacity - this.biomass[index],
        establishmentBuffer: this.establishmentBufferField[index],
        totalStress: this.stressField[index],
        dominantStress,
      },
      budget: {
        netBiomassDelta: this.biomassNetDeltaField[index],
        totalGain: this.growthGainField[index] + this.colonizationGainField[index] + this.storageReliefField[index],
        totalLoss:
          this.declineLossField[index] +
          this.maintenanceLossField[index] +
          this.droughtLossField[index] +
          this.floodLossField[index] +
          this.slopeLossField[index] +
          this.standingWaterLossField[index],
        growthGain: this.growthGainField[index],
        colonizationGain: this.colonizationGainField[index],
        declineLoss: this.declineLossField[index],
        maintenanceLoss: this.maintenanceLossField[index],
        droughtLoss: this.droughtLossField[index],
        floodLoss: this.floodLossField[index],
        slopeLoss: this.slopeLossField[index],
        standingWaterLoss: this.standingWaterLossField[index],
        storageRelief: this.storageReliefField[index],
        reserveDelta: this.reserveDeltaField[index],
        activityDelta: this.activityDeltaField[index],
        foliageDelta: this.foliageDeltaField[index],
        growthSuppression: this.growthSuppressionField[index],
        reserveGain: this.reserveGainField[index],
        reserveUse: this.reserveUseField[index],
        storageDemand: this.storageDemandField[index],
        storageRecovery: this.storageRecoveryField[index],
        opportunity: this.opportunityField[index],
        unfavorablePressure: this.unfavorablePressureField[index],
        maintenanceScale: this.maintenanceScaleField[index],
        waterDemandScale: this.waterDemandScaleField[index],
        growthScale: this.growthScaleField[index],
        stressScale: this.stressScaleField[index],
        targetActivity: this.targetActivityField[index],
        targetFoliage: this.targetFoliageField[index],
        growthPotential: this.growthPotentialField[index],
        declinePressure: this.declinePressureField[index],
        effectiveCarryingCapacity,
        establishmentCapacityBonus: this.establishmentCapacityBonusField[index],
        establishmentBiomassFloor: this.establishmentBiomassFloorField[index],
        competitionPressure: this.competitionField[index],
        competitionAdvantage: this.competitionAdvantageField[index],
        reserveReliefBoost: this.reserveReliefBoostField[index],
        growthBlockReason: this.describeGrowthBlockReason(
          this.effectiveCarryingCapacityField[index],
          this.biomass[index],
          this.growthPotentialField[index],
          this.activityLevel[index],
          this.growthScaleField[index],
          suitability,
          this.establishmentBufferField[index],
        ),
      },
      lastOccupant:
        !occupied && this.recentDeathSpeciesId[index] !== SPECIES_NONE
          ? {
              speciesId: this.recentDeathSpeciesId[index],
              generation: this.recentDeathGeneration[index],
              ageSeconds: this.recentDeathAgeSeconds[index],
              deathReason: this.deathReasonLabel(this.recentDeathReason[index]),
              biomassBeforeDeath: this.recentDeathBiomass[index],
            }
          : null,
      environment: {
        soilMoisture: soilMoisture[index],
        surfaceWater: waterDepth[index],
        persistentWetness: persistentWetness[index],
        floodProne: floodProne[index],
        temperature: temperature[index],
        slope,
        soilDepth: terrain.soilDepth[index],
        coarseSurface: terrain.coarseRock[index],
        bedrockExposure: clamp(
          1 - (terrain.heights[index] - terrain.bedrockHeights[index]) / Math.max(terrain.soilDepth[index] + terrain.coarseRock[index], 0.001),
          0,
          1,
        ),
        seasonPhase: season.phase,
        rainMultiplier: season.rainfallMultiplier,
        temperatureOffset: season.temperatureOffset,
        evaporationMultiplier: season.evaporationMultiplier,
        seasonLabel: season.seasonLabel,
      },
      erosion: {
        runoffShare: runoffShare[index],
        infiltrationShare: infiltrationShare[index],
        soilCohesion: soilCohesion[index],
        rootStabilization: rootStabilization[index],
        organicCover: organicCover[index],
        combinedResistance: combinedResistance[index],
        bankStability: bankStability[index],
        armoring: armoring[index],
        detachmentThreshold: detachmentThreshold[index],
        erosivePower: erosivePower[index],
      },
      fitness: {
        carryingCapacity: effectiveCarryingCapacity,
        suitability,
        positive: {
          biomassSupport: clamp(carryingCapacity, 0, 1),
          moistureSupport: habitat.moisture,
          wetAdjacency: this.nearbyWetness[index],
          activitySupport: this.activityLevel[index],
          reserveSupport: this.reserveLevel[index],
        },
        negative: {
          maintenance: this.maintenanceField[index],
          drought: this.droughtStressField[index],
          flood: this.floodStressField[index],
          temperature: this.temperatureStressField[index],
          slope: this.slopeStressField[index],
          dormancy: this.dormancyPressure[index],
        },
      },
      history,
      traits:
        species && ecologyTraits && morphologyTraits && seasonalTraits
          ? {
              ecology: ecologyTraits,
              morphology: morphologyTraits,
              seasonal: seasonalTraits,
            }
          : undefined,
    };
  }

  private refreshDerivedState(): void {
    for (let index = 0; index < this.biomass.length; index += 1) {
      const biomass = this.biomass[index];
      const speciesId = this.dominantSpeciesId[index];

      if (biomass < 0.08 || speciesId === SPECIES_NONE) {
        this.densityClass[index] = 0;
        if (biomass < 0.01) {
          this.clearCellSpecies(index);
        }
        continue;
      }

      this.densityClass[index] = biomass < 0.3 ? 1 : biomass < 0.62 ? 2 : 3;
      const species = this.speciesCatalog[speciesId];
      if (!species) {
        this.clearCellSpecies(index);
        this.densityClass[index] = 0;
        continue;
      }

      this.ecologyProfileId[index] = species.ecologyProfile;
      this.phenotypeClass[index] = species.phenotype;
    }
  }

  private updateNeighborhoodSignals(
    terrain: TerrainData,
    soilMoisture: Float32Array,
    persistentWetness: Float32Array,
  ): void {
    for (let y = 0; y < terrain.grid.height; y += 1) {
      for (let x = 0; x < terrain.grid.width; x += 1) {
        const index = terrain.grid.index(x, y);
        let biomassSum = this.biomass[index] * 0.38;
        let biomassWeight = 0.38;
        let nearbyWetness =
          clamp(soilMoisture[index] * 0.48 + persistentWetness[index] * 0.52, 0, 1) * 0.34;

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) {
              continue;
            }

            const sampleX = x + offsetX;
            const sampleY = y + offsetY;
            if (!terrain.grid.isInside(sampleX, sampleY)) {
              continue;
            }

            const sampleIndex = terrain.grid.index(sampleX, sampleY);
            const weight = offsetX === 0 || offsetY === 0 ? 0.11 : 0.06;
            biomassSum += this.biomass[sampleIndex] * weight;
            biomassWeight += weight;
            nearbyWetness +=
              clamp(soilMoisture[sampleIndex] * 0.54 + persistentWetness[sampleIndex] * 0.46, 0, 1) *
              (weight * 0.24);
          }
        }

        this.neighborSupport[index] = biomassWeight > 0 ? clamp(biomassSum / biomassWeight, 0, 1) : 0;
        this.nearbyWetness[index] = clamp(nearbyWetness, 0, 1);
      }
    }
  }

  private pickBestSpecies(
    habitat: HabitatPressureProfile,
    moisture: number,
    temperature: number,
    persistentWetness: number,
    floodProne: number,
    standingWater: number,
    slope: number,
    normalizedElevation: number,
  ): { speciesId: number; score: number } {
    let bestSpeciesId = SPECIES_NONE;
    let bestScore = 0;

    for (const species of this.speciesCatalog) {
      const score = this.evaluateSpeciesSuitability(
        species,
        habitat,
        moisture,
        temperature,
        persistentWetness,
        floodProne,
        standingWater,
        slope,
        normalizedElevation,
      );

      if (score > bestScore) {
        bestScore = score;
        bestSpeciesId = species.id;
      }
    }

    return { speciesId: bestSpeciesId, score: bestScore };
  }

  private evaluateSpeciesSuitability(
    species: PlantSpeciesDefinition,
    habitat: HabitatPressureProfile,
    moisture: number,
    temperature: number,
    persistentWetness: number,
    floodProne: number,
    standingWater: number,
    slope: number,
    normalizedElevation: number,
  ): number {
    const ecology = species.ecology;
    const moistureFit = this.preferenceFit(
      moisture,
      ecology.moisturePreference,
      ecology.moistureTolerance,
    );
    const wetnessFit = this.preferenceFit(
      persistentWetness,
      ecology.persistentWetnessPreference,
      Math.max(ecology.moistureTolerance * 0.9, 0.12),
    );
    const temperatureFit = this.preferenceFit(
      temperature,
      ecology.optimalTemperature,
      ecology.temperatureTolerance,
    );
    const droughtPenalty = clamp(
      (ecology.droughtTolerance - moisture) / Math.max(ecology.droughtTolerance, 0.12),
      0,
      1,
    );
    const temperaturePenalty = clamp(
      Math.abs(temperature - ecology.optimalTemperature) /
        Math.max(ecology.temperatureTolerance, 0.08),
      0,
      1,
    );
    const floodPenalty = clamp(
      (floodProne - ecology.floodTolerance) / Math.max(1 - ecology.floodTolerance, 0.12),
      0,
      1,
    );
    const standingWaterPenalty = clamp(
      (standingWater - ecology.standingWaterTolerance) /
        Math.max(1 - ecology.standingWaterTolerance, 0.12),
      0,
      1,
    );
    const slopePenalty = clamp(
      (slope - ecology.slopeTolerance) / Math.max(1 - ecology.slopeTolerance, 0.12),
      0,
      1,
    );
    const elevationBias =
      species.ecologyProfile === VEGETATION_PROFILE_DRYLAND
        ? normalizedElevation * 0.12
        : species.ecologyProfile === VEGETATION_PROFILE_WETLAND
          ? (1 - normalizedElevation) * 0.14
          : 0.08;
    const morphologyFit = evaluateMorphologyHabitatFit(species, habitat);
    const morphologyEffects = deriveMorphologyEcologyEffects(species);
    const competitiveBenefit =
      habitat.fertileMoisture *
      habitat.stability *
      morphologyEffects.competitionStrength *
      this.settings.morphologyCompetitionStrength;
    const droughtAmplification =
      1 + morphologyEffects.droughtBurden * this.settings.morphologyDroughtStrength;
    const floodAmplification =
      1 + (1 - morphologyEffects.floodSuitability) * this.settings.morphologyFloodStrength;
    const slopeAmplification =
      1 + (1 - morphologyEffects.terrainStability) * this.settings.morphologyTerrainStrength;
    const maintenancePenalty =
      morphologyEffects.maintenanceCost *
      this.settings.morphologyMaintenanceStrength *
      (0.34 + habitat.dryness * 0.26 + habitat.slope * 0.16);
    const spreadBonus =
      morphologyEffects.spreadDrive *
      this.settings.morphologySpreadStrength *
      (0.08 + habitat.stability * 0.04);

    return clamp(
      moistureFit * 0.36 +
        temperatureFit * 0.16 +
        wetnessFit * 0.24 +
        ecology.vigor * 0.16 +
        (1 - slopePenalty) * 0.12 +
        morphologyFit * 0.18 +
        competitiveBenefit * 0.12 +
        spreadBonus +
        elevationBias -
        maintenancePenalty -
        droughtPenalty * 0.18 * droughtAmplification -
        temperaturePenalty * 0.14 * (1 - ecology.heatStressResistance * 0.55) -
        floodPenalty * 0.24 * floodAmplification -
        standingWaterPenalty * 0.2 * floodAmplification -
        slopePenalty * 0.1 * slopeAmplification,
      0,
      1,
    );
  }

  private selectNeighborSpeciesCandidate(
    terrain: TerrainData,
    x: number,
    y: number,
  ): { speciesId: number; score: number } {
    let bestSpeciesId = SPECIES_NONE;
    let bestScore = 0;

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) {
          continue;
        }

        const sampleX = x + offsetX;
        const sampleY = y + offsetY;
        if (!terrain.grid.isInside(sampleX, sampleY)) {
          continue;
        }

        const sampleIndex = terrain.grid.index(sampleX, sampleY);
        const speciesId = this.dominantSpeciesId[sampleIndex];
        if (speciesId === SPECIES_NONE) {
          continue;
        }

        const species = this.speciesCatalog[speciesId];
        const effects = species ? deriveMorphologyEcologyEffects(species) : this.getNeutralMorphologyEffects();
        const weight =
          (offsetX === 0 || offsetY === 0 ? 1 : 0.76) *
          this.biomass[sampleIndex] *
          (0.84 + effects.competitionStrength * this.settings.morphologyCompetitionStrength);
        if (weight > bestScore) {
          bestScore = weight;
          bestSpeciesId = speciesId;
        }
      }
    }

    return { speciesId: bestSpeciesId, score: clamp(bestScore, 0, 1) };
  }

  private maybeMutateColonizer(
    speciesId: number,
    x: number,
    y: number,
    habitat: HabitatPressureProfile,
    support: number,
    suitability: number,
  ): number {
    if (
      speciesId === SPECIES_NONE ||
      this.speciesCatalog.length >= this.settings.maxSpeciesCount ||
      support < this.settings.mutationSupportThreshold ||
      suitability < 0.52
    ) {
      return speciesId;
    }

    const trigger = valueNoise2D(
      x * 0.37 + this.vegetationStepCounter * 0.11,
      y * 0.37 - this.vegetationStepCounter * 0.07,
      this.seed + speciesId * 9157,
    );

    if (trigger > this.settings.mutationRate) {
      return speciesId;
    }

    const parent = this.speciesCatalog[speciesId];
    if (!parent) {
      return speciesId;
    }

    const descendant = mutateSpecies(
      parent,
      this.nextSpeciesId,
      this.seed + this.vegetationStepCounter * 37,
      habitat,
    );
    descendant.phenotype = classifyPhenotype(descendant.morphology);
    this.speciesCatalog = [...this.speciesCatalog, descendant];
    this.nextSpeciesId += 1;
    return descendant.id;
  }

  private assignSpeciesToCell(index: number, speciesId: number): void {
    const species = this.speciesCatalog[speciesId];
    if (!species) {
      this.clearCellSpecies(index);
      return;
    }

    this.dominantSpeciesId[index] = species.id;
    this.ecologyProfileId[index] = species.ecologyProfile;
    this.phenotypeClass[index] = species.phenotype;
    this.recentDeathSpeciesId[index] = SPECIES_NONE;
    this.recentDeathGeneration[index] = 0;
    this.recentDeathAgeSeconds[index] = 0;
    this.recentDeathBiomass[index] = 0;
    this.recentDeathReason[index] = DEATH_REASON_NONE;
  }

  private resolveNextAge(
    previousSpeciesId: number,
    nextSpeciesId: number,
    currentAgeSeconds: number,
    nextBiomass: number,
    dtSeconds: number,
  ): number {
    if (nextBiomass < 0.01 || nextSpeciesId === SPECIES_NONE) {
      return 0;
    }

    if (previousSpeciesId !== SPECIES_NONE && previousSpeciesId !== nextSpeciesId) {
      this.recordCompletedLife(previousSpeciesId, currentAgeSeconds);
      return dtSeconds;
    }

    if (previousSpeciesId === SPECIES_NONE) {
      return dtSeconds;
    }

    return currentAgeSeconds + dtSeconds;
  }

  private recordCompletedLife(speciesId: number, ageSeconds: number): void {
    if (speciesId === SPECIES_NONE || ageSeconds <= 0.05) {
      return;
    }

    this.completedLifespanSeconds += ageSeconds;
    this.completedLives += 1;
  }

  private clearCellSpecies(index: number): void {
    this.dominantSpeciesId[index] = SPECIES_NONE;
    this.ecologyProfileId[index] = VEGETATION_PROFILE_NONE;
    this.phenotypeClass[index] = 0;
  }

  private resolveStandingWaterTolerance(speciesId: number): number {
    return speciesId === SPECIES_NONE
      ? this.settings.standingWaterTolerance
      : this.speciesCatalog[speciesId]?.ecology.standingWaterTolerance ?? this.settings.standingWaterTolerance;
  }

  /**
   * Drought tolerance should reduce drought stress, not act like a minimum
   * moisture requirement. The previous formula inverted that relationship and
   * made drought-tolerant plants die fastest when the moisture field started
   * low, causing synchronized die-offs across the map.
   */
  private computeDroughtStress(
    species: PlantSpeciesDefinition,
    moisture: number,
    morphologyEffects: PlantMorphologyEcologyEffects,
    habitat: HabitatPressureProfile,
    seasonalWaterDemandScale: number,
  ): number {
    const drynessDeficit = clamp(
      (species.ecology.moisturePreference - moisture) /
        Math.max(species.ecology.moisturePreference + species.ecology.moistureTolerance, 0.16),
      0,
      1,
    );
    const droughtBuffer = 1 - species.ecology.droughtTolerance * 0.82;
    const morphologyAmplification =
      1 +
      morphologyEffects.droughtBurden * this.settings.morphologyDroughtStrength * (0.72 + habitat.dryness * 0.48) -
      morphologyEffects.spreadDrive * 0.06;
    const heatAmplification =
      1 +
      habitat.heatStress *
        (0.2 + (1 - species.ecology.heatStressResistance) * 0.5);
    return (
      drynessDeficit *
      droughtBuffer *
      morphologyAmplification *
      heatAmplification *
      seasonalWaterDemandScale
    );
  }

  private computeFloodStress(
    species: PlantSpeciesDefinition,
    floodProne: number,
    standingWater: number,
    morphologyEffects: PlantMorphologyEcologyEffects,
    seasonalStressScale: number,
  ): number {
    const floodComponent = clamp(
      (floodProne - species.ecology.floodTolerance) /
        Math.max(1 - species.ecology.floodTolerance, 0.16),
      0,
      1,
    );
    const standingWaterComponent = clamp(
      (standingWater - species.ecology.standingWaterTolerance) /
        Math.max(1 - species.ecology.standingWaterTolerance, 0.16),
      0,
      1,
    );
    const morphologyBuffer =
      1 - morphologyEffects.floodSuitability * this.settings.morphologyFloodStrength * 0.7;
    return clamp(
      (floodComponent * 0.7 + standingWaterComponent * 0.3) * morphologyBuffer * seasonalStressScale,
      0,
      1,
    );
  }

  private computeTemperatureStress(
    species: PlantSpeciesDefinition,
    temperature: number,
    seasonalStressScale: number,
  ): number {
    const mismatch = clamp(
      Math.abs(temperature - species.ecology.optimalTemperature) /
        Math.max(species.ecology.temperatureTolerance, 0.08),
      0,
      1,
    );
    const heatPenalty = 1 - species.ecology.heatStressResistance * 0.55;
    return clamp(mismatch * heatPenalty * seasonalStressScale, 0, 1);
  }

  private computeSlopeStress(
    species: PlantSpeciesDefinition,
    slope: number,
    morphologyEffects: PlantMorphologyEcologyEffects,
    seasonalStressScale: number,
  ): number {
    const baseStress = clamp(
      (slope - species.ecology.slopeTolerance) / Math.max(1 - species.ecology.slopeTolerance, 0.16),
      0,
      1,
    );
    const morphologyAmplification =
      1 + (1 - morphologyEffects.terrainStability) * this.settings.morphologyTerrainStrength;
    return clamp(baseStress * morphologyAmplification * lerp(seasonalStressScale, 1, 0.4), 0, 1);
  }

  private getNeutralMorphologyEffects(): PlantMorphologyEcologyEffects {
    return {
      maintenanceCost: 0.5,
      droughtBurden: 0.5,
      competitionStrength: 0.5,
      floodSuitability: 0.5,
      terrainStability: 0.5,
      spreadDrive: 0.5,
      establishmentCost: 0.5,
    };
  }

  private getNeutralSeasonalResponse(activity: number, reserve: number, foliage: number) {
    return {
      activityLevel: activity,
      reserveLevel: reserve,
      foliageLevel: foliage,
      dormancyPressure: 0,
      targetActivity: activity,
      targetFoliage: foliage,
      opportunity: 0,
      unfavorablePressure: 0,
      storageDemand: 0,
      storageRecovery: 0,
      reserveGain: 0,
      reserveUse: 0,
      maintenanceScale: 1,
      waterDemandScale: 1,
      growthScale: 1,
      stressScale: 1,
      spreadScale: 1,
      reproductionReadiness: 0,
      storageInvestmentCost: 0,
      storageSupport: 0,
    };
  }

  /**
   * Development state keeps early-life survival generic and continuous.
   * Seedlings and fresh colonizers should not pay full mature-plant costs on
   * the first few ecology ticks, otherwise the system collapses before
   * selection can act. This stage signal fades out automatically with biomass,
   * reserves, and age.
   */
  private resolveDevelopmentState(
    species: PlantSpeciesDefinition,
    biomass: number,
    ageSeconds: number,
    reserveLevel: number,
  ): PlantDevelopmentState {
    const biomassProgress = clamp(
      biomass / Math.max(this.settings.establishmentTargetBiomass, 0.02),
      0,
      1,
    );
    const ageProgress = clamp(
      ageSeconds / Math.max(this.settings.establishmentDurationSeconds, 1),
      0,
      1,
    );
    const reserveProgress = clamp(
      reserveLevel / Math.max(species.seasonal.resourceStorageCapacity * 0.36 + 0.06, 0.06),
      0,
      1,
    );
    const progress = clamp(
      biomassProgress * 0.56 + ageProgress * 0.3 + reserveProgress * 0.14,
      0,
      1,
    );
    const establishmentBuffer = 1 - progress;

    return {
      progress,
      stageLabel: this.describeDevelopmentStage(establishmentBuffer),
      establishmentBuffer,
      maintenanceShield:
        1 - establishmentBuffer * this.settings.establishmentMaintenanceShield,
      stressShield: 1 - establishmentBuffer * this.settings.establishmentStressShield,
      competitionShield:
        1 - establishmentBuffer * this.settings.establishmentCompetitionShield,
      growthBoost: 1 + establishmentBuffer * this.settings.establishmentGrowthBoost,
      capacityBonus: establishmentBuffer * this.settings.establishmentCapacityBoost,
      reserveReliefBoost:
        1 + establishmentBuffer * this.settings.establishmentReserveReliefBoost,
    };
  }

  private getNeutralDevelopmentState(): PlantDevelopmentState {
    return {
      progress: 1,
      stageLabel: "mature",
      establishmentBuffer: 0,
      maintenanceShield: 1,
      stressShield: 1,
      competitionShield: 1,
      growthBoost: 1,
      capacityBonus: 0,
      reserveReliefBoost: 1,
    };
  }

  private describeDevelopmentStage(establishmentBuffer: number): string {
    if (establishmentBuffer > 0.66) {
      return "establishing";
    }
    if (establishmentBuffer > 0.26) {
      return "juvenile";
    }
    return "mature";
  }

  /**
   * Colonizers need an explicit establishment floor; otherwise spread can
   * successfully "happen" in the math while still producing biomass below the
   * live-cell cutoff, causing immediate invisible deaths.
   */
  private resolveColonizationBiomassFloor(
    suitability: number,
    neighborSupport: number,
    spreadAbility: number,
    vigor: number,
    morphologyEffects: PlantMorphologyEcologyEffects,
    seasonalResponse: ReturnType<typeof computePlantSeasonalResponse>,
  ): number {
    const establishmentSupport = clamp(
      suitability * 0.42 +
        neighborSupport * 0.2 +
        spreadAbility * 0.12 +
        vigor * 0.12 +
        seasonalResponse.opportunity * 0.08 +
        (1 - morphologyEffects.establishmentCost) * 0.06,
      0,
      1,
    );
    return clamp(
      this.settings.establishmentBiomassFloor *
        (0.78 + establishmentSupport * 0.7),
      this.settings.establishmentBiomassFloor * 0.8,
      0.08,
    );
  }

  private updatePopulationChangeTracking(): number {
    this.currentOccupancyCounts.fill(0);

    for (let index = 0; index < this.biomass.length; index += 1) {
      const speciesId = this.dominantSpeciesId[index];
      if (speciesId === SPECIES_NONE || this.biomass[index] < 0.05 || speciesId >= this.currentOccupancyCounts.length) {
        continue;
      }
      this.currentOccupancyCounts[speciesId] += 1;
    }

    let extinctions = 0;
    let bestIncrease = 0;
    let bestDecrease = 0;
    let bestIncreaseSpecies = -1;
    let bestDecreaseSpecies = -1;

    for (let speciesId = 0; speciesId < this.currentOccupancyCounts.length; speciesId += 1) {
      const delta = this.currentOccupancyCounts[speciesId] - this.previousOccupancyCounts[speciesId];
      if (this.previousOccupancyCounts[speciesId] > 0 && this.currentOccupancyCounts[speciesId] === 0) {
        extinctions += 1;
      }
      if (delta > bestIncrease) {
        bestIncrease = delta;
        bestIncreaseSpecies = speciesId;
      }
      if (delta < bestDecrease) {
        bestDecrease = delta;
        bestDecreaseSpecies = speciesId;
      }
      this.previousOccupancyCounts[speciesId] = this.currentOccupancyCounts[speciesId];
    }

    this.topExpandingLineages =
      bestIncreaseSpecies >= 0 && bestIncrease > 0
        ? `S${bestIncreaseSpecies} +${bestIncrease}`
        : "none";
    this.topDecliningLineages =
      bestDecreaseSpecies >= 0 && bestDecrease < 0
        ? `S${bestDecreaseSpecies} ${bestDecrease}`
        : "none";

    return extinctions;
  }

  private pushRecentCounts(colonizations: number, deaths: number, extinctions: number): void {
    this.recentColonizationsHistory[this.historyCursor] = colonizations;
    this.recentDeathsHistory[this.historyCursor] = deaths;
    this.recentExtinctionsHistory[this.historyCursor] = extinctions;
  }

  private pushHistorySamples(soilMoisture: Float32Array): void {
    const baseOffset = this.historyCursor * this.biomass.length;
    for (let index = 0; index < this.biomass.length; index += 1) {
      const offset = baseOffset + index;
      this.biomassHistory[offset] = this.biomass[index];
      this.reserveHistory[offset] = this.reserveLevel[index];
      this.moistureHistory[offset] = soilMoisture[index];
      this.stressHistory[offset] = this.stressField[index];
      this.reproductionHistory[offset] = this.reproductionReadinessField[index];
    }
    this.historyCursor = (this.historyCursor + 1) % this.historyLength;
    this.historySamples = Math.min(this.historySamples + 1, this.historyLength);
  }

  private extractCellHistory(index: number) {
    const biomass: number[] = [];
    const reserve: number[] = [];
    const moisture: number[] = [];
    const stress: number[] = [];
    const reproduction: number[] = [];
    for (let sample = 0; sample < this.historySamples; sample += 1) {
      const cursor = (this.historyCursor - this.historySamples + sample + this.historyLength) % this.historyLength;
      const offset = cursor * this.biomass.length + index;
      biomass.push(this.biomassHistory[offset]);
      reserve.push(this.reserveHistory[offset]);
      moisture.push(this.moistureHistory[offset]);
      stress.push(this.stressHistory[offset]);
      reproduction.push(this.reproductionHistory[offset]);
    }
    return { biomass, reserve, moisture, stress, reproduction };
  }

  private describeCellOutcome(
    index: number,
    suitability: number,
    carryingCapacity: number,
    dominantStress: string,
  ): string {
    const netDelta = this.biomassNetDeltaField[index];
    const establishmentBuffer = this.establishmentBufferField[index];
    if (netDelta < -0.004) {
      const strongestLoss = this.describeStrongestLoss(index);
      if (establishmentBuffer > 0.58) {
        return `Still establishing: biomass is falling because early-life losses from ${strongestLoss} are stronger than this step's establishment growth.`;
      }
      if (this.declinePressureField[index] > this.growthPotentialField[index] * 1.2) {
        return `Biomass is falling because current biomass is above carrying capacity, so decline pressure is stronger than new growth.`;
      }
      if (this.reserveDeltaField[index] > 0.01) {
        return `Biomass is shrinking because ${strongestLoss} outweighs growth, while reserves still rise through storage recovery and reserve gain.`;
      }
      return `Biomass is shrinking because ${strongestLoss} is larger than current growth input.`;
    }
    if (establishmentBuffer > 0.58 && netDelta >= -0.004) {
      return `Establishing successfully: early-life buffering is active while the plant builds biomass, reserves, and activity.`;
    }

    if (this.stressField[index] > 0.6) {
      return `Declining mainly due to ${dominantStress} with low effective capacity.`;
    }
    if (this.reproductionReadinessField[index] < 0.18) {
      return `Established but not spreading yet because reserves and readiness are still low.`;
    }
    if (this.activityLevel[index] < 0.28) {
      return `Present but seasonally suppressed, conserving reserves instead of growing.`;
    }
    if (suitability > 0.58 && carryingCapacity > this.biomass[index]) {
      return `Healthy and likely to expand if nearby gaps remain available.`;
    }
    return `Stable but constrained by ${dominantStress} and local carrying capacity.`;
  }

  private describeEmptyCell(index: number, bestScore: number, dominantStress: string): string {
    if (this.recentDeathSpeciesId[index] !== SPECIES_NONE) {
      return `Last occupant died mainly from ${this.deathReasonLabel(this.recentDeathReason[index])}; habitat is now ${bestScore >= this.settings.colonizationThreshold ? "recoverable" : "still too hostile"}.`;
    }
    if (bestScore < this.settings.colonizationThreshold) {
      return `Currently unsuitable for colonization, limited mostly by ${dominantStress}.`;
    }
    if (this.neighborSupport[index] < 0.08) {
      return `Suitable habitat, but nearby propagule support is still weak.`;
    }
    return `Potentially colonizable if neighboring species can supply enough spread pressure.`;
  }

  private getDominantStressLabel(
    drought: number,
    flood: number,
    temperature: number,
    slope: number,
    maintenance: number,
    dormancy: number,
    standingWater: number,
  ): string {
    const entries: Array<[string, number]> = [
      ["drought stress", drought],
      ["flood stress", flood],
      ["temperature stress", temperature],
      ["slope stress", slope],
      ["maintenance burden", maintenance],
      ["seasonal suppression", dormancy],
      ["standing water", standingWater],
    ];
    return entries.sort((left, right) => right[1] - left[1])[0]?.[0] ?? "mixed pressure";
  }

  private describeStrongestLoss(index: number): string {
    const entries: Array<[string, number]> = [
      ["capacity pressure", this.declineLossField[index]],
      ["maintenance cost", this.maintenanceLossField[index]],
      ["drought loss", this.droughtLossField[index]],
      ["flood loss", this.floodLossField[index]],
      ["slope loss", this.slopeLossField[index]],
      ["standing water loss", this.standingWaterLossField[index]],
    ];
    const [label] = entries.sort((left, right) => right[1] - left[1])[0] ?? ["mixed losses", 0];
    return label;
  }

  private describeGrowthBlockReason(
    carryingCapacity: number,
    biomass: number,
    growthPotential: number,
    activityLevel: number,
    growthScale: number,
    suitability: number,
    establishmentBuffer: number,
  ): string {
    if (establishmentBuffer > 0.58 && growthPotential > 0.02) {
      return "still establishing; growth is being protected while biomass base is built";
    }
    if (growthPotential <= 0.001 && biomass > carryingCapacity + 0.002) {
      return "biomass already exceeds local carrying capacity";
    }
    if (activityLevel < 0.16) {
      return "activity is too low for meaningful growth";
    }
    if (growthScale < 0.18) {
      return "seasonal growth scale is strongly suppressed";
    }
    if (suitability < this.settings.colonizationThreshold) {
      return "habitat suitability is weak";
    }
    if (growthPotential <= 0.001) {
      return "there is almost no remaining growth room in this cell";
    }
    return "growth is allowed";
  }

  private describeReproductionBlockReason(
    occupied: boolean,
    readiness: number,
    suitability: number,
    reserveLevel: number,
    reproductionThreshold: number,
    neighborSupport: number,
    activityLevel: number,
  ): string {
    if (!occupied) {
      return "empty cell";
    }
    if (activityLevel < 0.16) {
      return "seasonal activity is too low";
    }
    if (reserveLevel < reproductionThreshold) {
      return "reserves are below the species reproduction threshold";
    }
    if (readiness < 0.2) {
      return "reproduction readiness is still too low";
    }
    if (suitability < this.settings.colonizationThreshold) {
      return "local habitat suitability is below colonization threshold";
    }
    if (neighborSupport < 0.05) {
      return "nearby propagule support is weak";
    }
    return "conditions currently allow spread";
  }

  private resolveDeathReason(
    declineLoss: number,
    maintenanceLoss: number,
    droughtLoss: number,
    floodLoss: number,
    temperatureStress: number,
    slopeLoss: number,
    standingWaterLoss: number,
    dormancyPressure: number,
    ageSeconds: number,
    establishmentBuffer: number,
  ): number {
    if (
      ageSeconds < this.settings.establishmentDurationSeconds * 0.75 &&
      establishmentBuffer > 0.52 &&
      maintenanceLoss + declineLoss + droughtLoss + floodLoss + slopeLoss + standingWaterLoss > 0.004
    ) {
      return DEATH_REASON_ESTABLISHMENT;
    }
    const entries: Array<[number, number]> = [
      [DEATH_REASON_CAPACITY, declineLoss],
      [DEATH_REASON_MAINTENANCE, maintenanceLoss],
      [DEATH_REASON_DROUGHT, droughtLoss],
      [DEATH_REASON_FLOOD, floodLoss],
      [DEATH_REASON_TEMPERATURE, temperatureStress * 0.02],
      [DEATH_REASON_SLOPE, slopeLoss],
      [DEATH_REASON_STANDING_WATER, standingWaterLoss],
      [DEATH_REASON_SEASONAL, dormancyPressure * 0.02],
    ];
    const sorted = entries.sort((left, right) => right[1] - left[1]);
    const strongest = sorted[0];
    const second = sorted[1];
    if (!strongest || strongest[1] <= 0.001) {
      return DEATH_REASON_NONE;
    }
    if (second && second[1] > strongest[1] * 0.72) {
      return DEATH_REASON_MULTI;
    }
    return strongest[0];
  }

  private recordRecentDeath(
    index: number,
    speciesId: number,
    ageSeconds: number,
    biomass: number,
    deathReason: number,
  ): void {
    if (speciesId === SPECIES_NONE) {
      return;
    }
    this.recentDeathSpeciesId[index] = speciesId;
    this.recentDeathGeneration[index] = this.speciesCatalog[speciesId]?.generation ?? 0;
    this.recentDeathAgeSeconds[index] = ageSeconds;
    this.recentDeathBiomass[index] = biomass;
    this.recentDeathReason[index] = deathReason;
  }

  private deathReasonLabel(reason: number): string | null {
    switch (reason) {
      case DEATH_REASON_CAPACITY:
        return "carrying-capacity pressure";
      case DEATH_REASON_DROUGHT:
        return "drought";
      case DEATH_REASON_FLOOD:
        return "flooding";
      case DEATH_REASON_TEMPERATURE:
        return "temperature mismatch";
      case DEATH_REASON_SLOPE:
        return "slope stress";
      case DEATH_REASON_STANDING_WATER:
        return "standing water";
      case DEATH_REASON_MAINTENANCE:
        return "maintenance burden";
      case DEATH_REASON_SEASONAL:
        return "seasonal suppression";
      case DEATH_REASON_MULTI:
        return "multiple combined stresses";
      case DEATH_REASON_ESTABLISHMENT:
        return "establishment failure";
      default:
        return null;
    }
  }

  private sumRecentHistory(history: Uint16Array): number {
    let sum = 0;
    for (let index = 0; index < history.length; index += 1) {
      sum += history[index];
    }
    return sum;
  }

  private sumVisibleField(field: Float32Array): number {
    let sum = 0;
    for (let index = 0; index < this.biomass.length; index += 1) {
      if (this.biomass[index] < 0.05 || this.dominantSpeciesId[index] === SPECIES_NONE) {
        continue;
      }
      sum += field[index];
    }
    return sum;
  }

  private resolveSpreadAbility(speciesId: number): number {
    return speciesId === SPECIES_NONE ? 0.25 : this.speciesCatalog[speciesId]?.ecology.spreadAbility ?? 0.25;
  }

  private resolveVigor(speciesId: number): number {
    return speciesId === SPECIES_NONE ? 0.5 : this.speciesCatalog[speciesId]?.ecology.vigor ?? 0.5;
  }

  private preferenceFit(value: number, center: number, tolerance: number): number {
    return clamp(1 - Math.abs(value - center) / Math.max(tolerance, 1e-6), 0, 1);
  }

  private sampleSlope(terrain: TerrainData, x: number, y: number): number {
    const left = terrain.heights[terrain.grid.index(Math.max(x - 1, 0), y)];
    const right = terrain.heights[terrain.grid.index(Math.min(x + 1, terrain.grid.width - 1), y)];
    const top = terrain.heights[terrain.grid.index(x, Math.max(y - 1, 0))];
    const bottom = terrain.heights[terrain.grid.index(x, Math.min(y + 1, terrain.grid.height - 1))];
    const dx = Math.abs(right - left);
    const dy = Math.abs(bottom - top);
    return Math.min(1, (dx + dy) / 10);
  }

  private sampleBasinFactor(terrain: TerrainData, x: number, y: number): number {
    const center = terrain.heights[terrain.grid.index(x, y)];
    let neighborSum = 0;
    let neighborCount = 0;

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) {
          continue;
        }

        const sampleX = x + offsetX;
        const sampleY = y + offsetY;
        if (!terrain.grid.isInside(sampleX, sampleY)) {
          continue;
        }

        neighborSum += terrain.heights[terrain.grid.index(sampleX, sampleY)];
        neighborCount += 1;
      }
    }

    if (neighborCount === 0) {
      return 0;
    }

    return clamp((neighborSum / neighborCount - center) / 2.6, 0, 1);
  }

  private normalizeElevation(terrain: TerrainData, index: number): number {
    return clamp(
      (terrain.heights[index] - terrain.minHeight) / Math.max(terrain.maxHeight - terrain.minHeight, 1e-6),
      0,
      1,
    );
  }

  private describeSeasonalActivity(
    averageActivityLevel: number,
    averageReserveLevel: number,
    averageFoliageLevel: number,
  ): string {
    if (averageActivityLevel < 0.24) {
      return `low activity, reserves ${averageReserveLevel.toFixed(2)}, foliage ${averageFoliageLevel.toFixed(2)}`;
    }

    if (averageActivityLevel < 0.52) {
      return `reduced activity, reserves ${averageReserveLevel.toFixed(2)}, foliage ${averageFoliageLevel.toFixed(2)}`;
    }

    return `active growth, reserves ${averageReserveLevel.toFixed(2)}, foliage ${averageFoliageLevel.toFixed(2)}`;
  }

  private describeSeasonalSuppression(
    averageDormancyPressure: number,
    averageReserveLevel: number,
    dominantPressure: string,
  ): string {
    if (averageDormancyPressure < 0.16) {
      return `little seasonal suppression, dominant pressure ${dominantPressure}`;
    }

    if (averageReserveLevel > 0.34) {
      return `seasonal suppression buffered by stored reserves, dominant pressure ${dominantPressure}`;
    }

    return `seasonal suppression driven by ${dominantPressure}`;
  }
}
