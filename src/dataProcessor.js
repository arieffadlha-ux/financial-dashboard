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
      differenceLabel: diffStr,
      differenceYtdBudget: parseNumber(diffYtdStr),
      ord: rows.length,
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

/** Keep all primary-tagged rows in CSV order (allows duplicate G&A Direct/Total blocks). */
function rowsForPnL(allRows) {
  const bestTag = new Map();
  for (const r of allRows) {
    if (r.tag === 'Budget') continue;
    const key = rowKey(r);
    const priority = PRIMARY_TAG_PRIORITY[r.tag] ?? 0;
    const existing = bestTag.get(key);
    if (!existing || priority > existing.priority) {
      bestTag.set(key, { tag: r.tag, priority });
    }
  }
  return allRows
    .filter((r) => r.tag !== 'Budget' && bestTag.get(rowKey(r))?.tag === r.tag)
    .sort((a, b) => a.ord - b.ord);
}

const GA_DETAIL_SUBCATS = [
  'G&A - Staff Cost',
  'G&A - Other staff cost',
  'G&A - Facility Management and Travelling',
  'G&A - Consultancy cost',
  'G&A - Corporate Action (Adj. Total)',
  'G&A - IT Cost',
  'G&A - Depreciation',
  'Other income/(expenses)',
];

const SM_DETAIL_SUBCATS = [
  'S&M - O2O',
  'S&M - Offline',
  'S&M - Online',
  'S&M - Others',
  'S&M - Payment Channel',
  'S&M - PCV',
  'S&M - Distribution Cost',
];

export const PNL_MAIN_LINES_BEFORE = [
  'Revenue',
  'COGS',
  'GP',
  'Total S&M',
  'CM',
  'Total G&A (Include Depre + Others) (Direct)',
  'EBITDA (Direct)',
  'EBIT (Direct)',
  'Total Adjustment (Direct)',
  'Adj. EBITDA (Direct)',
  'Adj. EBIT (Direct)',
  'Total G&A (Include Depre + Others) (Total)',
  'Total Adjustment (Total)',
  'Adj. EBITDA (Total)',
  'Adj. EBIT (Total)',
  'Finance Income / Expenses, Etc',
  'Net Income',
];

/** Segment-page P&L when Direct is selected */
export const PNL_LINES_DIRECT = [
  'Revenue',
  'GP',
  'Total S&M',
  'CM',
  'Total G&A (Include Depre + Others) (Direct)',
  'EBITDA (Direct)',
  'EBIT (Direct)',
  'Total Adjustment (Direct)',
  'Adj. EBITDA (Direct)',
  'Adj. EBIT (Direct)',
];

/** Segment-page P&L when Total is selected */
export const PNL_LINES_TOTAL = [
  'Revenue',
  'GP',
  'Total S&M',
  'CM',
  'Total G&A (Include Depre + Others) (Total)',
  'Total Adjustment (Total)',
  'Adj. EBITDA (Total)',
  'Adj. EBIT (Total)',
  'Finance Income / Expenses, Etc',
  'Net Income',
];

export const PNL_MAIN_LINES_AFTER = [
  'Revenue',
  'COGS',
  'GP',
  'Total S&M',
  'CM',
  'Total G&A (Include Depre + Others)',
  'EBITDA',
  'EBIT',
  'Total Adjustment (Total)',
  'Adj. EBITDA',
  'Adj. EBIT',
  'Finance Income / Expenses, Etc',
  'Net Income',
];

export const PNL_SUBSEGMENT_LINES = [
  'Revenue',
  'GP',
  'Total S&M',
  'CM',
  'Total G&A (Include Depre + Others)',
  'EBITDA',
  'EBIT',
];

export const PNL_CHILDREN = {
  'Total S&M': SM_DETAIL_SUBCATS,
  'Total G&A (Include Depre + Others) (Direct)': GA_DETAIL_SUBCATS,
  'Total G&A (Include Depre + Others) (Total)': GA_DETAIL_SUBCATS,
  'Total G&A (Include Depre + Others)': GA_DETAIL_SUBCATS,
};

function isGaDetail(subcat) {
  return GA_DETAIL_SUBCATS.includes(subcat);
}

function resolveGaModeFromLabel(label) {
  const s = String(label || '').toLowerCase();
  if (s.includes('g&a direct') || s === 'direct') return 'Direct';
  if (s.includes('g&a shared') || s.includes('shared') || s === 'total') return 'Total';
  return null;
}

/**
 * Map raw Dashboard rows → canonical P&L line ids, splitting the two G&A blocks
 * into Direct vs Total (via Difference label when present, else CSV block order).
 */
function mapDashboardRowToLineId(r, gaModeRef) {
  const sub = r.subcat;
  const fromDiff = resolveGaModeFromLabel(r.differenceLabel);

  if (isGaDetail(sub)) {
    if (fromDiff) gaModeRef.mode = fromDiff;
    return { lineId: `${sub}::${gaModeRef.mode}`, parentGa: gaModeRef.mode };
  }

  if (sub === 'Total G&A (Include Depre + Others)') {
    const mode = fromDiff || gaModeRef.mode;
    const lineId = `Total G&A (Include Depre + Others) (${mode})`;
    // After emitting Direct total, next G&A block is Total/Shared
    if (mode === 'Direct') gaModeRef.mode = 'Total';
    return { lineId, parentGa: mode };
  }

  // Explicit Direct/Total metric subcats stay as-is (do NOT reset G&A block mode —
  // the Shared/Total G&A detail block follows Adj. EBIT (Direct) in the CSV).
  if (/\(Direct\)|\(Total\)$/.test(sub)) {
    return { lineId: sub, parentGa: null };
  }

  // After Elim plain names
  return { lineId: sub, parentGa: null };
}

function emptyMonthBucket(year, month) {
  return { ...monthMeta(year, month), amount: 0, tag: '' };
}

function finalizePnLLine(id, label, bucketMap, childDefs) {
  const months = Object.values(bucketMap || {})
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
  const line = {
    id,
    subcat: label,
    label,
    months,
    total: months.reduce((s, m) => s + m.amount, 0),
  };
  if (childDefs) line.childIds = childDefs;
  return line;
}

function aggregatePnLTree(pnlRows, scope, category, mainLines) {
  const isSub = scope.mode === 'subsegment';
  const requireCategory = !isSub && (category === 'Before Elim' || category === 'After Elim');
  const lineBuckets = new Map();
  const gaModeRef = { mode: 'Direct' };
  let groupKey = '';

  const ensure = (lineId) => {
    if (!lineBuckets.has(lineId)) lineBuckets.set(lineId, {});
    return lineBuckets.get(lineId);
  };

  const addAmount = (lineId, r) => {
    if (!lineId) return;
    const buckets = ensure(lineId);
    const mk = `${r.year}-${r.month}`;
    if (!buckets[mk]) buckets[mk] = emptyMonthBucket(r.year, r.month);
    const d = buckets[mk];
    d.amount += r.amount;
    if ((PRIMARY_TAG_PRIORITY[r.tag] ?? 0) > (PRIMARY_TAG_PRIORITY[d.tag] ?? 0)) d.tag = r.tag;
  };

  for (const r of pnlRows) {
    if (!matchesScope(r, { ...scope, category, requireCategory })) continue;

    if (isSub) {
      addAmount(r.subcat, r);
      // Also mirror into Direct slots used by Point A layout when present as columns
      if (r.subcat === 'Total G&A (Include Depre + Others)') {
        addAmount('Total G&A (Include Depre + Others) (Direct)', r);
      } else if (r.subcat === 'EBITDA') {
        addAmount('EBITDA (Direct)', r);
      } else if (r.subcat === 'EBIT') {
        addAmount('EBIT (Direct)', r);
      }
      continue;
    }

    const gk = `${r.year}|${r.month}|${r.segment}|${r.subSegment}|${r.category}`;
    if (gk !== groupKey) {
      groupKey = gk;
      gaModeRef.mode = 'Direct';
    }

    if (category === 'After Elim') {
      if (isGaDetail(r.subcat)) {
        addAmount(`${r.subcat}::After`, r);
        continue;
      }
      if (r.subcat === 'Total G&A (Include Depre + Others)') {
        addAmount('Total G&A (Include Depre + Others)', r);
        continue;
      }
      addAmount(r.subcat, r);
      continue;
    }

    const { lineId } = mapDashboardRowToLineId(r, gaModeRef);
    addAmount(lineId, r);
  }

  const lines = [];
  for (const mainId of mainLines) {
    const childrenSpec = PNL_CHILDREN[mainId];
    let children;
    if (childrenSpec) {
      const mode = mainId.includes('(Direct)')
        ? 'Direct'
        : mainId.includes('(Total)')
          ? 'Total'
          : (category === 'After Elim' || mainId === 'Total G&A (Include Depre + Others)' ? 'After' : null);
      children = childrenSpec.map((childName) => {
        const childId = mode && mode !== 'After'
          ? `${childName}::${mode}`
          : (mode === 'After' ? `${childName}::After` : childName);
        const altId = childName;
        const buckets = lineBuckets.get(childId) || lineBuckets.get(altId) || {};
        return finalizePnLLine(childId, childName, buckets, null);
      });
    }
    const buckets = lineBuckets.get(mainId) || {};
    const line = finalizePnLLine(mainId, mainId, buckets, childrenSpec || null);
    if (children) line.children = children;
    lines.push(line);
  }
  return lines;
}

/**
 * Total G&A (Total) = G&A Direct + G&A Shared.
 * After block parsing, "(Total)" holds the Shared block only — convert to Direct+Shared.
 */
function applyGaTotalAsDirectPlusShared(lines) {
  if (!Array.isArray(lines)) return lines;
  const directId = 'Total G&A (Include Depre + Others) (Direct)';
  const totalId = 'Total G&A (Include Depre + Others) (Total)';
  const direct = lines.find((l) => (l.id || l.subcat) === directId);
  const total = lines.find((l) => (l.id || l.subcat) === totalId);
  if (!direct || !total) return lines;

  const monthKey = (m) => `${m.year}-${m.month}`;
  const directMap = new Map((direct.months || []).map((m) => [monthKey(m), m]));
  const sharedMap = new Map((total.months || []).map((m) => [monthKey(m), m]));
  const keys = new Set([...directMap.keys(), ...sharedMap.keys()]);

  total.months = [...keys].map((k) => {
    const d = directMap.get(k);
    const s = sharedMap.get(k);
    const base = d || s;
    return {
      year: base.year,
      month: base.month,
      monthNum: base.monthNum,
      quarter: base.quarter,
      date: base.date,
      tag: d?.tag || s?.tag || '',
      amount: Math.round((d?.amount ?? 0) + (s?.amount ?? 0)),
    };
  }).sort((a, b) => MONTH_IDX[a.month] - MONTH_IDX[b.month]);
  total.total = total.months.reduce((s, m) => s + m.amount, 0);

  const directChildren = new Map((direct.children || []).map((c) => [c.label || c.subcat, c]));
  if (total.children?.length) {
    total.children = total.children.map((ch) => {
      const label = ch.label || ch.subcat;
      const dCh = directChildren.get(label);
      const dMap = new Map((dCh?.months || []).map((m) => [monthKey(m), m]));
      const sMap = new Map((ch.months || []).map((m) => [monthKey(m), m]));
      const cKeys = new Set([...dMap.keys(), ...sMap.keys()]);
      const months = [...cKeys].map((k) => {
        const d = dMap.get(k);
        const s = sMap.get(k);
        const base = d || s;
        return {
          year: base.year,
          month: base.month,
          monthNum: base.monthNum,
          quarter: base.quarter,
          date: base.date,
          tag: d?.tag || s?.tag || '',
          amount: Math.round((d?.amount ?? 0) + (s?.amount ?? 0)),
        };
      }).sort((a, b) => MONTH_IDX[a.month] - MONTH_IDX[b.month]);
      return {
        ...ch,
        months,
        total: months.reduce((s, m) => s + m.amount, 0),
      };
    });
  }
  return lines;
}

function buildPnLBundle(pnlRows, primaryRows, category) {
  const mainLines = category === 'After Elim' ? PNL_MAIN_LINES_AFTER : PNL_MAIN_LINES_BEFORE;

  const consolidated = applyGaTotalAsDirectPlusShared(aggregatePnLTree(
    pnlRows,
    { mode: 'consolidated' },
    category,
    mainLines,
  ));

  const bySegment = {};
  for (const seg of SEGMENTS) {
    bySegment[seg] = applyGaTotalAsDirectPlusShared(aggregatePnLTree(
      pnlRows,
      { mode: 'segment-dashboard', segment: seg },
      category,
      mainLines,
    ));
  }

  const bySubSegment = {};
  for (const seg of SEGMENTS) {
    bySubSegment[seg] = {};
    const subs = listSubSegments(primaryRows, seg);
    for (const sub of subs) {
      bySubSegment[seg][sub] = {
        full: applyGaTotalAsDirectPlusShared(aggregatePnLTree(
          pnlRows,
          { mode: 'subsegment', segment: seg, subSegment: sub },
          category,
          mainLines,
        )),
        simple: aggregatePnLTree(
          pnlRows,
          { mode: 'subsegment', segment: seg, subSegment: sub },
          category,
          PNL_SUBSEGMENT_LINES,
        ),
      };
    }
  }

  return {
    lines: consolidated,
    bySegment,
    bySubSegment,
    mainLines,
    directLines: PNL_LINES_DIRECT,
    totalLines: PNL_LINES_TOTAL,
  };
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
  const pnlSourceRows = rowsForPnL(allRows);
  const budgetRows = allRows.filter((r) => r.tag === 'Budget');

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
    'Before Elim': buildPnLBundle(pnlSourceRows, primaryRows, 'Before Elim'),
    'After Elim': buildPnLBundle(pnlSourceRows, primaryRows, 'After Elim'),
  };

  // Flat compatibility shape used by older UI snippets (segment dashboard totals)
  const PNL_FLAT = {
    consolidated: {
      'Before Elim': PNL['Before Elim'].lines,
      'After Elim': PNL['After Elim'].lines,
    },
  };
  for (const seg of SEGMENTS) {
    PNL_FLAT[seg] = {
      'Before Elim': PNL['Before Elim'].bySegment[seg],
      'After Elim': PNL['After Elim'].bySegment[seg],
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
    PNL_ORDER: {
      'Before Elim': PNL_MAIN_LINES_BEFORE,
      'After Elim': PNL_MAIN_LINES_AFTER,
    },
    PNL,
    PNL_FLAT,
    KPIS,
  };
}
