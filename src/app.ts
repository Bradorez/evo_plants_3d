import { createScene, frameCameraOnTerrain } from "./scene/createScene";
import { PlantRenderer } from "./scene/plantRenderer";
import { TerrainMeshRenderer } from "./scene/terrainMesh";
import { WaterOverlayRenderer, type WaterOverlayViewOptions } from "./scene/waterOverlay";
import { Color3, Matrix, Mesh, MeshBuilder, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { SandboxToolMode } from "./sim/Sandbox";
import { Simulation } from "./sim/Simulation";
import { createControls } from "./ui/controls";

/**
 * The application layer is the integration point for all subsystems.
 * It keeps the render loop, the fixed-step simulation timing, Babylon scene
 * objects, and the DOM controls coordinated without letting those concerns leak
 * into the lower-level simulation modules.
 */
class TerrainHydrologyApp {
  private readonly simulation = new Simulation();
  private readonly sceneBundle;
  private readonly plantRenderer;
  private readonly terrainMeshRenderer;
  private readonly waterOverlayRenderer;
  private readonly controls;
  private readonly brushPreview;
  private readonly selectionMarker;
  private readonly handleKeydown: (event: KeyboardEvent) => void;

  private isRunning = true;
  private simulationSpeed = 1;
  private statsAccumulator = 0;
  private sandboxMode: SandboxToolMode = "view";
  private sandboxBrushSize = 2;
  private sandboxStrength = 1;
  private hoveredBrushPoint: Vector3 | null = null;
  private selectedPlantCell: { x: number; y: number } | null = null;
  private viewOptions: WaterOverlayViewOptions = {
    showRivers: true,
    showWaterDepth: true,
    showMoisture: false,
    showTemperature: false,
    showSeason: false,
    showVegetation: false,
    climateOverlay: "none",
    plantDiagnosticOverlay: "none",
  };

  public constructor(canvas: HTMLCanvasElement) {
    const brushPreview = document.getElementById("brushPreview");
    if (!(brushPreview instanceof HTMLDivElement)) {
      throw new Error("Expected #brushPreview to be an HTMLDivElement.");
    }
    this.brushPreview = brushPreview;

    this.sceneBundle = createScene(canvas);
    this.plantRenderer = new PlantRenderer(this.sceneBundle.scene);
    this.terrainMeshRenderer = new TerrainMeshRenderer(this.sceneBundle.scene);
    this.waterOverlayRenderer = new WaterOverlayRenderer(this.sceneBundle.scene);
    this.selectionMarker = this.createSelectionMarker();
    this.handleKeydown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (event.key.toLowerCase() === "p") {
        this.isRunning = !this.isRunning;
        this.controls.setRunning(this.isRunning);
      }
    };
    window.addEventListener("keydown", this.handleKeydown);
    this.controls = createControls(
      {
        onToggleRunning: (running) => {
          this.isRunning = running;
        },
        onResetSimulation: () => {
          this.resetSimulation();
        },
        onRegenerateTerrain: () => {
          this.regenerateTerrain();
        },
        onPlantVegetation: () => {
          this.simulation.initializeVegetationNow();
          this.controls.setVegetationDebug(this.simulation.getVegetationDebugSummary());
          this.refreshSelectedPlantInspection();
        },
        onRainIntensityChange: (value) => {
          this.simulation.setRainIntensity(value);
          this.controls.setStats(this.simulation.getStats());
        },
        onSimulationSpeedChange: (value) => {
          this.simulationSpeed = value;
        },
        onViewOptionsChange: (value) => {
          this.viewOptions = value;
        },
        onSandboxModeChange: (mode) => {
          this.sandboxMode = mode;
        },
        onSandboxBrushSizeChange: (value) => {
          this.sandboxBrushSize = value;
        },
        onSandboxStrengthChange: (value) => {
          this.sandboxStrength = value;
        },
      },
      {
        isRunning: this.isRunning,
        rainIntensity: this.simulation.getStats().rainIntensity,
        simulationSpeed: this.simulationSpeed,
        viewOptions: this.viewOptions,
        sandboxMode: this.sandboxMode,
        sandboxBrushSize: this.sandboxBrushSize,
        sandboxStrength: this.sandboxStrength,
      },
    );

    this.rebuildTerrainVisuals();
    this.attachSandboxInteraction(canvas);
    this.controls.setStats(this.simulation.getStats());
    this.controls.setVegetationDebug(this.simulation.getVegetationDebugSummary());
    this.controls.setPlantInspection(null);
    this.sceneBundle.engine.runRenderLoop(() => {
      this.updateFrame();
    });
  }

  private rebuildTerrainVisuals(): void {
    this.plantRenderer.rebuild();
    this.terrainMeshRenderer.rebuild(this.simulation.terrain);
    this.terrainMeshRenderer.resetHydrologyResponse();
    this.waterOverlayRenderer.rebuild(this.simulation.terrain);
    frameCameraOnTerrain(this.sceneBundle.camera, this.simulation.terrain);
  }

  private resetSimulation(): void {
    this.simulation.reset();
    this.selectedPlantCell = null;
    this.terrainMeshRenderer.resetHydrologyResponse();
    this.controls.setStats(this.simulation.getStats());
    this.controls.setVegetationDebug(this.simulation.getVegetationDebugSummary());
    this.controls.setPlantInspection(null);
  }

  private regenerateTerrain(): void {
    this.simulation.regenerate();
    this.selectedPlantCell = null;
    this.rebuildTerrainVisuals();
    this.controls.setStats(this.simulation.getStats());
    this.controls.setVegetationDebug(this.simulation.getVegetationDebugSummary());
    this.controls.setPlantInspection(null);
  }

  private updateFrame(): void {
    const realDeltaSeconds = Math.min(this.sceneBundle.engine.getDeltaTime() / 1000, 0.1);
    const simulatedDeltaSeconds = this.isRunning ? realDeltaSeconds * this.simulationSpeed : 0;

    if (simulatedDeltaSeconds > 0) {
      this.simulation.step(simulatedDeltaSeconds);
    }

    this.terrainMeshRenderer.updateHydrologyResponse(
      this.simulation.terrain,
      this.simulation.waterDepth,
      this.simulation.flowAccumulation,
      this.simulation.soilMoisture,
      this.simulation.persistentWetness,
      this.simulation.floodProne,
      this.simulation.temperature,
      this.simulation.vegetationBiomass,
      this.simulation.vegetationDensity,
      this.simulation.vegetationProfile,
      this.simulation.vegetationSpeciesId,
      this.simulation.getPlantActivityField(),
      this.simulation.getPlantReproductionReadinessField(),
      this.simulation.getPlantStressField(),
      this.simulation.getPlantSuitabilityField(),
      this.simulation.getLocalSeasonPhaseField(),
      this.simulation.getClimateMeanTemperatureField(),
      this.simulation.getClimateRainfallBaselineField(),
      this.simulation.getClimateSeasonalityField(),
      this.simulation.getClimateEvaporationPressureField(),
      this.viewOptions.climateOverlay,
      this.viewOptions.plantDiagnosticOverlay,
      simulatedDeltaSeconds,
      this.viewOptions.showMoisture,
      this.viewOptions.showTemperature,
      this.viewOptions.showSeason,
      this.viewOptions.showVegetation,
    );

    this.waterOverlayRenderer.update(
      this.simulation.terrain,
      this.simulation.waterDepth,
      this.simulation.flowAccumulation,
      this.viewOptions,
    );

    this.plantRenderer.update(
      this.simulation.terrain,
      this.simulation.vegetationBiomass,
      this.simulation.vegetationDensity,
      this.simulation.vegetationSpeciesId,
      this.simulation.getPlantSpeciesCatalog(),
      this.simulation.vegetationRevision,
    );

    this.updateBrushPreview();
    this.updateSelectionMarker();

    this.sceneBundle.scene.render();

    this.statsAccumulator += realDeltaSeconds;
    if (this.statsAccumulator >= 0.15) {
      this.controls.setStats(this.simulation.getStats());
      this.controls.setVegetationDebug(this.simulation.getVegetationDebugSummary());
      this.refreshSelectedPlantInspection();
      this.statsAccumulator = 0;
    }
  }

  private attachSandboxInteraction(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointermove", () => {
      this.hoveredBrushPoint = this.pickTerrainPoint();
    });

    canvas.addEventListener("pointerleave", () => {
      this.hoveredBrushPoint = null;
      this.brushPreview.style.opacity = "0";
    });

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      const pickedPoint = this.pickTerrainPoint();

      if (!pickedPoint) {
        return;
      }

      const cell = this.worldPointToCell(pickedPoint.x, pickedPoint.z);

      if (!cell) {
        return;
      }

      if (this.sandboxMode === "view") {
        const inspection = this.simulation.inspectPlantCell(cell.x, cell.y);
        if (inspection?.occupied) {
          this.selectedPlantCell = cell;
          this.controls.setPlantInspection(inspection);
        }
        return;
      }

      this.simulation.applySandboxTool(
        this.sandboxMode,
        cell.x,
        cell.y,
        this.sandboxBrushSize,
        this.sandboxStrength,
      );
      this.controls.setStats(this.simulation.getStats());
      this.hoveredBrushPoint = pickedPoint;
    });
  }

  /**
   * Inspection stays in the app layer so the UI can keep a live selected cell
   * while the simulation continues evolving underneath it.
   */
  private refreshSelectedPlantInspection(): void {
    if (!this.selectedPlantCell) {
      this.controls.setPlantInspection(null);
      return;
    }

    this.controls.setPlantInspection(
      this.simulation.inspectPlantCell(this.selectedPlantCell.x, this.selectedPlantCell.y),
    );
  }

  /**
   * The selection marker is a purely visual helper for the diagnostics panel.
   * It makes the currently inspected cell obvious in 3D without affecting plant
   * growth or terrain state.
   */
  private createSelectionMarker(): Mesh {
    const marker = MeshBuilder.CreateTorus(
      "plant-selection-marker",
      {
        diameter: this.simulation.terrain.cellSize * 0.9,
        thickness: this.simulation.terrain.cellSize * 0.08,
        tessellation: 48,
      },
      this.sceneBundle.scene,
    );
    const material = new StandardMaterial("plant-selection-marker-material", this.sceneBundle.scene);
    material.disableLighting = true;
    material.diffuseColor = new Color3(0.2, 0.85, 1);
    material.emissiveColor = new Color3(0.08, 0.42, 0.56);
    material.alpha = 0.92;
    marker.material = material;
    marker.renderingGroupId = 3;
    marker.isPickable = false;
    marker.rotation.x = 0;
    marker.isVisible = false;
    return marker;
  }

  private updateSelectionMarker(): void {
    if (!this.selectedPlantCell) {
      this.selectionMarker.isVisible = false;
      return;
    }

    const worldPoint = this.cellToWorldPoint(this.selectedPlantCell.x, this.selectedPlantCell.y);
    if (!worldPoint) {
      this.selectionMarker.isVisible = false;
      return;
    }

    this.selectionMarker.position.copyFrom(worldPoint);
    this.selectionMarker.scaling.set(1, 1, 1);
    this.selectionMarker.isVisible = true;
  }

  private pickTerrainPoint(): Vector3 | null {
    const terrainMesh = this.terrainMeshRenderer.getMesh();

    if (!terrainMesh) {
      return null;
    }

    const pick = this.sceneBundle.scene.pick(
      this.sceneBundle.scene.pointerX,
      this.sceneBundle.scene.pointerY,
      (mesh) => mesh === terrainMesh,
    );

    return pick?.hit && pick.pickedPoint ? pick.pickedPoint.clone() : null;
  }

  private updateBrushPreview(): void {
    if (this.sandboxMode === "view" || !this.hoveredBrushPoint) {
      this.brushPreview.style.opacity = "0";
      return;
    }

    const engine = this.sceneBundle.engine;
    const camera = this.sceneBundle.camera;
    const canvasRect = engine.getRenderingCanvas()?.getBoundingClientRect();
    if (!canvasRect) {
      this.brushPreview.style.opacity = "0";
      return;
    }
    const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const centerScreen = Vector3.Project(
      this.hoveredBrushPoint,
      Matrix.IdentityReadOnly,
      this.sceneBundle.scene.getTransformMatrix(),
      viewport,
    );
    const brushRadiusWorld = (this.sandboxBrushSize + 0.5) * this.simulation.terrain.cellSize;
    const edgeWorld = this.hoveredBrushPoint.add(new Vector3(brushRadiusWorld, 0, 0));
    const edgeScreen = Vector3.Project(
      edgeWorld,
      Matrix.IdentityReadOnly,
      this.sceneBundle.scene.getTransformMatrix(),
      viewport,
    );
    const widthScale = canvasRect.width / engine.getRenderWidth();
    const heightScale = canvasRect.height / engine.getRenderHeight();
    const centerX = canvasRect.left + centerScreen.x * widthScale;
    const centerY = canvasRect.top + centerScreen.y * heightScale;
    const radiusPx = Math.max(
      8,
      Math.hypot(
        (edgeScreen.x - centerScreen.x) * widthScale,
        (edgeScreen.y - centerScreen.y) * heightScale,
      ),
    );

    this.brushPreview.style.left = `${centerX}px`;
    this.brushPreview.style.top = `${centerY}px`;
    this.brushPreview.style.width = `${radiusPx * 2}px`;
    this.brushPreview.style.height = `${radiusPx * 2}px`;
    this.brushPreview.style.opacity = "1";
  }

  private worldPointToCell(worldX: number, worldZ: number): { x: number; y: number } | null {
    const terrain = this.simulation.terrain;
    const halfWidth = (terrain.grid.width - 1) * terrain.cellSize * 0.5;
    const halfHeight = (terrain.grid.height - 1) * terrain.cellSize * 0.5;
    const x = Math.round((worldX + halfWidth) / terrain.cellSize);
    const y = Math.round((worldZ + halfHeight) / terrain.cellSize);

    if (!terrain.grid.isInside(x, y)) {
      return null;
    }

    return { x, y };
  }

  private cellToWorldPoint(cellX: number, cellY: number): Vector3 | null {
    if (!this.simulation.terrain.grid.isInside(cellX, cellY)) {
      return null;
    }

    const terrain = this.simulation.terrain;
    const index = terrain.grid.index(cellX, cellY);
    const halfWidth = (terrain.grid.width - 1) * terrain.cellSize * 0.5;
    const halfHeight = (terrain.grid.height - 1) * terrain.cellSize * 0.5;
    const x = cellX * terrain.cellSize - halfWidth;
    const z = cellY * terrain.cellSize - halfHeight;
    const y = terrain.heights[index] + Math.max(0.08, this.simulation.waterDepth[index] * 0.18 + 0.08);

    return new Vector3(x, y, z);
  }
}

export function bootstrapApp(): void {
  const canvas = document.getElementById("renderCanvas");

  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Expected #renderCanvas to be an HTMLCanvasElement.");
  }

  new TerrainHydrologyApp(canvas);
}
