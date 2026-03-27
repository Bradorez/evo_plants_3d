import { InstancedMesh, Mesh, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import {
  derivePlantRenderParameters,
  SPECIES_NONE,
  type PlantRenderParameters,
  type PlantSpeciesDefinition,
} from "../sim/PlantSpecies";
import type { TerrainData } from "../sim/Terrain";
import { createPlantSpeciesPrototype } from "./plantArchetypes";

interface SpeciesRenderBucket {
  source: Mesh;
  instances: InstancedMesh[];
  render: PlantRenderParameters;
}

/**
 * PlantRenderer translates the grid-based vegetation state into visible 3D
 * forms. Prototypes are cached per species, and per-cell instance placement is
 * driven by continuous morphology traits so small inherited changes show up as
 * small visible changes rather than switching to a different phenotype bucket.
 */
export class PlantRenderer {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly speciesBuckets = new Map<number, SpeciesRenderBucket>();

  private lastRevision = -1;
  private lastTerrainSeed = -1;

  public constructor(scene: Scene) {
    this.scene = scene;
    this.root = new TransformNode("plant-root", scene);
  }

  public rebuild(): void {
    this.disposeAllBuckets();
    this.lastRevision = -1;
    this.lastTerrainSeed = -1;
  }

  public update(
    terrain: TerrainData,
    biomass: Float32Array,
    density: Uint8Array,
    speciesIds: Uint16Array,
    speciesCatalog: readonly PlantSpeciesDefinition[],
    revision: number,
  ): void {
    if (
      biomass.length !== terrain.grid.cellCount ||
      density.length !== terrain.grid.cellCount ||
      speciesIds.length !== terrain.grid.cellCount
    ) {
      return;
    }

    if (terrain.seed !== this.lastTerrainSeed) {
      this.disposeAllBuckets();
      this.lastTerrainSeed = terrain.seed;
      this.lastRevision = -1;
    }

    if (revision === this.lastRevision) {
      return;
    }

    this.syncSpeciesBuckets(speciesCatalog);
    this.clearInstances();

    const halfWidth = (terrain.grid.width - 1) * terrain.cellSize * 0.5;
    const halfHeight = (terrain.grid.height - 1) * terrain.cellSize * 0.5;

    for (let y = 0; y < terrain.grid.height; y += 1) {
      for (let x = 0; x < terrain.grid.width; x += 1) {
        const index = terrain.grid.index(x, y);
        const speciesId = speciesIds[index];
        const cellBiomass = biomass[index];

        if (speciesId === SPECIES_NONE || cellBiomass < 0.12) {
          continue;
        }

        const species = speciesCatalog[speciesId];
        const bucket = this.speciesBuckets.get(speciesId);
        if (!species || !bucket) {
          continue;
        }

        const worldX = x * terrain.cellSize - halfWidth;
        const worldZ = y * terrain.cellSize - halfHeight;
        const baseY = terrain.heights[index];
        const instanceCount = this.getInstanceCount(species, bucket.render, density[index], cellBiomass);

        for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
          const instance = bucket.source.createInstance(`plant-${speciesId}-${index}-${instanceIndex}`);
          instance.parent = this.root;
          instance.isPickable = false;
          instance.renderingGroupId = 1;
          instance.alwaysSelectAsActiveMesh = true;

          const offset = this.getInstanceOffset(
            terrain.cellSize,
            index,
            instanceIndex,
            species,
            bucket.render,
          );
          const size = this.getInstanceScale(
            species,
            bucket.render,
            density[index],
            cellBiomass,
            instanceIndex,
          );
          instance.position = new Vector3(worldX + offset.x, baseY + 0.02, worldZ + offset.z);
          instance.scaling = size;
          instance.rotationQuaternion = Quaternion.FromEulerAngles(
            0,
            this.getYaw(index, instanceIndex),
            this.getLean(species, index, instanceIndex),
          );
          instance.freezeWorldMatrix();
          bucket.instances.push(instance);
        }
      }
    }

    this.lastRevision = revision;
  }

  private syncSpeciesBuckets(speciesCatalog: readonly PlantSpeciesDefinition[]): void {
    for (const species of speciesCatalog) {
      if (this.speciesBuckets.has(species.id)) {
        continue;
      }

      const source = createPlantSpeciesPrototype(this.scene, species);
      source.parent = this.root;
      source.isVisible = false;
      source.isPickable = false;
      source.renderingGroupId = 1;
      this.speciesBuckets.set(species.id, {
        source,
        instances: [],
        render: derivePlantRenderParameters(species),
      });
    }
  }

  private clearInstances(): void {
    for (const bucket of this.speciesBuckets.values()) {
      for (const instance of bucket.instances) {
        instance.dispose();
      }
      bucket.instances.length = 0;
    }
  }

  private disposeAllBuckets(): void {
    for (const bucket of this.speciesBuckets.values()) {
      for (const instance of bucket.instances) {
        instance.dispose();
      }
      bucket.source.material?.dispose();
      bucket.source.dispose();
    }

    this.speciesBuckets.clear();
  }

  /**
   * Coverage-heavy, low-woody plants should occupy more visual room inside a
   * cell than tall isolated woody forms. This keeps density changes smooth and
   * trait-driven rather than bucket-driven.
   */
  private getInstanceCount(
    species: PlantSpeciesDefinition,
    render: PlantRenderParameters,
    densityClass: number,
    biomass: number,
  ): number {
    const morphology = species.morphology;
    const coverageBias =
      morphology.groundCoverFactor * 0.34 +
      morphology.basalSpread * 0.24 +
      (1 - morphology.woodiness) * 0.2 +
      (1 - morphology.clumping) * 0.12 +
      Math.min(render.stemCopies / 8, 1) * 0.1;
    const woodyPenalty =
      morphology.woodiness * 0.24 +
      Math.min(morphology.maxHeight / 12, 1) * 0.16 +
      morphology.apicalDominance * 0.12;
    const desired =
      1 +
      coverageBias * 2.8 +
      (densityClass >= 2 ? 0.4 : 0) +
      (densityClass >= 3 ? 0.45 : 0) +
      Math.max(0, biomass - 0.3) * 0.8 -
      woodyPenalty * 1.9;

    return Math.max(1, Math.min(4, Math.round(desired)));
  }

  /**
   * Instance spread is derived from basal spread, clumping, and stem-cluster
   * radius so descendants can become visibly tighter or looser without needing
   * a phenotype-specific placement rule.
   */
  private getInstanceOffset(
    cellSize: number,
    cellIndex: number,
    instanceIndex: number,
    species: PlantSpeciesDefinition,
    render: PlantRenderParameters,
  ): Vector3 {
    const morphology = species.morphology;
    const spread =
      cellSize *
      (
        0.05 +
        morphology.groundCoverFactor * 0.14 +
        morphology.basalSpread * 0.08 +
        render.stemClusterRadius * 0.05 +
        (1 - morphology.clumping) * 0.08
      );
    const angle = ((cellIndex * 37 + instanceIndex * 173) % 360) * (Math.PI / 180);
    const radius =
      instanceIndex === 0
        ? 0
        : spread *
          (0.4 + (((cellIndex + instanceIndex * 13) % 7) / 10)) *
          (0.72 + (1 - morphology.clumping) * 0.45);

    return new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  }

  private getInstanceScale(
    species: PlantSpeciesDefinition,
    render: PlantRenderParameters,
    densityClass: number,
    biomass: number,
    instanceIndex: number,
  ): Vector3 {
    const densityScale = densityClass === 1 ? 0.72 : densityClass === 2 ? 0.94 : 1.1;
    const biomassScale = 0.46 + biomass * 0.82;
    const stagger = 0.92 + ((species.id * 17 + instanceIndex * 11) % 9) / 40;
    const uprightBias = 0.86 + species.morphology.uprightness * 0.24;
    const crownScale =
      0.72 +
      Math.min(render.crownRadius / 3.2, 1) * 0.14 +
      species.morphology.groundCoverFactor * 0.08 +
      species.morphology.basalSpread * 0.08;
    const xzScale =
      biomassScale *
      densityScale *
      stagger *
      crownScale;
    const yScale =
      biomassScale *
      densityScale *
      stagger *
      uprightBias *
      (0.84 + Math.min(render.heightScale / 8, 1) * 0.18);

    return new Vector3(xzScale, yScale, xzScale);
  }

  private getYaw(cellIndex: number, instanceIndex: number): number {
    return (((cellIndex * 73 + instanceIndex * 191) % 360) * Math.PI) / 180;
  }

  private getLean(
    species: PlantSpeciesDefinition,
    cellIndex: number,
    instanceIndex: number,
  ): number {
    const morphology = species.morphology;
    const leanMagnitude =
      (1 - morphology.uprightness) * 0.1 +
      (1 - morphology.verticalBias) * 0.06 +
      morphology.groundCoverFactor * 0.03 +
      morphology.lateralSpread * 0.03 -
      morphology.woodiness * 0.04;

    return ((((cellIndex * 19 + instanceIndex * 53) % 11) - 5) / 5) * leanMagnitude;
  }
}
