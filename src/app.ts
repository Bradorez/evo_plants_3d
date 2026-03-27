import { createScene, frameCameraOnTerrain } from "./scene/createScene";
import { PlantRenderer } from "./scene/plantRenderer";
import { TerrainMeshRenderer } from "./scene/terrainMesh";
import { WaterOverlayRenderer, type WaterOverlayViewOptions } from "./scene/waterOverlay";
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

  private isRunning = true;
  private simulationSpeed = 1;
  private statsAccumulator = 0;
  private viewOptions: WaterOverlayViewOptions = {
    showRivers: true,
    showWaterDepth: true,
    showMoisture: false,
    showVegetation: false,
  };

  public constructor(canvas: HTMLCanvasElement) {
    this.sceneBundle = createScene(canvas);
    this.plantRenderer = new PlantRenderer(this.sceneBundle.scene);
    this.terrainMeshRenderer = new TerrainMeshRenderer(this.sceneBundle.scene);
    this.waterOverlayRenderer = new WaterOverlayRenderer(this.sceneBundle.scene);
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
      },
      {
        isRunning: this.isRunning,
        rainIntensity: this.simulation.getStats().rainIntensity,
        simulationSpeed: this.simulationSpeed,
        viewOptions: this.viewOptions,
      },
    );

    this.rebuildTerrainVisuals();
    this.controls.setStats(this.simulation.getStats());
    this.controls.setVegetationDebug(this.simulation.getVegetationDebugSummary());
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
    this.terrainMeshRenderer.resetHydrologyResponse();
    this.controls.setStats(this.simulation.getStats());
    this.controls.setVegetationDebug(this.simulation.getVegetationDebugSummary());
  }

  private regenerateTerrain(): void {
    this.simulation.regenerate();
    this.rebuildTerrainVisuals();
    this.controls.setStats(this.simulation.getStats());
    this.controls.setVegetationDebug(this.simulation.getVegetationDebugSummary());
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
      this.simulation.vegetationBiomass,
      this.simulation.vegetationDensity,
      this.simulation.vegetationProfile,
      simulatedDeltaSeconds,
      this.viewOptions.showMoisture,
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

    this.sceneBundle.scene.render();

    this.statsAccumulator += realDeltaSeconds;
    if (this.statsAccumulator >= 0.15) {
      this.controls.setStats(this.simulation.getStats());
      this.controls.setVegetationDebug(this.simulation.getVegetationDebugSummary());
      this.statsAccumulator = 0;
    }
  }
}

export function bootstrapApp(): void {
  const canvas = document.getElementById("renderCanvas");

  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Expected #renderCanvas to be an HTMLCanvasElement.");
  }

  new TerrainHydrologyApp(canvas);
}
