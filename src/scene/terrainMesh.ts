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
  private mesh: Mesh | null = null;

  public constructor(scene: Scene) {
    this.scene = scene;
    this.material = new StandardMaterial("terrain-material", scene);
    this.material.specularColor = Color3.Black();
    this.material.diffuseColor = Color3.White();
  }

  public rebuild(terrain: TerrainData): Mesh {
    this.mesh?.dispose();

    const width = terrain.grid.width;
    const height = terrain.grid.height;
    const cellSize = terrain.cellSize;
    const halfWidth = (width - 1) * cellSize * 0.5;
    const halfHeight = (height - 1) * cellSize * 0.5;

    const positions = new Float32Array(width * height * 3);
    const colors = new Float32Array(width * height * 4);
    const indices = new Uint32Array((width - 1) * (height - 1) * 6);

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

    const normals: number[] = [];
    VertexData.ComputeNormals(Array.from(positions), Array.from(indices), normals);

    const mesh = new Mesh("terrain-mesh", this.scene);
    const vertexData = new VertexData();
    vertexData.positions = Array.from(positions);
    vertexData.indices = Array.from(indices);
    vertexData.normals = normals;
    vertexData.colors = Array.from(colors);
    vertexData.applyToMesh(mesh, false);

    mesh.material = this.material;
    mesh.receiveShadows = false;
    mesh.isPickable = false;
    mesh.useVertexColors = true;

    this.mesh = mesh;
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
    const low = [0.19, 0.34, 0.2] as const;
    const mids = [0.43, 0.56, 0.31] as const;
    const high = [0.53, 0.47, 0.38] as const;
    const peak = [0.78, 0.76, 0.7] as const;

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

    const shade = 1 - slope * 0.22;
    return [r * shade, g * shade, b * shade];
  }
}
