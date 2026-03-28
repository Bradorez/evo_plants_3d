import type { SimulationStats } from "../sim/Simulation";
import type { SandboxToolMode } from "../sim/Sandbox";
import type { VegetationDebugSummary } from "../sim/Vegetation";
import type { WaterOverlayViewOptions } from "../scene/waterOverlay";

export interface ControlsCallbacks {
  onToggleRunning: (running: boolean) => void;
  onResetSimulation: () => void;
  onRegenerateTerrain: () => void;
  onPlantVegetation: () => void;
  onRainIntensityChange: (value: number) => void;
  onSimulationSpeedChange: (value: number) => void;
  onViewOptionsChange: (value: WaterOverlayViewOptions) => void;
  onSandboxModeChange: (mode: SandboxToolMode) => void;
  onSandboxBrushSizeChange: (value: number) => void;
  onSandboxStrengthChange: (value: number) => void;
}

export interface ControlsInitialState {
  isRunning: boolean;
  rainIntensity: number;
  simulationSpeed: number;
  viewOptions: WaterOverlayViewOptions;
  sandboxMode: SandboxToolMode;
  sandboxBrushSize: number;
  sandboxStrength: number;
}

export interface ControlsApi {
  setRunning: (running: boolean) => void;
  setStats: (stats: SimulationStats) => void;
  setVegetationDebug: (summary: VegetationDebugSummary) => void;
  getSandboxMode: () => SandboxToolMode;
  getSandboxBrushSize: () => number;
  getSandboxStrength: () => number;
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
  const plantVegetationButton = queryElement<HTMLButtonElement>("plantVegetationButton");
  const sandboxViewButton = queryElement<HTMLButtonElement>("sandboxViewButton");
  const sandboxRockButton = queryElement<HTMLButtonElement>("sandboxRockButton");
  const sandboxUpliftButton = queryElement<HTMLButtonElement>("sandboxUpliftButton");
  const sandboxLowerButton = queryElement<HTMLButtonElement>("sandboxLowerButton");
  const sandboxPlanerButton = queryElement<HTMLButtonElement>("sandboxPlanerButton");
  const sandboxUniniformentButton = queryElement<HTMLButtonElement>("sandboxUniniformentButton");
  const sandboxWaterSourceButton = queryElement<HTMLButtonElement>("sandboxWaterSourceButton");
  const sandboxEraseSourceButton = queryElement<HTMLButtonElement>("sandboxEraseSourceButton");
  const sandboxBrushInput = queryElement<HTMLInputElement>("sandboxBrushInput");
  const sandboxBrushValue = queryElement<HTMLOutputElement>("sandboxBrushValue");
  const sandboxStrengthInput = queryElement<HTMLInputElement>("sandboxStrengthInput");
  const sandboxStrengthValue = queryElement<HTMLOutputElement>("sandboxStrengthValue");
  const rainIntensityInput = queryElement<HTMLInputElement>("rainIntensityInput");
  const rainIntensityValue = queryElement<HTMLOutputElement>("rainIntensityValue");
  const simulationSpeedInput = queryElement<HTMLInputElement>("simulationSpeedInput");
  const simulationSpeedValue = queryElement<HTMLOutputElement>("simulationSpeedValue");
  const riverViewInput = queryElement<HTMLInputElement>("riverViewInput");
  const waterDepthViewInput = queryElement<HTMLInputElement>("waterDepthViewInput");
  const moistureViewInput = queryElement<HTMLInputElement>("moistureViewInput");
  const temperatureViewInput = queryElement<HTMLInputElement>("temperatureViewInput");
  const vegetationViewInput = queryElement<HTMLInputElement>("vegetationViewInput");
  const seedValue = queryElement<HTMLElement>("seedValue");
  const timeValue = queryElement<HTMLElement>("timeValue");
  const waterValue = queryElement<HTMLElement>("waterValue");
  const peakFlowValue = queryElement<HTMLElement>("peakFlowValue");
  const waterSourceCountValue = queryElement<HTMLElement>("waterSourceCountValue");
  const seasonValue = queryElement<HTMLElement>("seasonValue");
  const seasonPhaseValue = queryElement<HTMLElement>("seasonPhaseValue");
  const seasonRainValue = queryElement<HTMLElement>("seasonRainValue");
  const seasonTempValue = queryElement<HTMLElement>("seasonTempValue");
  const seasonEvapValue = queryElement<HTMLElement>("seasonEvapValue");
  const plantSpeciesValue = queryElement<HTMLElement>("plantSpeciesValue");
  const activePlantSpeciesValue = queryElement<HTMLElement>("activePlantSpeciesValue");
  const livingPlantCellsValue = queryElement<HTMLElement>("livingPlantCellsValue");
  const plantCoverageValue = queryElement<HTMLElement>("plantCoverageValue");
  const densePlantCellsValue = queryElement<HTMLElement>("densePlantCellsValue");
  const averagePlantBiomassValue = queryElement<HTMLElement>("averagePlantBiomassValue");
  const dominantPhenotypeValue = queryElement<HTMLElement>("dominantPhenotypeValue");
  const dominantPressureValue = queryElement<HTMLElement>("dominantPressureValue");
  const averagePlantAgeValue = queryElement<HTMLElement>("averagePlantAgeValue");
  const averagePlantLifespanValue = queryElement<HTMLElement>("averagePlantLifespanValue");
  const oldestPlantValue = queryElement<HTMLElement>("oldestPlantValue");
  const averagePlantActivityValue = queryElement<HTMLElement>("averagePlantActivityValue");
  const averagePlantDormancyValue = queryElement<HTMLElement>("averagePlantDormancyValue");
  const plantPhenotypeValue = queryElement<HTMLElement>("plantPhenotypeValue");
  const plantPressureValue = queryElement<HTMLElement>("plantPressureValue");
  const plantSeasonalActivityValue = queryElement<HTMLElement>("plantSeasonalActivityValue");
  const plantSeasonalSuppressionValue = queryElement<HTMLElement>("plantSeasonalSuppressionValue");

  let isRunning = initialState.isRunning;
  let sandboxMode = initialState.sandboxMode;

  const updateRunningText = (): void => {
    toggleSimulationButton.textContent = isRunning ? "Pause" : "Start";
  };

  const updateRainValue = (): void => {
    rainIntensityValue.textContent = Number(rainIntensityInput.value).toFixed(2);
  };

  const updateSpeedValue = (): void => {
    simulationSpeedValue.textContent = `${Number(simulationSpeedInput.value).toFixed(2)}x`;
  };

  const updateSandboxBrushValue = (): void => {
    sandboxBrushValue.textContent = Number(sandboxBrushInput.value).toFixed(0);
  };

  const updateSandboxStrengthValue = (): void => {
    sandboxStrengthValue.textContent = Number(sandboxStrengthInput.value).toFixed(1);
  };

  const updateSandboxModeButtons = (): void => {
    const buttons: Array<[HTMLButtonElement, SandboxToolMode]> = [
      [sandboxViewButton, "view"],
      [sandboxRockButton, "add_rock"],
      [sandboxUpliftButton, "uplift"],
      [sandboxLowerButton, "lower"],
      [sandboxPlanerButton, "planer"],
      [sandboxUniniformentButton, "uniniforment"],
      [sandboxWaterSourceButton, "water_source"],
      [sandboxEraseSourceButton, "erase_water_source"],
    ];

    for (const [button, mode] of buttons) {
      button.classList.toggle("tool-button-active", sandboxMode === mode);
    }
  };

  const emitViewOptions = (): void => {
    callbacks.onViewOptionsChange({
      showRivers: riverViewInput.checked,
      showWaterDepth: waterDepthViewInput.checked,
      showMoisture: moistureViewInput.checked,
      showTemperature: temperatureViewInput.checked,
      showVegetation: vegetationViewInput.checked,
    });
  };

  rainIntensityInput.value = initialState.rainIntensity.toString();
  simulationSpeedInput.value = initialState.simulationSpeed.toString();
  sandboxBrushInput.value = initialState.sandboxBrushSize.toString();
  sandboxStrengthInput.value = initialState.sandboxStrength.toString();
  riverViewInput.checked = initialState.viewOptions.showRivers;
  waterDepthViewInput.checked = initialState.viewOptions.showWaterDepth;
  moistureViewInput.checked = initialState.viewOptions.showMoisture;
  temperatureViewInput.checked = initialState.viewOptions.showTemperature;
  vegetationViewInput.checked = initialState.viewOptions.showVegetation;
  updateRunningText();
  updateRainValue();
  updateSpeedValue();
  updateSandboxBrushValue();
  updateSandboxStrengthValue();
  updateSandboxModeButtons();

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

  plantVegetationButton.addEventListener("click", () => {
    callbacks.onPlantVegetation();
  });

  const setSandboxMode = (mode: SandboxToolMode): void => {
    sandboxMode = mode;
    updateSandboxModeButtons();
    callbacks.onSandboxModeChange(mode);
  };

  sandboxViewButton.addEventListener("click", () => {
    setSandboxMode("view");
  });
  sandboxRockButton.addEventListener("click", () => {
    setSandboxMode("add_rock");
  });
  sandboxUpliftButton.addEventListener("click", () => {
    setSandboxMode("uplift");
  });
  sandboxLowerButton.addEventListener("click", () => {
    setSandboxMode("lower");
  });
  sandboxPlanerButton.addEventListener("click", () => {
    setSandboxMode("planer");
  });
  sandboxUniniformentButton.addEventListener("click", () => {
    setSandboxMode("uniniforment");
  });
  sandboxWaterSourceButton.addEventListener("click", () => {
    setSandboxMode("water_source");
  });
  sandboxEraseSourceButton.addEventListener("click", () => {
    setSandboxMode("erase_water_source");
  });

  sandboxBrushInput.addEventListener("input", () => {
    updateSandboxBrushValue();
    callbacks.onSandboxBrushSizeChange(Number(sandboxBrushInput.value));
  });

  sandboxStrengthInput.addEventListener("input", () => {
    updateSandboxStrengthValue();
    callbacks.onSandboxStrengthChange(Number(sandboxStrengthInput.value));
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
  moistureViewInput.addEventListener("change", emitViewOptions);
  temperatureViewInput.addEventListener("change", emitViewOptions);
  vegetationViewInput.addEventListener("change", emitViewOptions);

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
      waterSourceCountValue.textContent = stats.activeWaterSources.toString();
      seasonValue.textContent = stats.seasonLabel;
      seasonPhaseValue.textContent = stats.seasonPhase.toFixed(2);
      seasonRainValue.textContent = `${stats.rainfallMultiplier.toFixed(2)}x`;
      seasonTempValue.textContent = `${stats.temperatureOffset >= 0 ? "+" : ""}${stats.temperatureOffset.toFixed(2)}`;
      seasonEvapValue.textContent = `${stats.evaporationMultiplier.toFixed(2)}x`;
    },
    setVegetationDebug: (summary: VegetationDebugSummary) => {
      const entries = Object.entries(summary.lineageCounts).sort((left, right) => right[1] - left[1]);
      const pressureEntries = Object.entries(summary.pressureCounts).sort((left, right) => right[1] - left[1]);
      plantSpeciesValue.textContent = summary.speciesCount.toString();
      activePlantSpeciesValue.textContent = summary.activeSpeciesCount.toString();
      livingPlantCellsValue.textContent = summary.livingCellCount.toString();
      plantCoverageValue.textContent = `${summary.occupiedPercent.toFixed(1)}%`;
      densePlantCellsValue.textContent = summary.denseCellCount.toString();
      averagePlantBiomassValue.textContent = summary.averageBiomass.toFixed(2);
      dominantPhenotypeValue.textContent = summary.dominantLineage;
      dominantPressureValue.textContent = summary.dominantPressure;
      averagePlantAgeValue.textContent = `${summary.averageLiveAgeSeconds.toFixed(1)} s`;
      averagePlantLifespanValue.textContent =
        summary.averageCompletedLifespanSeconds > 0
          ? `${summary.averageCompletedLifespanSeconds.toFixed(1)} s`
          : "n/a";
      oldestPlantValue.textContent = `${summary.oldestLiveAgeSeconds.toFixed(1)} s`;
      averagePlantActivityValue.textContent = summary.averageActivityLevel.toFixed(2);
      averagePlantDormancyValue.textContent = summary.averageDormancyPressure.toFixed(2);
      plantPhenotypeValue.textContent =
        entries.length > 0
          ? `${entries
              .slice(0, 4)
              .map(([label, count]) => `${label} ${count}`)
              .join(", ")} | wood ${summary.averageWoodiness.toFixed(2)}, stature ${summary.averageStature.toFixed(2)}, cover ${summary.averageCoverage.toFixed(2)}`
          : `no established lineages | wood ${summary.averageWoodiness.toFixed(2)}, stature ${summary.averageStature.toFixed(2)}, cover ${summary.averageCoverage.toFixed(2)}`;
      plantPressureValue.textContent =
        pressureEntries.length > 0
          ? `${pressureEntries.map(([label, count]) => `${label} ${count}`).join(", ")} | maint ${summary.averageMaintenanceCost.toFixed(2)}, comp ${summary.averageCompetitionStrength.toFixed(2)}, drought ${summary.averageDroughtBurden.toFixed(2)}, flood ${summary.averageFloodSuitability.toFixed(2)}, terrain ${summary.averageTerrainStability.toFixed(2)}, spread ${summary.averageSpreadDrive.toFixed(2)}`
          : `maint ${summary.averageMaintenanceCost.toFixed(2)}, comp ${summary.averageCompetitionStrength.toFixed(2)}, drought ${summary.averageDroughtBurden.toFixed(2)}, flood ${summary.averageFloodSuitability.toFixed(2)}, terrain ${summary.averageTerrainStability.toFixed(2)}, spread ${summary.averageSpreadDrive.toFixed(2)}`;
      plantSeasonalActivityValue.textContent = `${summary.seasonalActivitySummary} | avg activity ${summary.averageActivityLevel.toFixed(2)}, reserve ${summary.averageReserveLevel.toFixed(2)}, foliage ${summary.averageFoliageLevel.toFixed(2)}`;
      plantSeasonalSuppressionValue.textContent = `${summary.seasonalSuppressionSummary} | dormancy ${summary.averageDormancyPressure.toFixed(2)}`;
    },
    getSandboxMode: () => sandboxMode,
    getSandboxBrushSize: () => Number(sandboxBrushInput.value),
    getSandboxStrength: () => Number(sandboxStrengthInput.value),
    getViewOptions: () => ({
      showRivers: riverViewInput.checked,
      showWaterDepth: waterDepthViewInput.checked,
      showMoisture: moistureViewInput.checked,
      showTemperature: temperatureViewInput.checked,
      showVegetation: vegetationViewInput.checked,
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
