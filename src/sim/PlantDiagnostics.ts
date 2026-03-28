export type PlantDiagnosticOverlayMode =
  | "none"
  | "biomass"
  | "reproduction"
  | "activity"
  | "stress"
  | "suitability"
  | "species";

export interface PlantHistorySeries {
  biomass: number[];
  reserve: number[];
  moisture: number[];
  stress: number[];
  reproduction: number[];
}

export interface PlantPopulationDiagnostics {
  recentColonizations: number;
  recentDeaths: number;
  recentExtinctions: number;
  averageReproductionReadiness: number;
  topExpandingLineages: string;
  topDecliningLineages: string;
}

export interface PlantSelectionDiagnostics {
  cellX: number;
  cellY: number;
  occupied: boolean;
  speciesId: number | null;
  parentSpeciesId: number | null;
  generation: number | null;
  lineageLabel: string;
  explanation: string;
  currentState: {
    ageSeconds: number;
    biomass: number;
    health: number;
    vigor: number;
    reserveLevel: number;
    activityLevel: number;
    dormancyPressure: number;
    foliageLevel: number;
    maturityLevel: number;
    reproductionReadiness: number;
  };
  reproduction: {
    allowedLikely: boolean;
    blockedReason: string;
    spreadAbility: number;
    spreadDrive: number;
    spreadScale: number;
    colonizationThreshold: number;
    localSuitability: number;
    reproductionThreshold: number;
    reserveSufficiency: number;
    neighborSupport: number;
  };
  decline: {
    maintenanceBurden: number;
    droughtStress: number;
    floodStress: number;
    temperatureStress: number;
    seasonalSuppression: number;
    slopeStress: number;
    standingWaterStress: number;
    carryingCapacityPressure: number;
    totalStress: number;
    dominantStress: string;
  };
  budget: {
    netBiomassDelta: number;
    totalGain: number;
    totalLoss: number;
    growthGain: number;
    colonizationGain: number;
    declineLoss: number;
    maintenanceLoss: number;
    droughtLoss: number;
    floodLoss: number;
    slopeLoss: number;
    standingWaterLoss: number;
    storageRelief: number;
    reserveDelta: number;
    activityDelta: number;
    foliageDelta: number;
    growthSuppression: number;
    reserveGain: number;
    reserveUse: number;
    storageDemand: number;
    storageRecovery: number;
    opportunity: number;
    unfavorablePressure: number;
    maintenanceScale: number;
    waterDemandScale: number;
    growthScale: number;
    stressScale: number;
    targetActivity: number;
    targetFoliage: number;
    growthPotential: number;
    declinePressure: number;
    competitionPressure: number;
    competitionAdvantage: number;
  };
  lastOccupant: {
    speciesId: number | null;
    generation: number | null;
    ageSeconds: number;
    deathReason: string | null;
    biomassBeforeDeath: number;
  } | null;
  environment: {
    soilMoisture: number;
    surfaceWater: number;
    persistentWetness: number;
    floodProne: number;
    temperature: number;
    slope: number;
    soilDepth: number;
    coarseSurface: number;
    bedrockExposure: number;
    seasonPhase: number;
    rainMultiplier: number;
    temperatureOffset: number;
    evaporationMultiplier: number;
    seasonLabel: string;
  };
  fitness: {
    carryingCapacity: number;
    suitability: number;
    positive: Record<string, number>;
    negative: Record<string, number>;
  };
  history: PlantHistorySeries;
  traits?: {
    ecology: Record<string, number>;
    morphology: Record<string, number>;
    seasonal: Record<string, number>;
  };
}
