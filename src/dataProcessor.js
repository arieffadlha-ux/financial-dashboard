// Processes CSV text → dashboard data shape.
// Rules:
// - Consolidated / segment "all": Sub-Segment = "Dashboard"
// - Category filter: Before Elim / After Elim (Dashboard rows)
// - Adj. EBITDA / Adj. EBIT Before Elim use Direct/Total subcategories
// - Tag priority (non-Budget): Run-rate > Pre-closing > Actual > Forecast
// - Budget rows used only for variance calculations
// - Only year 2026

export const SEGMENTS = ['Retail', 'Mitra', 'Gaming', 'Investment', 'Corporate'];
export const DASHBOARD_SUB_SEGMENT = 'Dashboard';
export const DATA_YEAR = 2026;
export const CATEGORIES = ['Before Elim', 'After Elim'];
export const EXCLUDED_SUB_SEGMENTS = new Set([
  'Elimination',
  'Adjustment',
  'Adjustment Elimination',
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
  EBIT: { field: 'EBIT', budget: 'EBITBudget', diff: 'EBITDiff', vsBudget: 'EBITVsBudget', ytdVsBudget: 'EBITYTDVsBudget', hasDiff: 'hasEBITDiff' },
  'Net Income': { field: 'NetIncome', budget: 'NetIncomeBudget', diff: 'NetIncomeDiff', vsBudget: 'NetIncomeVsBudget', ytdVsBudget: 'NetIncomeYTDVsBudget', hasDiff: 'hasNetIncomeDiff' },
};

export function resolveDashboardSubcat(metric, {
  category = 'Before Elim',
  ebitdaVariant = 'Adj. EBITDA (Direct)',
  ebitVariant = 'Adj. EBIT (Direct)',
} = {}) {
  if (metric === 'Revenue') return 'Revenue';
  if (metric === 'CM') return 'CM';
  if (metric === 'Net Income') return 'Net Income';
  if (metric === 'EBITDA') {
    if (category === 'After Elim') return 'Adj. EBITDA';
    return ebitdaVariant; // Adj. EBITDA (Direct|Total) — plain Adj. EBITDA has no Before Elim rows
  }
  if (metric === 'EBIT') {
    if (category === 'After Elim') return 'Adj. EBIT';
    return ebitVariant;
  }
  return metric;
}

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
    const category = cols[4]?.trim() ?? '';
    const subcat = cols[5]?.trim();
    const tag = cols[6]?.trim() ?? '';
    const amtStr = cols[7]?.trim();
    const diffStr = cols[9]?.trim() ?? '';
    const diffYtdStr = cols[10]?.trim() ?? '';

    const yearNum = year == null ? NaN : parseInt(String(year).replace(/\.0+$/, ''), 10);
    if (!Number.isFinite(yearNum) || yearNum !== DATA_YEAR) continue;
    if (!month || !subcat || !amtStr) continue;

    const amount = parseNumber(amtStr);
    if (amount == null) continue;

    rows.push({
      year: yearNum,
      month,
      segment,
      subSegment,
      category,
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
  return `${r.year}|${r.month}|${r.segment}|${r.subSegment}|${r.category}|${r.subcat}`;
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
    subSegments = null,
    category = null,
    requireCategory = false,
  } = scope;

  if (requireCategory && category && r.category !== category) return false;

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
  if (mode === 'subsegments') {
    return r.segment === segment
      && Array.isArray(subSegments)
      && subSegments.includes(r.subSegment)
      && r.subSegment !== DASHBOARD_SUB_SEGMENT
      && !EXCLUDED_SUB_SEGMENTS.has(r.subSegment);
  }
  return false;
}

function emptyBucket(year, month, metrics) {
  const bucket = { ...monthMeta(year, month), tag: '' };
  for (const metric of metrics) {
    const d = METRIC_DEFS[metric];
    if (!d) continue;
    bucket[d.field] = 0;
    bucket[d.diff] = 0;
    bucket[d.hasDiff] = false;
    bucket[`${d.field}YtdDiff`] = 0;
    bucket[`${d.field}HasYtdDiff`] = false;
  }
  return bucket;
}

/**
 * Aggregate monthly metrics.
 * metricSubcats: { Revenue: 'Revenue', EBITDA: 'Adj. EBITDA (Direct)', ... }
 * When requireCategory is true, rows must match scope.category.
 */
function aggregateMonthly(primaryRows, budgetRows, scope, {
  metrics = ['Revenue', 'EBITDA', 'Net Income'],
  metricSubcats = null,
} = {}) {
  const resolvedMetrics = metrics.map((m) => (m === 'EBITDA' || m === 'EBIT' ? m : m));
  const subcatOf = (metric) => {
    if (metricSubcats?.[metric]) return metricSubcats[metric];
    if (metric === 'EBITDA') return 'Adj. EBITDA';
    if (metric === 'EBIT') return 'Adj. EBIT';
    return metric;
  };
  const subcats = resolvedMetrics.map(subcatOf);
  const subcatToMetric = new Map();
  resolvedMetrics.forEach((m, i) => subcatToMetric.set(subcats[i], m));

  const bucket = {};

  for (const r of primaryRows) {
    if (!matchesScope(r, scope)) continue;
    const metric = subcatToMetric.get(r.subcat);
    if (!metric) continue;

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
        const subcat = subcatOf(metric);
        const budget = sumBudget(budgetRows, d.year, d.month, subcat, scope);
        const actual = d[def.field];

        row[def.field] = Math.round(actual);
        row[def.budget] = Math.round(budget);
        row[def.vsBudget] = Math.round(actual - budget);
        row[def.diff] = d[def.hasDiff] ? Math.round(d[def.diff]) : null;
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

/** Budget CSV has no Before/After Elim — map Adj.* (Direct|Total) to plain budget subcats. */
function budgetSubcatCandidates(subcat) {
  if (!subcat) return [];
  if (subcat.startsWith('Adj. EBITDA')) {
    return [subcat, 'Adj. EBITDA', 'EBITDA'];
  }
  if (subcat.startsWith('Adj. EBIT')) {
    return [subcat, 'Adj. EBIT', 'EBIT'];
  }
  return [subcat];
}

function sumBudget(budgetRows, year, month, subcat, scope) {
  // Budget applies to both Before Elim and After Elim (no category remarks in source).
  const budgetScope = { ...scope, requireCategory: false, category: null };
  for (const candidate of budgetSubcatCandidates(subcat)) {
    let total = 0;
    let found = false;
    for (const r of budgetRows) {
      if (r.year !== year || r.month !== month || r.subcat !== candidate) continue;
      if (!matchesScope(r, budgetScope)) continue;
      total += r.amount;
      found = true;
    }
    if (found) return total;
  }
  return 0;
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

function pnlOrder(rows, category) {
  const order = [];
  const seen = new Set();
  for (const r of rows) {
    if (r.subSegment !== DASHBOARD_SUB_SEGMENT) continue;
    if (r.category !== category) continue;
    if (!r.subcat || seen.has(r.subcat)) continue;
    seen.add(r.subcat);
    order.push(r.subcat);
  }
  return order;
}

function aggregatePnL(primaryRows, scope, category, order) {
  // Returns [{ subcat, months: [{monthNum, amount, tag}], total }]
  const bySub = new Map();
  for (const subcat of order) {
    bySub.set(subcat, {});
  }

  for (const r of primaryRows) {
    if (!matchesScope(r, { ...scope, category, requireCategory: true })) continue;
    if (!bySub.has(r.subcat)) continue;
    const mk = `${r.year}-${r.month}`;
    const bucket = bySub.get(r.subcat);
    if (!bucket[mk]) {
      bucket[mk] = { ...monthMeta(r.year, r.month), amount: 0, tag: '' };
    }
    const d = bucket[mk];
    d.amount += r.amount;
    if ((PRIMARY_TAG_PRIORITY[r.tag] ?? 0) > (PRIMARY_TAG_PRIORITY[d.tag] ?? 0)) d.tag = r.tag;
  }

  return order.map((subcat) => {
    const months = Object.values(bySub.get(subcat) || {})
      .sort((a, b) => MONTH_IDX[a.month] - MONTH_IDX[b.month])
      .map((d) => ({
        year: d.year,
        month: d.month,
        monthNum: d.monthNum,
        quarter: d.quarter,
        date: d.date,
        tag: d.tag,
        amount: Math.round(d.amount),
      }));
    return {
      subcat,
      months,
      total: months.reduce((s, m) => s + m.amount, 0),
    };
  });
}

function dashboardMetricSubcats(category, ebitdaVariant, ebitVariant, metrics) {
  const map = {};
  for (const m of metrics) {
    map[m] = resolveDashboardSubcat(m, { category, ebitdaVariant, ebitVariant });
  }
  return map;
}

const FULL_METRICS = ['Revenue', 'CM', 'EBITDA', 'EBIT', 'Net Income'];
// Sub-segment rows use plain EBITDA/EBIT (not Adj. * Direct/Total).
const SUBSEGMENT_METRICS = ['Revenue', 'CM', 'EBITDA', 'EBIT', 'Net Income'];
const SUBSEGMENT_SUBCATS = {
  Revenue: 'Revenue',
  CM: 'CM',
  EBITDA: 'EBITDA',
  EBIT: 'EBIT',
  'Net Income': 'Net Income',
};

export function processCSV(csvText) {
  const allRows = parseRows(csvText);
  if (allRows.length === 0) throw new Error('No 2026 data found in the CSV file');

  const primaryRows = pickPrimaryRows(allRows);
  const budgetRows = allRows.filter((r) => r.tag === 'Budget');

  const PNL_ORDER = {
    'Before Elim': pnlOrder(allRows, 'Before Elim'),
    'After Elim': pnlOrder(allRows, 'After Elim'),
  };

  const buildDashboardMonthly = (scope, category, ebitdaVariant = 'Adj. EBITDA (Total)') =>
    aggregateMonthly(primaryRows, budgetRows, { ...scope, category, requireCategory: true }, {
      metrics: FULL_METRICS,
      metricSubcats: dashboardMetricSubcats(category, ebitdaVariant, 'Adj. EBIT (Total)', FULL_METRICS),
    });

  // Consolidated: default Before Elim Adj. EBITDA uses Total (no Direct/Total UI on consolidated)
  const MONTHLY = {
    'Before Elim': buildDashboardMonthly({ mode: 'consolidated' }, 'Before Elim', 'Adj. EBITDA (Total)'),
    'After Elim': buildDashboardMonthly({ mode: 'consolidated' }, 'After Elim'),
  };

  const MONTHLY_VARIANTS = {
    'Before Elim': {
      'Adj. EBITDA (Direct)': buildDashboardMonthly({ mode: 'consolidated' }, 'Before Elim', 'Adj. EBITDA (Direct)'),
      'Adj. EBITDA (Total)': buildDashboardMonthly({ mode: 'consolidated' }, 'Before Elim', 'Adj. EBITDA (Total)'),
    },
  };

  const SEGMENT_MONTHLY = {};
  const SEGMENT_VARIANTS = {};
  for (const seg of SEGMENTS) {
    const scope = { mode: 'segment-dashboard', segment: seg };
    SEGMENT_MONTHLY[seg] = {
      'Before Elim': buildDashboardMonthly(scope, 'Before Elim', 'Adj. EBITDA (Direct)'),
      'After Elim': buildDashboardMonthly(scope, 'After Elim'),
    };
    SEGMENT_VARIANTS[seg] = {
      'Before Elim': {
        'Adj. EBITDA (Direct)': buildDashboardMonthly(scope, 'Before Elim', 'Adj. EBITDA (Direct)'),
        'Adj. EBITDA (Total)': buildDashboardMonthly(scope, 'Before Elim', 'Adj. EBITDA (Total)'),
        'Adj. EBIT (Direct)': aggregateMonthly(primaryRows, budgetRows, { ...scope, category: 'Before Elim', requireCategory: true }, {
          metrics: FULL_METRICS,
          metricSubcats: dashboardMetricSubcats('Before Elim', 'Adj. EBITDA (Direct)', 'Adj. EBIT (Direct)', FULL_METRICS),
        }),
        'Adj. EBIT (Total)': aggregateMonthly(primaryRows, budgetRows, { ...scope, category: 'Before Elim', requireCategory: true }, {
          metrics: FULL_METRICS,
          metricSubcats: dashboardMetricSubcats('Before Elim', 'Adj. EBITDA (Total)', 'Adj. EBIT (Total)', FULL_METRICS),
        }),
      },
    };
  }

  const SEGMENT_PERFORMANCE = SEGMENTS.map((seg) => {
    const monthly = SEGMENT_MONTHLY[seg]['Before Elim'];
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
        { metrics: SUBSEGMENT_METRICS, metricSubcats: SUBSEGMENT_SUBCATS },
      ),
    };
    for (const sub of SUB_SEGMENTS[seg]) {
      SUBSEGMENT_MONTHLY[seg][sub] = aggregateMonthly(
        primaryRows,
        budgetRows,
        { mode: 'subsegment', segment: seg, subSegment: sub },
        { metrics: SUBSEGMENT_METRICS, metricSubcats: SUBSEGMENT_SUBCATS },
      );
    }
  }

  const PNL = {
    consolidated: {
      'Before Elim': aggregatePnL(primaryRows, { mode: 'consolidated' }, 'Before Elim', PNL_ORDER['Before Elim']),
      'After Elim': aggregatePnL(primaryRows, { mode: 'consolidated' }, 'After Elim', PNL_ORDER['After Elim']),
    },
  };
  for (const seg of SEGMENTS) {
    PNL[seg] = {
      'Before Elim': aggregatePnL(primaryRows, { mode: 'segment-dashboard', segment: seg }, 'Before Elim', PNL_ORDER['Before Elim']),
      'After Elim': aggregatePnL(primaryRows, { mode: 'segment-dashboard', segment: seg }, 'After Elim', PNL_ORDER['After Elim']),
    };
  }

  const KPIS = {
    revenue: MONTHLY['Before Elim'].reduce((s, m) => s + m.Revenue, 0),
    adjEbitda: MONTHLY['Before Elim'].reduce((s, m) => s + m.EBITDA, 0),
    netIncome: MONTHLY['Before Elim'].reduce((s, m) => s + m.NetIncome, 0),
  };

  return {
    MONTHLY,
    MONTHLY_VARIANTS,
    SEGMENT_MONTHLY,
    SEGMENT_VARIANTS,
    SEGMENT_PERFORMANCE,
    SUB_SEGMENTS,
    SUBSEGMENT_MONTHLY,
    SEGMENTS,
    PNL_ORDER,
    PNL,
    KPIS,
  };
}
