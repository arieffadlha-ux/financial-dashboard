import { useState, useMemo, createContext, useContext, useLayoutEffect, useCallback, useRef, useEffect, Fragment } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine, Legend,
} from 'recharts';
import * as DEFAULT_DATA from './data.js';
import { processCSV, SEGMENTS as ALL_SEGMENTS, PNL_LINES_DIRECT, PNL_LINES_TOTAL } from './dataProcessor.js';

/* ─── Theme ─────────────────────────────────────────────────────────── */
const ThemeCtx = createContext({ theme: 'dark', toggle: () => {} });
const useTheme = () => useContext(ThemeCtx);

function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('fd-theme') ?? 'dark');
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('fd-theme', theme);
  }, [theme]);
  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

const CHART = {
  dark:  { grid: '#1e2d45', axis: '#1e2d45', tick: '#475569', cursor: '#1e2d45', refLine: '#334155' },
  light: { grid: '#c8d8ea', axis: '#c8d8ea', tick: '#6b90b0', cursor: '#e4ecf6', refLine: '#a0bcd6' },
};

const INDEX_KEY  = 'fd-index';
const ACTIVE_KEY = 'fd-active-id';
const dsKey      = (id) => `fd-dataset-${id}`;

const DataCtx = createContext(null);
const useDataCtx = () => useContext(DataCtx);

function monthCountFromData(result) {
  const m = result?.MONTHLY;
  if (Array.isArray(m)) return m.length;
  if (m?.['Before Elim']) return m['Before Elim'].length;
  if (m?.['After Elim']) return m['After Elim'].length;
  return 0;
}

function DataProvider({ children }) {
  const [index, setIndex] = useState(() => {
    try { return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]'); }
    catch { return []; }
  });
  const [activeId, setActiveId] = useState(() => localStorage.getItem(ACTIVE_KEY) ?? 'default');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const activeData = useMemo(() => {
    if (activeId === 'default') return { ...DEFAULT_DATA };
    try {
      const raw = localStorage.getItem(dsKey(activeId));
      if (raw) return JSON.parse(raw);
    } catch {}
    return { ...DEFAULT_DATA };
  }, [activeId]);

  const uploadCSV = useCallback((file) => {
    setUploading(true);
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = processCSV(e.target.result);
        const id = String(Date.now());
        const entry = {
          id,
          filename: file.name,
          uploadedAt: new Date().toISOString(),
          months: monthCountFromData(result),
          revenue: result.KPIS.revenue,
        };
        localStorage.setItem(dsKey(id), JSON.stringify(result));
        const newIndex = [...index, entry];
        localStorage.setItem(INDEX_KEY, JSON.stringify(newIndex));
        localStorage.setItem(ACTIVE_KEY, id);
        setIndex(newIndex);
        setActiveId(id);
      } catch (err) {
        setUploadError(err.message);
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => { setUploadError('Failed to read file'); setUploading(false); };
    reader.readAsText(file);
  }, [index]);

  const switchDataset = useCallback((id) => {
    localStorage.setItem(ACTIVE_KEY, id);
    setActiveId(id);
  }, []);

  const removeDataset = useCallback((id) => {
    localStorage.removeItem(dsKey(id));
    const newIndex = index.filter(d => d.id !== id);
    localStorage.setItem(INDEX_KEY, JSON.stringify(newIndex));
    setIndex(newIndex);
    if (activeId === id) {
      const nextId = newIndex.length > 0 ? newIndex[newIndex.length - 1].id : 'default';
      localStorage.setItem(ACTIVE_KEY, nextId);
      setActiveId(nextId);
    }
  }, [index, activeId]);

  const dismissError = useCallback(() => setUploadError(null), []);
  const activeMeta = index.find(d => d.id === activeId) ?? null;
  const isCustom = activeId !== 'default';

  return (
    <DataCtx.Provider value={{
      activeData, activeId, activeMeta, index, isCustom,
      uploading, uploadError,
      uploadCSV, switchDataset, removeDataset, dismissError,
    }}>
      {children}
    </DataCtx.Provider>
  );
}

/* ─── Formatters ────────────────────────────────────────────────────── */
/** Module-level mode so existing idr() call sites pick up the dropdown without prop drilling */
let _amountMode = 'compact';
function setGlobalAmountMode(mode) {
  _amountMode = mode === 'full' ? 'full' : 'compact';
}

const idrCompactCore = (v, opts = {}) => {
  if (v == null) return '—';
  const { axis = false } = opts;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const pfx = axis ? '' : 'Rp ';
  if (abs >= 1e12) return `${sign}${pfx}${(abs / 1e12).toFixed(3)}T`;
  if (abs >= 1e9)  return `${sign}${pfx}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${sign}${pfx}${(abs / 1e6).toFixed(1)}M`;
  return `${sign}${pfx}${abs.toLocaleString('en-US')}`;
};

const idrFullCore = (v, opts = {}) => {
  if (v == null) return '—';
  const { axis = false } = opts;
  const sign = v < 0 ? '-' : '';
  const pfx = axis ? '' : 'Rp ';
  return `${sign}${pfx}${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
};

const idrByMode = (v, mode, opts = {}) =>
  (mode === 'full' ? idrFullCore : idrCompactCore)(v, opts);

const idr = (v, opts = {}) => idrByMode(v, _amountMode, opts);

const idrCompact = (v) => idrByMode(v, _amountMode);

const diffFmt = (v) => {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${idr(v)}`;
};

const monthLabel = (m) =>
  new Date(`${m.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

const relativeDate = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const MONTHS_EN = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const PERF_COLORS = { Revenue: '#3b82f6', CM: '#06b6d4', EBITDA: '#10b981', EBIT: '#f59e0b', NetIncome: '#a855f7' };

const SEGMENT_COLORS = {
  Retail: 'rgb(58, 60, 169)',
  Mitra: 'rgb(198, 16, 67)',
  Gaming: 'rgb(57, 172, 219)',
  Investment: 'rgb(247, 149, 78)',
  Corporate: 'rgb(249, 0, 74)',
};

const SUB_SEGMENT_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#a855f7',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
  '#14b8a6', '#eab308',
];

const PAGES = [
  { id: 'consolidated', label: 'Consolidated' },
  ...ALL_SEGMENTS.map(s => ({ id: s, label: s })),
];

/** Sub-segments hidden from every box/dropdown on their segment's page (data still rolls up into totals). */
const HIDDEN_SUB_SEGMENTS = {
  Retail: ['Fulfillment Business', 'Marketplace'],
};

function visibleSubSegments(page, subs) {
  const hidden = HIDDEN_SUB_SEGMENTS[page];
  if (!hidden || !subs?.length) return subs ?? [];
  return subs.filter(s => !hidden.includes(s));
}

const EBITDA_VARIANT_OPTS = [
  { id: 'Adj. EBITDA (Direct)', label: 'Direct' },
  { id: 'Adj. EBITDA (Total)', label: 'Total' },
];
const EBIT_VARIANT_OPTS = [
  { id: 'Adj. EBIT (Direct)', label: 'Direct' },
  { id: 'Adj. EBIT (Total)', label: 'Total' },
];

const METRIC_INFO = {
  Revenue: {
    title: 'Revenue',
    body: 'The total income generated from business activities before deducting any costs or expenses.',
  },
  CM: {
    title: 'Contribution Margin',
    body: 'Contribution Margin represents the profit remaining after Gross Profit (Revenue − COGS) is reduced by Selling & Marketing (S&M) expenses. It indicates the profitability of the business after covering direct operating costs related to sales and marketing.',
    formula: 'Contribution Margin = Gross Profit − Total Selling & Marketing (S&M) Expenses',
  },
  'Adj. EBITDA': {
    title: 'Adj. EBITDA',
    body: 'Adjusted EBITDA measures operating profitability after deducting Selling & Marketing (S&M) and General & Administrative (G&A) expenses from Gross Profit, while excluding interest, taxes, depreciation, amortization, and incorporating approved business adjustments.',
    formula: 'Adjusted EBITDA = Gross Profit − S&M Expenses − G&A Expenses (Exc Depreciation) ± Adjustments',
  },
  'Adj. EBIT': {
    title: 'Adj. EBIT',
    body: 'Adjusted EBIT is similar to Adjusted EBITDA but includes depreciation and amortization, providing a measure of operating profit after these non-cash expenses while still excluding non-operating items and incorporating approved adjustments.',
    formula: 'Adjusted EBIT = Adjusted EBITDA − Depreciation & Amortization',
  },
  EBITDA: {
    title: 'Adj. EBITDA',
    body: 'Adjusted EBITDA measures operating profitability after deducting Selling & Marketing (S&M) and General & Administrative (G&A) expenses from Gross Profit, while excluding interest, taxes, depreciation, amortization, and incorporating approved business adjustments.',
    formula: 'Adjusted EBITDA = Gross Profit − S&M Expenses − G&A Expenses (Exc Depreciation) ± Adjustments',
  },
  EBIT: {
    title: 'Adj. EBIT',
    body: 'Adjusted EBIT is similar to Adjusted EBITDA but includes depreciation and amortization, providing a measure of operating profit after these non-cash expenses while still excluding non-operating items and incorporating approved adjustments.',
    formula: 'Adjusted EBIT = Adjusted EBITDA − Depreciation & Amortization',
  },
  'Net Income': {
    title: 'Net Income',
    body: "Net Income represents the company's final profit after deducting all operating expenses, interest, taxes, depreciation, amortization, and other non-operating items from total revenue. It reflects the overall profitability of the business.",
    formula: 'Net Income = Revenue − Total Expenses (including Operating Expenses, Interest, Taxes, Depreciation & Amortization, and Other Non-Operating Items)',
  },
};

function resolveMetricInfoKey(label) {
  if (!label) return null;
  if (label === 'Revenue' || label.startsWith('Revenue')) return 'Revenue';
  if (label === 'CM' || label.includes('Contribution')) return 'CM';
  if (label.includes('Net Income')) return 'Net Income';
  if (label.includes('EBITDA')) return label.startsWith('Adj') ? 'Adj. EBITDA' : 'EBITDA';
  if (label.includes('EBIT')) return label.startsWith('Adj') ? 'Adj. EBIT' : 'EBIT';
  return null;
}

/* ─── Data helpers ──────────────────────────────────────────────────── */
function asMonthlyArray(monthlyLike, category = 'Before Elim') {
  if (!monthlyLike) return [];
  if (Array.isArray(monthlyLike)) return monthlyLike;
  return monthlyLike[category] ?? monthlyLike['Before Elim'] ?? monthlyLike['After Elim'] ?? [];
}

function filterMonthly(monthly, filter) {
  const months = filter.months; // [] means all
  return monthly.filter(m => {
    if (filter.quarter !== 'all' && m.quarter !== parseInt(filter.quarter.replace('Q', ''), 10)) return false;
    if (months.length > 0 && !months.includes(m.monthNum)) return false;
    return true;
  });
}

function sumField(rows, field) {
  return rows.reduce((s, m) => s + (m[field] ?? 0), 0);
}

function sumNullable(rows, field) {
  let sum = 0;
  let any = false;
  for (const m of rows) {
    const v = m[field];
    if (v != null && Number.isFinite(v)) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

function computePeriodKPIs(filtered, fields) {
  const last = filtered[filtered.length - 1];
  const out = {};
  for (const f of fields) {
    out[f.key] = sumField(filtered, f.actual);
    out[`vsBudget_${f.key}`] = sumField(filtered, f.vsBudget);
    out[`vsYtd_${f.key}`] = last ? (last[f.ytd] ?? null) : null;
    // vs Last Year: Σ(2026 − 2025) for filtered months
    out[`vsYoy_${f.key}`] = sumNullable(filtered, f.yoy);
  }
  return out;
}

/**
 * "vs Previous Month/Period" indicator (4th KPI pill):
 * - Specific month(s) selected → vs Previous Month, using CSV Difference / computed MoM summed over the selection.
 * - Quarter view (Q2/Q3/Q4) with no specific month → vs Previous Period = current quarter total − prior quarter total.
 * - FY view, or Q1 with no specific month → hidden (no prior period in scope).
 */
function computeVsPeriodIndicator(sourceMonthly, filteredMonthly, filter, selectedMonthNums, fields) {
  if (selectedMonthNums.length > 0) {
    const values = {};
    for (const f of fields) values[f.key] = sumNullable(filteredMonthly, f.diff);
    return { label: 'vs Previous Month', values };
  }

  const quarterNum = filter.quarter === 'all' ? null : parseInt(filter.quarter.replace('Q', ''), 10);
  if (quarterNum && quarterNum > 1) {
    const curRows = sourceMonthly.filter(m => m.quarter === quarterNum);
    const prevRows = sourceMonthly.filter(m => m.quarter === quarterNum - 1);
    const values = {};
    for (const f of fields) {
      values[f.key] = prevRows.length ? (sumField(curRows, f.actual) - sumField(prevRows, f.actual)) : null;
    }
    return { label: 'vs Previous Period', values };
  }

  // FY view or Q1 with no specific month selected — nothing meaningful to compare against.
  const values = {};
  for (const f of fields) values[f.key] = null;
  return { label: 'vs Previous Month', values };
}

function filteredSegmentAdjEbitda(segmentMonthly, segments, filteredKeys, category) {
  return segments.map(seg => {
    const rows = asMonthlyArray(segmentMonthly[seg], category)
      .filter(m => filteredKeys.has(`${m.year}-${m.month}`));
    return {
      Segment: seg,
      AdjEBITDA: rows.reduce((s, m) => s + m.EBITDA, 0),
    };
  }).sort((a, b) => b.AdjEBITDA - a.AdjEBITDA);
}

function filteredSubSegmentPerformance(subSegMonthly, subSegments, filteredKeys, { mode = 'default' } = {}) {
  return subSegments.map(sub => {
    const rows = (subSegMonthly[sub] ?? []).filter(m => filteredKeys.has(`${m.year}-${m.month}`));
    if (mode === 'retail') {
      return {
        Segment: sub,
        Revenue: rows.reduce((s, m) => s + m.Revenue, 0),
        CM: rows.reduce((s, m) => s + (m.CM ?? 0), 0),
        EBIT: rows.reduce((s, m) => s + (m.EBIT ?? 0), 0),
      };
    }
    if (mode === 'cmEbitda') {
      return {
        Segment: sub,
        Revenue: rows.reduce((s, m) => s + m.Revenue, 0),
        CM: rows.reduce((s, m) => s + (m.CM ?? 0), 0),
        EBITDA: rows.reduce((s, m) => s + m.EBITDA, 0),
      };
    }
    return {
      Segment: sub,
      Revenue: rows.reduce((s, m) => s + m.Revenue, 0),
      EBITDA: rows.reduce((s, m) => s + m.EBITDA, 0),
      NetIncome: rows.reduce((s, m) => s + (m.NetIncome ?? 0), 0),
    };
  }).filter(s => {
    if (mode === 'retail') return s.Revenue !== 0 || s.CM !== 0 || s.EBIT !== 0;
    if (mode === 'cmEbitda') return s.Revenue !== 0 || s.CM !== 0 || s.EBITDA !== 0;
    return s.Revenue !== 0 || s.EBITDA !== 0 || s.NetIncome !== 0;
  }).sort((a, b) => b.Revenue - a.Revenue);
}

function mergeMonthlySeries(seriesList) {
  if (!seriesList.length) return [];
  if (seriesList.length === 1) return seriesList[0];
  const map = new Map();
  for (const series of seriesList) {
    for (const row of series) {
      const key = `${row.year}-${row.month}`;
      if (!map.has(key)) {
        map.set(key, { ...row });
        continue;
      }
      const acc = map.get(key);
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === 'number' && k !== 'year' && k !== 'monthNum' && k !== 'quarter') {
          acc[k] = (acc[k] ?? 0) + v;
        }
      }
    }
  }
  return [...map.values()].sort((a, b) => a.monthNum - b.monthNum);
}

/* ─── Chart helpers ─────────────────────────────────────────────────── */
function HighlightDot(props) {
  const { cx, cy, payload, fill = '#10b981' } = props;
  if (cx == null || cy == null) return null;
  if (payload?.highlighted) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={11} fill={fill} fillOpacity={0.2} />
        <circle cx={cx} cy={cy} r={6} fill={fill} stroke="#fff" strokeWidth={2.5} />
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={3} fill={fill} strokeWidth={0} />;
}

/* ─── UI Components ─────────────────────────────────────────────────── */
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={toggle} aria-label="Toggle theme"
      className="flex items-center gap-2 px-3.5 py-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl hover:border-[var(--border-hover)] transition-all cursor-pointer">
      <span className="text-xs font-medium text-[var(--text-muted)]">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}

function DataManager() {
  const { activeId, index, uploading, uploadError, uploadCSV, switchDataset, removeDataset, dismissError } = useDataCtx();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const handleFile = (file) => {
    if (!file?.name.toLowerCase().endsWith('.csv')) return;
    uploadCSV(file);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3.5 py-2 border rounded-xl transition-all cursor-pointer
          ${open ? 'bg-blue-600 border-blue-600 text-white' : 'bg-[var(--surface-card)] border-[var(--border-default)] hover:border-[var(--border-hover)]'}`}>
        <span className={`text-xs font-medium ${open ? 'text-white' : 'text-[var(--text-muted)]'}`}>Data Library</span>
        {index.length > 0 && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${open ? 'bg-white/20 text-white' : 'bg-blue-500/20 text-blue-400'}`}>
            {index.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-[360px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-2xl overflow-hidden"
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}>
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--border-default)]">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Data Library</p>
            <button onClick={() => inputRef.current?.click()} disabled={uploading}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-blue-600 text-white cursor-pointer disabled:opacity-50">
              {uploading ? 'Processing...' : 'Upload CSV'}
            </button>
            <input ref={inputRef} type="file" accept=".csv" className="hidden"
              onChange={e => { handleFile(e.target.files[0]); e.target.value = ''; }} />
          </div>
          {uploadError && (
            <div className="px-4 py-3 bg-red-500/10 text-[11px] text-red-400 flex justify-between">
              <span>{uploadError}</span>
              <button onClick={dismissError} className="cursor-pointer">✕</button>
            </div>
          )}
          {dragging && (
            <div className="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-2xl z-10 flex items-center justify-center pointer-events-none">
              <p className="text-sm font-medium text-blue-400">Drop CSV file here</p>
            </div>
          )}
          <div className="max-h-[300px] overflow-y-auto">
            <DatasetRow filename="Default Data" subtitle="cleaned_data.csv" isActive={activeId === 'default'}
              onSelect={() => { switchDataset('default'); setOpen(false); }} />
            {[...index].reverse().map(entry => (
              <DatasetRow key={entry.id} filename={entry.filename} subtitle={relativeDate(entry.uploadedAt)}
                isActive={activeId === entry.id}
                onSelect={() => { switchDataset(entry.id); setOpen(false); }}
                onDelete={() => removeDataset(entry.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DatasetRow({ filename, subtitle, isActive, onSelect, onDelete }) {
  return (
    <div onClick={onSelect}
      className={`flex items-center gap-3 px-4 py-3 border-b border-[var(--border-faint)] cursor-pointer hover:bg-[var(--surface-elevated)] group ${isActive ? 'bg-blue-500/5' : ''}`}>
      <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-blue-500' : 'bg-[var(--border-default)]'}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${isActive ? 'text-blue-400' : 'text-[var(--text-secondary)]'}`}>{filename}</p>
        <p className="text-[10px] text-[var(--text-very-faint)]">{subtitle}</p>
      </div>
      {onDelete && (
        <button onClick={e => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-red-400 cursor-pointer">✕</button>
      )}
    </div>
  );
}

function PageNav({ page, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-5">
      {PAGES.map(p => (
        <button key={p.id} onClick={() => onChange(p.id)}
          className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer
            ${page === p.id
              ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(59,130,246,0.3)]'
              : 'bg-[var(--surface-card)] text-[var(--text-muted)] border border-[var(--border-default)] hover:border-[var(--border-hover)]'}`}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

function MultiSelect({ label, allLabel, options, values, onChange, minWidth = 160 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const allSelected = values.length === 0;
  const display = allSelected
    ? allLabel
    : values.length === 1
      ? (options.find(o => o.value === values[0])?.label ?? `${values.length} selected`)
      : `${values.length} selected`;

  const toggle = (val) => {
    if (values.includes(val)) {
      const next = values.filter(v => v !== val);
      onChange(next);
    } else {
      onChange([...values, val]);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="pl-3 pr-7 py-1.5 bg-[var(--surface-elevated)] text-[var(--text-muted)] text-xs rounded-lg border-0 outline-none focus:ring-1 focus:ring-blue-600 cursor-pointer appearance-none text-left"
        style={{ minWidth }}>
        {display}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 min-w-full w-max max-w-[280px] max-h-[260px] overflow-y-auto bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl shadow-xl py-1">
          <button type="button"
            onClick={() => { onChange([]); setOpen(false); }}
            className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer hover:bg-[var(--surface-elevated)] ${allSelected ? 'text-blue-400 font-medium' : 'text-[var(--text-muted)]'}`}>
            {allLabel}
          </button>
          {options.map(opt => {
            const checked = values.includes(opt.value);
            return (
              <label key={opt.value}
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] cursor-pointer">
                <input type="checkbox" checked={checked} onChange={() => toggle(opt.value)}
                  className="rounded border-[var(--border-default)]" />
                <span className={checked ? 'text-[var(--text-primary)]' : ''}>{opt.label}</span>
              </label>
            );
          })}
        </div>
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}

function FilterBar({
  quarter, months, onChange, onReset, isActive,
  subSegmentsSelected, subSegments, onSubSegmentsChange, showSubSegment,
  category, onCategoryChange, showCategory = true, dataStatus,
  amountFormat, onAmountFormatChange,
}) {
  const Pill = ({ active, onClick, children }) => (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer
        ${active ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(59,130,246,0.3)]'
          : 'bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'}`}>
      {children}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl card-shadow">
      <span className="text-[11px] uppercase tracking-widest text-[var(--text-very-faint)] font-medium">FY 2026</span>
      <div className="h-4 w-px bg-[var(--border-default)]" />
      <div className="flex gap-1.5">
        {['all', 'Q1', 'Q2', 'Q3', 'Q4'].map(q => (
          <Pill key={q} active={quarter === q} onClick={() => onChange({ quarter: q, months: [] })}>
            {q === 'all' ? 'FY' : q}
          </Pill>
        ))}
      </div>
      <div className="h-4 w-px bg-[var(--border-default)]" />
      <MultiSelect
        label="Months"
        allLabel="All Months"
        options={MONTHS_EN.map((m, i) => ({ value: i + 1, label: m }))}
        values={months}
        onChange={(next) => onChange({ quarter, months: next })}
        minWidth={140}
      />
      {showSubSegment && (
        <>
          <div className="h-4 w-px bg-[var(--border-default)]" />
          <MultiSelect
            label="Sub-Segments"
            allLabel="All Sub-Segments"
            options={subSegments.map(s => ({ value: s, label: s }))}
            values={subSegmentsSelected}
            onChange={onSubSegmentsChange}
            minWidth={180}
          />
        </>
      )}
      {showCategory && (
        <>
          <div className="h-4 w-px bg-[var(--border-default)]" />
          <div className="relative">
            <select value={category} onChange={e => onCategoryChange(e.target.value)}
              className="pl-3 pr-7 py-1.5 bg-[var(--surface-elevated)] text-[var(--text-muted)] text-xs rounded-lg border-0 outline-none focus:ring-1 focus:ring-blue-600 cursor-pointer appearance-none">
              <option value="Before Elim">Before Elim</option>
              <option value="After Elim">After Elim</option>
            </select>
          </div>
        </>
      )}
      <div className="h-4 w-px bg-[var(--border-default)]" />
      <div className="relative">
        <select
          value={amountFormat}
          onChange={e => onAmountFormatChange(e.target.value)}
          className="pl-3 pr-7 py-1.5 bg-[var(--surface-elevated)] text-[var(--text-muted)] text-xs rounded-lg border-0 outline-none focus:ring-1 focus:ring-blue-600 cursor-pointer appearance-none"
          title="Display format for amounts"
        >
          <option value="compact">Compact (T/B/M)</option>
          <option value="full">Full Amount</option>
        </select>
      </div>
      {dataStatus && (
        <span className={`text-[10px] font-semibold px-2 py-1 rounded-lg ${
          dataStatus === 'Actual' ? 'bg-emerald-500/15 text-emerald-400'
            : dataStatus === 'Forecast' ? 'bg-amber-500/15 text-amber-400'
              : dataStatus === 'Run-rate' ? 'bg-blue-500/15 text-blue-400'
                : 'bg-[var(--surface-elevated)] text-[var(--text-faint)]'
        }`}>
          {dataStatus}
        </span>
      )}
      {isActive && (
        <button onClick={onReset} className="ml-auto text-xs text-[var(--text-faint)] hover:text-[var(--text-tertiary)] cursor-pointer">
          Reset Filter
        </button>
      )}
    </div>
  );
}

function MetricInfoButton({ infoKey }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const info = METRIC_INFO[infoKey];

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!info) return null;

  return (
    <span className="relative inline-flex" ref={ref}>
      <button
        type="button"
        aria-label={`About ${info.title}`}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className="w-3.5 h-3.5 rounded-full border border-[var(--text-faint)] text-[9px] leading-none
          text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:border-[var(--text-primary)]
          flex items-center justify-center cursor-pointer shrink-0 font-semibold"
      >
        i
      </button>
      {open && (
        <div className="absolute left-0 top-5 z-50 w-72 max-w-[80vw] rounded-xl border border-[var(--border-default)]
          bg-[var(--surface-card)] p-3.5 shadow-xl card-shadow">
          <p className="text-xs font-semibold text-[var(--text-primary)] mb-1.5">{info.title}</p>
          <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">{info.body}</p>
          {info.formula && (
            <p className="text-[11px] leading-relaxed text-[var(--text-secondary)] mt-2 pt-2 border-t border-[var(--border-faint)]">
              <span className="font-semibold text-[var(--text-primary)]">Formula: </span>
              {info.formula}
            </p>
          )}
        </div>
      )}
    </span>
  );
}

function DiffPill({ label, value }) {
  if (value == null) return null;
  const positive = value >= 0;
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded tabular
      ${positive ? 'text-emerald-500 bg-emerald-400/10' : 'text-red-500 bg-red-400/10'}`}>
      {label}: {diffFmt(value)}
    </span>
  );
}

function KPICardWithDiffs({ label, value, vsBudget, vsPeriod, vsPeriodLabel = 'vs Previous Month', vsLastYear, vsYtdBudget, dropdown, infoKey }) {
  const resolvedInfo = infoKey ?? resolveMetricInfoKey(label);
  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-5 card-shadow hover:border-[var(--border-hover)] transition-all">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <p className="text-[11px] uppercase tracking-widest text-[var(--text-faint)] font-medium">{label}</p>
          <MetricInfoButton infoKey={resolvedInfo} />
        </div>
        {dropdown && (
          <select
            value={dropdown.value}
            onChange={e => dropdown.onChange(e.target.value)}
            disabled={dropdown.disabled}
            className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg
              bg-[var(--surface-elevated)] text-[var(--text-primary)]
              border border-[var(--border-default)] outline-none cursor-pointer
              focus:ring-1 focus:ring-blue-600 disabled:cursor-default disabled:opacity-60"
          >
            {dropdown.options.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        )}
      </div>
      <p className="text-[1.6rem] font-semibold leading-none text-[var(--text-primary)] tabular mb-3">{idr(value)}</p>
      <div className="flex flex-wrap gap-1.5">
        <DiffPill label="vs Budget" value={vsBudget} />
        <DiffPill label={vsPeriodLabel} value={vsPeriod} />
        <DiffPill label="vs Last Year" value={vsLastYear} />
        <DiffPill label="vs YTD Budget" value={vsYtdBudget} />
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 shadow-xl">
      <p className="text-[11px] text-[var(--text-faint)] mb-2 uppercase tracking-wider">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-[11px] text-[var(--text-muted)]">{p.name}</span>
          <span className="text-xs font-semibold text-[var(--text-primary)] ml-auto pl-4 tabular">{idr(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function filterPnLMonths(months, filter, selectedMonthNums) {
  return (months || []).filter(m => {
    if (filter.quarter !== 'all' && m.quarter !== parseInt(filter.quarter.replace('Q', ''), 10)) return false;
    if (selectedMonthNums.length > 0 && !selectedMonthNums.includes(m.monthNum)) return false;
    return true;
  });
}

function sumPnLMonths(months, filter, selectedMonthNums) {
  return filterPnLMonths(months, filter, selectedMonthNums).reduce((s, m) => s + m.amount, 0);
}

function PnLAmount({ value }) {
  return (
    <span className="tabular font-medium text-[var(--text-primary)]">
      {idrCompact(value)}
    </span>
  );
}

function PnLBox({
  lines,
  columns,
  subtitle,
  showVariantToggle = false,
  variant = 'Direct',
  onVariantChange,
  pagination = null,
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [openIds, setOpenIds] = useState(() => new Set());
  const toggle = (id) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const colKeys = columns?.map(c => c.key) ?? [];

  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl mb-5 card-shadow overflow-hidden">
      <button
        type="button"
        onClick={() => setPanelOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left cursor-pointer
          hover:bg-[var(--surface-elevated)] transition-colors"
      >
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Performance P&L</h3>
          <p className="text-[11px] text-[var(--text-faint)] mt-0.5 truncate">
            {panelOpen
              ? (subtitle || 'Sub-Category from Revenue to Net Income · follows active filters')
              : 'Click to expand'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
          {pagination && panelOpen && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={pagination.onPrev}
                disabled={pagination.page === 0}
                aria-label="Previous sub-segments"
                className="w-6 h-6 rounded-lg border border-[var(--border-default)] text-xs
                  flex items-center justify-center text-[var(--text-faint)] bg-[var(--surface-elevated)]
                  hover:text-[var(--text-primary)] disabled:opacity-35 disabled:cursor-default cursor-pointer"
              >
                ‹
              </button>
              <span className="text-[11px] text-[var(--text-faint)] tabular whitespace-nowrap px-0.5">
                {pagination.page + 1}/{pagination.totalPages}
              </span>
              <button
                type="button"
                onClick={pagination.onNext}
                disabled={pagination.page === pagination.totalPages - 1}
                aria-label="Next sub-segments"
                className="w-6 h-6 rounded-lg border border-[var(--border-default)] text-xs
                  flex items-center justify-center text-[var(--text-faint)] bg-[var(--surface-elevated)]
                  hover:text-[var(--text-primary)] disabled:opacity-35 disabled:cursor-default cursor-pointer"
              >
                ›
              </button>
            </div>
          )}
          {showVariantToggle && panelOpen && (
            <select
              value={variant}
              onChange={e => onVariantChange?.(e.target.value)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg
                bg-[var(--surface-elevated)] text-[var(--text-primary)]
                border border-[var(--border-default)] outline-none cursor-pointer
                focus:ring-1 focus:ring-blue-600"
            >
              <option value="Direct">Direct</option>
              <option value="Total">Total</option>
            </select>
          )}
          <span className="w-7 h-7 rounded-lg border border-[var(--border-default)]
            flex items-center justify-center text-sm text-[var(--text-faint)] bg-[var(--surface-elevated)]">
            {panelOpen ? '−' : '+'}
          </span>
        </div>
      </button>

      {panelOpen && (
        <div className="px-6 pb-6 pt-1 border-t border-[var(--border-default)]">
          {!lines?.length ? (
            <div className="py-10 text-center text-[var(--text-very-faint)] text-sm">No P&L data</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[520px]">
                <thead>
                  <tr className="border-b border-[var(--border-default)]">
                    <th className="py-2.5 text-left text-[11px] uppercase tracking-wider text-[var(--text-very-faint)] font-medium pr-3 sticky left-0 bg-[var(--surface-card)]">
                      Sub-Category
                    </th>
                    {columns?.map(col => (
                      <th key={col.key} className="py-2.5 text-right text-[11px] uppercase tracking-wider text-[var(--text-very-faint)] font-medium px-2 whitespace-nowrap">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const hasChildren = Array.isArray(line.children) && line.children.length > 0;
                    const opened = openIds.has(line.id || line.subcat);
                    const isTotalish = /^(Revenue|CM|GP|Total |EBITDA|EBIT|Adj\.|Net Income|Finance)/i.test(line.label || line.subcat);
                    return (
                      <Fragment key={line.id || line.subcat}>
                        <tr className="border-b border-[var(--border-faint)] hover:bg-[var(--surface-elevated)] transition-colors">
                          <td className={`py-2 pr-3 sticky left-0 bg-[var(--surface-card)] ${isTotalish ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
                            <span className="inline-flex items-center gap-1.5">
                              {hasChildren ? (
                                <button
                                  type="button"
                                  onClick={() => toggle(line.id || line.subcat)}
                                  className="w-4 h-4 rounded border border-[var(--border-default)] text-[10px] leading-none
                                    flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-primary)] cursor-pointer"
                                  aria-label={opened ? 'Collapse' : 'Expand'}
                                >
                                  {opened ? '−' : '+'}
                                </button>
                              ) : (
                                <span className="w-4 inline-block" />
                              )}
                              {line.label || line.subcat}
                            </span>
                          </td>
                          {colKeys.map(key => (
                            <td key={key} className="py-2 text-right px-2">
                              <PnLAmount value={line.values?.[key] ?? 0} />
                            </td>
                          ))}
                        </tr>
                        {hasChildren && opened && line.children.map(child => (
                          <tr key={`${line.id}-${child.id || child.subcat}`} className="border-b border-[var(--border-faint)] bg-[var(--surface-elevated)]/40">
                            <td className="py-1.5 pr-3 pl-8 text-[var(--text-muted)] sticky left-0 bg-[var(--surface-elevated)]">
                              {child.label || child.subcat}
                            </td>
                            {colKeys.map(key => (
                              <td key={key} className="py-1.5 text-right px-2">
                                <PnLAmount value={child.values?.[key] ?? 0} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Main Dashboard ────────────────────────────────────────────────── */
export default function Dashboard() {
  return (
    <ThemeProvider>
      <DataProvider>
        <DashboardInner />
      </DataProvider>
    </ThemeProvider>
  );
}

function DashboardInner() {
  const { theme } = useTheme();
  const { activeData, activeMeta, isCustom } = useDataCtx();
  const c = CHART[theme];

  const [page, setPage] = useState('consolidated');
  const [subSegmentsSelected, setSubSegmentsSelected] = useState([]); // [] = all
  const [filter, setFilter] = useState({ quarter: 'all', months: [] }); // months [] = all
  const [category, setCategory] = useState('Before Elim');
  const [amountFormat, setAmountFormat] = useState(() => localStorage.getItem('fd-amount-fmt') ?? 'compact');
  const [ebitdaVariant, setEbitdaVariant] = useState('Adj. EBITDA (Direct)');
  const [ebitVariant, setEbitVariant] = useState('Adj. EBIT (Direct)');
  const [chartType, setChartType] = useState('area');
  const [trendMetric, setTrendMetric] = useState('ebitda');
  const [pnlGaVariant, setPnlGaVariant] = useState('Direct'); // Direct | Total for segment P&L
  const [subPnlPage, setSubPnlPage] = useState(0); // paging through sub-segment columns in Performance P&L

  // Mutate synchronously during render (not in an effect) so that the module-level
  // formatter picks up the new mode before this render's children (KPI cards, charts,
  // tooltips) run — an effect would fire one paint too late, leaving stale numbers
  // on screen until an unrelated re-render happened to occur.
  setGlobalAmountMode(amountFormat);
  useEffect(() => {
    localStorage.setItem('fd-amount-fmt', amountFormat);
  }, [amountFormat]);

  const isSegmentPage = page !== 'consolidated';
  const isCorporate = page === 'Corporate';
  const isRetail = page === 'Retail';
  // Retail/Mitra/Gaming/Investment/Corporate: Before Elim only — Before/After Elim toggle is Consolidated-only.
  const effectiveCategory = isSegmentPage ? 'Before Elim' : category;
  const useDashboardScope = !isSegmentPage || subSegmentsSelected.length === 0;
  // Direct/Total only on segment pages that expose Adj. EBITDA/EBIT variants (not Corporate).
  const showEbitdaVariant = isSegmentPage && !isRetail && !isCorporate && effectiveCategory === 'Before Elim' && useDashboardScope;
  const showEbitVariant = isRetail && effectiveCategory === 'Before Elim' && useDashboardScope;

  const subSegments = isSegmentPage ? visibleSubSegments(page, activeData.SUB_SEGMENTS?.[page] ?? []) : [];
  const selectedMonthNums = filter.months;
  const isFiltered = filter.quarter !== 'all' || filter.months.length > 0 || subSegmentsSelected.length > 0 || effectiveCategory !== 'Before Elim';

  // When a sub-segment is selected, show plain EBIT (Retail) / EBITDA (other segments).
  const ebitdaLabel = !useDashboardScope && isSegmentPage && !isRetail
    ? 'EBITDA'
    : effectiveCategory === 'After Elim'
      ? 'Adj. EBITDA'
      : (showEbitdaVariant ? 'Adj. EBITDA' : (isSegmentPage && !isRetail && !isCorporate ? ebitdaVariant : 'Adj. EBITDA'));
  const ebitLabel = !useDashboardScope && isRetail
    ? 'EBIT'
    : effectiveCategory === 'After Elim'
      ? 'Adj. EBIT'
      : (showEbitVariant ? 'Adj. EBIT' : ebitVariant);

  // KPI field configs per page
  const kpiFields = useMemo(() => {
    if (!isSegmentPage) {
      // Consolidated: Revenue · Adj. EBITDA · Net Income
      return [
        { key: 'revenue', label: 'Revenue', actual: 'Revenue', vsBudget: 'RevenueVsBudget', diff: 'RevenueDiff', ytd: 'RevenueYTDVsBudget', yoy: 'RevenueYoY', infoKey: 'Revenue' },
        { key: 'ebitda', label: ebitdaLabel, actual: 'EBITDA', vsBudget: 'EBITDAVsBudget', diff: 'EBITDADiff', ytd: 'EBITDAYTDVsBudget', yoy: 'EBITDAYoY', infoKey: 'Adj. EBITDA' },
        { key: 'netIncome', label: 'Net Income', actual: 'NetIncome', vsBudget: 'NetIncomeVsBudget', diff: 'NetIncomeDiff', ytd: 'NetIncomeYTDVsBudget', yoy: 'NetIncomeYoY', infoKey: 'Net Income' },
      ];
    }
    if (isCorporate) {
      // Corporate: CM · Adj. EBITDA · Net Income
      return [
        { key: 'cm', label: 'CM', actual: 'CM', vsBudget: 'CMVsBudget', diff: 'CMDiff', ytd: 'CMYTDVsBudget', yoy: 'CMYoY', infoKey: 'CM' },
        { key: 'ebitda', label: ebitdaLabel, actual: 'EBITDA', vsBudget: 'EBITDAVsBudget', diff: 'EBITDADiff', ytd: 'EBITDAYTDVsBudget', yoy: 'EBITDAYoY', infoKey: 'Adj. EBITDA' },
        { key: 'netIncome', label: 'Net Income', actual: 'NetIncome', vsBudget: 'NetIncomeVsBudget', diff: 'NetIncomeDiff', ytd: 'NetIncomeYTDVsBudget', yoy: 'NetIncomeYoY', infoKey: 'Net Income' },
      ];
    }
    if (isRetail) {
      return [
        { key: 'revenue', label: 'Revenue', actual: 'Revenue', vsBudget: 'RevenueVsBudget', diff: 'RevenueDiff', ytd: 'RevenueYTDVsBudget', yoy: 'RevenueYoY', infoKey: 'Revenue' },
        { key: 'cm', label: 'CM', actual: 'CM', vsBudget: 'CMVsBudget', diff: 'CMDiff', ytd: 'CMYTDVsBudget', yoy: 'CMYoY', infoKey: 'CM' },
        { key: 'ebit', label: ebitLabel, actual: 'EBIT', vsBudget: 'EBITVsBudget', diff: 'EBITDiff', ytd: 'EBITYTDVsBudget', yoy: 'EBITYoY', infoKey: useDashboardScope ? 'Adj. EBIT' : 'EBIT' },
      ];
    }
    // Mitra, Gaming, Investment
    return [
      { key: 'revenue', label: 'Revenue', actual: 'Revenue', vsBudget: 'RevenueVsBudget', diff: 'RevenueDiff', ytd: 'RevenueYTDVsBudget', yoy: 'RevenueYoY', infoKey: 'Revenue' },
      { key: 'cm', label: 'CM', actual: 'CM', vsBudget: 'CMVsBudget', diff: 'CMDiff', ytd: 'CMYTDVsBudget', yoy: 'CMYoY', infoKey: 'CM' },
      { key: 'ebitda', label: ebitdaLabel, actual: 'EBITDA', vsBudget: 'EBITDAVsBudget', diff: 'EBITDADiff', ytd: 'EBITDAYTDVsBudget', yoy: 'EBITDAYoY', infoKey: useDashboardScope ? 'Adj. EBITDA' : 'EBITDA' },
    ];
  }, [isSegmentPage, isCorporate, isRetail, ebitdaLabel, ebitLabel, useDashboardScope]);

  const TREND_OPTIONS = useMemo(() => {
    if (!isSegmentPage) {
      return [
        { id: 'revenue', label: 'Revenue', actualKey: 'Revenue', budgetKey: 'RevenueBudget', color: '#3b82f6' },
        { id: 'ebitda', label: ebitdaLabel, actualKey: 'EBITDA', budgetKey: 'EBITDABudget', color: '#10b981' },
        { id: 'netIncome', label: 'Net Income', actualKey: 'NetIncome', budgetKey: 'NetIncomeBudget', color: '#a855f7' },
      ];
    }
    if (isCorporate) {
      return [
        { id: 'cm', label: 'CM', actualKey: 'CM', budgetKey: 'CMBudget', color: '#06b6d4' },
        { id: 'ebitda', label: ebitdaLabel, actualKey: 'EBITDA', budgetKey: 'EBITDABudget', color: '#10b981' },
        { id: 'netIncome', label: 'Net Income', actualKey: 'NetIncome', budgetKey: 'NetIncomeBudget', color: '#a855f7' },
      ];
    }
    if (isRetail) {
      return [
        { id: 'revenue', label: 'Revenue', actualKey: 'Revenue', budgetKey: 'RevenueBudget', color: '#3b82f6' },
        { id: 'cm', label: 'CM', actualKey: 'CM', budgetKey: 'CMBudget', color: '#06b6d4' },
        { id: 'ebit', label: ebitLabel, actualKey: 'EBIT', budgetKey: 'EBITBudget', color: '#f59e0b' },
      ];
    }
    return [
      { id: 'revenue', label: 'Revenue', actualKey: 'Revenue', budgetKey: 'RevenueBudget', color: '#3b82f6' },
      { id: 'cm', label: 'CM', actualKey: 'CM', budgetKey: 'CMBudget', color: '#06b6d4' },
      { id: 'ebitda', label: ebitdaLabel, actualKey: 'EBITDA', budgetKey: 'EBITDABudget', color: '#10b981' },
    ];
  }, [isSegmentPage, isCorporate, isRetail, ebitdaLabel, ebitLabel]);

  const activeTrend = TREND_OPTIONS.find(o => o.id === trendMetric) ?? TREND_OPTIONS[0];

  useEffect(() => { setSubSegmentsSelected([]); }, [page]);
  useEffect(() => { setPnlGaVariant('Direct'); }, [page]);
  useEffect(() => { setSubPnlPage(0); }, [page]);
  // Retail/Mitra/Gaming/Investment/Corporate: Before Elim only — no Before/After Elim toggle.
  useEffect(() => { if (isSegmentPage) setCategory('Before Elim'); }, [isSegmentPage, page]);

  useEffect(() => {
    if (!TREND_OPTIONS.some(o => o.id === trendMetric)) {
      setTrendMetric(TREND_OPTIONS[0]?.id ?? 'ebitda');
    }
  }, [page, TREND_OPTIONS, trendMetric]);

  const pickVariantSeries = useCallback((baseByCategory, variantsByCategory) => {
    if (effectiveCategory === 'After Elim') {
      return asMonthlyArray(baseByCategory, 'After Elim');
    }
    // Before Elim — prefer Direct/Total variant series when applicable
    if (isRetail && variantsByCategory?.['Before Elim']?.[ebitVariant]) {
      return variantsByCategory['Before Elim'][ebitVariant];
    }
    // Corporate: Adj. EBITDA (Direct) vs Budget (Direct), Dashboard sub-segment — no Direct/Total UI
    if (isCorporate && variantsByCategory?.['Before Elim']?.['Adj. EBITDA (Direct)']) {
      return variantsByCategory['Before Elim']['Adj. EBITDA (Direct)'];
    }
    if (isSegmentPage && !isRetail && !isCorporate && variantsByCategory?.['Before Elim']?.[ebitdaVariant]) {
      return variantsByCategory['Before Elim'][ebitdaVariant];
    }
    if (!isSegmentPage && variantsByCategory?.['Before Elim']?.['Adj. EBITDA (Total)']) {
      return variantsByCategory['Before Elim']['Adj. EBITDA (Total)'];
    }
    return asMonthlyArray(baseByCategory, 'Before Elim');
  }, [effectiveCategory, isRetail, isCorporate, isSegmentPage, ebitVariant, ebitdaVariant]);

  const sourceMonthly = useMemo(() => {
    if (page === 'consolidated') {
      return pickVariantSeries(activeData.MONTHLY, activeData.MONTHLY_VARIANTS);
    }
    if (useDashboardScope) {
      return pickVariantSeries(
        activeData.SEGMENT_MONTHLY?.[page],
        activeData.SEGMENT_VARIANTS?.[page],
      );
    }
    // Multi sub-segment selection — sum selected sub-segments (no Before/After Elim on detail rows)
    const series = subSegmentsSelected
      .map(sub => activeData.SUBSEGMENT_MONTHLY?.[page]?.[sub] ?? [])
      .filter(s => s.length);
    return mergeMonthlySeries(series);
  }, [activeData, page, useDashboardScope, subSegmentsSelected, pickVariantSeries]);

  const filteredMonthly = useMemo(() => filterMonthly(sourceMonthly, filter), [sourceMonthly, filter]);
  const filteredKeys = useMemo(() => new Set(filteredMonthly.map(m => `${m.year}-${m.month}`)), [filteredMonthly]);

  const kpis = useMemo(() => computePeriodKPIs(filteredMonthly, kpiFields), [filteredMonthly, kpiFields]);
  const vsPeriodIndicator = useMemo(
    () => computeVsPeriodIndicator(sourceMonthly, filteredMonthly, filter, selectedMonthNums, kpiFields),
    [sourceMonthly, filteredMonthly, filter, selectedMonthNums, kpiFields],
  );

  const dataStatus = useMemo(() => {
    if (selectedMonthNums.length === 0) return null;
    const tags = filteredMonthly
      .filter(m => selectedMonthNums.includes(m.monthNum))
      .map(m => m.tag)
      .filter(Boolean);
    if (!tags.length) return null;
    const unique = [...new Set(tags)];
    return unique.length === 1 ? unique[0] : 'Mixed';
  }, [filteredMonthly, selectedMonthNums]);

  const trendChart = useMemo(() => {
    const trendBase = selectedMonthNums.length > 0
      ? sourceMonthly
      : filterMonthly(sourceMonthly, { quarter: filter.quarter, months: [] });
    return trendBase.map(m => ({
      label: monthLabel(m),
      Actual: m[activeTrend.actualKey] ?? 0,
      Budget: m[activeTrend.budgetKey] ?? 0,
      monthNum: m.monthNum,
      highlighted: selectedMonthNums.length > 0 && selectedMonthNums.includes(m.monthNum),
      tag: m.tag,
    }));
  }, [sourceMonthly, filter.quarter, selectedMonthNums, activeTrend]);

  const highlightedLabels = trendChart.filter(d => d.highlighted).map(d => d.label);

  const performanceData = useMemo(() => {
    // Consolidated + Corporate: Adj. EBITDA by all segments (same visual)
    if (page === 'consolidated' || isCorporate) {
      return filteredSegmentAdjEbitda(
        activeData.SEGMENT_MONTHLY ?? {},
        activeData.SEGMENTS ?? ALL_SEGMENTS,
        filteredKeys,
        effectiveCategory,
      );
    }
    if (!useDashboardScope) {
      const series = subSegmentsSelected
        .map(sub => {
          const rows = (activeData.SUBSEGMENT_MONTHLY?.[page]?.[sub] ?? [])
            .filter(m => filteredKeys.has(`${m.year}-${m.month}`));
          if (isRetail) {
            return {
              Segment: sub,
              Revenue: rows.reduce((s, m) => s + m.Revenue, 0),
              CM: rows.reduce((s, m) => s + (m.CM ?? 0), 0),
              EBIT: rows.reduce((s, m) => s + (m.EBIT ?? 0), 0),
            };
          }
          return {
            Segment: sub,
            Revenue: rows.reduce((s, m) => s + m.Revenue, 0),
            CM: rows.reduce((s, m) => s + (m.CM ?? 0), 0),
            EBITDA: rows.reduce((s, m) => s + m.EBITDA, 0),
          };
        })
        .filter(s => {
          if (isRetail) return s.Revenue !== 0 || s.CM !== 0 || s.EBIT !== 0;
          return s.Revenue !== 0 || s.CM !== 0 || s.EBITDA !== 0;
        })
        .sort((a, b) => b.Revenue - a.Revenue);
      return series;
    }
    const perfMode = isRetail ? 'retail' : 'cmEbitda';
    return filteredSubSegmentPerformance(
      activeData.SUBSEGMENT_MONTHLY?.[page] ?? {},
      subSegments,
      filteredKeys,
      { mode: perfMode },
    );
  }, [activeData, page, filteredKeys, subSegments, useDashboardScope, subSegmentsSelected, isCorporate, isRetail, effectiveCategory]);

  const showConsolidatedStylePerf = page === 'consolidated' || isCorporate;

  const perfMetrics = showConsolidatedStylePerf
    ? [{ key: 'AdjEBITDA', label: 'Adj. EBITDA', color: PERF_COLORS.EBITDA }]
    : isRetail
      ? [
          { key: 'Revenue', label: 'Revenue', color: PERF_COLORS.Revenue },
          { key: 'CM', label: 'CM', color: PERF_COLORS.CM },
          { key: 'EBIT', label: 'EBIT', color: PERF_COLORS.EBIT },
        ]
      : [
          { key: 'Revenue', label: 'Revenue', color: PERF_COLORS.Revenue },
          { key: 'CM', label: 'CM', color: PERF_COLORS.CM },
          { key: 'EBITDA', label: 'EBITDA', color: PERF_COLORS.EBITDA },
        ];

  const pnlView = useMemo(() => {
    const bundle = activeData.PNL?.[effectiveCategory];
    const monthFilter = (months) => sumPnLMonths(months, filter, selectedMonthNums);
    const showPnlVariant = useDashboardScope
      && isSegmentPage
      && !isCorporate
      && ['Retail', 'Mitra', 'Gaming', 'Investment'].includes(page);
    const allowedLineIds = showPnlVariant
      ? (pnlGaVariant === 'Total'
        ? (bundle?.totalLines ?? PNL_LINES_TOTAL)
        : (bundle?.directLines ?? PNL_LINES_DIRECT))
      : null;

    const filterLinesByVariant = (sourceLines) => {
      if (!allowedLineIds) return sourceLines || [];
      const allow = new Set(allowedLineIds);
      return (sourceLines || []).filter(l => allow.has(l.id || l.subcat) || allow.has(l.label));
    };

    const projectLines = (sourceLines, valueKey) => filterLinesByVariant(sourceLines).map(line => {
      const projected = {
        id: line.id || line.subcat,
        subcat: line.subcat,
        label: line.label || line.subcat,
        values: { [valueKey]: monthFilter(line.months) },
      };
      if (line.children) {
        projected.children = line.children.map(ch => ({
          id: ch.id || ch.subcat,
          subcat: ch.subcat,
          label: ch.label || ch.subcat,
          values: { [valueKey]: monthFilter(ch.months) },
        }));
      }
      return projected;
    });

    const mergeColumns = (baseLines, colDefs) => {
      const filteredBase = filterLinesByVariant(baseLines);
      const byId = new Map(filteredBase.map(l => [l.id || l.subcat, {
        id: l.id || l.subcat,
        subcat: l.subcat,
        label: l.label || l.subcat,
        values: {},
        children: (l.children || []).map(ch => ({
          id: ch.id || ch.subcat,
          subcat: ch.subcat,
          label: ch.label || ch.subcat,
          values: {},
        })),
      }]));

      for (const col of colDefs) {
        for (const line of filterLinesByVariant(col.lines)) {
          const id = line.id || line.subcat;
          if (!byId.has(id)) {
            byId.set(id, {
              id,
              subcat: line.subcat,
              label: line.label || line.subcat,
              values: {},
              children: (line.children || []).map(ch => ({
                id: ch.id || ch.subcat,
                subcat: ch.subcat,
                label: ch.label || ch.subcat,
                values: {},
              })),
            });
          }
          const target = byId.get(id);
          target.values[col.key] = monthFilter(line.months);
          (line.children || []).forEach((ch) => {
            const childId = ch.id || ch.subcat;
            let child = target.children.find(c => (c.id || c.subcat) === childId);
            if (!child) {
              child = { id: childId, subcat: ch.subcat, label: ch.label || ch.subcat, values: {} };
              target.children.push(child);
            }
            child.values[col.key] = monthFilter(ch.months);
          });
        }
      }

      const order = filteredBase.map(l => l.id || l.subcat);
      const ordered = order.map(id => byId.get(id)).filter(Boolean);
      for (const [id, line] of byId) {
        if (!order.includes(id)) ordered.push(line);
      }
      return ordered;
    };

    // Sub-segment(s) selected → simple P&L for those subs (no Direct/Total split in source)
    if (isSegmentPage && !useDashboardScope) {
      const cols = subSegmentsSelected.map(sub => ({
        key: sub,
        label: sub,
        lines: bundle?.bySubSegment?.[page]?.[sub]?.simple
          ?? bundle?.bySubSegment?.[page]?.[sub]?.full
          ?? [],
      }));
      if (cols.length === 1) {
        return {
          columns: [{ key: cols[0].key, label: cols[0].label }],
          lines: projectLines(cols[0].lines, cols[0].key),
          subtitle: `Sub-Segment ${cols[0].label} · Revenue to EBIT`,
          showVariantToggle: false,
        };
      }
      return {
        columns: cols.map(c => ({ key: c.key, label: c.label })),
        lines: mergeColumns(cols[0]?.lines, cols),
        subtitle: 'Selected Sub-Segments · Revenue to EBIT',
        showVariantToggle: false,
      };
    }

    // Consolidated + Corporate: full lines + per-segment columns
    if (page === 'consolidated' || isCorporate) {
      const segOrder = ['Retail', 'Mitra', 'Gaming', 'Investment', 'Corporate'];
      const mainLines = isCorporate
        ? (bundle?.bySegment?.Corporate ?? bundle?.lines ?? [])
        : (bundle?.lines ?? []);
      const cols = [
        { key: '_main', label: isCorporate ? 'Corporate' : 'Consolidated', lines: mainLines },
        ...segOrder.map(seg => ({
          key: seg,
          label: seg,
          lines: bundle?.bySegment?.[seg] ?? [],
        })),
      ];
      return {
        columns: cols.map(c => ({ key: c.key, label: c.label })),
        lines: mergeColumns(mainLines, cols),
        subtitle: 'P&L lines · per segment comparison',
        showVariantToggle: false,
      };
    }

    // Retail / Mitra / Gaming / Investment — full segment + ALL sub-segments, paginated 5 at a time.
    // Ranked by the segment's headline profit metric (Adj. EBIT for Retail, Adj. EBITDA for others).
    const mainLines = bundle?.bySegment?.[page] ?? [];
    const subs = visibleSubSegments(page, activeData.SUB_SEGMENTS?.[page] ?? []);
    const rankMetric = page === 'Retail' ? 'ebit' : 'ebitda';
    const ranked = subs
      .map(sub => {
        const rows = (activeData.SUBSEGMENT_MONTHLY?.[page]?.[sub] ?? [])
          .filter(m => filteredKeys.has(`${m.year}-${m.month}`));
        return {
          sub,
          ebit: rows.reduce((s, m) => s + (m.EBIT ?? 0), 0),
          ebitda: rows.reduce((s, m) => s + (m.EBITDA ?? 0), 0),
        };
      })
      .sort((a, b) => b[rankMetric] - a[rankMetric])
      .map(r => r.sub);

    const PAGE_SIZE = 5;
    const totalPages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(subPnlPage, 0), totalPages - 1);
    const pageSubs = ranked.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

    const cols = [
      { key: '_main', label: page, lines: mainLines },
      ...pageSubs.map(sub => ({
        key: sub,
        label: sub,
        lines: bundle?.bySubSegment?.[page]?.[sub]?.full
          ?? bundle?.bySubSegment?.[page]?.[sub]?.simple
          ?? [],
      })),
    ];

    const metricLabel = page === 'Retail' ? 'Adj. EBIT' : 'Adj. EBITDA';
    const subtitle = `${page} + all Sub-Segments · ranked by ${metricLabel} · ${pnlGaVariant}`;

    return {
      columns: cols.map(c => ({ key: c.key, label: c.label })),
      lines: mergeColumns(mainLines, cols),
      subtitle,
      showVariantToggle: showPnlVariant,
      pagination: totalPages > 1 ? {
        page: safePage,
        totalPages,
        onPrev: () => setSubPnlPage(p => Math.max(0, p - 1)),
        onNext: () => setSubPnlPage(p => Math.min(totalPages - 1, p + 1)),
      } : null,
    };
  }, [
    activeData, page, effectiveCategory, filter, selectedMonthNums,
    isCorporate, isSegmentPage, useDashboardScope, subSegmentsSelected, filteredKeys,
    pnlGaVariant, subPnlPage,
  ]);

  const pageTitle = page === 'consolidated' ? 'FP&A Financial Dashboard' : `${page} Segment`;
  const dataSourceLabel = isCustom && activeMeta ? activeMeta.filename : 'WIP Dashboard per 4 August 17.35.csv';

  const tableHeaders = useMemo(() => {
    const cols = ['Period', 'Tag'];
    for (const f of kpiFields) cols.push(f.label);
    return cols;
  }, [kpiFields]);

  return (
    <div className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)] px-4 py-6 md:px-8 md:py-8 font-sans">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
        <div className="flex items-center gap-3.5 min-w-0">
          <img
            src="/bukalapak-logo.png"
            alt="Bukalapak"
            className="h-10 w-10 sm:h-11 sm:w-11 object-contain shrink-0 bg-transparent"
          />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-[var(--text-very-faint)] mb-1">Executive Dashboard</p>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] truncate">{pageTitle}</h1>
            {isSegmentPage && (
              <p className="text-[var(--text-faint)] text-sm mt-1">FY 2026</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <DataManager />
          <ThemeToggle />
        </div>
      </header>

      <PageNav page={page} onChange={setPage} />

      <FilterBar
        quarter={filter.quarter}
        months={filter.months}
        onChange={f => setFilter(prev => ({ ...prev, ...f }))}
        onReset={() => { setFilter({ quarter: 'all', months: [] }); setSubSegmentsSelected([]); setCategory('Before Elim'); }}
        isActive={isFiltered}
        showSubSegment={isSegmentPage}
        subSegmentsSelected={subSegmentsSelected}
        subSegments={subSegments}
        onSubSegmentsChange={setSubSegmentsSelected}
        category={category}
        onCategoryChange={setCategory}
        showCategory={!isSegmentPage}
        amountFormat={amountFormat}
        onAmountFormatChange={setAmountFormat}
        dataStatus={dataStatus}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5 mb-5">
        {kpiFields.map(f => {
          const isEbitdaCard = f.key === 'ebitda' && showEbitdaVariant;
          const isEbitCard = f.key === 'ebit' && showEbitVariant;
          return (
            <KPICardWithDiffs
              key={`${f.key}-${amountFormat}`}
              label={f.label}
              infoKey={f.infoKey}
              value={kpis[f.key]}
              vsBudget={kpis[`vsBudget_${f.key}`]}
              vsPeriod={vsPeriodIndicator.values[f.key]}
              vsPeriodLabel={vsPeriodIndicator.label}
              vsLastYear={kpis[`vsYoy_${f.key}`]}
              vsYtdBudget={kpis[`vsYtd_${f.key}`]}
              dropdown={isEbitdaCard ? {
                value: ebitdaVariant,
                onChange: setEbitdaVariant,
                options: EBITDA_VARIANT_OPTS,
                disabled: false,
              } : isEbitCard ? {
                value: ebitVariant,
                onChange: setEbitVariant,
                options: EBIT_VARIANT_OPTS,
                disabled: false,
              } : null}
            />
          );
        })}
      </div>

      {/* Charts Row */}
      <div key={`charts-${amountFormat}`} className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div className="lg:col-span-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 card-shadow">
          <div className="flex flex-col gap-3 mb-5">
            <div className="flex flex-wrap justify-between items-start gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{activeTrend.label} Trend vs Budget</h3>
                <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                  Monthly trend · IDR
                  {highlightedLabels.length > 0 && (
                    <span className="ml-2 text-blue-400">· Highlighted: {highlightedLabels.join(', ')}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center bg-[var(--surface-elevated)] rounded-lg p-0.5 gap-0.5">
                {['area', 'bar'].map(t => (
                  <button key={t} onClick={() => setChartType(t)}
                    className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium cursor-pointer transition-all
                      ${chartType === t ? 'bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-faint)]'}`}>
                    {t === 'area' ? 'Line' : 'Bar'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-very-faint)] mr-1">Metric</span>
              {TREND_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setTrendMetric(opt.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all
                    ${trendMetric === opt.id
                      ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(59,130,246,0.3)]'
                      : 'bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'area' ? (
                <AreaChart data={trendChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={activeTrend.color} stopOpacity={0.18} />
                      <stop offset="95%" stopColor={activeTrend.color} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradBudget" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke={c.grid} vertical={false} />
                  <XAxis dataKey="label" stroke={c.axis} tick={{ fill: c.tick, fontSize: 11 }} tickLine={false} axisLine={{ stroke: c.axis }} />
                  <YAxis stroke={c.axis} tick={{ fill: c.tick, fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={v => idr(v, { axis: true })} width={72} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke={c.refLine} strokeDasharray="4 4" />
                  {highlightedLabels.slice(0, 3).map(lbl => (
                    <ReferenceLine key={lbl} x={lbl} stroke="#3b82f6" strokeDasharray="4 4" strokeWidth={1.5} />
                  ))}
                  <Area type="monotone" dataKey="Actual" name={activeTrend.label} stroke={activeTrend.color} strokeWidth={2}
                    fill="url(#gradActual)"
                    dot={<HighlightDot fill={activeTrend.color} />}
                    activeDot={{ r: 6, strokeWidth: 0 }} />
                  <Area type="monotone" dataKey="Budget" name="Budget" stroke="#f59e0b" strokeWidth={1.5}
                    fill="url(#gradBudget)" strokeDasharray="5 4"
                    dot={<HighlightDot fill="#f59e0b" />}
                    activeDot={{ r: 5, strokeWidth: 0 }} />
                </AreaChart>
              ) : (
                <BarChart data={trendChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="2 4" stroke={c.grid} vertical={false} />
                  <XAxis dataKey="label" stroke={c.axis} tick={{ fill: c.tick, fontSize: 11 }} tickLine={false} axisLine={{ stroke: c.axis }} />
                  <YAxis stroke={c.axis} tick={{ fill: c.tick, fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={v => idr(v, { axis: true })} width={72} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: c.cursor, opacity: 0.4 }} />
                  <ReferenceLine y={0} stroke={c.refLine} strokeDasharray="4 4" />
                  <Bar dataKey="Actual" name={activeTrend.label} radius={[3, 3, 0, 0]} maxBarSize={24}>
                    {trendChart.map((d, i) => (
                      <Cell key={i} fill={activeTrend.color} fillOpacity={d.highlighted ? 1 : 0.45}
                        stroke={d.highlighted ? '#fff' : undefined} strokeWidth={d.highlighted ? 2 : 0} />
                    ))}
                  </Bar>
                  <Bar dataKey="Budget" name="Budget" radius={[3, 3, 0, 0]} maxBarSize={24}>
                    {trendChart.map((d, i) => (
                      <Cell key={i} fill="#f59e0b" fillOpacity={d.highlighted ? 1 : 0.45}
                        stroke={d.highlighted ? '#fff' : undefined} strokeWidth={d.highlighted ? 2 : 0} />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
          <div className="flex gap-5 mt-3 pt-3 border-t border-[var(--border-default)]">
            <div className="flex items-center gap-2">
              <div className="w-5 h-[2px] rounded" style={{ background: activeTrend.color }} />
              <span className="text-[11px] text-[var(--text-faint)]">{activeTrend.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 border-b-2 border-dashed border-amber-500" />
              <span className="text-[11px] text-[var(--text-faint)]">Budget</span>
            </div>
          </div>
        </div>

        <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 card-shadow">
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {page === 'consolidated' || isCorporate ? 'Segment Performance' : 'Sub-Segment Performance'}
            </h3>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
              {showConsolidatedStylePerf
                ? 'Adj. EBITDA by segment'
                : isRetail
                  ? 'Revenue · CM · EBIT (Direct)'
                  : 'Revenue · CM · EBITDA (Direct)'}
            </p>
          </div>
          {performanceData.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-[var(--text-very-faint)] text-sm">No data</div>
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceData} margin={{ top: 4, right: 4, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={c.grid} vertical={false} />
                  <XAxis dataKey="Segment" stroke={c.axis} tick={{ fill: c.tick, fontSize: 9 }} tickLine={false}
                    axisLine={{ stroke: c.axis }} angle={-30} textAnchor="end" height={50} interval={0} />
                  <YAxis stroke={c.axis} tick={{ fill: c.tick, fontSize: 10 }} tickLine={false} axisLine={false}
                    tickFormatter={v => idr(v, { axis: true })} width={60} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: c.cursor, opacity: 0.4 }} />
                  <ReferenceLine y={0} stroke={c.refLine} strokeDasharray="4 4" />
                  {showConsolidatedStylePerf ? (
                    <Bar dataKey="AdjEBITDA" name="Adj. EBITDA" fillOpacity={0.95} radius={[2, 2, 0, 0]} maxBarSize={28}>
                      {performanceData.map((row, i) => (
                        <Cell key={i} fill={SEGMENT_COLORS[row.Segment] ?? PERF_COLORS.EBITDA} />
                      ))}
                    </Bar>
                  ) : (
                    perfMetrics.map(m => (
                      <Bar key={m.key} dataKey={m.key} name={m.label} fill={m.color} fillOpacity={0.85} radius={[2, 2, 0, 0]} maxBarSize={14} />
                    ))
                  )}
                  {!showConsolidatedStylePerf && <Legend wrapperStyle={{ fontSize: 10 }} />}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {showConsolidatedStylePerf && performanceData.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--border-default)] flex flex-wrap gap-x-4 gap-y-2">
              {ALL_SEGMENTS.map(seg => (
                <div key={seg} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: SEGMENT_COLORS[seg] }} />
                  <span className="text-[11px] text-[var(--text-faint)]">{seg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Monthly Detail Table */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 mb-5 card-shadow">
        <div className="flex justify-between items-center mb-5">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Monthly Detail</h3>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
              {filteredMonthly.length} periods · {kpiFields.map(f => f.label).join(', ')}
            </p>
          </div>
          {isFiltered && <span className="text-[11px] text-blue-500 bg-blue-400/10 px-2.5 py-1 rounded-lg">Filter active</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-default)]">
                {tableHeaders.map((h, i) => (
                  <th key={h} className={`py-2.5 text-[11px] uppercase tracking-wider text-[var(--text-very-faint)] font-medium ${i === 0 ? 'text-left pr-3' : 'text-right pr-3 last:pr-0'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredMonthly.length === 0 ? (
                <tr><td colSpan={tableHeaders.length} className="py-10 text-center text-[var(--text-very-faint)]">No data for the selected period</td></tr>
              ) : filteredMonthly.map((row, i) => (
                <tr key={i} className={`border-b border-[var(--border-faint)] hover:bg-[var(--surface-elevated)] transition-colors ${selectedMonthNums.includes(row.monthNum) ? 'bg-blue-500/5' : ''}`}>
                  <td className="py-2.5 pr-3 text-[var(--text-tertiary)] font-medium whitespace-nowrap">
                    {new Date(`${row.date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-elevated)] text-[var(--text-faint)]">{row.tag}</span>
                  </td>
                  {kpiFields.map((f, fi) => {
                    const val = row[f.actual] ?? 0;
                    const isLast = fi === kpiFields.length - 1;
                    return (
                      <td key={f.key}
                        className={`py-2.5 ${isLast ? '' : 'pr-3'} text-right tabular font-medium ${val >= 0 ? 'text-emerald-500' : 'text-red-500'} ${f.key === 'revenue' ? 'text-[var(--text-secondary)] font-normal' : ''}`}>
                        {idrCompact(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {filteredMonthly.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-[var(--border-default)]">
                  <td className="py-2.5 pr-3 font-semibold text-xs uppercase">Total</td>
                  <td />
                  {kpiFields.map((f, fi) => {
                    const val = kpis[f.key] ?? 0;
                    const isLast = fi === kpiFields.length - 1;
                    return (
                      <td key={f.key}
                        className={`py-2.5 ${isLast ? '' : 'pr-3'} text-right font-semibold tabular ${val >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {idrCompact(val)}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <PnLBox
        lines={pnlView.lines}
        columns={pnlView.columns}
        subtitle={pnlView.subtitle}
        showVariantToggle={!!pnlView.showVariantToggle}
        variant={pnlGaVariant}
        onVariantChange={setPnlGaVariant}
        pagination={pnlView.pagination}
      />

      <footer className="mt-8 flex flex-col sm:flex-row justify-between items-center gap-2 text-[11px] text-[var(--text-very-faint)]">
        <span>Source: {dataSourceLabel} · Values in IDR</span>
        <span>{new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
      </footer>
    </div>
  );
}
