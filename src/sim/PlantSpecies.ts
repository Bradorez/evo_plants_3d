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
  slopeTolerance: number;
  spreadAbility: number;
  vigor: number;
}

export interface PlantMorphologyTraits {
  maxHeight: number;
  woodiness: number;
  stemCount: number;
  trunkThickness: number;
  branchDensity: number;
  crownWidth: number;
  crownHeight: number;
  leafSize: number;
  leafDensity: number;
  leafType: PlantLeafType;
  floweriness: number;
  topCanopyBias: number;
  groundCoverFactor: number;
  uprightness: number;
}

export interface PlantSpeciesDefinition {
  id: number;
  parentId: number | null;
  generation: number;
  name: string;
  ecologyProfile: number;
  ecology: PlantEcologyTraits;
  morphology: PlantMorphologyTraits;
  phenotype: PlantPhenotypeClass;
  hueSeed: number;
}

export interface HabitatPressureProfile {
  moisture: number;
  persistentWetness: number;
  floodProne: number;
  standingWater: number;
  slope: number;
  stability: number;
  dryness: number;
  fertileMoisture: number;
  channelInfluence: number;
  lowland: number;
}

export interface PlantRenderParameters {
  heightScale: number;
  trunkHeightFraction: number;
  crownWidthScale: number;
  crownHeightScale: number;
  foliageAmount: number;
  stemCopies: number;
  flowerAmount: number;
  groundPatchScale: number;
}

interface SpeciesTemplate {
  label: string;
  ecologyProfile: number;
  phenotype: PlantPhenotypeClass;
  ecology: PlantEcologyTraits;
  morphology: PlantMorphologyTraits;
}

export const MORPHOLOGY_BOUNDS = {
  maxHeight: [0.2, 15] as const,
  woodiness: [0, 1] as const,
  stemCount: [1, 8] as const,
  trunkThickness: [0.02, 1] as const,
  branchDensity: [0, 1] as const,
  crownWidth: [0.1, 6] as const,
  crownHeight: [0.08, 6] as const,
  leafSize: [0.03, 1.4] as const,
  leafDensity: [0, 1] as const,
  floweriness: [0, 1] as const,
  topCanopyBias: [0, 1] as const,
  groundCoverFactor: [0, 1] as const,
  uprightness: [0, 1] as const,
};

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
    const phenotype = classifyPhenotype(morphology);

    return {
      id: index,
      parentId: null,
      generation: 0,
      name: `${template.label} ${index + 1}`,
      ecologyProfile: template.ecologyProfile,
      ecology,
      morphology,
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
  const phenotype = classifyPhenotype(morphology);

  return {
    id: newId,
    parentId: parent.id,
    generation: parent.generation + 1,
    name: `${parent.name.split(" ")[0]} ${newId + 1}`,
    ecologyProfile: classifyEcologyProfile(ecology),
    ecology,
    morphology,
    phenotype,
    hueSeed: mixSeed(seed + newId * 1543 + parent.hueSeed),
  };
}

export function buildHabitatPressureProfile(
  moisture: number,
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

  return {
    moisture,
    persistentWetness,
    floodProne,
    standingWater,
    slope,
    stability,
    dryness,
    fertileMoisture,
    channelInfluence,
    lowland,
  };
}

export function evaluateMorphologyHabitatFit(
  species: PlantSpeciesDefinition,
  habitat: HabitatPressureProfile,
): number {
  const morphology = species.morphology;
  const phenotype = species.phenotype;

  const dryLowFormFit =
    habitat.dryness *
    clamp(
      morphology.groundCoverFactor * 0.42 +
        (1 - morphology.maxHeight / MORPHOLOGY_BOUNDS.maxHeight[1]) * 0.28 +
        (1 - morphology.crownWidth / MORPHOLOGY_BOUNDS.crownWidth[1]) * 0.14 +
        (1 - morphology.woodiness) * 0.16,
      0,
      1,
    );
  const wetlandFit =
    habitat.channelInfluence *
    clamp(
      species.ecology.floodTolerance * 0.28 +
        morphology.uprightness * 0.18 +
        morphology.topCanopyBias * 0.12 +
        morphology.leafDensity * 0.12 +
        (phenotype === PlantPhenotypeClass.Reed ? 0.3 : 0),
      0,
      1,
    );
  const fertileTallFit =
    habitat.fertileMoisture *
    habitat.stability *
    clamp(
      (morphology.maxHeight / MORPHOLOGY_BOUNDS.maxHeight[1]) * 0.34 +
        morphology.woodiness * 0.24 +
        morphology.branchDensity * 0.14 +
        morphology.crownWidth / MORPHOLOGY_BOUNDS.crownWidth[1] * 0.14 +
        (phenotype === PlantPhenotypeClass.BroadleafTree ? 0.14 : 0),
      0,
      1,
    );
  const slopeFit =
    habitat.slope *
    clamp(
      (phenotype === PlantPhenotypeClass.Conifer ? 0.24 : 0) +
        (phenotype === PlantPhenotypeClass.Shrub ? 0.14 : 0) +
        morphology.uprightness * 0.16 +
        (1 - morphology.crownWidth / MORPHOLOGY_BOUNDS.crownWidth[1]) * 0.2 +
        (1 - morphology.groundCoverFactor) * 0.1 +
        species.ecology.slopeTolerance * 0.16,
      0,
      1,
    );

  const droughtCost =
    habitat.dryness *
    clamp(
      morphology.maxHeight / MORPHOLOGY_BOUNDS.maxHeight[1] * 0.26 +
        morphology.crownWidth / MORPHOLOGY_BOUNDS.crownWidth[1] * 0.18 +
        morphology.leafSize / MORPHOLOGY_BOUNDS.leafSize[1] * 0.12,
      0,
      0.4,
    );
  const floodCost =
    habitat.channelInfluence *
    clamp(
      morphology.woodiness * 0.08 +
        (phenotype === PlantPhenotypeClass.BroadleafTree ? 0.1 : 0) +
        (phenotype === PlantPhenotypeClass.Conifer ? 0.12 : 0),
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
 * The phenotype classifier is intentionally deterministic and coarse. Similar
 * morphology combinations map to the same visible growth form so species stay
 * visually understandable rather than collapsing into noisy one-off meshes.
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
  const trunkHeightFraction = clamp(
    0.18 + morphology.woodiness * 0.42 + morphology.topCanopyBias * 0.18,
    0.05,
    0.86,
  );

  return {
    heightScale: morphology.maxHeight,
    trunkHeightFraction,
    crownWidthScale: morphology.crownWidth,
    crownHeightScale: morphology.crownHeight,
    foliageAmount: clamp(morphology.leafDensity * 0.7 + morphology.branchDensity * 0.3, 0.08, 1),
    stemCopies: Math.max(1, Math.round(morphology.stemCount)),
    flowerAmount: morphology.floweriness,
    groundPatchScale: clamp(morphology.groundCoverFactor * 1.1, 0.18, 1),
  };
}

export function getSpeciesDisplayColor(species: PlantSpeciesDefinition): {
  foliage: [number, number, number];
  wood: [number, number, number];
  flower: [number, number, number];
} {
  const hue = ((species.hueSeed % 1000) / 1000) * 0.28;
  const saturation = 0.42 + ((species.hueSeed >> 10) % 100) / 250;
  const value = 0.34 + ((species.hueSeed >> 18) % 100) / 220;
  const foliage = hsvToRgb(hue + phenotypeHueOffset(species.phenotype), saturation, value);
  const wood: [number, number, number] = [
    lerp(0.27, 0.44, species.morphology.woodiness * 0.65),
    lerp(0.18, 0.28, species.morphology.woodiness * 0.4),
    lerp(0.09, 0.16, species.morphology.woodiness * 0.3),
  ];
  const flowerHue = 0.82 + ((species.hueSeed >> 6) % 100) / 700;
  const flower = hsvToRgb(flowerHue % 1, 0.45, 0.92);

  return { foliage, wood, flower };
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
      phenotype: PlantPhenotypeClass.Grass,
      ecology: {
        moisturePreference: 0.26,
        moistureTolerance: 0.34,
        persistentWetnessPreference: 0.2,
        floodTolerance: 0.22,
        standingWaterTolerance: 0.06,
        droughtTolerance: 0.78,
        slopeTolerance: 0.78,
        spreadAbility: 0.72,
        vigor: 0.68,
      },
      morphology: {
        maxHeight: 0.55,
        woodiness: 0.06,
        stemCount: 5,
        trunkThickness: 0.03,
        branchDensity: 0.12,
        crownWidth: 0.48,
        crownHeight: 0.32,
        leafSize: 0.12,
        leafDensity: 0.72,
        leafType: PlantLeafType.Blade,
        floweriness: 0.08,
        topCanopyBias: 0.18,
        groundCoverFactor: 0.84,
        uprightness: 0.74,
      },
    },
    {
      label: "Herb",
      ecologyProfile: ECOLOGY_PROFILE_MESIC,
      phenotype: PlantPhenotypeClass.FloweringHerb,
      ecology: {
        moisturePreference: 0.48,
        moistureTolerance: 0.28,
        persistentWetnessPreference: 0.38,
        floodTolerance: 0.32,
        standingWaterTolerance: 0.08,
        droughtTolerance: 0.36,
        slopeTolerance: 0.54,
        spreadAbility: 0.56,
        vigor: 0.58,
      },
      morphology: {
        maxHeight: 0.9,
        woodiness: 0.12,
        stemCount: 3,
        trunkThickness: 0.04,
        branchDensity: 0.24,
        crownWidth: 0.42,
        crownHeight: 0.5,
        leafSize: 0.22,
        leafDensity: 0.5,
        leafType: PlantLeafType.Broad,
        floweriness: 0.7,
        topCanopyBias: 0.42,
        groundCoverFactor: 0.44,
        uprightness: 0.62,
      },
    },
    {
      label: "Shrub",
      ecologyProfile: ECOLOGY_PROFILE_MESIC,
      phenotype: PlantPhenotypeClass.Shrub,
      ecology: {
        moisturePreference: 0.42,
        moistureTolerance: 0.24,
        persistentWetnessPreference: 0.34,
        floodTolerance: 0.24,
        standingWaterTolerance: 0.06,
        droughtTolerance: 0.54,
        slopeTolerance: 0.56,
        spreadAbility: 0.42,
        vigor: 0.64,
      },
      morphology: {
        maxHeight: 1.9,
        woodiness: 0.58,
        stemCount: 4,
        trunkThickness: 0.08,
        branchDensity: 0.58,
        crownWidth: 1.2,
        crownHeight: 0.92,
        leafSize: 0.2,
        leafDensity: 0.72,
        leafType: PlantLeafType.Broad,
        floweriness: 0.14,
        topCanopyBias: 0.46,
        groundCoverFactor: 0.34,
        uprightness: 0.52,
      },
    },
    {
      label: "Broadleaf",
      ecologyProfile: ECOLOGY_PROFILE_MESIC,
      phenotype: PlantPhenotypeClass.BroadleafTree,
      ecology: {
        moisturePreference: 0.46,
        moistureTolerance: 0.22,
        persistentWetnessPreference: 0.36,
        floodTolerance: 0.2,
        standingWaterTolerance: 0.05,
        droughtTolerance: 0.42,
        slopeTolerance: 0.5,
        spreadAbility: 0.3,
        vigor: 0.62,
      },
      morphology: {
        maxHeight: 7.4,
        woodiness: 0.86,
        stemCount: 1,
        trunkThickness: 0.22,
        branchDensity: 0.7,
        crownWidth: 2.7,
        crownHeight: 2.3,
        leafSize: 0.3,
        leafDensity: 0.82,
        leafType: PlantLeafType.Broad,
        floweriness: 0.06,
        topCanopyBias: 0.56,
        groundCoverFactor: 0.12,
        uprightness: 0.82,
      },
    },
    {
      label: "Conifer",
      ecologyProfile: ECOLOGY_PROFILE_DRYLAND,
      phenotype: PlantPhenotypeClass.Conifer,
      ecology: {
        moisturePreference: 0.34,
        moistureTolerance: 0.2,
        persistentWetnessPreference: 0.24,
        floodTolerance: 0.12,
        standingWaterTolerance: 0.04,
        droughtTolerance: 0.64,
        slopeTolerance: 0.68,
        spreadAbility: 0.28,
        vigor: 0.56,
      },
      morphology: {
        maxHeight: 8.2,
        woodiness: 0.9,
        stemCount: 1,
        trunkThickness: 0.18,
        branchDensity: 0.52,
        crownWidth: 1.8,
        crownHeight: 3.4,
        leafSize: 0.1,
        leafDensity: 0.86,
        leafType: PlantLeafType.Needle,
        floweriness: 0.02,
        topCanopyBias: 0.74,
        groundCoverFactor: 0.08,
        uprightness: 0.88,
      },
    },
    {
      label: "Palm",
      ecologyProfile: ECOLOGY_PROFILE_MESIC,
      phenotype: PlantPhenotypeClass.Palm,
      ecology: {
        moisturePreference: 0.58,
        moistureTolerance: 0.18,
        persistentWetnessPreference: 0.42,
        floodTolerance: 0.36,
        standingWaterTolerance: 0.12,
        droughtTolerance: 0.34,
        slopeTolerance: 0.34,
        spreadAbility: 0.22,
        vigor: 0.52,
      },
      morphology: {
        maxHeight: 6.5,
        woodiness: 0.74,
        stemCount: 1,
        trunkThickness: 0.16,
        branchDensity: 0.18,
        crownWidth: 2.2,
        crownHeight: 1.1,
        leafSize: 0.8,
        leafDensity: 0.56,
        leafType: PlantLeafType.Frond,
        floweriness: 0.08,
        topCanopyBias: 0.92,
        groundCoverFactor: 0.08,
        uprightness: 0.92,
      },
    },
    {
      label: "Reed",
      ecologyProfile: ECOLOGY_PROFILE_WETLAND,
      phenotype: PlantPhenotypeClass.Reed,
      ecology: {
        moisturePreference: 0.78,
        moistureTolerance: 0.28,
        persistentWetnessPreference: 0.82,
        floodTolerance: 0.84,
        standingWaterTolerance: 0.44,
        droughtTolerance: 0.12,
        slopeTolerance: 0.38,
        spreadAbility: 0.64,
        vigor: 0.54,
      },
      morphology: {
        maxHeight: 1.45,
        woodiness: 0.1,
        stemCount: 6,
        trunkThickness: 0.03,
        branchDensity: 0.1,
        crownWidth: 0.38,
        crownHeight: 0.8,
        leafSize: 0.18,
        leafDensity: 0.62,
        leafType: PlantLeafType.Reed,
        floweriness: 0.02,
        topCanopyBias: 0.82,
        groundCoverFactor: 0.66,
        uprightness: 0.92,
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
  ecology.slopeTolerance = lerp(ecology.slopeTolerance, habitat.slope * 0.8 + 0.2, 0.14);
  ecology.vigor = lerp(ecology.vigor, habitat.fertileMoisture * 0.6 + habitat.stability * 0.4, 0.12);
  return ecology;
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
    branchDensity: clamp(source.branchDensity + signedJitter(random, strength), 0, 1),
    crownWidth: clampRange(
      source.crownWidth * (1 + signedJitter(random, strength)),
      MORPHOLOGY_BOUNDS.crownWidth,
    ),
    crownHeight: clampRange(
      source.crownHeight * (1 + signedJitter(random, strength)),
      MORPHOLOGY_BOUNDS.crownHeight,
    ),
    leafSize: clampRange(
      source.leafSize * (1 + signedJitter(random, strength)),
      MORPHOLOGY_BOUNDS.leafSize,
    ),
    leafDensity: clamp(source.leafDensity + signedJitter(random, strength), 0, 1),
    leafType: mutateLeafType(source.leafType, random, strength),
    floweriness: clamp(source.floweriness + signedJitter(random, strength), 0, 1),
    topCanopyBias: clamp(source.topCanopyBias + signedJitter(random, strength), 0, 1),
    groundCoverFactor: clamp(source.groundCoverFactor + signedJitter(random, strength), 0, 1),
    uprightness: clamp(source.uprightness + signedJitter(random, strength), 0, 1),
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

  if (wetPressure > 0.62 && (ecology?.floodTolerance ?? 0) > 0.56) {
    morphology.leafType = PlantLeafType.Reed;
    morphology.woodiness = lerp(morphology.woodiness, 0.16, 0.28);
    morphology.groundCoverFactor = lerp(morphology.groundCoverFactor, 0.72, 0.24);
  } else if (dryPressure > 0.64 && (ecology?.droughtTolerance ?? 0) > 0.54) {
    morphology.leafType = dryPressure > 0.78 ? PlantLeafType.Blade : PlantLeafType.Needle;
  } else if (stableFertilePressure > 0.58 && (ecology?.floodTolerance ?? 0) < 0.42) {
    morphology.leafType = PlantLeafType.Broad;
  } else if (slopePressure > 0.58 && morphology.woodiness > 0.52) {
    morphology.leafType = PlantLeafType.Needle;
  }

  morphology.maxHeight = clampRange(morphology.maxHeight, MORPHOLOGY_BOUNDS.maxHeight);
  morphology.woodiness = clamp(morphology.woodiness, 0, 1);
  morphology.stemCount = clampRange(morphology.stemCount, MORPHOLOGY_BOUNDS.stemCount);
  morphology.trunkThickness = clampRange(morphology.trunkThickness, MORPHOLOGY_BOUNDS.trunkThickness);
  morphology.branchDensity = clamp(morphology.branchDensity, 0, 1);
  morphology.crownWidth = clampRange(morphology.crownWidth, MORPHOLOGY_BOUNDS.crownWidth);
  morphology.crownHeight = clampRange(morphology.crownHeight, MORPHOLOGY_BOUNDS.crownHeight);
  morphology.leafSize = clampRange(morphology.leafSize, MORPHOLOGY_BOUNDS.leafSize);
  morphology.leafDensity = clamp(morphology.leafDensity, 0, 1);
  morphology.topCanopyBias = clamp(morphology.topCanopyBias, 0, 1);
  morphology.groundCoverFactor = clamp(morphology.groundCoverFactor, 0, 1);
  morphology.uprightness = clamp(morphology.uprightness, 0, 1);
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

function phenotypeHueOffset(phenotype: PlantPhenotypeClass): number {
  switch (phenotype) {
    case PlantPhenotypeClass.Grass:
      return 0.04;
    case PlantPhenotypeClass.FloweringHerb:
      return 0.09;
    case PlantPhenotypeClass.Shrub:
      return 0.07;
    case PlantPhenotypeClass.BroadleafTree:
      return 0.1;
    case PlantPhenotypeClass.Conifer:
      return 0.16;
    case PlantPhenotypeClass.Palm:
      return 0.12;
    case PlantPhenotypeClass.Reed:
      return 0.02;
  }
}

function clampRange(value: number, range: readonly [number, number]): number {
  return clamp(value, range[0], range[1]);
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
