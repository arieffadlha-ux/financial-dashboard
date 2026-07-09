// Processes CSV text → dashboard data shape.
// Rules:
// - Consolidated view: Sub-Segment = "Dashboard", sum all segments
// - Segment view: exclude Sub-Segment "Dashboard"; use EBITDA (not Adj. EBITDA)
// - Tag priority (non-Budget): Run-rate > Pre-closing > Actual > Forecast
// - Budget rows used only for variance calculations
// - Only year 2026

export const SEGMENTS = ['Retail', 'Mitra', 'Gaming', 'Investment', 'Corporate'];
export const DASHBOARD_SUB_SEGMENT = 'Dashboard';
export const DATA_YEAR = 2026;

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

function pickBudgetRows(rows) {
  const budget = new Map();
  for (const r of rows) {
    if (r.tag !== 'Budget') continue;
    budget.set(rowKey(r), r);
  }
  return budget;
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
    return r.segment === segment && r.subSegment !== DASHBOARD_SUB_SEGMENT;
  }
  if (mode === 'subsegment') {
    return r.segment === segment && r.subSegment === subSegment;
  }
  return false;
}

function ebitdaSubcat(ebitdaMetric) {
  return ebitdaMetric === 'Adj. EBITDA' ? 'Adj. EBITDA' : 'EBITDA';
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

function aggregateMonthly(primaryRows, budgetRows, scope, ebitdaMetric) {
  const ebitdaKey = ebitdaSubcat(ebitdaMetric);
  const bucket = {};

  for (const r of primaryRows) {
    if (!matchesScope(r, scope)) continue;
    if (!['Revenue', ebitdaKey, 'Net Income'].includes(r.subcat)) continue;

    const mk = `${r.year}-${r.month}`;
    if (!bucket[mk]) {
      bucket[mk] = {
        ...monthMeta(r.year, r.month),
        tag: r.tag,
        Revenue: 0,
        EBITDA: 0,
        NetIncome: 0,
        RevenueDiff: 0,
        EBITDADiff: 0,
        NetIncomeDiff: 0,
        hasRevenueDiff: false,
        hasEBITDADiff: false,
        hasNetIncomeDiff: false,
      };
    }

    const d = bucket[mk];
    if ((PRIMARY_TAG_PRIORITY[r.tag] ?? 0) > (PRIMARY_TAG_PRIORITY[d.tag] ?? 0)) d.tag = r.tag;

    if (r.subcat === 'Revenue') {
      d.Revenue += r.amount;
      if (r.difference != null) { d.RevenueDiff += r.difference; d.hasRevenueDiff = true; }
    } else if (r.subcat === ebitdaKey) {
      d.EBITDA += r.amount;
      if (r.difference != null) { d.EBITDADiff += r.difference; d.hasEBITDADiff = true; }
    } else if (r.subcat === 'Net Income') {
      d.NetIncome += r.amount;
      if (r.difference != null) { d.NetIncomeDiff += r.difference; d.hasNetIncomeDiff = true; }
    }
  }

  const monthly = Object.values(bucket)
    .sort((a, b) => MONTH_IDX[a.month] - MONTH_IDX[b.month])
    .map((d) => {
      const revenueBudget = sumBudget(budgetRows, d.year, d.month, 'Revenue', scope);
      const ebitdaBudget = sumBudget(budgetRows, d.year, d.month, ebitdaKey, scope);
      const netIncomeBudget = sumBudget(budgetRows, d.year, d.month, 'Net Income', scope);

      return {
        year: d.year,
        month: d.month,
        monthNum: d.monthNum,
        quarter: d.quarter,
        date: d.date,
        tag: d.tag,
        Revenue: Math.round(d.Revenue),
        EBITDA: Math.round(d.EBITDA),
        NetIncome: Math.round(d.NetIncome),
        RevenueBudget: Math.round(revenueBudget),
        EBITDABudget: Math.round(ebitdaBudget),
        NetIncomeBudget: Math.round(netIncomeBudget),
        RevenueVsBudget: Math.round(d.Revenue - revenueBudget),
        EBITDAVsBudget: Math.round(d.EBITDA - ebitdaBudget),
        NetIncomeVsBudget: Math.round(d.NetIncome - netIncomeBudget),
        RevenueDiff: d.hasRevenueDiff ? Math.round(d.RevenueDiff) : null,
        EBITDADiff: d.hasEBITDADiff ? Math.round(d.EBITDADiff) : null,
        NetIncomeDiff: d.hasNetIncomeDiff ? Math.round(d.NetIncomeDiff) : null,
      };
    });

  let ytdRevenueActual = 0;
  let ytdEBITDAActual = 0;
  let ytdNetIncomeActual = 0;
  let ytdRevenueBudget = 0;
  let ytdEBITDABudget = 0;
  let ytdNetIncomeBudget = 0;

  for (const m of monthly) {
    ytdRevenueActual += m.Revenue;
    ytdEBITDAActual += m.EBITDA;
    ytdNetIncomeActual += m.NetIncome;
    ytdRevenueBudget += m.RevenueBudget;
    ytdEBITDABudget += m.EBITDABudget;
    ytdNetIncomeBudget += m.NetIncomeBudget;
    m.RevenueYTDVsBudget = Math.round(ytdRevenueActual - ytdRevenueBudget);
    m.EBITDAYTDVsBudget = Math.round(ytdEBITDAActual - ytdEBITDABudget);
    m.NetIncomeYTDVsBudget = Math.round(ytdNetIncomeActual - ytdNetIncomeBudget);
  }

  return monthly;
}

function listSubSegments(rows, segment) {
  const subs = new Set();
  for (const r of rows) {
    if (r.segment === segment && r.subSegment && r.subSegment !== DASHBOARD_SUB_SEGMENT) {
      subs.add(r.subSegment);
    }
  }
  return [...subs].sort();
}

export function processCSV(csvText) {
  const allRows = parseRows(csvText);
  if (allRows.length === 0) throw new Error('Tidak ada data tahun 2026 dalam file CSV');

  const primaryRows = pickPrimaryRows(allRows);
  const budgetRows = allRows.filter((r) => r.tag === 'Budget');

  const MONTHLY = aggregateMonthly(
    primaryRows,
    budgetRows,
    { mode: 'consolidated' },
    'Adj. EBITDA',
  );

  const SEGMENT_MONTHLY = {};
  for (const seg of SEGMENTS) {
    SEGMENT_MONTHLY[seg] = aggregateMonthly(
      primaryRows,
      budgetRows,
      { mode: 'segment-dashboard', segment: seg },
      'Adj. EBITDA',
    );
  }

  const SEGMENT_PERFORMANCE = SEGMENTS.map((seg) => {
    const monthly = SEGMENT_MONTHLY[seg];
    return {
      Segment: seg,
      Revenue: monthly.reduce((s, m) => s + m.Revenue, 0),
      AdjEBITDA: monthly.reduce((s, m) => s + m.EBITDA, 0),
      NetIncome: monthly.reduce((s, m) => s + m.NetIncome, 0),
    };
  }).sort((a, b) => b.Revenue - a.Revenue);

  const SUB_SEGMENTS = {};
  const SUBSEGMENT_MONTHLY = {};
  for (const seg of SEGMENTS) {
    SUB_SEGMENTS[seg] = listSubSegments(primaryRows, seg);
    SUBSEGMENT_MONTHLY[seg] = {
      _all: aggregateMonthly(
        primaryRows,
        budgetRows,
        { mode: 'segment-total', segment: seg },
        'EBITDA',
      ),
    };
    for (const sub of SUB_SEGMENTS[seg]) {
      SUBSEGMENT_MONTHLY[seg][sub] = aggregateMonthly(
        primaryRows,
        budgetRows,
        { mode: 'subsegment', segment: seg, subSegment: sub },
        'EBITDA',
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
