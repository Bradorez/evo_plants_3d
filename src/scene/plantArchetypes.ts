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
  PlantPhenotypeClass,
  type PlantSpeciesDefinition,
} from "../sim/PlantSpecies";

/**
 * Plant archetype generation is intentionally procedural and low detail. The
 * goal is a small library of recognizable silhouettes that can be instanced
 * many times, not bespoke authored assets for each species.
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

  switch (species.phenotype) {
    case PlantPhenotypeClass.Grass:
      buildGrass(parts, scene, render, palette);
      break;
    case PlantPhenotypeClass.FloweringHerb:
      buildFloweringHerb(parts, scene, render, palette);
      break;
    case PlantPhenotypeClass.Shrub:
      buildShrub(parts, scene, render, palette);
      break;
    case PlantPhenotypeClass.BroadleafTree:
      buildBroadleafTree(parts, scene, render, palette);
      break;
    case PlantPhenotypeClass.Conifer:
      buildConifer(parts, scene, render, palette);
      break;
    case PlantPhenotypeClass.Palm:
      buildPalm(parts, scene, render, palette);
      break;
    case PlantPhenotypeClass.Reed:
      buildReed(parts, scene, render, palette);
      break;
  }

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

function buildGrass(parts: Mesh[], scene: Scene, render: ReturnType<typeof derivePlantRenderParameters>, palette: ReturnType<typeof getSpeciesDisplayColor>): void {
  const bladeCount = Math.max(3, Math.min(6, render.stemCopies + 1));

  for (let index = 0; index < bladeCount; index += 1) {
    const bladeHeight = render.heightScale * (0.55 + index * 0.04);
    const blade = MeshBuilder.CreateBox(`grass-blade-${index}`, {
      width: 0.045,
      height: bladeHeight,
      depth: 0.01,
    }, scene);
    blade.position.y = bladeHeight * 0.5;
    blade.rotation.y = (Math.PI * 2 * index) / bladeCount;
    blade.rotation.z = -0.08 + index * 0.035;
    applyUniformVertexColor(blade, palette.foliage);
    blade.bakeCurrentTransformIntoVertices();
    parts.push(blade);
  }
}

function buildFloweringHerb(parts: Mesh[], scene: Scene, render: ReturnType<typeof derivePlantRenderParameters>, palette: ReturnType<typeof getSpeciesDisplayColor>): void {
  const stem = MeshBuilder.CreateCylinder("herb-stem", {
    height: render.heightScale * 0.7,
    diameterTop: 0.03,
    diameterBottom: 0.05,
    tessellation: 5,
  }, scene);
  stem.position.y = render.heightScale * 0.35;
  applyUniformVertexColor(stem, palette.wood);
  stem.bakeCurrentTransformIntoVertices();
  parts.push(stem);

  for (const direction of [-1, 1]) {
    const leaf = MeshBuilder.CreateBox(`herb-leaf-${direction}`, {
      width: 0.16,
      height: 0.03,
      depth: 0.38,
    }, scene);
    leaf.position = new Vector3(direction * 0.11, render.heightScale * 0.28, 0);
    leaf.rotation.z = direction * 0.55;
    applyUniformVertexColor(leaf, palette.foliage);
    leaf.bakeCurrentTransformIntoVertices();
    parts.push(leaf);
  }

  const flower = MeshBuilder.CreateSphere("herb-flower", {
    diameterX: 0.18,
    diameterY: 0.18,
    diameterZ: 0.18,
    segments: 4,
  }, scene);
  flower.position.y = render.heightScale * 0.72;
  applyUniformVertexColor(flower, palette.flower);
  flower.bakeCurrentTransformIntoVertices();
  parts.push(flower);
}

function buildShrub(parts: Mesh[], scene: Scene, render: ReturnType<typeof derivePlantRenderParameters>, palette: ReturnType<typeof getSpeciesDisplayColor>): void {
  const stemCount = Math.max(2, Math.min(5, render.stemCopies));

  for (let index = 0; index < stemCount; index += 1) {
    const angle = (Math.PI * 2 * index) / stemCount;
    const stem = MeshBuilder.CreateCylinder(`shrub-stem-${index}`, {
      height: render.heightScale * 0.42,
      diameterTop: 0.05,
      diameterBottom: 0.08,
      tessellation: 5,
    }, scene);
    stem.position = new Vector3(Math.cos(angle) * 0.1, render.heightScale * 0.21, Math.sin(angle) * 0.1);
    stem.rotation.z = Math.cos(angle) * 0.18;
    stem.rotation.x = Math.sin(angle) * 0.12;
    applyUniformVertexColor(stem, palette.wood);
    stem.bakeCurrentTransformIntoVertices();
    parts.push(stem);
  }

  for (const offset of [
    new Vector3(-0.22, render.heightScale * 0.52, 0),
    new Vector3(0.18, render.heightScale * 0.56, 0.08),
    new Vector3(0.02, render.heightScale * 0.65, -0.16),
  ]) {
    const canopy = MeshBuilder.CreateSphere("shrub-canopy", {
      diameterX: render.crownWidthScale * 0.75,
      diameterY: render.crownHeightScale * 0.62,
      diameterZ: render.crownWidthScale * 0.75,
      segments: 4,
    }, scene);
    canopy.position = offset;
    applyUniformVertexColor(canopy, palette.foliage);
    canopy.bakeCurrentTransformIntoVertices();
    parts.push(canopy);
  }
}

function buildBroadleafTree(parts: Mesh[], scene: Scene, render: ReturnType<typeof derivePlantRenderParameters>, palette: ReturnType<typeof getSpeciesDisplayColor>): void {
  const trunkHeight = render.heightScale * render.trunkHeightFraction;
  const trunk = MeshBuilder.CreateCylinder("tree-trunk", {
    height: trunkHeight,
    diameterTop: 0.14,
    diameterBottom: 0.24,
    tessellation: 6,
  }, scene);
  trunk.position.y = trunkHeight * 0.5;
  applyUniformVertexColor(trunk, palette.wood);
  trunk.bakeCurrentTransformIntoVertices();
  parts.push(trunk);

  for (const offset of [
    new Vector3(0, trunkHeight + render.crownHeightScale * 0.35, 0),
    new Vector3(render.crownWidthScale * 0.18, trunkHeight + render.crownHeightScale * 0.22, render.crownWidthScale * 0.12),
  ]) {
    const canopy = MeshBuilder.CreateSphere("tree-canopy", {
      diameterX: render.crownWidthScale,
      diameterY: render.crownHeightScale,
      diameterZ: render.crownWidthScale,
      segments: 5,
    }, scene);
    canopy.position = offset;
    applyUniformVertexColor(canopy, palette.foliage);
    canopy.bakeCurrentTransformIntoVertices();
    parts.push(canopy);
  }
}

function buildConifer(parts: Mesh[], scene: Scene, render: ReturnType<typeof derivePlantRenderParameters>, palette: ReturnType<typeof getSpeciesDisplayColor>): void {
  const trunkHeight = render.heightScale * 0.34;
  const trunk = MeshBuilder.CreateCylinder("conifer-trunk", {
    height: trunkHeight,
    diameterTop: 0.09,
    diameterBottom: 0.17,
    tessellation: 5,
  }, scene);
  trunk.position.y = trunkHeight * 0.5;
  applyUniformVertexColor(trunk, palette.wood);
  trunk.bakeCurrentTransformIntoVertices();
  parts.push(trunk);

  for (const [heightFactor, widthFactor, yOffset] of [
    [0.58, 1, 0.28],
    [0.48, 0.76, 0.68],
    [0.36, 0.5, 0.98],
  ] as const) {
    const cone = MeshBuilder.CreateCylinder("conifer-cone", {
      height: render.crownHeightScale * heightFactor,
      diameterTop: 0,
      diameterBottom: render.crownWidthScale * widthFactor,
      tessellation: 5,
    }, scene);
    cone.position.y = trunkHeight + render.crownHeightScale * yOffset * 0.5;
    applyUniformVertexColor(cone, palette.foliage);
    cone.bakeCurrentTransformIntoVertices();
    parts.push(cone);
  }
}

function buildPalm(parts: Mesh[], scene: Scene, render: ReturnType<typeof derivePlantRenderParameters>, palette: ReturnType<typeof getSpeciesDisplayColor>): void {
  const trunkHeight = render.heightScale * 0.82;
  const trunk = MeshBuilder.CreateCylinder("palm-trunk", {
    height: trunkHeight,
    diameterTop: 0.12,
    diameterBottom: 0.18,
    tessellation: 6,
  }, scene);
  trunk.position.y = trunkHeight * 0.5;
  applyUniformVertexColor(trunk, palette.wood);
  trunk.bakeCurrentTransformIntoVertices();
  parts.push(trunk);

  const frondCount = 5;
  for (let index = 0; index < frondCount; index += 1) {
    const frond = MeshBuilder.CreateBox(`palm-frond-${index}`, {
      width: 0.06,
      height: 0.03,
      depth: render.crownWidthScale * 0.95,
    }, scene);
    frond.position.y = trunkHeight + 0.08;
    frond.rotation.y = (Math.PI * 2 * index) / frondCount;
    frond.rotation.x = -0.36;
    frond.position.z = render.crownWidthScale * 0.22;
    applyUniformVertexColor(frond, palette.foliage);
    frond.bakeCurrentTransformIntoVertices();
    parts.push(frond);
  }
}

function buildReed(parts: Mesh[], scene: Scene, render: ReturnType<typeof derivePlantRenderParameters>, palette: ReturnType<typeof getSpeciesDisplayColor>): void {
  const stemCount = Math.max(3, Math.min(6, render.stemCopies));

  for (let index = 0; index < stemCount; index += 1) {
    const angle = (Math.PI * 2 * index) / stemCount;
    // Reeds should read as a looser stand, not a tight bouquet. Spreading the
    // stems farther inside each clump makes adjacent reed cells blend together
    // more naturally across the marsh.
    const radius = 0.15 + (index % 2) * 0.08 + Math.floor(index / 2) * 0.035;
    const stemHeight = render.heightScale * (0.72 + (index % 3) * 0.08);
    const stem = MeshBuilder.CreateCylinder(`reed-stem-${index}`, {
      height: stemHeight,
      diameterTop: 0.022,
      diameterBottom: 0.028,
      tessellation: 4,
    }, scene);
    stem.position = new Vector3(Math.cos(angle) * radius, stemHeight * 0.5, Math.sin(angle) * radius);
    stem.rotation.z = Math.cos(angle) * 0.05;
    applyUniformVertexColor(stem, palette.foliage);
    stem.bakeCurrentTransformIntoVertices();
    parts.push(stem);

    const head = MeshBuilder.CreateSphere(`reed-head-${index}`, {
      diameterX: 0.05,
      diameterY: 0.14,
      diameterZ: 0.05,
      segments: 3,
    }, scene);
    head.position = new Vector3(Math.cos(angle) * radius, stemHeight, Math.sin(angle) * radius);
    applyUniformVertexColor(head, palette.wood);
    head.bakeCurrentTransformIntoVertices();
    parts.push(head);
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
