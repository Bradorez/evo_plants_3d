import type { SimulationStats } from "../sim/Simulation";
import type { WaterOverlayViewOptions } from "../scene/waterOverlay";

export interface ControlsCallbacks {
  onToggleRunning: (running: boolean) => void;
  onResetSimulation: () => void;
  onRegenerateTerrain: () => void;
  onRainIntensityChange: (value: number) => void;
  onSimulationSpeedChange: (value: number) => void;
  onViewOptionsChange: (value: WaterOverlayViewOptions) => void;
}

export interface ControlsInitialState {
  isRunning: boolean;
  rainIntensity: number;
  simulationSpeed: number;
  viewOptions: WaterOverlayViewOptions;
}

export interface ControlsApi {
  setRunning: (running: boolean) => void;
  setStats: (stats: SimulationStats) => void;
  getViewOptions: () => WaterOverlayViewOptions;
}

/**
 * The UI module is deliberately DOM-focused and framework-free.
 * It owns reading and writing control values so the rest of the app only deals
 * with typed callbacks and simulation state.
 */
export function createControls(
  callbacks: ControlsCallbacks,
  initialState: ControlsInitialState,
): ControlsApi {
  const toggleSimulationButton = queryElement<HTMLButtonElement>("toggleSimulationButton");
  const resetSimulationButton = queryElement<HTMLButtonElement>("resetSimulationButton");
  const regenerateTerrainButton = queryElement<HTMLButtonElement>("regenerateTerrainButton");
  const rainIntensityInput = queryElement<HTMLInputElement>("rainIntensityInput");
  const rainIntensityValue = queryElement<HTMLOutputElement>("rainIntensityValue");
  const simulationSpeedInput = queryElement<HTMLInputElement>("simulationSpeedInput");
  const simulationSpeedValue = queryElement<HTMLOutputElement>("simulationSpeedValue");
  const riverViewInput = queryElement<HTMLInputElement>("riverViewInput");
  const waterDepthViewInput = queryElement<HTMLInputElement>("waterDepthViewInput");
  const seedValue = queryElement<HTMLElement>("seedValue");
  const timeValue = queryElement<HTMLElement>("timeValue");
  const waterValue = queryElement<HTMLElement>("waterValue");
  const peakFlowValue = queryElement<HTMLElement>("peakFlowValue");

  let isRunning = initialState.isRunning;

  const updateRunningText = (): void => {
    toggleSimulationButton.textContent = isRunning ? "Pause" : "Start";
  };

  const updateRainValue = (): void => {
    rainIntensityValue.textContent = Number(rainIntensityInput.value).toFixed(2);
  };

  const updateSpeedValue = (): void => {
    simulationSpeedValue.textContent = `${Number(simulationSpeedInput.value).toFixed(2)}x`;
  };

  const emitViewOptions = (): void => {
    callbacks.onViewOptionsChange({
      showRivers: riverViewInput.checked,
      showWaterDepth: waterDepthViewInput.checked,
    });
  };

  rainIntensityInput.value = initialState.rainIntensity.toString();
  simulationSpeedInput.value = initialState.simulationSpeed.toString();
  riverViewInput.checked = initialState.viewOptions.showRivers;
  waterDepthViewInput.checked = initialState.viewOptions.showWaterDepth;
  updateRunningText();
  updateRainValue();
  updateSpeedValue();

  toggleSimulationButton.addEventListener("click", () => {
    isRunning = !isRunning;
    updateRunningText();
    callbacks.onToggleRunning(isRunning);
  });

  resetSimulationButton.addEventListener("click", () => {
    callbacks.onResetSimulation();
  });

  regenerateTerrainButton.addEventListener("click", () => {
    callbacks.onRegenerateTerrain();
  });

  rainIntensityInput.addEventListener("input", () => {
    updateRainValue();
    callbacks.onRainIntensityChange(Number(rainIntensityInput.value));
  });

  simulationSpeedInput.addEventListener("input", () => {
    updateSpeedValue();
    callbacks.onSimulationSpeedChange(Number(simulationSpeedInput.value));
  });

  riverViewInput.addEventListener("change", emitViewOptions);
  waterDepthViewInput.addEventListener("change", emitViewOptions);

  return {
    setRunning: (running: boolean) => {
      isRunning = running;
      updateRunningText();
    },
    setStats: (stats: SimulationStats) => {
      seedValue.textContent = stats.seed.toString();
      timeValue.textContent = `${stats.elapsedTimeSeconds.toFixed(1)} s`;
      waterValue.textContent = stats.totalWater.toFixed(3);
      peakFlowValue.textContent = stats.peakFlow.toFixed(3);
    },
    getViewOptions: () => ({
      showRivers: riverViewInput.checked,
      showWaterDepth: waterDepthViewInput.checked,
    }),
  };
}

function queryElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing required UI element: ${id}`);
  }

  return element as T;
}
