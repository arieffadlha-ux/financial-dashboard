/**
 * process-data.js
 * Reads cleaned_financial_data.csv and writes src/data.js
 * Run: node scripts/process-data.js [path/to/csv]
 * Default CSV path: ~/Downloads/cleaned_financial_data.csv
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const CSV_PATH = process.argv[2]
  ?? path.join(os.homedir(), 'Downloads', 'cleaned_financial_data.csv');

const OUT_PATH = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../src/data.js'
);

const MONTH_ORDER = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const SM_TAGS  = new Set(['S&M - Others','S&M - Online','S&M - Payment Channel',
  'S&M - O2O','S&M - Offline','S&M - Distribution Cost','S&M - PCV']);
const GA_TAGS  = new Set(['G&A - Depreciation','G&A - IT Cost','G&A - Other Staff Cost',
  'G&A - Other staff cost','G&A - Facility Management and Travelling',
  'G&A - Consultancy Cost','G&A - Consultancy cost',
  'G&A - Corporate Action (Adj. Total)','G&A - Staff Cost','Other income/(expenses)']);

// ── Parse CSV ──────────────────────────────────────────────────────────
const raw = fs.readFileSync(CSV_PATH, 'utf8');
const lines = raw.split('\n');
const headers = lines[0].split(',');
const rows = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const cols = line.split(',');
  const year     = cols[0]?.trim();
  const month    = cols[1]?.trim();
  const segment  = cols[2]?.trim();
  const subcat   = cols[5]?.trim();  // "Subcategory" = financial line type
  const amtStr   = cols[7]?.trim();
  if (!year || !year.match(/^\d{4}$/) || !month || !subcat || !amtStr) continue;
  const amount = parseFloat(amtStr);
  if (isNaN(amount)) continue;
  rows.push({ year: parseInt(year), month, segment, subcat, amount });
}

console.log(`Parsed ${rows.length} valid rows`);

// ── Aggregation helpers ────────────────────────────────────────────────
function sumBy(predicate, field = 'amount') {
  return rows.filter(predicate).reduce((s, r) => s + r[field], 0);
}

// ── Monthly aggregates (all segments combined) ─────────────────────────
const monthlyMap = {};
for (const r of rows) {
  if (!r.month) continue;
  const key = `${r.year}-${r.month}`;
  if (!monthlyMap[key]) monthlyMap[key] = { year: r.year, month: r.month, Revenue: 0, COGS: 0, SM: 0, GA: 0 };
  const d = monthlyMap[key];
  if (r.subcat === 'Revenue')       d.Revenue += r.amount;
  else if (r.subcat === 'COGS')     d.COGS    += r.amount;
  else if (SM_TAGS.has(r.subcat))   d.SM      += r.amount;
  else if (GA_TAGS.has(r.subcat))   d.GA      += r.amount;
}

const MONTH_IDX = Object.fromEntries(MONTH_ORDER.map((m, i) => [m, i]));
const monthly = Object.values(monthlyMap).sort((a, b) => {
  if (a.year !== b.year) return a.year - b.year;
  return MONTH_IDX[a.month] - MONTH_IDX[b.month];
}).map(d => {
  const GP     = d.Revenue + d.COGS;
  const EBITDA = GP + d.SM + d.GA;
  const mn     = MONTH_IDX[d.month] + 1;
  return {
    year:      d.year,
    month:     d.month,
    monthNum:  mn,
    quarter:   Math.ceil(mn / 3),
    date:      `${d.year}-${String(mn).padStart(2,'0')}-01`,
    Revenue:   Math.round(d.Revenue),
    COGS:      Math.round(d.COGS),
    GP:        Math.round(GP),
    SM:        Math.round(d.SM),
    GA:        Math.round(d.GA),
    EBITDA:    Math.round(EBITDA),
  };
});

// ── Monthly × Segment aggregates ──────────────────────────────────────
const segMonthMap = {};
for (const r of rows) {
  if (!r.month || !r.segment) continue;
  const key = `${r.year}-${r.month}-${r.segment}`;
  if (!segMonthMap[key]) segMonthMap[key] = { year: r.year, month: r.month, segment: r.segment, Revenue: 0, COGS: 0 };
  const d = segMonthMap[key];
  if (r.subcat === 'Revenue') d.Revenue += r.amount;
  else if (r.subcat === 'COGS') d.COGS  += r.amount;
}

const segmentMonthly = Object.values(segMonthMap).map(d => ({
  ...d,
  Revenue: Math.round(d.Revenue),
  COGS:    Math.round(d.COGS),
  GP:      Math.round(d.Revenue + d.COGS),
}));

// ── OpEx categories × month ────────────────────────────────────────────
// Normalise tag casing variations
const TAG_NORM = {
  'G&A - Other staff cost':  'G&A - Other Staff Cost',
  'G&A - Consultancy cost':  'G&A - Consultancy Cost',
};
const opexMap = {};  // label → { year-month → amount }
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
      Object.entries(monthData).map(([k, v]) => [k, Math.round(v)])
    ),
  }))
  .filter(e => e.total !== 0)
  .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

// ── Overall segment totals (all periods) ──────────────────────────────
const segTotalsMap = {};
for (const r of rows) {
  if (!r.segment || !r.month) continue;
  if (r.subcat !== 'Revenue') continue;
  segTotalsMap[r.segment] = (segTotalsMap[r.segment] ?? 0) + r.amount;
}
const segmentTotals = Object.entries(segTotalsMap)
  .map(([Segment, Amount]) => ({ Segment, Amount: Math.round(Amount) }))
  .sort((a, b) => b.Amount - a.Amount);

// ── Overall KPI totals ────────────────────────────────────────────────
const totalRevenue = monthly.reduce((s, m) => s + m.Revenue, 0);
const totalCOGS    = monthly.reduce((s, m) => s + m.COGS, 0);
const totalGP      = totalRevenue + totalCOGS;
const totalSM      = monthly.reduce((s, m) => s + m.SM, 0);
const totalGA      = monthly.reduce((s, m) => s + m.GA, 0);
const totalEBITDA  = totalGP + totalSM + totalGA;

const kpis = {
  revenue:     totalRevenue,
  cogs:        totalCOGS,
  grossMargin: totalGP,
  sm:          totalSM,
  ga:          totalGA,
  ebitda:      totalEBITDA,
};

// ── Write output ──────────────────────────────────────────────────────
const output = `// AUTO-GENERATED — do not edit manually
// Source: ${path.basename(CSV_PATH)}
// Run \`node scripts/process-data.js\` to regenerate

export const MONTHLY = ${JSON.stringify(monthly, null, 2)};

export const SEGMENT_MONTHLY = ${JSON.stringify(segmentMonthly, null, 2)};

export const SEGMENT_TOTALS = ${JSON.stringify(segmentTotals, null, 2)};

export const OPEX_CATEGORIES = ${JSON.stringify(opexCategories, null, 2)};

export const KPIS = ${JSON.stringify(kpis, null, 2)};
`;

fs.writeFileSync(OUT_PATH, output, 'utf8');
console.log(`✓ Wrote ${OUT_PATH}`);
console.log(`  Revenue total:      Rp ${(kpis.revenue/1e12).toFixed(3)}T`);
console.log(`  Gross Margin:       Rp ${(kpis.grossMargin/1e9).toFixed(1)}B`);
console.log(`  EBITDA total:       Rp ${(kpis.ebitda/1e9).toFixed(1)}B`);
console.log(`  Months:             ${monthly.length}`);
console.log(`  Segments:           ${segmentTotals.map(s=>s.Segment).join(', ')}`);
console.log(`  OpEx categories:   ${opexCategories.length}`);
