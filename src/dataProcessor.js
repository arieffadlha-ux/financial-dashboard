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
  }

  if (GA_TAGS.has(norm)) {
    if (!gaOpexMap[norm]) gaOpexMap[norm] = {};
    gaOpexMap[norm][key] = (gaOpexMap[norm][key] ?? 0) + r.amount;
  }
}

const smCategories = Object.entries(smOpexMap)
  .map(([label, monthData]) => ({
    label,
    total: Math.round(
      Object.values(monthData).reduce((s, v) => s + v, 0)
    ),
    monthly: Object.fromEntries(
      Object.entries(monthData).map(([k, v]) => [k, Math.round(v)])
    ),
  }))
  .filter(e => e.total !== 0)
  .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

const gaCategories = Object.entries(gaOpexMap)
  .map(([label, monthData]) => ({
    label,
    total: Math.round(
      Object.values(monthData).reduce((s, v) => s + v, 0)
    ),
    monthly: Object.fromEntries(
      Object.entries(monthData).map(([k, v]) => [k, Math.round(v)])
    ),
  }))
  .filter(e => e.total !== 0)
  .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

const SM_OPEX = {
  total: smCategories.reduce((s, c) => s + c.total, 0),
  categories: smCategories,
};

const GA_OPEX = {
  total: gaCategories.reduce((s, c) => s + c.total, 0),
  categories: gaCategories,
};

/* ── Segment totals ──────────────────────────────────────────── */
const segTotMap = {};

for (const r of rows) {
  if (!r.segment || !r.month || !(r.month in MONTH_IDX)) continue;

  const norm = TAG_NORM[r.subcat] ?? r.subcat;

  if (norm !== 'Revenue') continue;

  segTotMap[r.segment] =
    (segTotMap[r.segment] ?? 0) + r.amount;
}

const SEGMENT_TOTALS = Object.entries(segTotMap)
  .map(([Segment, Amount]) => ({
    Segment,
    Amount: Math.round(Amount),
  }))
  .sort((a, b) => b.Amount - a.Amount);

/* ── Overall KPIs ────────────────────────────────────────────── */
const totalRevenue = MONTHLY.reduce((s, m) => s + m.Revenue, 0);
const totalCOGS = MONTHLY.reduce((s, m) => s + m.COGS, 0);
const totalGP = totalRevenue + totalCOGS;
const totalSM = MONTHLY.reduce((s, m) => s + m.SM, 0);
const totalGA = MONTHLY.reduce((s, m) => s + m.GA, 0);
const totalEBITDA = MONTHLY.reduce((s, m) => s + m.EBITDA, 0);

const KPIS = {
  revenue: totalRevenue,
  cogs: totalCOGS,
  grossMargin: totalGP,
  sm: totalSM,
  ga: totalGA,
  ebitda: totalEBITDA,
};

return {
  MONTHLY,
  SEGMENT_MONTHLY,
  SEGMENT_TOTALS,
  SM_OPEX,
  GA_OPEX,
  KPIS,
};
