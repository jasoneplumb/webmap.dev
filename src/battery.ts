/**
 * Intent: Battery monitoring for projected battery life during trail recording
 * Context: Uses the Battery Status API (Chromium-based browsers); gracefully degrades when unavailable
 * Pattern: Capture battery level at recording start, track drain rate, project remaining time
 */
import type { AppState } from './types';

interface BatteryManager extends EventTarget {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
}

declare global {
  interface Navigator {
    getBattery?: () => Promise<BatteryManager>;
  }
}

/** Initialize battery monitoring. Safe to call on browsers without Battery Status API. */
export async function initBattery(state: AppState): Promise<void> {
  if (!navigator.getBattery) return;
  try {
    const battery = await navigator.getBattery();
    state.batteryLevel = battery.level;
    state.batteryCharging = battery.charging;
    battery.addEventListener('levelchange', () => {
      state.batteryLevel = battery.level;
    });
    battery.addEventListener('chargingchange', () => {
      state.batteryCharging = battery.charging;
    });
  } catch { /* Battery API unavailable or blocked by permissions policy */ }
}

/** Capture current battery level as the baseline for drain rate calculation. */
export function snapshotBatteryStart(state: AppState): void {
  state.batteryDrainStartLevel = state.batteryLevel;
  state.batteryDrainStartMs = performance.now();
}

/** Format battery estimate for display: "73% — ~4h 52m left" or just "73%". */
export function formatBatteryEstimate(state: AppState): string | null {
  if (state.batteryLevel === null) return null;
  const pct = `${Math.round(state.batteryLevel * 100)}%`;

  if (state.batteryCharging) return `${pct} (charging)`;
  if (state.batteryDrainStartLevel === null) return pct;

  const drained = state.batteryDrainStartLevel - state.batteryLevel;
  if (drained <= 0.005) return pct; // need at least 0.5% drain for useful estimate

  const elapsedHours = (performance.now() - state.batteryDrainStartMs) / 3_600_000;
  if (elapsedHours < 1 / 60) return pct; // need at least 1 minute of data

  const drainPerHour = drained / elapsedHours;
  if (drainPerHour <= 0) return pct;

  const hoursLeft = state.batteryLevel / drainPerHour;
  if (hoursLeft >= 1) {
    const h = Math.floor(hoursLeft);
    const m = Math.round((hoursLeft - h) * 60);
    return `${pct} — ~${h}h${m > 0 ? ` ${m}m` : ''} left`;
  }
  return `${pct} — ~${Math.round(hoursLeft * 60)}m left`;
}
