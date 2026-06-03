/* ── Monthly aggregates (all segments combined) ───────────────────────── */
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
      SM: 0,
      GA: 0,
      EBITDA: 0,
    };
  }

  const d = monthlyMap[key];
  const subcat = String(r.subcat || '').trim();

  if (subcat === 'Revenue') {
    d.Revenue += r.amount;
  } else if (subcat === 'COGS') {
    d.COGS += r.amount;
  } else if (SM_TAGS.has(subcat)) {
    d.SM += r.amount;
  } else if (GA_TAGS.has(subcat)) {
    d.GA += r.amount;
  }

  // EXACT EBITDA ONLY
  if (subcat === 'EBITDA') {
    d.EBITDA += r.amount;

    console.log(
      '[EBITDA ROW]',
      r.year,
      r.month,
      r.segment,
      r.amount
    );
  }
}

const MONTH_IDX = Object.fromEntries(
  MONTH_ORDER.map((m, i) => [m, i])
);

const monthly = Object.values(monthlyMap)
  .sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return MONTH_IDX[a.month] - MONTH_IDX[b.month];
  })
  .map(d => {
    const GP = d.Revenue + d.COGS;
    const mn = MONTH_IDX[d.month] + 1;

    return {
      year: d.year,
      month: d.month,
      monthNum: mn,
      quarter: Math.ceil(mn / 3),
      date: `${d.year}-${String(mn).padStart(2, '0')}-01`,
      Revenue: Math.round(d.Revenue),
      COGS: Math.round(d.COGS),
      GP: Math.round(GP),
      SM: Math.round(d.SM),
      GA: Math.round(d.GA),

      // TAKE EXACT EBITDA FROM CSV
      EBITDA: Math.round(d.EBITDA),
    };
  });

console.log('\n===== EBITDA MONTHLY CHECK =====');

monthly.forEach(m => {
  console.log(
    `${m.year}-${m.month}`,
    'EBITDA =',
    m.EBITDA
  );
});

console.log('================================\n');
