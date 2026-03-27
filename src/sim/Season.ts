import { clamp, lerp } from "../utils/math";

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

/**
 * SeasonModel provides a lightweight recurring annual forcing curve shared by
 * rainfall, temperature, water loss, and plant ecology. It is intentionally
 * simple: one looping phase drives wet/dry and warm/cool signals through smooth
 * sinusoidal-style curves so the world gets readable seasonal variation
 * without becoming a full climate simulator.
 */
export class SeasonModel {
  public readonly settings: SeasonSettings = {
    yearLengthSeconds: 240,
    rainfallSeasonAmplitude: 0.5,
    temperatureSeasonAmplitude: 0.16,
    evaporationSeasonSensitivity: 0.38,
    soilDryingSeasonSensitivity: 0.32,
    plantGrowthSeasonSensitivity: 0.22,
    plantStressSeasonSensitivity: 0.32,
    rainfallPhaseOffset: -0.08,
    temperaturePhaseOffset: 0.12,
  };

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

  private recomputeState(): void {
    const yearLength = Math.max(1, this.settings.yearLengthSeconds);
    const year = Math.floor(this.elapsedSeconds / yearLength);
    const phase = (this.elapsedSeconds / yearLength) % 1;
    const wetSignal = this.sampleSeasonWave(phase + this.settings.rainfallPhaseOffset);
    const warmSignal = this.sampleSeasonWave(phase + this.settings.temperaturePhaseOffset);
    const wetAnomaly = wetSignal * 2 - 1;
    const warmAnomaly = warmSignal * 2 - 1;
    const dryAnomaly = -wetAnomaly;
    const mildTemperature = 1 - Math.abs(warmAnomaly);

    const rainfallMultiplier = clamp(
      1 + wetAnomaly * this.settings.rainfallSeasonAmplitude,
      0.18,
      2.25,
    );
    const temperatureOffset = warmAnomaly * this.settings.temperatureSeasonAmplitude;
    const evaporationMultiplier = clamp(
      1 +
        warmAnomaly * this.settings.evaporationSeasonSensitivity +
        dryAnomaly * 0.12,
      0.55,
      1.85,
    );
    const soilDryingMultiplier = clamp(
      1 +
        warmAnomaly * this.settings.soilDryingSeasonSensitivity +
        dryAnomaly * 0.16,
      0.58,
      1.8,
    );
    const plantGrowthMultiplier = clamp(
      1 +
        wetAnomaly * this.settings.plantGrowthSeasonSensitivity * 0.6 +
        (mildTemperature - 0.5) * this.settings.plantGrowthSeasonSensitivity * 0.8,
      0.68,
      1.35,
    );
    const plantStressMultiplier = clamp(
      1 +
        dryAnomaly * this.settings.plantStressSeasonSensitivity * 0.72 +
        Math.max(0, warmAnomaly) * this.settings.plantStressSeasonSensitivity * 0.65,
      0.72,
      1.65,
    );

    this.state = {
      phase,
      year,
      rainfallMultiplier,
      temperatureOffset,
      evaporationMultiplier,
      soilDryingMultiplier,
      plantGrowthMultiplier,
      plantStressMultiplier,
      seasonLabel: describeSeason(phase),
    };
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
