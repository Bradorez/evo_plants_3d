import { clamp, lerp } from "../utils/math";
import type { Grid } from "./Grid";

export interface SeasonSettings {
  yearLengthSeconds: number;
  rainfallSeasonAmplitude: number;
  temperatureSeasonAmplitude: number;
  evaporationSeasonSensitivity: number;
  soilDryingSeasonSensitivity: number;
  plantGrowthSeasonSensitivity: number;
  plantStressSeasonSensitivity: number;
  rainfallPhaseOffset: number;
  temperaturePhaseOffset: number;
  regionalBlendStrength: number;
  regionalNoiseStrength: number;
  regionNorthWestPhaseOffset: number;
  regionNorthEastPhaseOffset: number;
  regionSouthWestPhaseOffset: number;
  regionSouthEastPhaseOffset: number;
}

export interface SeasonState {
  phase: number;
  year: number;
  rainfallMultiplier: number;
  temperatureOffset: number;
  evaporationMultiplier: number;
  soilDryingMultiplier: number;
  plantGrowthMultiplier: number;
  plantStressMultiplier: number;
  seasonLabel: string;
}

export interface LocalSeasonFields {
  phase: Float32Array;
  rainfallMultiplier: Float32Array;
  temperatureOffset: Float32Array;
  evaporationMultiplier: Float32Array;
  soilDryingMultiplier: Float32Array;
  plantGrowthMultiplier: Float32Array;
  plantStressMultiplier: Float32Array;
}

/**
 * SeasonModel provides a lightweight recurring annual forcing curve shared by
 * rainfall, temperature, water loss, and plant ecology. It is intentionally
 * simple: one looping phase drives wet/dry and warm/cool signals through smooth
 * sinusoidal-style curves so the world gets readable seasonal variation
 * without becoming a full climate simulator.
 */
export class SeasonModel {
  public readonly settings: SeasonSettings = {
    yearLengthSeconds: 720,
    rainfallSeasonAmplitude: 0.5,
    temperatureSeasonAmplitude: 0.16,
    evaporationSeasonSensitivity: 0.38,
    soilDryingSeasonSensitivity: 0.32,
    plantGrowthSeasonSensitivity: 0.22,
    plantStressSeasonSensitivity: 0.32,
    rainfallPhaseOffset: -0.08,
    temperaturePhaseOffset: 0.12,
    regionalBlendStrength: 0.92,
    regionalNoiseStrength: 0.04,
    regionNorthWestPhaseOffset: 0.0,
    regionNorthEastPhaseOffset: 0.18,
    regionSouthWestPhaseOffset: 0.36,
    regionSouthEastPhaseOffset: 0.56,
  };

  private localFields: LocalSeasonFields = {
    phase: new Float32Array(),
    rainfallMultiplier: new Float32Array(),
    temperatureOffset: new Float32Array(),
    evaporationMultiplier: new Float32Array(),
    soilDryingMultiplier: new Float32Array(),
    plantGrowthMultiplier: new Float32Array(),
    plantStressMultiplier: new Float32Array(),
  };
  private phaseOffsetField = new Float32Array();
  private seasonalAmplitudeField = new Float32Array();
  private climateStabilityField = new Float32Array();
  private phaseAnchorField = new Float32Array();
  private phaseWindowField = new Float32Array();
  private phaseLockStrength = 0.82;
  private elapsedSeconds = 0;
  private state: SeasonState = {
    phase: 0,
    year: 0,
    rainfallMultiplier: 1,
    temperatureOffset: 0,
    evaporationMultiplier: 1,
    soilDryingMultiplier: 1,
    plantGrowthMultiplier: 1,
    plantStressMultiplier: 1,
    seasonLabel: "Early Spring",
  };

  public rebuild(
    grid: Grid,
    seed: number,
    seasonalAmplitudeField?: Float32Array,
    climateStabilityField?: Float32Array,
    phaseAnchorField?: Float32Array,
    phaseWindowField?: Float32Array,
    phaseLockStrength = 0.82,
  ): void {
    this.phaseOffsetField = new Float32Array(grid.cellCount);
    this.seasonalAmplitudeField = seasonalAmplitudeField
      ? new Float32Array(seasonalAmplitudeField)
      : new Float32Array(grid.cellCount).fill(1);
    this.climateStabilityField = climateStabilityField
      ? new Float32Array(climateStabilityField)
      : new Float32Array(grid.cellCount);
    this.phaseAnchorField = phaseAnchorField
      ? new Float32Array(phaseAnchorField)
      : new Float32Array(grid.cellCount);
    this.phaseWindowField = phaseWindowField
      ? new Float32Array(phaseWindowField)
      : new Float32Array(grid.cellCount).fill(0.125);
    this.phaseLockStrength = phaseLockStrength;
    this.localFields = {
      phase: new Float32Array(grid.cellCount),
      rainfallMultiplier: new Float32Array(grid.cellCount),
      temperatureOffset: new Float32Array(grid.cellCount),
      evaporationMultiplier: new Float32Array(grid.cellCount),
      soilDryingMultiplier: new Float32Array(grid.cellCount),
      plantGrowthMultiplier: new Float32Array(grid.cellCount),
      plantStressMultiplier: new Float32Array(grid.cellCount),
    };

    const invWidth = 1 / Math.max(grid.width - 1, 1);
    const invHeight = 1 / Math.max(grid.height - 1, 1);

    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const index = grid.index(x, y);
        const nx = x * invWidth;
        const ny = y * invHeight;
        const blendedQuadrantOffset = this.sampleRegionalPhaseOffset(nx, ny);
        const broadNoise =
          Math.sin((nx * 1.7 + ny * 0.9 + (seed % 97) * 0.01) * Math.PI * 2) *
          Math.cos((ny * 1.3 - nx * 0.6 + (seed % 53) * 0.013) * Math.PI * 2) *
          this.settings.regionalNoiseStrength;
        this.phaseOffsetField[index] = ((blendedQuadrantOffset + broadNoise) % 1 + 1) % 1;
      }
    }

    this.recomputeState();
  }

  public step(dtSeconds: number): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return;
    }

    this.elapsedSeconds += dtSeconds;
    this.recomputeState();
  }

  public reset(): void {
    this.elapsedSeconds = 0;
    this.recomputeState();
  }

  public getState(): SeasonState {
    return this.state;
  }

  public getLocalFields(): LocalSeasonFields {
    return this.localFields;
  }

  private recomputeState(): void {
    const yearLength = Math.max(1, this.settings.yearLengthSeconds);
    const year = Math.floor(this.elapsedSeconds / yearLength);
    const phase = (this.elapsedSeconds / yearLength) % 1;
    const globalForcing = this.computeForcingForPhase(phase, 1);

    let rainSum = 0;
    let tempSum = 0;
    let evapSum = 0;
    let dryingSum = 0;
    let growthSum = 0;
    let stressSum = 0;

    for (let index = 0; index < this.phaseOffsetField.length; index += 1) {
      const stability = clamp(this.climateStabilityField[index], 0, 1);
      const dynamicPhase = ((phase + this.phaseOffsetField[index]) % 1 + 1) % 1;
      const anchorPhase = this.phaseAnchorField[index] || dynamicPhase;
      const motionScale = lerp(1, 0.01, Math.pow(stability, 0.7));
      const semiFrozenPhase = wrapPhase(
        anchorPhase + shortestPhaseDelta(anchorPhase, dynamicPhase) * motionScale,
      );
      const phaseLockBlend = clamp(
        stability * this.phaseLockStrength,
        0,
        0.995,
      );
      const localPhase = blendPhase(
        semiFrozenPhase,
        anchorPhase,
        phaseLockBlend,
      );
      const boundedPhase = clampPhaseToWindow(
        localPhase,
        anchorPhase,
        lerp(0.25, this.phaseWindowField[index] || 0.125, stability),
      );
      const forcing = this.computeForcingForPhase(
        boundedPhase,
        this.seasonalAmplitudeField[index] || 1,
      );
      this.localFields.phase[index] = boundedPhase;
      this.localFields.rainfallMultiplier[index] = forcing.rainfallMultiplier;
      this.localFields.temperatureOffset[index] = forcing.temperatureOffset;
      this.localFields.evaporationMultiplier[index] = forcing.evaporationMultiplier;
      this.localFields.soilDryingMultiplier[index] = forcing.soilDryingMultiplier;
      this.localFields.plantGrowthMultiplier[index] = forcing.plantGrowthMultiplier;
      this.localFields.plantStressMultiplier[index] = forcing.plantStressMultiplier;

      rainSum += forcing.rainfallMultiplier;
      tempSum += forcing.temperatureOffset;
      evapSum += forcing.evaporationMultiplier;
      dryingSum += forcing.soilDryingMultiplier;
      growthSum += forcing.plantGrowthMultiplier;
      stressSum += forcing.plantStressMultiplier;
    }

    const localCount = Math.max(this.phaseOffsetField.length, 1);

    this.state = {
      phase,
      year,
      rainfallMultiplier:
        this.phaseOffsetField.length > 0 ? rainSum / localCount : globalForcing.rainfallMultiplier,
      temperatureOffset:
        this.phaseOffsetField.length > 0 ? tempSum / localCount : globalForcing.temperatureOffset,
      evaporationMultiplier:
        this.phaseOffsetField.length > 0 ? evapSum / localCount : globalForcing.evaporationMultiplier,
      soilDryingMultiplier:
        this.phaseOffsetField.length > 0 ? dryingSum / localCount : globalForcing.soilDryingMultiplier,
      plantGrowthMultiplier:
        this.phaseOffsetField.length > 0 ? growthSum / localCount : globalForcing.plantGrowthMultiplier,
      plantStressMultiplier:
        this.phaseOffsetField.length > 0 ? stressSum / localCount : globalForcing.plantStressMultiplier,
      seasonLabel: describeSeason(phase),
    };
  }

  private computeForcingForPhase(phase: number, amplitudeScale: number) {
    const wetSignal = this.sampleSeasonWave(phase + this.settings.rainfallPhaseOffset);
    const warmSignal = this.sampleSeasonWave(phase + this.settings.temperaturePhaseOffset);
    const wetAnomaly = wetSignal * 2 - 1;
    const warmAnomaly = warmSignal * 2 - 1;
    const dryAnomaly = -wetAnomaly;
    const mildTemperature = 1 - Math.abs(warmAnomaly);
    const scaledWetAnomaly = wetAnomaly * amplitudeScale;
    const scaledWarmAnomaly = warmAnomaly * amplitudeScale;
    const scaledDryAnomaly = -scaledWetAnomaly;

    return {
      rainfallMultiplier: clamp(
        1 + scaledWetAnomaly * this.settings.rainfallSeasonAmplitude,
        0.18,
        2.25,
      ),
      temperatureOffset: scaledWarmAnomaly * this.settings.temperatureSeasonAmplitude,
      evaporationMultiplier: clamp(
        1 +
          scaledWarmAnomaly * this.settings.evaporationSeasonSensitivity +
          scaledDryAnomaly * 0.12,
        0.55,
        1.85,
      ),
      soilDryingMultiplier: clamp(
        1 +
          scaledWarmAnomaly * this.settings.soilDryingSeasonSensitivity +
          scaledDryAnomaly * 0.16,
        0.58,
        1.8,
      ),
      plantGrowthMultiplier: clamp(
        1 +
          scaledWetAnomaly * this.settings.plantGrowthSeasonSensitivity * 0.6 +
          (mildTemperature - 0.5) * this.settings.plantGrowthSeasonSensitivity * 0.8,
        0.68,
        1.35,
      ),
      plantStressMultiplier: clamp(
        1 +
          scaledDryAnomaly * this.settings.plantStressSeasonSensitivity * 0.72 +
          Math.max(0, scaledWarmAnomaly) * this.settings.plantStressSeasonSensitivity * 0.65,
        0.72,
        1.65,
      ),
    };
  }

  private sampleRegionalPhaseOffset(nx: number, ny: number): number {
    const smoothX = this.smoothBlend(nx);
    const smoothY = this.smoothBlend(ny);
    const north = lerp(
      this.settings.regionNorthWestPhaseOffset,
      this.settings.regionNorthEastPhaseOffset,
      smoothX,
    );
    const south = lerp(
      this.settings.regionSouthWestPhaseOffset,
      this.settings.regionSouthEastPhaseOffset,
      smoothX,
    );
    return ((lerp(north, south, smoothY) * this.settings.regionalBlendStrength) % 1 + 1) % 1;
  }

  private smoothBlend(value: number): number {
    const clamped = clamp(value, 0, 1);
    return clamped * clamped * (3 - 2 * clamped);
  }

  private sampleSeasonWave(phase: number): number {
    const wrapped = ((phase % 1) + 1) % 1;
    const radians = wrapped * Math.PI * 2;
    const smoothSin = Math.sin(radians);
    return clamp(lerp(0.5, 0.5 + smoothSin * 0.5, 0.92), 0, 1);
  }
}

function describeSeason(phase: number): string {
  const wrapped = ((phase % 1) + 1) % 1;

  if (wrapped < 0.125) {
    return "Early Spring";
  }
  if (wrapped < 0.25) {
    return "Late Spring";
  }
  if (wrapped < 0.375) {
    return "Early Summer";
  }
  if (wrapped < 0.5) {
    return "Late Summer";
  }
  if (wrapped < 0.625) {
    return "Early Autumn";
  }
  if (wrapped < 0.75) {
    return "Late Autumn";
  }
  if (wrapped < 0.875) {
    return "Early Winter";
  }

  return "Late Winter";
}

function blendPhase(fromPhase: number, toPhase: number, blend: number): number {
  const wrappedFrom = wrapPhase(fromPhase);
  const wrappedTo = wrapPhase(toPhase);
  return wrapPhase(wrappedFrom + shortestPhaseDelta(wrappedFrom, wrappedTo) * clamp(blend, 0, 1));
}

function clampPhaseToWindow(phase: number, center: number, halfWindow: number): number {
  const wrappedPhase = wrapPhase(phase);
  const wrappedCenter = wrapPhase(center);
  const delta = shortestPhaseDelta(wrappedCenter, wrappedPhase);
  const clampedDelta = clamp(delta, -Math.max(halfWindow, 0), Math.max(halfWindow, 0));
  return wrapPhase(wrappedCenter + clampedDelta);
}

function shortestPhaseDelta(fromPhase: number, toPhase: number): number {
  let delta = wrapPhase(toPhase) - wrapPhase(fromPhase);

  if (delta > 0.5) {
    delta -= 1;
  } else if (delta < -0.5) {
    delta += 1;
  }

  return delta;
}

function wrapPhase(phase: number): number {
  return ((phase % 1) + 1) % 1;
}
