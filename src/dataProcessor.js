// Processes CSV text → dashboard data shape.
// Rules:
// - Consolidated view: Sub-Segment = "Dashboard", sum all segments
// - Segment view: exclude Sub-Segment "Dashboard" + excluded sub-segments; use EBITDA (not Adj. EBITDA)
// - Tag priority (non-Budget): Run-rate > Pre-closing > Actual > Forecast
// - Budget rows used only for variance calculations
// - Only year 2026

export const SEGMENTS = ['Retail', 'Mitra', 'Gaming', 'Investment', 'Corporate'];
export const DASHBOARD_SUB_SEGMENT = 'Dashboard';
export const DATA_YEAR = 2026;
export const EXCLUDED_SUB_SEGMENTS = new Set([
  'Elimination',
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

    if (!year?.match(/^\d{4}$/) || parseInt(year, 10) !== DATA_YEAR) continue;
    if (!month || !subcat || !amtStr) continue;

    const amount = parseFloat(amtStr);
    if (isNaN(amount)) continue;

    const difference = diffStr !== '' && !isNaN(parseFloat(diffStr)) ? parseFloat(diffStr) : null;

    rows.push({
      year: parseInt(year, 10),
      month,
      segment,
      subSegment,
      subcat,
      tag,
      amount,
      difference,
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

function sumBudget(budgetRows, year, month, subcat, scope) {
  let total = 0;
  for (const r of budgetRows) {
    if (r.year !== year || r.month !== month || r.subcat !== subcat) continue;
    if (!matchesScope(r, scope)) continue;
    total += r.amount;
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
  }
  return bucket;
}

function aggregateMonthly(primaryRows, budgetRows, scope, { ebitdaMetric = 'Adj. EBITDA', metrics = ['Revenue', 'EBITDA', 'Net Income'] } = {}) {
  const bucket = {};
  const resolvedMetrics = metrics.map((m) => (m === 'EBITDA' ? 'EBITDA' : m));
  const subcats = resolvedMetrics.map((m) => resolveSubcat(m, ebitdaMetric));

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
        const budget = sumBudget(budgetRows, d.year, d.month, subcat, scope);
        const actual = d[def.field];

        row[def.field] = Math.round(actual);
        row[def.budget] = Math.round(budget);
        row[def.vsBudget] = Math.round(actual - budget);
        row[def.diff] = d[def.hasDiff] ? Math.round(d[def.diff]) : null;
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
      m[def.ytdVsBudget] = Math.round(ytdActual[metric] - ytdBudget[metric]);
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
