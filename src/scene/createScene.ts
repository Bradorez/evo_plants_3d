import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Scene,
  Vector3,
} from "@babylonjs/core";
import type { TerrainData } from "../sim/Terrain";

export interface SceneBundle {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  dispose: () => void;
}

/**
 * Scene creation is intentionally small and reusable.
 * It owns Babylon.js engine primitives, camera defaults, lights, and resize
 * plumbing so the app layer can focus on simulator orchestration.
 */
export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.45, 0.53, 0.61, 1);
  scene.ambientColor = new Color3(0.14, 0.12, 0.1);

  const camera = new ArcRotateCamera(
    "terrain-camera",
    -Math.PI / 2.3,
    1.05,
    170,
    new Vector3(0, 8, 0),
    scene,
  );
  camera.attachControl(canvas, true);
  camera.lowerBetaLimit = 0.32;
  camera.upperBetaLimit = Math.PI / 2.01;
  camera.lowerRadiusLimit = 35;
  camera.upperRadiusLimit = 360;
  camera.wheelDeltaPercentage = 0.01;
  camera.panningSensibility = 80;

  const hemisphericLight = new HemisphericLight(
    "hemi-light",
    new Vector3(0.2, 1, -0.3),
    scene,
  );
  hemisphericLight.intensity = 0.8;
  hemisphericLight.diffuse = new Color3(0.96, 0.9, 0.82);
  hemisphericLight.groundColor = new Color3(0.13, 0.11, 0.09);

  const directionalLight = new DirectionalLight(
    "sun-light",
    new Vector3(-0.45, -1, 0.2),
    scene,
  );
  directionalLight.position = new Vector3(40, 90, -25);
  directionalLight.intensity = 1.28;
  directionalLight.diffuse = new Color3(1, 0.92, 0.8);

  const handleResize = (): void => {
    engine.resize();
  };

  window.addEventListener("resize", handleResize);

  return {
    engine,
    scene,
    camera,
    dispose: () => {
      window.removeEventListener("resize", handleResize);
      scene.dispose();
      engine.dispose();
    },
  };
}

export function frameCameraOnTerrain(camera: ArcRotateCamera, terrain: TerrainData): void {
  const terrainSpan = (terrain.grid.width - 1) * terrain.cellSize;
  const heightSpan = terrain.maxHeight - terrain.minHeight;
  const focusHeight = terrain.minHeight + heightSpan * 0.33;

  camera.setTarget(new Vector3(0, focusHeight, 0));
  camera.radius = Math.max(terrainSpan * 0.92, 90);
  camera.lowerRadiusLimit = Math.max(terrainSpan * 0.22, 24);
  camera.upperRadiusLimit = terrainSpan * 3.25;
}
