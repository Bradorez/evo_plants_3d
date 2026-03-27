import { createScene, frameCameraOnTerrain } from "./scene/createScene";
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
  private readonly terrainMeshRenderer;
  private readonly waterOverlayRenderer;
  private readonly controls;
  private readonly fixedStepSeconds = 1 / 30;

  private isRunning = true;
  private simulationSpeed = 1;
  private simulationAccumulator = 0;
  private statsAccumulator = 0;
  private viewOptions: WaterOverlayViewOptions = {
    showRivers: true,
    showWaterDepth: true,
  };

  public constructor(canvas: HTMLCanvasElement) {
    this.sceneBundle = createScene(canvas);
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
    this.sceneBundle.engine.runRenderLoop(() => {
      this.updateFrame();
    });
  }

  private rebuildTerrainVisuals(): void {
    this.terrainMeshRenderer.rebuild(this.simulation.terrain);
    this.waterOverlayRenderer.rebuild(this.simulation.terrain);
    frameCameraOnTerrain(this.sceneBundle.camera, this.simulation.terrain);
  }

  private resetSimulation(): void {
    this.simulation.reset();
    this.simulationAccumulator = 0;
    this.controls.setStats(this.simulation.getStats());
  }

  private regenerateTerrain(): void {
    this.simulation.regenerate();
    this.simulationAccumulator = 0;
    this.rebuildTerrainVisuals();
    this.controls.setStats(this.simulation.getStats());
  }

  private updateFrame(): void {
    const realDeltaSeconds = Math.min(this.sceneBundle.engine.getDeltaTime() / 1000, 0.1);

    if (this.isRunning) {
      this.simulationAccumulator += realDeltaSeconds * this.simulationSpeed;
      let steps = 0;

      while (this.simulationAccumulator >= this.fixedStepSeconds && steps < 10) {
        this.simulation.step(this.fixedStepSeconds);
        this.simulationAccumulator -= this.fixedStepSeconds;
        steps += 1;
      }

      if (steps >= 10) {
        this.simulationAccumulator = 0;
      }
    }

    this.waterOverlayRenderer.update(
      this.simulation.terrain,
      this.simulation.waterDepth,
      this.simulation.flowAccumulation,
      this.viewOptions,
    );

    this.sceneBundle.scene.render();

    this.statsAccumulator += realDeltaSeconds;
    if (this.statsAccumulator >= 0.15) {
      this.controls.setStats(this.simulation.getStats());
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
