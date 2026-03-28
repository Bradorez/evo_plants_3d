import { clamp, lerp } from "../utils/math";
import type { HabitatPressureProfile, PlantSpeciesDefinition } from "./PlantSpecies";

export interface PlantSeasonalitySettings {
  activityResponseRate: number;
  dormancyResponseRate: number;
  foliageGrowthRate: number;
  foliageDropRate: number;
  storageGainRate: number;
  storageUseRate: number;
  dormancyStressRelief: number;
  persistenceMaintenancePenalty: number;
  reserveGrowthTradeoff: number;
  reserveSpreadBenefit: number;
}

export interface PlantSeasonalResponse {
  activityLevel: number;
  reserveLevel: number;
  foliageLevel: number;
  dormancyPressure: number;
  maintenanceScale: number;
  waterDemandScale: number;
  growthScale: number;
  stressScale: number;
  spreadScale: number;
  reproductionReadiness: number;
  storageInvestmentCost: number;
  storageSupport: number;
}

/**
 * Seasonal response is intentionally generic. Instead of dispatching to named
 * evergreen/deciduous/dormant strategies, this function turns continuous
 * seasonal-response traits plus current habitat conditions into activity,
 * reserve, and foliage states that the vegetation model can use directly.
 */
export function computePlantSeasonalResponse(
  species: PlantSpeciesDefinition,
  habitat: HabitatPressureProfile,
  currentActivity: number,
  currentReserve: number,
  currentFoliage: number,
  seasonalGrowthMultiplier: number,
  seasonalStressMultiplier: number,
  dtSeconds: number,
  settings: PlantSeasonalitySettings,
): PlantSeasonalResponse {
  const { ecology, seasonal } = species;
  const coolness = 1 - habitat.temperature;
  const temperatureFit = clamp(
    1 - Math.abs(habitat.temperature - ecology.optimalTemperature) / Math.max(ecology.temperatureTolerance, 0.08),
    0,
    1,
  );
  const drynessTrigger = clamp(
    (habitat.dryness - seasonal.dormancyTriggerDryness) /
      Math.max(1 - seasonal.dormancyTriggerDryness, 0.08),
    0,
    1,
  );
  const coldTrigger = clamp(
    (coolness - seasonal.dormancyTriggerColdOrLowTemperature) /
      Math.max(1 - seasonal.dormancyTriggerColdOrLowTemperature, 0.08),
    0,
    1,
  );
  const floodTrigger = clamp(
    (habitat.floodProne - ecology.floodTolerance) / Math.max(1 - ecology.floodTolerance, 0.12),
    0,
    1,
  );
  const dormancyPressure = clamp(
    seasonal.dormancyTendency *
      (drynessTrigger * 0.56 + coldTrigger * 0.32 + floodTrigger * 0.12) *
      (1.06 - seasonal.growthWindowFlexibility * 0.4),
    0,
    1,
  );
  const opportunity = clamp(
    habitat.moisture * 0.26 +
      habitat.fertileMoisture * 0.2 +
      temperatureFit * 0.2 +
      ecology.vigor * 0.14 +
      clamp(seasonalGrowthMultiplier - 0.65, 0, 1) * 0.12 +
      seasonal.growthWindowFlexibility * 0.08,
    0,
    1,
  );
  const unfavorablePressure = clamp(
    dormancyPressure * 0.56 +
      Math.max(0, seasonalStressMultiplier - 1) * 0.28 +
      habitat.heatStress * (1 - ecology.heatStressResistance) * 0.16,
    0,
    1,
  );
  const targetActivity = clamp(
    opportunity * (0.56 + seasonal.growthWindowFlexibility * 0.18) +
      currentReserve * 0.14 +
      currentFoliage * 0.1 -
      dormancyPressure * (0.72 - seasonal.growthWindowFlexibility * 0.18) -
      unfavorablePressure * 0.18,
    0,
    1,
  );
  const activityRate =
    targetActivity >= currentActivity
      ? settings.activityResponseRate * (0.42 + seasonal.reactivationSpeed * 0.58)
      : settings.dormancyResponseRate * (0.38 + seasonal.dormancyTendency * 0.62);
  const activityLevel = lerp(
    currentActivity,
    targetActivity,
    clamp(activityRate * dtSeconds * 2.8, 0, 1),
  );

  const targetFoliage = clamp(
    seasonal.leafPersistence * (0.42 + opportunity * 0.3) +
      activityLevel * (0.34 + seasonal.regrowthRate * 0.18) -
      dormancyPressure * seasonal.leafDropBias * 0.4 -
      habitat.dryness * (1 - ecology.droughtTolerance) * 0.08,
    0,
    1,
  );
  const foliageRate =
    targetFoliage >= currentFoliage
      ? settings.foliageGrowthRate * (0.34 + seasonal.regrowthRate * 0.66)
      : settings.foliageDropRate * (0.36 + seasonal.leafDropBias * 0.64);
  const foliageLevel = lerp(
    currentFoliage,
    targetFoliage,
    clamp(foliageRate * dtSeconds * 2.4, 0, 1),
  );

  const storageDemand = clamp(
    dormancyPressure * 0.42 + unfavorablePressure * 0.26 + (1 - activityLevel) * 0.18,
    0,
    1,
  );
  const storageRecovery = clamp(
    opportunity * 0.42 + (1 - dormancyPressure) * 0.16 + activityLevel * 0.1,
    0,
    1,
  );
  const reserveUse = Math.min(
    currentReserve,
    storageDemand *
      settings.storageUseRate *
      (0.58 + seasonal.resourceStorageCapacity * 0.42) *
      dtSeconds,
  );
  const reserveGain = clamp(
    storageRecovery *
      (1 - currentReserve) *
      settings.storageGainRate *
      (0.48 + seasonal.resourceStorageCapacity * 0.52) *
      dtSeconds,
    0,
    1,
  );
  const reserveLevel = clamp(currentReserve + reserveGain - reserveUse, 0, 1);
  const storageSupport = reserveUse * (0.54 + seasonal.resourceStorageCapacity * 0.32);
  const storageInvestmentCost = reserveGain * (0.22 + seasonal.resourceStorageCapacity * settings.reserveGrowthTradeoff);

  const maintenanceScale = clamp(
    0.34 +
      activityLevel * 0.4 +
      foliageLevel * 0.18 +
      seasonal.leafPersistence * unfavorablePressure * settings.persistenceMaintenancePenalty -
      dormancyPressure * seasonal.dormancyTendency * 0.16,
    0.2,
    1.35,
  );
  const waterDemandScale = clamp(
    0.42 +
      activityLevel * 0.24 +
      foliageLevel * 0.3 +
      seasonal.leafPersistence * 0.12 -
      dormancyPressure * (0.14 + seasonal.leafDropBias * 0.08),
    0.25,
    1.45,
  );
  const growthScale = clamp(
    0.22 +
      opportunity * 0.36 +
      activityLevel * 0.24 +
      foliageLevel * 0.18 -
      dormancyPressure * 0.22 -
      storageInvestmentCost * 0.35,
    0.04,
    1.45,
  );
  const stressScale = clamp(
    0.42 +
      unfavorablePressure * 0.34 +
      waterDemandScale * 0.14 -
      storageSupport * settings.dormancyStressRelief -
      activityLevel * 0.08,
    0.22,
    1.8,
  );
  const reproductionReadiness = clamp(
    (reserveLevel - seasonal.reproductionThreshold) / Math.max(1 - seasonal.reproductionThreshold, 0.08),
    0,
    1,
  );
  const spreadScale = clamp(
    0.16 +
      activityLevel * 0.28 +
      foliageLevel * 0.12 +
      reproductionReadiness * settings.reserveSpreadBenefit +
      seasonal.reactivationSpeed * 0.08,
    0.04,
    1.4,
  );

  return {
    activityLevel,
    reserveLevel,
    foliageLevel,
    dormancyPressure,
    maintenanceScale,
    waterDemandScale,
    growthScale,
    stressScale,
    spreadScale,
    reproductionReadiness,
    storageInvestmentCost,
    storageSupport,
  };
}

/**
 * New colonizers should not materialize with a fully developed seasonal state.
 * This helper gives them a small, species-dependent starting reserve/foliage
 * profile that still reflects their inherited seasonal traits.
 */
export function getInitialPlantSeasonalState(species: PlantSpeciesDefinition): Pick<
  PlantSeasonalResponse,
  "activityLevel" | "reserveLevel" | "foliageLevel" | "dormancyPressure"
> {
  return {
    activityLevel: clamp(
      0.48 + species.seasonal.growthWindowFlexibility * 0.18 - species.seasonal.dormancyTendency * 0.1,
      0.14,
      0.9,
    ),
    reserveLevel: clamp(
      species.seasonal.resourceStorageCapacity * (0.18 + species.seasonal.dormancyTendency * 0.16),
      0,
      0.7,
    ),
    foliageLevel: clamp(0.28 + species.seasonal.leafPersistence * 0.38, 0.12, 0.92),
    dormancyPressure: 0,
  };
}
