import { InstancedMesh, Matrix, Mesh, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { SPECIES_NONE, type PlantSpeciesDefinition, type PlantPhenotypeClass } from "../sim/PlantSpecies";
import type { TerrainData } from "../sim/Terrain";
import { createPlantSpeciesPrototype } from "./plantArchetypes";

interface SpeciesRenderBucket {
  source: Mesh;
  instances: InstancedMesh[];
}

/**
 * PlantRenderer translates the grid-based vegetation state into visible 3D
 * forms. It rebuilds instances only when the slow vegetation simulation
 * changes, so plant visuals stay inexpensive compared to the per-frame terrain
 * and water updates.
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
        const instanceCount = this.getInstanceCount(species.phenotype, density[index], cellBiomass);

        for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex += 1) {
          const instance = bucket.source.createInstance(`plant-${speciesId}-${index}-${instanceIndex}`);
          instance.parent = this.root;
          instance.isPickable = false;
          instance.renderingGroupId = 1;
          instance.alwaysSelectAsActiveMesh = true;

          const offset = this.getInstanceOffset(terrain.cellSize, index, instanceIndex, species.phenotype);
          const size = this.getInstanceScale(species, density[index], cellBiomass, instanceIndex);
          instance.position = new Vector3(worldX + offset.x, baseY + 0.02, worldZ + offset.z);
          instance.scaling = size;
          instance.rotationQuaternion = Quaternion.FromEulerAngles(
            0,
            this.getYaw(index, instanceIndex),
            this.getLean(species.phenotype, index, instanceIndex),
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

  private getInstanceCount(
    phenotype: PlantPhenotypeClass,
    densityClass: number,
    biomass: number,
  ): number {
    if (phenotype === 0 || phenotype === 1 || phenotype === 6) {
      return densityClass >= 3 ? 3 : densityClass === 2 ? 2 : biomass > 0.2 ? 2 : 1;
    }

    return densityClass >= 3 && biomass > 0.7 && (phenotype === 2 || phenotype === 5) ? 2 : 1;
  }

  private getInstanceOffset(
    cellSize: number,
    cellIndex: number,
    instanceIndex: number,
    phenotype: PlantPhenotypeClass,
  ): Vector3 {
    const spread = phenotype === 0 || phenotype === 1 || phenotype === 6 ? cellSize * 0.22 : cellSize * 0.14;
    const angle = ((cellIndex * 37 + instanceIndex * 173) % 360) * (Math.PI / 180);
    const radius = instanceIndex === 0 ? 0 : spread * (0.55 + (((cellIndex + instanceIndex * 13) % 7) / 10));
    return new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  }

  private getInstanceScale(
    species: PlantSpeciesDefinition,
    densityClass: number,
    biomass: number,
    instanceIndex: number,
  ): Vector3 {
    const densityScale = densityClass === 1 ? 0.72 : densityClass === 2 ? 0.94 : 1.1;
    const biomassScale = 0.46 + biomass * 0.82;
    const stagger = 0.92 + ((species.id * 17 + instanceIndex * 11) % 9) / 40;
    const uprightBias = 0.86 + species.morphology.uprightness * 0.24;
    const xzScale =
      biomassScale *
      densityScale *
      stagger *
      (0.74 + species.morphology.crownWidth * 0.08 + species.morphology.groundCoverFactor * 0.06);
    const yScale = biomassScale * densityScale * stagger * uprightBias;

    return new Vector3(xzScale, yScale, xzScale);
  }

  private getYaw(cellIndex: number, instanceIndex: number): number {
    return (((cellIndex * 73 + instanceIndex * 191) % 360) * Math.PI) / 180;
  }

  private getLean(
    phenotype: PlantPhenotypeClass,
    cellIndex: number,
    instanceIndex: number,
  ): number {
    if (phenotype === 3 || phenotype === 4 || phenotype === 5) {
      return 0;
    }

    return ((((cellIndex * 19 + instanceIndex * 53) % 11) - 5) / 100);
  }
}
