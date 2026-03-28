import { clamp, lerp } from "../utils/math";
import { createSeededRandom, mixSeed } from "../utils/random";

export const ECOLOGY_PROFILE_DRYLAND = 0;
export const ECOLOGY_PROFILE_MESIC = 1;
export const ECOLOGY_PROFILE_WETLAND = 2;

export const SPECIES_NONE = 65535;

export enum PlantLeafType {
  Blade = 0,
  Broad = 1,
  Needle = 2,
  Frond = 3,
  Reed = 4,
}

export enum PlantPhenotypeClass {
  Grass = 0,
  FloweringHerb = 1,
  Shrub = 2,
  BroadleafTree = 3,
  Conifer = 4,
  Palm = 5,
  Reed = 6,
}

export interface PlantEcologyTraits {
  moisturePreference: number;
  moistureTolerance: number;
  persistentWetnessPreference: number;
  floodTolerance: number;
  standingWaterTolerance: number;
  droughtTolerance: number;
  optimalTemperature: number;
  temperatureTolerance: number;
  heatStressResistance: number;
  slopeTolerance: number;
  spreadAbility: number;
  vigor: number;
}

export interface PlantMorphologyTraits {
  maxHeight: number;
  woodiness: number;
  stemCount: number;
  trunkThickness: number;
  apicalDominance: number;
  branchDensity: number;
  branchingRate: number;
  branchAngle: number;
  crownWidth: number;
  crownHeight: number;
  verticalBias: number;
  lateralSpread: number;
  crownDensity: number;
  crownRadius: number;
  topFoliageBias: number;
  basalSpread: number;
  foliageDensity: number;
  leafSize: number;
  leafAspectRatio: number;
  leafDensity: number;
  leafType: PlantLeafType;
  floweriness: number;
  topCanopyBias: number;
  groundCoverFactor: number;
  uprightness: number;
  clumping: number;
}

export interface PlantSeasonalTraits {
  dormancyTendency: number;
  dormancyTriggerDryness: number;
  dormancyTriggerColdOrLowTemperature: number;
  resourceStorageCapacity: number;
  reactivationSpeed: number;
  growthWindowFlexibility: number;
  leafPersistence: number;
  leafDropBias: number;
  regrowthRate: number;
  reproductionThreshold: number;
}

export interface PlantSpeciesDefinition {
  id: number;
  parentId: number | null;
  generation: number;
  name: string;
  ecologyProfile: number;
  ecology: PlantEcologyTraits;
  morphology: PlantMorphologyTraits;
  seasonal: PlantSeasonalTraits;
  phenotype: PlantPhenotypeClass;
  hueSeed: number;
}

export interface HabitatPressureProfile {
  moisture: number;
  temperature: number;
  persistentWetness: number;
  floodProne: number;
  standingWater: number;
  slope: number;
  stability: number;
  dryness: number;
  fertileMoisture: number;
  channelInfluence: number;
  lowland: number;
  heatStress: number;
}

export interface PlantRenderParameters {
  heightScale: number;
  stemCopies: number;
  stemBaseRadius: number;
  stemClusterRadius: number;
  primaryStemHeightFraction: number;
  branchCopies: number;
  branchAngle: number;
  branchReach: number;
  branchElevationBias: number;
  crownRadius: number;
  crownHeight: number;
  crownDensity: number;
  foliageAmount: number;
  foliageTopBias: number;
  foliageVerticalSpan: number;
  foliageClusterCopies: number;
  foliageLateralSpread: number;
  leafLength: number;
  leafWidth: number;
  leafTilt: number;
  flowerAmount: number;
  groundPatchScale: number;
  descriptiveLabel: string;
}

interface SpeciesTemplate {
  label: string;
  ecologyProfile: number;
  ecology: PlantEcologyTraits;
  morphology: PlantMorphologyTraits;
}

export interface PlantMorphologyDebugSummary {
  label: string;
  woodiness: number;
  stature: number;
  canopySpread: number;
  branchiness: number;
  coverage: number;
  leafExpression: string;
}

export interface PlantMorphologyEcologyEffects {
  maintenanceCost: number;
  droughtBurden: number;
  competitionStrength: number;
  floodSuitability: number;
  terrainStability: number;
  spreadDrive: number;
  establishmentCost: number;
}

export const MORPHOLOGY_BOUNDS = {
  maxHeight: [0.2, 15] as const,
  woodiness: [0, 1] as const,
  stemCount: [1, 8] as const,
  trunkThickness: [0.02, 1] as const,
  apicalDominance: [0, 1] as const,
  branchDensity: [0, 1] as const,
  branchingRate: [0, 1] as const,
  branchAngle: [0.08, 1.2] as const,
  crownWidth: [0.1, 6] as const,
  crownHeight: [0.08, 6] as const,
  verticalBias: [0, 1] as const,
  lateralSpread: [0, 1] as const,
  crownDensity: [0, 1] as const,
  crownRadius: [0.08, 6] as const,
  topFoliageBias: [0, 1] as const,
  basalSpread: [0, 1] as const,
  foliageDensity: [0, 1] as const,
  leafSize: [0.03, 1.4] as const,
  leafAspectRatio: [0.2, 5] as const,
  leafDensity: [0, 1] as const,
  floweriness: [0, 1] as const,
  topCanopyBias: [0, 1] as const,
  groundCoverFactor: [0, 1] as const,
  uprightness: [0, 1] as const,
  clumping: [0, 1] as const,
};

export const SEASONAL_BOUNDS = {
  dormancyTendency: [0, 1] as const,
  dormancyTriggerDryness: [0.08, 0.95] as const,
  dormancyTriggerColdOrLowTemperature: [0.08, 0.95] as const,
  resourceStorageCapacity: [0, 1] as const,
  reactivationSpeed: [0, 1] as const,
  growthWindowFlexibility: [0, 1] as const,
  leafPersistence: [0, 1] as const,
  leafDropBias: [0, 1] as const,
  regrowthRate: [0, 1] as const,
  reproductionThreshold: [0.05, 0.95] as const,
};

export const MORPHOLOGY_ECOLOGY_SETTINGS = {
  maintenanceSizeWeight: 0.34,
  maintenanceStructureWeight: 0.28,
  maintenanceFoliageWeight: 0.2,
  maintenanceBranchingWeight: 0.18,
  droughtStructureWeight: 0.34,
  droughtFoliageWeight: 0.42,
  droughtMitigationWeight: 0.24,
  competitionHeightWeight: 0.3,
  competitionCanopyWeight: 0.28,
  competitionTopBiasWeight: 0.12,
  competitionWoodinessWeight: 0.1,
  competitionBranchingWeight: 0.2,
  floodUprightWeight: 0.22,
  floodTopBiasWeight: 0.16,
  floodClumpingWeight: 0.14,
  floodLightnessWeight: 0.14,
  floodLeafSlenderWeight: 0.18,
  floodSpreadPenalty: 0.16,
  terrainBaseSupportWeight: 0.28,
  terrainSpreadWeight: 0.24,
  terrainGroundCoverWeight: 0.2,
  terrainClumpingWeight: 0.08,
  terrainHeightPenalty: 0.12,
  terrainCanopyPenalty: 0.08,
  spreadCoverWeight: 0.3,
  spreadBasalWeight: 0.22,
  spreadLateralWeight: 0.16,
  spreadStemWeight: 0.12,
  spreadCheapnessWeight: 0.2,
  establishmentSizeWeight: 0.28,
  establishmentWoodWeight: 0.24,
  establishmentCanopyWeight: 0.18,
  establishmentSpreadReliefWeight: 0.16,
  establishmentGroundReliefWeight: 0.14,
} as const;

/**
 * Plant species definitions sit between ecology and rendering. They keep the
 * ecological trait set separate from visible morphology, but expose both so
 * future inheritance and mutation systems can evolve appearance and survival
 * pressure independently.
 */
export function createInitialSpeciesCatalog(seed: number): PlantSpeciesDefinition[] {
  const templates = createTemplates();

  return templates.map((template, index) => {
    const random = createSeededRandom(seed + index * 731);
    const ecology = mutateEcology(template.ecology, random, 0.08);
    const morphology = mutateMorphology(template.morphology, random, 0.09);
    const seasonal = mutateSeasonal(
      deriveBaseSeasonalTraits(ecology, morphology),
      random,
      0.08,
      undefined,
      ecology,
      morphology,
    );
    const phenotype = classifyPhenotype(morphology);

    return {
      id: index,
      parentId: null,
      generation: 0,
      name: `${template.label} ${index + 1}`,
      ecologyProfile: template.ecologyProfile,
      ecology,
      morphology,
      seasonal,
      phenotype,
      hueSeed: mixSeed(seed + index * 1237),
    };
  });
}

export function mutateSpecies(
  parent: PlantSpeciesDefinition,
  newId: number,
  seed: number,
  habitat?: HabitatPressureProfile,
): PlantSpeciesDefinition {
  const random = createSeededRandom(seed + newId * 977 + parent.id * 131);
  const ecology = mutateEcology(parent.ecology, random, 0.12, habitat);
  const morphology = mutateMorphology(parent.morphology, random, 0.14, habitat, ecology);
  const seasonal = mutateSeasonal(parent.seasonal, random, 0.12, habitat, ecology, morphology);
  const phenotype = classifyPhenotype(morphology);

  return {
    id: newId,
    parentId: parent.id,
    generation: parent.generation + 1,
    name: `${parent.name.split(" ")[0]} ${newId + 1}`,
    ecologyProfile: classifyEcologyProfile(ecology),
    ecology,
    morphology,
    seasonal,
    phenotype,
    hueSeed: mixSeed(seed + newId * 1543 + parent.hueSeed),
  };
}

export function buildHabitatPressureProfile(
  moisture: number,
  temperature: number,
  persistentWetness: number,
  floodProne: number,
  standingWater: number,
  slope: number,
  wetAdjacency: number,
  normalizedElevation: number,
): HabitatPressureProfile {
  const stability = clamp((1 - slope) * 0.82 + (1 - floodProne) * 0.18, 0, 1);
  const dryness = clamp((1 - moisture) * 0.72 + slope * 0.18 + (1 - wetAdjacency) * 0.1, 0, 1);
  const fertileMoisture = clamp(
    moisture * 0.46 + stability * 0.26 + wetAdjacency * 0.18 + (1 - standingWater) * 0.1,
    0,
    1,
  );
  const channelInfluence = clamp(
    persistentWetness * 0.34 + floodProne * 0.26 + wetAdjacency * 0.24 + standingWater * 0.16,
    0,
    1,
  );
  const lowland = clamp((1 - normalizedElevation) * 0.68 + persistentWetness * 0.18 + wetAdjacency * 0.14, 0, 1);
  const heatStress = clamp(
    temperature * 0.7 + (1 - moisture) * 0.2 + slope * 0.1,
    0,
    1,
  );

  return {
    moisture,
    temperature,
    persistentWetness,
    floodProne,
    standingWater,
    slope,
    stability,
    dryness,
    fertileMoisture,
    channelInfluence,
    lowland,
    heatStress,
  };
}

export function evaluateMorphologyHabitatFit(
  species: PlantSpeciesDefinition,
  habitat: HabitatPressureProfile,
): number {
  const morphology = species.morphology;
  const heightNorm = morphology.maxHeight / MORPHOLOGY_BOUNDS.maxHeight[1];
  const crownNorm = morphology.crownWidth / MORPHOLOGY_BOUNDS.crownWidth[1];
  const needleBias = morphology.leafType === PlantLeafType.Needle ? 1 : 0;
  const reedBias = morphology.leafType === PlantLeafType.Reed ? 1 : 0;

  const dryLowFormFit =
    habitat.dryness *
    clamp(
      morphology.groundCoverFactor * 0.42 +
        (1 - heightNorm) * 0.22 +
        (1 - crownNorm) * 0.12 +
        (1 - morphology.woodiness) * 0.12 +
        morphology.basalSpread * 0.12,
      0,
      1,
    );
  const wetlandFit =
    habitat.channelInfluence *
    clamp(
      species.ecology.floodTolerance * 0.28 +
        morphology.uprightness * 0.18 +
        morphology.topCanopyBias * 0.1 +
        morphology.leafDensity * 0.1 +
        morphology.verticalBias * 0.08 +
        reedBias * 0.26,
      0,
      1,
    );
  const fertileTallFit =
    habitat.fertileMoisture *
    habitat.stability *
    clamp(
      heightNorm * 0.3 +
        morphology.woodiness * 0.24 +
        morphology.branchDensity * 0.12 +
        crownNorm * 0.12 +
        morphology.crownDensity * 0.12 +
        morphology.foliageDensity * 0.1,
      0,
      1,
    );
  const slopeFit =
    habitat.slope *
    clamp(
        morphology.uprightness * 0.16 +
        (1 - crownNorm) * 0.16 +
        (1 - morphology.groundCoverFactor) * 0.08 +
        species.ecology.slopeTolerance * 0.16 +
        needleBias * 0.18 +
        morphology.apicalDominance * 0.1,
      0,
      1,
    );

  const droughtCost =
    habitat.dryness *
    clamp(
      heightNorm * 0.24 +
        crownNorm * 0.16 +
        morphology.leafSize / MORPHOLOGY_BOUNDS.leafSize[1] * 0.12 +
        morphology.crownDensity * 0.08,
      0,
      0.4,
    );
  const floodCost =
    habitat.channelInfluence *
    clamp(
      morphology.woodiness * 0.08 +
        heightNorm * 0.08 +
        needleBias * 0.1,
      0,
      0.28,
    );

  return clamp(dryLowFormFit + wetlandFit + fertileTallFit + slopeFit - droughtCost - floodCost, 0, 1);
}

export function dominantHabitatPressure(habitat: HabitatPressureProfile): string {
  const options: Array<[string, number]> = [
    ["flooded margin", habitat.channelInfluence * 0.9 + habitat.floodProne * 0.1],
    ["dry stress", habitat.dryness],
    ["fertile stable", habitat.fertileMoisture * habitat.stability],
    ["steep slope", habitat.slope],
  ];

  return options.sort((left, right) => right[1] - left[1])[0]?.[0] ?? "mixed";
}

/**
 * The phenotype classifier is now only a descriptive summary. Rendering is
 * driven by continuous morphology traits; this label remains for debugging and
 * high-level inspection.
 */
export function classifyPhenotype(morphology: PlantMorphologyTraits): PlantPhenotypeClass {
  if (
    morphology.leafType === PlantLeafType.Reed ||
    (morphology.woodiness < 0.2 && morphology.uprightness > 0.78 && morphology.groundCoverFactor > 0.45)
  ) {
    return PlantPhenotypeClass.Reed;
  }

  if (
    morphology.leafType === PlantLeafType.Blade &&
    morphology.maxHeight < 1.1 &&
    morphology.groundCoverFactor > 0.5 &&
    morphology.woodiness < 0.18
  ) {
    return PlantPhenotypeClass.Grass;
  }

  if (
    morphology.leafType === PlantLeafType.Frond &&
    morphology.topCanopyBias > 0.72 &&
    morphology.maxHeight > 3.2
  ) {
    return PlantPhenotypeClass.Palm;
  }

  if (
    morphology.leafType === PlantLeafType.Needle &&
    morphology.maxHeight > 3 &&
    morphology.topCanopyBias > 0.55
  ) {
    return PlantPhenotypeClass.Conifer;
  }

  if (
    morphology.woodiness > 0.58 &&
    morphology.maxHeight > 4 &&
    morphology.crownWidth > 1.6
  ) {
    return PlantPhenotypeClass.BroadleafTree;
  }

  if (morphology.woodiness > 0.34 && morphology.maxHeight > 1.1) {
    return PlantPhenotypeClass.Shrub;
  }

  return PlantPhenotypeClass.FloweringHerb;
}

export function derivePlantRenderParameters(
  species: PlantSpeciesDefinition,
): PlantRenderParameters {
  const morphology = species.morphology;
  const descriptor = summarizeMorphology(species);
  const stemCopies = Math.max(
    1,
    Math.round(
      morphology.stemCount * (0.45 + morphology.groundCoverFactor * 0.18 + (1 - morphology.clumping) * 0.12),
    ),
  );
  const primaryStemHeightFraction = clamp(
    0.18 +
      morphology.apicalDominance * 0.34 +
      morphology.verticalBias * 0.18 +
      morphology.woodiness * 0.14,
    0.08,
    0.94,
  );
  const branchCopies = Math.round(
    clamp(
      morphology.branchingRate * 5 +
        morphology.branchDensity * 3 +
        morphology.crownDensity * 2 -
        morphology.groundCoverFactor * 2,
      0,
      12,
    ),
  );
  const crownRadius = clamp(
    morphology.crownRadius * (0.65 + morphology.lateralSpread * 0.35),
    0.08,
    6,
  );
  const crownHeight = clamp(
    morphology.crownHeight * (0.6 + morphology.verticalBias * 0.4),
    0.08,
    6,
  );
  const leafLength = clamp(
    morphology.leafSize * (0.85 + morphology.leafAspectRatio * 0.22),
    0.03,
    1.9,
  );
  const leafWidth = clamp(
    morphology.leafSize / Math.max(morphology.leafAspectRatio, 0.2) * 0.95,
    0.015,
    0.9,
  );

  return {
    heightScale: morphology.maxHeight,
    stemCopies,
    stemBaseRadius: clamp(
      morphology.trunkThickness * (0.55 + morphology.woodiness * 0.45),
      0.02,
      1,
    ),
    stemClusterRadius: clamp(
      morphology.basalSpread * (0.18 + morphology.maxHeight * 0.03) * (1 - morphology.clumping * 0.35),
      0.02,
      2.4,
    ),
    primaryStemHeightFraction,
    branchCopies,
    branchAngle: morphology.branchAngle,
    branchReach: clamp(
      morphology.lateralSpread * 0.4 + crownRadius * 0.24 + (1 - morphology.verticalBias) * 0.12,
      0.04,
      2.8,
    ),
    branchElevationBias: clamp(
      morphology.apicalDominance * 0.45 + morphology.topFoliageBias * 0.35 + morphology.verticalBias * 0.2,
      0,
      1,
    ),
    crownRadius,
    crownHeight,
    crownDensity: clamp(
      morphology.crownDensity * 0.65 + morphology.branchDensity * 0.2 + morphology.foliageDensity * 0.15,
      0,
      1,
    ),
    foliageAmount: clamp(
      morphology.foliageDensity * 0.46 + morphology.leafDensity * 0.34 + morphology.crownDensity * 0.2,
      0.04,
      1,
    ),
    foliageTopBias: clamp(
      morphology.topFoliageBias * 0.7 + morphology.topCanopyBias * 0.2 + morphology.apicalDominance * 0.1,
      0,
      1,
    ),
    foliageVerticalSpan: clamp(
      morphology.crownHeight * (0.42 + morphology.crownDensity * 0.22 + (1 - morphology.topFoliageBias) * 0.2),
      0.12,
      4.5,
    ),
    foliageClusterCopies: Math.round(
      clamp(
        morphology.foliageDensity * 5 +
          morphology.crownDensity * 3 +
          morphology.branchingRate * 2 +
          morphology.groundCoverFactor * 2,
        1,
        14,
      ),
    ),
    foliageLateralSpread: clamp(
      morphology.lateralSpread * 0.42 + morphology.crownRadius * 0.18 + morphology.groundCoverFactor * 0.12,
      0.03,
      2.5,
    ),
    leafLength,
    leafWidth,
    leafTilt: clamp(
      (1 - morphology.verticalBias) * 0.5 + morphology.branchAngle * 0.22 + morphology.leafAspectRatio * 0.04,
      0.05,
      1.2,
    ),
    flowerAmount: morphology.floweriness,
    groundPatchScale: clamp(morphology.groundCoverFactor * 1.1, 0.18, 1),
    descriptiveLabel: descriptor.label,
  };
}

export function getSpeciesDisplayColor(species: PlantSpeciesDefinition): {
  foliage: [number, number, number];
  wood: [number, number, number];
  flower: [number, number, number];
} {
  const hueSeed = ((species.hueSeed % 1000) / 1000) * 0.18;
  const morphology = species.morphology;
  const ecologicalMoistureBias =
    species.ecology.moisturePreference * 0.06 + species.ecology.persistentWetnessPreference * 0.03;
  const dryBias = (1 - species.ecology.moisturePreference) * 0.04;
  const foliageHue =
    0.19 +
    hueSeed +
    ecologicalMoistureBias -
    dryBias +
    morphology.woodiness * 0.015 +
    morphology.leafSize * 0.012 -
    morphology.leafAspectRatio * 0.004;
  const saturation =
    0.38 +
    ((species.hueSeed >> 10) % 100) / 320 +
    morphology.foliageDensity * 0.12 +
    morphology.leafDensity * 0.08;
  const value =
    0.3 +
    ((species.hueSeed >> 18) % 100) / 260 +
    species.ecology.vigor * 0.12 +
    species.ecology.moisturePreference * 0.06;
  const foliage = hsvToRgb(foliageHue, clamp(saturation, 0.22, 0.86), clamp(value, 0.2, 0.92));
  const wood: [number, number, number] = [
    lerp(0.27, 0.44, species.morphology.woodiness * 0.65),
    lerp(0.18, 0.28, species.morphology.woodiness * 0.4),
    lerp(0.09, 0.16, species.morphology.woodiness * 0.3),
  ];
  const flowerHue = 0.82 + ((species.hueSeed >> 6) % 100) / 700;
  const flower = hsvToRgb(flowerHue % 1, 0.45, 0.92);

  return { foliage, wood, flower };
}

/**
 * MorphologyEcologyEffects are the shared bridge between visible structure and
 * ecological function. Vegetation dynamics use these values directly, so
 * evolution is selecting on rendered form rather than on hidden visual-only
 * traits.
 */
export function deriveMorphologyEcologyEffects(
  species: PlantSpeciesDefinition,
): PlantMorphologyEcologyEffects {
  const morphology = species.morphology;
  const heightNorm = morphology.maxHeight / MORPHOLOGY_BOUNDS.maxHeight[1];
  const trunkNorm = normalizeTrait(morphology.trunkThickness, MORPHOLOGY_BOUNDS.trunkThickness);
  const crownNorm = morphology.crownRadius / MORPHOLOGY_BOUNDS.crownRadius[1];
  const stemNorm = normalizeTrait(morphology.stemCount, MORPHOLOGY_BOUNDS.stemCount);
  const slenderLeafBias = clamp((morphology.leafAspectRatio - 1) / 4, 0, 1);
  const canopyMass = clamp(
    crownNorm * 0.36 + morphology.crownDensity * 0.32 + morphology.foliageDensity * 0.32,
    0,
    1,
  );
  const structuralMass = clamp(
    heightNorm * 0.4 + morphology.woodiness * 0.34 + trunkNorm * 0.26,
    0,
    1,
  );
  const branchingComplexity = clamp(
    morphology.branchingRate * 0.42 + morphology.branchDensity * 0.34 + stemNorm * 0.24,
    0,
    1,
  );
  const groundReach = clamp(
    morphology.groundCoverFactor * 0.42 + morphology.basalSpread * 0.32 + morphology.lateralSpread * 0.26,
    0,
    1,
  );

  const maintenanceCost = clamp(
    structuralMass * MORPHOLOGY_ECOLOGY_SETTINGS.maintenanceSizeWeight +
      canopyMass * MORPHOLOGY_ECOLOGY_SETTINGS.maintenanceFoliageWeight +
      branchingComplexity * MORPHOLOGY_ECOLOGY_SETTINGS.maintenanceBranchingWeight +
      morphology.woodiness * MORPHOLOGY_ECOLOGY_SETTINGS.maintenanceStructureWeight,
    0,
    1,
  );
  const droughtBurden = clamp(
    structuralMass * MORPHOLOGY_ECOLOGY_SETTINGS.droughtStructureWeight +
      canopyMass * MORPHOLOGY_ECOLOGY_SETTINGS.droughtFoliageWeight -
      (
        groundReach * 0.12 +
        (1 - morphology.topFoliageBias) * 0.07 +
        (1 - maintenanceCost) * 0.05
      ) *
        MORPHOLOGY_ECOLOGY_SETTINGS.droughtMitigationWeight,
    0,
    1,
  );
  const competitionStrength = clamp(
    heightNorm * MORPHOLOGY_ECOLOGY_SETTINGS.competitionHeightWeight +
      canopyMass * MORPHOLOGY_ECOLOGY_SETTINGS.competitionCanopyWeight +
      morphology.topFoliageBias * MORPHOLOGY_ECOLOGY_SETTINGS.competitionTopBiasWeight +
      morphology.woodiness * MORPHOLOGY_ECOLOGY_SETTINGS.competitionWoodinessWeight +
      branchingComplexity * MORPHOLOGY_ECOLOGY_SETTINGS.competitionBranchingWeight,
    0,
    1,
  );
  const floodSuitability = clamp(
    morphology.uprightness * MORPHOLOGY_ECOLOGY_SETTINGS.floodUprightWeight +
      morphology.topFoliageBias * MORPHOLOGY_ECOLOGY_SETTINGS.floodTopBiasWeight +
      morphology.clumping * MORPHOLOGY_ECOLOGY_SETTINGS.floodClumpingWeight +
      (1 - morphology.woodiness) * MORPHOLOGY_ECOLOGY_SETTINGS.floodLightnessWeight +
      slenderLeafBias * MORPHOLOGY_ECOLOGY_SETTINGS.floodLeafSlenderWeight -
      crownNorm * MORPHOLOGY_ECOLOGY_SETTINGS.floodSpreadPenalty,
    0,
    1,
  );
  const terrainStability = clamp(
    morphology.woodiness * MORPHOLOGY_ECOLOGY_SETTINGS.terrainBaseSupportWeight +
      morphology.basalSpread * MORPHOLOGY_ECOLOGY_SETTINGS.terrainSpreadWeight +
      morphology.groundCoverFactor * MORPHOLOGY_ECOLOGY_SETTINGS.terrainGroundCoverWeight +
      morphology.clumping * MORPHOLOGY_ECOLOGY_SETTINGS.terrainClumpingWeight -
      heightNorm * MORPHOLOGY_ECOLOGY_SETTINGS.terrainHeightPenalty -
      crownNorm * MORPHOLOGY_ECOLOGY_SETTINGS.terrainCanopyPenalty,
    0,
    1,
  );
  const spreadDrive = clamp(
    morphology.groundCoverFactor * MORPHOLOGY_ECOLOGY_SETTINGS.spreadCoverWeight +
      morphology.basalSpread * MORPHOLOGY_ECOLOGY_SETTINGS.spreadBasalWeight +
      morphology.lateralSpread * MORPHOLOGY_ECOLOGY_SETTINGS.spreadLateralWeight +
      stemNorm * MORPHOLOGY_ECOLOGY_SETTINGS.spreadStemWeight +
      (1 - maintenanceCost) * MORPHOLOGY_ECOLOGY_SETTINGS.spreadCheapnessWeight,
    0,
    1,
  );
  const establishmentCost = clamp(
    structuralMass * MORPHOLOGY_ECOLOGY_SETTINGS.establishmentSizeWeight +
      morphology.woodiness * MORPHOLOGY_ECOLOGY_SETTINGS.establishmentWoodWeight +
      canopyMass * MORPHOLOGY_ECOLOGY_SETTINGS.establishmentCanopyWeight -
      spreadDrive * MORPHOLOGY_ECOLOGY_SETTINGS.establishmentSpreadReliefWeight -
      groundReach * MORPHOLOGY_ECOLOGY_SETTINGS.establishmentGroundReliefWeight,
    0,
    1,
  );

  return {
    maintenanceCost,
    droughtBurden,
    competitionStrength,
    floodSuitability,
    terrainStability,
    spreadDrive,
    establishmentCost,
  };
}

/**
 * This helper exists to verify that descriptive plant names are assigned after
 * morphology is generated. It reads only the continuous trait state and does
 * not feed back into structure generation.
 */
export function summarizeMorphology(species: PlantSpeciesDefinition): PlantMorphologyDebugSummary {
  const morphology = species.morphology;
  const heightNorm = morphology.maxHeight / MORPHOLOGY_BOUNDS.maxHeight[1];
  const spreadNorm = morphology.crownRadius / MORPHOLOGY_BOUNDS.crownRadius[1];
  const branchiness = clamp(
    morphology.branchingRate * 0.45 + morphology.branchDensity * 0.35 + morphology.crownDensity * 0.2,
    0,
    1,
  );
  const coverage = clamp(
    morphology.groundCoverFactor * 0.45 + morphology.basalSpread * 0.3 + (1 - morphology.clumping) * 0.25,
    0,
    1,
  );
  const leafExpression = leafTypeName(morphology.leafType);

  let label = "mixed growth form";
  if (coverage > 0.62 && morphology.woodiness < 0.22 && heightNorm < 0.16) {
    label = morphology.verticalBias > 0.72 ? "grass-like cover" : "low spreading cover";
  } else if (morphology.woodiness < 0.24 && morphology.verticalBias > 0.74 && morphology.topFoliageBias > 0.62) {
    label = "upright wetland form";
  } else if (morphology.woodiness > 0.64 && heightNorm > 0.32 && branchiness < 0.42 && morphology.topFoliageBias > 0.76) {
    label = "columnar canopy form";
  } else if (morphology.woodiness > 0.62 && heightNorm > 0.28 && spreadNorm > 0.22) {
    label = "canopy tree form";
  } else if (morphology.woodiness > 0.38 && coverage > 0.28) {
    label = "woody spreader";
  } else if (heightNorm > 0.18 && morphology.woodiness < 0.36 && branchiness < 0.3) {
    label = "sparse upright form";
  } else if (branchiness > 0.5 && coverage > 0.24) {
    label = "bushy intermediate form";
  }

  return {
    label,
    woodiness: morphology.woodiness,
    stature: heightNorm,
    canopySpread: spreadNorm,
    branchiness,
    coverage,
    leafExpression,
  };
}

export function phenotypeName(phenotype: PlantPhenotypeClass): string {
  switch (phenotype) {
    case PlantPhenotypeClass.Grass:
      return "grass";
    case PlantPhenotypeClass.FloweringHerb:
      return "flowering herb";
    case PlantPhenotypeClass.Shrub:
      return "shrub";
    case PlantPhenotypeClass.BroadleafTree:
      return "broadleaf tree";
    case PlantPhenotypeClass.Conifer:
      return "conifer";
    case PlantPhenotypeClass.Palm:
      return "palm";
    case PlantPhenotypeClass.Reed:
      return "reed";
  }
}

function createTemplates(): SpeciesTemplate[] {
  return [
    {
      label: "Grass",
      ecologyProfile: ECOLOGY_PROFILE_DRYLAND,
      ecology: {
        moisturePreference: 0.26,
        moistureTolerance: 0.34,
        persistentWetnessPreference: 0.2,
        floodTolerance: 0.22,
        standingWaterTolerance: 0.06,
        droughtTolerance: 0.78,
        optimalTemperature: 0.68,
        temperatureTolerance: 0.26,
        heatStressResistance: 0.72,
        slopeTolerance: 0.78,
        spreadAbility: 0.72,
        vigor: 0.68,
      },
      morphology: {
        maxHeight: 0.55,
        woodiness: 0.06,
        stemCount: 5,
        trunkThickness: 0.03,
        apicalDominance: 0.18,
        branchDensity: 0.12,
        branchingRate: 0.08,
        branchAngle: 0.62,
        crownWidth: 0.48,
        crownHeight: 0.32,
        verticalBias: 0.78,
        lateralSpread: 0.48,
        crownDensity: 0.18,
        crownRadius: 0.42,
        topFoliageBias: 0.24,
        basalSpread: 0.74,
        foliageDensity: 0.72,
        leafSize: 0.12,
        leafAspectRatio: 3.8,
        leafDensity: 0.72,
        leafType: PlantLeafType.Blade,
        floweriness: 0.08,
        topCanopyBias: 0.18,
        groundCoverFactor: 0.84,
        uprightness: 0.74,
        clumping: 0.58,
      },
    },
    {
      label: "Herb",
      ecologyProfile: ECOLOGY_PROFILE_MESIC,
      ecology: {
        moisturePreference: 0.48,
        moistureTolerance: 0.28,
        persistentWetnessPreference: 0.38,
        floodTolerance: 0.32,
        standingWaterTolerance: 0.08,
        droughtTolerance: 0.36,
        optimalTemperature: 0.58,
        temperatureTolerance: 0.22,
        heatStressResistance: 0.42,
        slopeTolerance: 0.54,
        spreadAbility: 0.56,
        vigor: 0.58,
      },
      morphology: {
        maxHeight: 0.9,
        woodiness: 0.12,
        stemCount: 3,
        trunkThickness: 0.04,
        apicalDominance: 0.32,
        branchDensity: 0.24,
        branchingRate: 0.22,
        branchAngle: 0.78,
        crownWidth: 0.42,
        crownHeight: 0.5,
        verticalBias: 0.62,
        lateralSpread: 0.38,
        crownDensity: 0.32,
        crownRadius: 0.44,
        topFoliageBias: 0.42,
        basalSpread: 0.42,
        foliageDensity: 0.56,
        leafSize: 0.22,
        leafAspectRatio: 1.6,
        leafDensity: 0.5,
        leafType: PlantLeafType.Broad,
        floweriness: 0.7,
        topCanopyBias: 0.42,
        groundCoverFactor: 0.44,
        uprightness: 0.62,
        clumping: 0.44,
      },
    },
    {
      label: "Shrub",
      ecologyProfile: ECOLOGY_PROFILE_MESIC,
      ecology: {
        moisturePreference: 0.42,
        moistureTolerance: 0.24,
        persistentWetnessPreference: 0.34,
        floodTolerance: 0.24,
        standingWaterTolerance: 0.06,
        droughtTolerance: 0.54,
        optimalTemperature: 0.56,
        temperatureTolerance: 0.2,
        heatStressResistance: 0.5,
        slopeTolerance: 0.56,
        spreadAbility: 0.42,
        vigor: 0.64,
      },
      morphology: {
        maxHeight: 1.9,
        woodiness: 0.58,
        stemCount: 4,
        trunkThickness: 0.08,
        apicalDominance: 0.34,
        branchDensity: 0.58,
        branchingRate: 0.52,
        branchAngle: 0.82,
        crownWidth: 1.2,
        crownHeight: 0.92,
        verticalBias: 0.46,
        lateralSpread: 0.72,
        crownDensity: 0.58,
        crownRadius: 1.04,
        topFoliageBias: 0.38,
        basalSpread: 0.64,
        foliageDensity: 0.68,
        leafSize: 0.2,
        leafAspectRatio: 1.3,
        leafDensity: 0.72,
        leafType: PlantLeafType.Broad,
        floweriness: 0.14,
        topCanopyBias: 0.46,
        groundCoverFactor: 0.34,
        uprightness: 0.52,
        clumping: 0.62,
      },
    },
    {
      label: "Broadleaf",
      ecologyProfile: ECOLOGY_PROFILE_MESIC,
      ecology: {
        moisturePreference: 0.46,
        moistureTolerance: 0.22,
        persistentWetnessPreference: 0.36,
        floodTolerance: 0.2,
        standingWaterTolerance: 0.05,
        droughtTolerance: 0.42,
        optimalTemperature: 0.5,
        temperatureTolerance: 0.18,
        heatStressResistance: 0.38,
        slopeTolerance: 0.5,
        spreadAbility: 0.3,
        vigor: 0.62,
      },
      morphology: {
        maxHeight: 7.4,
        woodiness: 0.86,
        stemCount: 1,
        trunkThickness: 0.22,
        apicalDominance: 0.72,
        branchDensity: 0.7,
        branchingRate: 0.64,
        branchAngle: 0.68,
        crownWidth: 2.7,
        crownHeight: 2.3,
        verticalBias: 0.74,
        lateralSpread: 0.68,
        crownDensity: 0.74,
        crownRadius: 2.5,
        topFoliageBias: 0.62,
        basalSpread: 0.18,
        foliageDensity: 0.82,
        leafSize: 0.3,
        leafAspectRatio: 1.1,
        leafDensity: 0.82,
        leafType: PlantLeafType.Broad,
        floweriness: 0.06,
        topCanopyBias: 0.56,
        groundCoverFactor: 0.12,
        uprightness: 0.82,
        clumping: 0.24,
      },
    },
    {
      label: "Conifer",
      ecologyProfile: ECOLOGY_PROFILE_DRYLAND,
      ecology: {
        moisturePreference: 0.34,
        moistureTolerance: 0.2,
        persistentWetnessPreference: 0.24,
        floodTolerance: 0.12,
        standingWaterTolerance: 0.04,
        droughtTolerance: 0.64,
        optimalTemperature: 0.42,
        temperatureTolerance: 0.22,
        heatStressResistance: 0.54,
        slopeTolerance: 0.68,
        spreadAbility: 0.28,
        vigor: 0.56,
      },
      morphology: {
        maxHeight: 8.2,
        woodiness: 0.9,
        stemCount: 1,
        trunkThickness: 0.18,
        apicalDominance: 0.84,
        branchDensity: 0.52,
        branchingRate: 0.44,
        branchAngle: 0.38,
        crownWidth: 1.8,
        crownHeight: 3.4,
        verticalBias: 0.88,
        lateralSpread: 0.3,
        crownDensity: 0.68,
        crownRadius: 1.6,
        topFoliageBias: 0.82,
        basalSpread: 0.12,
        foliageDensity: 0.84,
        leafSize: 0.1,
        leafAspectRatio: 4.2,
        leafDensity: 0.86,
        leafType: PlantLeafType.Needle,
        floweriness: 0.02,
        topCanopyBias: 0.74,
        groundCoverFactor: 0.08,
        uprightness: 0.88,
        clumping: 0.18,
      },
    },
    {
      label: "Palm",
      ecologyProfile: ECOLOGY_PROFILE_MESIC,
      ecology: {
        moisturePreference: 0.58,
        moistureTolerance: 0.18,
        persistentWetnessPreference: 0.42,
        floodTolerance: 0.36,
        standingWaterTolerance: 0.12,
        droughtTolerance: 0.34,
        optimalTemperature: 0.72,
        temperatureTolerance: 0.16,
        heatStressResistance: 0.48,
        slopeTolerance: 0.34,
        spreadAbility: 0.22,
        vigor: 0.52,
      },
      morphology: {
        maxHeight: 6.5,
        woodiness: 0.74,
        stemCount: 1,
        trunkThickness: 0.16,
        apicalDominance: 0.92,
        branchDensity: 0.18,
        branchingRate: 0.1,
        branchAngle: 1.02,
        crownWidth: 2.2,
        crownHeight: 1.1,
        verticalBias: 0.96,
        lateralSpread: 0.78,
        crownDensity: 0.34,
        crownRadius: 2.1,
        topFoliageBias: 0.94,
        basalSpread: 0.1,
        foliageDensity: 0.56,
        leafSize: 0.8,
        leafAspectRatio: 4.6,
        leafDensity: 0.56,
        leafType: PlantLeafType.Frond,
        floweriness: 0.08,
        topCanopyBias: 0.92,
        groundCoverFactor: 0.08,
        uprightness: 0.92,
        clumping: 0.16,
      },
    },
    {
      label: "Reed",
      ecologyProfile: ECOLOGY_PROFILE_WETLAND,
      ecology: {
        moisturePreference: 0.78,
        moistureTolerance: 0.28,
        persistentWetnessPreference: 0.82,
        floodTolerance: 0.84,
        standingWaterTolerance: 0.44,
        droughtTolerance: 0.12,
        optimalTemperature: 0.64,
        temperatureTolerance: 0.24,
        heatStressResistance: 0.62,
        slopeTolerance: 0.38,
        spreadAbility: 0.64,
        vigor: 0.54,
      },
      morphology: {
        maxHeight: 1.45,
        woodiness: 0.1,
        stemCount: 6,
        trunkThickness: 0.03,
        apicalDominance: 0.64,
        branchDensity: 0.1,
        branchingRate: 0.06,
        branchAngle: 0.3,
        crownWidth: 0.38,
        crownHeight: 0.8,
        verticalBias: 0.94,
        lateralSpread: 0.22,
        crownDensity: 0.18,
        crownRadius: 0.32,
        topFoliageBias: 0.86,
        basalSpread: 0.48,
        foliageDensity: 0.62,
        leafSize: 0.18,
        leafAspectRatio: 4.1,
        leafDensity: 0.62,
        leafType: PlantLeafType.Reed,
        floweriness: 0.02,
        topCanopyBias: 0.82,
        groundCoverFactor: 0.66,
        uprightness: 0.92,
        clumping: 0.52,
      },
    },
  ];
}

function mutateEcology(
  source: PlantEcologyTraits,
  random: () => number,
  strength: number,
  habitat?: HabitatPressureProfile,
): PlantEcologyTraits {
  const ecology: PlantEcologyTraits = {
    moisturePreference: clamp(source.moisturePreference + signedJitter(random, strength), 0, 1),
    moistureTolerance: clamp(source.moistureTolerance + signedJitter(random, strength * 0.8), 0.08, 0.48),
    persistentWetnessPreference: clamp(
      source.persistentWetnessPreference + signedJitter(random, strength),
      0,
      1,
    ),
    floodTolerance: clamp(source.floodTolerance + signedJitter(random, strength), 0, 1),
    standingWaterTolerance: clamp(
      source.standingWaterTolerance + signedJitter(random, strength * 0.8),
      0,
      1,
    ),
    droughtTolerance: clamp(source.droughtTolerance + signedJitter(random, strength), 0, 1),
    optimalTemperature: clamp(source.optimalTemperature + signedJitter(random, strength), 0, 1),
    temperatureTolerance: clamp(
      source.temperatureTolerance + signedJitter(random, strength * 0.8),
      0.08,
      0.48,
    ),
    heatStressResistance: clamp(source.heatStressResistance + signedJitter(random, strength), 0, 1),
    slopeTolerance: clamp(source.slopeTolerance + signedJitter(random, strength * 0.75), 0.1, 1),
    spreadAbility: clamp(source.spreadAbility + signedJitter(random, strength), 0.08, 1),
    vigor: clamp(source.vigor + signedJitter(random, strength), 0.1, 1),
  };

  if (!habitat) {
    return ecology;
  }

  ecology.moisturePreference = lerp(ecology.moisturePreference, habitat.moisture, 0.18);
  ecology.persistentWetnessPreference = lerp(ecology.persistentWetnessPreference, habitat.persistentWetness, 0.16);
  ecology.floodTolerance = lerp(ecology.floodTolerance, habitat.channelInfluence, 0.2);
  ecology.standingWaterTolerance = lerp(ecology.standingWaterTolerance, habitat.standingWater, 0.18);
  ecology.droughtTolerance = lerp(ecology.droughtTolerance, habitat.dryness, 0.18);
  ecology.optimalTemperature = lerp(ecology.optimalTemperature, habitat.temperature, 0.18);
  ecology.temperatureTolerance = lerp(
    ecology.temperatureTolerance,
    0.16 + habitat.lowland * 0.08 + habitat.heatStress * 0.16,
    0.12,
  );
  ecology.heatStressResistance = lerp(ecology.heatStressResistance, habitat.heatStress, 0.16);
  ecology.slopeTolerance = lerp(ecology.slopeTolerance, habitat.slope * 0.8 + 0.2, 0.14);
  ecology.vigor = lerp(ecology.vigor, habitat.fertileMoisture * 0.6 + habitat.stability * 0.4, 0.12);
  return ecology;
}

/**
 * Base seasonal-response traits are derived from ecology and morphology so the
 * simulator starts from a continuous trait surface rather than from named
 * seasonal strategy buckets.
 */
function deriveBaseSeasonalTraits(
  ecology: PlantEcologyTraits,
  morphology: PlantMorphologyTraits,
): PlantSeasonalTraits {
  const temperatureToleranceNorm = normalizeRange(ecology.temperatureTolerance, 0.08, 0.48);
  const structuralMass = clamp(
    normalizeTrait(morphology.maxHeight, MORPHOLOGY_BOUNDS.maxHeight) * 0.34 +
      morphology.woodiness * 0.3 +
      normalizeTrait(morphology.trunkThickness, MORPHOLOGY_BOUNDS.trunkThickness) * 0.18 +
      morphology.crownDensity * 0.18,
    0,
    1,
  );
  const spreadingBias = clamp(
    morphology.groundCoverFactor * 0.38 +
      morphology.basalSpread * 0.32 +
      morphology.lateralSpread * 0.18 +
      (1 - morphology.clumping) * 0.12,
    0,
    1,
  );
  const stressSeasonality = clamp(
    ecology.droughtTolerance * 0.22 +
      (1 - ecology.moistureTolerance) * 0.24 +
      (1 - temperatureToleranceNorm) * 0.2 +
      (1 - ecology.vigor) * 0.12 +
      structuralMass * 0.1 +
      (1 - ecology.floodTolerance) * 0.12,
    0,
    1,
  );
  const leafPersistence = clamp(
    structuralMass * 0.34 +
      morphology.foliageDensity * 0.18 +
      ecology.moistureTolerance * 0.12 +
      temperatureToleranceNorm * 0.18 -
      ecology.droughtTolerance * 0.16,
    0,
    1,
  );

  return {
    dormancyTendency: clamp(stressSeasonality, 0, 1),
    dormancyTriggerDryness: clampRange(
      0.24 +
        ecology.droughtTolerance * 0.34 +
        ecology.moistureTolerance * 0.12 -
        ecology.moisturePreference * 0.1,
      SEASONAL_BOUNDS.dormancyTriggerDryness,
    ),
    dormancyTriggerColdOrLowTemperature: clampRange(
      0.18 + (1 - ecology.optimalTemperature) * 0.32 + temperatureToleranceNorm * 0.1,
      SEASONAL_BOUNDS.dormancyTriggerColdOrLowTemperature,
    ),
    resourceStorageCapacity: clamp(
      0.18 + stressSeasonality * 0.34 + structuralMass * 0.18 + (1 - ecology.spreadAbility) * 0.12,
      0,
      1,
    ),
    reactivationSpeed: clamp(
      0.18 + ecology.vigor * 0.32 + ecology.spreadAbility * 0.16 + spreadingBias * 0.14 - structuralMass * 0.12,
      0,
      1,
    ),
    growthWindowFlexibility: clamp(
      ecology.moistureTolerance * 0.34 +
        temperatureToleranceNorm * 0.38 +
        ecology.floodTolerance * 0.12 +
        ecology.droughtTolerance * 0.16,
      0,
      1,
    ),
    leafPersistence,
    leafDropBias: clamp(
      stressSeasonality * 0.44 + (1 - leafPersistence) * 0.34 + structuralMass * 0.08,
      0,
      1,
    ),
    regrowthRate: clamp(
      0.18 +
        ecology.vigor * 0.34 +
        morphology.foliageDensity * 0.16 +
        spreadingBias * 0.12 -
        structuralMass * 0.1,
      0,
      1,
    ),
    reproductionThreshold: clampRange(
      0.2 +
        structuralMass * 0.28 +
        ecology.moisturePreference * 0.08 -
        ecology.spreadAbility * 0.12 -
        spreadingBias * 0.08,
      SEASONAL_BOUNDS.reproductionThreshold,
    ),
  };
}

function mutateSeasonal(
  source: PlantSeasonalTraits,
  random: () => number,
  strength: number,
  habitat?: HabitatPressureProfile,
  ecology?: PlantEcologyTraits,
  morphology?: PlantMorphologyTraits,
): PlantSeasonalTraits {
  const seasonal: PlantSeasonalTraits = {
    dormancyTendency: clamp(source.dormancyTendency + signedJitter(random, strength), 0, 1),
    dormancyTriggerDryness: clampRange(
      source.dormancyTriggerDryness + signedJitter(random, strength * 0.7),
      SEASONAL_BOUNDS.dormancyTriggerDryness,
    ),
    dormancyTriggerColdOrLowTemperature: clampRange(
      source.dormancyTriggerColdOrLowTemperature + signedJitter(random, strength * 0.7),
      SEASONAL_BOUNDS.dormancyTriggerColdOrLowTemperature,
    ),
    resourceStorageCapacity: clamp(
      source.resourceStorageCapacity + signedJitter(random, strength),
      0,
      1,
    ),
    reactivationSpeed: clamp(source.reactivationSpeed + signedJitter(random, strength), 0, 1),
    growthWindowFlexibility: clamp(
      source.growthWindowFlexibility + signedJitter(random, strength),
      0,
      1,
    ),
    leafPersistence: clamp(source.leafPersistence + signedJitter(random, strength), 0, 1),
    leafDropBias: clamp(source.leafDropBias + signedJitter(random, strength), 0, 1),
    regrowthRate: clamp(source.regrowthRate + signedJitter(random, strength), 0, 1),
    reproductionThreshold: clampRange(
      source.reproductionThreshold + signedJitter(random, strength * 0.65),
      SEASONAL_BOUNDS.reproductionThreshold,
    ),
  };

  if (!habitat || !ecology || !morphology) {
    return seasonal;
  }

  const temperatureToleranceNorm = normalizeRange(ecology.temperatureTolerance, 0.08, 0.48);
  const structuralMass = clamp(
    normalizeTrait(morphology.maxHeight, MORPHOLOGY_BOUNDS.maxHeight) * 0.36 +
      morphology.woodiness * 0.32 +
      morphology.crownDensity * 0.18 +
      normalizeTrait(morphology.trunkThickness, MORPHOLOGY_BOUNDS.trunkThickness) * 0.14,
    0,
    1,
  );
  const spreadingBias = clamp(
    morphology.groundCoverFactor * 0.38 +
      morphology.basalSpread * 0.28 +
      morphology.lateralSpread * 0.2 +
      (1 - morphology.clumping) * 0.14,
    0,
    1,
  );
  const seasonalStress = clamp(
    habitat.dryness * 0.36 +
      (1 - habitat.temperature) * 0.24 +
      habitat.floodProne * 0.12 +
      (1 - habitat.fertileMoisture) * 0.16 +
      (1 - habitat.stability) * 0.12,
    0,
    1,
  );

  seasonal.dormancyTendency = lerp(
    seasonal.dormancyTendency,
    seasonalStress * 0.62 + structuralMass * 0.12 + (1 - ecology.vigor) * 0.14,
    0.18,
  );
  seasonal.dormancyTriggerDryness = lerp(
    seasonal.dormancyTriggerDryness,
    clamp(
      0.18 +
        ecology.droughtTolerance * 0.38 +
        ecology.moistureTolerance * 0.12 +
        habitat.fertileMoisture * 0.08 -
        habitat.dryness * 0.08,
      0,
      1,
    ),
    0.14,
  );
  seasonal.dormancyTriggerColdOrLowTemperature = lerp(
    seasonal.dormancyTriggerColdOrLowTemperature,
    clamp(0.16 + (1 - habitat.temperature) * 0.4 + temperatureToleranceNorm * 0.12, 0, 1),
    0.16,
  );
  seasonal.resourceStorageCapacity = lerp(
    seasonal.resourceStorageCapacity,
    clamp(
      0.16 + seasonalStress * 0.34 + structuralMass * 0.18 + (1 - ecology.spreadAbility) * 0.12,
      0,
      1,
    ),
    0.16,
  );
  seasonal.reactivationSpeed = lerp(
    seasonal.reactivationSpeed,
    clamp(
      0.18 +
        ecology.vigor * 0.34 +
        habitat.fertileMoisture * 0.18 +
        spreadingBias * 0.14 -
        structuralMass * 0.12,
      0,
      1,
    ),
    0.14,
  );
  seasonal.growthWindowFlexibility = lerp(
    seasonal.growthWindowFlexibility,
    clamp(
      ecology.moistureTolerance * 0.34 +
        temperatureToleranceNorm * 0.38 +
        ecology.floodTolerance * 0.1 +
        ecology.droughtTolerance * 0.18,
      0,
      1,
    ),
    0.16,
  );
  seasonal.leafPersistence = lerp(
    seasonal.leafPersistence,
    clamp(
      structuralMass * 0.34 +
        habitat.stability * 0.16 +
        habitat.fertileMoisture * 0.16 +
        ecology.moistureTolerance * 0.12 -
        habitat.dryness * 0.16,
      0,
      1,
    ),
    0.14,
  );
  seasonal.leafDropBias = lerp(
    seasonal.leafDropBias,
    clamp(
      seasonal.dormancyTendency * 0.46 +
        habitat.dryness * 0.16 +
        (1 - habitat.temperature) * 0.14 +
        (1 - seasonal.leafPersistence) * 0.22,
      0,
      1,
    ),
    0.16,
  );
  seasonal.regrowthRate = lerp(
    seasonal.regrowthRate,
    clamp(
      0.16 +
        ecology.vigor * 0.36 +
        habitat.fertileMoisture * 0.22 +
        spreadingBias * 0.12 -
        structuralMass * 0.1,
      0,
      1,
    ),
    0.16,
  );
  seasonal.reproductionThreshold = lerp(
    seasonal.reproductionThreshold,
    clamp(
      0.18 +
        structuralMass * 0.3 +
        seasonal.resourceStorageCapacity * 0.12 -
        ecology.spreadAbility * 0.12 -
        spreadingBias * 0.06,
      0.05,
      0.95,
    ),
    0.14,
  );

  seasonal.dormancyTriggerDryness = clampRange(
    seasonal.dormancyTriggerDryness,
    SEASONAL_BOUNDS.dormancyTriggerDryness,
  );
  seasonal.dormancyTriggerColdOrLowTemperature = clampRange(
    seasonal.dormancyTriggerColdOrLowTemperature,
    SEASONAL_BOUNDS.dormancyTriggerColdOrLowTemperature,
  );
  seasonal.reproductionThreshold = clampRange(
    seasonal.reproductionThreshold,
    SEASONAL_BOUNDS.reproductionThreshold,
  );

  return seasonal;
}

function mutateMorphology(
  source: PlantMorphologyTraits,
  random: () => number,
  strength: number,
  habitat?: HabitatPressureProfile,
  ecology?: PlantEcologyTraits,
): PlantMorphologyTraits {
  const morphology: PlantMorphologyTraits = {
    maxHeight: clampRange(source.maxHeight * (1 + signedJitter(random, strength)), MORPHOLOGY_BOUNDS.maxHeight),
    woodiness: clamp(source.woodiness + signedJitter(random, strength), 0, 1),
    stemCount: clampRange(source.stemCount + signedJitter(random, strength * 8), MORPHOLOGY_BOUNDS.stemCount),
    trunkThickness: clampRange(
      source.trunkThickness * (1 + signedJitter(random, strength)),
      MORPHOLOGY_BOUNDS.trunkThickness,
    ),
    apicalDominance: clamp(source.apicalDominance + signedJitter(random, strength), 0, 1),
    branchDensity: clamp(source.branchDensity + signedJitter(random, strength), 0, 1),
    branchingRate: clamp(source.branchingRate + signedJitter(random, strength), 0, 1),
    branchAngle: clampRange(
      source.branchAngle * (1 + signedJitter(random, strength * 0.8)),
      MORPHOLOGY_BOUNDS.branchAngle,
    ),
    crownWidth: clampRange(
      source.crownWidth * (1 + signedJitter(random, strength)),
      MORPHOLOGY_BOUNDS.crownWidth,
    ),
    crownHeight: clampRange(
      source.crownHeight * (1 + signedJitter(random, strength)),
      MORPHOLOGY_BOUNDS.crownHeight,
    ),
    verticalBias: clamp(source.verticalBias + signedJitter(random, strength), 0, 1),
    lateralSpread: clamp(source.lateralSpread + signedJitter(random, strength), 0, 1),
    crownDensity: clamp(source.crownDensity + signedJitter(random, strength), 0, 1),
    crownRadius: clampRange(
      source.crownRadius * (1 + signedJitter(random, strength)),
      MORPHOLOGY_BOUNDS.crownRadius,
    ),
    topFoliageBias: clamp(source.topFoliageBias + signedJitter(random, strength), 0, 1),
    basalSpread: clamp(source.basalSpread + signedJitter(random, strength), 0, 1),
    foliageDensity: clamp(source.foliageDensity + signedJitter(random, strength), 0, 1),
    leafSize: clampRange(
      source.leafSize * (1 + signedJitter(random, strength)),
      MORPHOLOGY_BOUNDS.leafSize,
    ),
    leafAspectRatio: clampRange(
      source.leafAspectRatio * (1 + signedJitter(random, strength * 0.75)),
      MORPHOLOGY_BOUNDS.leafAspectRatio,
    ),
    leafDensity: clamp(source.leafDensity + signedJitter(random, strength), 0, 1),
    leafType: mutateLeafType(source.leafType, random, strength),
    floweriness: clamp(source.floweriness + signedJitter(random, strength), 0, 1),
    topCanopyBias: clamp(source.topCanopyBias + signedJitter(random, strength), 0, 1),
    groundCoverFactor: clamp(source.groundCoverFactor + signedJitter(random, strength), 0, 1),
    uprightness: clamp(source.uprightness + signedJitter(random, strength), 0, 1),
    clumping: clamp(source.clumping + signedJitter(random, strength), 0, 1),
  };

  if (!habitat) {
    return morphology;
  }

  const dryPressure = habitat.dryness;
  const wetPressure = habitat.channelInfluence;
  const stableFertilePressure = habitat.fertileMoisture * habitat.stability;
  const slopePressure = habitat.slope;

  morphology.maxHeight = lerp(
    morphology.maxHeight,
    0.55 + stableFertilePressure * 10.8 - dryPressure * 3.2 - wetPressure * 1.2,
    0.14,
  );
  morphology.woodiness = lerp(
    morphology.woodiness,
    stableFertilePressure * 0.72 + slopePressure * 0.18 + dryPressure * 0.1,
    0.16,
  );
  morphology.crownWidth = lerp(
    morphology.crownWidth,
    0.4 + stableFertilePressure * 3.1 + wetPressure * 0.8 - slopePressure * 1.1 - dryPressure * 0.9,
    0.14,
  );
  morphology.crownHeight = lerp(
    morphology.crownHeight,
    0.35 + stableFertilePressure * 2.5 + slopePressure * 0.8 + wetPressure * 0.3,
    0.12,
  );
  morphology.groundCoverFactor = lerp(
    morphology.groundCoverFactor,
    dryPressure * 0.56 + wetPressure * 0.32 + (1 - stableFertilePressure) * 0.12,
    0.18,
  );
  morphology.uprightness = lerp(
    morphology.uprightness,
    wetPressure * 0.34 + slopePressure * 0.28 + stableFertilePressure * 0.22 + 0.16,
    0.12,
  );
  morphology.topCanopyBias = lerp(
    morphology.topCanopyBias,
    stableFertilePressure * 0.62 + wetPressure * 0.18 + slopePressure * 0.12,
    0.12,
  );
  morphology.branchDensity = lerp(
    morphology.branchDensity,
    stableFertilePressure * 0.56 + (ecology?.floodTolerance ?? 0) * 0.12 + dryPressure * 0.08,
    0.12,
  );
  morphology.leafDensity = lerp(
    morphology.leafDensity,
    stableFertilePressure * 0.44 + wetPressure * 0.24 + (ecology?.droughtTolerance ?? 0) * 0.08,
    0.12,
  );
  morphology.leafSize = lerp(
    morphology.leafSize,
    0.12 + stableFertilePressure * 0.58 + wetPressure * 0.22 - dryPressure * 0.18,
    0.12,
  );
  morphology.trunkThickness = lerp(
    morphology.trunkThickness,
    0.04 + stableFertilePressure * 0.34 + slopePressure * 0.08,
    0.12,
  );
  morphology.apicalDominance = lerp(
    morphology.apicalDominance,
    stableFertilePressure * 0.46 + slopePressure * 0.24 + wetPressure * 0.16,
    0.12,
  );
  morphology.branchingRate = lerp(
    morphology.branchingRate,
    stableFertilePressure * 0.42 + wetPressure * 0.16 + (1 - dryPressure) * 0.18,
    0.12,
  );
  morphology.branchAngle = lerp(
    morphology.branchAngle,
    0.24 + morphology.lateralSpread * 0.5 + wetPressure * 0.18 + (1 - slopePressure) * 0.12,
    0.12,
  );
  morphology.verticalBias = lerp(
    morphology.verticalBias,
    wetPressure * 0.28 + slopePressure * 0.26 + stableFertilePressure * 0.16 + 0.22,
    0.12,
  );
  morphology.lateralSpread = lerp(
    morphology.lateralSpread,
    stableFertilePressure * 0.34 + dryPressure * 0.26 + wetPressure * 0.14,
    0.12,
  );
  morphology.crownDensity = lerp(
    morphology.crownDensity,
    stableFertilePressure * 0.5 + wetPressure * 0.18 + (1 - dryPressure) * 0.12,
    0.12,
  );
  morphology.crownRadius = lerp(
    morphology.crownRadius,
    0.24 + stableFertilePressure * 2.8 + dryPressure * 0.6 - slopePressure * 0.7,
    0.12,
  );
  morphology.topFoliageBias = lerp(
    morphology.topFoliageBias,
    stableFertilePressure * 0.34 + wetPressure * 0.32 + morphology.apicalDominance * 0.14,
    0.12,
  );
  morphology.basalSpread = lerp(
    morphology.basalSpread,
    dryPressure * 0.42 + wetPressure * 0.22 + (1 - morphology.apicalDominance) * 0.16,
    0.12,
  );
  morphology.foliageDensity = lerp(
    morphology.foliageDensity,
    stableFertilePressure * 0.46 + wetPressure * 0.18 + (1 - dryPressure) * 0.14,
    0.12,
  );
  morphology.leafAspectRatio = lerp(
    morphology.leafAspectRatio,
    1.1 + slopePressure * 1.2 + wetPressure * 1.3 + dryPressure * 0.8,
    0.12,
  );
  morphology.clumping = lerp(
    morphology.clumping,
    wetPressure * 0.34 + stableFertilePressure * 0.18 + (1 - dryPressure) * 0.12,
    0.12,
  );

  if (wetPressure > 0.62 && (ecology?.floodTolerance ?? 0) > 0.56) {
    morphology.leafType = PlantLeafType.Reed;
    morphology.woodiness = lerp(morphology.woodiness, 0.16, 0.28);
    morphology.groundCoverFactor = lerp(morphology.groundCoverFactor, 0.72, 0.24);
    morphology.verticalBias = lerp(morphology.verticalBias, 0.86, 0.2);
    morphology.lateralSpread = lerp(morphology.lateralSpread, 0.28, 0.2);
  } else if (dryPressure > 0.64 && (ecology?.droughtTolerance ?? 0) > 0.54) {
    morphology.leafType = dryPressure > 0.78 ? PlantLeafType.Blade : PlantLeafType.Needle;
    morphology.groundCoverFactor = lerp(morphology.groundCoverFactor, 0.62, 0.14);
    morphology.maxHeight = lerp(morphology.maxHeight, 0.8 + stableFertilePressure * 3.2, 0.1);
  } else if (stableFertilePressure > 0.58 && (ecology?.floodTolerance ?? 0) < 0.42) {
    morphology.leafType = PlantLeafType.Broad;
    morphology.crownDensity = lerp(morphology.crownDensity, 0.72, 0.16);
  } else if (slopePressure > 0.58 && morphology.woodiness > 0.52) {
    morphology.leafType = PlantLeafType.Needle;
    morphology.verticalBias = lerp(morphology.verticalBias, 0.82, 0.18);
    morphology.crownRadius = lerp(morphology.crownRadius, 1.2, 0.14);
  }

  morphology.maxHeight = clampRange(morphology.maxHeight, MORPHOLOGY_BOUNDS.maxHeight);
  morphology.woodiness = clamp(morphology.woodiness, 0, 1);
  morphology.stemCount = clampRange(morphology.stemCount, MORPHOLOGY_BOUNDS.stemCount);
  morphology.trunkThickness = clampRange(morphology.trunkThickness, MORPHOLOGY_BOUNDS.trunkThickness);
  morphology.apicalDominance = clamp(morphology.apicalDominance, 0, 1);
  morphology.branchDensity = clamp(morphology.branchDensity, 0, 1);
  morphology.branchingRate = clamp(morphology.branchingRate, 0, 1);
  morphology.branchAngle = clampRange(morphology.branchAngle, MORPHOLOGY_BOUNDS.branchAngle);
  morphology.crownWidth = clampRange(morphology.crownWidth, MORPHOLOGY_BOUNDS.crownWidth);
  morphology.crownHeight = clampRange(morphology.crownHeight, MORPHOLOGY_BOUNDS.crownHeight);
  morphology.verticalBias = clamp(morphology.verticalBias, 0, 1);
  morphology.lateralSpread = clamp(morphology.lateralSpread, 0, 1);
  morphology.crownDensity = clamp(morphology.crownDensity, 0, 1);
  morphology.crownRadius = clampRange(morphology.crownRadius, MORPHOLOGY_BOUNDS.crownRadius);
  morphology.topFoliageBias = clamp(morphology.topFoliageBias, 0, 1);
  morphology.basalSpread = clamp(morphology.basalSpread, 0, 1);
  morphology.foliageDensity = clamp(morphology.foliageDensity, 0, 1);
  morphology.leafSize = clampRange(morphology.leafSize, MORPHOLOGY_BOUNDS.leafSize);
  morphology.leafAspectRatio = clampRange(morphology.leafAspectRatio, MORPHOLOGY_BOUNDS.leafAspectRatio);
  morphology.leafDensity = clamp(morphology.leafDensity, 0, 1);
  morphology.topCanopyBias = clamp(morphology.topCanopyBias, 0, 1);
  morphology.groundCoverFactor = clamp(morphology.groundCoverFactor, 0, 1);
  morphology.uprightness = clamp(morphology.uprightness, 0, 1);
  morphology.clumping = clamp(morphology.clumping, 0, 1);
  return morphology;
}

function mutateLeafType(
  current: PlantLeafType,
  random: () => number,
  strength: number,
): PlantLeafType {
  if (random() > strength * 0.45) {
    return current;
  }

  const candidates = [
    PlantLeafType.Blade,
    PlantLeafType.Broad,
    PlantLeafType.Needle,
    PlantLeafType.Frond,
    PlantLeafType.Reed,
  ];
  return candidates[Math.floor(random() * candidates.length)] ?? current;
}

function classifyEcologyProfile(ecology: PlantEcologyTraits): number {
  if (ecology.moisturePreference > 0.68 || ecology.floodTolerance > 0.64) {
    return ECOLOGY_PROFILE_WETLAND;
  }

  if (ecology.moisturePreference < 0.34 && ecology.droughtTolerance > 0.54) {
    return ECOLOGY_PROFILE_DRYLAND;
  }

  return ECOLOGY_PROFILE_MESIC;
}

function clampRange(value: number, range: readonly [number, number]): number {
  return clamp(value, range[0], range[1]);
}

function normalizeTrait(value: number, range: readonly [number, number]): number {
  return clamp((value - range[0]) / Math.max(range[1] - range[0], 1e-6), 0, 1);
}

function normalizeRange(value: number, min: number, max: number): number {
  return clamp((value - min) / Math.max(max - min, 1e-6), 0, 1);
}

function signedJitter(random: () => number, amplitude: number): number {
  return (random() * 2 - 1) * amplitude;
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const wrappedHue = ((h % 1) + 1) % 1;
  const sector = Math.floor(wrappedHue * 6);
  const fraction = wrappedHue * 6 - sector;
  const p = v * (1 - s);
  const q = v * (1 - fraction * s);
  const t = v * (1 - (1 - fraction) * s);

  switch (sector % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function leafTypeName(leafType: PlantLeafType): string {
  switch (leafType) {
    case PlantLeafType.Blade:
      return "blade";
    case PlantLeafType.Broad:
      return "broad";
    case PlantLeafType.Needle:
      return "needle";
    case PlantLeafType.Frond:
      return "frond";
    case PlantLeafType.Reed:
      return "reed";
  }
}
