/**
 * process-data.js
 * Reads cleaned_financial_data.csv and writes src/data.js
 *
 * Rules:
 * - Only rows where Sub-Segment = "Dashboard"
 * - ADJ EBITDA = EBITDA − Total Adjustment (Total), matched per Year + Month + Segment
 *
 * Run: node scripts/process-data.js [path/to/csv]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CSV_PATH = process.argv[2]
  ?? path.join(os.homedir(), 'Downloads', 'cleaned_financial_data.csv');

const OUT_PATH = path.join(__dirname, '../src/data.js');

const DASHBOARD_SUB_SEGMENT = 'Dashboard';

const MONTH_ORDER = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SM_TAGS = new Set([
  'S&M - Others', 'S&M - Online', 'S&M - Payment Channel',
  'S&M - O2O', 'S&M - Offline', 'S&M - Distribution Cost',
  'S&M - PCV', 'Total S&M',
]);

const GA_TAGS = new Set([
  'G&A - Depreciation', 'G&A - IT Cost', 'G&A - Other Staff Cost',
  'G&A - Other staff cost', 'G&A - Facility Management and Travelling',
  'G&A - Consultancy Cost', 'G&A - Consultancy cost',
  'G&A - Corporate Action (Adj. Total)', 'GXA - Staff Cost (N/A)',
  'G&A - Staff Cost', 'Total G&A (Include Depre + Others)',
]);

const TAG_NORM = {
  'G&A - Other staff cost': 'G&A - Other Staff Cost',
  'G&A - Consultancy cost': 'G&A - Consultancy Cost',
};

const TAG_PRIORITY = { Actual: 4, 'Run-rate': 3, Forecast: 2, Budget: 1 };

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
    if (!line) continue;
    const cols = parseCSVLine(line);
    const year = cols[0]?.trim();
    const month = cols[1]?.trim();
    const segment = cols[2]?.trim();
    const subSegment = cols[3]?.trim();
    const subcat = cols[5]?.trim();
    const amtStr = cols[7]?.trim();
    if (!year?.match(/^\d{4}$/) || !month || !subcat || !amtStr) continue;
    const amount = parseFloat(amtStr);
    if (isNaN(amount)) continue;
    rows.push({
      year: parseInt(year, 10),
      month,
      segment,
      subSegment,
      subcat,
      tag: cols[6]?.trim() ?? '',
      amount,
    });
  }

  return rows;
}

function dashboardRowsOnly(rows) {
  return rows.filter((r) => String(r.subSegment || '').trim() === DASHBOARD_SUB_SEGMENT);
}

function pickBestTagRows(rows) {
  const best = new Map();
  for (const r of rows) {
    const subcat = TAG_NORM[r.subcat] ?? r.subcat;
    const key = `${r.year}|${r.month}|${r.segment}|${subcat}`;
    const priority = TAG_PRIORITY[r.tag] ?? 0;
    const existing = best.get(key);
    if (!existing || priority > existing.priority) {
      best.set(key, { row: { ...r, subcat }, priority });
    }
  }
  return [...best.values()].map((e) => e.row);
}

function buildAdjEbitdaBySegMonth(rows) {
  const ebitdaMap = {};
  const adjustmentMap = {};

  for (const r of rows) {
    const key = `${r.year}-${r.month}-${r.segment}`;
    const subcat = TAG_NORM[r.subcat] ?? r.subcat;

    if (subcat === 'EBITDA') {
      ebitdaMap[key] = (ebitdaMap[key] ?? 0) + r.amount;
    } else if (subcat === 'Total Adjustment (Total)') {
      adjustmentMap[key] = (adjustmentMap[key] ?? 0) + r.amount;
    }
  }

  const adjEbitdaBySegMonth = {};
  for (const key of new Set([...Object.keys(ebitdaMap), ...Object.keys(adjustmentMap)])) {
    adjEbitdaBySegMonth[key] = (ebitdaMap[key] ?? 0) - (adjustmentMap[key] ?? 0);
  }

  return adjEbitdaBySegMonth;
}

function sumAdjEbitdaForMonth(adjEbitdaBySegMonth, year, month) {
  const prefix = `${year}-${month}-`;
  let total = 0;
  for (const [key, value] of Object.entries(adjEbitdaBySegMonth)) {
    if (key.startsWith(prefix)) total += value;
  }
  return total;
}

// ── Parse CSV ──────────────────────────────────────────────────────────
const raw = fs.readFileSync(CSV_PATH, 'utf8');
const allRows = parseRows(raw);
const rows = pickBestTagRows(dashboardRowsOnly(allRows));

console.log(`Parsed ${allRows.length} total rows`);
console.log(`Using ${rows.length} rows where Sub-Segment = "${DASHBOARD_SUB_SEGMENT}"`);

if (rows.length === 0) {
  throw new Error(`No rows found with Sub-Segment = "${DASHBOARD_SUB_SEGMENT}"`);
}

const adjEbitdaBySegMonth = buildAdjEbitdaBySegMonth(rows);

// ── Monthly aggregates (all segments combined) ─────────────────────────
const monthlyMap = {};

for (const r of rows) {
  if (!r.month) continue;

  const key = `${r.year}-${r.month}`;
  if (!monthlyMap[key]) {
    monthlyMap[key] = {
      year: r.year,
      month: r.month,
      Revenue: 0,
      COGS: 0,
      GP: 0,
      SM: 0,
      GA: 0,
    };
  }

  const d = monthlyMap[key];
  const subcat = TAG_NORM[r.subcat] ?? r.subcat;

  if (subcat === 'Revenue') d.Revenue += r.amount;
  else if (subcat === 'COGS') d.COGS += r.amount;
  else if (subcat === 'GP') d.GP += r.amount;
  else if (SM_TAGS.has(subcat)) d.SM += r.amount;
  else if (GA_TAGS.has(subcat)) d.GA += r.amount;
}

const MONTH_IDX = Object.fromEntries(MONTH_ORDER.map((m, i) => [m, i]));

const monthly = Object.values(monthlyMap)
  .sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return MONTH_IDX[a.month] - MONTH_IDX[b.month];
  })
  .map((d) => {
    const gp = d.GP !== 0 ? d.GP : d.Revenue + d.COGS;
    const cogs = d.COGS !== 0 ? d.COGS : gp - d.Revenue;
    const mn = MONTH_IDX[d.month] + 1;
    const adjEbitda = sumAdjEbitdaForMonth(adjEbitdaBySegMonth, d.year, d.month);

    return {
      year: d.year,
      month: d.month,
      monthNum: mn,
      quarter: Math.ceil(mn / 3),
      date: `${d.year}-${String(mn).padStart(2, '0')}-01`,
      Revenue: Math.round(d.Revenue),
      COGS: Math.round(cogs),
      GP: Math.round(gp),
      SM: Math.round(d.SM),
      GA: Math.round(d.GA),
      EBITDA: Math.round(adjEbitda),
    };
  });

console.log('\n===== ADJ EBITDA MONTHLY CHECK =====');
monthly.forEach((m) => {
  console.log(`${m.year}-${m.month}`, 'ADJ EBITDA =', m.EBITDA);
});
console.log('====================================\n');

// ── Monthly × Segment aggregates ──────────────────────────────────────
const segMonthMap = {};

for (const r of rows) {
  if (!r.month || !r.segment) continue;
  const key = `${r.year}-${r.month}-${r.segment}`;
  if (!segMonthMap[key]) {
    segMonthMap[key] = {
      year: r.year,
      month: r.month,
      segment: r.segment,
      Revenue: 0,
      COGS: 0,
    };
  }

  const subcat = TAG_NORM[r.subcat] ?? r.subcat;
  if (subcat === 'Revenue') segMonthMap[key].Revenue += r.amount;
  else if (subcat === 'COGS') segMonthMap[key].COGS += r.amount;
}

const segmentMonthly = Object.values(segMonthMap).map((d) => ({
  ...d,
  Revenue: Math.round(d.Revenue),
  COGS: Math.round(d.COGS),
  GP: Math.round(d.Revenue + d.COGS),
}));

// ── OpEx categories × month ───────────────────────────────────────────
const opexMap = {};

for (const r of rows) {
  if (!r.month) continue;
  const norm = TAG_NORM[r.subcat] ?? r.subcat;
  if (!SM_TAGS.has(norm) && !GA_TAGS.has(norm)) continue;
  if (!opexMap[norm]) opexMap[norm] = {};
  const key = `${r.year}-${r.month}`;
  opexMap[norm][key] = (opexMap[norm][key] ?? 0) + r.amount;
}

const opexCategories = Object.entries(opexMap)
  .map(([label, monthData]) => ({
    label,
    total: Math.round(Object.values(monthData).reduce((s, v) => s + v, 0)),
    monthly: Object.fromEntries(
      Object.entries(monthData).map(([k, v]) => [k, Math.round(v)]),
    ),
  }))
  .filter((e) => e.total !== 0)
  .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

// ── Overall segment totals (all periods) ──────────────────────────────
const segTotalsMap = {};

for (const r of rows) {
  if (!r.segment || !r.month) continue;
  const subcat = TAG_NORM[r.subcat] ?? r.subcat;
  if (subcat !== 'Revenue') continue;
  segTotalsMap[r.segment] = (segTotalsMap[r.segment] ?? 0) + r.amount;
}

const segmentTotals = Object.entries(segTotalsMap)
  .map(([Segment, Amount]) => ({ Segment, Amount: Math.round(Amount) }))
  .sort((a, b) => b.Amount - a.Amount);

// ── Overall KPI totals ────────────────────────────────────────────────
const totalRevenue = monthly.reduce((s, m) => s + m.Revenue, 0);
const totalCOGS = monthly.reduce((s, m) => s + m.COGS, 0);
const totalGP = totalRevenue + totalCOGS;
const totalSM = monthly.reduce((s, m) => s + m.SM, 0);
const totalGA = monthly.reduce((s, m) => s + m.GA, 0);
const totalAdjEbitda = monthly.reduce((s, m) => s + m.EBITDA, 0);

const kpis = {
  revenue: totalRevenue,
  cogs: totalCOGS,
  grossMargin: totalGP,
  sm: totalSM,
  ga: totalGA,
  ebitda: totalAdjEbitda,
};

// ── Write output ──────────────────────────────────────────────────────
const output = `// AUTO-GENERATED — do not edit manually
// Source: ${path.basename(CSV_PATH)}
// Filter: Sub-Segment = "${DASHBOARD_SUB_SEGMENT}"
// ADJ EBITDA = EBITDA - Total Adjustment (Total) per Year/Month/Segment
// Run \`node scripts/process-data.js\` to regenerate

export const MONTHLY = ${JSON.stringify(monthly, null, 2)};

export const SEGMENT_MONTHLY = ${JSON.stringify(segmentMonthly, null, 2)};

export const SEGMENT_TOTALS = ${JSON.stringify(segmentTotals, null, 2)};

export const OPEX_CATEGORIES = ${JSON.stringify(opexCategories, null, 2)};

export const KPIS = ${JSON.stringify(kpis, null, 2)};
`;

fs.writeFileSync(OUT_PATH, output, 'utf8');
console.log(`✓ Wrote ${OUT_PATH}`);
console.log(`  Revenue total: Rp ${(kpis.revenue / 1e12).toFixed(3)}T`);
console.log(`  Gross Margin:  Rp ${(kpis.grossMargin / 1e9).toFixed(1)}B`);
console.log(`  ADJ EBITDA:    Rp ${(kpis.ebitda / 1e9).toFixed(1)}B`);
console.log(`  Months: ${monthly.length}`);
console.log(`  Segments: ${segmentTotals.map((s) => s.Segment).join(', ')}`);
console.log(`  OpEx categories: ${opexCategories.length}`);
