import {
  Color3,
  Mesh,
  StandardMaterial,
  VertexData,
} from "@babylonjs/core";
import { inverseLerp, lerp } from "../utils/math";
import type { TerrainData } from "../sim/Terrain";
import type { Scene } from "@babylonjs/core";

/**
 * TerrainMeshRenderer converts the simulation heightmap into a static Babylon
 * mesh. The terrain only changes when a new procedural seed is generated, so
 * rebuilding it on regeneration keeps the runtime render path cheap.
 */
export class TerrainMeshRenderer {
  private readonly scene: Scene;
  private readonly material: StandardMaterial;
  private readonly occluderMaterial: StandardMaterial;
  private mesh: Mesh | null = null;
  private occluderMesh: Mesh | null = null;

  public constructor(scene: Scene) {
    this.scene = scene;
    this.material = new StandardMaterial("terrain-material", scene);
    this.material.backFaceCulling = true;
    this.material.specularColor = Color3.Black();
    this.material.diffuseColor = new Color3(0.98, 0.89, 0.76);
    this.material.emissiveColor = new Color3(0.018, 0.012, 0.008);

    // Depth-only occluder used to ensure hidden water never leaks through the
    // terrain volume due to transparency sorting or the small render lift on
    // the water surface.
    this.occluderMaterial = new StandardMaterial("terrain-occluder-material", scene);
    this.occluderMaterial.disableColorWrite = true;
    this.occluderMaterial.backFaceCulling = false;
    this.occluderMaterial.forceDepthWrite = true;
  }

  public rebuild(terrain: TerrainData): Mesh {
    this.mesh?.dispose();
    this.occluderMesh?.dispose();

    const width = terrain.grid.width;
    const height = terrain.grid.height;
    const cellSize = terrain.cellSize;
    const halfWidth = (width - 1) * cellSize * 0.5;
    const halfHeight = (height - 1) * cellSize * 0.5;
    const topVertexCount = width * height;
    const bottomVertexCount = topVertexCount;
    const edgeRingVertexCount = width * 2 + Math.max(height - 2, 0) * 2;
    const totalVertexCount = topVertexCount + bottomVertexCount + edgeRingVertexCount * 2;
    const bottomY = terrain.minHeight - 18;

    const positions = new Float32Array(totalVertexCount * 3);
    const colors = new Float32Array(totalVertexCount * 4);
    const indices: number[] = [];

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = terrain.grid.index(x, y);
        const vertexOffset = index * 3;
        const colorOffset = index * 4;
        const elevation = terrain.heights[index];
        const slope = this.sampleSlope(terrain, x, y);
        const color = this.getTerrainColor(
          inverseLerp(terrain.minHeight, terrain.maxHeight, elevation),
          slope,
        );

        positions[vertexOffset] = x * cellSize - halfWidth;
        positions[vertexOffset + 1] = elevation;
        positions[vertexOffset + 2] = y * cellSize - halfHeight;

        colors[colorOffset] = color[0];
        colors[colorOffset + 1] = color[1];
        colors[colorOffset + 2] = color[2];
        colors[colorOffset + 3] = 1;
      }
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const topIndex = terrain.grid.index(x, y);
        const bottomIndex = topVertexCount + topIndex;
        const topColorOffset = topIndex * 4;
        const bottomColorOffset = bottomIndex * 4;
        const bottomVertexOffset = bottomIndex * 3;

        positions[bottomVertexOffset] = positions[topIndex * 3];
        positions[bottomVertexOffset + 1] = bottomY;
        positions[bottomVertexOffset + 2] = positions[topIndex * 3 + 2];

        colors[bottomColorOffset] = colors[topColorOffset] * 0.72;
        colors[bottomColorOffset + 1] = colors[topColorOffset + 1] * 0.72;
        colors[bottomColorOffset + 2] = colors[topColorOffset + 2] * 0.72;
        colors[bottomColorOffset + 3] = 1;
      }
    }

    for (let y = 0; y < height - 1; y += 1) {
      for (let x = 0; x < width - 1; x += 1) {
        const topLeft = terrain.grid.index(x, y);
        const topRight = terrain.grid.index(x + 1, y);
        const bottomLeft = terrain.grid.index(x, y + 1);
        const bottomRight = terrain.grid.index(x + 1, y + 1);

        // Wind triangles so the terrain top surface faces the camera when
        // viewed from above. The previous winding produced backfaces on the
        // playable side of the terrain, which made the ground appear
        // transparent from the normal orbit angle.
        indices.push(topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft);

        const baseBottomLeft = topVertexCount + bottomLeft;
        const baseBottomRight = topVertexCount + bottomRight;
        const baseTopLeft = topVertexCount + topLeft;
        const baseTopRight = topVertexCount + topRight;
        indices.push(baseTopLeft, baseBottomLeft, baseTopRight, baseTopRight, baseBottomLeft, baseBottomRight);
      }
    }

    const perimeterTopIndices: number[] = [];

    for (let x = 0; x < width; x += 1) {
      perimeterTopIndices.push(terrain.grid.index(x, 0));
    }

    for (let y = 1; y < height - 1; y += 1) {
      perimeterTopIndices.push(terrain.grid.index(width - 1, y));
    }

    for (let x = width - 1; x >= 0; x -= 1) {
      perimeterTopIndices.push(terrain.grid.index(x, height - 1));
    }

    for (let y = height - 2; y >= 1; y -= 1) {
      perimeterTopIndices.push(terrain.grid.index(0, y));
    }

    const perimeterLength = perimeterTopIndices.length;
    const perimeterTopStart = topVertexCount + bottomVertexCount;
    const perimeterBottomStart = perimeterTopStart + perimeterLength;

    for (let perimeterOffset = 0; perimeterOffset < perimeterLength; perimeterOffset += 1) {
      const sourceTopIndex = perimeterTopIndices[perimeterOffset];
      const sourceTopOffset = sourceTopIndex * 3;
      const topCopyIndex = perimeterTopStart + perimeterOffset;
      const bottomCopyIndex = perimeterBottomStart + perimeterOffset;
      const topCopyOffset = topCopyIndex * 3;
      const bottomCopyOffset = bottomCopyIndex * 3;
      const sourceColorOffset = sourceTopIndex * 4;
      const topCopyColorOffset = topCopyIndex * 4;
      const bottomCopyColorOffset = bottomCopyIndex * 4;

      positions[topCopyOffset] = positions[sourceTopOffset];
      positions[topCopyOffset + 1] = positions[sourceTopOffset + 1];
      positions[topCopyOffset + 2] = positions[sourceTopOffset + 2];

      positions[bottomCopyOffset] = positions[sourceTopOffset];
      positions[bottomCopyOffset + 1] = bottomY;
      positions[bottomCopyOffset + 2] = positions[sourceTopOffset + 2];

      colors[topCopyColorOffset] = colors[sourceColorOffset];
      colors[topCopyColorOffset + 1] = colors[sourceColorOffset + 1];
      colors[topCopyColorOffset + 2] = colors[sourceColorOffset + 2];
      colors[topCopyColorOffset + 3] = 1;

      colors[bottomCopyColorOffset] = colors[sourceColorOffset] * 0.7;
      colors[bottomCopyColorOffset + 1] = colors[sourceColorOffset + 1] * 0.7;
      colors[bottomCopyColorOffset + 2] = colors[sourceColorOffset + 2] * 0.7;
      colors[bottomCopyColorOffset + 3] = 1;
    }

    for (let perimeterOffset = 0; perimeterOffset < perimeterLength; perimeterOffset += 1) {
      const nextOffset = (perimeterOffset + 1) % perimeterLength;
      const currentTop = perimeterTopStart + perimeterOffset;
      const nextTop = perimeterTopStart + nextOffset;
      const currentBottom = perimeterBottomStart + perimeterOffset;
      const nextBottom = perimeterBottomStart + nextOffset;

      indices.push(currentTop, currentBottom, nextTop, nextTop, currentBottom, nextBottom);
    }

    const normals: number[] = [];
    VertexData.ComputeNormals(Array.from(positions), indices, normals);

    const mesh = new Mesh("terrain-mesh", this.scene);
    const vertexData = new VertexData();
    vertexData.positions = Array.from(positions);
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.colors = Array.from(colors);
    vertexData.applyToMesh(mesh, false);

    mesh.material = this.material;
    mesh.receiveShadows = false;
    mesh.isPickable = false;
    mesh.useVertexColors = true;

    const occluderPositions = Array.from(positions);

    for (let topIndex = 0; topIndex < topVertexCount; topIndex += 1) {
      occluderPositions[topIndex * 3 + 1] += 0.035;
    }

    for (let perimeterOffset = 0; perimeterOffset < perimeterLength; perimeterOffset += 1) {
      const perimeterTopIndex = perimeterTopStart + perimeterOffset;
      occluderPositions[perimeterTopIndex * 3 + 1] += 0.035;
    }

    const occluderNormals: number[] = [];
    VertexData.ComputeNormals(occluderPositions, indices, occluderNormals);

    const occluderMesh = new Mesh("terrain-occluder-mesh", this.scene);
    const occluderVertexData = new VertexData();
    occluderVertexData.positions = occluderPositions;
    occluderVertexData.indices = indices;
    occluderVertexData.normals = occluderNormals;
    occluderVertexData.applyToMesh(occluderMesh, false);

    occluderMesh.material = this.occluderMaterial;
    occluderMesh.isPickable = false;
    occluderMesh.renderingGroupId = 0;

    this.mesh = mesh;
    this.occluderMesh = occluderMesh;
    return mesh;
  }

  private sampleSlope(terrain: TerrainData, x: number, y: number): number {
    const left = terrain.heights[terrain.grid.index(Math.max(x - 1, 0), y)];
    const right = terrain.heights[terrain.grid.index(Math.min(x + 1, terrain.grid.width - 1), y)];
    const top = terrain.heights[terrain.grid.index(x, Math.max(y - 1, 0))];
    const bottom = terrain.heights[terrain.grid.index(x, Math.min(y + 1, terrain.grid.height - 1))];
    const dx = Math.abs(right - left);
    const dy = Math.abs(bottom - top);
    return Math.min(1, (dx + dy) / 10);
  }

  private getTerrainColor(elevation: number, slope: number): [number, number, number] {
    const low = [0.34, 0.23, 0.15] as const;
    const mids = [0.5, 0.35, 0.23] as const;
    const high = [0.64, 0.48, 0.33] as const;
    const peak = [0.78, 0.63, 0.47] as const;
    const rock = [0.3, 0.215, 0.15] as const;

    let r = 0;
    let g = 0;
    let b = 0;

    if (elevation < 0.35) {
      const t = elevation / 0.35;
      r = lerp(low[0], mids[0], t);
      g = lerp(low[1], mids[1], t);
      b = lerp(low[2], mids[2], t);
    } else if (elevation < 0.72) {
      const t = (elevation - 0.35) / 0.37;
      r = lerp(mids[0], high[0], t);
      g = lerp(mids[1], high[1], t);
      b = lerp(mids[2], high[2], t);
    } else {
      const t = (elevation - 0.72) / 0.28;
      r = lerp(high[0], peak[0], t);
      g = lerp(high[1], peak[1], t);
      b = lerp(high[2], peak[2], t);
    }

    // Steeper faces read as darker rock, while flatter areas keep warmer dustier tones.
    const rockBlend = Math.min(1, slope * 1.35);
    r = lerp(r, rock[0], rockBlend);
    g = lerp(g, rock[1], rockBlend);
    b = lerp(b, rock[2], rockBlend);

    const shade = 1 - slope * 0.14;
    return [r * shade, g * shade, b * shade];
  }
}
