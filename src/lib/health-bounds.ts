// src/lib/health-bounds.ts
// Pure, dependency-free. Shared by the Apple Health parser (skip-and-count
// layer — G2 §6 "a single glitch value must never fail a batch") and by
// importHealthDaysBatch's Zod schema (strict whole-batch trust boundary).

export const HEALTH_DAY_BOUNDS = {
  activeKcal:  { min: 0, max: 20_000 },
  basalKcal:   { min: 0, max: 20_000 },
  steps:       { min: 0, max: 200_000 },
  exerciseMin: { min: 0, max: 1_440 },
  standHours:  { min: 0, max: 24 },
} as const;

export type MetricKey = "rhr" | "spo2" | "vo2max" | "sleep_hours" | "hrv";

export const METRIC_BOUNDS: Record<MetricKey, { min: number; max: number }> = {
  rhr:         { min: 20, max: 250 },
  spo2:        { min: 50, max: 100 },
  vo2max:      { min: 10, max: 100 },   // 100, not 90 — recorded elite maxima reach ~97
  sleep_hours: { min: 0,  max: 24 },
  hrv:         { min: 0,  max: 500 },
};
