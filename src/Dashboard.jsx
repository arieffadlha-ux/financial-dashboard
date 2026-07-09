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
          months: result.MONTHLY.length,
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
    reader.onerror = () => { setUploadError('Gagal membaca file'); setUploading(false); };
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
  if (abs >= 1e6)  return `${sign}${pfx}${(abs / 1e6).toFixed(1)}Jt`;
  return `${sign}${pfx}${abs.toLocaleString('id-ID')}`;
};

const idrCompact = (v) => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}Rp ${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}Rp ${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${sign}Rp ${(abs / 1e6).toFixed(0)}Jt`;
  return `${sign}Rp ${abs.toLocaleString('id-ID')}`;
};

const diffFmt = (v) => {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${idrCompact(v)}`;
};

const monthLabel = (m) =>
  new Date(`${m.date}T12:00:00`).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });

const relativeDate = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} jam lalu`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};

const MONTHS_ID = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
];
const SEG_COLORS = ['#3b82f6','#6366f1','#8b5cf6','#06b6d4','#64748b'];
const PERF_COLORS = { Revenue: '#3b82f6', EBITDA: '#10b981', NetIncome: '#f59e0b' };

const PAGES = [
  { id: 'consolidated', label: 'Ringkasan' },
  ...ALL_SEGMENTS.map(s => ({ id: s, label: s })),
];

/* ─── Data helpers ──────────────────────────────────────────────────── */
function filterMonthly(monthly, filter) {
  return monthly.filter(m => {
    if (filter.quarter !== 'all' && m.quarter !== parseInt(filter.quarter.replace('Q', ''), 10)) return false;
    if (filter.month !== 'all' && m.monthNum !== parseInt(filter.month, 10)) return false;
    return true;
  });
}

function computePeriodKPIs(filtered) {
  const last = filtered[filtered.length - 1];
  return {
    revenue: filtered.reduce((s, m) => s + m.Revenue, 0),
    ebitda: filtered.reduce((s, m) => s + m.EBITDA, 0),
    netIncome: filtered.reduce((s, m) => s + m.NetIncome, 0),
    vsBudget: {
      revenue: filtered.reduce((s, m) => s + m.RevenueVsBudget, 0),
      ebitda: filtered.reduce((s, m) => s + m.EBITDAVsBudget, 0),
      netIncome: filtered.reduce((s, m) => s + m.NetIncomeVsBudget, 0),
    },
    vsPrevMonth: last ? {
      revenue: last.RevenueDiff,
      ebitda: last.EBITDADiff,
      netIncome: last.NetIncomeDiff,
    } : { revenue: null, ebitda: null, netIncome: null },
    vsYtdBudget: last ? {
      revenue: last.RevenueYTDVsBudget,
      ebitda: last.EBITDAYTDVsBudget,
      netIncome: last.NetIncomeYTDVsBudget,
    } : { revenue: null, ebitda: null, netIncome: null },
  };
}

function filteredSegmentPerformance(segmentMonthly, segments, filteredKeys, ebitdaKey = 'EBITDA') {
  return segments.map(seg => {
    const rows = (segmentMonthly[seg] ?? []).filter(m => filteredKeys.has(`${m.year}-${m.month}`));
    return {
      Segment: seg,
      Revenue: rows.reduce((s, m) => s + m.Revenue, 0),
      [ebitdaKey]: rows.reduce((s, m) => s + m.EBITDA, 0),
      NetIncome: rows.reduce((s, m) => s + m.NetIncome, 0),
    };
  }).sort((a, b) => b.Revenue - a.Revenue);
}

function filteredSubSegmentPerformance(subSegMonthly, subSegments, filteredKeys) {
  return subSegments.map(sub => {
    const rows = (subSegMonthly[sub] ?? []).filter(m => filteredKeys.has(`${m.year}-${m.month}`));
    return {
      Segment: sub,
      Revenue: rows.reduce((s, m) => s + m.Revenue, 0),
      EBITDA: rows.reduce((s, m) => s + m.EBITDA, 0),
      NetIncome: rows.reduce((s, m) => s + m.NetIncome, 0),
    };
  }).filter(s => s.Revenue !== 0 || s.EBITDA !== 0 || s.NetIncome !== 0)
    .sort((a, b) => b.Revenue - a.Revenue);
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
  const { activeId, index, isCustom, uploading, uploadError, uploadCSV, switchDataset, removeDataset, dismissError } = useDataCtx();
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
              {uploading ? 'Memproses...' : 'Upload CSV'}
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
              <p className="text-sm font-medium text-blue-400">Lepas file CSV di sini</p>
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

function FilterBar({ quarter, month, onChange, onReset, isActive, subSegment, subSegments, onSubSegmentChange, showSubSegment }) {
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
          <Pill key={q} active={quarter === q} onClick={() => onChange({ quarter: q, month: 'all' })}>
            {q === 'all' ? 'All Q' : q}
          </Pill>
        ))}
      </div>
      <div className="h-4 w-px bg-[var(--border-default)]" />
      <div className="relative">
        <select value={month} onChange={e => onChange({ quarter, month: e.target.value })}
          className="pl-3 pr-7 py-1.5 bg-[var(--surface-elevated)] text-[var(--text-muted)] text-xs rounded-lg border-0 outline-none focus:ring-1 focus:ring-blue-600 cursor-pointer appearance-none">
          <option value="all">Semua Bulan</option>
          {MONTHS_ID.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
      </div>
      {showSubSegment && (
        <>
          <div className="h-4 w-px bg-[var(--border-default)]" />
          <div className="relative">
            <select value={subSegment} onChange={e => onSubSegmentChange(e.target.value)}
              className="pl-3 pr-7 py-1.5 bg-[var(--surface-elevated)] text-[var(--text-muted)] text-xs rounded-lg border-0 outline-none focus:ring-1 focus:ring-blue-600 cursor-pointer appearance-none min-w-[160px]">
              <option value="all">Semua Sub-Segment</option>
              {subSegments.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </>
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

function KPICardWithDiffs({ label, value, vsBudget, vsPrevMonth, vsYtdBudget }) {
  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-5 card-shadow hover:border-[var(--border-hover)] transition-all">
      <p className="text-[11px] uppercase tracking-widest text-[var(--text-faint)] font-medium mb-3">{label}</p>
      <p className="text-[1.6rem] font-semibold leading-none text-[var(--text-primary)] tabular mb-3">{idr(value)}</p>
      <div className="flex flex-wrap gap-1.5">
        <DiffPill label="vs Budget" value={vsBudget} />
        <DiffPill label="vs Bulan Lalu" value={vsPrevMonth} />
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
  const [subSegment, setSubSegment] = useState('all');
  const [filter, setFilter] = useState({ quarter: 'all', month: 'all' });
  const [chartType, setChartType] = useState('area');

  const isSegmentPage = page !== 'consolidated';
  const ebitdaLabel = isSegmentPage ? 'EBITDA' : 'Adj. EBITDA';
  const subSegments = isSegmentPage ? (activeData.SUB_SEGMENTS?.[page] ?? []) : [];

  useEffect(() => { setSubSegment('all'); }, [page]);

  const sourceMonthly = useMemo(() => {
    if (page === 'consolidated') return activeData.MONTHLY ?? [];
    const segData = activeData.SUBSEGMENT_MONTHLY?.[page];
    if (!segData) return [];
    if (subSegment === 'all') return segData._all ?? [];
    return segData[subSegment] ?? [];
  }, [activeData, page, subSegment]);

  const filteredMonthly = useMemo(() => filterMonthly(sourceMonthly, filter), [sourceMonthly, filter]);
  const filteredKeys = useMemo(() => new Set(filteredMonthly.map(m => `${m.year}-${m.month}`)), [filteredMonthly]);
  const isFiltered = filter.quarter !== 'all' || filter.month !== 'all';

  const kpis = useMemo(() => computePeriodKPIs(filteredMonthly), [filteredMonthly]);

  const trendChart = useMemo(() => filteredMonthly.map(m => ({
    label: monthLabel(m),
    EBITDA: m.EBITDA,
    Budget: m.EBITDABudget,
    tag: m.tag,
  })), [filteredMonthly]);

  const performanceData = useMemo(() => {
    if (page === 'consolidated') {
      return filteredSegmentPerformance(
        activeData.SEGMENT_MONTHLY ?? {},
        activeData.SEGMENTS ?? ALL_SEGMENTS,
        filteredKeys,
        'AdjEBITDA',
      );
    }
    if (subSegment !== 'all') {
      const rows = (activeData.SUBSEGMENT_MONTHLY?.[page]?.[subSegment] ?? [])
        .filter(m => filteredKeys.has(`${m.year}-${m.month}`));
      return [{
        Segment: subSegment,
        Revenue: rows.reduce((s, m) => s + m.Revenue, 0),
        EBITDA: rows.reduce((s, m) => s + m.EBITDA, 0),
        NetIncome: rows.reduce((s, m) => s + m.NetIncome, 0),
      }];
    }
    return filteredSubSegmentPerformance(
      activeData.SUBSEGMENT_MONTHLY?.[page] ?? {},
      subSegments,
      filteredKeys,
    );
  }, [activeData, page, filteredKeys, subSegments, subSegment]);

  const perfMetrics = page === 'consolidated'
    ? [{ key: 'Revenue', label: 'Revenue', color: PERF_COLORS.Revenue },
       { key: 'AdjEBITDA', label: 'Adj. EBITDA', color: PERF_COLORS.EBITDA },
       { key: 'NetIncome', label: 'Net Income', color: PERF_COLORS.NetIncome }]
    : [{ key: 'Revenue', label: 'Revenue', color: PERF_COLORS.Revenue },
       { key: 'EBITDA', label: 'EBITDA', color: PERF_COLORS.EBITDA },
       { key: 'NetIncome', label: 'Net Income', color: PERF_COLORS.NetIncome }];

  const pageTitle = page === 'consolidated' ? 'Ringkasan Keuangan' : `Segment ${page}`;
  const dataSourceLabel = isCustom && activeMeta ? activeMeta.filename : 'cleaned_data(1) (2).csv';

  return (
    <div className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)] px-4 py-6 md:px-8 md:py-8 font-sans">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-5">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-[var(--text-very-faint)] mb-1.5">Executive Dashboard</p>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">{pageTitle}</h1>
          <p className="text-[var(--text-faint)] text-sm mt-1">FY 2026 · Actual / Run-rate / Forecast</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <DataManager />
          <ThemeToggle />
        </div>
      </header>

      <PageNav page={page} onChange={setPage} />

      <FilterBar
        quarter={filter.quarter} month={filter.month}
        onChange={f => setFilter(prev => ({ ...prev, ...f }))}
        onReset={() => setFilter({ quarter: 'all', month: 'all' })}
        isActive={isFiltered}
        showSubSegment={isSegmentPage}
        subSegment={subSegment}
        subSegments={subSegments}
        onSubSegmentChange={setSubSegment}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5 mb-5">
        <KPICardWithDiffs label="Revenue" value={kpis.revenue}
          vsBudget={kpis.vsBudget.revenue} vsPrevMonth={kpis.vsPrevMonth.revenue} vsYtdBudget={kpis.vsYtdBudget.revenue} />
        <KPICardWithDiffs label={ebitdaLabel} value={kpis.ebitda}
          vsBudget={kpis.vsBudget.ebitda} vsPrevMonth={kpis.vsPrevMonth.ebitda} vsYtdBudget={kpis.vsYtdBudget.ebitda} />
        <KPICardWithDiffs label="Net Income" value={kpis.netIncome}
          vsBudget={kpis.vsBudget.netIncome} vsPrevMonth={kpis.vsPrevMonth.netIncome} vsYtdBudget={kpis.vsYtdBudget.netIncome} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        {/* Trend: Adj EBITDA vs Budget */}
        <div className="lg:col-span-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 card-shadow">
          <div className="flex justify-between items-start mb-5">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Tren {ebitdaLabel} vs Budget</h3>
              <p className="text-[11px] text-[var(--text-faint)] mt-0.5">Tren bulanan · IDR</p>
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
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'area' ? (
                <AreaChart data={trendChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradEBIT" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
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
                  <Area type="monotone" dataKey="EBITDA" name={ebitdaLabel} stroke="#10b981" strokeWidth={2}
                    fill="url(#gradEBIT)" dot={{ fill: '#10b981', r: 3, strokeWidth: 0 }} />
                  <Area type="monotone" dataKey="Budget" name="Budget" stroke="#f59e0b" strokeWidth={1.5}
                    fill="url(#gradBudget)" strokeDasharray="5 4" dot={{ fill: '#f59e0b', r: 2.5, strokeWidth: 0 }} />
                </AreaChart>
              ) : (
                <BarChart data={trendChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="2 4" stroke={c.grid} vertical={false} />
                  <XAxis dataKey="label" stroke={c.axis} tick={{ fill: c.tick, fontSize: 11 }} tickLine={false} axisLine={{ stroke: c.axis }} />
                  <YAxis stroke={c.axis} tick={{ fill: c.tick, fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={v => idr(v, { axis: true })} width={72} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: c.cursor, opacity: 0.4 }} />
                  <ReferenceLine y={0} stroke={c.refLine} strokeDasharray="4 4" />
                  <Bar dataKey="EBITDA" name={ebitdaLabel} fill="#10b981" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={24} />
                  <Bar dataKey="Budget" name="Budget" fill="#f59e0b" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={24} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
          <div className="flex gap-5 mt-3 pt-3 border-t border-[var(--border-default)]">
            <div className="flex items-center gap-2">
              <div className="w-5 h-[2px] bg-emerald-500 rounded" />
              <span className="text-[11px] text-[var(--text-faint)]">{ebitdaLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 border-b-2 border-dashed border-amber-500" />
              <span className="text-[11px] text-[var(--text-faint)]">Budget</span>
            </div>
          </div>
        </div>

        {/* Performance Segment */}
        <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 card-shadow">
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {page === 'consolidated' ? 'Performance Segment' : 'Performance Sub-Segment'}
            </h3>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">Revenue · {ebitdaLabel} · Net Income</p>
          </div>
          {performanceData.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-[var(--text-very-faint)] text-sm">Tidak ada data</div>
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
                  {perfMetrics.map(m => (
                    <Bar key={m.key} dataKey={m.key} name={m.label} fill={m.color} fillOpacity={0.85} radius={[2, 2, 0, 0]} maxBarSize={14} />
                  ))}
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Monthly Detail Table */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 mb-5 card-shadow">
        <div className="flex justify-between items-center mb-5">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Detail Bulanan</h3>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
              {filteredMonthly.length} periode · Revenue, {ebitdaLabel}, Net Income
            </p>
          </div>
          {isFiltered && <span className="text-[11px] text-blue-500 bg-blue-400/10 px-2.5 py-1 rounded-lg">Filter aktif</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-default)]">
                {['Periode', 'Tag', 'Revenue', ebitdaLabel, 'Net Income'].map((h, i) => (
                  <th key={h} className={`py-2.5 text-[11px] uppercase tracking-wider text-[var(--text-very-faint)] font-medium ${i === 0 ? 'text-left pr-3' : 'text-right pr-3 last:pr-0'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredMonthly.length === 0 ? (
                <tr><td colSpan={5} className="py-10 text-center text-[var(--text-very-faint)]">Tidak ada data untuk periode yang dipilih</td></tr>
              ) : filteredMonthly.map((row, i) => (
                <tr key={i} className="border-b border-[var(--border-faint)] hover:bg-[var(--surface-elevated)] transition-colors">
                  <td className="py-2.5 pr-3 text-[var(--text-tertiary)] font-medium whitespace-nowrap">
                    {new Date(`${row.date}T12:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
                  </td>
                  <td className="py-2.5 pr-3 text-right">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-elevated)] text-[var(--text-faint)]">{row.tag}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-right text-[var(--text-secondary)] tabular">{idrCompact(row.Revenue)}</td>
                  <td className={`py-2.5 pr-3 text-right tabular font-medium ${row.EBITDA >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{idrCompact(row.EBITDA)}</td>
                  <td className={`py-2.5 text-right tabular font-medium ${row.NetIncome >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{idrCompact(row.NetIncome)}</td>
                </tr>
              ))}
            </tbody>
            {filteredMonthly.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-[var(--border-default)]">
                  <td className="py-2.5 pr-3 font-semibold text-xs uppercase">Total</td>
                  <td />
                  <td className="py-2.5 pr-3 text-right font-semibold tabular">{idrCompact(kpis.revenue)}</td>
                  <td className={`py-2.5 pr-3 text-right font-semibold tabular ${kpis.ebitda >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{idrCompact(kpis.ebitda)}</td>
                  <td className={`py-2.5 text-right font-semibold tabular ${kpis.netIncome >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{idrCompact(kpis.netIncome)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <footer className="mt-8 flex flex-col sm:flex-row justify-between items-center gap-2 text-[11px] text-[var(--text-very-faint)]">
        <span>Sumber: {dataSourceLabel} · Nilai dalam IDR</span>
        <span>{new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
      </footer>
    </div>
  );
}
