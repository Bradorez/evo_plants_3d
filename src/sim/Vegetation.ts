import { clamp } from "../utils/math";
import { valueNoise2D } from "../utils/noise";
import type { TerrainData } from "./Terrain";
import {
  classifyPhenotype,
  createInitialSpeciesCatalog,
  ECOLOGY_PROFILE_DRYLAND,
  ECOLOGY_PROFILE_MESIC,
  ECOLOGY_PROFILE_WETLAND,
  mutateSpecies,
  phenotypeName,
  PlantPhenotypeClass,
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
  phenotypeCounts: Record<string, number>;
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
    const activeSpecies = new Set<number>();
    let livingCellCount = 0;
    let denseCellCount = 0;
    let biomassSum = 0;
    let ageSum = 0;
    let oldestLiveAgeSeconds = 0;

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
      activeSpecies.add(speciesId);
      livingCellCount += 1;
      if (this.densityClass[index] >= 3) {
        denseCellCount += 1;
      }
      biomassSum += this.biomass[index];
      ageSum += this.ageSeconds[index];
      oldestLiveAgeSeconds = Math.max(oldestLiveAgeSeconds, this.ageSeconds[index]);
    }

    const dominantPhenotypeEntry = Object.entries(phenotypeCounts).sort((left, right) => right[1] - left[1])[0];

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
      phenotypeCounts,
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
        const selection = this.pickBestSpecies(
          seededMoisture,
          seededWetness,
          floodProne[index],
          0,
          slope,
          normalizedElevation,
        );
        const seedNoise = valueNoise2D(x * 0.18 + 11.7, y * 0.18 - 6.4, this.seed + 9011);
        const terrainSupport = clamp(
          (1 - slope) * 0.55 + basinFactor * 0.25 + (1 - normalizedElevation) * 0.2,
          0,
          1,
        );
        const establishment = selection.score * 0.68 + terrainSupport * 0.22 + seedNoise * 0.1;

        if (selection.speciesId === SPECIES_NONE || selection.score < 0.22 || establishment < 0.31) {
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
    persistentWetness: Float32Array,
    floodProne: Float32Array,
    waterDepth: Float32Array,
    dtSeconds: number,
  ): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return;
    }

    this.vegetationStepCounter += 1;
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
        const neighborCandidate = this.selectNeighborSpeciesCandidate(terrain, x, y);
        const environmentCandidate = this.pickBestSpecies(
          moisture,
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
        const currentSuitability = currentSpecies
          ? this.evaluateSpeciesSuitability(
              currentSpecies,
              moisture,
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

        const activeStressSpeciesId =
          currentSpeciesId !== SPECIES_NONE ? this.dominantSpeciesId[index] : targetSpeciesId;
        const activeStressSpecies =
          activeStressSpeciesId === SPECIES_NONE ? null : this.speciesCatalog[activeStressSpeciesId] ?? null;
        const competition = support * this.settings.carryingCapacityStrength;
        const carryingCapacity = clamp(
          targetSuitability * (1 - competition * 0.45) * (0.88 + wetAdjacency * 0.12),
          0,
          1,
        );
        const droughtStress = activeStressSpecies
          ? this.computeDroughtStress(activeStressSpecies, moisture)
          : 0;
        const floodStress = activeStressSpecies
          ? this.computeFloodStress(activeStressSpecies, flood, standingWater)
          : 0;
        const slopeStress = activeStressSpecies
          ? this.computeSlopeStress(activeStressSpecies, slope)
          : 0;

        let nextBiomass = currentBiomass;

        if (currentSpeciesId !== SPECIES_NONE && targetSpeciesId !== SPECIES_NONE) {
          if (currentSpeciesId !== targetSpeciesId && currentBiomass < 0.1) {
            this.assignSpeciesToCell(index, targetSpeciesId);
          }

          const growthPotential = clamp(carryingCapacity - currentBiomass, 0, 1);
          const declinePressure = clamp(currentBiomass - carryingCapacity, 0, 1);
          const standingWaterStress = Math.max(
            0,
            standingWater - this.resolveStandingWaterTolerance(this.dominantSpeciesId[index]),
          );

          nextBiomass +=
            growthPotential *
            this.settings.growthRate *
            (0.32 + support * 0.68) *
            this.resolveVigor(activeStressSpeciesId) *
            dtSeconds;
          nextBiomass -=
            (declinePressure * this.settings.declineRate +
              droughtStress * this.settings.droughtStressStrength +
              floodStress * this.settings.floodStressStrength +
              slopeStress * this.settings.slopeStressStrength +
              standingWaterStress * 0.16) *
            dtSeconds;
        } else {
          const colonizer = neighborCandidate.speciesId !== SPECIES_NONE ? neighborCandidate : environmentCandidate;

          if (colonizer.speciesId !== SPECIES_NONE && colonizer.score >= this.settings.colonizationThreshold) {
            const colonizerSpeciesId = this.maybeMutateColonizer(
              colonizer.speciesId,
              x,
              y,
              support,
              colonizer.score,
            );
            const spreadAbility = this.resolveSpreadAbility(colonizerSpeciesId);
            const vigor = this.resolveVigor(colonizerSpeciesId);
            const colonization =
              colonizer.score *
              support *
              this.settings.spreadRate *
              spreadAbility *
              (0.58 + vigor * 0.42) *
              dtSeconds;

            nextBiomass = colonization;
            if (nextBiomass > 0.002) {
              this.assignSpeciesToCell(index, colonizerSpeciesId);
            }
          }
        }

        nextBiomass = clamp(nextBiomass, 0, 1);

        if (nextBiomass < 0.01) {
          nextBiomass = 0;
          this.recordCompletedLife(currentSpeciesId, currentAgeSeconds);
          this.clearCellSpecies(index);
        }

        this.nextBiomass[index] = nextBiomass;
        this.nextAgeSeconds[index] = this.resolveNextAge(
          currentSpeciesId,
          this.dominantSpeciesId[index],
          currentAgeSeconds,
          nextBiomass,
          dtSeconds,
        );
      }
    }

    this.biomass.set(this.nextBiomass);
    this.ageSeconds.set(this.nextAgeSeconds);
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
    moisture: number,
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
        moisture,
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
    moisture: number,
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
    const droughtPenalty = clamp(
      (ecology.droughtTolerance - moisture) / Math.max(ecology.droughtTolerance, 0.12),
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

    return clamp(
      moistureFit * 0.36 +
        wetnessFit * 0.24 +
        ecology.vigor * 0.16 +
        (1 - slopePenalty) * 0.12 +
        elevationBias -
        droughtPenalty * 0.2 -
        floodPenalty * 0.26 -
        standingWaterPenalty * 0.22,
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

        const weight = (offsetX === 0 || offsetY === 0 ? 1 : 0.76) * this.biomass[sampleIndex];
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

    const descendant = mutateSpecies(parent, this.nextSpeciesId, this.seed + this.vegetationStepCounter * 37);
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

  private resolveDroughtTolerance(speciesId: number): number {
    return speciesId === SPECIES_NONE ? 0.22 : this.speciesCatalog[speciesId]?.ecology.droughtTolerance ?? 0.22;
  }

  private resolveFloodTolerance(speciesId: number): number {
    return speciesId === SPECIES_NONE ? 0.28 : this.speciesCatalog[speciesId]?.ecology.floodTolerance ?? 0.28;
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
  private computeDroughtStress(species: PlantSpeciesDefinition, moisture: number): number {
    const drynessDeficit = clamp(
      (species.ecology.moisturePreference - moisture) /
        Math.max(species.ecology.moisturePreference + species.ecology.moistureTolerance, 0.16),
      0,
      1,
    );
    const droughtBuffer = 1 - species.ecology.droughtTolerance * 0.82;
    return drynessDeficit * droughtBuffer;
  }

  private computeFloodStress(
    species: PlantSpeciesDefinition,
    floodProne: number,
    standingWater: number,
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
    return clamp(floodComponent * 0.7 + standingWaterComponent * 0.3, 0, 1);
  }

  private computeSlopeStress(species: PlantSpeciesDefinition, slope: number): number {
    return clamp(
      (slope - species.ecology.slopeTolerance) / Math.max(1 - species.ecology.slopeTolerance, 0.16),
      0,
      1,
    );
  }

  private resolveSlopeTolerance(speciesId: number): number {
    return speciesId === SPECIES_NONE ? 0.5 : this.speciesCatalog[speciesId]?.ecology.slopeTolerance ?? 0.5;
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
}
