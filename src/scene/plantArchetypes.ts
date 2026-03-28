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
 * Foliage stays fully continuous and trait-driven. The renderer no longer
 * selects from named leaf families; instead it assembles each cluster from
 * generic ribbons and optional canopy blobs whose shape, density, droop, and
 * placement all come from inherited foliage traits.
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
      (0.24 + species.morphology.lateralSpread * 0.54 + render.foliageAttachmentSpread * 0.34);
    const verticalCenter =
      anchor.height *
      clamp(
        0.12 +
          render.foliageVerticalDistribution * 0.34 +
          render.foliageTopBias * 0.22 +
          render.foliageTipBias * 0.18 +
          render.foliageBasalBias * 0.08 +
          species.morphology.topCanopyBias * 0.06,
        0.08,
        1,
      );
    const verticalJitter =
      render.foliageVerticalSpan *
      (0.08 + render.foliagePatchiness * 0.18 + ((index * 19 + species.id) % 7) / 22);
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
  const thickness = Math.max(0.01, render.leafThickness * clusterScale);
  const blobStrength = clamp(
    (width / Math.max(length, 0.04)) * 1.35 +
      render.leafClusterDensity * 0.28 +
      (1 - render.foliagePatchiness) * 0.24 -
      render.foliageAttachmentSpread * 0.18,
    0,
    1,
  );
  const ribbonCount = Math.max(
    1,
    Math.round(
      1 +
        render.leafClusterDensity * 4 +
        render.foliageAmount * 2 -
        render.foliagePatchiness * 2 +
        render.foliageAttachmentSpread,
    ),
  );
  const attachmentRadius =
    render.foliageLateralSpread *
    clusterScale *
    (0.08 + render.foliageAttachmentSpread * 0.16 + render.leafClusterRadius * 0.12);

  if (blobStrength > 0.12) {
    addFoliageBlob(parts, scene, palette, position, angle, length, width, thickness, render, blobStrength);
  }

  for (let ribbonIndex = 0; ribbonIndex < ribbonCount; ribbonIndex += 1) {
    const localAngle = angle + (Math.PI * 2 * ribbonIndex) / Math.max(ribbonCount, 1);
    const localRadius = attachmentRadius * Math.sqrt((ribbonIndex + 0.35) / (ribbonCount + 0.35));
    const localPosition = new Vector3(
      position.x + Math.cos(localAngle) * localRadius,
      position.y + (render.foliageBasalBias - render.foliageTipBias) * 0.05 * length,
      position.z + Math.sin(localAngle) * localRadius,
    );
    const localLength = length * (0.74 + ribbonIndex / Math.max(ribbonCount - 1, 1) * 0.28);
    const localWidth = width * (0.82 + ((ribbonIndex * 17 + species.id) % 5) * 0.05);
    addLeafRibbon(parts, scene, palette, localPosition, localAngle, localLength, localWidth, thickness, render);
  }
}

function addFoliageBlob(
  parts: Mesh[],
  scene: Scene,
  palette: ReturnType<typeof getSpeciesDisplayColor>,
  position: Vector3,
  angle: number,
  length: number,
  width: number,
  thickness: number,
  render: PlantRenderParameters,
  blobStrength: number,
): void {
  const blob = MeshBuilder.CreateSphere("plant-foliage-blob", {
    diameterX: Math.max(0.05, width * (1.4 + render.foliageAttachmentSpread * 0.8)),
    diameterY: Math.max(0.05, length * (0.34 + blobStrength * 0.28 + render.leafDroop * 0.08)),
    diameterZ: Math.max(0.05, width * (1.2 + render.leafClusterRadius * 1.1)),
    segments: 4,
  }, scene);
  blob.position = position.clone();
  blob.rotation.y = angle;
  blob.rotation.x = -render.leafDroop * 0.24;
  blob.rotation.z = render.leafCurvature * 0.18;
  applyUniformVertexColor(blob, palette.foliage);
  blob.bakeCurrentTransformIntoVertices();
  parts.push(blob);
}

function addLeafRibbon(
  parts: Mesh[],
  scene: Scene,
  palette: ReturnType<typeof getSpeciesDisplayColor>,
  position: Vector3,
  angle: number,
  length: number,
  width: number,
  thickness: number,
  render: PlantRenderParameters,
): void {
  const basalBias = render.foliageBasalBias;
  const baseLength = length * 0.54;
  const tipLength = length * 0.46;
  const baseTilt = render.leafTilt * (0.42 + render.foliageAttachmentSpread * 0.36) - basalBias * 0.08;
  const tipTilt = baseTilt + render.leafCurvature * 0.34 + render.leafDroop * 0.26;
  const droopOffset = render.leafDroop * length * 0.12;

  const base = MeshBuilder.CreateBox("plant-leaf-base", {
    width: Math.max(0.014, width),
    height: Math.max(0.01, thickness * (1.1 + render.leafCurvature * 0.4)),
    depth: Math.max(0.04, baseLength),
  }, scene);
  base.position = new Vector3(
    position.x,
    position.y - droopOffset * 0.2,
    position.z,
  );
  base.rotation.y = angle;
  base.rotation.x = -render.leafDroop * 0.28;
  base.rotation.z = baseTilt;
  applyUniformVertexColor(base, palette.foliage);
  base.bakeCurrentTransformIntoVertices();
  parts.push(base);

  const tip = MeshBuilder.CreateBox("plant-leaf-tip", {
    width: Math.max(0.012, width * (0.82 + render.leafCurvature * 0.1)),
    height: Math.max(0.008, thickness * 0.9),
    depth: Math.max(0.03, tipLength),
  }, scene);
  tip.position = new Vector3(
    position.x + Math.cos(angle) * baseLength * 0.18 * (0.3 + render.foliageAttachmentSpread),
    position.y - droopOffset,
    position.z + Math.sin(angle) * baseLength * 0.18 * (0.3 + render.foliageAttachmentSpread),
  );
  tip.rotation.y = angle;
  tip.rotation.x = -render.leafDroop * 0.54;
  tip.rotation.z = tipTilt;
  applyUniformVertexColor(tip, palette.foliage);
  tip.bakeCurrentTransformIntoVertices();
  parts.push(tip);
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
