import {
  Color3,
  Mesh,
  StandardMaterial,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { TerrainData } from "../sim/Terrain";
import {
  VEGETATION_PROFILE_DRYLAND,
  VEGETATION_PROFILE_MESIC,
  VEGETATION_PROFILE_NONE,
  VEGETATION_PROFILE_WETLAND,
} from "../sim/Vegetation";
import { clamp, inverseLerp, lerp } from "../utils/math";

/**
 * TerrainMeshRenderer owns the visible terrain volume and the hidden depth
 * occluder used against transparent water. The terrain geometry is generated
 * once per seed, but its colors and a very small render-only channel shaping
 * pass are updated over time from hydrology outputs.
 *
 * The important design choice is that terrain-water coupling stays derived and
 * reversible:
 * - the simulation terrain heightmap is never mutated
 * - wetness and channel masks live only in the renderer
 * - persistent flow leaves visual memory, not destructive erosion
 * - vegetation is treated as another derived ecological field layered on top
 */
export class TerrainMeshRenderer {
  private readonly scene: Scene;
  private readonly material: StandardMaterial;
  private readonly occluderMaterial: StandardMaterial;
  private readonly occluderLift = 0.035;
  private readonly maxChannelIncision = 0.18;

  private mesh: Mesh | null = null;
  private occluderMesh: Mesh | null = null;
  private bottomY = 0;

  private topVertexCount = 0;
  private perimeterTopStart = 0;
  private perimeterBottomStart = 0;
  private perimeterLength = 0;

  private basePositions = new Float32Array();
  private dynamicPositions = new Float32Array();
  private occluderPositions = new Float32Array();
  private baseColors = new Float32Array();
  private dynamicColors = new Float32Array();
  private readonly indices: number[] = [];

  private baseTopHeights = new Float32Array();
  private elevationField = new Float32Array();
  private slopeField = new Float32Array();
  private topToPerimeterCopy = new Int32Array();

  private waterSignal = new Float32Array();
  private nearbyWater = new Float32Array();
  private flowSignal = new Float32Array();
  private blurredFlowSignal = new Float32Array();
  private persistentChannelMask = new Float32Array();
  private smoothedChannelMask = new Float32Array();

  public constructor(scene: Scene) {
    this.scene = scene;
    this.material = new StandardMaterial("terrain-material", scene);
    this.material.backFaceCulling = true;
    this.material.specularColor = Color3.Black();
    this.material.diffuseColor = new Color3(0.98, 0.89, 0.76);
    this.material.emissiveColor = new Color3(0.018, 0.012, 0.008);

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

    this.topVertexCount = topVertexCount;
    this.perimeterLength = edgeRingVertexCount;
    this.perimeterTopStart = topVertexCount + bottomVertexCount;
    this.perimeterBottomStart = this.perimeterTopStart + edgeRingVertexCount;
    this.bottomY = bottomY;

    this.basePositions = new Float32Array(totalVertexCount * 3);
    this.dynamicPositions = new Float32Array(totalVertexCount * 3);
    this.occluderPositions = new Float32Array(totalVertexCount * 3);
    this.baseColors = new Float32Array(totalVertexCount * 4);
    this.dynamicColors = new Float32Array(totalVertexCount * 4);
    this.indices.length = 0;

    this.baseTopHeights = new Float32Array(topVertexCount);
    this.elevationField = new Float32Array(topVertexCount);
    this.slopeField = new Float32Array(topVertexCount);
    this.topToPerimeterCopy = new Int32Array(topVertexCount);
    this.topToPerimeterCopy.fill(-1);

    this.waterSignal = new Float32Array(topVertexCount);
    this.nearbyWater = new Float32Array(topVertexCount);
    this.flowSignal = new Float32Array(topVertexCount);
    this.blurredFlowSignal = new Float32Array(topVertexCount);
    this.persistentChannelMask = new Float32Array(topVertexCount);
    this.smoothedChannelMask = new Float32Array(topVertexCount);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = terrain.grid.index(x, y);
        const positionOffset = index * 3;
        const colorOffset = index * 4;
        const elevation = terrain.heights[index];
        const slope = this.sampleSlope(terrain, x, y);
        const normalizedElevation = inverseLerp(terrain.minHeight, terrain.maxHeight, elevation);
        const color = this.getDryTerrainColor(normalizedElevation, slope);

        this.baseTopHeights[index] = elevation;
        this.elevationField[index] = normalizedElevation;
        this.slopeField[index] = slope;

        this.basePositions[positionOffset] = x * cellSize - halfWidth;
        this.basePositions[positionOffset + 1] = elevation;
        this.basePositions[positionOffset + 2] = y * cellSize - halfHeight;

        this.baseColors[colorOffset] = color[0];
        this.baseColors[colorOffset + 1] = color[1];
        this.baseColors[colorOffset + 2] = color[2];
        this.baseColors[colorOffset + 3] = 1;
      }
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const topIndex = terrain.grid.index(x, y);
        const bottomIndex = topVertexCount + topIndex;
        const topColorOffset = topIndex * 4;
        const bottomColorOffset = bottomIndex * 4;
        const bottomPositionOffset = bottomIndex * 3;

        this.basePositions[bottomPositionOffset] = this.basePositions[topIndex * 3];
        this.basePositions[bottomPositionOffset + 1] = bottomY;
        this.basePositions[bottomPositionOffset + 2] = this.basePositions[topIndex * 3 + 2];

        this.baseColors[bottomColorOffset] = this.baseColors[topColorOffset] * 0.72;
        this.baseColors[bottomColorOffset + 1] = this.baseColors[topColorOffset + 1] * 0.72;
        this.baseColors[bottomColorOffset + 2] = this.baseColors[topColorOffset + 2] * 0.72;
        this.baseColors[bottomColorOffset + 3] = 1;
      }
    }

    for (let y = 0; y < height - 1; y += 1) {
      for (let x = 0; x < width - 1; x += 1) {
        const topLeft = terrain.grid.index(x, y);
        const topRight = terrain.grid.index(x + 1, y);
        const bottomLeft = terrain.grid.index(x, y + 1);
        const bottomRight = terrain.grid.index(x + 1, y + 1);

        this.indices.push(topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft);

        const baseBottomLeft = topVertexCount + bottomLeft;
        const baseBottomRight = topVertexCount + bottomRight;
        const baseTopLeft = topVertexCount + topLeft;
        const baseTopRight = topVertexCount + topRight;
        this.indices.push(
          baseTopLeft,
          baseBottomLeft,
          baseTopRight,
          baseTopRight,
          baseBottomLeft,
          baseBottomRight,
        );
      }
    }

    const perimeterSourceIndices: number[] = [];

    for (let x = 0; x < width; x += 1) {
      perimeterSourceIndices.push(terrain.grid.index(x, 0));
    }

    for (let y = 1; y < height - 1; y += 1) {
      perimeterSourceIndices.push(terrain.grid.index(width - 1, y));
    }

    for (let x = width - 1; x >= 0; x -= 1) {
      perimeterSourceIndices.push(terrain.grid.index(x, height - 1));
    }

    for (let y = height - 2; y >= 1; y -= 1) {
      perimeterSourceIndices.push(terrain.grid.index(0, y));
    }

    for (let perimeterOffset = 0; perimeterOffset < perimeterSourceIndices.length; perimeterOffset += 1) {
      const sourceTopIndex = perimeterSourceIndices[perimeterOffset];
      const sourceTopOffset = sourceTopIndex * 3;
      const topCopyIndex = this.perimeterTopStart + perimeterOffset;
      const bottomCopyIndex = this.perimeterBottomStart + perimeterOffset;
      const topCopyOffset = topCopyIndex * 3;
      const bottomCopyOffset = bottomCopyIndex * 3;
      const sourceColorOffset = sourceTopIndex * 4;
      const topCopyColorOffset = topCopyIndex * 4;
      const bottomCopyColorOffset = bottomCopyIndex * 4;

      this.topToPerimeterCopy[sourceTopIndex] = topCopyIndex;

      this.basePositions[topCopyOffset] = this.basePositions[sourceTopOffset];
      this.basePositions[topCopyOffset + 1] = this.basePositions[sourceTopOffset + 1];
      this.basePositions[topCopyOffset + 2] = this.basePositions[sourceTopOffset + 2];

      this.basePositions[bottomCopyOffset] = this.basePositions[sourceTopOffset];
      this.basePositions[bottomCopyOffset + 1] = bottomY;
      this.basePositions[bottomCopyOffset + 2] = this.basePositions[sourceTopOffset + 2];

      this.baseColors[topCopyColorOffset] = this.baseColors[sourceColorOffset];
      this.baseColors[topCopyColorOffset + 1] = this.baseColors[sourceColorOffset + 1];
      this.baseColors[topCopyColorOffset + 2] = this.baseColors[sourceColorOffset + 2];
      this.baseColors[topCopyColorOffset + 3] = 1;

      this.baseColors[bottomCopyColorOffset] = this.baseColors[sourceColorOffset] * 0.7;
      this.baseColors[bottomCopyColorOffset + 1] = this.baseColors[sourceColorOffset + 1] * 0.7;
      this.baseColors[bottomCopyColorOffset + 2] = this.baseColors[sourceColorOffset + 2] * 0.7;
      this.baseColors[bottomCopyColorOffset + 3] = 1;
    }

    for (let perimeterOffset = 0; perimeterOffset < this.perimeterLength; perimeterOffset += 1) {
      const nextOffset = (perimeterOffset + 1) % this.perimeterLength;
      const currentTop = this.perimeterTopStart + perimeterOffset;
      const nextTop = this.perimeterTopStart + nextOffset;
      const currentBottom = this.perimeterBottomStart + perimeterOffset;
      const nextBottom = this.perimeterBottomStart + nextOffset;

      this.indices.push(
        currentTop,
        currentBottom,
        nextTop,
        nextTop,
        currentBottom,
        nextBottom,
      );
    }

    this.dynamicPositions.set(this.basePositions);
    this.dynamicColors.set(this.baseColors);
    this.occluderPositions.set(this.basePositions);
    this.raiseOccluderTopShell();

    const normals: number[] = [];
    VertexData.ComputeNormals(Array.from(this.basePositions), this.indices, normals);

    const mesh = new Mesh("terrain-mesh", this.scene);
    const vertexData = new VertexData();
    vertexData.positions = Array.from(this.dynamicPositions);
    vertexData.indices = this.indices;
    vertexData.normals = normals;
    vertexData.colors = Array.from(this.dynamicColors);
    vertexData.applyToMesh(mesh, true);

    mesh.material = this.material;
    mesh.receiveShadows = false;
    mesh.isPickable = false;
    mesh.useVertexColors = true;

    const occluderNormals: number[] = [];
    VertexData.ComputeNormals(Array.from(this.occluderPositions), this.indices, occluderNormals);

    const occluderMesh = new Mesh("terrain-occluder-mesh", this.scene);
    const occluderVertexData = new VertexData();
    occluderVertexData.positions = Array.from(this.occluderPositions);
    occluderVertexData.indices = this.indices;
    occluderVertexData.normals = occluderNormals;
    occluderVertexData.applyToMesh(occluderMesh, true);

    occluderMesh.material = this.occluderMaterial;
    occluderMesh.isPickable = false;
    occluderMesh.renderingGroupId = 0;

    this.mesh = mesh;
    this.occluderMesh = occluderMesh;
    return mesh;
  }

  /**
   * Clears all render-only hydrology memory and restores the dry terrain look.
   * This is used on simulation reset so pooled water and old drainage paths do
   * not visually survive after the solver state has been cleared.
   */
  public resetHydrologyResponse(): void {
    if (!this.mesh || !this.occluderMesh) {
      return;
    }

    this.persistentChannelMask.fill(0);
    this.smoothedChannelMask.fill(0);
    this.waterSignal.fill(0);
    this.nearbyWater.fill(0);
    this.flowSignal.fill(0);
    this.blurredFlowSignal.fill(0);

    this.dynamicPositions.set(this.basePositions);
    this.dynamicColors.set(this.baseColors);
    this.occluderPositions.set(this.basePositions);
    this.raiseOccluderTopShell();

    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.dynamicPositions, false, false);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.dynamicColors, false, false);
    this.occluderMesh.updateVerticesData(VertexBuffer.PositionKind, this.occluderPositions, false, false);
  }

  /**
   * Applies hydrology-derived visual response to the terrain without mutating
   * simulation state. The method is intentionally incremental:
   * - water and flow are converted into smooth terrain masks
   * - persistent channels evolve with rise/decay memory
   * - only colors and a tiny render-only top-surface offset are updated
   */
  public updateHydrologyResponse(
    terrain: TerrainData,
    waterDepth: Float32Array,
    flowAccumulation: Float32Array,
    soilMoisture: Float32Array,
    persistentWetness: Float32Array,
    floodProne: Float32Array,
    vegetationBiomass: Float32Array,
    vegetationDensity: Uint8Array,
    vegetationProfile: Uint8Array,
    dtSeconds: number,
    showMoisture: boolean,
    showVegetation: boolean,
  ): void {
    if (
      !this.mesh ||
      !this.occluderMesh ||
      waterDepth.length !== this.topVertexCount ||
      flowAccumulation.length !== this.topVertexCount ||
      soilMoisture.length !== this.topVertexCount ||
      persistentWetness.length !== this.topVertexCount ||
      floodProne.length !== this.topVertexCount ||
      vegetationBiomass.length !== this.topVertexCount ||
      vegetationDensity.length !== this.topVertexCount ||
      vegetationProfile.length !== this.topVertexCount
    ) {
      return;
    }

    this.syncTerrainBase(terrain);
    this.dynamicPositions.set(this.basePositions);
    this.dynamicColors.set(this.baseColors);
    this.occluderPositions.set(this.basePositions);

    let maxAccumulation = 0;

    for (let index = 0; index < this.topVertexCount; index += 1) {
      maxAccumulation = Math.max(maxAccumulation, flowAccumulation[index]);
    }

    const maxLogFlow = Math.max(1, Math.log1p(maxAccumulation));

    for (let index = 0; index < this.topVertexCount; index += 1) {
      const depth = waterDepth[index];
      const logFlow = Math.log1p(flowAccumulation[index]);
      const normalizedFlow = clamp(logFlow / maxLogFlow, 0, 1);

      this.waterSignal[index] = clamp((depth - 0.0015) / 0.05, 0, 1);
      this.flowSignal[index] = Math.pow(normalizedFlow, 1.75);
    }

    this.blurScalarField(terrain, this.waterSignal, this.nearbyWater);
    this.blurScalarField(terrain, this.flowSignal, this.blurredFlowSignal);

    const channelRise = clamp(dtSeconds * 1.2, 0, 1);
    const channelDecay = clamp(dtSeconds * 0.18, 0, 1);

    for (let index = 0; index < this.topVertexCount; index += 1) {
      const channelTarget = clamp(
        this.blurredFlowSignal[index] * 0.82 +
          this.flowSignal[index] * 0.28 +
          this.nearbyWater[index] * 0.14,
        0,
        1,
      );
      const currentMemory = this.persistentChannelMask[index];
      const blend = channelTarget >= currentMemory ? channelRise : channelDecay;
      this.persistentChannelMask[index] = lerp(currentMemory, channelTarget, blend);
    }

    this.blurScalarField(terrain, this.persistentChannelMask, this.smoothedChannelMask);

    for (let index = 0; index < this.topVertexCount; index += 1) {
      const water = this.waterSignal[index];
      const nearbyWater = this.nearbyWater[index];
      const persistentChannel = clamp(
        this.persistentChannelMask[index] * 0.62 + this.smoothedChannelMask[index] * 0.38,
        0,
        1,
      );
      const shoreline = clamp(nearbyWater * 0.95 - water * 0.7, 0, 1);
      const ecologicalMoisture = clamp(
        soilMoisture[index] * 0.7 + persistentWetness[index] * 0.3,
        0,
        1,
      );
      const floodMemory = floodProne[index];
      const vegetation = vegetationBiomass[index];
      const vegetationClass = vegetationDensity[index];
      const plantProfile = vegetationProfile[index];
      const wetness = clamp(
        nearbyWater * 0.55 +
          water * 0.45 +
          this.flowSignal[index] * 0.12 +
          persistentChannel * 0.24 +
          ecologicalMoisture * 0.22,
        0,
        1,
      );
      const saturation = clamp(water * 0.88 + nearbyWater * 0.18 + floodMemory * 0.16, 0, 1);
      const slope = this.slopeField[index];
      const channelSupport = clamp(1 - slope * 0.7, 0.28, 1);
      const incision =
        Math.pow(persistentChannel, 1.65) * channelSupport * this.maxChannelIncision +
        shoreline * persistentChannel * 0.028;
      const positionOffset = index * 3;
      const colorOffset = index * 4;
      const hydrologyColor = this.getHydrologyTintedColor(
        this.elevationField[index],
        slope,
        wetness,
        saturation,
        shoreline,
        persistentChannel,
        ecologicalMoisture,
        floodMemory,
      );
      const color = showVegetation
        ? this.getVegetationVisualizationColor(
            hydrologyColor,
            vegetation,
            vegetationClass,
            plantProfile,
            ecologicalMoisture,
            floodMemory,
            water,
          )
        : showMoisture
          ? this.getMoistureVisualizationColor(
            this.elevationField[index],
            slope,
            ecologicalMoisture,
            persistentWetness[index],
            floodMemory,
            water,
          )
          : this.applyVegetationTint(
              hydrologyColor,
              vegetation,
              vegetationClass,
              plantProfile,
              ecologicalMoisture,
              floodMemory,
            );

      this.dynamicPositions[positionOffset + 1] = this.baseTopHeights[index] - incision;
      this.occluderPositions[positionOffset + 1] = this.dynamicPositions[positionOffset + 1] + this.occluderLift;

      this.dynamicColors[colorOffset] = color[0];
      this.dynamicColors[colorOffset + 1] = color[1];
      this.dynamicColors[colorOffset + 2] = color[2];
      this.dynamicColors[colorOffset + 3] = 1;

      const perimeterCopyIndex = this.topToPerimeterCopy[index];
      if (perimeterCopyIndex >= 0) {
        const perimeterPositionOffset = perimeterCopyIndex * 3;
        const perimeterColorOffset = perimeterCopyIndex * 4;
        const perimeterBottomColorOffset = (this.perimeterBottomStart + (perimeterCopyIndex - this.perimeterTopStart)) * 4;

        this.dynamicPositions[perimeterPositionOffset + 1] = this.dynamicPositions[positionOffset + 1];
        this.occluderPositions[perimeterPositionOffset + 1] = this.dynamicPositions[positionOffset + 1] + this.occluderLift;

        this.dynamicColors[perimeterColorOffset] = color[0];
        this.dynamicColors[perimeterColorOffset + 1] = color[1];
        this.dynamicColors[perimeterColorOffset + 2] = color[2];
        this.dynamicColors[perimeterColorOffset + 3] = 1;

        this.dynamicColors[perimeterBottomColorOffset] = color[0] * 0.7;
        this.dynamicColors[perimeterBottomColorOffset + 1] = color[1] * 0.7;
        this.dynamicColors[perimeterBottomColorOffset + 2] = color[2] * 0.7;
        this.dynamicColors[perimeterBottomColorOffset + 3] = 1;
      }
    }

    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.dynamicPositions, false, false);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.dynamicColors, false, false);
    this.occluderMesh.updateVerticesData(VertexBuffer.PositionKind, this.occluderPositions, false, false);
  }

  private raiseOccluderTopShell(): void {
    for (let topIndex = 0; topIndex < this.topVertexCount; topIndex += 1) {
      this.occluderPositions[topIndex * 3 + 1] += this.occluderLift;
    }

    for (let perimeterOffset = 0; perimeterOffset < this.perimeterLength; perimeterOffset += 1) {
      const perimeterTopIndex = this.perimeterTopStart + perimeterOffset;
      this.occluderPositions[perimeterTopIndex * 3 + 1] += this.occluderLift;
    }
  }

  /**
   * Terrain heights become dynamic once erosion/deposition is active. This
   * refresh keeps the render-side base geometry, dry colors, and closed volume
   * aligned with the current simulation terrain before hydrology tinting is
   * layered on top.
   */
  private syncTerrainBase(terrain: TerrainData): void {
    this.bottomY = terrain.minHeight - 18;

    for (let index = 0; index < this.topVertexCount; index += 1) {
      const positionOffset = index * 3;
      const colorOffset = index * 4;
      const x = index % terrain.grid.width;
      const y = Math.floor(index / terrain.grid.width);
      const elevation = terrain.heights[index];
      const slope = this.sampleSlope(terrain, x, y);
      const normalizedElevation = inverseLerp(terrain.minHeight, terrain.maxHeight, elevation);
      const color = this.getDryTerrainColor(normalizedElevation, slope);

      this.baseTopHeights[index] = elevation;
      this.elevationField[index] = normalizedElevation;
      this.slopeField[index] = slope;

      this.basePositions[positionOffset + 1] = elevation;
      this.baseColors[colorOffset] = color[0];
      this.baseColors[colorOffset + 1] = color[1];
      this.baseColors[colorOffset + 2] = color[2];
      this.baseColors[colorOffset + 3] = 1;

      const bottomIndex = this.topVertexCount + index;
      const bottomPositionOffset = bottomIndex * 3;
      const bottomColorOffset = bottomIndex * 4;

      this.basePositions[bottomPositionOffset + 1] = this.bottomY;
      this.baseColors[bottomColorOffset] = color[0] * 0.72;
      this.baseColors[bottomColorOffset + 1] = color[1] * 0.72;
      this.baseColors[bottomColorOffset + 2] = color[2] * 0.72;
      this.baseColors[bottomColorOffset + 3] = 1;

      const perimeterCopyIndex = this.topToPerimeterCopy[index];
      if (perimeterCopyIndex >= 0) {
        const perimeterTopOffset = perimeterCopyIndex * 3;
        const perimeterTopColorOffset = perimeterCopyIndex * 4;
        const perimeterBottomIndex = this.perimeterBottomStart + (perimeterCopyIndex - this.perimeterTopStart);
        const perimeterBottomOffset = perimeterBottomIndex * 3;
        const perimeterBottomColorOffset = perimeterBottomIndex * 4;

        this.basePositions[perimeterTopOffset + 1] = elevation;
        this.basePositions[perimeterBottomOffset + 1] = this.bottomY;

        this.baseColors[perimeterTopColorOffset] = color[0];
        this.baseColors[perimeterTopColorOffset + 1] = color[1];
        this.baseColors[perimeterTopColorOffset + 2] = color[2];
        this.baseColors[perimeterTopColorOffset + 3] = 1;

        this.baseColors[perimeterBottomColorOffset] = color[0] * 0.7;
        this.baseColors[perimeterBottomColorOffset + 1] = color[1] * 0.7;
        this.baseColors[perimeterBottomColorOffset + 2] = color[2] * 0.7;
        this.baseColors[perimeterBottomColorOffset + 3] = 1;
      }
    }
  }

  private blurScalarField(
    terrain: TerrainData,
    source: Float32Array,
    target: Float32Array,
  ): void {
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

  private sampleSlope(terrain: TerrainData, x: number, y: number): number {
    const left = terrain.heights[terrain.grid.index(Math.max(x - 1, 0), y)];
    const right = terrain.heights[terrain.grid.index(Math.min(x + 1, terrain.grid.width - 1), y)];
    const top = terrain.heights[terrain.grid.index(x, Math.max(y - 1, 0))];
    const bottom = terrain.heights[terrain.grid.index(x, Math.min(y + 1, terrain.grid.height - 1))];
    const dx = Math.abs(right - left);
    const dy = Math.abs(bottom - top);
    return Math.min(1, (dx + dy) / 10);
  }

  private getDryTerrainColor(elevation: number, slope: number): [number, number, number] {
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

    const rockBlend = Math.min(1, slope * 1.35);
    r = lerp(r, rock[0], rockBlend);
    g = lerp(g, rock[1], rockBlend);
    b = lerp(b, rock[2], rockBlend);

    const shade = 1 - slope * 0.14;
    return [r * shade, g * shade, b * shade];
  }

  /**
   * Converts dry terrain colors into terrain-water interaction colors.
   * The palette stays earthy, but becomes darker, denser, and more coherent
   * around water bodies and persistent channels.
   */
  private getHydrologyTintedColor(
    elevation: number,
    slope: number,
    wetness: number,
    saturation: number,
    shoreline: number,
    persistentChannel: number,
    ecologicalMoisture: number,
    floodMemory: number,
  ): [number, number, number] {
    const base = this.getDryTerrainColor(elevation, slope);
    const damp = [0.28, 0.21, 0.14] as const;
    const saturated = [0.2, 0.16, 0.12] as const;
    const shorelineTint = [0.34, 0.27, 0.17] as const;
    const channelTint = [0.18, 0.145, 0.115] as const;
    const ecologicalTint = [0.22, 0.245, 0.16] as const;
    const floodTint = [0.16, 0.2, 0.18] as const;

    let r = base[0];
    let g = base[1];
    let b = base[2];

    r = lerp(r, damp[0], wetness * 0.42);
    g = lerp(g, damp[1], wetness * 0.42);
    b = lerp(b, damp[2], wetness * 0.42);

    r = lerp(r, saturated[0], saturation * 0.46);
    g = lerp(g, saturated[1], saturation * 0.46);
    b = lerp(b, saturated[2], saturation * 0.46);

    r = lerp(r, shorelineTint[0], shoreline * 0.28);
    g = lerp(g, shorelineTint[1], shoreline * 0.28);
    b = lerp(b, shorelineTint[2], shoreline * 0.28);

    r = lerp(r, channelTint[0], persistentChannel * 0.55);
    g = lerp(g, channelTint[1], persistentChannel * 0.55);
    b = lerp(b, channelTint[2], persistentChannel * 0.55);

    r = lerp(r, ecologicalTint[0], ecologicalMoisture * 0.24);
    g = lerp(g, ecologicalTint[1], ecologicalMoisture * 0.24);
    b = lerp(b, ecologicalTint[2], ecologicalMoisture * 0.24);

    r = lerp(r, floodTint[0], floodMemory * 0.16);
    g = lerp(g, floodTint[1], floodMemory * 0.16);
    b = lerp(b, floodTint[2], floodMemory * 0.16);

    const darken =
      1 -
      clamp(
        wetness * 0.15 +
          saturation * 0.1 +
          persistentChannel * 0.12 +
          ecologicalMoisture * 0.08 +
          floodMemory * 0.05,
        0,
        0.36,
      );
    return [r * darken, g * darken, b * darken];
  }

  /**
   * Vegetation tinting is intentionally restrained in the default terrain view.
   * It should help the landscape read ecologically without overwhelming the
   * rock-and-water structure that remains the primary visual signal.
   */
  private applyVegetationTint(
    base: [number, number, number],
    biomass: number,
    densityClass: number,
    profile: number,
    ecologicalMoisture: number,
    floodMemory: number,
  ): [number, number, number] {
    if (profile === VEGETATION_PROFILE_NONE || biomass <= 0.02 || densityClass === 0) {
      return base;
    }

    const tint = this.getVegetationProfileColor(profile);
    const densityStrength = densityClass === 1 ? 0.18 : densityClass === 2 ? 0.32 : 0.46;
    const ecologicalBoost =
      profile === VEGETATION_PROFILE_WETLAND
        ? floodMemory * 0.16 + ecologicalMoisture * 0.14
        : ecologicalMoisture * 0.12;
    const blend = clamp(biomass * densityStrength + ecologicalBoost, 0, 0.58);

    return [
      lerp(base[0], tint[0], blend),
      lerp(base[1], tint[1], blend),
      lerp(base[2], tint[2], blend),
    ];
  }

  /**
   * Vegetation view is a debug-style ecology palette rather than a literal
   * foliage renderer. It separates sparse, medium, and dense growth while
   * keeping the broad plant strategy visible through profile-specific hues.
   */
  private getVegetationVisualizationColor(
    base: [number, number, number],
    biomass: number,
    densityClass: number,
    profile: number,
    ecologicalMoisture: number,
    floodMemory: number,
    surfaceWater: number,
  ): [number, number, number] {
    if (biomass <= 0.02 || densityClass === 0 || profile === VEGETATION_PROFILE_NONE) {
      const barren = [0.34, 0.27, 0.18] as const;
      const floodShadow = clamp(floodMemory * 0.2 + surfaceWater * 0.18, 0, 0.28);
      return [
        lerp(base[0], barren[0], 0.7) * (1 - floodShadow),
        lerp(base[1], barren[1], 0.7) * (1 - floodShadow * 0.85),
        lerp(base[2], barren[2], 0.7),
      ];
    }

    const sparse = [0.48, 0.44, 0.22] as const;
    const tint = this.getVegetationProfileColor(profile);
    const wetlandShadow = profile === VEGETATION_PROFILE_WETLAND ? floodMemory * 0.16 : 0;
    const densityBlend = densityClass === 1 ? 0.36 : densityClass === 2 ? 0.6 : 0.82;
    const moistureLift = clamp(ecologicalMoisture * 0.12, 0, 0.12);
    let r = lerp(sparse[0], tint[0], densityBlend);
    let g = lerp(sparse[1], tint[1], densityBlend);
    let b = lerp(sparse[2], tint[2], densityBlend);

    r = Math.min(1, r + moistureLift * 0.4);
    g = Math.min(1, g + moistureLift);
    b = Math.min(1, b + moistureLift * 0.3 + wetlandShadow);

    const reveal = clamp(0.2 + biomass * 0.8, 0.2, 0.95);
    return [
      lerp(base[0] * 0.74, r, reveal),
      lerp(base[1] * 0.78, g, reveal),
      lerp(base[2] * 0.7, b, reveal),
    ];
  }

  private getVegetationProfileColor(profile: number): [number, number, number] {
    switch (profile) {
      case VEGETATION_PROFILE_DRYLAND:
        return [0.55, 0.53, 0.24];
      case VEGETATION_PROFILE_WETLAND:
        return [0.17, 0.46, 0.32];
      case VEGETATION_PROFILE_MESIC:
      default:
        return [0.26, 0.5, 0.2];
    }
  }

  /**
   * Moisture view is a debug-oriented ecological palette:
   * - dry ground stays warm and dusty
   * - damp ground shifts toward muted olive
   * - saturated soil shifts to teal-green
   * - flood-prone areas deepen toward cool blue-green
   */
  private getMoistureVisualizationColor(
    elevation: number,
    slope: number,
    ecologicalMoisture: number,
    persistentWetness: number,
    floodMemory: number,
    surfaceWater: number,
  ): [number, number, number] {
    const dry = [0.46, 0.34, 0.22] as const;
    const damp = [0.42, 0.43, 0.2] as const;
    const saturated = [0.18, 0.42, 0.34] as const;
    const flood = [0.08, 0.32, 0.46] as const;
    const moisture = clamp(ecologicalMoisture * 0.72 + persistentWetness * 0.28, 0, 1);

    let r = lerp(dry[0], damp[0], clamp(moisture * 1.15, 0, 1));
    let g = lerp(dry[1], damp[1], clamp(moisture * 1.15, 0, 1));
    let b = lerp(dry[2], damp[2], clamp(moisture * 1.15, 0, 1));

    r = lerp(r, saturated[0], clamp((moisture - 0.35) / 0.55, 0, 1));
    g = lerp(g, saturated[1], clamp((moisture - 0.35) / 0.55, 0, 1));
    b = lerp(b, saturated[2], clamp((moisture - 0.35) / 0.55, 0, 1));

    const floodBlend = clamp(floodMemory * 0.78 + surfaceWater * 0.55, 0, 1);
    r = lerp(r, flood[0], floodBlend);
    g = lerp(g, flood[1], floodBlend);
    b = lerp(b, flood[2], floodBlend);

    const elevationLift = clamp(0.92 + elevation * 0.08, 0.9, 1);
    const shade = 1 - slope * 0.12;
    return [r * elevationLift * shade, g * elevationLift * shade, b * elevationLift * shade];
  }
}
