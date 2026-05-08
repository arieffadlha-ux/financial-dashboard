// Processes CSV text → same shape as src/data.js (MONTHLY, SEGMENT_MONTHLY, etc.)
// Runs entirely in the browser — no backend needed.

const MONTH_ORDER = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const MONTH_IDX = Object.fromEntries(MONTH_ORDER.map((m, i) => [m, i]));

const SM_TAGS = new Set([
  'S&M - Others','S&M - Online','S&M - Payment Channel',
  'S&M - O2O','S&M - Offline','S&M - Distribution Cost',
  'S&M - PCV','Total S&M',
]);
const GA_TAGS = new Set([
  'G&A - Depreciation','G&A - IT Cost',
  'G&A - Other Staff Cost','G&A - Other staff cost',
  'G&A - Facility Management and Travelling',
  'G&A - Consultancy Cost','G&A - Consultancy cost',
  'G&A - Corporate Action (Adj. Total)','GXA - Staff Cost (N/A)',
]);
const TAG_NORM = {
  'G&A - Other staff cost':  'G&A - Other Staff Cost',
  'G&A - Consultancy cost':  'G&A - Consultancy Cost',
};

/* Simple CSV parser — handles double-quoted fields with commas inside */
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

export function processCSV(csvText) {
  const lines = csvText.replace(/\r/g, '').split('\n');
  if (lines.length < 2) throw new Error('File kosong atau tidak valid');

  // Validate headers
  const headers = parseCSVLine(lines[0]);
  const required = ['Year','Month','Segment','Subcategory','Amount'];
  // Subcategory is col index 5, Amount is col index 7
  // Flexible: just check we have at least 8 columns
  if (headers.length < 8) {
    throw new Error(`Format tidak sesuai. Butuh 8 kolom: ${required.join(', ')} dll. Ditemukan: ${headers.length} kolom.`);
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    const year    = cols[0]?.trim();
    const month   = cols[1]?.trim();
    const segment = cols[2]?.trim();
    const subcat  = cols[5]?.trim();
    const amtStr  = cols[7]?.trim();
    if (!year?.match(/^\d{4}$/) || !month || !subcat || !amtStr) continue;
    const amount = parseFloat(amtStr);
    if (isNaN(amount)) continue;
    rows.push({ year: parseInt(year), month, segment, subcat, amount });
  }

  if (rows.length === 0) throw new Error('Tidak ada baris data valid ditemukan');

  /* ── Monthly aggregates ───────────────────────────────────────── */
  const monthlyMap = {};
  for (const r of rows) {
    if (!r.month || !(r.month in MONTH_IDX)) continue;
    const key = `${r.year}-${r.month}`;
    if (!monthlyMap[key]) monthlyMap[key] = { year: r.year, month: r.month, Revenue: 0, COGS: 0, SM: 0, GA: 0 };
    const d = monthlyMap[key];
    const norm = TAG_NORM[r.subcat] ?? r.subcat;
    if (norm === 'Revenue')       d.Revenue += r.amount;
    else if (norm === 'COGS')     d.COGS    += r.amount;
    else if (SM_TAGS.has(norm))   d.SM      += r.amount;
    else if (GA_TAGS.has(norm))   d.GA      += r.amount;
  }

  const MONTHLY = Object.values(monthlyMap)
    .sort((a, b) => a.year !== b.year ? a.year - b.year : MONTH_IDX[a.month] - MONTH_IDX[b.month])
    .map(d => {
      const GP     = d.Revenue + d.COGS;
      const EBITDA = GP + d.SM + d.GA;
      const mn     = MONTH_IDX[d.month] + 1;
      return {
        year: d.year, month: d.month, monthNum: mn,
        quarter: Math.ceil(mn / 3),
        date: `${d.year}-${String(mn).padStart(2, '0')}-01`,
        Revenue: Math.round(d.Revenue), COGS: Math.round(d.COGS),
        GP: Math.round(GP), SM: Math.round(d.SM), GA: Math.round(d.GA),
        EBITDA: Math.round(EBITDA),
      };
    });

  /* ── Segment × month ─────────────────────────────────────────── */
  const segMonthMap = {};
  for (const r of rows) {
    if (!r.month || !(r.month in MONTH_IDX) || !r.segment) continue;
    const key = `${r.year}-${r.month}-${r.segment}`;
    if (!segMonthMap[key]) segMonthMap[key] = { year: r.year, month: r.month, segment: r.segment, Revenue: 0, COGS: 0 };
    const norm = TAG_NORM[r.subcat] ?? r.subcat;
    if (norm === 'Revenue')   segMonthMap[key].Revenue += r.amount;
    else if (norm === 'COGS') segMonthMap[key].COGS    += r.amount;
  }
  const SEGMENT_MONTHLY = Object.values(segMonthMap).map(d => ({
    ...d,
    Revenue: Math.round(d.Revenue),
    COGS:    Math.round(d.COGS),
    GP:      Math.round(d.Revenue + d.COGS),
  }));

  /* ── OpEx categories × month ─────────────────────────────────── */
  const opexMap = {};
  for (const r of rows) {
    if (!r.month || !(r.month in MONTH_IDX)) continue;
    const norm = TAG_NORM[r.subcat] ?? r.subcat;
    if (!SM_TAGS.has(norm) && !GA_TAGS.has(norm)) continue;
    if (!opexMap[norm]) opexMap[norm] = {};
    const key = `${r.year}-${r.month}`;
    opexMap[norm][key] = (opexMap[norm][key] ?? 0) + r.amount;
  }
  const OPEX_CATEGORIES = Object.entries(opexMap)
    .map(([label, monthly]) => ({
      label,
      total: Math.round(Object.values(monthly).reduce((s, v) => s + v, 0)),
      monthly: Object.fromEntries(Object.entries(monthly).map(([k, v]) => [k, Math.round(v)])),
    }))
    .filter(e => e.total !== 0)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  /* ── Segment totals ──────────────────────────────────────────── */
  const segTotMap = {};
  for (const r of rows) {
    if (!r.segment || !r.month || !(r.month in MONTH_IDX)) continue;
    const norm = TAG_NORM[r.subcat] ?? r.subcat;
    if (norm !== 'Revenue') continue;
    segTotMap[r.segment] = (segTotMap[r.segment] ?? 0) + r.amount;
  }
  const SEGMENT_TOTALS = Object.entries(segTotMap)
    .map(([Segment, Amount]) => ({ Segment, Amount: Math.round(Amount) }))
    .sort((a, b) => b.Amount - a.Amount);

  /* ── Overall KPIs ────────────────────────────────────────────── */
  const KPIS = {
    revenue:     MONTHLY.reduce((s, m) => s + m.Revenue, 0),
    cogs:        MONTHLY.reduce((s, m) => s + m.COGS,    0),
    grossMargin: MONTHLY.reduce((s, m) => s + m.GP,      0),
    sm:          MONTHLY.reduce((s, m) => s + m.SM,      0),
    ga:          MONTHLY.reduce((s, m) => s + m.GA,      0),
    ebitda:      MONTHLY.reduce((s, m) => s + m.EBITDA,  0),
  };

  return { MONTHLY, SEGMENT_MONTHLY, OPEX_CATEGORIES, SEGMENT_TOTALS, KPIS };
}
