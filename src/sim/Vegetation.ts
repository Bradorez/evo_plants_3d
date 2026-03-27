import { clamp, lerp } from "../utils/math";
import { valueNoise2D } from "../utils/noise";
import type { TerrainData } from "./Terrain";

export const VEGETATION_PROFILE_NONE = 255;
export const VEGETATION_PROFILE_DRYLAND = 0;
export const VEGETATION_PROFILE_MESIC = 1;
export const VEGETATION_PROFILE_WETLAND = 2;

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
}

interface VegetationProfilePreferences {
  moistureCenter: number;
  moistureTolerance: number;
  persistentWetnessCenter: number;
  persistentWetnessTolerance: number;
  floodTolerance: number;
  standingWaterTolerance: number;
  slopeTolerance: number;
  elevationPreference: number;
}

/**
 * VegetationModel is the first ecological producer layered on top of the
 * moisture and terrain systems. It keeps vegetation state fully grid-based so
 * later systems such as species traits, succession, and mutation can build on
 * stable typed-array fields rather than one-off render logic.
 *
 * The model intentionally stays simple:
 * - biomass is continuous and slow-moving
 * - density classes are derived from biomass for easier rendering/debugging
 * - profile IDs capture broad ecological strategies, not species
 * - spread is purely local and deterministic, avoiding agent complexity
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
  };

  private readonly seed: number;
  private readonly biomass: Float32Array;
  private readonly nextBiomass: Float32Array;
  private readonly densityClass: Uint8Array;
  private readonly profileId: Uint8Array;
  private readonly suitability: Float32Array;
  private readonly neighborSupport: Float32Array;
  private readonly persistentChannelProxy: Float32Array;

  public constructor(cellCount: number, seed: number) {
    this.seed = seed >>> 0;
    this.biomass = new Float32Array(cellCount);
    this.nextBiomass = new Float32Array(cellCount);
    this.densityClass = new Uint8Array(cellCount);
    this.profileId = new Uint8Array(cellCount);
    this.profileId.fill(VEGETATION_PROFILE_NONE);
    this.suitability = new Float32Array(cellCount);
    this.neighborSupport = new Float32Array(cellCount);
    this.persistentChannelProxy = new Float32Array(cellCount);
  }

  public getBiomass(): Float32Array {
    return this.biomass;
  }

  public getDensityClass(): Uint8Array {
    return this.densityClass;
  }

  public getProfileId(): Uint8Array {
    return this.profileId;
  }

  public reset(): void {
    this.biomass.fill(0);
    this.nextBiomass.fill(0);
    this.densityClass.fill(0);
    this.profileId.fill(VEGETATION_PROFILE_NONE);
    this.suitability.fill(0);
    this.neighborSupport.fill(0);
    this.persistentChannelProxy.fill(0);
  }

  /**
   * Initial seeding establishes a deterministic ecological baseline. Moisture
   * layers may still be close to empty right after a simulation reset, so the
   * seeding logic also considers rainfall pattern, slope, elevation context,
   * and subtle noise so the map starts with plausible heterogeneity.
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
        const elevation = terrain.heights[index];
        const normalizedElevation = clamp(
          (elevation - terrain.minHeight) / Math.max(terrain.maxHeight - terrain.minHeight, 1e-6),
          0,
          1,
        );
        const seededMoisture = clamp(
          soilMoisture[index] * 0.45 +
            persistentWetness[index] * 0.25 +
            rainIntensity * rainfallDistribution[index] * 0.22 +
            basinFactor * 0.08,
          0,
          1,
        );
        const seededWetness = clamp(
          persistentWetness[index] * 0.55 + basinFactor * 0.25 + seededMoisture * 0.2,
          0,
          1,
        );
        const flood = floodProne[index];
        const selection = this.pickBestProfile(
          seededMoisture,
          seededWetness,
          flood,
          0,
          slope,
          normalizedElevation,
        );
        const seedNoise = valueNoise2D(x * 0.18 + 11.7, y * 0.18 - 6.4, this.seed + 9011);
        const terrainSupport = clamp((1 - slope) * 0.55 + basinFactor * 0.25 + (1 - normalizedElevation) * 0.2, 0, 1);
        const establishment = selection.score * 0.68 + terrainSupport * 0.22 + seedNoise * 0.1;

        if (selection.score < 0.24 || establishment < 0.32 || flood > 0.78) {
          continue;
        }

        const initialBiomass = clamp(
          0.12 + selection.score * 0.28 + terrainSupport * 0.16 - Math.max(0, flood - 0.55) * 0.2,
          0,
          0.72,
        );

        this.biomass[index] = initialBiomass;
        this.profileId[index] = selection.profile;
      }
    }

    this.refreshDerivedState();
  }

  /**
   * Vegetation updates deliberately run on a slower ecological cadence. The
   * model reads moisture and flood memory that have already been temporally
   * smoothed, then nudges biomass toward or away from a local carrying
   * capacity. Spread is local and deterministic so the map changes gradually.
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

    this.updateNeighborhoodSignals(terrain, soilMoisture, persistentWetness);

    for (let y = 0; y < terrain.grid.height; y += 1) {
      for (let x = 0; x < terrain.grid.width; x += 1) {
        const index = terrain.grid.index(x, y);
        const slope = this.sampleSlope(terrain, x, y);
        const elevation = terrain.heights[index];
        const normalizedElevation = clamp(
          (elevation - terrain.minHeight) / Math.max(terrain.maxHeight - terrain.minHeight, 1e-6),
          0,
          1,
        );
        const moisture = soilMoisture[index];
        const wetness = persistentWetness[index];
        const flood = floodProne[index];
        const standingWater = clamp(waterDepth[index] / 0.05, 0, 1);
        const channelSupport = this.persistentChannelProxy[index];
        const support = clamp(this.neighborSupport[index] * 0.8 + channelSupport * 0.2, 0, 1);
        const competition = support * this.settings.carryingCapacityStrength;
        const bestSelection = this.pickBestProfile(
          moisture,
          wetness,
          flood,
          standingWater,
          slope,
          normalizedElevation,
        );
        const currentProfile = this.profileId[index];
        const currentBiomass = this.biomass[index];
        const currentSuitability =
          currentProfile === VEGETATION_PROFILE_NONE
            ? 0
            : this.evaluateProfileSuitability(
                currentProfile,
                moisture,
                wetness,
                flood,
                standingWater,
                slope,
                normalizedElevation,
              );
        const shouldAdoptNewProfile =
          bestSelection.profile !== VEGETATION_PROFILE_NONE &&
          (currentProfile === VEGETATION_PROFILE_NONE ||
            bestSelection.score > currentSuitability + this.settings.reselectionThreshold ||
            currentBiomass < 0.08);
        const activeProfile =
          shouldAdoptNewProfile && bestSelection.score > 0
            ? bestSelection.profile
            : currentProfile;
        const suitability =
          activeProfile === VEGETATION_PROFILE_NONE
            ? 0
            : this.evaluateProfileSuitability(
                activeProfile,
                moisture,
                wetness,
                flood,
                standingWater,
                slope,
                normalizedElevation,
              );

        this.suitability[index] = suitability;

        const carryingCapacity = clamp(suitability * (1 - competition * 0.45), 0, 1);
        const droughtStress = clamp(0.28 - moisture, 0, 0.28) / 0.28;
        const floodStress = clamp(flood - 0.64, 0, 0.36) / 0.36;
        const slopeStress = clamp(slope - 0.72, 0, 0.28) / 0.28;

        let nextBiomass = currentBiomass;

        if (currentBiomass > 0.001 && activeProfile !== VEGETATION_PROFILE_NONE) {
          const growthPotential = clamp(carryingCapacity - currentBiomass, 0, 1);
          const declinePressure = clamp(currentBiomass - carryingCapacity, 0, 1);
          const stress =
            droughtStress * this.settings.droughtStressStrength +
            floodStress * this.settings.floodStressStrength +
            slopeStress * this.settings.slopeStressStrength +
            Math.max(0, standingWater - this.settings.standingWaterTolerance) * 0.24;

          nextBiomass += growthPotential * this.settings.growthRate * (0.35 + support * 0.65) * dtSeconds;
          nextBiomass -=
            (declinePressure * this.settings.declineRate + stress * this.settings.declineRate * 1.6) *
            dtSeconds;
        } else if (
          bestSelection.profile !== VEGETATION_PROFILE_NONE &&
          bestSelection.score >= this.settings.colonizationThreshold
        ) {
          const colonization =
            bestSelection.score *
            support *
            this.settings.spreadRate *
            (0.7 + channelSupport * 0.3) *
            (0.55 + (1 - competition) * 0.45) *
            dtSeconds;

          nextBiomass = colonization;
          if (nextBiomass > 0.002) {
            this.profileId[index] = bestSelection.profile;
          }
        }

        nextBiomass = clamp(nextBiomass, 0, 1);

        if (nextBiomass < 0.01) {
          nextBiomass = 0;
          this.profileId[index] = VEGETATION_PROFILE_NONE;
        } else if (activeProfile !== VEGETATION_PROFILE_NONE) {
          this.profileId[index] = activeProfile;
        }

        this.nextBiomass[index] = nextBiomass;
      }
    }

    this.biomass.set(this.nextBiomass);
    this.refreshDerivedState();
  }

  private refreshDerivedState(): void {
    for (let index = 0; index < this.biomass.length; index += 1) {
      const biomass = this.biomass[index];

      if (biomass < 0.08 || this.profileId[index] === VEGETATION_PROFILE_NONE) {
        this.densityClass[index] = 0;
        if (biomass < 0.01) {
          this.profileId[index] = VEGETATION_PROFILE_NONE;
        }
        continue;
      }

      this.densityClass[index] = biomass < 0.3 ? 1 : biomass < 0.62 ? 2 : 3;
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
        let wetChannelSignal = clamp(soilMoisture[index] * 0.5 + persistentWetness[index] * 0.5, 0, 1) * 0.28;

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
            wetChannelSignal +=
              clamp(soilMoisture[sampleIndex] * 0.55 + persistentWetness[sampleIndex] * 0.45, 0, 1) *
              (weight * 0.22);
          }
        }

        this.neighborSupport[index] = biomassWeight > 0 ? clamp(biomassSum / biomassWeight, 0, 1) : 0;
        this.persistentChannelProxy[index] = clamp(wetChannelSignal, 0, 1);
      }
    }
  }

  private pickBestProfile(
    moisture: number,
    persistentWetness: number,
    floodProne: number,
    standingWater: number,
    slope: number,
    normalizedElevation: number,
  ): { profile: number; score: number } {
    let bestProfile = VEGETATION_PROFILE_NONE;
    let bestScore = 0;

    for (const profile of [
      VEGETATION_PROFILE_DRYLAND,
      VEGETATION_PROFILE_MESIC,
      VEGETATION_PROFILE_WETLAND,
    ]) {
      const score = this.evaluateProfileSuitability(
        profile,
        moisture,
        persistentWetness,
        floodProne,
        standingWater,
        slope,
        normalizedElevation,
      );

      if (score > bestScore) {
        bestScore = score;
        bestProfile = profile;
      }
    }

    return { profile: bestProfile, score: bestScore };
  }

  private evaluateProfileSuitability(
    profile: number,
    moisture: number,
    persistentWetness: number,
    floodProne: number,
    standingWater: number,
    slope: number,
    normalizedElevation: number,
  ): number {
    const preferences = this.getProfilePreferences(profile);
    const moistureFit = this.gaussianLikeFit(
      moisture,
      preferences.moistureCenter,
      preferences.moistureTolerance,
    );
    const wetnessFit = this.gaussianLikeFit(
      persistentWetness,
      preferences.persistentWetnessCenter,
      preferences.persistentWetnessTolerance,
    );
    const floodPenalty = clamp(
      (floodProne - preferences.floodTolerance) / Math.max(1 - preferences.floodTolerance, 1e-6),
      0,
      1,
    );
    const standingWaterPenalty = clamp(
      (standingWater - preferences.standingWaterTolerance) /
        Math.max(1 - preferences.standingWaterTolerance, 1e-6),
      0,
      1,
    );
    const slopePenalty = clamp(
      (slope - preferences.slopeTolerance) / Math.max(1 - preferences.slopeTolerance, 1e-6),
      0,
      1,
    );
    const elevationFit = 1 - Math.abs(normalizedElevation - preferences.elevationPreference) * 1.35;
    const baseSuitability =
      moistureFit * 0.4 + wetnessFit * 0.26 + clamp(elevationFit, 0, 1) * 0.1 + (1 - slopePenalty) * 0.14;
    const waterStress = floodPenalty * 0.42 + standingWaterPenalty * 0.36 + slopePenalty * 0.22;
    const channelBonus =
      profile === VEGETATION_PROFILE_WETLAND
        ? this.settings.spreadRate * 0.2
        : profile === VEGETATION_PROFILE_MESIC
          ? 0.01
          : 0;

    return clamp(baseSuitability + channelBonus - waterStress, 0, 1);
  }

  private getProfilePreferences(profile: number): VegetationProfilePreferences {
    switch (profile) {
      case VEGETATION_PROFILE_DRYLAND:
        return {
          moistureCenter: 0.2,
          moistureTolerance: 0.3,
          persistentWetnessCenter: 0.18,
          persistentWetnessTolerance: 0.24,
          floodTolerance: 0.24,
          standingWaterTolerance: 0.06,
          slopeTolerance: 0.78,
          elevationPreference: 0.66,
        };
      case VEGETATION_PROFILE_WETLAND:
        return {
          moistureCenter: 0.74,
          moistureTolerance: 0.28,
          persistentWetnessCenter: 0.76,
          persistentWetnessTolerance: 0.3,
          floodTolerance: 0.78,
          standingWaterTolerance: 0.36,
          slopeTolerance: 0.42,
          elevationPreference: 0.28,
        };
      case VEGETATION_PROFILE_MESIC:
      default:
        return {
          moistureCenter: 0.48,
          moistureTolerance: 0.26,
          persistentWetnessCenter: 0.42,
          persistentWetnessTolerance: 0.24,
          floodTolerance: 0.46,
          standingWaterTolerance: 0.12,
          slopeTolerance: 0.58,
          elevationPreference: 0.46,
        };
    }
  }

  private gaussianLikeFit(value: number, center: number, tolerance: number): number {
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
}
