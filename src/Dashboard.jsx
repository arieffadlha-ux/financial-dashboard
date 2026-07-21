import { useState, useMemo, createContext, useContext, useLayoutEffect, useCallback, useRef, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine, Legend,
} from 'recharts';
import * as DEFAULT_DATA from './data.js';
import { processCSV, SEGMENTS as ALL_SEGMENTS } from './dataProcessor.js';

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
const idr = (v, opts = {}) => {
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

const idrCompact = (v) => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}Rp ${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}Rp ${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${sign}Rp ${(abs / 1e6).toFixed(0)}M`;
  return `${sign}Rp ${abs.toLocaleString('en-US')}`;
};

const diffFmt = (v) => {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${idrCompact(v)}`;
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
const PERF_COLORS = { Revenue: '#3b82f6', EBITDA: '#10b981', NetIncome: '#f59e0b' };

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

const EBITDA_VARIANT_OPTS = [
  { id: 'Adj. EBITDA (Direct)', label: 'Adj. EBITDA (Direct)' },
  { id: 'Adj. EBITDA (Total)', label: 'Adj. EBITDA (Total)' },
];
const EBIT_VARIANT_OPTS = [
  { id: 'Adj. EBIT (Direct)', label: 'Adj. EBIT (Direct)' },
  { id: 'Adj. EBIT (Total)', label: 'Adj. EBIT (Total)' },
];

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

function computePeriodKPIs(filtered, fields) {
  const last = filtered[filtered.length - 1];
  const out = {};
  for (const f of fields) {
    out[f.key] = sumField(filtered, f.actual);
    out[`vsBudget_${f.key}`] = sumField(filtered, f.vsBudget);
    out[`vsPrev_${f.key}`] = last ? (last[f.diff] ?? null) : null;
    out[`vsYtd_${f.key}`] = last ? (last[f.ytd] ?? null) : null;
  }
  return out;
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

function filteredSubSegmentPerformance(subSegMonthly, subSegments, filteredKeys) {
  return subSegments.map(sub => {
    const rows = (subSegMonthly[sub] ?? []).filter(m => filteredKeys.has(`${m.year}-${m.month}`));
    return {
      Segment: sub,
      Revenue: rows.reduce((s, m) => s + m.Revenue, 0),
      EBITDA: rows.reduce((s, m) => s + m.EBITDA, 0),
      NetIncome: rows.reduce((s, m) => s + (m.NetIncome ?? 0), 0),
    };
  }).filter(s => s.Revenue !== 0 || s.EBITDA !== 0 || s.NetIncome !== 0)
    .sort((a, b) => b.Revenue - a.Revenue);
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
  category, onCategoryChange, dataStatus,
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
      <div className="h-4 w-px bg-[var(--border-default)]" />
      <div className="relative">
        <select value={category} onChange={e => onCategoryChange(e.target.value)}
          className="pl-3 pr-7 py-1.5 bg-[var(--surface-elevated)] text-[var(--text-muted)] text-xs rounded-lg border-0 outline-none focus:ring-1 focus:ring-blue-600 cursor-pointer appearance-none">
          <option value="Before Elim">Before Elim</option>
          <option value="After Elim">After Elim</option>
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

function KPICardWithDiffs({ label, value, vsBudget, vsPrevMonth, vsYtdBudget, dropdown }) {
  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-5 card-shadow hover:border-[var(--border-hover)] transition-all">
      <div className="flex items-start justify-between gap-2 mb-3">
        {dropdown ? (
          <select
            value={dropdown.value}
            onChange={e => dropdown.onChange(e.target.value)}
            disabled={dropdown.disabled}
            className="text-[11px] uppercase tracking-widest text-[var(--text-faint)] font-medium bg-transparent border-0 outline-none cursor-pointer max-w-full pr-1 disabled:cursor-default disabled:opacity-70"
          >
            {dropdown.options.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        ) : (
          <p className="text-[11px] uppercase tracking-widest text-[var(--text-faint)] font-medium">{label}</p>
        )}
      </div>
      <p className="text-[1.6rem] font-semibold leading-none text-[var(--text-primary)] tabular mb-3">{idr(value)}</p>
      <div className="flex flex-wrap gap-1.5">
        <DiffPill label="vs Budget" value={vsBudget} />
        <DiffPill label="vs Prev Month" value={vsPrevMonth} />
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

function PnLBox({ rows }) {
  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 mb-5 card-shadow">
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Performance P&L</h3>
        <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
          Sub-Category from Revenue to Net Income · follows active filters
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="py-10 text-center text-[var(--text-very-faint)] text-sm">No P&L data</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-default)]">
                <th className="py-2.5 text-left text-[11px] uppercase tracking-wider text-[var(--text-very-faint)] font-medium pr-3">Sub-Category</th>
                <th className="py-2.5 text-right text-[11px] uppercase tracking-wider text-[var(--text-very-faint)] font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isTotalish = /^(Revenue|CM|GP|Total |EBITDA|EBIT|Adj\.|Net Income|Finance)/i.test(row.subcat);
                return (
                  <tr key={row.subcat} className="border-b border-[var(--border-faint)] hover:bg-[var(--surface-elevated)] transition-colors">
                    <td className={`py-2 pr-3 ${isTotalish ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
                      {row.subcat}
                    </td>
                    <td className={`py-2 text-right tabular font-medium ${row.amount >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {idrCompact(row.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
  const [ebitdaVariant, setEbitdaVariant] = useState('Adj. EBITDA (Direct)');
  const [ebitVariant, setEbitVariant] = useState('Adj. EBIT (Direct)');
  const [chartType, setChartType] = useState('area');
  const [trendMetric, setTrendMetric] = useState('ebitda');

  const isSegmentPage = page !== 'consolidated';
  const isCorporate = page === 'Corporate';
  const isRetail = page === 'Retail';
  const showEbitdaVariant = isSegmentPage && !isRetail && category === 'Before Elim';
  const showEbitVariant = isRetail && category === 'Before Elim';
  const useDashboardScope = !isSegmentPage || subSegmentsSelected.length === 0;

  const subSegments = isSegmentPage ? (activeData.SUB_SEGMENTS?.[page] ?? []) : [];
  const selectedMonthNums = filter.months;
  const isFiltered = filter.quarter !== 'all' || filter.months.length > 0 || subSegmentsSelected.length > 0 || category !== 'Before Elim';

  const ebitdaLabel = category === 'After Elim'
    ? 'Adj. EBITDA'
    : (isSegmentPage && !isRetail ? ebitdaVariant : 'Adj. EBITDA');
  const ebitLabel = category === 'After Elim' ? 'Adj. EBIT' : ebitVariant;

  // KPI field configs per page
  const kpiFields = useMemo(() => {
    if (!isSegmentPage) {
      return [
        { key: 'revenue', label: 'Revenue', actual: 'Revenue', vsBudget: 'RevenueVsBudget', diff: 'RevenueDiff', ytd: 'RevenueYTDVsBudget' },
        { key: 'ebitda', label: ebitdaLabel, actual: 'EBITDA', vsBudget: 'EBITDAVsBudget', diff: 'EBITDADiff', ytd: 'EBITDAYTDVsBudget' },
        { key: 'netIncome', label: 'Net Income', actual: 'NetIncome', vsBudget: 'NetIncomeVsBudget', diff: 'NetIncomeDiff', ytd: 'NetIncomeYTDVsBudget' },
      ];
    }
    if (isCorporate) {
      return [
        { key: 'cm', label: 'CM', actual: 'CM', vsBudget: 'CMVsBudget', diff: 'CMDiff', ytd: 'CMYTDVsBudget' },
        { key: 'ebitda', label: ebitdaLabel, actual: 'EBITDA', vsBudget: 'EBITDAVsBudget', diff: 'EBITDADiff', ytd: 'EBITDAYTDVsBudget' },
        { key: 'netIncome', label: 'Net Income', actual: 'NetIncome', vsBudget: 'NetIncomeVsBudget', diff: 'NetIncomeDiff', ytd: 'NetIncomeYTDVsBudget' },
      ];
    }
    if (isRetail) {
      return [
        { key: 'revenue', label: 'Revenue', actual: 'Revenue', vsBudget: 'RevenueVsBudget', diff: 'RevenueDiff', ytd: 'RevenueYTDVsBudget' },
        { key: 'cm', label: 'CM', actual: 'CM', vsBudget: 'CMVsBudget', diff: 'CMDiff', ytd: 'CMYTDVsBudget' },
        { key: 'ebit', label: ebitLabel, actual: 'EBIT', vsBudget: 'EBITVsBudget', diff: 'EBITDiff', ytd: 'EBITYTDVsBudget' },
      ];
    }
    return [
      { key: 'revenue', label: 'Revenue', actual: 'Revenue', vsBudget: 'RevenueVsBudget', diff: 'RevenueDiff', ytd: 'RevenueYTDVsBudget' },
      { key: 'cm', label: 'CM', actual: 'CM', vsBudget: 'CMVsBudget', diff: 'CMDiff', ytd: 'CMYTDVsBudget' },
      { key: 'ebitda', label: ebitdaLabel, actual: 'EBITDA', vsBudget: 'EBITDAVsBudget', diff: 'EBITDADiff', ytd: 'EBITDAYTDVsBudget' },
    ];
  }, [isSegmentPage, isCorporate, isRetail, ebitdaLabel, ebitLabel]);

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

  useEffect(() => {
    if (!TREND_OPTIONS.some(o => o.id === trendMetric)) {
      setTrendMetric(TREND_OPTIONS[0]?.id ?? 'ebitda');
    }
  }, [page, TREND_OPTIONS, trendMetric]);

  const pickVariantSeries = useCallback((baseByCategory, variantsByCategory) => {
    if (category === 'After Elim') {
      return asMonthlyArray(baseByCategory, 'After Elim');
    }
    // Before Elim — prefer Direct/Total variant series when applicable
    if (isRetail && variantsByCategory?.['Before Elim']?.[ebitVariant]) {
      return variantsByCategory['Before Elim'][ebitVariant];
    }
    if (isSegmentPage && !isRetail && variantsByCategory?.['Before Elim']?.[ebitdaVariant]) {
      return variantsByCategory['Before Elim'][ebitdaVariant];
    }
    if (!isSegmentPage && variantsByCategory?.['Before Elim']?.['Adj. EBITDA (Total)']) {
      return variantsByCategory['Before Elim']['Adj. EBITDA (Total)'];
    }
    return asMonthlyArray(baseByCategory, 'Before Elim');
  }, [category, isRetail, isSegmentPage, ebitVariant, ebitdaVariant]);

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
    if (page === 'consolidated') {
      return filteredSegmentAdjEbitda(
        activeData.SEGMENT_MONTHLY ?? {},
        activeData.SEGMENTS ?? ALL_SEGMENTS,
        filteredKeys,
        category,
      );
    }
    // Corporate: same visual as Consolidated Segment Performance (Adj. EBITDA by sub-segment)
    if (isCorporate && useDashboardScope) {
      const subs = activeData.SUB_SEGMENTS?.[page] ?? [];
      return subs.map(sub => {
        const rows = (activeData.SUBSEGMENT_MONTHLY?.[page]?.[sub] ?? [])
          .filter(m => filteredKeys.has(`${m.year}-${m.month}`));
        return {
          Segment: sub,
          AdjEBITDA: rows.reduce((s, m) => s + m.EBITDA, 0),
        };
      }).filter(s => s.AdjEBITDA !== 0)
        .sort((a, b) => b.AdjEBITDA - a.AdjEBITDA);
    }
    if (!useDashboardScope) {
      const series = subSegmentsSelected
        .map(sub => {
          const rows = (activeData.SUBSEGMENT_MONTHLY?.[page]?.[sub] ?? [])
            .filter(m => filteredKeys.has(`${m.year}-${m.month}`));
          return {
            Segment: sub,
            Revenue: rows.reduce((s, m) => s + m.Revenue, 0),
            EBITDA: rows.reduce((s, m) => s + m.EBITDA, 0),
            NetIncome: rows.reduce((s, m) => s + (m.NetIncome ?? 0), 0),
          };
        })
        .filter(s => s.Revenue !== 0 || s.EBITDA !== 0 || s.NetIncome !== 0)
        .sort((a, b) => b.Revenue - a.Revenue);
      return series;
    }
    return filteredSubSegmentPerformance(
      activeData.SUBSEGMENT_MONTHLY?.[page] ?? {},
      subSegments,
      filteredKeys,
    );
  }, [activeData, page, filteredKeys, subSegments, useDashboardScope, subSegmentsSelected, isCorporate, category]);

  const showConsolidatedStylePerf = page === 'consolidated' || (isCorporate && useDashboardScope);

  const perfMetrics = showConsolidatedStylePerf
    ? [{ key: 'AdjEBITDA', label: 'Adj. EBITDA', color: PERF_COLORS.EBITDA }]
    : [{ key: 'Revenue', label: 'Revenue', color: PERF_COLORS.Revenue },
       { key: 'EBITDA', label: 'Adj. EBITDA', color: PERF_COLORS.EBITDA },
       { key: 'NetIncome', label: 'Net Income', color: PERF_COLORS.NetIncome }];

  const pnlRows = useMemo(() => {
    if (!useDashboardScope) return [];
    const key = page === 'consolidated' ? 'consolidated' : page;
    const pnl = activeData.PNL?.[key]?.[category] ?? [];
    return pnl.map(line => {
      const months = line.months.filter(m => {
        if (filter.quarter !== 'all' && m.quarter !== parseInt(filter.quarter.replace('Q', ''), 10)) return false;
        if (selectedMonthNums.length > 0 && !selectedMonthNums.includes(m.monthNum)) return false;
        return true;
      });
      return {
        subcat: line.subcat,
        amount: months.reduce((s, m) => s + m.amount, 0),
      };
    });
  }, [activeData, page, category, filter, selectedMonthNums, useDashboardScope]);

  const pageTitle = page === 'consolidated' ? 'FP&A Financial Dashboard' : `${page} Segment`;
  const dataSourceLabel = isCustom && activeMeta ? activeMeta.filename : 'WIP Dashboard per 21 July 13.56.xlsx';

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
        dataStatus={dataStatus}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5 mb-5">
        {kpiFields.map(f => {
          const isEbitdaCard = f.key === 'ebitda' && showEbitdaVariant;
          const isEbitCard = f.key === 'ebit' && showEbitVariant;
          return (
            <KPICardWithDiffs
              key={f.key}
              label={f.label}
              value={kpis[f.key]}
              vsBudget={kpis[`vsBudget_${f.key}`]}
              vsPrevMonth={kpis[`vsPrev_${f.key}`]}
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
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
              {page === 'consolidated' ? 'Segment Performance' : (isCorporate && useDashboardScope ? 'Sub-Segment Performance' : 'Sub-Segment Performance')}
            </h3>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
              {showConsolidatedStylePerf
                ? (page === 'consolidated' ? 'Adj. EBITDA by segment' : 'Adj. EBITDA by sub-segment')
                : `Revenue · Adj. EBITDA · Net Income`}
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
                        <Cell key={i} fill={
                          page === 'consolidated'
                            ? (SEGMENT_COLORS[row.Segment] ?? PERF_COLORS.EBITDA)
                            : (SUB_SEGMENT_PALETTE[i % SUB_SEGMENT_PALETTE.length])
                        } />
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
          {page === 'consolidated' && performanceData.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--border-default)] flex flex-wrap gap-x-4 gap-y-2">
              {ALL_SEGMENTS.map(seg => (
                <div key={seg} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: SEGMENT_COLORS[seg] }} />
                  <span className="text-[11px] text-[var(--text-faint)]">{seg}</span>
                </div>
              ))}
            </div>
          )}
          {isCorporate && useDashboardScope && performanceData.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--border-default)] flex flex-wrap gap-x-4 gap-y-2">
              {performanceData.map((row, i) => (
                <div key={row.Segment} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: SUB_SEGMENT_PALETTE[i % SUB_SEGMENT_PALETTE.length] }} />
                  <span className="text-[11px] text-[var(--text-faint)]">{row.Segment}</span>
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

      <PnLBox rows={pnlRows} />

      <footer className="mt-8 flex flex-col sm:flex-row justify-between items-center gap-2 text-[11px] text-[var(--text-very-faint)]">
        <span>Source: {dataSourceLabel} · Values in IDR</span>
        <span>{new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
      </footer>
    </div>
  );
}
