import { clamp, lerp } from "../utils/math";
import { valueNoise2D } from "../utils/noise";
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
  phenotypeName,
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
  dominantPhenotype: string;
  dominantPressure: string;
  phenotypeCounts: Record<string, number>;
  pressureCounts: Record<string, number>;
  averageMaintenanceCost: number;
  averageCompetitionStrength: number;
  averageDroughtBurden: number;
  averageFloodSuitability: number;
  averageTerrainStability: number;
  averageSpreadDrive: number;
  averageActivityLevel: number;
  averageReserveLevel: number;
  averageFoliageLevel: number;
  averageDormancyPressure: number;
  seasonalActivitySummary: string;
  seasonalSuppressionSummary: string;
}

/**
 * VegetationModel now bridges ecological fields and heritable species data.
 * Cells still keep a lightweight dominant-plant state, but that state now
 * points to a species definition with separate ecological and morphology
 * traits. This keeps the growth logic readable while giving rendering a stable
 * phenotype target to visualize.
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
  private readonly neighborSupport: Float32Array;
  private readonly nearbyWetness: Float32Array;
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
    this.neighborSupport = new Float32Array(cellCount);
    this.nearbyWetness = new Float32Array(cellCount);
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

  public getDebugSummary(): VegetationDebugSummary {
    const phenotypeCounts: Record<string, number> = {};
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

      const label = phenotypeName(species.phenotype);
      phenotypeCounts[label] = (phenotypeCounts[label] ?? 0) + 1;
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
      activitySum += this.activityLevel[index];
      reserveSum += this.reserveLevel[index];
      foliageSum += this.foliageLevel[index];
      dormancySum += this.dormancyPressure[index];
    }

    const dominantPhenotypeEntry = Object.entries(phenotypeCounts).sort((left, right) => right[1] - left[1])[0];
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
      dominantPhenotype: dominantPhenotypeEntry?.[0] ?? "none",
      dominantPressure: dominantPressureEntry?.[0] ?? "mixed",
      phenotypeCounts,
      pressureCounts,
      averageMaintenanceCost: livingCellCount > 0 ? maintenanceSum / livingCellCount : 0,
      averageCompetitionStrength: livingCellCount > 0 ? competitionSum / livingCellCount : 0,
      averageDroughtBurden: livingCellCount > 0 ? droughtSum / livingCellCount : 0,
      averageFloodSuitability: livingCellCount > 0 ? floodSum / livingCellCount : 0,
      averageTerrainStability: livingCellCount > 0 ? terrainSum / livingCellCount : 0,
      averageSpreadDrive: livingCellCount > 0 ? spreadSum / livingCellCount : 0,
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
    this.neighborSupport.fill(0);
    this.nearbyWetness.fill(0);
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
        const competitionAdvantage =
          habitat.fertileMoisture *
          habitat.stability *
          morphologyEffects.competitionStrength *
          this.settings.morphologyCompetitionStrength;
        const competition =
          support *
          this.settings.carryingCapacityStrength *
          (1.02 - competitionAdvantage * 0.34);
        const morphologyPerformance = activeStressSpecies
          ? evaluateMorphologyHabitatFit(activeStressSpecies, habitat)
          : 0.5;
        const carryingCapacity = clamp(
          targetSuitability *
            (0.78 + morphologyPerformance * 0.14 + competitionAdvantage * 0.12) *
            (1 - competition * 0.45) *
            (
              0.86 +
              wetAdjacency * 0.08 +
              morphologyEffects.floodSuitability * habitat.channelInfluence * 0.06
            ),
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

        let nextBiomass = currentBiomass;
        let nextActivity = 0;
        let nextReserve = 0;
        let nextFoliage = 0;
        let nextDormancyPressure = 0;

        if (currentSpeciesId !== SPECIES_NONE && targetSpeciesId !== SPECIES_NONE) {
          const growthPotential = clamp(carryingCapacity - currentBiomass, 0, 1);
          const declinePressure = clamp(currentBiomass - carryingCapacity, 0, 1);
          const standingWaterStress = Math.max(
            0,
            standingWater - this.resolveStandingWaterTolerance(this.dominantSpeciesId[index]),
          );
          const maintenancePressure =
            morphologyEffects.maintenanceCost *
            this.settings.morphologyMaintenanceStrength *
            (0.42 + habitat.dryness * 0.34 + habitat.slope * 0.16 + standingWater * 0.08) *
            seasonalResponse.maintenanceScale;

          nextBiomass +=
            growthPotential *
            this.settings.growthRate *
            (0.32 + support * 0.68) *
            (0.74 + morphologyPerformance * 0.16 + competitionAdvantage * 0.1) *
            (1 - maintenancePressure * 0.28 - seasonalResponse.storageInvestmentCost * 0.3) *
            seasonalResponse.growthScale *
            growthMultiplier *
            this.resolveVigor(activeStressSpeciesId) *
            dtSeconds;
          nextBiomass -=
            (declinePressure * this.settings.declineRate +
              maintenancePressure +
              droughtStress *
                this.settings.droughtStressStrength *
                stressMultiplier *
                seasonalResponse.stressScale +
              floodStress *
                this.settings.floodStressStrength *
                stressMultiplier *
                lerp(seasonalResponse.stressScale, 1, 0.35) +
              slopeStress *
                this.settings.slopeStressStrength *
                lerp(stressMultiplier, 1, 0.5) *
                lerp(seasonalResponse.stressScale, 1, 0.45) +
              standingWaterStress * 0.16 * seasonalResponse.stressScale -
              seasonalResponse.storageSupport * 0.12) *
            dtSeconds;

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

            nextBiomass = colonization;
            if (nextBiomass > 0.002) {
              this.assignSpeciesToCell(index, colonizerSpeciesId);
              nextActivity = colonizerSeasonalResponse.activityLevel;
              nextReserve = colonizerSeasonalResponse.reserveLevel;
              nextFoliage = colonizerSeasonalResponse.foliageLevel;
              nextDormancyPressure = colonizerSeasonalResponse.dormancyPressure;
            }
          }
        }

        nextBiomass = clamp(nextBiomass, 0, 1);

        if (nextBiomass < 0.01) {
          nextBiomass = 0;
          this.recordCompletedLife(currentSpeciesId, currentAgeSeconds);
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
      }
    }

    this.biomass.set(this.nextBiomass);
    this.ageSeconds.set(this.nextAgeSeconds);
    this.activityLevel.set(this.nextActivityLevel);
    this.reserveLevel.set(this.nextReserveLevel);
    this.foliageLevel.set(this.nextFoliageLevel);
    this.refreshDerivedState();
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
