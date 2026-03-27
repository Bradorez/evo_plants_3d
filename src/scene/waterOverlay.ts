import {
  Color3,
  Mesh,
  StandardMaterial,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { TerrainData } from "../sim/Terrain";
import { clamp, lerp } from "../utils/math";

export interface WaterOverlayViewOptions {
  showRivers: boolean;
  showWaterDepth: boolean;
}

/**
 * This renderer keeps a shared-vertex water surface so the result still reads
 * as liquid, but it only triangulates cells that are actually wet enough to be
 * visible. That removes the long diagonal artifacts from a full transparent
 * terrain-sized sheet while avoiding the obvious square patches from isolated
 * per-cell quads.
 */
export class WaterOverlayRenderer {
  private readonly scene: Scene;
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;
  private positions = new Float32Array();
  private colors = new Float32Array();
  private smoothedDepth = new Float32Array();
  private smoothedFlow = new Float32Array();
  private indexBuffer: number[] = [];

  public constructor(scene: Scene) {
    this.scene = scene;
    this.material = new StandardMaterial("water-overlay-material", scene);
    this.material.specularColor = Color3.Black();
    this.material.diffuseColor = Color3.White();
    this.material.emissiveColor = new Color3(0.02, 0.09, 0.18);
    this.material.alpha = 1;
    this.material.backFaceCulling = false;
    this.material.disableLighting = true;
    this.material.needDepthPrePass = true;
    this.material.separateCullingPass = true;
  }

  public rebuild(terrain: TerrainData): void {
    this.mesh?.dispose();

    const width = terrain.grid.width;
    const height = terrain.grid.height;
    const cellSize = terrain.cellSize;
    const halfWidth = (width - 1) * cellSize * 0.5;
    const halfHeight = (height - 1) * cellSize * 0.5;
    const vertexCount = terrain.grid.cellCount;

    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 4);
    this.smoothedDepth = new Float32Array(vertexCount);
    this.smoothedFlow = new Float32Array(vertexCount);
    this.indexBuffer = [];

    const normals = new Float32Array(vertexCount * 3);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = terrain.grid.index(x, y);
        const vertexOffset = index * 3;

        this.positions[vertexOffset] = x * cellSize - halfWidth;
        this.positions[vertexOffset + 1] = terrain.heights[index] + 0.05;
        this.positions[vertexOffset + 2] = y * cellSize - halfHeight;

        normals[vertexOffset] = 0;
        normals[vertexOffset + 1] = 1;
        normals[vertexOffset + 2] = 0;
      }
    }

    const mesh = new Mesh("water-overlay-mesh", this.scene);
    const vertexData = new VertexData();
    vertexData.positions = Array.from(this.positions);
    vertexData.indices = [];
    vertexData.normals = Array.from(normals);
    vertexData.colors = Array.from(this.colors);
    vertexData.applyToMesh(mesh, true);

    mesh.material = this.material;
    mesh.renderingGroupId = 1;
    mesh.isPickable = false;
    mesh.useVertexColors = true;
    mesh.hasVertexAlpha = true;

    this.mesh = mesh;
  }

  public update(
    terrain: TerrainData,
    waterDepth: Float32Array,
    flowAccumulation: Float32Array,
    options: WaterOverlayViewOptions,
  ): void {
    if (!this.mesh) {
      return;
    }

    const visible = options.showRivers || options.showWaterDepth;
    this.mesh.setEnabled(visible);

    if (!visible) {
      return;
    }

    this.blurField(terrain, waterDepth, this.smoothedDepth);
    this.blurField(terrain, flowAccumulation, this.smoothedFlow);
    this.indexBuffer.length = 0;

    for (let index = 0; index < terrain.grid.cellCount; index += 1) {
      const vertexOffset = index * 3;
      const colorOffset = index * 4;

      const depth = this.smoothedDepth[index];
      const flow = this.smoothedFlow[index];
      const depthStrength = options.showWaterDepth
        ? clamp((depth - 0.012) / 0.16, 0, 1)
        : 0;
      const riverStrength = options.showRivers
        ? clamp((Math.log1p(flow) - 4.7) / 2.5, 0, 1)
        : 0;
      const visibleStrength = Math.max(depthStrength, riverStrength * 0.72);
      const waterLift = Math.max(depth, riverStrength * 0.012);

      this.positions[vertexOffset + 1] = terrain.heights[index] + waterLift + 0.05;

      if (visibleStrength < 0.08) {
        this.colors[colorOffset] = 0;
        this.colors[colorOffset + 1] = 0;
        this.colors[colorOffset + 2] = 0;
        this.colors[colorOffset + 3] = 0;
        continue;
      }

      const pooledStrength = Math.max(depthStrength, riverStrength * 0.7);
      this.colors[colorOffset] = lerp(0.02, 0.055, riverStrength);
      this.colors[colorOffset + 1] = lerp(
        0.11,
        0.3,
        clamp(riverStrength * 0.72 + depthStrength * 0.18, 0, 1),
      );
      this.colors[colorOffset + 2] = lerp(0.3, 0.72, clamp(pooledStrength * 0.9, 0, 1));
      this.colors[colorOffset + 3] = clamp(depthStrength * 0.4 + riverStrength * 0.2, 0.1, 0.42);
    }

    for (let y = 0; y < terrain.grid.height - 1; y += 1) {
      for (let x = 0; x < terrain.grid.width - 1; x += 1) {
        const topLeft = terrain.grid.index(x, y);
        const topRight = terrain.grid.index(x + 1, y);
        const bottomLeft = terrain.grid.index(x, y + 1);
        const bottomRight = terrain.grid.index(x + 1, y + 1);

        const cellVisibleStrength =
          Math.max(
            this.colors[topLeft * 4 + 3],
            this.colors[topRight * 4 + 3],
            this.colors[bottomLeft * 4 + 3],
            this.colors[bottomRight * 4 + 3],
          );

        if (cellVisibleStrength < 0.09) {
          continue;
        }

        this.indexBuffer.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
      }
    }

    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions, false, false);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors, false, false);
    this.mesh.setIndices(this.indexBuffer, undefined, true);
  }

  private blurField(terrain: TerrainData, source: Float32Array, target: Float32Array): void {
    for (let y = 0; y < terrain.grid.height; y += 1) {
      for (let x = 0; x < terrain.grid.width; x += 1) {
        let weightSum = 0;
        let valueSum = 0;

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = x + offsetX;
            const sampleY = y + offsetY;

            if (!terrain.grid.isInside(sampleX, sampleY)) {
              continue;
            }

            const sampleIndex = terrain.grid.index(sampleX, sampleY);
            const weight =
              offsetX === 0 && offsetY === 0
                ? 0.34
                : offsetX === 0 || offsetY === 0
                  ? 0.12
                  : 0.045;

            valueSum += source[sampleIndex] * weight;
            weightSum += weight;
          }
        }

        target[terrain.grid.index(x, y)] = weightSum > 0 ? valueSum / weightSum : 0;
      }
    }
  }
}
