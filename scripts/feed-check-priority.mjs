#!/usr/bin/env node
/**
 * feed-check-priority.mjs
 *
 * Portable, zero-dependency feed update prioritisation from episode publish history.
 * Copy this single file into podcasts, vodcasts, or any other integrator project.
 *
 * CONTRACT — integrator supplies per feed:
 *   {
 *     id: string,                         // required slug/id
 *     name?: string,
 *     episodes: [{ publishedAt: string|Date|number, title?: string }],
 *     lastCheckedAt?: string|Date|number|null,  // when this feed was last fetched
 *     now?: string|Date|number,           // evaluation instant (default: now)
 *     minCheckIntervalHours?: number,     // integrator hard floor between checks (default 6)
 *     weight?: number,                    // manual boost, default 1
 *   }
 *
 * CONTRACT — library returns per feed:
 *   {
 *     id, name,
 *     checkPriority: 0..100,              // higher = check sooner
 *     checkTier: 'critical'|'high'|'normal'|'low'|'defer'|'skip',
 *     shouldCheckNow: boolean,
 *     nextCheckAt: ISO UTC string|null,    // earliest sensible recheck
 *     reason: string,
 *     schedule: { kind, confidence, tier, slot? },
 *     due: { status, probability, daysSinceLastEpisode, probablyBy, definitelyBy, ... },
 *     publishing: { status, label },
 *     analysis?: { ... }                  // when options.includeAnalysis
 *   }
 *
 * Primary exports:
 *   scoreFeedCheckPriority(input, options?)
 *   rankFeedsForCheck(feeds, options?)
 *   selectFeedsToCheck(feeds, options?)   // budget-aware queue slice
 *
 * Node 18+. ESM: import { scoreFeedCheckPriority } from './feed-check-priority.mjs'
 */

import { fileURLToPath } from 'url';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const AVG_MONTH = 30.436875 * DAY;
const AVG_YEAR = 365.2425 * DAY;

const DEFAULTS = {
  minCheckIntervalHours: 6,
  weight: 1,
  includeAnalysis: false,
  limit: Infinity,
  minPriority: 0,
  maxCurveSamples: 4096,
  minCurveSamples: 256,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function weightedPercentile(rows, p, valueKey = 'value', weightKey = 'weight') {
  const usable = rows
    .filter((row) => Number.isFinite(row[valueKey]) && row[valueKey] >= 0 && Number.isFinite(row[weightKey]) && row[weightKey] > 0)
    .sort((a, b) => a[valueKey] - b[valueKey]);
  if (!usable.length) return 0;
  const total = usable.reduce((sum, row) => sum + row[weightKey], 0);
  const target = total * (p / 100);
  let acc = 0;
  for (const row of usable) {
    acc += row[weightKey];
    if (acc >= target) return row[valueKey];
  }
  return usable[usable.length - 1][valueKey];
}

function weightedMean(rows, valueKey = 'value', weightKey = 'weight') {
  const usable = rows.filter((row) => Number.isFinite(row[valueKey]) && Number.isFinite(row[weightKey]) && row[weightKey] > 0);
  const total = usable.reduce((sum, row) => sum + row[weightKey], 0);
  if (!total) return 0;
  return usable.reduce((sum, row) => sum + row[valueKey] * row[weightKey], 0) / total;
}

function weightedShare(rows, predicate, weightKey = 'weight') {
  const usable = rows.filter((row) => Number.isFinite(row[weightKey]) && row[weightKey] > 0);
  const total = usable.reduce((sum, row) => sum + row[weightKey], 0);
  if (!total) return 0;
  return usable.reduce((sum, row) => sum + (predicate(row) ? row[weightKey] : 0), 0) / total;
}

function parseInstant(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatUtc(date) {
  return date.toISOString().replace('.000Z', 'Z');
}

export function parseDate(value) {
  return parseInstant(value);
}

function normalizeEpisodes(episodes) {
  const seen = new Set();
  const items = [];
  for (const ep of episodes || []) {
    const date = parseInstant(ep?.publishedAt ?? ep?.published_at ?? ep?.date);
    if (!date) continue;
    const key = date.getTime();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      title: String(ep?.title || '').trim(),
      date,
    });
  }
  return items.sort((a, b) => a.date - b.date);
}

function episodeGapsMs(items) {
  const gaps = [];
  for (let i = 1; i < items.length; i += 1) {
    const gap = items[i].date.getTime() - items[i - 1].date.getTime();
    if (gap > 0) gaps.push(gap);
  }
  return gaps;
}


function trendWindowItems(items, {
  minItems = 18,
  maxItems = 180,
  maxSpanDays = 365 * 3,
  minSpanDays = 45,
} = {}) {
  if (!items.length) return [];
  if (items.length <= minItems) return items;

  const latestMs = items[items.length - 1].date.getTime();
  let startIndex = Math.max(0, items.length - maxItems);

  while (
    startIndex < items.length - minItems
    && (latestMs - items[startIndex].date.getTime()) / DAY > maxSpanDays
  ) {
    startIndex += 1;
  }

  while (
    startIndex > 0
    && (latestMs - items[startIndex].date.getTime()) / DAY < minSpanDays
    && items.length - startIndex < maxItems
  ) {
    startIndex -= 1;
  }

  startIndex = Math.min(startIndex, Math.max(0, items.length - minItems));
  return items.slice(startIndex);
}

function recencyWeightForDate(date, latestDate, halfLifeDays = 365) {
  const ageDays = Math.max(0, (latestDate.getTime() - date.getTime()) / DAY);
  return Math.exp(-ageDays / Math.max(1, halfLifeDays));
}

function weightedPercentileValues(values, weights, p) {
  return weightedPercentile(values.map((value, index) => ({ value, weight: weights[index] ?? 1 })), p);
}

function zNormalize(values) {
  if (!values.length) return [];
  const center = mean(values);
  let variance = 0;
  for (const value of values) variance += (value - center) ** 2;
  variance /= values.length;
  const sd = Math.sqrt(variance) || 1;
  return values.map((value) => (value - center) / sd);
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let numerator = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const va = a[i] - ma;
    const vb = b[i] - mb;
    numerator += va * vb;
    da += va * va;
    db += vb * vb;
  }
  return da && db ? numerator / Math.sqrt(da * db) : 0;
}

function resample(values, size) {
  if (size <= 0) return [];
  if (!values.length) return Array.from({ length: size }, () => 0);
  if (values.length === 1 || size === 1) return Array.from({ length: size }, () => values[0]);
  const out = [];
  const scale = (values.length - 1) / (size - 1);
  for (let i = 0; i < size; i += 1) {
    const x = i * scale;
    const left = Math.floor(x);
    const right = Math.ceil(x);
    if (left === right) out.push(values[left]);
    else {
      const weight = x - left;
      out.push(values[left] * (1 - weight) + values[right] * weight);
    }
  }
  return out;
}

function secondsOfDay(date) {
  return date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
}

function weekdayName(index) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index];
}

function circularDistance(a, b, period) {
  const raw = Math.abs(a - b) % period;
  return Math.min(raw, period - raw);
}

function circularMean(values, period) {
  if (!values.length || period <= 0) return 0;
  let x = 0;
  let y = 0;
  for (const value of values) {
    const angle = (value / period) * Math.PI * 2;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  const angle = Math.atan2(y / values.length, x / values.length);
  return ((angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2)) * period;
}

function nearestCivilProjection(periodMs) {
  const candidates = [
    { kind: 'daily', ms: DAY },
    { kind: 'weekly', ms: WEEK },
    { kind: 'monthly', ms: AVG_MONTH },
    { kind: 'yearly', ms: AVG_YEAR },
  ];
  let best = { kind: 'periodic', ms: periodMs, relativeError: Infinity, source: 'period' };
  for (const candidate of candidates) {
    const relativeError = Math.abs(periodMs - candidate.ms) / candidate.ms;
    if (relativeError < best.relativeError) best = { ...candidate, relativeError, source: 'period' };
  }
  return best;
}

function centralGapProjection(gapsMs) {
  const gapsDays = gapsMs
    .map((gap) => gap / DAY)
    .filter((gap) => Number.isFinite(gap) && gap > 0)
    .sort((a, b) => a - b);
  if (gapsDays.length < 3) return { kind: null, confidence: 0 };

  const p10 = percentile(gapsDays, 10);
  const p25 = percentile(gapsDays, 25);
  const p50 = percentile(gapsDays, 50);
  const p75 = percentile(gapsDays, 75);
  const p90 = percentile(gapsDays, 90);
  const p95 = percentile(gapsDays, 95);
  const maxGap = Math.max(...gapsDays);

  const activeCeiling = Math.max(
    p10 * 1.85,
    p25 * 1.65,
    Math.min(p75 * 1.35, p90),
  );
  let activeGaps = gapsDays.filter((gap) => gap <= activeCeiling);
  if (activeGaps.length < Math.max(3, gapsDays.length * 0.28)) {
    activeGaps = gapsDays.filter((gap) => gap <= p75);
  }
  if (activeGaps.length < 3) activeGaps = gapsDays;

  const activeP25 = percentile(activeGaps, 25);
  const activeMedian = percentile(activeGaps, 50);
  const activeP75 = percentile(activeGaps, 75);
  const activeShare = activeGaps.length / gapsDays.length;
  const iqrRatio = (activeP75 - activeP25) / Math.max(activeMedian, 0.25);
  const centralTightness = clamp(1 - iqrRatio, 0, 1);
  const longBreak = maxGap >= Math.max(45, activeMedian * 5)
    || p95 >= Math.max(35, activeMedian * 4)
    || (p90 >= Math.max(28, activeMedian * 3.5) && activeShare <= 0.72);

  const candidates = [
    { kind: 'daily', days: 1, min: 0.45, max: 2.75, tolerance: 1.05 },
    { kind: 'weekly', days: 7, min: 3.75, max: 13.5, tolerance: 0.72 },
    { kind: 'monthly', days: AVG_MONTH / DAY, min: 18, max: 50, tolerance: 0.62 },
    { kind: 'yearly', days: AVG_YEAR / DAY, min: 260, max: 470, tolerance: 0.38 },
  ];

  let best = {
    kind: null,
    confidence: 0,
    periodDays: activeMedian,
    observedMedianDays: activeMedian,
    longBreak,
    p10,
    p25,
    p50,
    p75,
    p90,
    p95,
    maxGap,
    activeShare,
  };

  for (const candidate of candidates) {
    if (activeMedian < candidate.min || activeMedian > candidate.max) continue;
    const relativeError = Math.abs(activeMedian - candidate.days) / candidate.days;
    const errorScore = clamp(1 - relativeError / candidate.tolerance, 0, 1);
    const supportScore = clamp(activeShare * 1.25, 0, 1);
    const confidence = clamp(errorScore * 0.52 + centralTightness * 0.28 + supportScore * 0.2, 0, 1);
    if (confidence > best.confidence) {
      best = {
        kind: candidate.kind,
        confidence,
        periodDays: candidate.days,
        observedMedianDays: activeMedian,
        relativeError,
        longBreak,
        p10,
        p25,
        p50,
        p75,
        p90,
        p95,
        maxGap,
        activeShare,
      };
    }
  }

  return best;
}

function projectOverlayToSchedule({ items, lagMs, confidence }) {
  const gapsMs = episodeGapsMs(trendWindowItems(items, { minItems: 18, maxItems: 180, maxSpanDays: 365 * 3 }));
  const lagProjection = nearestCivilProjection(lagMs);
  const gapProjection = centralGapProjection(gapsMs);
  const lagDays = lagMs / DAY;

  if (gapProjection.kind && gapProjection.confidence >= 0.46) {
    const seasonalConflict = gapProjection.longBreak && lagDays >= 45;
    if (!seasonalConflict) {
      return {
        kind: gapProjection.kind,
        periodDays: gapProjection.periodDays,
        relativeError: round(gapProjection.relativeError, 4),
        source: 'central_gap_shape',
        confidence: round(gapProjection.confidence, 3),
        observedMedianDays: round(gapProjection.observedMedianDays, 3),
        longBreak: gapProjection.longBreak,
      };
    }
  }

  if (lagProjection.relativeError <= 0.16) {
    return {
      kind: lagProjection.kind,
      periodDays: round(lagProjection.ms / DAY, 3),
      relativeError: round(lagProjection.relativeError, 4),
      source: 'overlay_period_projection',
      confidence: round(confidence, 3),
      longBreak: gapProjection.longBreak || false,
    };
  }

  if (lagDays >= AVG_YEAR / DAY * 0.72 && lagDays <= AVG_YEAR / DAY * 1.32) {
    return {
      kind: 'yearly',
      periodDays: round(lagDays, 3),
      relativeError: round(Math.abs(lagDays - AVG_YEAR / DAY) / (AVG_YEAR / DAY), 4),
      source: 'long_overlay_projection',
      confidence: round(confidence, 3),
      longBreak: true,
    };
  }

  if (lagDays >= 45 || gapProjection.longBreak) {
    return {
      kind: 'seasonal',
      periodDays: round(lagDays, 3),
      relativeError: null,
      source: 'long_curve_overlay',
      confidence: round(confidence, 3),
      longBreak: true,
    };
  }

  return {
    kind: lagProjection.kind,
    periodDays: round((lagProjection.ms || lagMs) / DAY, 3),
    relativeError: Number.isFinite(lagProjection.relativeError) ? round(lagProjection.relativeError, 4) : null,
    source: 'nearest_overlay_period',
    confidence: round(confidence, 3),
    longBreak: gapProjection.longBreak || false,
  };
}

function buildActivityCurve(items, { asOf = null, minSamples = DEFAULTS.minCurveSamples, maxSamples = DEFAULTS.maxCurveSamples } = {}) {
  const timestamps = items.map((item) => item.date.getTime());
  const firstMs = timestamps[0];
  const lastEpisodeMs = timestamps[timestamps.length - 1];
  const endMs = Math.max(lastEpisodeMs, asOf ? asOf.getTime() : lastEpisodeMs);
  const spanMs = Math.max(endMs - firstMs, 1);
  const gaps = episodeGapsMs(items);
  const p25Gap = gaps.length ? percentile(gaps, 25) : spanMs;
  const medianGap = gaps.length ? median(gaps) : spanMs;

  const desiredStepMs = clamp(
    Math.min(p25Gap * 0.28, medianGap * 0.22),
    6 * HOUR,
    Math.max(6 * HOUR, spanMs / Math.max(minSamples - 1, 1)),
  );
  const targetSamples = clamp(
    Math.ceil(spanMs / Math.max(desiredStepMs, 1)) + 1,
    minSamples,
    maxSamples,
  );
  const sampleCount = Math.max(3, Math.floor(targetSamples));
  const stepMs = spanMs / (sampleCount - 1);
  const kernelMs = clamp(p25Gap * 0.42, stepMs * 1.25, spanMs / 3);
  const sigmaSamples = Math.max(kernelMs / stepMs, 0.75);
  const radius = Math.max(2, Math.ceil(sigmaSamples * 4));
  const raw = Array.from({ length: sampleCount }, () => 0);

  for (const timestamp of timestamps) {
    const center = (timestamp - firstMs) / stepMs;
    const left = Math.max(0, Math.floor(center - radius));
    const right = Math.min(sampleCount - 1, Math.ceil(center + radius));
    for (let i = left; i <= right; i += 1) {
      const z = (i - center) / sigmaSamples;
      raw[i] += Math.exp(-0.5 * z * z);
    }
  }

  const normalized = zNormalize(raw);
  return {
    raw,
    normalized,
    startMs: firstMs,
    endMs,
    lastEpisodeMs,
    spanMs,
    stepMs,
    kernelMs,
    sampleCount,
  };
}

function overlayCorrelation(curve, lagSamples) {
  const n = curve.length - lagSamples;
  if (lagSamples <= 0 || n < 8) return { correlation: 0, overlap: 0 };
  const a = curve.slice(0, n);
  const b = curve.slice(lagSamples, lagSamples + n);
  return {
    correlation: pearson(a, b),
    overlap: n / curve.length,
  };
}

function chooseFundamentalOverlayPeak(peaks) {
  if (!peaks.length) return null;
  const globalBest = peaks[0];
  const minimumScore = Math.max(0.18, globalBest.score * 0.54);
  const viable = peaks
    .filter((peak) => peak.score >= minimumScore && peak.correlation >= 0.18 && peak.cycles >= 1.6)
    .sort((a, b) => a.lagMs - b.lagMs);

  for (const peak of viable) {
    if (peak.lagMs === globalBest.lagMs) return peak;
    const ratio = globalBest.lagMs / peak.lagMs;
    const nearestMultiple = Math.max(1, Math.round(ratio));
    const harmonicError = Math.abs(ratio - nearestMultiple) / nearestMultiple;
    const enoughShape = peak.score >= globalBest.score * 0.62 || peak.correlation >= globalBest.correlation * 0.74;
    if (nearestMultiple >= 2 && harmonicError <= 0.18 && enoughShape) return peak;
  }

  const compact = viable.find((peak) => peak.score >= globalBest.score * 0.74);
  return compact || globalBest;
}

function findCurveOverlayPattern(items, curveInfo) {
  if (items.length < 4 || curveInfo.sampleCount < 16) {
    return {
      kind: 'random',
      confidence: 0,
      lagMs: 0,
      lagDays: 0,
      score: 0,
      peaks: [],
      projection: { kind: 'random', relativeError: 0 },
    };
  }

  const gaps = episodeGapsMs(items);
  const smallestUsefulGap = gaps.length ? percentile(gaps, 10) : curveInfo.stepMs * 4;
  const minLagSamples = Math.max(2, Math.floor((smallestUsefulGap * 0.45) / curveInfo.stepMs));
  const maxLagSamples = Math.max(minLagSamples + 1, Math.floor(curveInfo.sampleCount * 0.82));
  const scored = [];

  for (let lag = minLagSamples; lag <= maxLagSamples; lag += 1) {
    const { correlation, overlap } = overlayCorrelation(curveInfo.normalized, lag);
    const lagMs = lag * curveInfo.stepMs;
    const cycles = curveInfo.spanMs / Math.max(lagMs, 1);
    const repeatSupport = clamp(Math.log1p(cycles) / Math.log(5), 0.15, 1.15);
    const overlapSupport = clamp(overlap, 0, 1) ** 0.35;
    const score = Math.max(0, correlation) * overlapSupport * repeatSupport;
    scored.push({ lagSamples: lag, lagMs, correlation, overlap, cycles, score });
  }

  const peaks = [];
  for (let i = 1; i < scored.length - 1; i += 1) {
    const prev = scored[i - 1];
    const row = scored[i];
    const next = scored[i + 1];
    if (row.score >= prev.score && row.score >= next.score && row.score > 0) {
      peaks.push(row);
    }
  }
  if (!peaks.length && scored.length) peaks.push(scored.sort((a, b) => b.score - a.score)[0]);
  peaks.sort((a, b) => b.score - a.score);

  const globalBest = peaks[0] || { lagSamples: 0, lagMs: 0, correlation: 0, overlap: 0, cycles: 0, score: 0 };
  const best = chooseFundamentalOverlayPeak(peaks) || globalBest;
  const confidence = clamp(best.score, 0, 1);
  const projection = best.lagMs > 0
    ? projectOverlayToSchedule({ items, lagMs: best.lagMs, confidence })
    : { kind: 'random', relativeError: 0, source: 'none' };

  let kind = 'random';
  if (confidence >= 0.32) {
    if (projection.kind && projection.kind !== 'periodic') kind = projection.kind;
    else kind = 'periodic';
  }

  return {
    kind,
    confidence: round(confidence, 3),
    lagMs: best.lagMs,
    lagDays: round(best.lagMs / DAY, 3),
    lagSamples: best.lagSamples,
    score: round(best.score, 4),
    correlation: round(best.correlation, 4),
    overlap: round(best.overlap, 4),
    cycles: round(best.cycles, 2),
    globalBestLagDays: round(globalBest.lagMs / DAY, 3),
    globalBestScore: round(globalBest.score, 4),
    projection: {
      kind: projection.kind,
      periodDays: projection.periodDays ?? round(best.lagMs / DAY, 3),
      relativeError: Number.isFinite(projection.relativeError) ? round(projection.relativeError, 4) : null,
      source: projection.source,
      observedMedianDays: projection.observedMedianDays,
      longBreak: Boolean(projection.longBreak),
    },
    peaks: peaks.slice(0, 8).map((peak) => ({
      lagDays: round(peak.lagMs / DAY, 3),
      score: round(peak.score, 4),
      correlation: round(peak.correlation, 4),
      overlap: round(peak.overlap, 4),
      cycles: round(peak.cycles, 2),
    })),
  };
}

function findActiveCurveLobes(curveInfo) {
  const values = curveInfo.raw;
  const sorted = [...values].sort((a, b) => a - b);
  const floor = percentile(sorted, 45);
  const ceiling = percentile(sorted, 92);
  const threshold = floor + (ceiling - floor) * 0.22;
  const lobes = [];
  let start = null;
  let mass = 0;
  let peak = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] >= threshold) {
      if (start === null) {
        start = i;
        mass = 0;
        peak = values[i];
      }
      mass += values[i];
      peak = Math.max(peak, values[i]);
    } else if (start !== null) {
      const end = i - 1;
      if (end > start) {
        lobes.push({
          startIndex: start,
          endIndex: end,
          startAt: formatUtc(new Date(curveInfo.startMs + start * curveInfo.stepMs)),
          endAt: formatUtc(new Date(curveInfo.startMs + end * curveInfo.stepMs)),
          durationDays: round(((end - start) * curveInfo.stepMs) / DAY, 2),
          mass: round(mass, 3),
          peak: round(peak, 3),
        });
      }
      start = null;
    }
  }
  if (start !== null) {
    const end = values.length - 1;
    lobes.push({
      startIndex: start,
      endIndex: end,
      startAt: formatUtc(new Date(curveInfo.startMs + start * curveInfo.stepMs)),
      endAt: formatUtc(new Date(curveInfo.startMs + end * curveInfo.stepMs)),
      durationDays: round(((end - start) * curveInfo.stepMs) / DAY, 2),
      mass: round(mass, 3),
      peak: round(peak, 3),
    });
  }
  return lobes;
}

function buildCheckSlot({ items, model }) {
  const slot = {
    pattern: model.kind,
    confidence: model.confidence,
    detectedPeriodDays: model.lagDays,
    projectedFromCurve: true,
  };

  if (model.kind === 'random') {
    slot.advice = 'Poll from curve-analogue due windows; no repeatable overlay survived scoring.';
    return slot;
  }

  const lagMs = model.lagMs;
  if (lagMs > 0) {
    const phaseValues = items.map((item) => ((item.date.getTime() % lagMs) + lagMs) % lagMs);
    const phase = circularMean(phaseValues, lagMs);
    const phaseSpread = median(phaseValues.map((value) => circularDistance(value, phase, lagMs)));
    slot.phaseDays = round(phase / DAY, 3);
    slot.phaseSpreadDays = round(phaseSpread / DAY, 3);
  }

  if (model.kind === 'weekly') {
    const weekdays = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      count: items.filter((item) => item.date.getUTCDay() === weekday).length,
    })).sort((a, b) => b.count - a.count);
    const seconds = items.map((item) => secondsOfDay(item.date));
    const secondOfDay = circularMean(seconds, DAY / 1000);
    const hour = Math.floor(secondOfDay / 3600) % 24;
    slot.weekday = weekdays[0].weekday;
    slot.weekdayName = weekdayName(weekdays[0].weekday);
    slot.hourUtc = hour;
    slot.checkWindowUtc = `${String(Math.max(0, hour - 1)).padStart(2, '0')}:00–${String(Math.min(23, hour + 1)).padStart(2, '0')}:59`;
  } else if (model.kind === 'daily') {
    const seconds = items.map((item) => secondsOfDay(item.date));
    const secondOfDay = circularMean(seconds, DAY / 1000);
    const hour = Math.floor(secondOfDay / 3600) % 24;
    slot.hourUtc = hour;
    slot.checkWindowUtc = `${String(Math.max(0, hour - 1)).padStart(2, '0')}:00–${String(Math.min(23, hour + 1)).padStart(2, '0')}:59`;
  } else if (model.kind === 'monthly') {
    const days = Array.from({ length: 31 }, (_, index) => ({
      day: index + 1,
      count: items.filter((item) => item.date.getUTCDate() === index + 1).length,
    })).sort((a, b) => b.count - a.count);
    slot.dayOfMonth = days[0].day;
  } else {
    slot.advice = 'Detected by curve overlay; do not force a civil-calendar slot.';
  }

  return slot;
}

function chooseTailSamples({ curveInfo, gaps, items, asOf }) {
  const latestMs = items[items.length - 1].date.getTime();
  const elapsedSinceLatestMs = Math.max(0, asOf.getTime() - latestMs);
  const p25 = gaps.length ? percentile(gaps, 25) : curveInfo.stepMs * 12;
  const p50 = gaps.length ? percentile(gaps, 50) : p25;
  const p75 = gaps.length ? percentile(gaps, 75) : p50;
  const p90 = gaps.length ? percentile(gaps, 90) : p75;
  const p95 = gaps.length ? percentile(gaps, 95) : p90;

  const recentShapeMs = Math.max(
    elapsedSinceLatestMs * 1.35,
    p50 * 1.8,
    Math.min(p90, p75 * 1.4),
    curveInfo.stepMs * 10,
  );
  const staleShapeMs = elapsedSinceLatestMs > Math.max(p95, p50 * 4)
    ? Math.max(elapsedSinceLatestMs * 1.1, p95 * 0.8)
    : recentShapeMs;
  const basisMs = clamp(staleShapeMs, curveInfo.stepMs * 8, curveInfo.spanMs * 0.42);
  return clamp(Math.round(basisMs / curveInfo.stepMs), 8, Math.max(8, Math.floor(curveInfo.sampleCount * 0.42)));
}

function findCurveAnalogues({ items, curveInfo, model, asOf }) {
  const gaps = episodeGapsMs(items);
  const endIndex = curveInfo.sampleCount - 1;
  const tailSamples = chooseTailSamples({ curveInfo, gaps, items, asOf });
  if (endIndex < tailSamples * 2 || items.length < 4) return { analogues: [], tailSamples };

  const tail = zNormalize(curveInfo.raw.slice(endIndex - tailSamples + 1, endIndex + 1));
  const stride = Math.max(1, Math.floor(tailSamples / 18));
  const scales = [0.62, 0.75, 0.88, 1, 1.14, 1.32, 1.55];
  const timestamps = items.map((item) => item.date.getTime());
  const analogues = [];

  for (let candidateEnd = tailSamples; candidateEnd < endIndex - tailSamples; candidateEnd += stride) {
    const candidateEndMs = curveInfo.startMs + candidateEnd * curveInfo.stepMs;
    const prevEpisodeIndex = (() => {
      let idx = -1;
      for (let i = 0; i < timestamps.length; i += 1) {
        if (timestamps[i] <= candidateEndMs) idx = i;
        else break;
      }
      return idx;
    })();
    if (prevEpisodeIndex < 0 || prevEpisodeIndex >= timestamps.length - 1) continue;
    const nextEpisodeMs = timestamps[prevEpisodeIndex + 1];
    if (nextEpisodeMs <= candidateEndMs) continue;

    for (const scale of scales) {
      const segmentSamples = Math.max(6, Math.round(tailSamples * scale));
      const start = candidateEnd - segmentSamples + 1;
      if (start < 0) continue;
      const segment = zNormalize(resample(curveInfo.raw.slice(start, candidateEnd + 1), tailSamples));
      const similarity = pearson(tail, segment);
      if (similarity < 0.34) continue;
      const previousEpisodeMs = timestamps[prevEpisodeIndex];
      const totalGapDays = (nextEpisodeMs - previousEpisodeMs) / DAY;
      const elapsedDays = (candidateEndMs - previousEpisodeMs) / DAY;
      const remainingDays = (nextEpisodeMs - candidateEndMs) / DAY;
      if (totalGapDays <= 0 || remainingDays < 0) continue;
      analogues.push({
        similarity,
        weight: Math.max(0.001, ((similarity - 0.24) / 0.76) ** 3) / (1 + Math.abs(Math.log(scale)) * 0.55),
        scale,
        candidateAt: formatUtc(new Date(candidateEndMs)),
        previousEpisodeAt: formatUtc(new Date(previousEpisodeMs)),
        nextEpisodeAt: formatUtc(new Date(nextEpisodeMs)),
        totalGapDays,
        elapsedDays,
        remainingDays,
      });
    }
  }

  analogues.sort((a, b) => b.weight - a.weight);
  const deduped = [];
  const seen = new Set();
  for (const row of analogues) {
    const key = `${row.candidateAt}:${row.nextEpisodeAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
    if (deduped.length >= 48) break;
  }
  return { analogues: deduped, tailSamples };
}

function fallbackGapRows(gapsDays) {
  return gapsDays.map((value) => ({ value, weight: 1 }));
}

function inactiveThresholdDays(gapStats) {
  const medianDays = Math.max(gapStats.medianDays || 0, 0);
  const p95Days = Math.max(gapStats.p95Days || 0, medianDays);
  const maxDays = Math.max(gapStats.maxDays || 0, p95Days);

  if (p95Days >= 120 || medianDays >= 90) {
    return Math.max(p95Days + Math.max(14, p95Days * 0.08), maxDays * 1.04);
  }
  if (p95Days >= 30 || medianDays >= 21) {
    return Math.max(p95Days + Math.max(7, p95Days * 0.18), maxDays * 1.12);
  }
  return Math.max(21, p95Days * 4, maxDays * 3, medianDays * 8);
}


function activeGapDistribution(items) {
  const recent = trendWindowItems(items, { minItems: 18, maxItems: 180, maxSpanDays: 365 * 3 });
  const latestTrendDate = recent[recent.length - 1]?.date || items[items.length - 1]?.date;
  const gaps = [];
  for (let i = 1; i < recent.length; i += 1) {
    const gap = recent[i].date.getTime() - recent[i - 1].date.getTime();
    if (gap > 0) gaps.push({
      gapMs: gap,
      gapDays: gap / DAY,
      fromWeekday: recent[i - 1].date.getUTCDay(),
      toWeekday: recent[i].date.getUTCDay(),
      fromAt: recent[i - 1].date,
      toAt: recent[i].date,
      weight: recencyWeightForDate(recent[i].date, latestTrendDate, 365),
    });
  }
  if (!gaps.length) {
    return {
      gaps,
      activeGaps: [],
      cadenceMs: 0,
      p25Ms: 0,
      p75Ms: 0,
      p90Ms: 0,
      p95Ms: 0,
      maxMs: 0,
      confidence: 0,
    };
  }

  const gapDays = gaps.map((row) => row.gapDays).sort((a, b) => a - b);
  const weightedGapRows = gaps.map((row) => ({ value: row.gapDays, weight: row.weight || 1 }));
  const p10 = weightedPercentile(weightedGapRows, 10);
  const p25 = weightedPercentile(weightedGapRows, 25);
  const p50 = weightedPercentile(weightedGapRows, 50);
  const p75 = weightedPercentile(weightedGapRows, 75);
  const p90 = weightedPercentile(weightedGapRows, 90);
  const activeCeiling = Math.max(
    p10 * 1.85,
    p25 * 1.65,
    Math.min(p75 * 1.35, p90),
  );

  let activeGaps = gaps.filter((row) => row.gapDays <= activeCeiling);
  if (activeGaps.length < Math.max(3, gaps.length * 0.35)) {
    activeGaps = gaps.filter((row) => row.gapDays <= p75);
  }
  if (activeGaps.length < 3) activeGaps = gaps;

  const activeDays = activeGaps.map((row) => row.gapDays).sort((a, b) => a - b);
  const activeRows = activeGaps.map((row) => ({ value: row.gapDays, weight: row.weight || 1 }));
  const activeP25 = weightedPercentile(activeRows, 25);
  const activeP50 = weightedPercentile(activeRows, 50);
  const activeP75 = weightedPercentile(activeRows, 75);
  const activeP90 = weightedPercentile(activeRows, 90);
  const activeP95 = weightedPercentile(activeRows, 95);
  const activeMax = Math.max(...activeDays);
  const tightness = clamp(1 - ((activeP75 - activeP25) / Math.max(activeP50, 0.25)), 0, 1);
  const support = clamp(activeGaps.reduce((sum, row) => sum + (row.weight || 1), 0) / Math.max(gaps.reduce((sum, row) => sum + (row.weight || 1), 0), 1e-9), 0, 1);
  const confidence = clamp(tightness * 0.68 + support * 0.32, 0, 1);

  return {
    gaps,
    activeGaps,
    cadenceMs: activeP50 * DAY,
    p25Ms: activeP25 * DAY,
    p75Ms: activeP75 * DAY,
    p90Ms: activeP90 * DAY,
    p95Ms: activeP95 * DAY,
    maxMs: activeMax * DAY,
    confidence,
  };
}

function releaseTimeDistribution(items, cadenceMs) {
  const recent = trendWindowItems(items, { minItems: 18, maxItems: 180, maxSpanDays: 365 * 3 });
  const seconds = recent.map((item) => secondsOfDay(item.date));
  if (!seconds.length) return { secondOfDay: 0, spreadSeconds: 12 * 3600, confidence: 0 };

  const secondOfDay = circularMean(seconds, DAY / 1000);
  const distances = seconds
    .map((value) => circularDistance(value, secondOfDay, DAY / 1000))
    .sort((a, b) => a - b);
  const p75Distance = percentile(distances, 75);
  const p90Distance = percentile(distances, 90);
  const scale = cadenceMs <= 3 * DAY ? 4 * 3600 : 10 * 3600;
  const confidence = clamp(1 - (p75Distance / scale), 0, 1);
  return {
    secondOfDay,
    spreadSeconds: Math.max(900, Math.min(p90Distance, 18 * 3600)),
    confidence,
  };
}

function utcMidnightMs(ms) {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function setUtcSecondOfDay(ms, secondOfDay) {
  return utcMidnightMs(ms) + Math.round(secondOfDay * 1000);
}

function conditionedNextGapMs(items, latest, distribution) {
  const latestWeekday = latest.getUTCDay();
  const sameWeekday = distribution.gaps
    .filter((row) => row.fromWeekday === latestWeekday && row.gapMs <= Math.max(distribution.p95Ms * 1.35, distribution.cadenceMs * 2.5))
    .map((row) => ({ value: row.gapMs, weight: row.weight || 1 }))
    .sort((a, b) => a.value - b.value);

  if (sameWeekday.length >= 3) return weightedPercentile(sameWeekday, 50);
  return distribution.cadenceMs || 0;
}


function positiveModulo(value, period) {
  return ((value % period) + period) % period;
}

function circularPhaseDistanceMs(a, b, periodMs) {
  const raw = Math.abs(a - b) % periodMs;
  return Math.min(raw, periodMs - raw);
}

function phaseMeanMs(values, periodMs) {
  return circularMean(values.map((value) => value / 1000), periodMs / 1000) * 1000;
}

function chooseEventCycleMs({ model, distribution }) {
  const projectedDays = model?.projection?.periodDays;
  const projectedMs = Number.isFinite(projectedDays) && projectedDays > 0 ? projectedDays * DAY : 0;
  const cadenceMs = distribution?.cadenceMs || 0;

  if (projectedMs >= 0.5 * DAY && projectedMs <= 90 * DAY) {
    return projectedMs;
  }

  const lagMs = model?.lagMs || 0;
  if (lagMs >= 0.5 * DAY && lagMs <= 90 * DAY && (model?.confidence || 0) >= 0.38) {
    return lagMs;
  }

  if (cadenceMs > 0) return cadenceMs;
  return 0;
}

function cyclePhaseClusters(events, cycleMs, anchorMs, asOfMs) {
  if (!events.length || cycleMs <= 0) return { clusters: [], completedCycleCount: 0, expectedEventsPerCycle: 1 };

  const byCycle = new Map();
  const rows = events.map((item) => {
    const t = item.date.getTime();
    const cycleIndex = Math.floor((t - anchorMs) / cycleMs);
    const phaseMs = positiveModulo(t - anchorMs, cycleMs);
    if (!byCycle.has(cycleIndex)) byCycle.set(cycleIndex, []);
    byCycle.get(cycleIndex).push({ item, t, cycleIndex, phaseMs });
    return { item, t, cycleIndex, phaseMs };
  });

  for (const cycle of byCycle.values()) cycle.sort((a, b) => a.phaseMs - b.phaseMs || a.t - b.t);

  const lastCompleteCycle = Math.floor((asOfMs - anchorMs) / cycleMs) - 1;
  const completedCounts = [...byCycle.entries()]
    .filter(([cycleIndex]) => cycleIndex <= lastCompleteCycle)
    .map(([, cycle]) => cycle.length)
    .filter((count) => count > 0)
    .sort((a, b) => a - b);

  const expectedEventsPerCycle = Math.max(1, Math.min(12, Math.round(completedCounts.length ? percentile(completedCounts, 50) : 1)));
  const thresholdMs = clamp(cycleMs * 0.07, 20 * 60 * 1000, Math.min(18 * HOUR, cycleMs / 4));
  const sorted = [...rows].sort((a, b) => a.phaseMs - b.phaseMs);
  let groups = [];

  for (const row of sorted) {
    const last = groups[groups.length - 1];
    if (!last || Math.abs(row.phaseMs - last[last.length - 1].phaseMs) > thresholdMs) {
      groups.push([row]);
    } else {
      last.push(row);
    }
  }

  if (groups.length > 1) {
    const first = groups[0];
    const last = groups[groups.length - 1];
    const wrapDistance = first[0].phaseMs + cycleMs - last[last.length - 1].phaseMs;
    if (wrapDistance <= thresholdMs) {
      groups = [[...last, ...first], ...groups.slice(1, -1)];
    }
  }

  const completedCycleCount = Math.max(1, completedCounts.length);
  const clusters = groups.map((group) => {
    const centerMs = phaseMeanMs(group.map((row) => row.phaseMs), cycleMs);
    const byClusterCycle = new Map();
    for (const row of group) {
      if (!byClusterCycle.has(row.cycleIndex)) byClusterCycle.set(row.cycleIndex, []);
      byClusterCycle.get(row.cycleIndex).push(row);
    }
    const counts = [...byClusterCycle.entries()]
      .filter(([cycleIndex]) => cycleIndex <= lastCompleteCycle)
      .map(([, cycle]) => cycle.length)
      .filter((count) => count > 0)
      .sort((a, b) => a - b);
    const eventCount = Math.max(1, Math.min(6, Math.round(counts.length ? percentile(counts, 50) : 1)));
    const support = clamp(counts.length / completedCycleCount, 0, 1);
    const offsetsByOrder = Array.from({ length: eventCount }, () => []);

    for (const cycle of byClusterCycle.values()) {
      const ordered = [...cycle].sort((a, b) => {
        const da = positiveModulo(a.phaseMs - centerMs + cycleMs / 2, cycleMs) - cycleMs / 2;
        const db = positiveModulo(b.phaseMs - centerMs + cycleMs / 2, cycleMs) - cycleMs / 2;
        return da - db || a.t - b.t;
      });
      for (let i = 0; i < Math.min(eventCount, ordered.length); i += 1) {
        const offset = positiveModulo(ordered[i].phaseMs - centerMs + cycleMs / 2, cycleMs) - cycleMs / 2;
        offsetsByOrder[i].push(offset);
      }
    }

    const distances = group
      .map((row) => circularPhaseDistanceMs(row.phaseMs, centerMs, cycleMs))
      .sort((a, b) => a - b);
    const spreadMs = Math.max(percentile(distances, 75), 20 * 60 * 1000);

    return {
      centerMs,
      support,
      eventCount,
      spreadMs,
      rows: group.length,
      subOffsets: offsetsByOrder.map((offsets) => offsets.length ? percentile(offsets, 50) : 0),
    };
  }).sort((a, b) => b.support - a.support || b.rows - a.rows);

  return { clusters, completedCycleCount, expectedEventsPerCycle };
}

function buildCyclicEventSequence({ items, asOf, model, distribution, forecastCount = 12 }) {
  const recent = trendWindowItems(items, { minItems: 18, maxItems: 180, maxSpanDays: 365 * 3 });
  if (recent.length < 4) return { usable: false, nextEvents: [] };

  const cycleMs = chooseEventCycleMs({ model, distribution });
  if (!cycleMs || !Number.isFinite(cycleMs) || cycleMs <= 0 || cycleMs > 90 * DAY) {
    return { usable: false, nextEvents: [] };
  }

  const asOfMs = asOf.getTime();
  const latestMs = items[items.length - 1].date.getTime();
  const anchorMs = recent[0].date.getTime();
  const { clusters, completedCycleCount, expectedEventsPerCycle } = cyclePhaseClusters(recent, cycleMs, anchorMs, asOfMs);
  if (!clusters.length) return { usable: false, nextEvents: [] };

  const selected = [];
  for (const cluster of clusters) {
    if (cluster.support >= 0.42) selected.push(cluster);
  }
  for (const cluster of clusters) {
    const currentEvents = selected.reduce((sum, row) => sum + row.eventCount, 0);
    if (currentEvents >= expectedEventsPerCycle) break;
    if (!selected.includes(cluster)) selected.push(cluster);
  }

  let slots = [];
  for (const cluster of selected) {
    for (let i = 0; i < cluster.eventCount; i += 1) {
      const phaseMs = positiveModulo(cluster.centerMs + (cluster.subOffsets[i] || 0), cycleMs);
      slots.push({
        phaseMs,
        support: cluster.support,
        spreadMs: cluster.spreadMs,
      });
    }
  }
  slots.sort((a, b) => a.phaseMs - b.phaseMs);
  if (slots.length > 1) {
    const minSlotSeparationMs = Math.min(
      cycleMs * 0.12,
      Math.max(90 * 60 * 1000, (distribution?.p25Ms || distribution?.cadenceMs || cycleMs) * 0.28),
    );
    const merged = [];
    for (const slot of slots) {
      const last = merged[merged.length - 1];
      if (last && circularPhaseDistanceMs(last.phaseMs, slot.phaseMs, cycleMs) <= minSlotSeparationMs) {
        const totalSupport = Math.max(1e-9, last.support + slot.support);
        last.phaseMs = positiveModulo((last.phaseMs * last.support + slot.phaseMs * slot.support) / totalSupport, cycleMs);
        last.support = Math.max(last.support, slot.support);
        last.spreadMs = Math.max(last.spreadMs, slot.spreadMs);
      } else {
        merged.push({ ...slot });
      }
    }
    if (merged.length > 1 && circularPhaseDistanceMs(merged[0].phaseMs, merged[merged.length - 1].phaseMs, cycleMs) <= minSlotSeparationMs) {
      const first = merged.shift();
      const last = merged[merged.length - 1];
      const totalSupport = Math.max(1e-9, last.support + first.support);
      last.phaseMs = positiveModulo((last.phaseMs * last.support + (first.phaseMs + cycleMs) * first.support) / totalSupport, cycleMs);
      last.support = Math.max(last.support, first.support);
      last.spreadMs = Math.max(last.spreadMs, first.spreadMs);
      merged.sort((a, b) => a.phaseMs - b.phaseMs);
    }
    slots = merged;
  }
  if (!slots.length) return { usable: false, nextEvents: [] };

  const nextEvents = [];
  const duplicateSkipMs = Math.min(cycleMs * 0.35, Math.max(2 * HOUR, (distribution?.p25Ms || distribution?.cadenceMs || cycleMs) * 0.45));
  const startCycle = Math.floor((Math.min(asOfMs, latestMs) - anchorMs) / cycleMs) - 1;
  for (let cycleIndex = startCycle; nextEvents.length < forecastCount && cycleIndex < startCycle + 200; cycleIndex += 1) {
    for (const slot of slots) {
      const t = anchorMs + cycleIndex * cycleMs + slot.phaseMs;
      if (slots.length === 1) {
        if (t <= latestMs + duplicateSkipMs) continue;
      } else if (t <= latestMs + 60 * 1000) {
        continue;
      }
      nextEvents.push({
        at: formatUtc(new Date(t)),
        t,
        confidence: round(clamp(slot.support * 0.75 + Math.min(completedCycleCount / 12, 1) * 0.25, 0, 1), 3),
        uncertaintyDays: round(clamp(slot.spreadMs, 20 * 60 * 1000, Math.min(cycleMs * 0.35, 36 * HOUR)) / DAY, 3),
        basis: 'event_sequence_phase',
      });
    }
  }
  nextEvents.sort((a, b) => a.t - b.t);
  const trimmed = nextEvents.slice(0, forecastCount);
  const gaps = [];
  for (let i = 1; i < trimmed.length; i += 1) gaps.push(trimmed[i].t - trimmed[i - 1].t);
  const cadenceMs = gaps.length ? percentile(gaps, 50) : Math.min(distribution?.cadenceMs || cycleMs, cycleMs);
  const slotSupport = weightedMean(slots.map((slot) => ({ value: slot.support, weight: 1 })));
  const confidence = clamp(slotSupport * 0.6 + Math.min(completedCycleCount / 10, 1) * 0.25 + (model?.confidence || 0) * 0.15, 0, 1);

  return {
    usable: trimmed.length > 0 && confidence >= 0.38,
    confidence: round(confidence, 3),
    cycleDays: round(cycleMs / DAY, 3),
    cadenceDays: round(cadenceMs / DAY, 3),
    expectedEventsPerCycle,
    slotCount: slots.length,
    completedCycleCount,
    nextEvents: trimmed,
    source: 'event_sequence_phase',
  };
}

function probabilityForEvent({ asOfMs, eventMs, uncertaintyMs }) {
  const elapsedAfterExpectedMs = asOfMs - eventMs;
  if (elapsedAfterExpectedMs <= -uncertaintyMs) return 0;
  if (elapsedAfterExpectedMs < 0) return clamp(0.25 + 0.25 * (1 + elapsedAfterExpectedMs / uncertaintyMs), 0, 0.5);
  if (elapsedAfterExpectedMs <= uncertaintyMs) return clamp(0.5 + 0.3 * (elapsedAfterExpectedMs / uncertaintyMs), 0.5, 0.8);
  if (elapsedAfterExpectedMs <= uncertaintyMs * 3) return clamp(0.8 + 0.15 * ((elapsedAfterExpectedMs - uncertaintyMs) / (uncertaintyMs * 2)), 0.8, 0.95);
  return 0.97;
}

function inferNextEpisodeEvent({ items, asOf, analogueRemainingStats, model }) {
  const latest = items[items.length - 1]?.date;
  if (!latest || items.length < 3) return null;

  const distribution = activeGapDistribution(items);
  if (!distribution.cadenceMs || distribution.confidence < 0.28) return null;

  const sequence = buildCyclicEventSequence({ items, asOf, model, distribution, forecastCount: 16 });
  if (sequence.usable && sequence.nextEvents.length) {
    const next = sequence.nextEvents[0];
    const uncertaintyMs = Math.max(next.uncertaintyDays * DAY, 20 * 60 * 1000);
    const probability = probabilityForEvent({ asOfMs: asOf.getTime(), eventMs: next.t, uncertaintyMs });
    const remainingDays = Math.max(0, (next.t - asOf.getTime()) / DAY);
    const currentSilenceDays = Math.max(0, (asOf.getTime() - latest.getTime()) / DAY);
    const analogueRemaining = analogueRemainingStats?.medianDays ?? Infinity;
    const eventUsable = currentSilenceDays <= Math.max(8, sequence.cadenceDays * 4.5, sequence.cycleDays * 1.8)
      && remainingDays <= Math.max(analogueRemaining + 7, sequence.cycleDays * 2.25, sequence.cadenceDays * 3.5);

    return {
      usable: eventUsable,
      confidence: sequence.confidence,
      nextEpisodeAt: next.at,
      expectedBy: next.at,
      probablyBy: formatUtc(new Date(next.t + uncertaintyMs)),
      definitelyBy: formatUtc(new Date(next.t + Math.max(uncertaintyMs * 3, sequence.cadenceDays * DAY * 0.35))),
      cadenceDays: sequence.cadenceDays,
      cycleDays: sequence.cycleDays,
      expectedEventsPerCycle: sequence.expectedEventsPerCycle,
      slotCount: sequence.slotCount,
      conditionedGapDays: round(Math.max(0, (next.t - latest.getTime()) / DAY), 3),
      remainingDays: round(remainingDays, 3),
      uncertaintyDays: round(uncertaintyMs / DAY, 3),
      probability: round(clamp(probability, 0, 1), 3),
      releaseSecondOfDay: round(secondsOfDay(new Date(next.t)), 0),
      releaseSpreadHours: round(uncertaintyMs / HOUR, 2),
      source: sequence.source,
      nextEvents: sequence.nextEvents.map((event) => ({
        at: event.at,
        confidence: event.confidence,
        uncertaintyDays: event.uncertaintyDays,
        basis: event.basis,
      })),
    };
  }

  const cadenceMs = distribution.cadenceMs;
  const conditionedGapMs = conditionedNextGapMs(items, latest, distribution) || cadenceMs;
  const release = releaseTimeDistribution(items, cadenceMs);
  let nextMs = latest.getTime() + conditionedGapMs;

  if (release.confidence >= 0.35 && cadenceMs <= 14 * DAY) {
    const phased = setUtcSecondOfDay(nextMs, release.secondOfDay);
    if (phased > latest.getTime() + Math.min(6 * HOUR, conditionedGapMs * 0.35)) {
      nextMs = phased;
    }
  }

  const observedJitterMs = Math.max(
    distribution.p75Ms - distribution.p25Ms,
    release.spreadSeconds * 1000,
    cadenceMs * 0.04,
  );
  const uncertaintyMs = clamp(
    observedJitterMs,
    cadenceMs <= 2 * DAY ? 20 * 60 * 1000 : 45 * 60 * 1000,
    Math.min(cadenceMs * 0.55, 36 * HOUR),
  );

  const elapsedAfterExpectedMs = asOf.getTime() - nextMs;
  let probability;
  if (elapsedAfterExpectedMs <= -uncertaintyMs) {
    probability = 0;
  } else if (elapsedAfterExpectedMs < 0) {
    probability = clamp(0.25 + 0.25 * (1 + elapsedAfterExpectedMs / uncertaintyMs), 0, 0.5);
  } else if (elapsedAfterExpectedMs <= uncertaintyMs) {
    probability = clamp(0.5 + 0.3 * (elapsedAfterExpectedMs / uncertaintyMs), 0.5, 0.8);
  } else if (elapsedAfterExpectedMs <= uncertaintyMs * 3) {
    probability = clamp(0.8 + 0.15 * ((elapsedAfterExpectedMs - uncertaintyMs) / (uncertaintyMs * 2)), 0.8, 0.95);
  } else {
    probability = 0.97;
  }

  const remainingDays = Math.max(0, (nextMs - asOf.getTime()) / DAY);
  const analogueRemaining = analogueRemainingStats?.medianDays ?? Infinity;
  const currentSilenceDays = Math.max(0, (asOf.getTime() - latest.getTime()) / DAY);
  const eventUsable = distribution.confidence >= 0.42
    && cadenceMs <= 21 * DAY
    && currentSilenceDays <= Math.max(6, (cadenceMs / DAY) * 2.75)
    && remainingDays <= Math.max(analogueRemaining + 2, (cadenceMs / DAY) * 1.75);

  return {
    usable: eventUsable,
    confidence: round(clamp(distribution.confidence * 0.72 + release.confidence * 0.28, 0, 1), 3),
    nextEpisodeAt: formatUtc(new Date(nextMs)),
    expectedBy: formatUtc(new Date(nextMs)),
    probablyBy: formatUtc(new Date(nextMs + uncertaintyMs)),
    definitelyBy: formatUtc(new Date(nextMs + Math.max(uncertaintyMs * 3, distribution.p95Ms - conditionedGapMs, uncertaintyMs))),
    cadenceDays: round(cadenceMs / DAY, 3),
    conditionedGapDays: round(conditionedGapMs / DAY, 3),
    remainingDays: round(remainingDays, 3),
    uncertaintyDays: round(uncertaintyMs / DAY, 3),
    probability: round(clamp(probability, 0, 1), 3),
    releaseSecondOfDay: round(release.secondOfDay, 0),
    releaseSpreadHours: round(release.spreadSeconds / 3600, 2),
    source: 'episode_event_phase',
  };
}

function forecastCadenceDaysFromDue(due) {
  const eventCadence = due?.eventForecast?.usable ? due.eventForecast.cadenceDays : null;
  if (eventCadence && Number.isFinite(eventCadence) && eventCadence > 0) return eventCadence;

  const median = due?.gapStats?.medianDays;
  if (Number.isFinite(median) && median > 0) return median;

  const historical = due?.gapStats?.historical?.medianDays;
  if (Number.isFinite(historical) && historical > 0) return historical;

  return 7;
}

function historicalGapStats(gapsDays) {
  return {
    medianDays: round(gapsDays.length ? percentile(gapsDays, 50) : 0, 2),
    p75Days: round(gapsDays.length ? percentile(gapsDays, 75) : 0, 2),
    p90Days: round(gapsDays.length ? percentile(gapsDays, 90) : 0, 2),
    p95Days: round(gapsDays.length ? percentile(gapsDays, 95) : 0, 2),
    maxDays: round(gapsDays.length ? Math.max(...gapsDays) : 0, 2),
  };
}

function addDaysUtc(base, days) {
  return formatUtc(new Date(base.getTime() + Math.max(0, days) * DAY));
}

function buildDueState({ items, asOf, curveInfo, model }) {
  const latest = items[items.length - 1].date;
  const daysSince = Math.max(0, (asOf.getTime() - latest.getTime()) / DAY);
  const trendItems = trendWindowItems(items, { minItems: 18, maxItems: 180, maxSpanDays: 365 * 3 });
  const gapsDays = episodeGapsMs(trendItems).map((gap) => gap / DAY).filter((gap) => Number.isFinite(gap) && gap > 0);
  const historical = historicalGapStats(gapsDays);
  const { analogues, tailSamples } = findCurveAnalogues({ items, curveInfo, model, asOf });

  const analogueTotalRows = analogues.map((row) => ({ value: row.totalGapDays, weight: row.weight }));
  const analogueRemainingRows = analogues.map((row) => ({ value: row.remainingDays, weight: row.weight }));
  const topSimilarity = analogues.length ? Math.max(...analogues.map((row) => row.similarity)) : 0;
  const meanSimilarity = analogues.length ? weightedMean(analogues.map((row) => ({ value: row.similarity, weight: row.weight }))) : 0;
  const analogueWeight = analogues.reduce((sum, row) => sum + row.weight, 0);
  const hasUsableAnalogues = analogueTotalRows.length >= 5 && topSimilarity >= 0.44 && meanSimilarity >= 0.38 && analogueWeight > 0.015;

  const fallbackRows = fallbackGapRows(gapsDays);
  const fallbackRemainingRows = gapsDays.map((gap) => ({ value: Math.max(0, gap - daysSince), weight: 1 }));
  const totalRows = hasUsableAnalogues ? analogueTotalRows : fallbackRows;
  const source = hasUsableAnalogues ? 'curve_analogues' : 'historical_gaps';

  const gapStats = {
    medianDays: round(totalRows.length ? weightedPercentile(totalRows, 50) : 0, 2),
    p75Days: round(totalRows.length ? weightedPercentile(totalRows, 75) : 0, 2),
    p90Days: round(totalRows.length ? weightedPercentile(totalRows, 90) : 0, 2),
    p95Days: round(totalRows.length ? weightedPercentile(totalRows, 95) : 0, 2),
    maxDays: round(totalRows.length ? Math.max(...totalRows.map((row) => row.value)) : 0, 2),
    source,
    analogueCount: analogues.length,
    usableAnalogueCount: hasUsableAnalogues ? analogues.length : 0,
    topSimilarity: round(topSimilarity, 3),
    meanSimilarity: round(meanSimilarity, 3),
    tailDays: round((tailSamples * curveInfo.stepMs) / DAY, 2),
    historical,
  };

  let remainingRows = hasUsableAnalogues ? analogueRemainingRows : fallbackRemainingRows;
  let remainingStats = {
    medianDays: round(remainingRows.length ? weightedPercentile(remainingRows, 50) : Math.max(0, gapStats.medianDays - daysSince), 2),
    p25Days: round(remainingRows.length ? weightedPercentile(remainingRows, 25) : Math.max(0, gapStats.p75Days - daysSince), 2),
    p75Days: round(remainingRows.length ? weightedPercentile(remainingRows, 75) : Math.max(0, gapStats.p75Days - daysSince), 2),
    p90Days: round(remainingRows.length ? weightedPercentile(remainingRows, 90) : Math.max(0, gapStats.p90Days - daysSince), 2),
    p95Days: round(remainingRows.length ? weightedPercentile(remainingRows, 95) : Math.max(0, gapStats.p95Days - daysSince), 2),
  };

  const eventForecast = inferNextEpisodeEvent({ items, asOf, analogueRemainingStats: remainingStats, model });
  let expectedBy = addDaysUtc(asOf, remainingStats.medianDays);
  let probablyBy = addDaysUtc(asOf, remainingStats.p75Days);
  let definitelyBy = addDaysUtc(asOf, remainingStats.p95Days);
  let probability = round(clamp(weightedShare(totalRows, (row) => row.value <= daysSince), 0, 1), 3);

  if (eventForecast?.usable) {
    expectedBy = eventForecast.expectedBy;
    probablyBy = eventForecast.probablyBy;
    definitelyBy = eventForecast.definitelyBy;
    probability = eventForecast.probability;
    remainingStats = {
      ...remainingStats,
      medianDays: eventForecast.remainingDays,
      p25Days: Math.max(0, eventForecast.remainingDays - eventForecast.uncertaintyDays),
      p75Days: eventForecast.remainingDays + eventForecast.uncertaintyDays,
      p90Days: eventForecast.remainingDays + eventForecast.uncertaintyDays * 2,
      p95Days: eventForecast.remainingDays + eventForecast.uncertaintyDays * 3,
      source: eventForecast.source,
    };
  }

  const dueNowWindowDays = 0.125;
  const nearWindowDays = Math.max(0.25, Math.min(1.25, gapStats.medianDays * 0.18));
  const soonProbability = eventForecast?.usable
    ? (remainingStats.p75Days <= nearWindowDays ? 1 : 0)
    : round(clamp(weightedShare(remainingRows, (row) => row.value <= nearWindowDays), 0, 1), 3);

  const historicalInactiveThreshold = inactiveThresholdDays({
    medianDays: historical.medianDays,
    p95Days: historical.p95Days,
    maxDays: historical.maxDays,
  });
  const analogueInactiveThreshold = inactiveThresholdDays(gapStats);
  const weakLongSilence = daysSince >= 90 && !hasUsableAnalogues && daysSince > Math.max(historical.p90Days || 0, historical.medianDays * 2.2 || 0);
  const beyondHistorical = historical.maxDays > 0 && daysSince > historicalInactiveThreshold;
  const beyondAnalogue = hasUsableAnalogues && gapStats.maxDays > 0 && daysSince > analogueInactiveThreshold;
  const farBeyondEvent = eventForecast?.usable && daysSince > Math.max(eventForecast.cadenceDays * 3.5, eventForecast.cadenceDays + 14);

  let status;
  let note;
  if (beyondHistorical || beyondAnalogue || weakLongSilence || farBeyondEvent) {
    status = 'inactive';
    note = `No episode for ${round(daysSince, 1)} days; matched history does not support checking this window.`;
  } else if (probability >= 0.97) {
    status = 'overdue';
    note = `Past nearly all matched continuations; new content is very likely already available.`;
  } else if (probability >= 0.9 || (!eventForecast?.usable && remainingStats.p25Days <= dueNowWindowDays)) {
    status = 'likely_waiting';
    note = `Matched curve states put the next episode inside the current checking window.`;
  } else if (probability >= 0.75 || remainingStats.medianDays <= dueNowWindowDays) {
    status = 'probably_due';
    note = `Matched curve states put the next episode very close.`;
  } else if (probability >= 0.45 || remainingStats.p75Days <= Math.max(1, nearWindowDays * 2.5)) {
    status = 'on_schedule';
    note = eventForecast?.usable
      ? `Approaching the expected episode event; forecast remains ${round(remainingStats.medianDays, 2)} days out.`
      : `Approaching the matched activity curve; median remaining ${remainingStats.medianDays} days.`;
  } else {
    status = 'early';
    note = eventForecast?.usable
      ? `Still early; next episode event forecast is ${round(remainingStats.medianDays, 2)} days out.`
      : `Still early on the matched activity curve; median remaining ${remainingStats.medianDays} days.`;
  }

  return {
    status,
    note,
    probability,
    daysSinceLastEpisode: round(daysSince, 2),
    lastEpisodeAt: formatUtc(latest),
    expectedBy,
    probablyBy,
    definitelyBy,
    nextEpisodeAt: eventForecast?.usable ? eventForecast.nextEpisodeAt : expectedBy,
    expectedRemainingDays: remainingStats.medianDays,
    remainingStats,
    upcomingProbability: soonProbability,
    gapStats,
    eventForecast,
    analogues: analogues.slice(0, 10).map((row) => ({
      similarity: round(row.similarity, 3),
      scale: row.scale,
      candidateAt: row.candidateAt,
      previousEpisodeAt: row.previousEpisodeAt,
      nextEpisodeAt: row.nextEpisodeAt,
      totalGapDays: round(row.totalGapDays, 2),
      elapsedDays: round(row.elapsedDays, 2),
      remainingDays: round(row.remainingDays, 2),
    })),
  };
}

function classifyPublishing(due) {
  const { daysSinceLastEpisode: daysSince, gapStats, status } = due;
  const farBeyondCurve = gapStats.maxDays > 0 && daysSince > inactiveThresholdDays(gapStats);
  if (status === 'inactive' || farBeyondCurve) {
    return { status: 'inactive', label: 'Likely inactive; current silence no longer matches prior activity curves' };
  }
  if (status === 'overdue') {
    return { status: 'active_late', label: 'Publishing curve still exists, currently overdue' };
  }
  if (status === 'likely_waiting') {
    return { status: 'active_late', label: 'Publishing curve points to a likely new episode' };
  }
  return { status: 'active', label: 'Within matched publishing curve' };
}

function classifySchedule(pattern) {
  const { kind, confidence } = pattern;
  if (kind !== 'random' && confidence >= 0.72) return { tier: 'regular', label: `Strong ${kind} curve` };
  if (kind !== 'random' && confidence >= 0.52) return { tier: 'moderate', label: `Moderate ${kind} curve` };
  if (kind !== 'random' && confidence >= 0.32) return { tier: 'loose', label: `Loose ${kind} curve` };
  return { tier: 'irregular', label: 'No reliable repeated curve' };
}

function slotAlignmentBoost() {
  return 0;
}

function computeNextCheckAt({ due, lastCheckedAt, minCheckIntervalHours, asOf, shouldDefer }) {
  const minNext = lastCheckedAt
    ? new Date(lastCheckedAt.getTime() + minCheckIntervalHours * HOUR)
    : asOf;
  const clampToMinNext = (date) => {
    if (!date) return minNext > asOf ? formatUtc(minNext) : null;
    const chosen = date > minNext ? date : minNext;
    return chosen > asOf ? formatUtc(chosen) : null;
  };

  if (due.status === 'inactive') {
    const historical = due.gapStats?.historical || due.gapStats || {};
    const deferDays = Math.max(30, historical.p95Days || 0, (historical.maxDays || 0) * 0.5, due.gapStats.p95Days || 0);
    return formatUtc(new Date(asOf.getTime() + deferDays * DAY));
  }

  const expected = parseInstant(due.expectedBy);
  const probably = parseInstant(due.probablyBy);

  if (shouldDefer || due.status === 'early' || due.status === 'on_schedule') {
    return clampToMinNext(probably || expected);
  }

  if (due.status === 'probably_due') {
    return clampToMinNext(expected || probably);
  }

  if (minNext > asOf) return formatUtc(minNext);
  return null;
}

function priorityTier(score) {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'normal';
  if (score >= 15) return 'low';
  if (score >= 5) return 'defer';
  return 'skip';
}

function duePriorityBase(status) {
  switch (status) {
    case 'overdue': return 88;
    case 'likely_waiting': return 74;
    case 'probably_due': return 62;
    case 'on_schedule': return 42;
    case 'early': return 18;
    case 'inactive': return 4;
    default: return 20;
  }
}

function assessRandomness({ model, due }) {
  if (model.kind !== 'random' && model.confidence >= 0.52) {
    return {
      verdict: 'structured',
      summary: `Activity curve repeats when overlaid at ~${round(model.lagMs / DAY, 2)} days.`,
      humanRarelyRandom: true,
    };
  }
  if (due.gapStats.source === 'curve_analogues' && due.gapStats.analogueCount >= 3) {
    return {
      verdict: 'weakly_structured',
      summary: 'No dominant global overlay, but the current curve has historical analogue states.',
      humanRarelyRandom: true,
    };
  }
  return {
    verdict: 'memoryless',
    summary: 'No repeated activity-curve shape survived self-overlay scoring.',
    humanRarelyRandom: false,
  };
}

export function analyzeFeedHistory(input) {
  const items = normalizeEpisodes(input.episodes);
  if (!items.length) return { error: 'No dated episodes' };

  const latest = items[items.length - 1].date;
  const asOf = parseInstant(input.now) || new Date();
  const modelCurve = buildActivityCurve(items, { asOf: latest });
  const pattern = findCurveOverlayPattern(items, modelCurve);
  const dueCurve = buildActivityCurve(items, { asOf });
  const checkSlot = buildCheckSlot({ items, model: pattern });
  const due = buildDueState({ items, asOf, curveInfo: dueCurve, model: pattern });
  const schedule = classifySchedule(pattern);
  const publishing = classifyPublishing(due);
  const randomness = assessRandomness({ model: pattern, due });
  const lobes = findActiveCurveLobes(modelCurve);

  return {
    id: input.id,
    name: input.name || input.id,
    episodeCount: items.length,
    pattern: {
      kind: pattern.kind,
      confidence: pattern.confidence,
      detectedPeriodDays: pattern.lagDays,
    },
    schedule,
    publishing,
    randomness,
    checkSlot,
    due,
    curveFit: {
      method: 'smoothed_impulse_curve_self_overlay',
      detectedPeriodDays: pattern.lagDays,
      confidence: pattern.confidence,
      score: pattern.score,
      correlation: pattern.correlation,
      overlap: pattern.overlap,
      cycles: pattern.cycles,
      projection: pattern.projection,
      peaks: pattern.peaks,
      curve: {
        sampleCount: modelCurve.sampleCount,
        stepDays: round(modelCurve.stepMs / DAY, 4),
        kernelDays: round(modelCurve.kernelMs / DAY, 4),
      },
      lobes,
    },
    recentEpisodes: items.slice(-5).map((item) => ({
      title: item.title,
      publishedAt: formatUtc(item.date),
    })),
  };
}

function buildProjectedCurve(curveInfo, pattern, anchorDate, endMs) {
  if (!pattern.lagMs || pattern.lagMs <= 0 || !curveInfo.raw.length) return [];
  const lagSamples = Math.max(1, Math.round(pattern.lagMs / curveInfo.stepMs));
  const segment = curveInfo.raw.slice(-lagSamples);
  const segMax = Math.max(...segment, 1e-6);
  const anchorMs = anchorDate.getTime();
  const out = [];
  for (let t = anchorMs; t <= endMs; t += curveInfo.stepMs) {
    const offset = Math.floor((t - anchorMs) / curveInfo.stepMs);
    out.push({ t, value: (segment[offset % segment.length] ?? 0) / segMax });
  }
  return out;
}

export function buildFeedVisualization(input, options = {}) {
  const forecastCount = Number(options.forecastCount ?? 8);
  const historyDays = Number(options.historyDays ?? 120);
  const items = normalizeEpisodes(input.episodes);
  if (!items.length) return { error: 'No dated episodes' };

  const asOf = parseInstant(input.now) || new Date();
  const analysis = analyzeFeedHistory({ ...input, now: asOf });
  const latest = items[items.length - 1].date;
  const modelCurve = buildActivityCurve(items, { asOf: latest });
  const pattern = findCurveOverlayPattern(items, modelCurve);

  const cadenceDays = Math.max(forecastCadenceDaysFromDue(analysis.due), 0.25);
  const firstForecastAt = parseInstant(analysis.due?.nextEpisodeAt || analysis.due?.expectedBy)
    || new Date(asOf.getTime() + Math.max(0, analysis.due?.expectedRemainingDays || 0) * DAY);
  const periodMs = cadenceDays * DAY;
  const forecastEndMs = firstForecastAt.getTime() + periodMs * Math.max(1, forecastCount - 1);
  const historyStartMs = Math.max(items[0].date.getTime(), asOf.getTime() - historyDays * DAY);
  const chartEndMs = Math.max(latest.getTime(), forecastEndMs, asOf.getTime() + DAY);

  const displayCurve = buildActivityCurve(items, { asOf: new Date(chartEndMs) });
  const rawMax = Math.max(...displayCurve.raw, 1e-6);

  const curve = [];
  for (let i = 0; i < displayCurve.sampleCount; i += 1) {
    const t = displayCurve.startMs + i * displayCurve.stepMs;
    if (t < historyStartMs || t > chartEndMs) continue;
    curve.push({
      t,
      value: round(displayCurve.raw[i] / rawMax, 4),
      normalized: round(displayCurve.normalized[i], 4),
    });
  }

  const projectedCurve = buildProjectedCurve(displayCurve, { ...pattern, lagMs: periodMs }, firstForecastAt, chartEndMs).map((point) => ({
    t: point.t,
    value: round(point.value, 4),
  }));

  const forecasts = [];
  const eventSequence = analysis.due?.eventForecast?.usable && Array.isArray(analysis.due.eventForecast.nextEvents)
    ? analysis.due.eventForecast.nextEvents
    : [];
  const forecastBasis = eventSequence.length
    ? 'event sequence phase'
    : (analysis.due?.gapStats?.source === 'curve_analogues' ? 'curve analogue continuation' : 'historical continuation fallback');

  if (eventSequence.length) {
    for (let i = 0; i < Math.min(forecastCount, eventSequence.length); i += 1) {
      const event = eventSequence[i];
      forecasts.push({
        t: parseInstant(event.at).getTime(),
        index: i + 1,
        confidence: event.confidence ?? round(Math.exp(-i / 8), 3),
        basis: event.basis || forecastBasis,
      });
    }
  } else {
    let cursor = firstForecastAt.getTime();
    for (let i = 1; i <= forecastCount; i += 1) {
      if (i > 1) cursor += periodMs;
      forecasts.push({
        t: cursor,
        index: i,
        confidence: round(Math.max(0.05, (1 - Math.min(0.95, analysis.due.expectedRemainingDays / Math.max(analysis.due.gapStats.p95Days || 1, 1))) * Math.exp(-(i - 1) / 8)), 3),
        basis: forecastBasis,
      });
    }
  }

  const episodes = items
    .filter((item) => item.date.getTime() >= historyStartMs && item.date.getTime() <= chartEndMs)
    .map((item) => ({
      t: item.date.getTime(),
      title: item.title,
    }));

  return {
    id: analysis.id,
    name: analysis.name,
    summary: {
      pattern: analysis.pattern,
      schedule: analysis.schedule,
      due: {
        status: analysis.due.status,
        probablyBy: analysis.due.probablyBy,
        definitelyBy: analysis.due.definitelyBy,
        nextEpisodeAt: analysis.due.nextEpisodeAt,
        daysSinceLastEpisode: analysis.due.daysSinceLastEpisode,
      },
      publishing: analysis.publishing,
      curveFit: analysis.curveFit,
    },
    window: {
      startMs: historyStartMs,
      endMs: chartEndMs,
      asOfMs: asOf.getTime(),
      lastEpisodeMs: latest.getTime(),
    },
    curve,
    projectedCurve,
    episodes,
    forecasts,
  };
}

export function scoreFeedCheckPriority(input, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const asOf = parseInstant(input.now) || new Date();
  const lastCheckedAt = parseInstant(input.lastCheckedAt);
  const weight = Number(input.weight ?? opts.weight) || 1;
  const minCheckIntervalHours = Number(input.minCheckIntervalHours ?? opts.minCheckIntervalHours) || DEFAULTS.minCheckIntervalHours;

  const analysis = analyzeFeedHistory({ ...input, now: asOf });
  if (analysis.error) {
    return {
      id: input.id,
      name: input.name || input.id,
      checkPriority: 100,
      checkTier: 'critical',
      shouldCheckNow: true,
      nextCheckAt: null,
      reason: 'No dated episodes in cache — check to establish baseline.',
      error: analysis.error,
    };
  }

  const hoursSinceCheck = lastCheckedAt ? (asOf.getTime() - lastCheckedAt.getTime()) / HOUR : Infinity;
  const onCooldown = Number.isFinite(hoursSinceCheck) && hoursSinceCheck < minCheckIntervalHours;

  let priority = duePriorityBase(analysis.due.status);
  priority += analysis.due.probability * 20;
  priority += (analysis.due.upcomingProbability || 0) * 10;
  priority += slotAlignmentBoost(analysis.checkSlot, asOf);
  if (analysis.schedule.tier === 'regular') priority += 6;
  if (analysis.publishing.status === 'inactive') priority *= 0.15;
  priority *= weight;

  if (onCooldown) {
    if (analysis.due.status === 'overdue' || analysis.due.status === 'likely_waiting') {
      priority = Math.max(priority, 70);
    } else if (analysis.due.status === 'probably_due') {
      priority = Math.max(priority * 0.75, 45);
    } else {
      priority *= 0.08;
    }
  }

  priority = round(clamp(priority, 0, 100), 1);
  const checkTier = priorityTier(priority);

  const shouldDefer = analysis.due.status === 'early' || analysis.due.status === 'inactive';
  const nextCheckAt = computeNextCheckAt({
    due: analysis.due,
    lastCheckedAt,
    minCheckIntervalHours,
    asOf,
    shouldDefer,
  });

  let shouldCheckNow = priority >= opts.minPriority;
  const futureNextCheck = nextCheckAt ? parseInstant(nextCheckAt) : null;
  if (onCooldown && analysis.due.status !== 'overdue' && analysis.due.status !== 'likely_waiting') shouldCheckNow = false;
  if (analysis.publishing.status === 'inactive' && weight <= 1) shouldCheckNow = false;
  if (futureNextCheck && futureNextCheck > asOf && analysis.due.status !== 'overdue' && analysis.due.status !== 'likely_waiting') shouldCheckNow = false;
  if ((checkTier === 'critical' || checkTier === 'high') && !(futureNextCheck && futureNextCheck > asOf && analysis.due.status !== 'overdue' && analysis.due.status !== 'likely_waiting')) shouldCheckNow = true;

  const reasonParts = [
    analysis.due.note,
    onCooldown ? `Last checked ${round(hoursSinceCheck, 1)}h ago (min interval ${minCheckIntervalHours}h).` : 'Never checked or outside cooldown.',
    analysis.schedule.label,
  ];
  if (analysis.checkSlot.weekdayName) {
    reasonParts.push(`Curve projects to: ${analysis.checkSlot.weekdayName} ${analysis.checkSlot.checkWindowUtc || ''} UTC`.trim());
  } else if (analysis.due.expectedBy) {
    reasonParts.push(`Expected by ${analysis.due.expectedBy}.`);
  }

  const result = {
    id: analysis.id,
    name: analysis.name,
    checkPriority: priority,
    checkTier,
    shouldCheckNow,
    nextCheckAt,
    reason: reasonParts.filter(Boolean).join(' '),
    schedule: {
      kind: analysis.pattern.kind,
      confidence: analysis.pattern.confidence,
      tier: analysis.schedule.tier,
      slot: analysis.checkSlot,
    },
    due: {
      status: analysis.due.status,
      probability: analysis.due.probability,
      daysSinceLastEpisode: analysis.due.daysSinceLastEpisode,
      lastEpisodeAt: analysis.due.lastEpisodeAt,
      expectedBy: analysis.due.expectedBy,
      probablyBy: analysis.due.probablyBy,
      definitelyBy: analysis.due.definitelyBy,
      nextEpisodeAt: analysis.due.nextEpisodeAt,
      expectedRemainingDays: analysis.due.expectedRemainingDays,
      upcomingProbability: analysis.due.upcomingProbability,
    },
    publishing: analysis.publishing,
  };

  if (opts.includeAnalysis) result.analysis = analysis;
  return result;
}

export function rankFeedsForCheck(feeds, options = {}) {
  return feeds
    .map((feed) => scoreFeedCheckPriority(feed, options))
    .sort((a, b) => {
      if (b.checkPriority !== a.checkPriority) return b.checkPriority - a.checkPriority;
      if (a.nextCheckAt && b.nextCheckAt) return a.nextCheckAt.localeCompare(b.nextCheckAt);
      return String(a.id).localeCompare(String(b.id));
    });
}

export function selectFeedsToCheck(feeds, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const ranked = rankFeedsForCheck(feeds, opts);
  const selected = [];
  for (const row of ranked) {
    if (!row.shouldCheckNow) continue;
    if (row.checkPriority < opts.minPriority) continue;
    selected.push(row);
    if (selected.length >= opts.limit) break;
  }
  return {
    selected,
    ranked,
    skipped: ranked.filter((row) => !row.shouldCheckNow),
  };
}

function readStdinJson() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.on('error', reject);
  });
}

async function cliMain() {
  const payload = await readStdinJson();
  const feeds = Array.isArray(payload) ? payload : payload.feeds;
  if (!Array.isArray(feeds)) {
    throw new Error('Expected JSON array of feeds or { feeds: [...] } on stdin');
  }
  const options = Array.isArray(payload) ? {} : (payload.options || {});
  const mode = process.argv[2] || 'rank';
  if (mode === 'select') {
    process.stdout.write(`${JSON.stringify(selectFeedsToCheck(feeds, options), null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(rankFeedsForCheck(feeds, options), null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  cliMain().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
