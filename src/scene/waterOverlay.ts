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
 * WaterOverlayRenderer keeps a lightweight dynamic mesh above the terrain.
 * Only vertex positions and colors are updated per frame, which is much cheaper
 * than rebuilding topology while still making changing water surfaces readable.
 */
export class WaterOverlayRenderer {
  private readonly scene: Scene;
  private readonly material: StandardMaterial;
  private mesh: Mesh | null = null;
  private positions = new Float32Array();
  private colors = new Float32Array();

  public constructor(scene: Scene) {
    this.scene = scene;
    this.material = new StandardMaterial("water-overlay-material", scene);
    this.material.specularColor = Color3.Black();
    this.material.diffuseColor = Color3.White();
    this.material.emissiveColor = new Color3(0.018, 0.08, 0.16);
    this.material.alpha = 1;
    this.material.backFaceCulling = false;
    this.material.disableLighting = true;
  }

  public rebuild(terrain: TerrainData): void {
    this.mesh?.dispose();

    const width = terrain.grid.width;
    const height = terrain.grid.height;
    const cellSize = terrain.cellSize;
    const halfWidth = (width - 1) * cellSize * 0.5;
    const halfHeight = (height - 1) * cellSize * 0.5;

    this.positions = new Float32Array(width * height * 3);
    this.colors = new Float32Array(width * height * 4);
    const indices = new Uint32Array((width - 1) * (height - 1) * 6);
    const normals = new Float32Array(width * height * 3);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = terrain.grid.index(x, y);
        const vertexOffset = index * 3;

        this.positions[vertexOffset] = x * cellSize - halfWidth;
        this.positions[vertexOffset + 1] = terrain.heights[index] + 0.03;
        this.positions[vertexOffset + 2] = y * cellSize - halfHeight;

        normals[vertexOffset] = 0;
        normals[vertexOffset + 1] = 1;
        normals[vertexOffset + 2] = 0;
      }
    }

    let indexCursor = 0;

    for (let y = 0; y < height - 1; y += 1) {
      for (let x = 0; x < width - 1; x += 1) {
        const topLeft = terrain.grid.index(x, y);
        const topRight = terrain.grid.index(x + 1, y);
        const bottomLeft = terrain.grid.index(x, y + 1);
        const bottomRight = terrain.grid.index(x + 1, y + 1);

        indices[indexCursor] = topLeft;
        indices[indexCursor + 1] = bottomLeft;
        indices[indexCursor + 2] = topRight;
        indices[indexCursor + 3] = topRight;
        indices[indexCursor + 4] = bottomLeft;
        indices[indexCursor + 5] = bottomRight;
        indexCursor += 6;
      }
    }

    const mesh = new Mesh("water-overlay-mesh", this.scene);
    const vertexData = new VertexData();
    vertexData.positions = Array.from(this.positions);
    vertexData.indices = Array.from(indices);
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

    for (let index = 0; index < terrain.grid.cellCount; index += 1) {
      const vertexOffset = index * 3;
      const colorOffset = index * 4;
      const depth = waterDepth[index];
      const accumulation = flowAccumulation[index];
      const depthStrength = options.showWaterDepth
        ? clamp((depth - 0.035) / 0.22, 0, 1)
        : 0;
      const riverStrength = options.showRivers
        ? clamp((Math.log1p(accumulation) - 5.1) / 2.2, 0, 1)
        : 0;
      const wetChannelStrength = riverStrength * clamp((depth - 0.012) / 0.08, 0, 1);
      const visibleStrength = Math.max(depthStrength, wetChannelStrength);
      const waterSurfaceLift = Math.max(depth, wetChannelStrength * 0.008);

      this.positions[vertexOffset + 1] = terrain.heights[index] + waterSurfaceLift + 0.03;

      if (visibleStrength < 0.18) {
        this.colors[colorOffset] = 0;
        this.colors[colorOffset + 1] = 0;
        this.colors[colorOffset + 2] = 0;
        this.colors[colorOffset + 3] = 0;
        continue;
      }

      const pooledWaterStrength = Math.max(depthStrength, wetChannelStrength);
      const r = lerp(0.01, 0.035, wetChannelStrength);
      const g = lerp(0.08, 0.24, clamp(wetChannelStrength * 0.9 + depthStrength * 0.16, 0, 1));
      const b = lerp(0.24, 0.62, clamp(pooledWaterStrength * 0.92, 0, 1));
      const alpha = clamp(depthStrength * 0.34 + wetChannelStrength * 0.2, 0.06, 0.36);

      this.colors[colorOffset] = r;
      this.colors[colorOffset + 1] = g;
      this.colors[colorOffset + 2] = b;
      this.colors[colorOffset + 3] = alpha;
    }

    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions, false, false);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors, false, false);
  }
}
