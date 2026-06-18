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

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

const DEFAULTS = {
  minCheckIntervalHours: 6,
  weight: 1,
  includeAnalysis: false,
  limit: Infinity,
  minPriority: 0,
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

function mad(values, center = median(values)) {
  return median(values.map((value) => Math.abs(value - center)));
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

function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-(x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function chiSquarePValue(chi2, df) {
  if (df <= 0 || chi2 <= 0) return 1;
  const z = ((chi2 / df) ** (1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return 1 - normalCdf(z);
}

function chiSquareGoodness(observed, expectedPerBin) {
  const total = observed.reduce((sum, count) => sum + count, 0);
  const bins = observed.length;
  const expected = expectedPerBin > 0
    ? Array.from({ length: bins }, () => expectedPerBin)
    : Array.from({ length: bins }, (_, index) => total / bins);
  let chi2 = 0;
  for (let i = 0; i < bins; i += 1) {
    if (expected[i] > 0) chi2 += ((observed[i] - expected[i]) ** 2) / expected[i];
  }
  const df = bins - 1;
  const pValue = chiSquarePValue(chi2, df);
  return { chi2: round(chi2, 3), df, pValue: round(pValue, 4), rejectsUniform: pValue < 0.05 };
}

function ksTestExponential(samples) {
  const positive = samples.filter((value) => value > 0);
  if (positive.length < 5) {
    return { dStatistic: 0, pValue: 1, rejectsExponential: false, sampleSize: positive.length };
  }
  const sampleMean = mean(positive);
  const sorted = [...positive].sort((a, b) => a - b);
  const n = sorted.length;
  let dMax = 0;
  for (let i = 0; i < n; i += 1) {
    const empirical = (i + 1) / n;
    const theoretical = 1 - Math.exp(-sorted[i] / sampleMean);
    const empiricalLower = i / n;
    dMax = Math.max(dMax, Math.abs(empirical - theoretical), Math.abs(empiricalLower - theoretical));
  }
  const scaled = dMax * (Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n));
  const pValue = Math.exp(-2 * scaled * scaled);
  return {
    dStatistic: round(dMax, 4),
    pValue: round(clamp(pValue, 0, 1), 4),
    rejectsExponential: pValue < 0.05,
    sampleSize: n,
    meanGapDays: round(sampleMean, 3),
  };
}

function lag1Autocorrelation(values) {
  if (values.length < 4) return { r: 0, pValue: 1, significant: false, sampleSize: values.length };
  const center = mean(values);
  let numerator = 0;
  let denominator0 = 0;
  let denominator1 = 0;
  for (let i = 0; i < values.length - 1; i += 1) {
    numerator += (values[i] - center) * (values[i + 1] - center);
    denominator0 += (values[i] - center) ** 2;
    denominator1 += (values[i + 1] - center) ** 2;
  }
  const r = denominator0 && denominator1 ? numerator / Math.sqrt(denominator0 * denominator1) : 0;
  const n = values.length - 1;
  const z = 0.5 * Math.log((1 + r) / (1 - r)) * Math.sqrt(n - 3);
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return {
    r: round(r, 4),
    pValue: round(clamp(pValue, 0, 1), 4),
    significant: pValue < 0.05,
    sampleSize: values.length,
  };
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

function weekdayName(index) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index];
}

function toUtcComponents(date) {
  return {
    weekday: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    day: date.getUTCDate(),
  };
}

function circularDistance(a, b, period) {
  const raw = Math.abs(a - b) % period;
  return Math.min(raw, period - raw);
}

function scorePeriodicWindow(values, period, tolerance, step) {
  if (!values.length) return { score: 0, anchor: 0, spread: 0 };
  let best = { score: 0, anchor: 0, spread: Infinity };
  for (let anchor = 0; anchor < period; anchor += step) {
    const distances = values.map((value) => circularDistance(value, anchor, period));
    const within = distances.filter((distance) => distance <= tolerance).length;
    const spread = mean(distances);
    const score = within / values.length * 0.75 + (1 - clamp(spread / (period / 2), 0, 1)) * 0.25;
    if (score > best.score) best = { score, anchor, spread };
  }
  return best;
}

function normalizeEpisodes(episodes) {
  const items = [];
  for (const ep of episodes || []) {
    const date = parseInstant(ep?.publishedAt ?? ep?.published_at ?? ep?.date);
    if (!date) continue;
    items.push({
      title: String(ep?.title || '').trim(),
      date,
    });
  }
  return items.sort((a, b) => a.date - b.date);
}

function assessRandomness({ items, gapsDays, weekdayCounts, hourCounts, winner }) {
  const weekdayObs = weekdayCounts.map((entry) => entry.count);
  const hourObs = hourCounts.map((entry) => entry.count);
  const weekdayChi = chiSquareGoodness(weekdayObs, items.length / 7);
  const hourChi = chiSquareGoodness(hourObs, items.length / 24);
  const gapKs = ksTestExponential(gapsDays);
  const gapAC = lag1Autocorrelation(gapsDays);
  const topWeekdayShare = Math.max(...weekdayObs) / items.length;
  const topHourShare = Math.max(...hourObs) / items.length;

  const hasWeekdayStructure = weekdayChi.rejectsUniform;
  const hasHourStructure = hourChi.rejectsUniform;
  const memorylessGaps = !gapKs.rejectsExponential;
  const hasGapMemory = gapAC.significant;

  let verdict;
  let summary;
  if (winner.kind !== 'random' && winner.score >= 0.55) {
    verdict = 'structured';
    summary = `Fits a ${winner.kind} cadence; calendar and gap tests support a repeatable schedule.`;
  } else if (hasWeekdayStructure && topWeekdayShare >= 0.35) {
    verdict = 'weekday_biased';
    summary = 'Weekday distribution rejects uniformity.';
  } else if (hasHourStructure && topHourShare >= 0.25) {
    verdict = 'time_of_day_biased';
    summary = 'Hour-of-day distribution rejects uniformity.';
  } else if (hasGapMemory || !memorylessGaps) {
    verdict = 'gap_structured';
    summary = 'Inter-arrival gaps are not memoryless.';
  } else if (hasWeekdayStructure || hasHourStructure) {
    verdict = 'weakly_structured';
    summary = 'Some calendar clustering, but no dominant slot.';
  } else {
    verdict = 'memoryless';
    summary = 'No structure detected in this sample.';
  }

  return { verdict, summary, humanRarelyRandom: verdict !== 'memoryless' };
}

function dominantHourWindow(items, targetWeekday = null) {
  const hours = items
    .filter((item) => targetWeekday === null || item.date.getUTCDay() === targetWeekday)
    .map((item) => item.date.getUTCHours() + item.date.getUTCMinutes() / 60);
  if (!hours.length) return { hour: 0, windowStart: 0, windowEnd: 0 };
  const hourCounts = Array.from({ length: 24 }, () => 0);
  for (const hour of hours) hourCounts[Math.floor(hour)] += 1;
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
  return {
    hour: peakHour,
    windowStart: Math.floor(percentile(hours, 25)),
    windowEnd: Math.ceil(percentile(hours, 75)),
  };
}

function buildCheckSlot({ items, winner, topWeekday, topHour, topMonthday }) {
  const hourWindow = winner.kind === 'weekly'
    ? dominantHourWindow(items, topWeekday.weekday)
    : dominantHourWindow(items);

  const slot = {
    pattern: winner.kind,
    confidence: round(clamp(winner.score, 0, 1), 3),
  };

  if (winner.kind === 'weekly') {
    slot.weekday = topWeekday.weekday;
    slot.weekdayName = weekdayName(topWeekday.weekday);
    slot.hourUtc = hourWindow.hour;
    slot.checkWindowUtc = `${String(hourWindow.windowStart).padStart(2, '0')}:00–${String(hourWindow.windowEnd).padStart(2, '0')}:59`;
  } else if (winner.kind === 'monthly') {
    slot.dayOfMonth = topMonthday.day;
    slot.hourUtc = topHour.hour;
    slot.checkWindowUtc = `${String(hourWindow.windowStart).padStart(2, '0')}:00–${String(hourWindow.windowEnd).padStart(2, '0')}:59`;
  } else if (winner.kind === 'daily') {
    slot.hourUtc = topHour.hour;
    slot.checkWindowUtc = `${String(hourWindow.windowStart).padStart(2, '0')}:00–${String(hourWindow.windowEnd).padStart(2, '0')}:59`;
  } else {
    slot.advice = 'Poll on probably-by / definitely-by gap windows.';
  }

  return slot;
}

function buildDueState({ latest, gapsDays, asOf }) {
  const daysSince = (asOf.getTime() - latest.getTime()) / DAY;
  const gapStats = {
    medianDays: round(gapsDays.length ? percentile(gapsDays, 50) : 0, 2),
    p75Days: round(gapsDays.length ? percentile(gapsDays, 75) : 0, 2),
    p90Days: round(gapsDays.length ? percentile(gapsDays, 90) : 0, 2),
    p95Days: round(gapsDays.length ? percentile(gapsDays, 95) : 0, 2),
    maxDays: round(gapsDays.length ? Math.max(...gapsDays) : 0, 2),
  };

  const addDays = (days) => new Date(latest.getTime() + days * DAY);
  const probablyBy = formatUtc(addDays(gapStats.p75Days));
  const definitelyBy = formatUtc(addDays(gapStats.p95Days));
  const expectedBy = formatUtc(addDays(gapStats.medianDays));

  let status;
  let note;
  if (daysSince > gapStats.maxDays * 1.05) {
    status = 'inactive';
    note = `No episode for ${round(daysSince, 1)} days — longer than any historical gap.`;
  } else if (daysSince > gapStats.p95Days) {
    status = 'overdue';
    note = `Past historical 95th-percentile gap (${gapStats.p95Days} days).`;
  } else if (daysSince > gapStats.p90Days) {
    status = 'likely_waiting';
    note = 'Beyond 90% of historical gaps — very likely new content exists.';
  } else if (daysSince > gapStats.p75Days) {
    status = 'probably_due';
    note = `Past probably-by threshold (${gapStats.p75Days} days).`;
  } else if (daysSince >= gapStats.medianDays * 0.85) {
    status = 'on_schedule';
    note = `Within normal window (median ${gapStats.medianDays} days).`;
  } else {
    status = 'early';
    note = `Still early — ${round(daysSince, 1)} days since last vs median ${gapStats.medianDays}.`;
  }

  const probability = gapsDays.length
    ? round(clamp(gapsDays.filter((gap) => gap <= daysSince).length / gapsDays.length, 0, 1), 3)
    : 0;

  return {
    status,
    note,
    probability,
    daysSinceLastEpisode: round(daysSince, 2),
    lastEpisodeAt: formatUtc(latest),
    expectedBy,
    probablyBy,
    definitelyBy,
    gapStats,
  };
}

function classifyPublishing(due) {
  const { daysSinceLastEpisode: daysSince, gapStats, status } = due;
  if (status === 'inactive' || daysSince > gapStats.maxDays * 1.25) {
    return { status: 'inactive', label: 'Likely inactive or on hiatus' };
  }
  if (daysSince > gapStats.p95Days * 1.1 && daysSince > 90) {
    return { status: 'likely_inactive', label: 'Past normal gap for 90+ days' };
  }
  if (status === 'overdue' || status === 'likely_waiting') {
    return { status: 'active_late', label: 'Publishing pattern holds, currently overdue' };
  }
  return { status: 'active', label: 'Within historical publishing rhythm' };
}

function classifySchedule(pattern) {
  const { kind, confidence } = pattern;
  if (kind !== 'random' && confidence >= 0.75) return { tier: 'regular', label: `Regular ${kind}` };
  if (kind !== 'random' && confidence >= 0.55) return { tier: 'moderate', label: `Moderate ${kind}` };
  if (kind !== 'random' && confidence >= 0.45) return { tier: 'loose', label: `Loose ${kind}` };
  return { tier: 'irregular', label: 'No reliable fixed schedule' };
}

function slotAlignmentBoost(checkSlot, asOf) {
  if (!checkSlot || checkSlot.pattern === 'random') return 0;
  const hour = asOf.getUTCHours();
  if (checkSlot.pattern === 'weekly' && checkSlot.weekday === asOf.getUTCDay()) {
    const [start, end] = (checkSlot.checkWindowUtc || '').split('–').map((part) => Number.parseInt(part, 10));
    if (!Number.isNaN(start) && !Number.isNaN(end) && hour >= start && hour <= end) return 15;
    if (checkSlot.weekday === asOf.getUTCDay()) return 8;
  }
  if (checkSlot.pattern === 'daily' && checkSlot.hourUtc !== undefined) {
    const delta = Math.abs(hour - checkSlot.hourUtc);
    if (delta <= 2) return 12;
    if (delta <= 6) return 6;
  }
  if (checkSlot.pattern === 'monthly' && checkSlot.dayOfMonth === asOf.getUTCDate()) return 10;
  return 0;
}

function computeNextCheckAt({
  due,
  checkSlot,
  lastCheckedAt,
  minCheckIntervalHours,
  asOf,
  shouldDefer,
}) {
  const minNext = lastCheckedAt
    ? new Date(lastCheckedAt.getTime() + minCheckIntervalHours * 3600 * 1000)
    : asOf;

  if (shouldDefer && due.status === 'early') {
    const expected = parseInstant(due.expectedBy);
    const probably = parseInstant(due.probablyBy);
    const candidate = probably && probably > minNext ? probably : expected;
    if (candidate && candidate > asOf) return formatUtc(candidate);
  }

  if (due.status === 'inactive') {
    const longDefer = new Date(asOf.getTime() + Math.max(30, due.gapStats.maxDays) * DAY);
    return formatUtc(longDefer);
  }

  if (due.status === 'early' || due.status === 'on_schedule') {
    const probably = parseInstant(due.probablyBy);
    if (probably && probably > minNext) return formatUtc(probably);
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

export function analyzeFeedHistory(input) {
  const items = normalizeEpisodes(input.episodes);
  if (!items.length) {
    return { error: 'No dated episodes' };
  }

  const gaps = [];
  for (let i = 1; i < items.length; i += 1) gaps.push(items[i].date - items[i - 1].date);
  const gapsDays = gaps.map((gap) => gap / DAY);

  const weekdayBuckets = Array.from({ length: 7 }, () => []);
  const hourBuckets = Array.from({ length: 24 }, () => []);
  const monthdayBuckets = Array.from({ length: 31 }, () => []);
  const timeOfWeekValues = [];
  const timeOfMonthValues = [];

  for (const item of items) {
    const { weekday, hour, minute, day } = toUtcComponents(item.date);
    weekdayBuckets[weekday].push(item.date);
    hourBuckets[hour].push(item.date);
    monthdayBuckets[day - 1].push(item.date);
    timeOfWeekValues.push(weekday * 24 + hour + minute / 60);
    timeOfMonthValues.push(day + hour / 24 + minute / 1440);
  }

  const weekdayCounts = weekdayBuckets.map((bucket, weekday) => ({ weekday, count: bucket.length }));
  const hourCounts = hourBuckets.map((bucket, hour) => ({ hour, count: bucket.length }));
  const monthdayCounts = monthdayBuckets.map((bucket, day) => ({ day: day + 1, count: bucket.length }));

  const weeklyScore = scorePeriodicWindow(timeOfWeekValues, 7 * 24, 5, 1);
  const dailyScore = scorePeriodicWindow(items.map((item) => {
    const { hour, minute } = toUtcComponents(item.date);
    return hour + minute / 60;
  }), 24, 2, 0.25);
  const monthlyScore = scorePeriodicWindow(timeOfMonthValues, 31, 2.5, 0.25);

  const topWeekday = [...weekdayCounts].sort((a, b) => b.count - a.count)[0];
  const topHour = [...hourCounts].sort((a, b) => b.count - a.count)[0];
  const topMonthday = [...monthdayCounts].sort((a, b) => b.count - a.count)[0];
  const dominantWeekdayShare = topWeekday.count / items.length;
  const dominantHourShare = topHour.count / items.length;
  const dominantMonthdayShare = topMonthday.count / items.length;

  const gapMedianDays = gaps.length ? median(gaps) / DAY : 0;
  const gapMadDays = gaps.length ? mad(gaps, median(gaps)) / DAY : 0;

  const patternCandidates = [
    {
      kind: 'daily',
      score: dailyScore.score * 0.45 + clamp((1 - gapMadDays / 1.5), 0, 1) * 0.35 + dominantHourShare * 0.2,
      periodMs: DAY,
    },
    {
      kind: 'weekly',
      score: weeklyScore.score * 0.45 + dominantWeekdayShare * 0.35 + clamp((1 - gapMadDays / 3), 0, 1) * 0.2,
      periodMs: WEEK,
    },
    {
      kind: 'monthly',
      score: monthlyScore.score * 0.45 + dominantMonthdayShare * 0.35 + clamp((1 - gapMadDays / 7), 0, 1) * 0.2,
      periodMs: 30 * DAY,
    },
    {
      kind: 'random',
      score: clamp(1 - Math.max(weeklyScore.score, dailyScore.score, monthlyScore.score), 0, 1),
      periodMs: 0,
    },
  ].sort((a, b) => b.score - a.score);

  const winner = patternCandidates[0];
  const latest = items[items.length - 1].date;
  const asOf = parseInstant(input.now) || new Date();
  const pattern = {
    kind: winner.kind,
    confidence: round(clamp(winner.score, 0, 1), 3),
  };
  const randomness = assessRandomness({ items, gapsDays, weekdayCounts, hourCounts, winner });
  const checkSlot = buildCheckSlot({ items, winner, topWeekday, topHour, topMonthday });
  const due = buildDueState({ latest, gapsDays, asOf });
  const schedule = classifySchedule(pattern);
  const publishing = classifyPublishing(due);

  return {
    id: input.id,
    name: input.name || input.id,
    episodeCount: items.length,
    pattern,
    schedule,
    publishing,
    randomness,
    checkSlot,
    due,
    recentEpisodes: items.slice(-5).map((item) => ({
      title: item.title,
      publishedAt: formatUtc(item.date),
    })),
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

  const hoursSinceCheck = lastCheckedAt ? (asOf.getTime() - lastCheckedAt.getTime()) / (3600 * 1000) : Infinity;
  const onCooldown = Number.isFinite(hoursSinceCheck) && hoursSinceCheck < minCheckIntervalHours;

  let priority = duePriorityBase(analysis.due.status);
  priority += analysis.due.probability * 20;
  priority += slotAlignmentBoost(analysis.checkSlot, asOf);
  if (analysis.schedule.tier === 'regular') priority += 6;
  if (analysis.publishing.status === 'inactive') priority *= 0.15;
  else if (analysis.publishing.status === 'likely_inactive') priority *= 0.35;
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
    checkSlot: analysis.checkSlot,
    lastCheckedAt,
    minCheckIntervalHours,
    asOf,
    shouldDefer,
  });

  let shouldCheckNow = priority >= opts.minPriority;
  if (onCooldown && analysis.due.status !== 'overdue' && analysis.due.status !== 'likely_waiting') {
    shouldCheckNow = false;
  }
  if (analysis.publishing.status === 'inactive' && weight <= 1) {
    shouldCheckNow = false;
  }
  if (nextCheckAt && parseInstant(nextCheckAt) > asOf && analysis.due.status === 'early') {
    shouldCheckNow = false;
  }
  if (checkTier === 'critical' || checkTier === 'high') {
    shouldCheckNow = true;
  }

  const reasonParts = [
    analysis.due.note,
    onCooldown ? `Last checked ${round(hoursSinceCheck, 1)}h ago (min interval ${minCheckIntervalHours}h).` : 'Never checked or outside cooldown.',
    analysis.schedule.label,
  ];
  if (analysis.checkSlot.weekdayName) {
    reasonParts.push(`Typical slot: ${analysis.checkSlot.weekdayName} ${analysis.checkSlot.checkWindowUtc || ''} UTC`.trim());
  } else if (analysis.checkSlot.hourUtc !== undefined && analysis.checkSlot.pattern === 'daily') {
    reasonParts.push(`Typical slot: daily ~${String(analysis.checkSlot.hourUtc).padStart(2, '0')}:00 UTC`);
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
