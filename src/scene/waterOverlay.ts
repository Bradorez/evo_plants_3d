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
 * The water surface remains a shared-vertex mesh so it still reads as liquid.
 * To make it visible from shallow side angles, the renderer adds a very thin
 * underside layer plus side faces only along wet-region boundaries.
 * That keeps the extra geometry modest while avoiding the "hollow sheet" look.
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
  private cellVisible = new Uint8Array();

  public constructor(scene: Scene) {
    this.scene = scene;
    this.material = new StandardMaterial("water-overlay-material", scene);
    this.material.specularColor = Color3.Black();
    this.material.diffuseColor = Color3.White();
    this.material.emissiveColor = new Color3(0.035, 0.14, 0.24);
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
    const layeredVertexCount = vertexCount * 2;

    this.positions = new Float32Array(layeredVertexCount * 3);
    this.colors = new Float32Array(layeredVertexCount * 4);
    this.smoothedDepth = new Float32Array(vertexCount);
    this.smoothedFlow = new Float32Array(vertexCount);
    this.cellVisible = new Uint8Array((width - 1) * (height - 1));
    this.indexBuffer = [];

    const normals = new Float32Array(layeredVertexCount * 3);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const vertexIndex = terrain.grid.index(x, y);
        const topOffset = vertexIndex * 3;
        const bottomIndex = vertexIndex + vertexCount;
        const bottomOffset = bottomIndex * 3;
        const worldX = x * cellSize - halfWidth;
        const worldZ = y * cellSize - halfHeight;

        this.positions[topOffset] = worldX;
        this.positions[topOffset + 1] = terrain.heights[vertexIndex] + 0.05;
        this.positions[topOffset + 2] = worldZ;

        this.positions[bottomOffset] = worldX;
        this.positions[bottomOffset + 1] = terrain.heights[vertexIndex] + 0.02;
        this.positions[bottomOffset + 2] = worldZ;

        normals[topOffset] = 0;
        normals[topOffset + 1] = 1;
        normals[topOffset + 2] = 0;

        normals[bottomOffset] = 0;
        normals[bottomOffset + 1] = -1;
        normals[bottomOffset + 2] = 0;
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

    const vertexCount = terrain.grid.cellCount;
    const cellsPerRow = terrain.grid.width - 1;
    const topSurfaceOffset = 0.008;
    const minShellThickness = 0.02;
    const maxShellThickness = 0.05;

    this.blurField(terrain, waterDepth, this.smoothedDepth);
    this.blurField(terrain, flowAccumulation, this.smoothedFlow);
    this.indexBuffer.length = 0;

    for (let index = 0; index < terrain.grid.cellCount; index += 1) {
      const topOffset = index * 3;
      const bottomIndex = index + vertexCount;
      const bottomOffset = bottomIndex * 3;
      const topColorOffset = index * 4;
      const bottomColorOffset = bottomIndex * 4;

      const actualDepth = waterDepth[index];
      const actualFlow = flowAccumulation[index];
      const renderedDepth = this.smoothedDepth[index];
      const depthStrength = options.showWaterDepth
        ? clamp((actualDepth - 0.018) / 0.14, 0, 1)
        : 0;
      const riverStrength = options.showRivers
        ? clamp((Math.log1p(actualFlow) - 5.2) / 2.2, 0, 1) * clamp((actualDepth - 0.004) / 0.04, 0, 1)
        : 0;
      const visibleStrength = Math.max(depthStrength, riverStrength * 0.72);
      const waterLift = Math.max(actualDepth, renderedDepth * 0.92, riverStrength * 0.01);
      const shellThickness = clamp(waterLift * 0.34, minShellThickness, maxShellThickness);
      const topY = terrain.heights[index] + waterLift + topSurfaceOffset;
      const bottomY = topY - shellThickness;

      this.positions[topOffset + 1] = topY;
      this.positions[bottomOffset + 1] = bottomY;

      if (visibleStrength < 0.1) {
        this.clearVertexColor(topColorOffset);
        this.clearVertexColor(bottomColorOffset);
        continue;
      }

      const pooledStrength = Math.max(depthStrength, riverStrength * 0.7);
      const red = lerp(0.015, 0.04, riverStrength);
      const green = lerp(
        0.16,
        0.36,
        clamp(riverStrength * 0.76 + depthStrength * 0.2, 0, 1),
      );
      const blue = lerp(0.46, 0.9, clamp(pooledStrength * 0.94, 0, 1));
      const alpha = clamp(depthStrength * 0.44 + riverStrength * 0.22, 0.12, 0.48);

      this.writeVertexColor(topColorOffset, red, green, blue, alpha);
      this.writeVertexColor(
        bottomColorOffset,
        red * 0.58,
        green * 0.68,
        blue * 0.78,
        alpha * 0.96,
      );
    }

    let cellIndex = 0;

    for (let y = 0; y < terrain.grid.height - 1; y += 1) {
      for (let x = 0; x < terrain.grid.width - 1; x += 1) {
        const topLeft = terrain.grid.index(x, y);
        const topRight = terrain.grid.index(x + 1, y);
        const bottomLeft = terrain.grid.index(x, y + 1);
        const bottomRight = terrain.grid.index(x + 1, y + 1);

        const cellVisibleStrength = Math.max(
          this.colors[topLeft * 4 + 3],
          this.colors[topRight * 4 + 3],
          this.colors[bottomLeft * 4 + 3],
          this.colors[bottomRight * 4 + 3],
        );

        const isVisible = cellVisibleStrength >= 0.09;
        this.cellVisible[cellIndex] = isVisible ? 1 : 0;

        if (!isVisible) {
          cellIndex += 1;
          continue;
        }

        this.indexBuffer.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
        this.indexBuffer.push(
          topLeft + vertexCount,
          topRight + vertexCount,
          bottomLeft + vertexCount,
          topRight + vertexCount,
          bottomRight + vertexCount,
          bottomLeft + vertexCount,
        );

        const leftNeighborVisible = x > 0 && this.cellVisible[cellIndex - 1] === 1;
        const topNeighborVisible = y > 0 && this.cellVisible[cellIndex - cellsPerRow] === 1;

        if (!leftNeighborVisible) {
          this.pushSideQuad(topLeft, bottomLeft, vertexCount);
        }

        if (!topNeighborVisible) {
          this.pushSideQuad(topLeft, topRight, vertexCount);
        }

        if (x === terrain.grid.width - 2) {
          this.pushSideQuad(topRight, bottomRight, vertexCount);
        }

        if (y === terrain.grid.height - 2) {
          this.pushSideQuad(bottomLeft, bottomRight, vertexCount);
        }

        cellIndex += 1;
      }
    }

    for (let y = 0; y < terrain.grid.height - 1; y += 1) {
      for (let x = 0; x < terrain.grid.width - 2; x += 1) {
        const currentCell = y * cellsPerRow + x;
        const rightCell = currentCell + 1;

        if (this.cellVisible[currentCell] === 1 && this.cellVisible[rightCell] === 0) {
          const topRight = terrain.grid.index(x + 1, y);
          const bottomRight = terrain.grid.index(x + 1, y + 1);
          this.pushSideQuad(topRight, bottomRight, vertexCount);
        }
      }
    }

    for (let y = 0; y < terrain.grid.height - 2; y += 1) {
      for (let x = 0; x < terrain.grid.width - 1; x += 1) {
        const currentCell = y * cellsPerRow + x;
        const bottomCell = currentCell + cellsPerRow;

        if (this.cellVisible[currentCell] === 1 && this.cellVisible[bottomCell] === 0) {
          const bottomLeft = terrain.grid.index(x, y + 1);
          const bottomRight = terrain.grid.index(x + 1, y + 1);
          this.pushSideQuad(bottomLeft, bottomRight, vertexCount);
        }
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

  private pushSideQuad(topA: number, topB: number, vertexCount: number): void {
    const bottomA = topA + vertexCount;
    const bottomB = topB + vertexCount;
    this.indexBuffer.push(topA, bottomA, topB, topB, bottomA, bottomB);
  }

  private clearVertexColor(offset: number): void {
    this.colors[offset] = 0;
    this.colors[offset + 1] = 0;
    this.colors[offset + 2] = 0;
    this.colors[offset + 3] = 0;
  }

  private writeVertexColor(offset: number, r: number, g: number, b: number, a: number): void {
    this.colors[offset] = r;
    this.colors[offset + 1] = g;
    this.colors[offset + 2] = b;
    this.colors[offset + 3] = a;
  }
}
