/**
 * process-data.js
 * Reads CSV and writes src/data.js using dataProcessor logic.
 * Run: node scripts/process-data.js [path/to/csv]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processCSV } from '../src/dataProcessor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CSV_PATH = process.argv[2]
  ?? path.join(__dirname, '../public/cleaned_data.csv');

const OUT_PATH = path.join(__dirname, '../src/data.js');

const raw = fs.readFileSync(CSV_PATH, 'utf8');
const data = processCSV(raw);

const output = `// AUTO-GENERATED — do not edit manually
// Source: ${path.basename(CSV_PATH)}
// Year: 2026 only · Tag: Run-rate > Pre-closing > Actual > Forecast
// Run \`node scripts/process-data.js\` to regenerate

export const MONTHLY = ${JSON.stringify(data.MONTHLY, null, 2)};

export const MONTHLY_VARIANTS = ${JSON.stringify(data.MONTHLY_VARIANTS, null, 2)};

export const SEGMENT_MONTHLY = ${JSON.stringify(data.SEGMENT_MONTHLY, null, 2)};

export const SEGMENT_VARIANTS = ${JSON.stringify(data.SEGMENT_VARIANTS, null, 2)};

export const SEGMENT_PERFORMANCE = ${JSON.stringify(data.SEGMENT_PERFORMANCE, null, 2)};

export const SUB_SEGMENTS = ${JSON.stringify(data.SUB_SEGMENTS, null, 2)};

export const SUBSEGMENT_MONTHLY = ${JSON.stringify(data.SUBSEGMENT_MONTHLY, null, 2)};

export const PNL_ORDER = ${JSON.stringify(data.PNL_ORDER, null, 2)};

export const PNL = ${JSON.stringify(data.PNL, null, 2)};

export const PNL_FLAT = ${JSON.stringify(data.PNL_FLAT, null, 2)};

export const SEGMENTS = ${JSON.stringify(data.SEGMENTS, null, 2)};

export const KPIS = ${JSON.stringify(data.KPIS, null, 2)};
`;

fs.writeFileSync(OUT_PATH, output, 'utf8');
console.log(`✓ Wrote ${OUT_PATH}`);
console.log(`  Revenue:   Rp ${(data.KPIS.revenue / 1e12).toFixed(3)}T`);
console.log(`  Adj EBITDA: Rp ${(data.KPIS.adjEbitda / 1e9).toFixed(1)}B`);
console.log(`  Net Income: Rp ${(data.KPIS.netIncome / 1e9).toFixed(1)}B`);
console.log(`  Months: ${data.MONTHLY['Before Elim']?.length ?? 0}`);
