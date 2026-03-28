import type { PlantSelectionDiagnostics } from "../sim/PlantDiagnostics";
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
  setPlantInspection: (selection: PlantSelectionDiagnostics | null) => void;
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
  const seasonViewInput = queryElement<HTMLInputElement>("seasonViewInput");
  const vegetationViewInput = queryElement<HTMLInputElement>("vegetationViewInput");
  const climateOverlayInput = queryElement<HTMLSelectElement>("climateOverlayInput");
  const plantDiagnosticOverlayInput = queryElement<HTMLSelectElement>("plantDiagnosticOverlayInput");
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
  const recentPlantColonizationsValue = queryElement<HTMLElement>("recentPlantColonizationsValue");
  const recentPlantDeathsValue = queryElement<HTMLElement>("recentPlantDeathsValue");
  const recentPlantExtinctionsValue = queryElement<HTMLElement>("recentPlantExtinctionsValue");
  const averagePlantReproductionValue = queryElement<HTMLElement>("averagePlantReproductionValue");
  const plantPhenotypeValue = queryElement<HTMLElement>("plantPhenotypeValue");
  const plantPressureValue = queryElement<HTMLElement>("plantPressureValue");
  const plantSeasonalActivityValue = queryElement<HTMLElement>("plantSeasonalActivityValue");
  const plantSeasonalSuppressionValue = queryElement<HTMLElement>("plantSeasonalSuppressionValue");
  const plantExpandingLineagesValue = queryElement<HTMLElement>("plantExpandingLineagesValue");
  const plantDecliningLineagesValue = queryElement<HTMLElement>("plantDecliningLineagesValue");
  const plantInspectCellValue = queryElement<HTMLElement>("plantInspectCellValue");
  const plantInspectOccupancyValue = queryElement<HTMLElement>("plantInspectOccupancyValue");
  const plantInspectLineageValue = queryElement<HTMLElement>("plantInspectLineageValue");
  const plantInspectSpeciesValue = queryElement<HTMLElement>("plantInspectSpeciesValue");
  const plantInspectParentValue = queryElement<HTMLElement>("plantInspectParentValue");
  const plantInspectGenerationValue = queryElement<HTMLElement>("plantInspectGenerationValue");
  const plantInspectAgeValue = queryElement<HTMLElement>("plantInspectAgeValue");
  const plantInspectStageValue = queryElement<HTMLElement>("plantInspectStageValue");
  const plantInspectBiomassValue = queryElement<HTMLElement>("plantInspectBiomassValue");
  const plantInspectHealthValue = queryElement<HTMLElement>("plantInspectHealthValue");
  const plantInspectReserveValue = queryElement<HTMLElement>("plantInspectReserveValue");
  const plantInspectActivityValue = queryElement<HTMLElement>("plantInspectActivityValue");
  const plantInspectFoliageValue = queryElement<HTMLElement>("plantInspectFoliageValue");
  const plantInspectMaturityValue = queryElement<HTMLElement>("plantInspectMaturityValue");
  const plantInspectStageProgressValue = queryElement<HTMLElement>("plantInspectStageProgressValue");
  const plantInspectReproductionValue = queryElement<HTMLElement>("plantInspectReproductionValue");
  const plantInspectNetDeltaValue = queryElement<HTMLElement>("plantInspectNetDeltaValue");
  const plantInspectReserveDeltaValue = queryElement<HTMLElement>("plantInspectReserveDeltaValue");
  const plantInspectStressValue = queryElement<HTMLElement>("plantInspectStressValue");
  const plantInspectSurvivalMarginValue = queryElement<HTMLElement>("plantInspectSurvivalMarginValue");
  const plantInspectActivityDeltaValue = queryElement<HTMLElement>("plantInspectActivityDeltaValue");
  const plantInspectSoilMoistureValue = queryElement<HTMLElement>("plantInspectSoilMoistureValue");
  const plantInspectSurfaceWaterValue = queryElement<HTMLElement>("plantInspectSurfaceWaterValue");
  const plantInspectTemperatureValue = queryElement<HTMLElement>("plantInspectTemperatureValue");
  const plantInspectSlopeValue = queryElement<HTMLElement>("plantInspectSlopeValue");
  const plantInspectSoilDepthValue = queryElement<HTMLElement>("plantInspectSoilDepthValue");
  const plantInspectCoarseValue = queryElement<HTMLElement>("plantInspectCoarseValue");
  const plantInspectBedrockValue = queryElement<HTMLElement>("plantInspectBedrockValue");
  const plantInspectSeasonValue = queryElement<HTMLElement>("plantInspectSeasonValue");
  const plantInspectRunoffValue = queryElement<HTMLElement>("plantInspectRunoffValue");
  const plantInspectInfiltrationValue = queryElement<HTMLElement>("plantInspectInfiltrationValue");
  const plantInspectCohesionValue = queryElement<HTMLElement>("plantInspectCohesionValue");
  const plantInspectRootBindingValue = queryElement<HTMLElement>("plantInspectRootBindingValue");
  const plantInspectOrganicCoverValue = queryElement<HTMLElement>("plantInspectOrganicCoverValue");
  const plantInspectResistanceValue = queryElement<HTMLElement>("plantInspectResistanceValue");
  const plantInspectTotalGainsValue = queryElement<HTMLElement>("plantInspectTotalGainsValue");
  const plantInspectTotalLossesValue = queryElement<HTMLElement>("plantInspectTotalLossesValue");
  const plantInspectGrowthGainValue = queryElement<HTMLElement>("plantInspectGrowthGainValue");
  const plantInspectDeclineLossValue = queryElement<HTMLElement>("plantInspectDeclineLossValue");
  const plantInspectMaintenanceLossValue = queryElement<HTMLElement>("plantInspectMaintenanceLossValue");
  const plantInspectDroughtLossValue = queryElement<HTMLElement>("plantInspectDroughtLossValue");
  const plantInspectReserveGainValue = queryElement<HTMLElement>("plantInspectReserveGainValue");
  const plantInspectReserveUseValue = queryElement<HTMLElement>("plantInspectReserveUseValue");
  const plantInspectOpportunityValue = queryElement<HTMLElement>("plantInspectOpportunityValue");
  const plantInspectUnfavorableValue = queryElement<HTMLElement>("plantInspectUnfavorableValue");
  const plantInspectGrowthPotentialValue = queryElement<HTMLElement>("plantInspectGrowthPotentialValue");
  const plantInspectCapacityPressureValue = queryElement<HTMLElement>("plantInspectCapacityPressureValue");
  const plantInspectEffectiveCapacityValue = queryElement<HTMLElement>("plantInspectEffectiveCapacityValue");
  const plantInspectEstablishmentBufferValue = queryElement<HTMLElement>("plantInspectEstablishmentBufferValue");
  const plantInspectEstablishmentFloorValue = queryElement<HTMLElement>("plantInspectEstablishmentFloorValue");
  const plantInspectTemperatureStressValue = queryElement<HTMLElement>("plantInspectTemperatureStressValue");
  const plantInspectFloodLossValue = queryElement<HTMLElement>("plantInspectFloodLossValue");
  const plantInspectSlopeLossValue = queryElement<HTMLElement>("plantInspectSlopeLossValue");
  const plantInspectStorageReliefValue = queryElement<HTMLElement>("plantInspectStorageReliefValue");
  const plantInspectStandingWaterLossValue = queryElement<HTMLElement>("plantInspectStandingWaterLossValue");
  const plantInspectGrowthBlockValue = queryElement<HTMLElement>("plantInspectGrowthBlockValue");
  const plantInspectArmoringValue = queryElement<HTMLElement>("plantInspectArmoringValue");
  const plantInspectBankStabilityValue = queryElement<HTMLElement>("plantInspectBankStabilityValue");
  const plantInspectDetachmentThresholdValue = queryElement<HTMLElement>("plantInspectDetachmentThresholdValue");
  const plantInspectErosivePowerValue = queryElement<HTMLElement>("plantInspectErosivePowerValue");
  const plantInspectExplanationValue = queryElement<HTMLElement>("plantInspectExplanationValue");
  const plantInspectReproductionSummary = queryElement<HTMLElement>("plantInspectReproductionSummary");
  const plantInspectBudgetSummary = queryElement<HTMLElement>("plantInspectBudgetSummary");
  const plantInspectResourceSummary = queryElement<HTMLElement>("plantInspectResourceSummary");
  const plantInspectSeasonalSummary = queryElement<HTMLElement>("plantInspectSeasonalSummary");
  const plantInspectDeclineSummary = queryElement<HTMLElement>("plantInspectDeclineSummary");
  const plantInspectFitnessSummary = queryElement<HTMLElement>("plantInspectFitnessSummary");
  const plantInspectLastOccupantValue = queryElement<HTMLElement>("plantInspectLastOccupantValue");
  const plantInspectHistoryBiomass = queryElement<HTMLElement>("plantInspectHistoryBiomass");
  const plantInspectHistoryReserve = queryElement<HTMLElement>("plantInspectHistoryReserve");
  const plantInspectHistoryMoisture = queryElement<HTMLElement>("plantInspectHistoryMoisture");
  const plantInspectHistoryStress = queryElement<HTMLElement>("plantInspectHistoryStress");
  const plantInspectHistoryReproduction = queryElement<HTMLElement>("plantInspectHistoryReproduction");
  const plantInspectTraitsEcology = queryElement<HTMLElement>("plantInspectTraitsEcology");
  const plantInspectTraitsMorphology = queryElement<HTMLElement>("plantInspectTraitsMorphology");
  const plantInspectTraitsSeasonal = queryElement<HTMLElement>("plantInspectTraitsSeasonal");

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
      showSeason: seasonViewInput.checked,
      showVegetation: vegetationViewInput.checked,
      climateOverlay: climateOverlayInput.value as WaterOverlayViewOptions["climateOverlay"],
      plantDiagnosticOverlay: plantDiagnosticOverlayInput.value as WaterOverlayViewOptions["plantDiagnosticOverlay"],
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
  seasonViewInput.checked = initialState.viewOptions.showSeason;
  vegetationViewInput.checked = initialState.viewOptions.showVegetation;
  climateOverlayInput.value = initialState.viewOptions.climateOverlay;
  plantDiagnosticOverlayInput.value = initialState.viewOptions.plantDiagnosticOverlay;
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
  seasonViewInput.addEventListener("change", emitViewOptions);
  vegetationViewInput.addEventListener("change", emitViewOptions);
  climateOverlayInput.addEventListener("change", emitViewOptions);
  plantDiagnosticOverlayInput.addEventListener("change", emitViewOptions);

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
      recentPlantColonizationsValue.textContent = summary.population.recentColonizations.toString();
      recentPlantDeathsValue.textContent = summary.population.recentDeaths.toString();
      recentPlantExtinctionsValue.textContent = summary.population.recentExtinctions.toString();
      averagePlantReproductionValue.textContent = summary.population.averageReproductionReadiness.toFixed(2);
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
      plantExpandingLineagesValue.textContent = `Top expanding: ${summary.population.topExpandingLineages}`;
      plantDecliningLineagesValue.textContent = `Top declining: ${summary.population.topDecliningLineages}`;
    },
    setPlantInspection: (selection: PlantSelectionDiagnostics | null) => {
      if (!selection) {
        plantInspectCellValue.textContent = "none";
        plantInspectOccupancyValue.textContent = "no";
        plantInspectLineageValue.textContent = "none";
        plantInspectSpeciesValue.textContent = "-";
        plantInspectParentValue.textContent = "-";
        plantInspectGenerationValue.textContent = "-";
        plantInspectAgeValue.textContent = "0.0 s";
        plantInspectStageValue.textContent = "-";
        plantInspectBiomassValue.textContent = "0.00";
        plantInspectHealthValue.textContent = "0.00";
        plantInspectReserveValue.textContent = "0.00";
        plantInspectActivityValue.textContent = "0.00";
        plantInspectFoliageValue.textContent = "0.00";
        plantInspectMaturityValue.textContent = "0.00";
        plantInspectStageProgressValue.textContent = "0.00";
        plantInspectReproductionValue.textContent = "0.00";
        plantInspectNetDeltaValue.textContent = "0.000";
        plantInspectReserveDeltaValue.textContent = "0.000";
        plantInspectStressValue.textContent = "mixed";
        plantInspectSurvivalMarginValue.textContent = "0.000";
        plantInspectActivityDeltaValue.textContent = "0.000";
        plantInspectSoilMoistureValue.textContent = "0.00";
        plantInspectSurfaceWaterValue.textContent = "0.000";
        plantInspectTemperatureValue.textContent = "0.00";
        plantInspectSlopeValue.textContent = "0.00";
        plantInspectSoilDepthValue.textContent = "0.00";
        plantInspectCoarseValue.textContent = "0.00";
        plantInspectBedrockValue.textContent = "0.00";
        plantInspectSeasonValue.textContent = "-";
        plantInspectRunoffValue.textContent = "0.00";
        plantInspectInfiltrationValue.textContent = "0.00";
        plantInspectCohesionValue.textContent = "0.00";
        plantInspectRootBindingValue.textContent = "0.00";
        plantInspectOrganicCoverValue.textContent = "0.00";
        plantInspectResistanceValue.textContent = "0.00";
        plantInspectTotalGainsValue.textContent = "0.000";
        plantInspectTotalLossesValue.textContent = "0.000";
        plantInspectGrowthGainValue.textContent = "0.000";
        plantInspectDeclineLossValue.textContent = "0.000";
        plantInspectMaintenanceLossValue.textContent = "0.000";
        plantInspectDroughtLossValue.textContent = "0.000";
        plantInspectReserveGainValue.textContent = "0.000";
        plantInspectReserveUseValue.textContent = "0.000";
        plantInspectOpportunityValue.textContent = "0.00";
        plantInspectUnfavorableValue.textContent = "0.00";
        plantInspectGrowthPotentialValue.textContent = "0.00";
        plantInspectCapacityPressureValue.textContent = "0.00";
        plantInspectEffectiveCapacityValue.textContent = "0.00";
        plantInspectEstablishmentBufferValue.textContent = "0.00";
        plantInspectEstablishmentFloorValue.textContent = "0.000";
        plantInspectTemperatureStressValue.textContent = "0.00";
        plantInspectFloodLossValue.textContent = "0.000";
        plantInspectSlopeLossValue.textContent = "0.000";
        plantInspectStorageReliefValue.textContent = "0.000";
        plantInspectStandingWaterLossValue.textContent = "0.000";
        plantInspectGrowthBlockValue.textContent = "-";
        plantInspectArmoringValue.textContent = "0.00";
        plantInspectBankStabilityValue.textContent = "0.00";
        plantInspectDetachmentThresholdValue.textContent = "0.00";
        plantInspectErosivePowerValue.textContent = "0.00";
        plantInspectExplanationValue.textContent =
          "Click terrain in View mode to inspect a plant cell or empty habitat.";
        plantInspectReproductionSummary.textContent = "reproduction diagnostics unavailable";
        plantInspectBudgetSummary.textContent = "biomass budget unavailable";
        plantInspectResourceSummary.textContent = "resource allocation unavailable";
        plantInspectSeasonalSummary.textContent = "seasonal engine unavailable";
        plantInspectDeclineSummary.textContent = "decline diagnostics unavailable";
        plantInspectFitnessSummary.textContent = "fitness breakdown unavailable";
        plantInspectLastOccupantValue.textContent = "recent death diagnostics unavailable";
        plantInspectHistoryBiomass.textContent = "biomass history unavailable";
        plantInspectHistoryReserve.textContent = "reserve history unavailable";
        plantInspectHistoryMoisture.textContent = "moisture history unavailable";
        plantInspectHistoryStress.textContent = "stress history unavailable";
        plantInspectHistoryReproduction.textContent = "reproduction history unavailable";
        plantInspectTraitsEcology.textContent = "ecology traits unavailable";
        plantInspectTraitsMorphology.textContent = "morphology traits unavailable";
        plantInspectTraitsSeasonal.textContent = "seasonal traits unavailable";
        return;
      }

      plantInspectCellValue.textContent = `(${selection.cellX}, ${selection.cellY})`;
      plantInspectOccupancyValue.textContent = selection.occupied ? "yes" : "no";
      plantInspectLineageValue.textContent = selection.lineageLabel;
      plantInspectSpeciesValue.textContent = formatOptionalInteger(selection.speciesId);
      plantInspectParentValue.textContent = formatOptionalInteger(selection.parentSpeciesId);
      plantInspectGenerationValue.textContent = formatOptionalInteger(selection.generation);
      plantInspectAgeValue.textContent = `${selection.currentState.ageSeconds.toFixed(1)} s`;
      plantInspectStageValue.textContent = selection.currentState.developmentStage;
      plantInspectBiomassValue.textContent = selection.currentState.biomass.toFixed(2);
      plantInspectHealthValue.textContent = selection.currentState.health.toFixed(2);
      plantInspectReserveValue.textContent = selection.currentState.reserveLevel.toFixed(2);
      plantInspectActivityValue.textContent = selection.currentState.activityLevel.toFixed(2);
      plantInspectFoliageValue.textContent = selection.currentState.foliageLevel.toFixed(2);
      plantInspectMaturityValue.textContent = selection.currentState.maturityLevel.toFixed(2);
      plantInspectStageProgressValue.textContent = selection.currentState.developmentProgress.toFixed(2);
      plantInspectReproductionValue.textContent = selection.currentState.reproductionReadiness.toFixed(2);
      plantInspectNetDeltaValue.textContent = formatSigned(selection.budget.netBiomassDelta, 3);
      plantInspectReserveDeltaValue.textContent = formatSigned(selection.budget.reserveDelta, 3);
      plantInspectStressValue.textContent = selection.decline.dominantStress;
      plantInspectSurvivalMarginValue.textContent = formatSigned(selection.decline.survivalMargin, 3);
      plantInspectActivityDeltaValue.textContent = formatSigned(selection.budget.activityDelta, 3);
      plantInspectSoilMoistureValue.textContent = selection.environment.soilMoisture.toFixed(2);
      plantInspectSurfaceWaterValue.textContent = selection.environment.surfaceWater.toFixed(3);
      plantInspectTemperatureValue.textContent = selection.environment.temperature.toFixed(2);
      plantInspectSlopeValue.textContent = selection.environment.slope.toFixed(2);
      plantInspectSoilDepthValue.textContent = selection.environment.soilDepth.toFixed(2);
      plantInspectCoarseValue.textContent = selection.environment.coarseSurface.toFixed(2);
      plantInspectBedrockValue.textContent = selection.environment.bedrockExposure.toFixed(2);
      plantInspectSeasonValue.textContent =
        `${selection.environment.seasonLabel} | phase ${selection.environment.seasonPhase.toFixed(2)} | rain ${selection.environment.rainMultiplier.toFixed(2)}x | evap ${selection.environment.evaporationMultiplier.toFixed(2)}x`;
      plantInspectRunoffValue.textContent = selection.erosion.runoffShare.toFixed(2);
      plantInspectInfiltrationValue.textContent = selection.erosion.infiltrationShare.toFixed(2);
      plantInspectCohesionValue.textContent = selection.erosion.soilCohesion.toFixed(2);
      plantInspectRootBindingValue.textContent = selection.erosion.rootStabilization.toFixed(2);
      plantInspectOrganicCoverValue.textContent = selection.erosion.organicCover.toFixed(2);
      plantInspectResistanceValue.textContent = selection.erosion.combinedResistance.toFixed(2);
      plantInspectTotalGainsValue.textContent = selection.budget.totalGain.toFixed(3);
      plantInspectTotalLossesValue.textContent = selection.budget.totalLoss.toFixed(3);
      plantInspectGrowthGainValue.textContent = selection.budget.growthGain.toFixed(3);
      plantInspectDeclineLossValue.textContent = selection.budget.declineLoss.toFixed(3);
      plantInspectMaintenanceLossValue.textContent = selection.budget.maintenanceLoss.toFixed(3);
      plantInspectDroughtLossValue.textContent = selection.budget.droughtLoss.toFixed(3);
      plantInspectReserveGainValue.textContent = selection.budget.reserveGain.toFixed(3);
      plantInspectReserveUseValue.textContent = selection.budget.reserveUse.toFixed(3);
      plantInspectOpportunityValue.textContent = selection.budget.opportunity.toFixed(2);
      plantInspectUnfavorableValue.textContent = selection.budget.unfavorablePressure.toFixed(2);
      plantInspectGrowthPotentialValue.textContent = selection.budget.growthPotential.toFixed(2);
      plantInspectCapacityPressureValue.textContent = selection.budget.declinePressure.toFixed(2);
      plantInspectEffectiveCapacityValue.textContent = selection.budget.effectiveCarryingCapacity.toFixed(2);
      plantInspectEstablishmentBufferValue.textContent = selection.decline.establishmentBuffer.toFixed(2);
      plantInspectEstablishmentFloorValue.textContent = selection.budget.establishmentBiomassFloor.toFixed(3);
      plantInspectTemperatureStressValue.textContent = selection.decline.temperatureStress.toFixed(2);
      plantInspectFloodLossValue.textContent = selection.budget.floodLoss.toFixed(3);
      plantInspectSlopeLossValue.textContent = selection.budget.slopeLoss.toFixed(3);
      plantInspectStorageReliefValue.textContent = selection.budget.storageRelief.toFixed(3);
      plantInspectStandingWaterLossValue.textContent = selection.budget.standingWaterLoss.toFixed(3);
      plantInspectGrowthBlockValue.textContent = selection.budget.growthBlockReason;
      plantInspectArmoringValue.textContent = selection.erosion.armoring.toFixed(2);
      plantInspectBankStabilityValue.textContent = selection.erosion.bankStability.toFixed(2);
      plantInspectDetachmentThresholdValue.textContent = selection.erosion.detachmentThreshold.toFixed(2);
      plantInspectErosivePowerValue.textContent = selection.erosion.erosivePower.toFixed(2);
      plantInspectExplanationValue.textContent = selection.explanation;
      plantInspectReproductionSummary.textContent =
        `Reproduction: ${selection.reproduction.allowedLikely ? "allowed" : "blocked"} because ${selection.reproduction.blockedReason}. Readiness ${selection.currentState.reproductionReadiness.toFixed(2)}, reserve sufficiency ${selection.reproduction.reserveSufficiency.toFixed(2)}, support ${selection.reproduction.neighborSupport.toFixed(2)}.`;
      plantInspectBudgetSummary.textContent =
        `Biomass: ${formatSigned(selection.budget.netBiomassDelta, 3)} this step. Biggest gain ${describeLargestTerm(
          [
            ["growth", selection.budget.growthGain],
            ["colonization", selection.budget.colonizationGain],
            ["storage relief", selection.budget.storageRelief],
          ],
        )}. Biggest loss ${describeLargestTerm(
          [
            ["decline", selection.budget.declineLoss],
            ["maintenance", selection.budget.maintenanceLoss],
            ["drought", selection.budget.droughtLoss],
            ["flood", selection.budget.floodLoss],
            ["slope", selection.budget.slopeLoss],
            ["standing water", selection.budget.standingWaterLoss],
          ],
        )}. Effective capacity ${selection.budget.effectiveCarryingCapacity.toFixed(2)} vs biomass ${selection.currentState.biomass.toFixed(2)}; survival margin ${formatSigned(selection.decline.survivalMargin, 3)}.`;
      plantInspectResourceSummary.textContent =
        `Reserves: ${formatSigned(selection.budget.reserveDelta, 3)} because gain ${selection.budget.reserveGain.toFixed(3)} and use ${selection.budget.reserveUse.toFixed(3)}. Reserve use does not become biomass directly; it only feeds storage relief ${selection.budget.storageRelief.toFixed(3)} with relief boost ${selection.budget.reserveReliefBoost.toFixed(2)}.`;
      plantInspectSeasonalSummary.textContent =
        `Seasonal response: stage ${selection.currentState.developmentStage}, opportunity ${selection.budget.opportunity.toFixed(2)}, bad-season pressure ${selection.budget.unfavorablePressure.toFixed(2)}, target activity ${selection.budget.targetActivity.toFixed(2)}, growth scale ${selection.budget.growthScale.toFixed(2)}.`;
      plantInspectDeclineSummary.textContent =
        `Decline pressure: dominant ${selection.decline.dominantStress}. Establishment buffer ${selection.decline.establishmentBuffer.toFixed(2)}. Erosion setting: runoff ${selection.erosion.runoffShare.toFixed(2)}, cohesion ${selection.erosion.soilCohesion.toFixed(2)}, roots ${selection.erosion.rootStabilization.toFixed(2)}, organic cover ${selection.erosion.organicCover.toFixed(2)}.`;
      plantInspectFitnessSummary.textContent =
        `Habitat fit: suitability ${selection.fitness.suitability.toFixed(2)}, carrying capacity ${selection.fitness.carryingCapacity.toFixed(2)}, growth potential ${selection.budget.growthPotential.toFixed(2)}, decline pressure ${selection.budget.declinePressure.toFixed(2)}, competition ${selection.budget.competitionPressure.toFixed(2)}. Erosion gate: power ${selection.erosion.erosivePower.toFixed(2)} vs threshold ${selection.erosion.detachmentThreshold.toFixed(2)}, resistance ${selection.erosion.combinedResistance.toFixed(2)}.`;
      plantInspectLastOccupantValue.textContent = selection.lastOccupant
        ? `Last occupant: S${selection.lastOccupant.speciesId} · G${selection.lastOccupant.generation ?? 0} died from ${selection.lastOccupant.deathReason ?? "unknown cause"} at biomass ${selection.lastOccupant.biomassBeforeDeath.toFixed(2)} after ${selection.lastOccupant.ageSeconds.toFixed(1)} s`
        : "No recent death recorded on this cell";
      plantInspectHistoryBiomass.textContent = `Biomass history ${sparkline(selection.history.biomass)} | ${formatTrend(selection.history.biomass)}`;
      plantInspectHistoryReserve.textContent = `Reserve history ${sparkline(selection.history.reserve)} | ${formatTrend(selection.history.reserve)}`;
      plantInspectHistoryMoisture.textContent = `Moisture history ${sparkline(selection.history.moisture)} | ${formatTrend(selection.history.moisture)}`;
      plantInspectHistoryStress.textContent = `Stress history ${sparkline(selection.history.stress)} | ${formatTrend(selection.history.stress)}`;
      plantInspectHistoryReproduction.textContent =
        `Reproduction history ${sparkline(selection.history.reproduction)} | ${formatTrend(selection.history.reproduction)}`;
      plantInspectTraitsEcology.textContent = selection.traits
        ? `Ecology traits: ${formatMetricMap(selection.traits.ecology)}`
        : "Ecology traits unavailable for empty habitat";
      plantInspectTraitsMorphology.textContent = selection.traits
        ? `Morphology traits: ${formatMetricMap(selection.traits.morphology)}`
        : "Morphology traits unavailable for empty habitat";
      plantInspectTraitsSeasonal.textContent = selection.traits
        ? `Seasonal traits: ${formatMetricMap(selection.traits.seasonal)}`
        : "Seasonal traits unavailable for empty habitat";
    },
    getSandboxMode: () => sandboxMode,
    getSandboxBrushSize: () => Number(sandboxBrushInput.value),
    getSandboxStrength: () => Number(sandboxStrengthInput.value),
    getViewOptions: () => ({
      showRivers: riverViewInput.checked,
      showWaterDepth: waterDepthViewInput.checked,
      showMoisture: moistureViewInput.checked,
      showTemperature: temperatureViewInput.checked,
      showSeason: seasonViewInput.checked,
      showVegetation: vegetationViewInput.checked,
      climateOverlay: climateOverlayInput.value as WaterOverlayViewOptions["climateOverlay"],
      plantDiagnosticOverlay: plantDiagnosticOverlayInput.value as WaterOverlayViewOptions["plantDiagnosticOverlay"],
    }),
  };
}

function formatOptionalInteger(value: number | null): string {
  return value === null ? "-" : value.toString();
}

function formatSigned(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatMetricMap(record: Record<string, number>): string {
  return Object.entries(record)
    .map(([key, value]) => `${key} ${value.toFixed(2)}`)
    .join(", ");
}

function describeLargestTerm(entries: Array<[string, number]>): string {
  const [label, value] = entries.sort((left, right) => right[1] - left[1])[0] ?? ["none", 0];
  return `${label} ${value.toFixed(3)}`;
}

function formatTrend(values: number[]): string {
  if (values.length < 2) {
    return "no recent trend";
  }

  const start = values[0];
  const end = values[values.length - 1];
  const delta = end - start;
  if (Math.abs(delta) < 0.025) {
    return `stable (${end.toFixed(2)})`;
  }

  return `${delta > 0 ? "rising" : "falling"} ${Math.abs(delta).toFixed(2)} to ${end.toFixed(2)}`;
}

function sparkline(values: number[]): string {
  if (values.length === 0) {
    return "····";
  }

  const blocks = "▁▂▃▄▅▆▇█";
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  const span = Math.max(max - min, 1e-6);
  return values
    .map((value) => {
      const normalized = (value - min) / span;
      const blockIndex = Math.min(blocks.length - 1, Math.max(0, Math.round(normalized * (blocks.length - 1))));
      return blocks[blockIndex];
    })
    .join("");
}

function queryElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing required UI element: ${id}`);
  }

  return element as T;
}
