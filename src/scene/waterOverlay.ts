import {
  Color3,
  Mesh,
  StandardMaterial,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { PlantDiagnosticOverlayMode } from "../sim/PlantDiagnostics";
import type { TerrainData } from "../sim/Terrain";
import { clamp, lerp } from "../utils/math";

export type ClimateOverlayMode =
  | "none"
  | "mean_temperature"
  | "rainfall"
  | "seasonality"
  | "evaporation";

export interface WaterOverlayViewOptions {
  showRivers: boolean;
  showWaterDepth: boolean;
  showMoisture: boolean;
  showTemperature: boolean;
  showSeason: boolean;
  showVegetation: boolean;
  climateOverlay: ClimateOverlayMode;
  plantDiagnosticOverlay: PlantDiagnosticOverlayMode;
}

/**
 * Water rendering is split into two derived visual layers:
 * - a continuous surface layer for wet ground, puddles, and lakes
 * - a compact river-strip layer for connected channel flow
 *
 * This keeps the hydrology solver unchanged while making the scene easier to
 * read. Lakes are smoothed into calmer connected surfaces, while rivers use a
 * dedicated directional overlay so channels read as paths rather than isolated
 * blue spots.
 */
export class WaterOverlayRenderer {
  private readonly scene: Scene;
  private readonly surfaceMaterial: StandardMaterial;
  private readonly bodyMaterial: StandardMaterial;
  private readonly riverMaterial: StandardMaterial;

  private surfaceMesh: Mesh | null = null;
  private bodyMesh: Mesh | null = null;
  private riverMesh: Mesh | null = null;

  private surfacePositions = new Float32Array();
  private surfaceColors = new Float32Array();
  private surfaceIndices: number[] = [];
  private bodyPositions = new Float32Array();
  private bodyColors = new Float32Array();
  private bodyIndices: number[] = [];
  private topLayerIndices: number[] = [];
  private bottomLayerIndices: number[] = [];
  private cellVisible = new Uint8Array();
  private cellShellVisible = new Uint8Array();

  private riverPositions = new Float32Array();
  private riverColors = new Float32Array();
  private riverCapacity = 0;
  private activeRiverQuads = 0;

  private smoothedDepth = new Float32Array();
  private smoothedFlow = new Float32Array();
  private surfaceHeights = new Float32Array();
  private smoothedSurfaceHeights = new Float32Array();
  private renderedSurfaceHeights = new Float32Array();

  public constructor(scene: Scene) {
    this.scene = scene;

    this.surfaceMaterial = new StandardMaterial("water-surface-material", scene);
    this.surfaceMaterial.specularColor = Color3.Black();
    this.surfaceMaterial.diffuseColor = Color3.White();
    this.surfaceMaterial.emissiveColor = new Color3(0.03, 0.12, 0.22);
    this.surfaceMaterial.alpha = 1;
    this.surfaceMaterial.backFaceCulling = false;
    this.surfaceMaterial.disableLighting = true;
    this.surfaceMaterial.needDepthPrePass = true;
    this.surfaceMaterial.separateCullingPass = true;

    // The body layer sits just below the visible surface and provides the
    // actual "water volume" tint that should read through the transparent top.
    // Keeping it as a dedicated mesh makes the surface and subsurface roles
    // explicit and easier to tune independently.
    this.bodyMaterial = new StandardMaterial("water-body-material", scene);
    this.bodyMaterial.specularColor = Color3.Black();
    this.bodyMaterial.diffuseColor = Color3.White();
    this.bodyMaterial.emissiveColor = new Color3(0.04, 0.24, 0.44);
    this.bodyMaterial.alpha = 1;
    this.bodyMaterial.backFaceCulling = false;
    this.bodyMaterial.disableLighting = true;
    this.bodyMaterial.needDepthPrePass = true;
    this.bodyMaterial.separateCullingPass = true;

    this.riverMaterial = new StandardMaterial("river-channel-material", scene);
    this.riverMaterial.specularColor = Color3.Black();
    this.riverMaterial.diffuseColor = Color3.White();
    this.riverMaterial.emissiveColor = new Color3(0.08, 0.28, 0.42);
    this.riverMaterial.alpha = 1;
    this.riverMaterial.backFaceCulling = false;
    this.riverMaterial.disableLighting = true;
    this.riverMaterial.needDepthPrePass = true;
    this.riverMaterial.separateCullingPass = true;
  }

  public rebuild(terrain: TerrainData): void {
    this.surfaceMesh?.dispose();
    this.bodyMesh?.dispose();
    this.riverMesh?.dispose();

    const width = terrain.grid.width;
    const height = terrain.grid.height;
    const cellSize = terrain.cellSize;
    const halfWidth = (width - 1) * cellSize * 0.5;
    const halfHeight = (height - 1) * cellSize * 0.5;
    const vertexCount = terrain.grid.cellCount;
    const layeredVertexCount = vertexCount * 2;
    const riverQuadCount = terrain.grid.cellCount;

    this.surfacePositions = new Float32Array(layeredVertexCount * 3);
    this.surfaceColors = new Float32Array(layeredVertexCount * 4);
    this.surfaceIndices = [];
    this.bodyPositions = new Float32Array(layeredVertexCount * 3);
    this.bodyColors = new Float32Array(layeredVertexCount * 4);
    this.bodyIndices = [];
    this.topLayerIndices = [];
    this.bottomLayerIndices = [];
    this.cellVisible = new Uint8Array((width - 1) * (height - 1));
    this.cellShellVisible = new Uint8Array((width - 1) * (height - 1));

    this.smoothedDepth = new Float32Array(vertexCount);
    this.smoothedFlow = new Float32Array(vertexCount);
    this.surfaceHeights = new Float32Array(vertexCount);
    this.smoothedSurfaceHeights = new Float32Array(vertexCount);
    this.renderedSurfaceHeights = new Float32Array(vertexCount);

    const surfaceNormals = new Float32Array(layeredVertexCount * 3);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const vertexIndex = terrain.grid.index(x, y);
        const topOffset = vertexIndex * 3;
        const bottomIndex = vertexIndex + vertexCount;
        const bottomOffset = bottomIndex * 3;
        const worldX = x * cellSize - halfWidth;
        const worldZ = y * cellSize - halfHeight;

        this.surfacePositions[topOffset] = worldX;
        this.surfacePositions[topOffset + 1] = terrain.heights[vertexIndex] + 0.03;
        this.surfacePositions[topOffset + 2] = worldZ;

        this.bodyPositions[topOffset] = worldX;
        this.bodyPositions[topOffset + 1] = terrain.heights[vertexIndex] + 0.022;
        this.bodyPositions[topOffset + 2] = worldZ;

        this.surfacePositions[bottomOffset] = worldX;
        this.surfacePositions[bottomOffset + 1] = terrain.heights[vertexIndex] + 0.015;
        this.surfacePositions[bottomOffset + 2] = worldZ;

        this.bodyPositions[bottomOffset] = worldX;
        this.bodyPositions[bottomOffset + 1] = terrain.heights[vertexIndex] + 0.008;
        this.bodyPositions[bottomOffset + 2] = worldZ;

        surfaceNormals[topOffset] = 0;
        surfaceNormals[topOffset + 1] = 1;
        surfaceNormals[topOffset + 2] = 0;

        surfaceNormals[bottomOffset] = 0;
        surfaceNormals[bottomOffset + 1] = -1;
        surfaceNormals[bottomOffset + 2] = 0;
      }
    }

    for (let y = 0; y < height - 1; y += 1) {
      for (let x = 0; x < width - 1; x += 1) {
        const topLeft = terrain.grid.index(x, y);
        const topRight = terrain.grid.index(x + 1, y);
        const bottomLeft = terrain.grid.index(x, y + 1);
        const bottomRight = terrain.grid.index(x + 1, y + 1);

        // Keep the water top layers continuous across the whole grid. Dry
        // vertices carry zero alpha, so the surface fades out smoothly instead
        // of breaking into cell-shaped cutouts.
        this.topLayerIndices.push(
          topLeft,
          bottomLeft,
          topRight,
          topRight,
          bottomLeft,
          bottomRight,
        );

        const bodyTopLeft = topLeft + vertexCount;
        const bodyTopRight = topRight + vertexCount;
        const bodyBottomLeft = bottomLeft + vertexCount;
        const bodyBottomRight = bottomRight + vertexCount;
        this.bottomLayerIndices.push(
          bodyTopLeft,
          bodyTopRight,
          bodyBottomLeft,
          bodyTopRight,
          bodyBottomRight,
          bodyBottomLeft,
        );
      }
    }

    const surfaceMesh = new Mesh("water-surface-mesh", this.scene);
    const surfaceVertexData = new VertexData();
    surfaceVertexData.positions = Array.from(this.surfacePositions);
    surfaceVertexData.indices = [];
    surfaceVertexData.normals = Array.from(surfaceNormals);
    surfaceVertexData.colors = Array.from(this.surfaceColors);
    surfaceVertexData.applyToMesh(surfaceMesh, true);

    surfaceMesh.material = this.surfaceMaterial;
    surfaceMesh.renderingGroupId = 2;
    surfaceMesh.isPickable = false;
    surfaceMesh.useVertexColors = true;
    surfaceMesh.hasVertexAlpha = true;
    this.surfaceMesh = surfaceMesh;

    const bodyMesh = new Mesh("water-body-mesh", this.scene);
    const bodyVertexData = new VertexData();
    bodyVertexData.positions = Array.from(this.bodyPositions);
    bodyVertexData.indices = [];
    bodyVertexData.normals = Array.from(surfaceNormals);
    bodyVertexData.colors = Array.from(this.bodyColors);
    bodyVertexData.applyToMesh(bodyMesh, true);

    bodyMesh.material = this.bodyMaterial;
    bodyMesh.renderingGroupId = 1;
    bodyMesh.isPickable = false;
    bodyMesh.useVertexColors = true;
    bodyMesh.hasVertexAlpha = true;
    this.bodyMesh = bodyMesh;

    this.riverCapacity = riverQuadCount;
    this.activeRiverQuads = 0;
    this.riverPositions = new Float32Array(riverQuadCount * 4 * 3);
    this.riverColors = new Float32Array(riverQuadCount * 4 * 4);
    const riverNormals = new Float32Array(riverQuadCount * 4 * 3);
    const riverIndices = new Uint32Array(riverQuadCount * 6);

    for (let quadIndex = 0; quadIndex < riverQuadCount; quadIndex += 1) {
      const vertexBase = quadIndex * 4;
      const indexBase = quadIndex * 6;

      riverIndices[indexBase] = vertexBase;
      riverIndices[indexBase + 1] = vertexBase + 1;
      riverIndices[indexBase + 2] = vertexBase + 2;
      riverIndices[indexBase + 3] = vertexBase + 2;
      riverIndices[indexBase + 4] = vertexBase + 1;
      riverIndices[indexBase + 5] = vertexBase + 3;

      for (let vertexOffset = 0; vertexOffset < 4; vertexOffset += 1) {
        const normalOffset = (vertexBase + vertexOffset) * 3;
        riverNormals[normalOffset] = 0;
        riverNormals[normalOffset + 1] = 1;
        riverNormals[normalOffset + 2] = 0;
      }
    }

    const riverMesh = new Mesh("river-channel-mesh", this.scene);
    const riverVertexData = new VertexData();
    riverVertexData.positions = Array.from(this.riverPositions);
    riverVertexData.indices = Array.from(riverIndices);
    riverVertexData.normals = Array.from(riverNormals);
    riverVertexData.colors = Array.from(this.riverColors);
    riverVertexData.applyToMesh(riverMesh, true);

    riverMesh.material = this.riverMaterial;
    riverMesh.renderingGroupId = 3;
    riverMesh.isPickable = false;
    riverMesh.useVertexColors = true;
    riverMesh.hasVertexAlpha = true;
    this.riverMesh = riverMesh;
  }

  public update(
    terrain: TerrainData,
    waterDepth: Float32Array,
    flowAccumulation: Float32Array,
    options: WaterOverlayViewOptions,
  ): void {
    if (!this.surfaceMesh || !this.bodyMesh || !this.riverMesh) {
      return;
    }

    const visible = options.showRivers || options.showWaterDepth;
    this.surfaceMesh.setEnabled(visible);
    this.bodyMesh.setEnabled(visible);
    this.riverMesh.setEnabled(options.showRivers);

    if (!visible) {
      return;
    }

    const vertexCount = terrain.grid.cellCount;
    const cellsPerRow = terrain.grid.width - 1;

    for (let index = 0; index < vertexCount; index += 1) {
      this.surfaceHeights[index] = terrain.heights[index] + waterDepth[index];
    }

    this.blurField(terrain, waterDepth, this.smoothedDepth);
    this.blurField(terrain, flowAccumulation, this.smoothedFlow);
    this.blurField(terrain, this.surfaceHeights, this.smoothedSurfaceHeights);

    this.surfaceIndices = this.topLayerIndices.slice();
    this.bodyIndices = this.topLayerIndices.slice();
    this.bodyIndices.push(...this.bottomLayerIndices);

    for (let index = 0; index < vertexCount; index += 1) {
      const actualDepth = waterDepth[index];
      const actualFlow = flowAccumulation[index];
      const smoothedDepth = this.smoothedDepth[index];
      const smoothedSurface = this.smoothedSurfaceHeights[index];
      const actualSurface = this.surfaceHeights[index];

      const wetGroundFactor = options.showWaterDepth
        ? clamp((actualDepth - 0.002) / 0.012, 0, 1)
        : 0;
      const puddleFactor = options.showWaterDepth
        ? clamp((actualDepth - 0.012) / 0.05, 0, 1)
        : 0;
      const streamFactor = options.showRivers
        ? clamp((Math.log1p(actualFlow) - 4.8) / 2.2, 0, 1) *
          clamp((actualDepth - 0.003) / 0.03, 0, 1)
        : 0;
      const riverFactor = options.showRivers
        ? clamp((Math.log1p(actualFlow) - 6.2) / 1.7, 0, 1) *
          clamp((actualDepth - 0.006) / 0.05, 0, 1)
        : 0;
      const lakeFactor = options.showWaterDepth
        ? clamp((actualDepth - 0.03) / 0.12, 0, 1) * (1 - streamFactor * 0.7)
        : 0;
      const depthBodyFactor = options.showWaterDepth
        ? clamp((actualDepth - 0.01) / 0.1, 0, 1)
        : 0;

      const bodyStrength = Math.max(
        wetGroundFactor * 0.28,
        puddleFactor * 0.5,
        lakeFactor,
        streamFactor * 0.34,
      );

      const surfaceTarget = lerp(
        actualSurface,
        Math.max(actualSurface - actualDepth * 0.18, smoothedSurface),
        clamp(lakeFactor * 0.82 + puddleFactor * 0.22, 0, 0.88),
      );
      const renderedDepth = Math.max(actualDepth * 0.7, surfaceTarget - terrain.heights[index], smoothedDepth * 0.74);
      const topSurfaceY = terrain.heights[index] + renderedDepth + 0.008;
      const shellThickness = clamp(
        0.01 + puddleFactor * 0.014 + lakeFactor * 0.022 + depthBodyFactor * 0.012,
        0.01,
        0.04,
      );
      const bottomSurfaceY = topSurfaceY - shellThickness;

      this.renderedSurfaceHeights[index] = topSurfaceY;
      this.surfacePositions[index * 3 + 1] = topSurfaceY;
      this.surfacePositions[(index + vertexCount) * 3 + 1] = bottomSurfaceY;
      const bodyTopY = Math.max(terrain.heights[index] + 0.004, topSurfaceY - shellThickness * 0.72);
      const bodyBottomY = Math.max(terrain.heights[index] + 0.001, topSurfaceY - shellThickness * 1.16);
      this.bodyPositions[index * 3 + 1] = bodyTopY;
      this.bodyPositions[(index + vertexCount) * 3 + 1] = bodyBottomY;

      if (bodyStrength < 0.045) {
        this.clearSurfaceVertex(index, vertexCount);
        this.clearBodyVertex(index);
        continue;
      }

      const surfaceTint = clamp(
        wetGroundFactor * 0.08 + puddleFactor * 0.18 + lakeFactor * 0.28 + depthBodyFactor * 0.1,
        0,
        1,
      );
      const bodyBlue = lerp(0.12, 0.3, surfaceTint);
      const bodyGreen = lerp(0.065, 0.14, surfaceTint);
      const bodyRed = lerp(0.094, 0.07, surfaceTint);
      const bodyAlpha = clamp(
        wetGroundFactor * 0.025 +
          puddleFactor * 0.05 +
          lakeFactor * 0.08 +
          streamFactor * 0.02 +
          depthBodyFactor * 0.05,
        0.015,
        0.12,
      );

      this.writeSurfaceVertex(
        index,
        vertexCount,
        bodyRed,
        bodyGreen,
        bodyBlue,
        bodyAlpha,
      );
      this.writeBodyVertex(index, bodyRed, bodyGreen, bodyBlue, actualDepth, depthBodyFactor, lakeFactor);
    }

    let cellIndex = 0;

    for (let y = 0; y < terrain.grid.height - 1; y += 1) {
      for (let x = 0; x < terrain.grid.width - 1; x += 1) {
        const topLeft = terrain.grid.index(x, y);
        const topRight = terrain.grid.index(x + 1, y);
        const bottomLeft = terrain.grid.index(x, y + 1);
        const bottomRight = terrain.grid.index(x + 1, y + 1);

        const cellAlpha = Math.max(
          this.surfaceColors[topLeft * 4 + 3],
          this.surfaceColors[topRight * 4 + 3],
          this.surfaceColors[bottomLeft * 4 + 3],
          this.surfaceColors[bottomRight * 4 + 3],
        );
        const shellAlpha = Math.min(
          1,
          Math.max(
            this.surfaceColors[topLeft * 4 + 3],
            this.surfaceColors[topRight * 4 + 3],
            this.surfaceColors[bottomLeft * 4 + 3],
            this.surfaceColors[bottomRight * 4 + 3],
          ),
        );

        const isVisible = cellAlpha >= 0.055;
        this.cellVisible[cellIndex] = isVisible ? 1 : 0;
        this.cellShellVisible[cellIndex] = shellAlpha >= 0.16 ? 1 : 0;

        cellIndex += 1;
      }
    }

    this.appendBoundarySideFaces(this.surfaceIndices, terrain, vertexCount, cellsPerRow);
    this.appendBoundarySideFaces(this.bodyIndices, terrain, vertexCount, cellsPerRow);
    this.surfaceMesh.updateVerticesData(VertexBuffer.PositionKind, this.surfacePositions, false, false);
    this.surfaceMesh.updateVerticesData(VertexBuffer.ColorKind, this.surfaceColors, false, false);
    this.surfaceMesh.setIndices(this.surfaceIndices, undefined, true);
    this.bodyMesh.updateVerticesData(VertexBuffer.PositionKind, this.bodyPositions, false, false);
    this.bodyMesh.updateVerticesData(VertexBuffer.ColorKind, this.bodyColors, false, false);
    this.bodyMesh.setIndices(this.bodyIndices, undefined, true);

    this.updateRiverLayer(terrain, waterDepth, flowAccumulation, options);
  }

  private appendBoundarySideFaces(
    targetIndices: number[],
    terrain: TerrainData,
    vertexCount: number,
    cellsPerRow: number,
  ): void {
    let cellIndex = 0;

    for (let y = 0; y < terrain.grid.height - 1; y += 1) {
      for (let x = 0; x < terrain.grid.width - 1; x += 1) {
        const isVisible = this.cellVisible[cellIndex] === 1;
        const isShellVisible = this.cellShellVisible[cellIndex] === 1;

        if (!isVisible) {
          cellIndex += 1;
          continue;
        }

        const topLeft = terrain.grid.index(x, y);
        const topRight = terrain.grid.index(x + 1, y);
        const bottomLeft = terrain.grid.index(x, y + 1);
        const bottomRight = terrain.grid.index(x + 1, y + 1);

        const leftNeighborVisible = x > 0 && this.cellShellVisible[cellIndex - 1] === 1;
        const topNeighborVisible = y > 0 && this.cellShellVisible[cellIndex - cellsPerRow] === 1;

        if (isShellVisible && !leftNeighborVisible) {
          this.pushSideQuad(targetIndices, topLeft, bottomLeft, vertexCount);
        }

        if (isShellVisible && !topNeighborVisible) {
          this.pushSideQuad(targetIndices, topLeft, topRight, vertexCount);
        }

        if (isShellVisible && x === terrain.grid.width - 2) {
          this.pushSideQuad(targetIndices, topRight, bottomRight, vertexCount);
        }

        if (isShellVisible && y === terrain.grid.height - 2) {
          this.pushSideQuad(targetIndices, bottomLeft, bottomRight, vertexCount);
        }

        cellIndex += 1;
      }
    }

    for (let y = 0; y < terrain.grid.height - 1; y += 1) {
      for (let x = 0; x < terrain.grid.width - 2; x += 1) {
        const currentCell = y * cellsPerRow + x;
        const rightCell = currentCell + 1;

        if (this.cellShellVisible[currentCell] === 1 && this.cellShellVisible[rightCell] === 0) {
          const topRight = terrain.grid.index(x + 1, y);
          const bottomRight = terrain.grid.index(x + 1, y + 1);
          this.pushSideQuad(targetIndices, topRight, bottomRight, vertexCount);
        }
      }
    }

    for (let y = 0; y < terrain.grid.height - 2; y += 1) {
      for (let x = 0; x < terrain.grid.width - 1; x += 1) {
        const currentCell = y * cellsPerRow + x;
        const bottomCell = currentCell + cellsPerRow;

        if (this.cellShellVisible[currentCell] === 1 && this.cellShellVisible[bottomCell] === 0) {
          const bottomLeft = terrain.grid.index(x, y + 1);
          const bottomRight = terrain.grid.index(x + 1, y + 1);
          this.pushSideQuad(targetIndices, bottomLeft, bottomRight, vertexCount);
        }
      }
    }
  }

  private updateRiverLayer(
    terrain: TerrainData,
    waterDepth: Float32Array,
    flowAccumulation: Float32Array,
    options: WaterOverlayViewOptions,
  ): void {
    if (!this.riverMesh) {
      return;
    }

    if (!options.showRivers) {
      this.hideUnusedRiverQuads(0);
      this.activeRiverQuads = 0;
      this.riverMesh.updateVerticesData(VertexBuffer.PositionKind, this.riverPositions, false, false);
      this.riverMesh.updateVerticesData(VertexBuffer.ColorKind, this.riverColors, false, false);
      return;
    }

    let riverQuadIndex = 0;

    for (let y = 1; y < terrain.grid.height - 1; y += 1) {
      for (let x = 1; x < terrain.grid.width - 1; x += 1) {
        const index = terrain.grid.index(x, y);
        const depth = waterDepth[index];
        const flow = flowAccumulation[index];
        const streamFactor =
          clamp((Math.log1p(flow) - 5.45) / 1.65, 0, 1) * clamp((depth - 0.005) / 0.03, 0, 1);
        const riverFactor =
          clamp((Math.log1p(flow) - 6.7) / 1.25, 0, 1) * clamp((depth - 0.01) / 0.055, 0, 1);
        const channelStrength = Math.max(streamFactor * 0.72, riverFactor);
        const lakeLikeDepth = clamp((depth - 0.035) / 0.08, 0, 1);

        if (
          channelStrength < 0.22 ||
          lakeLikeDepth > 0.72 ||
          riverQuadIndex >= this.riverCapacity ||
          !this.isLocalChannelCore(terrain, x, y, flowAccumulation)
        ) {
          continue;
        }

        const direction = this.sampleFlowDirection(terrain, x, y);
        if (direction.dx === 0 && direction.dz === 0) {
          continue;
        }

        const centerX = this.surfacePositions[index * 3];
        const centerZ = this.surfacePositions[index * 3 + 2];
        const centerY = this.renderedSurfaceHeights[index] + 0.01;
        const riverWidth = terrain.cellSize * (0.035 + streamFactor * 0.05 + riverFactor * 0.1);
        const riverLength = terrain.cellSize * (0.42 + streamFactor * 0.2 + riverFactor * 0.28);

        this.writeRiverQuad(
          riverQuadIndex,
          centerX,
          centerY,
          centerZ,
          direction.dx,
          direction.dz,
          riverLength,
          riverWidth,
          streamFactor,
          riverFactor,
        );
        riverQuadIndex += 1;
      }
    }

    this.hideUnusedRiverQuads(riverQuadIndex);
    this.activeRiverQuads = riverQuadIndex;

    this.riverMesh.updateVerticesData(VertexBuffer.PositionKind, this.riverPositions, false, false);
    this.riverMesh.updateVerticesData(VertexBuffer.ColorKind, this.riverColors, false, false);
  }

  private sampleFlowDirection(terrain: TerrainData, x: number, y: number): { dx: number; dz: number } {
    const centerIndex = terrain.grid.index(x, y);
    const centerSurface = this.surfaceHeights[centerIndex];
    let bestDrop = 0;
    let bestDx = 0;
    let bestDz = 0;

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) {
          continue;
        }

        const sampleX = x + offsetX;
        const sampleY = y + offsetY;
        if (!terrain.grid.isInside(sampleX, sampleY)) {
          continue;
        }

        const sampleIndex = terrain.grid.index(sampleX, sampleY);
        const sampleSurface = this.surfaceHeights[sampleIndex];
        const drop = centerSurface - sampleSurface;

        if (drop <= bestDrop) {
          continue;
        }

        bestDrop = drop;
        bestDx = offsetX;
        bestDz = offsetY;
      }
    }

    if (bestDrop <= 0) {
      return { dx: 0, dz: 0 };
    }

    const length = Math.hypot(bestDx, bestDz);
    return {
      dx: bestDx / length,
      dz: bestDz / length,
    };
  }

  private writeRiverQuad(
    quadIndex: number,
    centerX: number,
    centerY: number,
    centerZ: number,
    dx: number,
    dz: number,
    length: number,
    width: number,
    streamFactor: number,
    riverFactor: number,
  ): void {
    const tangentX = dx;
    const tangentZ = dz;
    const normalX = -tangentZ;
    const normalZ = tangentX;
    const halfLength = length * 0.5;
    const halfWidth = width * 0.5;

    const startX = centerX - tangentX * halfLength;
    const startZ = centerZ - tangentZ * halfLength;
    const endX = centerX + tangentX * halfLength;
    const endZ = centerZ + tangentZ * halfLength;

    const leftStartX = startX - normalX * halfWidth;
    const leftStartZ = startZ - normalZ * halfWidth;
    const rightStartX = startX + normalX * halfWidth;
    const rightStartZ = startZ + normalZ * halfWidth;
    const leftEndX = endX - normalX * halfWidth;
    const leftEndZ = endZ - normalZ * halfWidth;
    const rightEndX = endX + normalX * halfWidth;
    const rightEndZ = endZ + normalZ * halfWidth;

    const baseVertex = quadIndex * 4;

    this.writeRiverVertex(baseVertex, leftStartX, centerY, leftStartZ, streamFactor, riverFactor);
    this.writeRiverVertex(baseVertex + 1, rightStartX, centerY, rightStartZ, streamFactor, riverFactor);
    this.writeRiverVertex(baseVertex + 2, leftEndX, centerY, leftEndZ, streamFactor, riverFactor);
    this.writeRiverVertex(baseVertex + 3, rightEndX, centerY, rightEndZ, streamFactor, riverFactor);
  }

  private writeRiverVertex(
    vertexIndex: number,
    x: number,
    y: number,
    z: number,
    streamFactor: number,
    riverFactor: number,
  ): void {
    const positionOffset = vertexIndex * 3;
    const colorOffset = vertexIndex * 4;
    const majorRiverFactor = Math.max(streamFactor * 0.6, riverFactor);

    this.riverPositions[positionOffset] = x;
    this.riverPositions[positionOffset + 1] = y;
    this.riverPositions[positionOffset + 2] = z;

    this.riverColors[colorOffset] = lerp(0.01, 0.03, majorRiverFactor);
    this.riverColors[colorOffset + 1] = lerp(0.24, 0.44, majorRiverFactor);
    this.riverColors[colorOffset + 2] = lerp(0.62, 0.94, majorRiverFactor);
    this.riverColors[colorOffset + 3] = clamp(0.1 + streamFactor * 0.1 + riverFactor * 0.2, 0.1, 0.4);
  }

  private isLocalChannelCore(
    terrain: TerrainData,
    x: number,
    y: number,
    flowAccumulation: Float32Array,
  ): boolean {
    const centerIndex = terrain.grid.index(x, y);
    const centerFlow = flowAccumulation[centerIndex];
    let maxNeighborFlow = 0;

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) {
          continue;
        }

        const sampleIndex = terrain.grid.index(x + offsetX, y + offsetY);
        maxNeighborFlow = Math.max(maxNeighborFlow, flowAccumulation[sampleIndex]);
      }
    }

    return centerFlow >= maxNeighborFlow * 0.94;
  }

  private hideUnusedRiverQuads(usedQuadCount: number): void {
    for (let quadIndex = usedQuadCount; quadIndex < this.activeRiverQuads; quadIndex += 1) {
      const baseVertex = quadIndex * 4;

      for (let vertexOffset = 0; vertexOffset < 4; vertexOffset += 1) {
        const positionOffset = (baseVertex + vertexOffset) * 3;
        const colorOffset = (baseVertex + vertexOffset) * 4;

        this.riverPositions[positionOffset] = 0;
        this.riverPositions[positionOffset + 1] = -10000;
        this.riverPositions[positionOffset + 2] = 0;

        this.riverColors[colorOffset] = 0;
        this.riverColors[colorOffset + 1] = 0;
        this.riverColors[colorOffset + 2] = 0;
        this.riverColors[colorOffset + 3] = 0;
      }
    }
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
                ? 0.36
                : offsetX === 0 || offsetY === 0
                  ? 0.11
                  : 0.04;

            valueSum += source[sampleIndex] * weight;
            weightSum += weight;
          }
        }

        target[terrain.grid.index(x, y)] = weightSum > 0 ? valueSum / weightSum : 0;
      }
    }
  }

  private pushSideQuad(targetIndices: number[], topA: number, topB: number, vertexCount: number): void {
    const bottomA = topA + vertexCount;
    const bottomB = topB + vertexCount;
    targetIndices.push(topA, bottomA, topB, topB, bottomA, bottomB);
  }

  private clearSurfaceVertex(index: number, vertexCount: number): void {
    const topOffset = index * 4;
    const bottomOffset = (index + vertexCount) * 4;

    this.surfaceColors[topOffset] = 0;
    this.surfaceColors[topOffset + 1] = 0;
    this.surfaceColors[topOffset + 2] = 0;
    this.surfaceColors[topOffset + 3] = 0;

    this.surfaceColors[bottomOffset] = 0;
    this.surfaceColors[bottomOffset + 1] = 0;
    this.surfaceColors[bottomOffset + 2] = 0;
    this.surfaceColors[bottomOffset + 3] = 0;
  }

  private clearBodyVertex(index: number): void {
    const topOffset = index * 4;
    const bottomOffset = (index + this.surfaceHeights.length) * 4;

    this.bodyColors[topOffset] = 0;
    this.bodyColors[topOffset + 1] = 0;
    this.bodyColors[topOffset + 2] = 0;
    this.bodyColors[topOffset + 3] = 0;

    this.bodyColors[bottomOffset] = 0;
    this.bodyColors[bottomOffset + 1] = 0;
    this.bodyColors[bottomOffset + 2] = 0;
    this.bodyColors[bottomOffset + 3] = 0;
  }

  private writeSurfaceVertex(
    index: number,
    vertexCount: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void {
    const topOffset = index * 4;
    const bottomOffset = (index + vertexCount) * 4;
    const submergedRed = lerp(r, 0.01, 0.97);
    const submergedGreen = lerp(g, 0.42, 0.98);
    const submergedBlue = lerp(b, 0.96, 0.992);
    const submergedAlpha = clamp(a * 2.1 + 0.28, 0.44, 0.86);

    this.surfaceColors[topOffset] = r;
    this.surfaceColors[topOffset + 1] = g;
    this.surfaceColors[topOffset + 2] = b;
    this.surfaceColors[topOffset + 3] = a;

    // The lower shell vertices drive the visible water body thickness and edge
    // faces. Bias them toward a fuller blue so side views read as water volume
    // instead of nearly transparent glass.
    this.surfaceColors[bottomOffset] = submergedRed;
    this.surfaceColors[bottomOffset + 1] = submergedGreen;
    this.surfaceColors[bottomOffset + 2] = submergedBlue;
    this.surfaceColors[bottomOffset + 3] = submergedAlpha;
  }

  private writeBodyVertex(
    index: number,
    r: number,
    g: number,
    b: number,
    depth: number,
    depthBodyFactor: number,
    lakeFactor: number,
  ): void {
    const topOffset = index * 4;
    const bottomOffset = (index + this.surfaceHeights.length) * 4;
    const bodyRed = lerp(r, 0.0, 0.992);
    const bodyGreen = lerp(g, 0.68, 0.995);
    const bodyBlue = lerp(b, 1, 0.999);
    const topAlpha = clamp(0.5 + depthBodyFactor * 0.58 + lakeFactor * 0.28 + depth * 0.24, 0.5, 0.94);
    const bottomAlpha = clamp(topAlpha + 0.34 + depthBodyFactor * 0.28, 0.74, 1);

    this.bodyColors[topOffset] = bodyRed;
    this.bodyColors[topOffset + 1] = bodyGreen;
    this.bodyColors[topOffset + 2] = bodyBlue;
    this.bodyColors[topOffset + 3] = topAlpha;

    this.bodyColors[bottomOffset] = lerp(bodyRed, 0.015, 0.35);
    this.bodyColors[bottomOffset + 1] = lerp(bodyGreen, 0.28, 0.22);
    this.bodyColors[bottomOffset + 2] = lerp(bodyBlue, 0.82, 0.12);
    this.bodyColors[bottomOffset + 3] = bottomAlpha;
  }
}
