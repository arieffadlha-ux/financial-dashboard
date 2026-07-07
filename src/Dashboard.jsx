import { useState, useMemo, createContext, useContext, useLayoutEffect, useCallback, useRef, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine,
} from 'recharts';
import * as DEFAULT_DATA from './data.js';
import { processCSV } from './dataProcessor.js';

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

/* ─── Data library (multi-dataset) ──────────────────────────────────── */
// Storage layout:
//   fd-index          → JSON array of { id, filename, uploadedAt, months, revenue }
//   fd-dataset-{id}   → full parsed JSON for that file
//   fd-active-id      → id of active dataset ('default' or numeric string)

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
  const [activeId, setActiveId] = useState(
    () => localStorage.getItem(ACTIVE_KEY) ?? 'default'
  );
  const [uploading, setUploading]   = useState(false);
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
  const isCustom   = activeId !== 'default';

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
  const abs  = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const pfx  = axis ? '' : 'Rp ';
  if (abs >= 1e12) return `${sign}${pfx}${(abs / 1e12).toFixed(3)}T`;
  if (abs >= 1e9)  return `${sign}${pfx}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${sign}${pfx}${(abs / 1e6).toFixed(1)}Jt`;
  return `${sign}${pfx}${abs.toLocaleString('id-ID')}`;
};

const idrCompact = (v) => {
  if (v == null) return '—';
  const abs  = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}Rp ${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}Rp ${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${sign}Rp ${(abs / 1e6).toFixed(0)}Jt`;
  return `${sign}Rp ${abs.toLocaleString('id-ID')}`;
};

const pct = (v, dec = 1) => v == null ? '—' : `${(v * 100).toFixed(dec)}%`;

const monthLabel = (m) =>
  new Date(`${m.date}T12:00:00`).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });

const relativeDate = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'baru saja';
  if (mins < 60)  return `${mins} menit lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs} jam lalu`;
  const days = Math.floor(hrs / 24);
  if (days < 30)  return `${days} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};

/* ─── Constants ─────────────────────────────────────────────────────── */
const MONTHS_ID = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
];
const SEG_COLORS = ['#3b82f6','#6366f1','#8b5cf6','#06b6d4','#64748b'];

/* ─── Theme Toggle ──────────────────────────────────────────────────── */
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex items-center gap-2 px-3.5 py-2 bg-[var(--surface-card)] border border-[var(--border-default)]
                 rounded-xl hover:border-[var(--border-hover)] transition-all duration-150 cursor-pointer"
    >
      {theme === 'dark' ? (
        <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
      <span className="text-xs font-medium text-[var(--text-muted)]">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}

/* ─── Data Manager ───────────────────────────────────────────────────── */
function DataManager() {
  const { activeId, activeMeta, index, isCustom, uploading, uploadError,
          uploadCSV, switchDataset, removeDataset, dismissError } = useDataCtx();

  const [open, setOpen]     = useState(false);
  const [dragging, setDragging] = useState(false);
  const panelRef  = useRef(null);
  const inputRef  = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handle = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const handleFile = (file) => {
    if (!file || !file.name.toLowerCase().endsWith('.csv')) return;
    uploadCSV(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const totalDatasets = index.length; // excludes default

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3.5 py-2 border rounded-xl transition-all duration-150 cursor-pointer
          ${open
            ? 'bg-blue-600 border-blue-600 text-white'
            : 'bg-[var(--surface-card)] border-[var(--border-default)] hover:border-[var(--border-hover)]'}`}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span className={`text-xs font-medium ${open ? 'text-white' : 'text-[var(--text-muted)]'}`}>
          Data Library
        </span>
        {totalDatasets > 0 && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full
            ${open ? 'bg-white/20 text-white' : 'bg-blue-500/20 text-blue-400'}`}>
            {totalDatasets}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-50 w-[360px]
                     bg-[var(--surface-card)] border border-[var(--border-default)]
                     rounded-2xl shadow-2xl overflow-hidden"
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--border-default)]">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Data Library</p>
              <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                {totalDatasets === 0 ? 'Belum ada file diupload' : `${totalDatasets} file tersimpan`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="/sample_financial_data.csv"
                download="sample_financial_data.csv"
                title="Download contoh CSV"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium
                           text-[var(--text-faint)] hover:text-[var(--text-muted)]
                           bg-[var(--surface-elevated)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Contoh CSV
              </a>
              <button
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium
                           bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                {uploading ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Memproses...
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Upload CSV
                  </>
                )}
              </button>
              <input ref={inputRef} type="file" accept=".csv" className="hidden"
                     onChange={e => { handleFile(e.target.files[0]); e.target.value = ''; }} />
            </div>
          </div>

          {/* Error banner */}
          {uploadError && (
            <div className="flex items-start gap-2 px-4 py-3 bg-red-500/10 border-b border-red-500/20">
              <svg className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01" strokeLinecap="round"/>
              </svg>
              <p className="text-[11px] text-red-400 flex-1">{uploadError}</p>
              <button onClick={dismissError} className="text-red-400 hover:text-red-300 cursor-pointer">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          )}

          {/* Drag overlay hint */}
          {dragging && (
            <div className="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-2xl z-10 flex items-center justify-center pointer-events-none">
              <p className="text-sm font-medium text-blue-400">Lepas file CSV di sini</p>
            </div>
          )}

          {/* Dataset list */}
          <div className="max-h-[380px] overflow-y-auto">

            {/* Default entry */}
            <DatasetRow
              id="default"
              filename="Default Data"
              subtitle="Built-in · cleaned_financial_data.csv"
              months={DEFAULT_DATA.MONTHLY.length}
              revenue={DEFAULT_DATA.KPIS.revenue}
              isActive={activeId === 'default'}
              onSelect={() => { switchDataset('default'); setOpen(false); }}
              onDelete={null}
            />

            {/* Uploaded datasets — newest first */}
            {[...index].reverse().map((entry) => (
              <DatasetRow
                key={entry.id}
                id={entry.id}
                filename={entry.filename}
                subtitle={relativeDate(entry.uploadedAt)}
                months={entry.months}
                revenue={entry.revenue}
                isActive={activeId === entry.id}
                onSelect={() => { switchDataset(entry.id); setOpen(false); }}
                onDelete={() => removeDataset(entry.id)}
              />
            ))}

            {index.length === 0 && (
              <div className="px-4 py-8 text-center">
                <svg className="w-8 h-8 text-[var(--text-very-faint)] mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p className="text-xs text-[var(--text-faint)] mb-1">Belum ada file diupload</p>
                <p className="text-[11px] text-[var(--text-very-faint)]">Upload CSV untuk mengganti data dashboard</p>
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2.5 border-t border-[var(--border-default)] bg-[var(--surface-elevated)]">
            <p className="text-[10px] text-[var(--text-very-faint)]">
              Data tersimpan di browser · Drag & drop CSV ke panel ini
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function DatasetRow({ filename, subtitle, months, revenue, isActive, onSelect, onDelete }) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 border-b border-[var(--border-faint)] cursor-pointer
                  hover:bg-[var(--surface-elevated)] transition-colors group
                  ${isActive ? 'bg-blue-500/5' : ''}`}
      onClick={onSelect}
    >
      {/* Active indicator */}
      <div className={`w-2 h-2 rounded-full shrink-0 transition-all
        ${isActive ? 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.6)]' : 'bg-[var(--border-default)] group-hover:bg-[var(--border-hover)]'}`}
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${isActive ? 'text-blue-400' : 'text-[var(--text-secondary)]'}`}>
          {filename}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-[var(--text-very-faint)]">{subtitle}</span>
          {months > 0 && (
            <>
              <span className="text-[var(--border-default)]">·</span>
              <span className="text-[10px] text-[var(--text-very-faint)]">{months} bulan</span>
            </>
          )}
          {revenue > 0 && (
            <>
              <span className="text-[var(--border-default)]">·</span>
              <span className="text-[10px] text-[var(--text-very-faint)] tabular">{idrCompact(revenue)}</span>
            </>
          )}
        </div>
      </div>

      {/* Active badge */}
      {isActive && (
        <span className="text-[10px] font-medium text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-md shrink-0">
          Aktif
        </span>
      )}

      {/* Delete button */}
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Hapus dataset ini"
          className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-6 h-6 rounded-lg
                     text-[var(--text-faint)] hover:text-red-400 hover:bg-red-400/10
                     transition-all duration-150 cursor-pointer shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ─── Sub-components ────────────────────────────────────────────────── */
function FilterBar({ year, quarter, month, onChange, onReset, isActive }) {
  const Pill = ({ active, onClick, children }) => (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer
        ${active
          ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(59,130,246,0.3)]'
          : 'bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'}`}
    >
      {children}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl card-shadow">
      <span className="text-[11px] uppercase tracking-widest text-[var(--text-very-faint)] font-medium">Periode</span>
      <div className="flex gap-1.5">
        {['all','2025','2026'].map(y => (
          <Pill key={y} active={year === y} onClick={() => onChange({ year: y, quarter: 'all', month: 'all' })}>
            {y === 'all' ? 'Semua Tahun' : y}
          </Pill>
        ))}
      </div>
      <div className="h-4 w-px bg-[var(--border-default)]" />
      <div className="flex gap-1.5">
        {['all','Q1','Q2','Q3','Q4'].map(q => (
          <Pill key={q} active={quarter === q} onClick={() => onChange({ year, quarter: q, month: 'all' })}>
            {q === 'all' ? 'All Q' : q}
          </Pill>
        ))}
      </div>
      <div className="h-4 w-px bg-[var(--border-default)]" />
      <div className="relative">
        <select
          value={month}
          onChange={e => onChange({ year, quarter, month: e.target.value })}
          className="pl-3 pr-7 py-1.5 bg-[var(--surface-elevated)] text-[var(--text-muted)] text-xs rounded-lg border-0
                     outline-none focus:ring-1 focus:ring-blue-600 cursor-pointer hover:text-[var(--text-primary)] transition-colors appearance-none"
        >
          <option value="all">Semua Bulan</option>
          {MONTHS_ID.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-faint)] w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {isActive && (
        <button onClick={onReset} className="ml-auto flex items-center gap-1.5 text-xs text-[var(--text-faint)] hover:text-[var(--text-tertiary)] transition-colors cursor-pointer">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Reset Filter
        </button>
      )}
    </div>
  );
}

function KPICard({ label, value, badge, badgeClass, sub, dimmed = false }) {
  return (
    <div className={`bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-5 card-shadow
                     hover:border-[var(--border-hover)] transition-all duration-200 ${dimmed ? 'opacity-50' : ''}`}>
      <p className="text-[11px] uppercase tracking-widest text-[var(--text-faint)] font-medium mb-3">{label}</p>
      <p className="text-[1.6rem] font-semibold leading-none text-[var(--text-primary)] tabular mb-2.5"
         style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      <div className="flex items-center gap-2 flex-wrap">
        {badge && <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${badgeClass}`}>{badge}</span>}
        {sub    && <span className="text-[11px] text-[var(--text-very-faint)]">{sub}</span>}
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent = false }) {
  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 card-shadow">
      <p className="text-[11px] text-[var(--text-very-faint)] mb-1 uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-semibold tabular ${accent ? 'text-blue-500' : 'text-[var(--text-secondary)]'}`}
         style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
    </div>
  );
}

function RatioCell({ label, value, status = 'neutral', note }) {
  const color = { good: 'text-emerald-500', warn: 'text-amber-500', bad: 'text-red-500', neutral: 'text-[var(--text-secondary)]' }[status];
  return (
    <div className="bg-[var(--surface-elevated)] rounded-xl p-3.5">
      <p className="text-[11px] text-[var(--text-faint)] mb-1.5 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-semibold tabular ${color}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {note && <p className="text-[11px] text-[var(--text-very-faint)] mt-1">{note}</p>}
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
          <span className="text-[11px] text-[var(--text-muted)]">{p.dataKey}</span>
          <span className="text-xs font-semibold text-[var(--text-primary)] ml-auto pl-4 tabular"
                style={{ fontVariantNumeric: 'tabular-nums' }}>{idr(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function SegmentTooltip({ active, payload, totalRevenue }) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 shadow-xl">
      <p className="text-[11px] text-[var(--text-faint)] mb-1.5">{payload[0].payload.Segment}</p>
      <p className="text-sm font-semibold text-[var(--text-primary)] tabular" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {idrCompact(val)}
      </p>
      {totalRevenue > 0 && (
        <p className="text-[11px] text-[var(--text-faint)] mt-1">{pct(val / totalRevenue)} dari total</p>
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

  const { MONTHLY, SEGMENT_MONTHLY, OPEX_CATEGORIES, KPIS, SEGMENT_TOTALS } = activeData;

  const [filter, setFilter]       = useState({ year: 'all', quarter: 'all', month: 'all' });
  const [chartType, setChartType] = useState('area');
  const isFiltered = filter.year !== 'all' || filter.quarter !== 'all' || filter.month !== 'all';

  /* ── Filtered monthly rows ──────────────────────────────────────── */
  const filteredMonthly = useMemo(() => {
    return MONTHLY.filter(m => {
      if (filter.year    !== 'all' && m.year    !== parseInt(filter.year))                     return false;
      if (filter.quarter !== 'all' && m.quarter !== parseInt(filter.quarter.replace('Q', ''))) return false;
      if (filter.month   !== 'all' && m.monthNum !== parseInt(filter.month))                   return false;
      return true;
    });
  }, [MONTHLY, filter]);

  /* ── KPIs ───────────────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    if (filteredMonthly.length === 0) return { revenue: 0, grossMargin: 0, ebitda: 0, sm: 0, ga: 0 };
    return {
      revenue:     filteredMonthly.reduce((s, m) => s + m.Revenue, 0),
      grossMargin: filteredMonthly.reduce((s, m) => s + m.GP,      0),
      ebitda:      filteredMonthly.reduce((s, m) => s + m.EBITDA,  0),
      sm:          filteredMonthly.reduce((s, m) => s + m.SM,      0),
      ga:          filteredMonthly.reduce((s, m) => s + m.GA,      0),
    };
  }, [filteredMonthly]);

  /* ── Filtered period key set ────────────────────────────────────── */
  const filteredKeys = useMemo(
    () => new Set(filteredMonthly.map(m => `${m.year}-${m.month}`)),
    [filteredMonthly]
  );

  /* ── Segment totals for filtered period ─────────────────────────── */
  const filteredSegments = useMemo(() => {
    const map = {};
    SEGMENT_MONTHLY.forEach(sm => {
      if (!filteredKeys.has(`${sm.year}-${sm.month}`)) return;
      map[sm.segment] = (map[sm.segment] ?? 0) + sm.Revenue;
    });
    return Object.entries(map)
      .map(([Segment, Amount]) => ({ Segment, Amount: Math.round(Amount) }))
      .filter(s => s.Amount > 0)
      .sort((a, b) => b.Amount - a.Amount);
  }, [SEGMENT_MONTHLY, filteredKeys]);

  /* ── OpEx for filtered period ───────────────────────────────────── */
  const filteredOpex = useMemo(() => {
    return OPEX_CATEGORIES.map(cat => ({
      label: cat.label,
      Amount: Object.entries(cat.monthly)
        .filter(([k]) => filteredKeys.has(k))
        .reduce((s, [, v]) => s + v, 0),
    }))
    .filter(cat => cat.Amount < 0)
    .sort((a, b) => a.Amount - b.Amount)
    .slice(0, 5);
  }, [OPEX_CATEGORIES, filteredKeys]);

  /* ── Derived values ─────────────────────────────────────────────── */
  const ebitdaMargin   = kpis.revenue > 0 ? kpis.ebitda / kpis.revenue : null;
  const grossMarginPct = kpis.revenue > 0 ? kpis.grossMargin / kpis.revenue : null;
  const opexTotal      = kpis.sm + kpis.ga;
  const opexRatio      = kpis.revenue > 0 ? Math.abs(opexTotal) / kpis.revenue : null;
  const totalFilteredOpex = filteredOpex.reduce((s, e) => s + e.Amount, 0);
  const totalSegRev    = filteredSegments.reduce((s, s2) => s + s2.Amount, 0);
  const trendChart     = filteredMonthly.map(m => ({ ...m, label: monthLabel(m) }));
  const avgRevPerMonth = filteredMonthly.length > 0 ? kpis.revenue / filteredMonthly.length : 0;

  /* ── Ratio card status ──────────────────────────────────────────── */
  const ebitdaStatus = ebitdaMargin == null ? 'neutral' : ebitdaMargin >= 0.05 ? 'good' : ebitdaMargin >= 0 ? 'warn' : 'bad';
  const gpStatus     = grossMarginPct == null ? 'neutral' : grossMarginPct >= 0.20 ? 'good' : grossMarginPct >= 0.05 ? 'warn' : 'bad';

  /* ── Audit notes ────────────────────────────────────────────────── */
  const auditNotes = [
    { text: `ADJ EBITDA total ${idrCompact(KPIS.ebitda)} — ${KPIS.ebitda < 0 ? 'negatif, terutama karena biaya G&A & S&M tinggi' : 'positif'}`, type: KPIS.ebitda < 0 ? 'bad' : 'good' },
    SEGMENT_TOTALS.length > 0 && KPIS.revenue > 0
      ? { text: `${SEGMENT_TOTALS[0].Segment} dominasi pendapatan (${pct(SEGMENT_TOTALS[0].Amount / KPIS.revenue)}) — ketergantungan satu segmen`, type: 'warn' }
      : null,
    { text: `Gross Margin ${pct(KPIS.grossMargin / KPIS.revenue)}`, type: KPIS.grossMargin / KPIS.revenue >= 0.20 ? 'good' : 'warn' },
  ].filter(Boolean);

  const dataSourceLabel = isCustom && activeMeta ? activeMeta.filename : 'cleaned_financial_data.csv';

  return (
    <div className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)] px-4 py-6 md:px-8 md:py-8 font-sans">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-7">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-[var(--text-very-faint)] mb-1.5">Executive Dashboard</p>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] leading-tight">Ringkasan Keuangan</h1>
          <p className="text-[var(--text-faint)] text-sm mt-1">FY 2025 – Q1 2026 · Analisis GL Kinerja</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <DataManager />
          <ThemeToggle />
          <div className="flex items-center gap-2.5 px-4 py-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl card-shadow">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-xs text-[var(--text-muted)] font-medium">
              {isCustom ? 'Custom Data' : 'Actuals Consolidated'}
            </span>
          </div>
        </div>
      </header>

      {/* ── Filter Bar ──────────────────────────────────────────────── */}
      <FilterBar
        year={filter.year} quarter={filter.quarter} month={filter.month}
        onChange={setFilter}
        onReset={() => setFilter({ year: 'all', quarter: 'all', month: 'all' })}
        isActive={isFiltered}
      />

      {/* ── KPI Cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5 mb-4">
        <KPICard
          label="Total Pendapatan"
          value={idr(kpis.revenue)}
          badge={`${filteredMonthly.length} titik data`}
          badgeClass={isFiltered ? 'text-amber-500 bg-amber-400/10' : 'text-emerald-500 bg-emerald-400/10'}
        />
        <KPICard
          label="Gross Profit"
          value={idr(kpis.grossMargin)}
          badge={grossMarginPct != null ? pct(grossMarginPct) + ' margin' : undefined}
          badgeClass={gpStatus === 'good' ? 'text-emerald-500 bg-emerald-400/10' : gpStatus === 'warn' ? 'text-amber-500 bg-amber-400/10' : 'text-red-500 bg-red-400/10'}
        />
        <KPICard
          label="ADJ EBITDA"
          value={idr(kpis.ebitda)}
          badge={ebitdaMargin != null ? pct(ebitdaMargin) + ' margin' : undefined}
          badgeClass={kpis.ebitda >= 0 ? 'text-emerald-500 bg-emerald-400/10' : 'text-red-500 bg-red-400/10'}
          sub={kpis.ebitda < 0 ? '⚑ ADJ EBITDA negatif pada periode ini' : undefined}
        />
      </div>

      {/* ── Mini Stats ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <MiniStat label="Total S&M"       value={idrCompact(kpis.sm)} />
        <MiniStat label="Total G&A"       value={idrCompact(kpis.ga)} />
        <MiniStat label="Rasio OpEx/Rev"  value={opexRatio != null ? pct(opexRatio) : '—'} />
        <MiniStat label="Avg Rev/Bulan"   value={idrCompact(avgRevPerMonth)} accent />
      </div>

      {/* ── Charts Row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">

        {/* Trend Chart */}
        <div className="lg:col-span-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 card-shadow">
          <div className="flex justify-between items-start mb-5">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Pendapatan vs ADJ EBITDA</h3>
              <p className="text-[11px] text-[var(--text-faint)] mt-0.5">Tren bulanan · IDR</p>
            </div>
            <div className="flex items-center gap-2">
              {isFiltered && filteredMonthly.length === 0 && (
                <span className="text-[11px] text-amber-500 bg-amber-400/10 px-2.5 py-1 rounded-lg">Tidak ada data</span>
              )}
              <div className="flex items-center bg-[var(--surface-elevated)] rounded-lg p-0.5 gap-0.5">
                <button
                  onClick={() => setChartType('area')}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all duration-150 cursor-pointer
                    ${chartType === 'area' ? 'bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <polyline points="22,12 18,12 15,21 9,3 6,12 2,12" />
                  </svg>
                  Line
                </button>
                <button
                  onClick={() => setChartType('bar')}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all duration-150 cursor-pointer
                    ${chartType === 'bar' ? 'bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="9" width="4" height="12" rx="1" />
                    <rect x="10" y="4" width="4" height="17" rx="1" />
                    <rect x="17" y="13" width="4" height="8" rx="1" />
                  </svg>
                  Bar
                </button>
              </div>
            </div>
          </div>

          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'area' ? (
                <AreaChart data={trendChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradEBIT" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke={c.grid} vertical={false} />
                  <XAxis dataKey="label" stroke={c.axis} tick={{ fill: c.tick, fontSize: 11 }} tickLine={false} axisLine={{ stroke: c.axis }} />
                  <YAxis stroke={c.axis} tick={{ fill: c.tick, fontSize: 11 }} tickLine={false} axisLine={false}
                         tickFormatter={v => idr(v, { axis: true })} width={72} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke={c.refLine} strokeDasharray="4 4" strokeWidth={1} />
                  <Area type="monotone" dataKey="Revenue" stroke="#3b82f6" strokeWidth={2}
                        fill="url(#gradRev)" dot={{ fill: '#3b82f6', r: 3, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0 }} />
                  <Area type="monotone" dataKey="EBITDA" stroke="#10b981" strokeWidth={1.5}
                        fill="url(#gradEBIT)" strokeDasharray="5 4"
                        dot={{ fill: '#10b981', r: 2.5, strokeWidth: 0 }} activeDot={{ r: 4, strokeWidth: 0 }} />
                </AreaChart>
              ) : (
                <BarChart data={trendChart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="2 4" stroke={c.grid} vertical={false} />
                  <XAxis dataKey="label" stroke={c.axis} tick={{ fill: c.tick, fontSize: 11 }} tickLine={false} axisLine={{ stroke: c.axis }} />
                  <YAxis stroke={c.axis} tick={{ fill: c.tick, fontSize: 11 }} tickLine={false} axisLine={false}
                         tickFormatter={v => idr(v, { axis: true })} width={72} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: c.cursor, opacity: 0.4 }} />
                  <ReferenceLine y={0} stroke={c.refLine} strokeDasharray="4 4" strokeWidth={1} />
                  <Bar dataKey="Revenue" fill="#3b82f6" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="EBITDA"  fill="#10b981" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          <div className="flex gap-5 mt-3 pt-3 border-t border-[var(--border-default)]">
            <div className="flex items-center gap-2">
              <div className={`w-5 shrink-0 ${chartType === 'area' ? 'h-[2px] bg-blue-500 rounded' : 'h-2.5 bg-blue-500/85 rounded-sm'}`} />
              <span className="text-[11px] text-[var(--text-faint)]">Pendapatan</span>
            </div>
            <div className="flex items-center gap-2">
              {chartType === 'area'
                ? <div className="w-5 border-b-2 border-dashed border-emerald-500" />
                : <div className="w-5 h-2.5 bg-emerald-500/85 rounded-sm" />}
              <span className="text-[11px] text-[var(--text-faint)]">ADJ EBITDA</span>
            </div>
            {trendChart.some(d => d.EBITDA < 0) && (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-[11px] text-amber-500">Ada nilai ADJ EBITDA negatif</span>
              </div>
            )}
          </div>
        </div>

        {/* Segment Chart */}
        <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 card-shadow">
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Pendapatan per Segmen</h3>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
              {isFiltered ? 'Periode terfilter · IDR' : 'Periode penuh · IDR'}
            </p>
          </div>
          {filteredSegments.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center text-[var(--text-very-faint)] text-sm">Tidak ada data</div>
          ) : (
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredSegments} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="Segment" type="category" stroke={c.axis} tick={{ fill: c.tick, fontSize: 11 }}
                         tickLine={false} axisLine={false} width={72} />
                  <Tooltip content={<SegmentTooltip totalRevenue={totalSegRev} />} cursor={{ fill: c.cursor, opacity: 0.5 }} />
                  <Bar dataKey="Amount" radius={[0, 5, 5, 0]} barSize={20}>
                    {filteredSegments.map((_, i) => (
                      <Cell key={i} fill={SEG_COLORS[i % SEG_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-[var(--border-default)] space-y-2.5">
            {filteredSegments.map((seg, i) => (
              <div key={i} className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: SEG_COLORS[i] }} />
                  <span className="text-xs text-[var(--text-muted)]">{seg.Segment}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-medium text-[var(--text-secondary)] tabular" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {idrCompact(seg.Amount)}
                  </span>
                  {totalSegRev > 0 && (
                    <span className="text-[11px] text-[var(--text-very-faint)] ml-2">{pct(seg.Amount / totalSegRev)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── OpEx + Ratios ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

        <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 card-shadow">
          <div className="flex justify-between items-start mb-5">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Beban Operasional</h3>
              <p className="text-[11px] text-[var(--text-faint)] mt-0.5">5 subkategori terbesar</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-[var(--text-secondary)] tabular" style={{ fontVariantNumeric: 'tabular-nums' }}>{idrCompact(totalFilteredOpex)}</p>
              <p className="text-[11px] text-[var(--text-faint)]">total top-5</p>
            </div>
          </div>
          <div className="space-y-4">
            {filteredOpex.length === 0 ? (
              <p className="text-[var(--text-very-faint)] text-sm text-center py-6">Tidak ada data OpEx</p>
            ) : filteredOpex.map((exp, i) => {
              const barWidth      = (Math.abs(exp.Amount) / Math.abs(filteredOpex[0].Amount)) * 100;
              const shareOfTotal  = totalFilteredOpex !== 0 ? exp.Amount / totalFilteredOpex : 0;
              const EXP_COLORS    = ['#6366f1','#818cf8','#a5b4fc','#c7d2fe','#e0e7ff'];
              return (
                <div key={i} className="group">
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="text-xs text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors truncate mr-2 max-w-[55%]">{exp.label}</span>
                    <div className="flex items-baseline gap-2 tabular shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <span className="text-xs font-medium text-[var(--text-secondary)]">{idrCompact(exp.Amount)}</span>
                      <span className="text-[11px] text-[var(--text-very-faint)]">{pct(Math.abs(shareOfTotal))}</span>
                    </div>
                  </div>
                  <div className="h-1 bg-[var(--border-default)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-300" style={{ width: `${barWidth}%`, background: EXP_COLORS[i] }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 card-shadow">
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Rasio Keuangan Utama</h3>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">{isFiltered ? 'Periode terfilter' : 'FY 2025 – Q1 2026'}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <RatioCell label="ADJ EBITDA Margin" value={ebitdaMargin != null ? pct(ebitdaMargin) : '—'} status={ebitdaStatus}
              note={ebitdaMargin != null && ebitdaMargin < 0 ? 'ADJ EBITDA negatif' : ebitdaMargin != null && ebitdaMargin < 0.05 ? 'Di bawah target' : 'Operasional kuat'} />
            <RatioCell label="Gross Margin" value={grossMarginPct != null ? pct(grossMarginPct) : '—'} status={gpStatus}
              note={gpStatus === 'bad' ? 'Perlu investigasi COGS' : gpStatus === 'warn' ? 'Di bawah rata-rata industri' : 'Sesuai target'} />
            <RatioCell label="Rasio OpEx/Rev" value={opexRatio != null ? pct(opexRatio) : '—'} status="neutral" />
            <RatioCell label="Rev per Segmen" value={filteredSegments.length > 0 ? idrCompact(totalSegRev / filteredSegments.length) : '—'} status="neutral" />
          </div>

          <div className="mt-5 pt-4 border-t border-[var(--border-default)]">
            <p className="text-[11px] uppercase tracking-widest text-[var(--text-very-faint)] font-medium mb-3">Catatan Audit Dashboard</p>
            <ul className="space-y-1.5">
              {auditNotes.map((n, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px]">
                  <span className={n.type === 'bad' ? 'text-red-500 mt-0.5' : n.type === 'good' ? 'text-emerald-500 mt-0.5' : 'text-amber-500 mt-0.5'}>
                    {n.type === 'bad' ? '⚠' : n.type === 'good' ? '✓' : '·'}
                  </span>
                  <span className="text-[var(--text-faint)]">{n.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ── Monthly Detail Table ─────────────────────────────────────── */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 mb-5 card-shadow">
        <div className="flex justify-between items-center mb-5">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Detail Bulanan</h3>
            <p className="text-[11px] text-[var(--text-faint)] mt-0.5">{filteredMonthly.length} periode · Revenue, GP, S&M, G&A, ADJ EBITDA</p>
          </div>
          {isFiltered && <span className="text-[11px] text-blue-500 bg-blue-400/10 px-2.5 py-1 rounded-lg">Filter aktif</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-default)]">
                {['Periode','Revenue','Gross Profit','S&M','G&A','ADJ EBITDA','ADJ EBITDA %'].map((h, i) => (
                  <th key={h} className={`py-2.5 text-[11px] uppercase tracking-wider text-[var(--text-very-faint)] font-medium ${i === 0 ? 'text-left pr-3' : 'text-right pr-3 last:pr-0'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredMonthly.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-[var(--text-very-faint)] text-sm">Tidak ada data untuk periode yang dipilih</td></tr>
              ) : filteredMonthly.map((row, i) => {
                const margin = row.Revenue > 0 ? row.EBITDA / row.Revenue : 0;
                return (
                  <tr key={i} className="border-b border-[var(--border-faint)] hover:bg-[var(--surface-elevated)] transition-colors duration-100">
                    <td className="py-2.5 pr-3 text-[var(--text-tertiary)] font-medium whitespace-nowrap">
                      {new Date(`${row.date}T12:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-[var(--text-secondary)] tabular" style={{ fontVariantNumeric: 'tabular-nums' }}>{idrCompact(row.Revenue)}</td>
                    <td className={`py-2.5 pr-3 text-right tabular ${row.GP >= 0 ? 'text-[var(--text-secondary)]' : 'text-red-500'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{idrCompact(row.GP)}</td>
                    <td className="py-2.5 pr-3 text-right text-[var(--text-muted)] tabular" style={{ fontVariantNumeric: 'tabular-nums' }}>{idrCompact(row.SM)}</td>
                    <td className={`py-2.5 pr-3 text-right tabular ${row.GA >= 0 ? 'text-emerald-500' : 'text-[var(--text-muted)]'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{idrCompact(row.GA)}</td>
                    <td className={`py-2.5 pr-3 text-right font-medium tabular ${row.EBITDA >= 0 ? 'text-emerald-500' : 'text-red-500'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{idrCompact(row.EBITDA)}</td>
                    <td className={`py-2.5 text-right tabular ${margin < 0 ? 'text-red-500' : 'text-[var(--text-tertiary)]'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{pct(margin)}</td>
                  </tr>
                );
              })}
            </tbody>
            {filteredMonthly.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-[var(--border-default)]">
                  <td className="py-2.5 pr-3 text-[var(--text-tertiary)] font-semibold text-xs uppercase tracking-wider">Total</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-[var(--text-primary)] tabular" style={{ fontVariantNumeric: 'tabular-nums' }}>{idrCompact(kpis.revenue)}</td>
                  <td className={`py-2.5 pr-3 text-right font-semibold tabular ${kpis.grossMargin >= 0 ? 'text-[var(--text-primary)]' : 'text-red-500'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{idrCompact(kpis.grossMargin)}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-[var(--text-muted)] tabular" style={{ fontVariantNumeric: 'tabular-nums' }}>{idrCompact(kpis.sm)}</td>
                  <td className="py-2.5 pr-3 text-right font-semibold text-[var(--text-muted)] tabular" style={{ fontVariantNumeric: 'tabular-nums' }}>{idrCompact(kpis.ga)}</td>
                  <td className={`py-2.5 pr-3 text-right font-semibold tabular ${kpis.ebitda >= 0 ? 'text-emerald-500' : 'text-red-500'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{idrCompact(kpis.ebitda)}</td>
                  <td className="py-2.5 text-right font-semibold text-[var(--text-secondary)] tabular" style={{ fontVariantNumeric: 'tabular-nums' }}>{kpis.revenue > 0 ? pct(kpis.ebitda / kpis.revenue) : '—'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="mt-8 flex flex-col sm:flex-row justify-between items-center gap-2 text-[11px] text-[var(--text-very-faint)]">
        <span>
          Sumber: {dataSourceLabel}
          {isCustom && activeMeta && (
            <span className="ml-2 text-blue-500/60">
              · diupload {new Date(activeMeta.uploadedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
          {' '}· Nilai dalam IDR
        </span>
        <span>{new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
      </footer>
    </div>
  );
}
