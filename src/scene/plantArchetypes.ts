import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import {
  derivePlantRenderParameters,
  getSpeciesDisplayColor,
  PlantLeafType,
  type PlantRenderParameters,
  type PlantSpeciesDefinition,
} from "../sim/PlantSpecies";
import { clamp } from "../utils/math";

interface StemAnchor {
  top: Vector3;
  height: number;
  influence: number;
}

/**
 * Each plant prototype is assembled from continuous morphological traits rather
 * than selected from a phenotype-specific mesh preset. The same procedural
 * builder can therefore produce grass-like, tree-like, reed-like, or
 * intermediate forms as traits drift through evolution.
 */
export function createPlantSpeciesPrototype(
  scene: Scene,
  species: PlantSpeciesDefinition,
): Mesh {
  const material = new StandardMaterial(`plant-material-${species.id}`, scene);
  material.diffuseColor = Color3.White();
  material.specularColor = new Color3(0.02, 0.02, 0.02);
  material.emissiveColor = new Color3(0.03, 0.04, 0.03);
  material.backFaceCulling = false;

  const palette = getSpeciesDisplayColor(species);
  const render = derivePlantRenderParameters(species);
  const parts: Mesh[] = [];

  buildGroundPatch(parts, scene, species, render, palette);
  const anchors = buildStemScaffold(parts, scene, species, render, palette);
  buildBranchLayer(parts, scene, species, render, palette, anchors);
  buildFoliageLayer(parts, scene, species, render, palette, anchors);
  buildFlowerLayer(parts, scene, species, render, palette, anchors);

  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
  if (!merged) {
    throw new Error(`Failed to merge prototype meshes for species ${species.id}`);
  }

  merged.name = `plant-prototype-${species.id}`;
  merged.material = material;
  merged.isPickable = false;
  merged.receiveShadows = false;
  merged.alwaysSelectAsActiveMesh = true;
  merged.renderingGroupId = 1;
  merged.useVertexColors = true;
  return merged;
}

/**
 * Low spreading and ground-covering plants need visible base mass so sparse
 * grasslands and herbs do not collapse into single-stem silhouettes. Taller
 * woody forms keep this layer small.
 */
function buildGroundPatch(
  parts: Mesh[],
  scene: Scene,
  species: PlantSpeciesDefinition,
  render: PlantRenderParameters,
  palette: ReturnType<typeof getSpeciesDisplayColor>,
): void {
  const patchStrength =
    species.morphology.groundCoverFactor * 0.65 +
    (1 - species.morphology.woodiness) * 0.2 +
    species.morphology.basalSpread * 0.15;
  if (patchStrength < 0.16) {
    return;
  }

  const patchCount = Math.max(1, Math.round(1 + patchStrength * 3));
  for (let index = 0; index < patchCount; index += 1) {
    const angle = index * 2.399963229728653;
    const radius = render.groundPatchScale * 0.18 * Math.sqrt(index + 0.25);
    const width = render.groundPatchScale * (0.22 + patchStrength * 0.28);
    const depth = width * (0.65 + species.morphology.lateralSpread * 0.5);
    const patch = MeshBuilder.CreateSphere(`plant-ground-${index}`, {
      diameterX: width * 2,
      diameterY: 0.045 + patchStrength * 0.06,
      diameterZ: depth * 2,
      segments: 4,
    }, scene);
    patch.position = new Vector3(Math.cos(angle) * radius, patch.scaling.y * 0, Math.sin(angle) * radius);
    applyUniformVertexColor(patch, palette.foliage);
    patch.bakeCurrentTransformIntoVertices();
    parts.push(patch);
  }
}

/**
 * Stems define the structural skeleton of the plant. Trait changes here are
 * what make descendants look incrementally taller, bushier, tighter, looser,
 * or more upright without jumping to a different hardcoded category.
 */
function buildStemScaffold(
  parts: Mesh[],
  scene: Scene,
  species: PlantSpeciesDefinition,
  render: PlantRenderParameters,
  palette: ReturnType<typeof getSpeciesDisplayColor>,
): StemAnchor[] {
  const anchors: StemAnchor[] = [];
  const stemCount = Math.max(1, render.stemCopies);
  const goldenAngle = 2.399963229728653;
  const stemColor = species.morphology.woodiness > 0.28 ? palette.wood : palette.foliage;

  for (let index = 0; index < stemCount; index += 1) {
    const angle = index * goldenAngle;
    const radialBias = index === 0 ? 0 : Math.sqrt(index / stemCount);
    const radialDistance =
      render.stemClusterRadius *
      radialBias *
      (0.48 + (1 - species.morphology.clumping) * 0.78);
    const heightFactor =
      index === 0
        ? 0.92 + render.primaryStemHeightFraction * 0.18
        : 0.34 +
          render.primaryStemHeightFraction * 0.46 +
          species.morphology.branchingRate * 0.08 +
          ((index * 17 + species.id * 7) % 5) * 0.045;
    const stemHeight = render.heightScale * clamp(heightFactor, 0.18, 1.12);
    const baseRadius =
      render.stemBaseRadius *
      (index === 0 ? 1 : 0.52 + species.morphology.woodiness * 0.22);
    const stem = MeshBuilder.CreateCylinder(`plant-stem-${index}`, {
      height: stemHeight,
      diameterTop: Math.max(0.014, baseRadius * (0.5 + species.morphology.verticalBias * 0.25)),
      diameterBottom: Math.max(0.02, baseRadius),
      tessellation: 5,
    }, scene);

    const base = new Vector3(
      Math.cos(angle) * radialDistance,
      stemHeight * 0.5,
      Math.sin(angle) * radialDistance,
    );
    const leanStrength =
      (1 - species.morphology.uprightness) * 0.16 +
      (1 - species.morphology.verticalBias) * 0.08 +
      species.morphology.lateralSpread * 0.05;
    const leanAngle = leanStrength * (((species.id * 23 + index * 11) % 9) - 4);
    const leanX = Math.sin(angle * 0.73) * leanAngle;
    const leanZ = Math.cos(angle * 0.91) * leanAngle;

    stem.position = base;
    stem.rotation.x = leanX;
    stem.rotation.z = leanZ;
    applyUniformVertexColor(stem, stemColor);
    stem.bakeCurrentTransformIntoVertices();
    parts.push(stem);

    anchors.push({
      top: new Vector3(
        base.x + Math.sin(leanZ) * stemHeight * 0.4,
        stemHeight,
        base.z - Math.sin(leanX) * stemHeight * 0.4,
      ),
      height: stemHeight,
      influence: index === 0 ? 1 : 0.55 + radialBias * 0.25,
    });
  }

  return anchors;
}

/**
 * Branches remain optional and lightweight. Their density, reach, and height
 * placement are driven by the same continuous traits that influence ecological
 * fitness, which keeps morphology and adaptation visibly linked.
 */
function buildBranchLayer(
  parts: Mesh[],
  scene: Scene,
  species: PlantSpeciesDefinition,
  render: PlantRenderParameters,
  palette: ReturnType<typeof getSpeciesDisplayColor>,
  anchors: readonly StemAnchor[],
): void {
  if (render.branchCopies <= 0 || species.morphology.woodiness < 0.16) {
    return;
  }

  const branchCount = Math.max(0, render.branchCopies);
  const sourceAnchors = anchors.slice(0, Math.min(anchors.length, Math.max(1, Math.round(1 + species.morphology.apicalDominance * 2))));

  for (let index = 0; index < branchCount; index += 1) {
    const anchor = sourceAnchors[index % sourceAnchors.length];
    const branchLength =
      render.branchReach *
      (0.58 + species.morphology.branchDensity * 0.3 + ((index * 13 + species.id) % 5) * 0.06);
    if (branchLength < 0.08) {
      continue;
    }

    const placement = clamp(
      render.branchElevationBias * 0.55 +
        species.morphology.topFoliageBias * 0.18 +
        (index % 3) * 0.1,
      0.12,
      0.92,
    );
    const branch = MeshBuilder.CreateCylinder(`plant-branch-${index}`, {
      height: branchLength,
      diameterTop: Math.max(0.012, render.stemBaseRadius * 0.22),
      diameterBottom: Math.max(0.016, render.stemBaseRadius * 0.32),
      tessellation: 4,
    }, scene);
    const angle = index * 2.399963229728653 + species.id * 0.17;
    const elevation = render.branchAngle * (0.55 + species.morphology.verticalBias * 0.35);
    const branchOrigin = new Vector3(
      anchor.top.x * 0.18,
      anchor.height * placement,
      anchor.top.z * 0.18,
    );

    branch.position = branchOrigin;
    branch.rotation.z = Math.cos(angle) * elevation;
    branch.rotation.x = -Math.sin(angle) * elevation;
    branch.rotation.y = angle;
    applyUniformVertexColor(branch, palette.wood);
    branch.bakeCurrentTransformIntoVertices();
    parts.push(branch);
  }
}

/**
 * Foliage stays continuous and trait-driven, but leaf structure still matters.
 * Leaf type influences the primitive used for each cluster, while the amount,
 * spread, and vertical placement all come directly from morphology.
 */
function buildFoliageLayer(
  parts: Mesh[],
  scene: Scene,
  species: PlantSpeciesDefinition,
  render: PlantRenderParameters,
  palette: ReturnType<typeof getSpeciesDisplayColor>,
  anchors: readonly StemAnchor[],
): void {
  const clusterCount = Math.max(1, render.foliageClusterCopies);
  const foliagePresence = render.foliageAmount * 0.72 + species.morphology.leafDensity * 0.28;
  if (foliagePresence < 0.06) {
    return;
  }

  for (let index = 0; index < clusterCount; index += 1) {
    const anchor = anchors[index % anchors.length] ?? anchors[0];
    const angle = index * 2.399963229728653 + species.id * 0.11;
    const radialFactor = Math.sqrt((index + 0.45) / (clusterCount + 0.25));
    const lateralRadius =
      render.foliageLateralSpread *
      radialFactor *
      (0.32 + species.morphology.lateralSpread * 0.8);
    const verticalCenter =
      anchor.height *
      clamp(
        0.22 + render.foliageTopBias * 0.54 + species.morphology.topCanopyBias * 0.08,
        0.08,
        1,
      );
    const verticalJitter = render.foliageVerticalSpan * (0.18 + ((index * 19 + species.id) % 7) / 22);
    const position = new Vector3(
      anchor.top.x * 0.22 + Math.cos(angle) * lateralRadius,
      verticalCenter + (index % 2 === 0 ? verticalJitter : -verticalJitter * 0.45),
      anchor.top.z * 0.22 + Math.sin(angle) * lateralRadius,
    );
    const clusterScale =
      0.65 +
      foliagePresence * 0.55 +
      species.morphology.crownDensity * 0.2 +
      ((index * 29 + species.id * 3) % 6) * 0.06;

    addLeafElement(parts, scene, species, render, palette, position, clusterScale, angle);
  }
}

/**
 * Flower accents stay sparse and optional. Their presence is derived from the
 * inherited flowering trait, so descendants can become more or less showy
 * without changing how the rest of the plant is constructed.
 */
function buildFlowerLayer(
  parts: Mesh[],
  scene: Scene,
  species: PlantSpeciesDefinition,
  render: PlantRenderParameters,
  palette: ReturnType<typeof getSpeciesDisplayColor>,
  anchors: readonly StemAnchor[],
): void {
  const flowerStrength = render.flowerAmount * (0.72 + render.foliageAmount * 0.2);
  if (flowerStrength < 0.12) {
    return;
  }

  const flowerCount = Math.max(1, Math.round(flowerStrength * 5));
  for (let index = 0; index < flowerCount; index += 1) {
    const anchor = anchors[index % anchors.length] ?? anchors[0];
    const angle = index * 2.399963229728653;
    const radius = render.crownRadius * 0.12 + (index % 3) * render.crownRadius * 0.05;
    const flower = MeshBuilder.CreateSphere(`plant-flower-${index}`, {
      diameterX: 0.05 + render.leafWidth * 0.36,
      diameterY: 0.05 + render.leafWidth * 0.36,
      diameterZ: 0.05 + render.leafWidth * 0.36,
      segments: 4,
    }, scene);
    flower.position = new Vector3(
      anchor.top.x * 0.16 + Math.cos(angle) * radius,
      anchor.height * (0.66 + render.foliageTopBias * 0.3),
      anchor.top.z * 0.16 + Math.sin(angle) * radius,
    );
    applyUniformVertexColor(flower, palette.flower);
    flower.bakeCurrentTransformIntoVertices();
    parts.push(flower);
  }
}

function addLeafElement(
  parts: Mesh[],
  scene: Scene,
  species: PlantSpeciesDefinition,
  render: PlantRenderParameters,
  palette: ReturnType<typeof getSpeciesDisplayColor>,
  position: Vector3,
  clusterScale: number,
  angle: number,
): void {
  const length = Math.max(0.04, render.leafLength * clusterScale);
  const width = Math.max(0.02, render.leafWidth * clusterScale);
  const verticalStretch = 0.7 + species.morphology.verticalBias * 0.55;

  switch (species.morphology.leafType) {
    case PlantLeafType.Needle: {
      const element = MeshBuilder.CreateCylinder("plant-needle", {
        height: length * 0.95,
        diameterTop: 0,
        diameterBottom: Math.max(0.03, width * 1.2),
        tessellation: 4,
      }, scene);
      element.position = position.clone();
      element.rotation.y = angle;
      element.rotation.x = -render.leafTilt * 0.36;
      applyUniformVertexColor(element, palette.foliage);
      element.bakeCurrentTransformIntoVertices();
      parts.push(element);
      break;
    }
    case PlantLeafType.Frond: {
      const frondCount = 3;
      for (let frondIndex = 0; frondIndex < frondCount; frondIndex += 1) {
        const frond = MeshBuilder.CreateBox(`plant-frond-${frondIndex}`, {
          width: Math.max(0.03, width * 0.5),
          height: Math.max(0.02, width * 0.24),
          depth: length * (0.9 + frondIndex * 0.08),
        }, scene);
        frond.position = position.clone();
        frond.rotation.y = angle + (Math.PI * 2 * frondIndex) / frondCount;
        frond.rotation.x = -0.28 - render.leafTilt * 0.35;
        applyUniformVertexColor(frond, palette.foliage);
        frond.bakeCurrentTransformIntoVertices();
        parts.push(frond);
      }
      break;
    }
    case PlantLeafType.Reed: {
      const element = MeshBuilder.CreateBox("plant-reed-leaf", {
        width: Math.max(0.02, width * 0.32),
        height: length * verticalStretch,
        depth: Math.max(0.015, width * 0.18),
      }, scene);
      element.position = position.clone();
      element.rotation.y = angle;
      element.rotation.z = render.leafTilt * 0.18;
      applyUniformVertexColor(element, palette.foliage);
      element.bakeCurrentTransformIntoVertices();
      parts.push(element);
      break;
    }
    case PlantLeafType.Blade: {
      const element = MeshBuilder.CreateBox("plant-blade-leaf", {
        width: Math.max(0.02, width * 0.3),
        height: length * verticalStretch,
        depth: Math.max(0.016, width * 0.16),
      }, scene);
      element.position = position.clone();
      element.rotation.y = angle;
      element.rotation.z = render.leafTilt * 0.24;
      applyUniformVertexColor(element, palette.foliage);
      element.bakeCurrentTransformIntoVertices();
      parts.push(element);
      break;
    }
    case PlantLeafType.Broad:
    default: {
      const element = MeshBuilder.CreateSphere("plant-broad-leaf", {
        diameterX: width * 2.1,
        diameterY: length * Math.max(0.42, 0.58 + species.morphology.crownDensity * 0.25),
        diameterZ: width * (1.8 + species.morphology.lateralSpread * 0.9),
        segments: 4,
      }, scene);
      element.position = position.clone();
      element.rotation.y = angle;
      applyUniformVertexColor(element, palette.foliage);
      element.bakeCurrentTransformIntoVertices();
      parts.push(element);
      break;
    }
  }
}

function applyUniformVertexColor(mesh: Mesh, color: readonly [number, number, number]): void {
  const vertexCount = mesh.getTotalVertices();
  const colors = new Float32Array(vertexCount * 4);

  for (let index = 0; index < vertexCount; index += 1) {
    const offset = index * 4;
    colors[offset] = color[0];
    colors[offset + 1] = color[1];
    colors[offset + 2] = color[2];
    colors[offset + 3] = 1;
  }

  mesh.setVerticesData(VertexBuffer.ColorKind, Array.from(colors), true);
}
