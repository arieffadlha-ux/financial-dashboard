// Processes CSV text → same shape as src/data.js (MONTHLY, SEGMENT_MONTHLY, etc.)
// Runs entirely in the browser — no backend needed.
const MONTH_ORDER = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const MONTH_IDX = Object.fromEntries(MONTH_ORDER.map((m, i) => [m, i]));

// ── Strict Whitelist Sets matching process-data.js ──
const SM_TAGS = new Set([
  'S&M - O2O',
  'S&M - Offline',
  'S&M - Online',
  'S&M - Others',
  'S&M - Payment Channel',
  'S&M - PCV',
  'S&M - Distribution Cost'
]);

const GA_TAGS = new Set([
  'G&A - Staff Cost',
  'G&A - Other staff cost',
  'G&A - Other Staff Cost', 
  'G&A - Facility Management and Travelling',
  'G&A - Consultancy cost',
  'G&A - Consultancy Cost', 
  'G&A - Corporate Action (Adj. Total)',
  'G&A - IT Cost',
  'G&A - Depreciation',
  'Other income/(expenses)'
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
  if (lines.length < 2) throw new Error('File is empty or invalid');

  // Validate headers
  const headers = parseCSVLine(lines[0]);
  if (headers.length < 8) {
    throw new Error(`Invalid format. Expected at least 8 columns. Found: ${headers.length} columns.`);
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

  if (rows.length === 0) throw new Error('No valid data rows found');

  /* ── Monthly aggregates ───────────────────────────────────────── */
  const monthlyMap = {};
  for (const r of rows) {
    if (!r.month || !(r.month in MONTH_IDX)) continue;
    const key = `${r.year}-${r.month}`;
    
    if (!monthlyMap[key]) {
      monthlyMap[key] = { year: r.year, month: r.month, Revenue: 0, COGS: 0, SM: 0, GA: 0, EBITDA: 0 };
    }
    const d = monthlyMap[key];
    const norm = TAG_NORM[r.subcat] ?? r.subcat;
    
    if (norm === 'Revenue')       d.Revenue += r.amount;
    else if (norm === 'COGS')     d.COGS    += r.amount;
    else if (SM_TAGS.has(norm))   d.SM      += r.amount;
    else if (GA_TAGS.has(norm))   d.GA      += r.amount;
    
    // Explicit EBITDA parsing logic from your script requirements
    if (norm.includes('EBITDA'))  d.EBITDA  += r.amount;
  }

  const MONTHLY = Object.values(monthlyMap)
    .sort((a, b) => a.year !== b.year ? a.year - b.year : MONTH_IDX[a.month] - MONTH_IDX[b.month])
    .map(d => {
      const GP = d.Revenue + d.COGS;
      const mn = MONTH_IDX[d.month] + 1;
      
      // Safety Fallback: If your CSV doesn't explicitly contain an "EBITDA" row, 
      // it calculates it mathematically so your charts don't render flat lines.
      const ebitdaValue = d.EBITDA !== 0 ? d.EBITDA : (GP + d.SM + d.GA);

      return {
        year: d.year, month: d.month, monthNum: mn,
        quarter: Math.ceil(mn / 3),
        date: `${d.year}-${String(mn).padStart(2, '0')}-01`,
        Revenue: Math.round(d.Revenue), 
        COGS: Math.round(d.COGS),
        GP: Math.round(GP), 
        SM: Math.round(d.SM), 
        GA: Math.round(d.GA),
        EBITDA: Math.round(ebitdaValue),
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

  /* ── Separated OpEx Breakdown Processing ──────────────────────── */
  const smOpexMap = {};
  const gaOpexMap = {};

  for (const r of rows) {
    if (!r.month || !(r.month in MONTH_IDX)) continue;
    const norm = TAG_NORM[r.subcat] ?? r.subcat;
    const key = `${r.year}-${r.month}`;

    if (SM_TAGS.has(norm)) {
      if (!smOpexMap[norm]) smOpexMap[norm] = {};
      smOpexMap[norm][key] = (smOpexMap[norm][key] ?? 0) + r.amount;
    } else if (GA_TAGS.has(norm)) {
      if (!gaOpexMap[norm]) gaOpexMap[norm] = {};
      gaOpexMap[norm][key] = (gaOpexMap[norm][key] ?? 0) + r.amount;
    }
  }

  const smCategories = Object.entries(smOpexMap)
    .map(([label, monthData]) => ({
      label,
      total: Math.round(Object.values(monthData).reduce
