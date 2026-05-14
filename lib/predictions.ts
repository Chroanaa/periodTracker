import type { Cycle, CycleStats, PredictionResult, TrackerData } from "./types";
import { addDays, average, clamp, diffDays, inclusiveDays, standardDeviation, toDateKey } from "./date-utils";

const VALID_MIN_CYCLE = 15;
const VALID_MAX_CYCLE = 120;
const VALID_MIN_PERIOD = 1;
const VALID_MAX_PERIOD = 20;

function rounded(value?: number): number | undefined {
  return value === undefined ? undefined : Math.round(value);
}

export function sortCycles(cycles: Cycle[]): Cycle[] {
  return [...cycles].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function getCycleLengths(cycles: Cycle[]): number[] {
  const sorted = sortCycles(cycles);
  const lengths: number[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const length = diffDays(sorted[index - 1].startDate, sorted[index].startDate);
    if (length >= VALID_MIN_CYCLE && length <= VALID_MAX_CYCLE) {
      lengths.push(length);
    }
  }

  return lengths;
}

export function getPeriodLengths(cycles: Cycle[], fallbackLength?: number): number[] {
  return cycles
    .map((cycle) => {
      if (cycle.endDate) return inclusiveDays(cycle.startDate, cycle.endDate);
      return fallbackLength;
    })
    .filter((length): length is number => {
      return length !== undefined && length >= VALID_MIN_PERIOD && length <= VALID_MAX_PERIOD;
    });
}

export function calculateCycleStats(data: TrackerData): CycleStats {
  const lengths = getCycleLengths(data.cycles);
  const periodLengths = getPeriodLengths(data.cycles, data.profile?.typicalPeriodLength);
  const variability = standardDeviation(lengths);
  const unusualChanges: string[] = [];
  const priorLengths = lengths.slice(0, -1);
  const lastCycleLength = lengths.at(-1);
  const priorAverage = average(priorLengths);
  const priorVariability = standardDeviation(priorLengths) ?? 0;

  if (lastCycleLength && priorAverage) {
    const difference = Math.abs(lastCycleLength - priorAverage);
    if (difference >= Math.max(8, priorVariability * 1.75)) {
      unusualChanges.push(
        `Most recent cycle was ${lastCycleLength} days, which differs from your prior average of ${Math.round(
          priorAverage,
        )} days.`,
      );
    }
  }

  const latestCycle = sortCycles(data.cycles).at(-1);
  if (latestCycle && !latestCycle.endDate && diffDays(latestCycle.startDate, toDateKey(new Date())) > 12) {
    unusualChanges.push("The latest period log has no end date and has been open for more than 12 days.");
  }

  return {
    completedCycleCount: lengths.length,
    averageCycleLength: rounded(average(lengths)),
    shortestCycle: lengths.length ? Math.min(...lengths) : undefined,
    longestCycle: lengths.length ? Math.max(...lengths) : undefined,
    averagePeriodLength: rounded(average(periodLengths)),
    cycleVariability: variability === undefined ? undefined : Math.round(variability * 10) / 10,
    lastCycleLength,
    unusualChanges,
  };
}

export function predictNextWindow(data: TrackerData, today = toDateKey(new Date())): PredictionResult {
  const cycles = sortCycles(data.cycles);
  const profile = data.profile;
  const cycleLengths = getCycleLengths(cycles);
  const recentLengths = cycleLengths.slice(-3);
  const lastStart = cycles.at(-1)?.startDate ?? profile?.lastPeriodStart;
  const warnings: string[] = [];

  if (!lastStart) {
    return {
      confidence: "low",
      confidenceScore: 0,
      basis: "Add at least one period start date to calculate an estimated window.",
      warnings: ["No period start date is available yet."],
    };
  }

  const fallbackCycle = profile?.typicalCycleLength;
  const avgLength = average(cycleLengths) ?? fallbackCycle;
  const recentAverage = average(recentLengths) ?? avgLength;

  if (!avgLength) {
    return {
      confidence: "low",
      confidenceScore: 12,
      basis: "Only the last period start date is available.",
      warnings: ["Cycle length is unknown, so predictions need more logged cycles."],
    };
  }

  if (cycleLengths.length < 3) {
    warnings.push("Fewer than 3 completed cycles are logged, so this estimate is low confidence.");
  }

  if (profile?.irregularCycles) {
    warnings.push("Cycles are marked irregular; the app uses a wider estimated window.");
  }

  const variability = standardDeviation(cycleLengths) ?? (profile?.irregularCycles ? 8 : 4);
  const minLength = cycleLengths.length ? Math.min(...cycleLengths) : avgLength - 4;
  const maxLength = cycleLengths.length ? Math.max(...cycleLengths) : avgLength + 4;
  const recentAnchor = recentAverage ?? avgLength;
  const irregularPadding = profile?.irregularCycles ? Math.max(4, Math.round(variability)) : 2;
  const lowDataPadding = cycleLengths.length < 3 ? 5 : 0;
  const earliestOffset = clamp(
    Math.min(minLength, recentAnchor - variability) - irregularPadding - lowDataPadding,
    VALID_MIN_CYCLE,
    VALID_MAX_CYCLE,
  );
  const latestOffset = clamp(
    Math.max(maxLength, recentAnchor + variability) + irregularPadding + lowDataPadding,
    VALID_MIN_CYCLE,
    VALID_MAX_CYCLE,
  );

  const nextPeriodWindow = {
    start: addDays(lastStart, Math.round(earliestOffset)),
    end: addDays(lastStart, Math.round(latestOffset)),
  };
  const fertileWindow = {
    start: addDays(nextPeriodWindow.start, -19),
    end: addDays(nextPeriodWindow.end, -10),
  };
  const ovulationWindow = {
    start: addDays(nextPeriodWindow.start, -16),
    end: addDays(nextPeriodWindow.end, -12),
  };

  const scoreBase = Math.min(55, cycleLengths.length * 11);
  const variabilityPenalty = Math.min(28, Math.round(variability * 2.2));
  const irregularPenalty = profile?.irregularCycles ? 14 : 0;
  const confidenceScore = clamp(scoreBase + 36 - variabilityPenalty - irregularPenalty, 8, 96);
  const confidence = confidenceScore >= 76 ? "high" : confidenceScore >= 48 ? "medium" : "low";

  if (variability >= 8) {
    warnings.push("Cycle variability is high compared with many prediction models.");
  }

  const lateByDays = today > nextPeriodWindow.end ? diffDays(nextPeriodWindow.end, today) : undefined;
  if (lateByDays && lateByDays > 0) {
    warnings.push(`No new period is logged and the estimate window ended ${lateByDays} day${lateByDays === 1 ? "" : "s"} ago.`);
  }

  return {
    nextPeriodWindow,
    fertileWindow,
    ovulationWindow,
    confidence,
    confidenceScore,
    basis:
      cycleLengths.length >= 3
        ? `Based on ${cycleLengths.length} cycle intervals, recent cycles, min/max, and variability.`
        : "Based on limited cycle history plus onboarding values where available.",
    warnings,
    lateByDays,
  };
}
