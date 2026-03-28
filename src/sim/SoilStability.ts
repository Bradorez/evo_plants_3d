import { clamp } from "../utils/math";
import { SPECIES_NONE, type PlantSpeciesDefinition } from "./PlantSpecies";
import type { RainfallModel } from "./Rainfall";
import type { TerrainData } from "./Terrain";

export interface SoilStabilitySettings {
  baseInfiltration: number;
  soilInfiltrationWeight: number;
  coarseInfiltrationWeight: number;
  organicInfiltrationWeight: number;
  rootInfiltrationWeight: number;
  saturationPenalty: number;
  surfaceWaterPenalty: number;
  infiltrationRechargeWeight: number;
  organicAccumulationRate: number;
  organicDecayRate: number;
  floodOrganicLossRate: number;
  baseCohesion: number;
  soilCohesionWeight: number;
  rootBindingWeight: number;
  organicBindingWeight: number;
  coarseBindingWeight: number;
  bedrockBindingWeight: number;
  bankStabilityWeight: number;
  detachmentThresholdBase: number;
  detachmentThresholdCohesionWeight: number;
  detachmentThresholdRootWeight: number;
  detachmentThresholdOrganicWeight: number;
  detachmentThresholdArmorWeight: number;
}

export interface RainPartitionResult {
  runoffWater: number;
  infiltratedWater: number;
}

/**
 * SoilStabilityModel keeps the lightweight surface feedbacks that sit between
 * ecology and erosion. It does three jobs:
 * - partitions rainfall into infiltration vs runoff
 * - accumulates a thin organic cover that protects and wets soil
 * - exposes resistance-style fields that erosion and diagnostics can read
 *
 * Keeping these fields together makes the stabilizing mechanisms explicit and
 * local without forcing the hydrology or vegetation models to absorb another
 * large block of cross-domain logic.
 */
export class SoilStabilityModel {
  public readonly settings: SoilStabilitySettings = {
    baseInfiltration: 0.36,
    soilInfiltrationWeight: 0.22,
    coarseInfiltrationWeight: 0.08,
    organicInfiltrationWeight: 0.18,
    rootInfiltrationWeight: 0.18,
    saturationPenalty: 0.62,
    surfaceWaterPenalty: 0.34,
    infiltrationRechargeWeight: 0.9,
    organicAccumulationRate: 0.04,
    organicDecayRate: 0.018,
    floodOrganicLossRate: 0.028,
    baseCohesion: 0.16,
    soilCohesionWeight: 0.22,
    rootBindingWeight: 0.24,
    organicBindingWeight: 0.16,
    coarseBindingWeight: 0.12,
    bedrockBindingWeight: 0.1,
    bankStabilityWeight: 0.3,
    detachmentThresholdBase: 0.1,
    detachmentThresholdCohesionWeight: 0.26,
    detachmentThresholdRootWeight: 0.24,
    detachmentThresholdOrganicWeight: 0.16,
    detachmentThresholdArmorWeight: 0.18,
  };

  private readonly organicCover: Float32Array;
  private readonly rootStabilization: Float32Array;
  private readonly soilCohesion: Float32Array;
  private readonly combinedResistance: Float32Array;
  private readonly bankStability: Float32Array;
  private readonly detachmentThreshold: Float32Array;
  private readonly infiltrationShare: Float32Array;
  private readonly runoffShare: Float32Array;
  private readonly infiltrationRecharge: Float32Array;

  public constructor(cellCount: number) {
    this.organicCover = new Float32Array(cellCount);
    this.rootStabilization = new Float32Array(cellCount);
    this.soilCohesion = new Float32Array(cellCount);
    this.combinedResistance = new Float32Array(cellCount);
    this.bankStability = new Float32Array(cellCount);
    this.detachmentThreshold = new Float32Array(cellCount);
    this.infiltrationShare = new Float32Array(cellCount);
    this.runoffShare = new Float32Array(cellCount);
    this.infiltrationRecharge = new Float32Array(cellCount);
  }

  public reset(): void {
    this.organicCover.fill(0);
    this.rootStabilization.fill(0);
    this.soilCohesion.fill(0);
    this.combinedResistance.fill(0);
    this.bankStability.fill(0);
    this.detachmentThreshold.fill(0);
    this.infiltrationShare.fill(0.5);
    this.runoffShare.fill(0.5);
    this.infiltrationRecharge.fill(0);
  }

  public getOrganicCover(): Float32Array {
    return this.organicCover;
  }

  public getRootStabilization(): Float32Array {
    return this.rootStabilization;
  }

  public getSoilCohesion(): Float32Array {
    return this.soilCohesion;
  }

  public getCombinedResistance(): Float32Array {
    return this.combinedResistance;
  }

  public getBankStability(): Float32Array {
    return this.bankStability;
  }

  public getDetachmentThreshold(): Float32Array {
    return this.detachmentThreshold;
  }

  public getInfiltrationShare(): Float32Array {
    return this.infiltrationShare;
  }

  public getRunoffShare(): Float32Array {
    return this.runoffShare;
  }

  public getInfiltrationRecharge(): Float32Array {
    return this.infiltrationRecharge;
  }

  public clearHydrologySignals(): void {
    this.infiltrationRecharge.fill(0);
  }

  public updateEcology(
    terrain: TerrainData,
    soilMoisture: Float32Array,
    persistentWetness: Float32Array,
    temperature: Float32Array,
    vegetationBiomass: Float32Array,
    vegetationSpeciesId: Uint16Array,
    speciesCatalog: readonly PlantSpeciesDefinition[],
    dtSeconds: number,
  ): void {
    for (let index = 0; index < terrain.grid.cellCount; index += 1) {
      const speciesId = vegetationSpeciesId[index];
      const biomass = vegetationBiomass[index];
      const occupancy = speciesId !== SPECIES_NONE ? clamp(biomass / 0.7, 0, 1) : 0;
      const species = speciesId !== SPECIES_NONE ? speciesCatalog[speciesId] : undefined;

      const rootInfluence =
        occupancy *
        clamp(
          (species?.ecology.rootDepth ?? 0) * 0.36 +
            (species?.ecology.rootSpread ?? 0) * 0.28 +
            (species?.ecology.soilBindingStrength ?? 0) * 0.36,
          0,
          1,
        );
      this.rootStabilization[index] = rootInfluence;

      const organicInput =
        occupancy *
        (this.settings.organicAccumulationRate * (0.4 + (species?.ecology.vigor ?? 0) * 0.35 + (species?.morphology.groundCoverFactor ?? 0) * 0.25));
      const organicLoss =
        this.settings.organicDecayRate *
        (0.5 + temperature[index] * 0.35 + (1 - soilMoisture[index]) * 0.15) *
        dtSeconds;
      const floodWash =
        this.settings.floodOrganicLossRate *
        persistentWetness[index] *
        (0.35 + clamp(terrain.coarseRock[index] / 0.9, 0, 1) * 0.2) *
        dtSeconds;
      this.organicCover[index] = clamp(
        this.organicCover[index] + organicInput * dtSeconds - organicLoss - floodWash,
        0,
        1,
      );

      const surfaceMaterial = terrain.soilDepth[index] + terrain.coarseRock[index];
      const soilFraction = clamp(terrain.soilDepth[index] / Math.max(surfaceMaterial, 1e-4), 0, 1);
      const coarseFraction = clamp(terrain.coarseRock[index] / Math.max(surfaceMaterial + 0.12, 1e-4), 0, 1);
      const bedrockExposure = clamp(
        1 - (terrain.soilDepth[index] + terrain.coarseRock[index]) / Math.max(surfaceMaterial + 0.12, 0.12),
        0,
        1,
      );

      this.soilCohesion[index] = clamp(
        this.settings.baseCohesion +
          soilFraction * this.settings.soilCohesionWeight +
          rootInfluence * this.settings.rootBindingWeight +
          this.organicCover[index] * this.settings.organicBindingWeight +
          coarseFraction * this.settings.coarseBindingWeight +
          bedrockExposure * this.settings.bedrockBindingWeight -
          persistentWetness[index] * 0.04,
        0,
        1,
      );

      this.bankStability[index] = clamp(
        this.soilCohesion[index] * 0.34 +
          rootInfluence * this.settings.bankStabilityWeight +
          this.organicCover[index] * 0.14 +
          coarseFraction * 0.12 +
          bedrockExposure * 0.1,
        0,
        1,
      );

      this.combinedResistance[index] = clamp(
        this.soilCohesion[index] * 0.42 +
          rootInfluence * 0.28 +
          this.organicCover[index] * 0.16 +
          coarseFraction * 0.1 +
          bedrockExposure * 0.04,
        0,
        1,
      );

      this.detachmentThreshold[index] = clamp(
        this.settings.detachmentThresholdBase +
          this.soilCohesion[index] * this.settings.detachmentThresholdCohesionWeight +
          rootInfluence * this.settings.detachmentThresholdRootWeight +
          this.organicCover[index] * this.settings.detachmentThresholdOrganicWeight +
          coarseFraction * this.settings.detachmentThresholdArmorWeight,
        0.02,
        0.95,
      );

      this.infiltrationShare[index] = clamp(
        this.settings.baseInfiltration +
          soilFraction * this.settings.soilInfiltrationWeight +
          coarseFraction * this.settings.coarseInfiltrationWeight +
          this.organicCover[index] * this.settings.organicInfiltrationWeight +
          rootInfluence * this.settings.rootInfiltrationWeight -
          soilMoisture[index] * this.settings.saturationPenalty -
          persistentWetness[index] * 0.08,
        0.05,
        0.95,
      );
      this.runoffShare[index] = 1 - this.infiltrationShare[index];
    }
  }

  public applyRainfallPartition(
    rainfall: RainfallModel,
    waterDepth: Float32Array,
    soilMoisture: Float32Array,
    intensityMultiplier: number,
    dtSeconds: number,
  ): RainPartitionResult {
    if (rainfall.getIntensity() <= 0 || dtSeconds <= 0 || intensityMultiplier <= 0) {
      return { runoffWater: 0, infiltratedWater: 0 };
    }

    let runoffWater = 0;
    let infiltratedWater = 0;
    const effectiveIntensity = rainfall.getIntensity() * intensityMultiplier;

    for (let index = 0; index < waterDepth.length; index += 1) {
      const amount = effectiveIntensity * rainfall.distribution[index] * dtSeconds * 0.02;
      if (amount <= 0) {
        this.infiltrationShare[index] = clamp(this.infiltrationShare[index], 0.05, 0.95);
        this.runoffShare[index] = 1 - this.infiltrationShare[index];
        continue;
      }

      const surfacePenalty = clamp(waterDepth[index] / 0.03, 0, 1);
      const infiltrationFraction = clamp(
        this.infiltrationShare[index] *
          (1 - soilMoisture[index] * this.settings.saturationPenalty) *
          (1 - surfacePenalty * this.settings.surfaceWaterPenalty),
        0.02,
        0.98,
      );
      const infiltrated = amount * infiltrationFraction;
      const runoff = amount - infiltrated;

      this.infiltrationRecharge[index] += infiltrated * this.settings.infiltrationRechargeWeight;
      this.infiltrationShare[index] = infiltrated / amount;
      this.runoffShare[index] = runoff / amount;
      waterDepth[index] += runoff;
      runoffWater += runoff;
      infiltratedWater += infiltrated;
    }

    return { runoffWater, infiltratedWater };
  }
}
