// Processes CSV text → dashboard data shape.
// Rules:
// - Consolidated / segment dashboard: Sub-Segment = "Dashboard", then subtract
//   Elimination + Adjustment Elimination (before-elimination view)
// - Segment sub-segment view: exclude Dashboard + excluded sub-segments
// - Tag priority (non-Budget): Run-rate > Pre-closing > Actual > Forecast
// - Budget rows used only for variance calculations
// - Only year 2026

export const SEGMENTS = ['Retail', 'Mitra', 'Gaming', 'Investment', 'Corporate'];
export const DASHBOARD_SUB_SEGMENT = 'Dashboard';
export const DATA_YEAR = 2026;
/** Sub-segments already embedded in Dashboard totals — subtract to get before-elimination */
export const ELIMINATION_SUB_SEGMENTS = new Set([
  'Elimination',
  'Adjustment Elimination',
]);
export const EXCLUDED_SUB_SEGMENTS = new Set([
  'Elimination',
  'Adjustment Elimination',
  'Adjustment',
  'G&A Direct HQ',
  'G&A Shared',
]);

const MONTH_ORDER = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_IDX = Object.fromEntries(MONTH_ORDER.map((m, i) => [m, i]));

const PRIMARY_TAG_PRIORITY = {
  'Run-rate': 4,
  'Pre-closing': 3,
  Actual: 2,
  Forecast: 1,
};

const METRIC_DEFS = {
  Revenue: { field: 'Revenue', budget: 'RevenueBudget', diff: 'RevenueDiff', vsBudget: 'RevenueVsBudget', ytdVsBudget: 'RevenueYTDVsBudget', hasDiff: 'hasRevenueDiff' },
  CM: { field: 'CM', budget: 'CMBudget', diff: 'CMDiff', vsBudget: 'CMVsBudget', ytdVsBudget: 'CMYTDVsBudget', hasDiff: 'hasCMDiff' },
  EBITDA: { field: 'EBITDA', budget: 'EBITDABudget', diff: 'EBITDADiff', vsBudget: 'EBITDAVsBudget', ytdVsBudget: 'EBITDAYTDVsBudget', hasDiff: 'hasEBITDADiff' },
  'Net Income': { field: 'NetIncome', budget: 'NetIncomeBudget', diff: 'NetIncomeDiff', vsBudget: 'NetIncomeVsBudget', ytdVsBudget: 'NetIncomeYTDVsBudget', hasDiff: 'hasNetIncomeDiff' },
};

function parseCSVLine(line) {
  const cols = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cols.push(cur.trim());
  return cols;
}

/** Parse numeric cells that may include thousand separators, e.g. "5,350,651,340" */
function parseNumber(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).trim().replace(/,/g, '');
  if (cleaned === '') return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseRows(csvText) {
  const lines = csvText.replace(/\r/g, '').split('\n');
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('Selected Month')) break;

    const cols = parseCSVLine(line);
    if (cols.length < 8) continue;

    const year = cols[0]?.trim();
    const month = cols[1]?.trim();
    const segment = cols[2]?.trim();
    const subSegment = cols[3]?.trim();
    const subcat = cols[5]?.trim();
    const tag = cols[6]?.trim() ?? '';
    const amtStr = cols[7]?.trim();
    const diffStr = cols[9]?.trim() ?? '';
    const diffYtdStr = cols[10]?.trim() ?? '';

    if (!year?.match(/^\d{4}$/) || parseInt(year, 10) !== DATA_YEAR) continue;
    if (!month || !subcat || !amtStr) continue;

    const amount = parseNumber(amtStr);
    if (amount == null) continue;

    rows.push({
      year: parseInt(year, 10),
      month,
      segment,
      subSegment,
      subcat,
      tag,
      amount,
      difference: parseNumber(diffStr),
      differenceYtdBudget: parseNumber(diffYtdStr),
    });
  }

  return rows;
}

function rowKey(r) {
  return `${r.year}|${r.month}|${r.segment}|${r.subSegment}|${r.subcat}`;
}

function pickPrimaryRows(rows) {
  const best = new Map();
  for (const r of rows) {
    if (r.tag === 'Budget') continue;
    const key = rowKey(r);
    const priority = PRIMARY_TAG_PRIORITY[r.tag] ?? 0;
    const existing = best.get(key);
    if (!existing || priority > existing.priority) {
      best.set(key, { row: r, priority });
    }
  }
  return [...best.values()].map((e) => e.row);
}

function monthMeta(year, month) {
  const mn = MONTH_IDX[month] + 1;
  return {
    year,
    month,
    monthNum: mn,
    quarter: Math.ceil(mn / 3),
    date: `${year}-${String(mn).padStart(2, '0')}-01`,
  };
}

function matchesScope(r, scope) {
  const {
    mode = 'consolidated',
    segment = null,
    subSegment = null,
  } = scope;

  if (mode === 'consolidated') {
    return r.subSegment === DASHBOARD_SUB_SEGMENT;
  }
  if (mode === 'segment-dashboard') {
    return r.segment === segment && r.subSegment === DASHBOARD_SUB_SEGMENT;
  }
  if (mode === 'segment-total') {
    return r.segment === segment
      && r.subSegment !== DASHBOARD_SUB_SEGMENT
      && !EXCLUDED_SUB_SEGMENTS.has(r.subSegment);
  }
  if (mode === 'subsegment') {
    return r.segment === segment && r.subSegment === subSegment;
  }
  return false;
}

function ebitdaSubcat(ebitdaMetric) {
  return ebitdaMetric === 'Adj. EBITDA' ? 'Adj. EBITDA' : 'EBITDA';
}

function resolveSubcat(metric, ebitdaMetric) {
  if (metric === 'EBITDA') return ebitdaSubcat(ebitdaMetric);
  return metric;
}

/** Subcategories to subtract from Dashboard for a given metric (Elimination rows often use EBITDA, not Adj. EBITDA). */
function eliminationSubcatsFor(metric, ebitdaMetric) {
  if (metric === 'EBITDA' && ebitdaMetric === 'Adj. EBITDA') {
    return ['Adj. EBITDA', 'EBITDA'];
  }
  return [resolveSubcat(metric, ebitdaMetric)];
}

function wantsBeforeElimination(scope) {
  return scope.mode === 'consolidated' || scope.mode === 'segment-dashboard';
}

function matchesEliminationScope(r, scope) {
  if (!ELIMINATION_SUB_SEGMENTS.has(r.subSegment)) return false;
  if (scope.mode === 'consolidated') return true;
  if (scope.mode === 'segment-dashboard') return r.segment === scope.segment;
  return false;
}

/**
 * Sum elimination amounts for a metric.
 * Prefer Adj. EBITDA over EBITDA per segment/month/sub-segment when both exist.
 */
function sumEliminationMetric(rows, year, month, scope, metric, ebitdaMetric) {
  const subcats = eliminationSubcatsFor(metric, ebitdaMetric);
  const byKey = new Map(); // year|month|segment|subSegment -> { amount, difference, differenceYtdBudget, subcat }

  for (const r of rows) {
    if (r.year !== year || r.month !== month) continue;
    if (!matchesEliminationScope(r, scope)) continue;
    if (!subcats.includes(r.subcat)) continue;

    const key = `${r.year}|${r.month}|${r.segment}|${r.subSegment}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        amount: r.amount,
        difference: r.difference,
        differenceYtdBudget: r.differenceYtdBudget,
        subcat: r.subcat,
      });
      continue;
    }
    // Prefer Adj. EBITDA if both Adj. EBITDA and EBITDA are present
    if (existing.subcat === 'EBITDA' && r.subcat === 'Adj. EBITDA') {
      byKey.set(key, {
        amount: r.amount,
        difference: r.difference,
        differenceYtdBudget: r.differenceYtdBudget,
        subcat: r.subcat,
      });
    } else if (existing.subcat === r.subcat) {
      existing.amount += r.amount;
      if (r.difference != null) {
        existing.difference = (existing.difference ?? 0) + r.difference;
      }
      if (r.differenceYtdBudget != null) {
        existing.differenceYtdBudget = (existing.differenceYtdBudget ?? 0) + r.differenceYtdBudget;
      }
    }
  }

  let amount = 0;
  let difference = 0;
  let hasDiff = false;
  let differenceYtdBudget = 0;
  let hasYtd = false;
  for (const v of byKey.values()) {
    amount += v.amount;
    if (v.difference != null) { difference += v.difference; hasDiff = true; }
    if (v.differenceYtdBudget != null) { differenceYtdBudget += v.differenceYtdBudget; hasYtd = true; }
  }
  return { amount, difference, hasDiff, differenceYtdBudget, hasYtd };
}

function sumBudget(budgetRows, year, month, subcat, scope, metric, ebitdaMetric) {
  let total = 0;
  for (const r of budgetRows) {
    if (r.year !== year || r.month !== month || r.subcat !== subcat) continue;
    if (!matchesScope(r, scope)) continue;
    total += r.amount;
  }
  if (wantsBeforeElimination(scope) && metric != null) {
    const elim = sumEliminationMetric(budgetRows, year, month, scope, metric, ebitdaMetric);
    total -= elim.amount;
  }
  return total;
}

function emptyBucket(year, month, metrics) {
  const bucket = { ...monthMeta(year, month), tag: '' };
  for (const metric of metrics) {
    const def = METRIC_DEFS[metric === 'EBITDA' ? 'EBITDA' : metric];
    bucket[def.field] = 0;
    bucket[def.diff] = 0;
    bucket[def.hasDiff] = false;
    bucket[`${def.field}YtdDiff`] = 0;
    bucket[`${def.field}HasYtdDiff`] = false;
  }
  return bucket;
}

function aggregateMonthly(primaryRows, budgetRows, scope, { ebitdaMetric = 'Adj. EBITDA', metrics = ['Revenue', 'EBITDA', 'Net Income'] } = {}) {
  const bucket = {};
  const resolvedMetrics = metrics.map((m) => (m === 'EBITDA' ? 'EBITDA' : m));
  const subcats = resolvedMetrics.map((m) => resolveSubcat(m, ebitdaMetric));
  const beforeElim = wantsBeforeElimination(scope);

  for (const r of primaryRows) {
    if (!matchesScope(r, scope)) continue;

    const metricIdx = subcats.indexOf(r.subcat);
    if (metricIdx === -1) continue;

    const metric = resolvedMetrics[metricIdx];
    const def = METRIC_DEFS[metric];
    const mk = `${r.year}-${r.month}`;

    if (!bucket[mk]) bucket[mk] = emptyBucket(r.year, r.month, resolvedMetrics);
    const d = bucket[mk];

    if ((PRIMARY_TAG_PRIORITY[r.tag] ?? 0) > (PRIMARY_TAG_PRIORITY[d.tag] ?? 0)) d.tag = r.tag;

    d[def.field] += r.amount;
    if (r.difference != null) {
      d[def.diff] += r.difference;
      d[def.hasDiff] = true;
    }
    if (r.differenceYtdBudget != null) {
      d[`${def.field}YtdDiff`] += r.differenceYtdBudget;
      d[`${def.field}HasYtdDiff`] = true;
    }
  }

  // Dashboard totals already include Elimination — subtract to get before-elimination figures
  if (beforeElim) {
    const monthKeys = Object.keys(bucket);
    // Also create months that only exist on elimination if dashboard was empty (unlikely)
    for (const mk of monthKeys) {
      const d = bucket[mk];
      for (const metric of resolvedMetrics) {
        const def = METRIC_DEFS[metric];
        const elim = sumEliminationMetric(primaryRows, d.year, d.month, scope, metric, ebitdaMetric);
        d[def.field] -= elim.amount;
        if (elim.hasDiff) {
          d[def.diff] -= elim.difference;
          d[def.hasDiff] = true;
        }
        if (elim.hasYtd) {
          d[`${def.field}YtdDiff`] -= elim.differenceYtdBudget;
          d[`${def.field}HasYtdDiff`] = true;
        }
      }
    }
  }

  const monthly = Object.values(bucket)
    .sort((a, b) => MONTH_IDX[a.month] - MONTH_IDX[b.month])
    .map((d) => {
      const row = {
        year: d.year,
        month: d.month,
        monthNum: d.monthNum,
        quarter: d.quarter,
        date: d.date,
        tag: d.tag,
      };

      for (const metric of resolvedMetrics) {
        const def = METRIC_DEFS[metric];
        const subcat = resolveSubcat(metric, ebitdaMetric);
        const budget = sumBudget(budgetRows, d.year, d.month, subcat, scope, metric, ebitdaMetric);
        const actual = d[def.field];

        row[def.field] = Math.round(actual);
        row[def.budget] = Math.round(budget);
        row[def.vsBudget] = Math.round(actual - budget);
        row[def.diff] = d[def.hasDiff] ? Math.round(d[def.diff]) : null;
        // Prefer CSV "Difference YTD Budget" when present; else compute from cumulative actual − budget
        row[`_${def.field}YtdFromCsv`] = d[`${def.field}HasYtdDiff`]
          ? Math.round(d[`${def.field}YtdDiff`])
          : null;
      }

      return row;
    });

  const ytdActual = {};
  const ytdBudget = {};
  for (const metric of resolvedMetrics) {
    ytdActual[metric] = 0;
    ytdBudget[metric] = 0;
  }

  for (const m of monthly) {
    for (const metric of resolvedMetrics) {
      const def = METRIC_DEFS[metric];
      ytdActual[metric] += m[def.field];
      ytdBudget[metric] += m[def.budget];
      const fromCsv = m[`_${def.field}YtdFromCsv`];
      m[def.ytdVsBudget] = fromCsv != null
        ? fromCsv
        : Math.round(ytdActual[metric] - ytdBudget[metric]);
      delete m[`_${def.field}YtdFromCsv`];
    }
  }

  return monthly;
}

function listSubSegments(rows, segment) {
  const subs = new Set();
  for (const r of rows) {
    if (r.segment !== segment || !r.subSegment || r.subSegment === DASHBOARD_SUB_SEGMENT) continue;
    if (EXCLUDED_SUB_SEGMENTS.has(r.subSegment)) continue;
    subs.add(r.subSegment);
  }
  return [...subs].sort();
}

const CONSOLIDATED_METRICS = ['Revenue', 'EBITDA', 'Net Income'];
const SEGMENT_DASHBOARD_METRICS = ['Revenue', 'CM', 'EBITDA']; // Adj. EBITDA from Dashboard
const SEGMENT_METRICS = ['Revenue', 'CM', 'EBITDA'];

export function processCSV(csvText) {
  const allRows = parseRows(csvText);
  if (allRows.length === 0) throw new Error('No 2026 data found in the CSV file');

  const primaryRows = pickPrimaryRows(allRows);
  const budgetRows = allRows.filter((r) => r.tag === 'Budget');

  const MONTHLY = aggregateMonthly(
    primaryRows,
    budgetRows,
    { mode: 'consolidated' },
    { ebitdaMetric: 'Adj. EBITDA', metrics: CONSOLIDATED_METRICS },
  );

  const SEGMENT_MONTHLY = {};
  for (const seg of SEGMENTS) {
    SEGMENT_MONTHLY[seg] = aggregateMonthly(
      primaryRows,
      budgetRows,
      { mode: 'segment-dashboard', segment: seg },
      { ebitdaMetric: 'Adj. EBITDA', metrics: SEGMENT_DASHBOARD_METRICS },
    );
  }

  const SEGMENT_PERFORMANCE = SEGMENTS.map((seg) => {
    const monthly = SEGMENT_MONTHLY[seg];
    return {
      Segment: seg,
      AdjEBITDA: monthly.reduce((s, m) => s + m.EBITDA, 0),
    };
  }).sort((a, b) => b.AdjEBITDA - a.AdjEBITDA);

  const SUB_SEGMENTS = {};
  const SUBSEGMENT_MONTHLY = {};
  for (const seg of SEGMENTS) {
    SUB_SEGMENTS[seg] = listSubSegments(primaryRows, seg);
    SUBSEGMENT_MONTHLY[seg] = {
      _all: aggregateMonthly(
        primaryRows,
        budgetRows,
        { mode: 'segment-total', segment: seg },
        { ebitdaMetric: 'EBITDA', metrics: SEGMENT_METRICS },
      ),
    };
    for (const sub of SUB_SEGMENTS[seg]) {
      SUBSEGMENT_MONTHLY[seg][sub] = aggregateMonthly(
        primaryRows,
        budgetRows,
        { mode: 'subsegment', segment: seg, subSegment: sub },
        { ebitdaMetric: 'EBITDA', metrics: SEGMENT_METRICS },
      );
    }
  }

  const KPIS = {
    revenue: MONTHLY.reduce((s, m) => s + m.Revenue, 0),
    adjEbitda: MONTHLY.reduce((s, m) => s + m.EBITDA, 0),
    netIncome: MONTHLY.reduce((s, m) => s + m.NetIncome, 0),
  };

  return {
    MONTHLY,
    SEGMENT_MONTHLY,
    SEGMENT_PERFORMANCE,
    SUB_SEGMENTS,
    SUBSEGMENT_MONTHLY,
    SEGMENTS,
    KPIS,
  };
}
