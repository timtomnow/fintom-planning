'use strict';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const STORAGE_KEY = 'fp_v1';

const ASSET_CATEGORIES = [
  'Bank Account', 'Investment Account',
  'Real Estate', 'Vehicle', 'Business', 'Other',
];

const LIABILITY_CATEGORIES = [
  'Mortgage', 'Home Equity Loan', 'Auto Loan',
  'Student Loan', 'Credit Card', 'Personal Loan', 'Other',
];

const EVENT_CATEGORIES = [
  'Income', 'Housing', 'Transportation', 'Food & Dining',
  'Healthcare', 'Education', 'Entertainment', 'Insurance',
  'Childcare', 'Travel', 'Utilities', 'Savings & Investment',
  'Living Expenses', 'Transfers', 'Other',
];

// Maps sub-pages to their parent sidebar page for active highlighting
const SIDEBAR_MAP = {
  'baseline-detail': 'baselines',
  'event-set-detail': 'event-sets',
  'results': 'analysis',
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

const state = {
  data: null,          // persisted to localStorage
  page: 'dashboard',
  params: {},
  activeCharts: [],    // Chart.js instances to destroy on nav
  lastRun: null,       // { deterministicResults, compareResults, mcResults }
  lastRunConfig: null, // the AnalysisConfig that produced lastRun
};

// ═══════════════════════════════════════════════════════════════
// DATA SCHEMAS & DEFAULTS
// ═══════════════════════════════════════════════════════════════

function defaultData() {
  return {
    version: 1,
    baselines: [],
    events: [],
    eventSets: [],
    analysisConfigs: [],
    settings: { defaultInflationRate: 3, defaultTaxRate: 22 },
  };
}

function defaultAsset() {
  return {
    id: uuid(), name: '', value: 0,
    category: 'Brokerage',
    isInvestment: false, isLiquid: true,
    monthlyGrowthRate: 0,
    annualMeanReturn: 7, annualStdDev: 15,
  };
}

function defaultLiability() {
  return {
    id: uuid(), name: '', value: 0,
    category: 'Mortgage',
    annualInterestRate: 6,
    useAmortization: false, monthlyPayment: 0,
    includeInLiquidNW: true,
    paymentAssetName: '',
  };
}

function defaultEvent() {
  return {
    id: uuid(), name: '',
    category: 'Income',
    type: 'income',
    amount: 0, stdDevAmount: 0,
    isRecurring: true,
    startDate: today(), endDate: '',
    inflationAdjusted: false, notes: '',
    linkedAssetName: '',
    depositToAssetName: '',
    payFromAssetName: '',
    linkedLiabilityName: '',
  };
}

function defaultAnalysisConfig() {
  const s = state.data?.settings || {};
  return {
    id: uuid(), name: 'New Analysis',
    baselineId: '', compareBaselineId: '',
    eventSetIds: [],
    compareEventSetIds: [],
    startDate: today(), endDate: addMonths(today(), 120),
    viewMode: 'yearly',
    inflationRate: s.defaultInflationRate ?? 3,
    taxRate: s.defaultTaxRate ?? 22,
    monteCarlo: {
      enabled: false, numSimulations: 500,
      standardOfLivingMonthly: 0,
    },
  };
}

function defaultEventSet() {
  return { id: uuid(), name: '', description: '', eventIds: [] };
}

// ═══════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.data = raw ? JSON.parse(raw) : defaultData();
    // Migrate older saves that predate event sets
    state.data.eventSets = state.data.eventSets ?? [];
  } catch (e) {
    state.data = defaultData();
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

function exportData() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url, download: `finplan-backup-${today()}.json`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Data exported');
}

function triggerImport() {
  const input = Object.assign(document.createElement('input'), {
    type: 'file', accept: '.json',
  });
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        state.data = JSON.parse(ev.target.result);
        state.lastRun = null;
        state.lastRunConfig = null;
        saveData();
        navigate('dashboard');
        showToast('Data imported', 'success');
      } catch {
        showToast('Invalid file — could not import', 'error');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function uuid() {
  return crypto.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(yyyymm, n) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthsBetween(start, end) {
  if (!start || !end) return 0;
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  return (ey - sy) * 12 + (em - sm);
}

function getMonthRange(start, end) {
  const months = [];
  let cur = start;
  while (cur <= end) {
    months.push(cur);
    cur = addMonths(cur, 1);
  }
  return months;
}

function monthLabel(yyyymm) {
  if (!yyyymm) return '';
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

function fmt$(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(n || 0);
}

function fmtCompact(n) {
  const abs = Math.abs(n || 0);
  const s = (n || 0) < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${s}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${s}$${(abs / 1_000).toFixed(0)}K`;
  return fmt$(n);
}

function fmtPct(n) { return `${(n ?? 0).toFixed(2)}%`; }

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function sampleNormal(mean, stdDev) {
  // Box-Muller transform
  let u, v;
  do { u = Math.random(); } while (u === 0);
  do { v = Math.random(); } while (v === 0);
  return mean + Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * stdDev;
}

function pctValue(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

function isEventActive(event, month) {
  if (!event.startDate) return false;
  if (month < event.startDate) return false;
  const oneTime = !event.isRecurring ||
    event.type === 'one_time_inflow' || event.type === 'one_time_outflow';
  if (oneTime) return month === event.startDate;
  if (event.endDate && month > event.endDate) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════
// FORECAST ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Run one simulation pass.
 * returnSampler(asset)  → annualReturn%  (null = use asset.annualMeanReturn)
 * amountSampler(event)  → amount         (null = use event.amount)
 * events                → event array to use (null = all global events)
 */
function runSingleForecast(baselineId, config, returnSampler = null, amountSampler = null, events = null) {
  const baseline = state.data.baselines.find(b => b.id === baselineId);
  if (!baseline) return [];

  const months = getMonthRange(config.startDate, config.endDate);
  const assets = deepClone(baseline.assets ?? []);
  const liabilities = deepClone(baseline.liabilities ?? []);
  let cashFlow = 0; // accumulated net cash since baseline date

  // Build name→asset/liability maps for event linking (references same objects as arrays)
  const assetMap = new Map(assets.map(a => [a.name, a]));
  const liabMap  = new Map(liabilities.map(l => [l.name, l]));

  // Pre-create any deposit-target assets that don't exist in the baseline (start at $0)
  const eventsToScan = events ?? state.data.events;
  for (const ev of eventsToScan) {
    if (ev.depositToAssetName && !assetMap.has(ev.depositToAssetName)) {
      const virtual = { id: `virtual-${ev.depositToAssetName}`, name: ev.depositToAssetName,
        value: 0, isInvestment: false, isLiquid: true, monthlyGrowthRate: 0, _virtual: true };
      assets.push(virtual);
      assetMap.set(ev.depositToAssetName, virtual);
    }
  }

  return months.map(month => {
    // Capture net worth at start of month (before any updates)
    const startNetWorth = assets.reduce((s, a) => s + a.value, 0) + cashFlow
                        - liabilities.reduce((s, l) => s + l.value, 0);

    let incomeThisMonth   = 0;
    let expenseThisMonth  = 0;
    let transferThisMonth = 0;

    // 1. Grow assets
    for (const a of assets) {
      if (a.isInvestment) {
        const annualPct = returnSampler ? returnSampler(a) : a.annualMeanReturn;
        a.value = Math.max(0, a.value * (1 + annualPct / 12 / 100));
      } else {
        a.value = Math.max(0, a.value * (1 + (a.monthlyGrowthRate ?? 0) / 100));
      }
    }

    // 2. Amortise liabilities and deduct payments from cash (or from a linked asset)
    for (const l of liabilities) {
      if (l.useAmortization && l.value > 0) {
        const mRate = (l.annualInterestRate ?? 0) / 12 / 100;
        const interest = l.value * mRate;
        const payment = Math.min(l.monthlyPayment ?? 0, l.value + interest);
        l.value = Math.max(0, l.value - (payment - interest));
        const payAsset = l.paymentAssetName ? assetMap.get(l.paymentAssetName) : null;
        if (payAsset) {
          payAsset.value = Math.max(0, payAsset.value - payment);
        } else {
          cashFlow -= payment;
        }
        expenseThisMonth += payment;
      }
    }

    // 3. Apply events
    const activeEvents = events ?? state.data.events;
    for (const ev of activeEvents) {
      if (!isEventActive(ev, month)) continue;

      let amount = amountSampler ? amountSampler(ev) : ev.amount;
      amount = Math.max(0, amount);

      if (ev.inflationAdjusted && config.inflationRate) {
        const mElapsed = monthsBetween(config.startDate, month);
        amount *= Math.pow(1 + config.inflationRate / 12 / 100, mElapsed);
      }

      switch (ev.type) {
        case 'income': {
          const net = amount * (1 - (config.taxRate ?? 0) / 100);
          const depositAsset = ev.depositToAssetName ? assetMap.get(ev.depositToAssetName) : null;
          if (depositAsset) {
            depositAsset.value += net;
          } else {
            cashFlow += net;
          }
          incomeThisMonth += net;
          break;
        }
        case 'expense': {
        // Deduct from source asset or cash flow
          const srcAsset = ev.payFromAssetName ? assetMap.get(ev.payFromAssetName) : null;
          if (srcAsset) {
            srcAsset.value = Math.max(0, srcAsset.value - amount);
          } else {
            cashFlow -= amount;
          }
          // Apply to liability (extra principal), destination asset (transfer), or count as expense
          if (ev.linkedLiabilityName) {
            const liab = liabMap.get(ev.linkedLiabilityName);
            if (liab) { liab.value = Math.max(0, liab.value - amount); transferThisMonth += amount; }
            else { expenseThisMonth += amount; }
          } else if (ev.linkedAssetName) {
            const linked = assetMap.get(ev.linkedAssetName);
            if (linked) { linked.value += amount; transferThisMonth += amount; }
            else { expenseThisMonth += amount; }
          } else {
            expenseThisMonth += amount;
          }
          break;
        }
        case 'one_time_inflow': {
          const depositAsset = ev.depositToAssetName ? assetMap.get(ev.depositToAssetName) : null;
          if (depositAsset) {
            depositAsset.value += amount;
          } else {
            cashFlow += amount;
          }
          incomeThisMonth += amount;
          break;
        }
        case 'one_time_outflow': {
          // Deduct from source asset or cash flow
          const srcAsset = ev.payFromAssetName ? assetMap.get(ev.payFromAssetName) : null;
          if (srcAsset) {
            srcAsset.value = Math.max(0, srcAsset.value - amount);
          } else {
            cashFlow -= amount;
          }
          // Apply to liability, destination asset, or count as expense
          if (ev.linkedLiabilityName) {
            const liab = liabMap.get(ev.linkedLiabilityName);
            if (liab) { liab.value = Math.max(0, liab.value - amount); transferThisMonth += amount; }
            else { expenseThisMonth += amount; }
          } else if (ev.linkedAssetName) {
            const linked = assetMap.get(ev.linkedAssetName);
            if (linked) { linked.value += amount; transferThisMonth += amount; }
            else { expenseThisMonth += amount; }
          } else {
            expenseThisMonth += amount;
          }
          break;
        }
      }
    }

    // 4. Net worth = assets + cashFlow − liabilities
    const assetTotal      = assets.reduce((s, a) => s + a.value, 0);
    const liabTotal       = liabilities.reduce((s, l) => s + l.value, 0);
    const liquidTotal     = assets.filter(a => a.isLiquid).reduce((s, a) => s + a.value, 0);
    const liquidLiabTotal = liabilities.filter(l => l.includeInLiquidNW ?? true).reduce((s, l) => s + l.value, 0);
    const netWorth        = assetTotal + cashFlow - liabTotal;
    const liquidNetWorth  = liquidTotal + cashFlow - liquidLiabTotal;

    return { month, netWorth, liquidNetWorth, assetTotal, liabTotal, cashFlow,
             startNetWorth, incomeThisMonth, expenseThisMonth, transferThisMonth,
             assetSnapshots: assets.map(a => ({ id: a.id, name: a.name, value: a.value })),
             liabSnapshots:  liabilities.map(l => ({ id: l.id, name: l.name, value: l.value })) };
  });
}

function runDeterministicForecast(baselineId, config, events = null) {
  return runSingleForecast(baselineId, config, null, null, events);
}

function runMonteCarloForecast(baselineId, config, mcConfig, events = null) {
  const n = mcConfig.numSimulations ?? 500;
  const months = getMonthRange(config.startDate, config.endDate);
  // Collect net worth per time step across all simulations
  const buckets = months.map(() => []);

  for (let sim = 0; sim < n; sim++) {
    const returnSampler = a => sampleNormal(a.annualMeanReturn, a.annualStdDev);
    const amtSampler    = ev => ev.stdDevAmount > 0
      ? Math.max(0, sampleNormal(ev.amount, ev.stdDevAmount))
      : ev.amount;
    const results = runSingleForecast(baselineId, config, returnSampler, amtSampler, events);
    results.forEach((r, i) => buckets[i].push(r.netWorth));
  }

  return months.map((month, i) => {
    const sorted = [...buckets[i]].sort((a, b) => a - b);
    return {
      month,
      p10: pctValue(sorted, 10),
      p25: pctValue(sorted, 25),
      p50: pctValue(sorted, 50),
      p75: pctValue(sorted, 75),
      p90: pctValue(sorted, 90),
    };
  });
}

// Collapse monthly results to one row per year.
// Balance-sheet fields: last month of year wins.
// Flow fields (income, expenses): summed across all months in the year.
// startNetWorth: first month of year's value.
function aggregateYearly(monthly) {
  const map = {};
  for (const r of monthly) {
    const yr = r.month.slice(0, 4);
    if (!map[yr]) {
      map[yr] = { ...r, incomeThisMonth: 0, expenseThisMonth: 0, transferThisMonth: 0 };
      // startNetWorth stays as the first month's value (set once here)
    }
    map[yr].incomeThisMonth   += r.incomeThisMonth   ?? 0;
    map[yr].expenseThisMonth  += r.expenseThisMonth  ?? 0;
    map[yr].transferThisMonth += r.transferThisMonth ?? 0;
    // Overwrite balance-sheet fields with the latest month's values
    map[yr].month        = r.month;
    map[yr].netWorth     = r.netWorth;
    map[yr].liquidNetWorth = r.liquidNetWorth;
    map[yr].assetTotal   = r.assetTotal;
    map[yr].liabTotal    = r.liabTotal;
    map[yr].cashFlow     = r.cashFlow;
  }
  return Object.values(map);
}

function aggregateMCYearly(monthly) {
  const map = {};
  for (const r of monthly) map[r.month.slice(0, 4)] = r;
  return Object.values(map);
}

// ═══════════════════════════════════════════════════════════════
// CHART HELPERS
// ═══════════════════════════════════════════════════════════════

function destroyCharts() {
  state.activeCharts.forEach(c => c.destroy());
  state.activeCharts = [];
}

function makeChart(canvasId, config) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const chart = new Chart(ctx, config);
  state.activeCharts.push(chart);
  return chart;
}

// ═══════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════

function showModal(title, bodyHtml, onSave, saveLabel = 'Save') {
  document.getElementById('modal').innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${esc(title)}</span>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="hideModal()">Cancel</button>
      <button class="btn btn-primary" id="modal-save">${esc(saveLabel)}</button>
    </div>`;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-save').onclick = () => { if (onSave()) hideModal(); };
}

function showConfirm(title, msg, onConfirm, confirmLabel = 'Delete') {
  document.getElementById('modal').innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${esc(title)}</span>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="modal-body"><p style="color:var(--muted);font-size:14px;">${esc(msg)}</p></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="hideModal()">Cancel</button>
      <button class="btn btn-danger" id="modal-confirm">${esc(confirmLabel)}</button>
    </div>`;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-confirm').onclick = () => { onConfirm(); hideModal(); };
}

function hideModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('modal').classList.remove('modal-wide');
}

async function showHelpModal(tab = 'readme') {
  const render = md => typeof marked !== 'undefined'
    ? marked.parse(md)
    : `<pre style="white-space:pre-wrap;font-size:12.5px;">${esc(md)}</pre>`;
  const errHtml = '<p style="color:var(--danger)">Could not load documentation. Help requires the app to be served over HTTP.</p><p>To develop locally, run this from the project folder:</p><pre style="background:var(--bg-secondary);padding:8px 12px;border-radius:6px;font-size:13px;">python3 -m http.server 8080</pre><p>Then open <a href="http://localhost:8080" target="_blank">http://localhost:8080</a></p>';

  document.getElementById('modal').innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Help &amp; Documentation</span>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="help-tabs">
      <button class="help-tab-btn${tab === 'readme' ? ' active' : ''}" onclick="switchHelpTab('readme')">User Guide</button>
      <button class="help-tab-btn${tab === 'claude' ? ' active' : ''}" onclick="switchHelpTab('claude')">Developer Guide</button>
    </div>
    <div class="help-content" id="help-readme" ${tab !== 'readme' ? 'style="display:none"' : ''}>
      <p style="color:var(--text-muted)">Loading…</p>
    </div>
    <div class="help-content" id="help-claude" ${tab !== 'claude' ? 'style="display:none"' : ''}>
      <p style="color:var(--text-muted)">Loading…</p>
    </div>`;
  document.getElementById('modal').classList.add('modal-wide');
  document.getElementById('modal-overlay').classList.add('open');

  const load = async (url, elId) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      document.getElementById(elId).innerHTML = render(await res.text());
    } catch {
      document.getElementById(elId).innerHTML = errHtml;
    }
  };

  load('./README.md', 'help-readme');
  load('./CLAUDE.md', 'help-claude');
}

function switchHelpTab(tab) {
  document.getElementById('help-readme').style.display = tab === 'readme' ? '' : 'none';
  document.getElementById('help-claude').style.display = tab === 'claude' ? '' : 'none';
  document.querySelectorAll('.help-tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', (i === 0 && tab === 'readme') || (i === 1 && tab === 'claude'));
  });
}

document.addEventListener('click', e => {
  if (e.target.id === 'modal-overlay') hideModal();
});

// ═══════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════

function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

function navigate(page, params = {}) {
  destroyCharts();
  state.page = page;
  state.params = params;

  const activeNav = SIDEBAR_MAP[page] ?? page;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.page === activeNav));

  const main = document.getElementById('main');
  switch (page) {
    case 'dashboard':         main.innerHTML = renderDashboard(); break;
    case 'baselines':         main.innerHTML = renderBaselines(); break;
    case 'baseline-detail':   main.innerHTML = renderBaselineDetail(); break;
    case 'events':            main.innerHTML = renderEvents(); break;
    case 'event-sets':        main.innerHTML = renderEventSets(); break;
    case 'event-set-detail':  main.innerHTML = renderEventSetDetail(); break;
    case 'analysis':          main.innerHTML = renderAnalysis(); break;
    case 'results':
      main.innerHTML = renderResults();
      requestAnimationFrame(attachResultsCharts);
      break;
    case 'settings':          main.innerHTML = renderSettings(); break;
    default:                  main.innerHTML = renderDashboard();
  }
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

function renderDashboard() {
  const { baselines, events, eventSets, analysisConfigs } = state.data;

  let latestNW = null;
  if (baselines.length) {
    const bl = baselines[baselines.length - 1];
    latestNW = (bl.assets ?? []).reduce((s, a) => s + a.value, 0)
             - (bl.liabilities ?? []).reduce((s, l) => s + l.value, 0);
  }

  const recIncome   = events.filter(e => e.type === 'income'   && e.isRecurring).reduce((s, e) => s + e.amount, 0);
  const recExpense  = events.filter(e => e.type === 'expense'  && e.isRecurring).reduce((s, e) => s + e.amount, 0);
  const taxRate     = state.data.settings.defaultTaxRate ?? 22;
  const monthlyCF   = recIncome * (1 - taxRate / 100) - recExpense;

  return `<div class="page">
    <div class="page-header">
      <div><div class="page-title">Dashboard</div><div class="page-subtitle">Your financial planning overview</div></div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Latest Net Worth</div>
        <div class="stat-value ${latestNW === null ? '' : latestNW >= 0 ? 'positive' : 'negative'}">
          ${latestNW === null ? '—' : fmt$(latestNW)}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Est. Monthly Cash Flow</div>
        <div class="stat-value ${events.length ? (monthlyCF >= 0 ? 'positive' : 'negative') : ''}">
          ${events.length ? fmt$(monthlyCF) : '—'}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Baselines</div>
        <div class="stat-value">${baselines.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Events / Event Sets</div>
        <div class="stat-value">${events.length} / ${eventSets.length}</div>
      </div>
    </div>

    ${baselines.length === 0 ? `
      <div class="card">
        <div class="empty-state">
          <div class="empty-state-icon">📊</div>
          <div class="empty-state-title">Welcome to FinTom</div>
          <div class="empty-state-body">Start by creating a baseline — a snapshot of your current assets and liabilities. Then add events for income and expenses.</div>
          <button class="btn btn-primary" onclick="navigate('baselines')">Create First Baseline</button>
        </div>
      </div>
    ` : `
      <div class="card">
        <div class="card-title">Quick Actions</div>
        <div class="flex gap-2 flex-wrap">
          <button class="btn btn-secondary" onclick="navigate('baselines')">Manage Baselines</button>
          <button class="btn btn-secondary" onclick="navigate('events')">Manage Events</button>
          <button class="btn btn-primary"   onclick="navigate('analysis')">Run Analysis</button>
        </div>
      </div>

      ${analysisConfigs.length ? `
        <div class="card mt-4">
          <div class="card-title">Saved Configurations</div>
          <div class="table-wrap"><table>
            <thead><tr>
              <th>Name</th><th>Baseline</th><th>Period</th><th>Monte Carlo</th><th></th>
            </tr></thead>
            <tbody>
              ${analysisConfigs.map(cfg => {
                const bl = baselines.find(b => b.id === cfg.baselineId);
                return `<tr>
                  <td><strong>${esc(cfg.name)}</strong></td>
                  <td>${bl ? esc(bl.name) : '<span class="text-muted">—</span>'}</td>
                  <td class="text-muted nowrap" style="font-size:12px;">${monthLabel(cfg.startDate)} – ${monthLabel(cfg.endDate)}</td>
                  <td>${cfg.monteCarlo?.enabled ? `<span class="badge">${cfg.monteCarlo.numSimulations} runs</span>` : '<span class="text-muted">—</span>'}</td>
                  <td><button class="btn btn-sm btn-primary" onclick="runAndView('${cfg.id}')">Run</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>
        </div>
      ` : ''}
    `}
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// BASELINES PAGE
// ═══════════════════════════════════════════════════════════════

function renderBaselines() {
  const { baselines } = state.data;
  return `<div class="page">
    <div class="page-header">
      <div><div class="page-title">Baselines</div><div class="page-subtitle">Net worth snapshots at a point in time</div></div>
      <button class="btn btn-primary" onclick="openBaselineModal()">+ New Baseline</button>
    </div>

    ${baselines.length === 0 ? `
      <div class="card">
        <div class="empty-state">
          <div class="empty-state-icon">🏦</div>
          <div class="empty-state-title">No baselines yet</div>
          <div class="empty-state-body">A baseline captures your assets and liabilities at a specific date. Create one to get started.</div>
          <button class="btn btn-primary" onclick="openBaselineModal()">Create Baseline</button>
        </div>
      </div>
    ` : `
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Name</th><th>Date</th>
            <th class="text-right">Assets</th>
            <th class="text-right">Liabilities</th>
            <th class="text-right">Net Worth</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${baselines.map(bl => {
              const assets = (bl.assets ?? []).reduce((s, a) => s + a.value, 0);
              const liabs  = (bl.liabilities ?? []).reduce((s, l) => s + l.value, 0);
              const nw     = assets - liabs;
              return `<tr>
                <td>
                  <strong>${esc(bl.name)}</strong>
                  ${bl.description ? `<br><span class="text-muted" style="font-size:12px;">${esc(bl.description)}</span>` : ''}
                </td>
                <td class="text-muted nowrap">${monthLabel(bl.date)}</td>
                <td class="text-right">${fmt$(assets)}</td>
                <td class="text-right text-negative">${fmt$(liabs)}</td>
                <td class="text-right ${nw >= 0 ? 'text-positive' : 'text-negative'}">${fmt$(nw)}</td>
                <td>
                  <div class="flex gap-2 justify-end flex-wrap">
                    <button class="btn btn-sm btn-secondary" onclick="navigate('baseline-detail',{id:'${bl.id}'})">Assets & Liabilities</button>
                    <button class="btn btn-sm btn-ghost" onclick="openBaselineModal('${bl.id}')">Edit</button>
                    <button class="btn btn-sm btn-ghost" onclick="duplicateBaseline('${bl.id}')">Duplicate</button>
                    <button class="btn btn-sm btn-ghost text-negative" onclick="deleteBaseline('${bl.id}')">Delete</button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>
    `}
  </div>`;
}

function openBaselineModal(id = null) {
  const bl = id ? state.data.baselines.find(b => b.id === id) : null;
  showModal(bl ? 'Edit Baseline' : 'New Baseline', `
    <div class="form-group">
      <label>Name</label>
      <input type="text" id="bl-name" value="${esc(bl?.name ?? '')}" placeholder="e.g., Current — April 2026">
    </div>
    <div class="form-group">
      <label>Date <span class="label-note">(month this snapshot represents)</span></label>
      <input type="month" id="bl-date" value="${bl?.date ?? today()}">
    </div>
    <div class="form-group">
      <label>Description <span class="label-note">(optional)</span></label>
      <input type="text" id="bl-desc" value="${esc(bl?.description ?? '')}" placeholder="e.g., Before home purchase">
    </div>
  `, () => {
    const name = document.getElementById('bl-name').value.trim();
    const date = document.getElementById('bl-date').value;
    if (!name) { showToast('Name is required', 'error'); return false; }
    if (!date) { showToast('Date is required', 'error'); return false; }

    if (bl) {
      Object.assign(bl, { name, date, description: document.getElementById('bl-desc').value.trim() });
    } else {
      state.data.baselines.push({
        id: uuid(), name, date,
        description: document.getElementById('bl-desc').value.trim(),
        assets: [], liabilities: [],
        createdAt: new Date().toISOString(),
      });
    }
    saveData();
    navigate('baselines');
    showToast(bl ? 'Baseline updated' : 'Baseline created', 'success');
    return true;
  });
}

function duplicateBaseline(id) {
  const orig = state.data.baselines.find(b => b.id === id);
  if (!orig) return;
  const copy = deepClone(orig);
  copy.id = uuid();
  copy.name += ' (Copy)';
  copy.createdAt = new Date().toISOString();
  (copy.assets ?? []).forEach(a => { a.id = uuid(); });
  (copy.liabilities ?? []).forEach(l => { l.id = uuid(); });
  state.data.baselines.push(copy);
  saveData();
  navigate('baselines');
  showToast('Baseline duplicated', 'success');
}

function deleteBaseline(id) {
  const bl = state.data.baselines.find(b => b.id === id);
  showConfirm('Delete Baseline', `Delete "${bl?.name}"? This cannot be undone.`, () => {
    state.data.baselines = state.data.baselines.filter(b => b.id !== id);
    saveData();
    navigate('baselines');
    showToast('Baseline deleted');
  });
}

// ═══════════════════════════════════════════════════════════════
// BASELINE DETAIL — ASSETS & LIABILITIES
// ═══════════════════════════════════════════════════════════════

function renderBaselineDetail() {
  const bl = state.data.baselines.find(b => b.id === state.params.id);
  if (!bl) return '<div class="page"><p class="text-muted">Baseline not found.</p></div>';

  const assets = bl.assets ?? [];
  const liabs  = bl.liabilities ?? [];
  const totalA = assets.reduce((s, a) => s + a.value, 0);
  const totalL = liabs.reduce((s, l) => s + l.value, 0);
  const nw     = totalA - totalL;

  return `<div class="page">
    <div class="page-header">
      <div>
        <div class="page-title">${esc(bl.name)}</div>
        <div class="page-subtitle">Assets & Liabilities · ${monthLabel(bl.date)}</div>
      </div>
      <button class="btn btn-secondary" onclick="navigate('baselines')">← Back</button>
    </div>

    <div class="stat-grid" style="margin-bottom:24px;">
      <div class="stat-card"><div class="stat-label">Total Assets</div><div class="stat-value">${fmt$(totalA)}</div></div>
      <div class="stat-card"><div class="stat-label">Total Liabilities</div><div class="stat-value text-negative">${fmt$(totalL)}</div></div>
      <div class="stat-card"><div class="stat-label">Net Worth</div><div class="stat-value ${nw >= 0 ? 'positive' : 'negative'}">${fmt$(nw)}</div></div>
    </div>

    <!-- ASSETS -->
    <div class="card">
      <div class="section-header">
        <div class="section-title">Assets</div>
        <button class="btn btn-sm btn-primary" onclick="openAssetModal('${bl.id}')">+ Add Asset</button>
      </div>
      ${assets.length === 0 ? `
        <div style="padding:12px 0; color:var(--muted); font-size:13.5px;">No assets yet. Add one to get started.</div>
      ` : `
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Name</th><th>Category</th><th>Type</th>
            <th>Growth / Return</th><th>Liquid</th>
            <th class="text-right">Value</th><th></th>
          </tr></thead>
          <tbody>
            ${assets.map(a => `<tr>
              <td><strong>${esc(a.name)}</strong></td>
              <td class="text-muted">${esc(a.category)}</td>
              <td>${a.isInvestment ? '<span class="badge">Investment</span>' : '<span class="inline-tag">Static</span>'}</td>
              <td class="font-mono text-muted" style="font-size:12px;">
                ${a.isInvestment
                  ? `${fmtPct(a.annualMeanReturn)}/yr ± ${fmtPct(a.annualStdDev)}`
                  : `${fmtPct(a.monthlyGrowthRate)}/mo`}
              </td>
              <td>${a.isLiquid ? '✓' : '<span class="text-muted">—</span>'}</td>
              <td class="text-right">${fmt$(a.value)}</td>
              <td>
                <div class="flex gap-2 justify-end">
                  <button class="btn btn-sm btn-ghost" onclick="openAssetModal('${bl.id}','${a.id}')">Edit</button>
                  <button class="btn btn-sm btn-ghost text-negative" onclick="deleteAsset('${bl.id}','${a.id}')">Delete</button>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td colspan="5"><strong>Total Assets</strong></td>
            <td class="text-right"><strong>${fmt$(totalA)}</strong></td>
            <td></td>
          </tr></tfoot>
        </table></div>
      `}
    </div>

    <!-- LIABILITIES -->
    <div class="card mt-4">
      <div class="section-header">
        <div class="section-title">Liabilities</div>
        <button class="btn btn-sm btn-primary" onclick="openLiabilityModal('${bl.id}')">+ Add Liability</button>
      </div>
      <div class="alert alert-info mb-4" style="font-size:12.5px;">
        For amortising loans (mortgage, auto), enable amortisation — the monthly payment will be deducted automatically from cash flow. Do <strong>not</strong> also add it as an expense event.
      </div>
      ${liabs.length === 0 ? `
        <div style="padding:12px 0; color:var(--muted); font-size:13.5px;">No liabilities yet.</div>
      ` : `
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Name</th><th>Category</th><th>Rate</th>
            <th>Monthly Payment</th><th>Payment From</th><th>Amortising</th>
            <th>Liquid NW</th>
            <th class="text-right">Balance</th><th></th>
          </tr></thead>
          <tbody>
            ${liabs.map(l => `<tr>
              <td><strong>${esc(l.name)}</strong></td>
              <td class="text-muted">${esc(l.category)}</td>
              <td class="font-mono" style="font-size:12px;">${fmtPct(l.annualInterestRate)}/yr</td>
              <td>${l.useAmortization ? fmt$(l.monthlyPayment) : '<span class="text-muted">—</span>'}</td>
              <td class="text-muted" style="font-size:12px;">${l.useAmortization && l.paymentAssetName ? esc(l.paymentAssetName) : '<span class="text-muted">—</span>'}</td>
              <td>${l.useAmortization ? '✓' : '<span class="text-muted">—</span>'}</td>
              <td>${(l.includeInLiquidNW ?? true) ? '✓' : '<span class="text-muted">—</span>'}</td>
              <td class="text-right text-negative">${fmt$(l.value)}</td>
              <td>
                <div class="flex gap-2 justify-end">
                  <button class="btn btn-sm btn-ghost" onclick="openLiabilityModal('${bl.id}','${l.id}')">Edit</button>
                  <button class="btn btn-sm btn-ghost text-negative" onclick="deleteLiability('${bl.id}','${l.id}')">Delete</button>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td colspan="7"><strong>Total Liabilities</strong></td>
            <td class="text-right text-negative"><strong>${fmt$(totalL)}</strong></td>
            <td></td>
          </tr></tfoot>
        </table></div>
      `}
    </div>
  </div>`;
}

function openAssetModal(baselineId, assetId = null) {
  const bl = state.data.baselines.find(b => b.id === baselineId);
  const existing = assetId ? (bl.assets ?? []).find(a => a.id === assetId) : null;
  const a = existing ?? defaultAsset();

  showModal(existing ? 'Edit Asset' : 'Add Asset', `
    <div class="form-row">
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="a-name" value="${esc(a.name)}" placeholder="e.g., Vanguard Brokerage">
      </div>
      <div class="form-group">
        <label>Category</label>
        <select id="a-cat">${ASSET_CATEGORIES.map(c => `<option${a.category === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Current Value ($)</label>
        <input type="number" id="a-value" value="${a.value}" min="0" step="1000">
      </div>
      <div class="form-group" style="display:flex;flex-direction:column;justify-content:flex-end;gap:10px;padding-bottom:2px;">
        <label class="checkbox-label"><input type="checkbox" id="a-liquid" ${a.isLiquid ? 'checked' : ''}> Liquid asset</label>
        <label class="checkbox-label"><input type="checkbox" id="a-invest" ${a.isInvestment ? 'checked' : ''} onchange="toggleInvestFields()"> Investment / market asset</label>
      </div>
    </div>

    <div id="fields-static" ${a.isInvestment ? 'style="display:none"' : ''}>
      <div class="form-group">
        <label>Monthly Growth Rate (%)</label>
        <input type="number" id="a-mgr" value="${a.monthlyGrowthRate}" step="0.01">
        <div class="form-hint">e.g., 0.33 ≈ 4% annual appreciation for real estate</div>
      </div>
    </div>

    <div id="fields-invest" ${!a.isInvestment ? 'style="display:none"' : ''}>
      <div class="alert alert-info mb-4">Investment assets use mean return + standard deviation for Monte Carlo simulation.</div>
      <div class="form-row">
        <div class="form-group">
          <label>Expected Annual Return (%)</label>
          <input type="number" id="a-mean" value="${a.annualMeanReturn}" step="0.1">
          <div class="form-hint">e.g., 7% for a broad index fund</div>
        </div>
        <div class="form-group">
          <label>Annual Std. Deviation (%)</label>
          <input type="number" id="a-std" value="${a.annualStdDev}" step="0.1">
          <div class="form-hint">e.g., 15% equities · 5% bonds</div>
        </div>
      </div>
    </div>
  `, () => {
    const name = document.getElementById('a-name').value.trim();
    if (!name) { showToast('Name is required', 'error'); return false; }

    const updated = {
      id: existing?.id ?? uuid(),
      name,
      category: document.getElementById('a-cat').value,
      value: parseFloat(document.getElementById('a-value').value) || 0,
      isLiquid: document.getElementById('a-liquid').checked,
      isInvestment: document.getElementById('a-invest').checked,
      monthlyGrowthRate: parseFloat(document.getElementById('a-mgr').value) || 0,
      annualMeanReturn: parseFloat(document.getElementById('a-mean').value) || 7,
      annualStdDev: parseFloat(document.getElementById('a-std').value) || 15,
    };

    if (!bl.assets) bl.assets = [];
    if (existing) {
      bl.assets[bl.assets.findIndex(a => a.id === assetId)] = updated;
    } else {
      bl.assets.push(updated);
    }
    saveData();
    navigate('baseline-detail', { id: baselineId });
    showToast(existing ? 'Asset updated' : 'Asset added', 'success');
    return true;
  });
}

function toggleInvestFields() {
  const on = document.getElementById('a-invest').checked;
  document.getElementById('fields-invest').style.display = on ? '' : 'none';
  document.getElementById('fields-static').style.display = on ? 'none' : '';
}

function deleteAsset(baselineId, assetId) {
  const bl = state.data.baselines.find(b => b.id === baselineId);
  const a  = (bl.assets ?? []).find(a => a.id === assetId);
  showConfirm('Delete Asset', `Delete "${a?.name}"?`, () => {
    bl.assets = bl.assets.filter(a => a.id !== assetId);
    saveData();
    navigate('baseline-detail', { id: baselineId });
    showToast('Asset deleted');
  });
}

function openLiabilityModal(baselineId, liabilityId = null) {
  const bl = state.data.baselines.find(b => b.id === baselineId);
  const existing = liabilityId ? (bl.liabilities ?? []).find(l => l.id === liabilityId) : null;
  const l = existing ?? defaultLiability();

  const blAssetNames = (bl.assets ?? []).map(a => a.name).filter(Boolean);
  const payAssetOptions = `<option value="">— Cash Flow (default) —</option>`
    + blAssetNames.map(n => `<option${(l.paymentAssetName ?? '') === n ? ' selected' : ''}>${esc(n)}</option>`).join('');

  showModal(existing ? 'Edit Liability' : 'Add Liability', `
    <div class="form-row">
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="l-name" value="${esc(l.name)}" placeholder="e.g., Primary Mortgage">
      </div>
      <div class="form-group">
        <label>Category</label>
        <select id="l-cat">${LIABILITY_CATEGORIES.map(c => `<option${l.category === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Current Balance ($)</label>
        <input type="number" id="l-value" value="${l.value}" min="0" step="1000">
      </div>
      <div class="form-group">
        <label>Annual Interest Rate (%)</label>
        <input type="number" id="l-rate" value="${l.annualInterestRate}" step="0.01">
      </div>
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="l-liquid-nw" ${(l.includeInLiquidNW ?? true) ? 'checked' : ''}>
        Include in Liquid Net Worth
      </label>
      <div class="form-hint">Uncheck for liabilities tied to illiquid assets (e.g., mortgage against real estate you wouldn't sell).</div>
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="l-amort" ${l.useAmortization ? 'checked' : ''} onchange="toggleAmortFields()">
        Amortising loan — automatic principal + interest calculation
      </label>
      <div class="form-hint">Enable for mortgages, auto loans, and any fixed-payment instalment loan.</div>
    </div>
    <div id="fields-amort" ${!l.useAmortization ? 'style="display:none"' : ''}>
      <div class="form-group">
        <label>Monthly Payment ($)</label>
        <input type="number" id="l-pay" value="${l.monthlyPayment}" step="10" min="0">
        <div class="form-hint">The full payment amount — automatically split into principal and interest each month.</div>
      </div>
      <div class="form-group">
        <label>Payment Source Asset <span class="label-note">(optional)</span></label>
        <select id="l-pay-asset">${payAssetOptions}</select>
        <div class="form-hint">Payment is deducted from this asset's balance instead of the general cash flow pool (e.g., mortgage paid from checking account).</div>
      </div>
    </div>
  `, () => {
    const name = document.getElementById('l-name').value.trim();
    if (!name) { showToast('Name is required', 'error'); return false; }

    const updated = {
      id: existing?.id ?? uuid(),
      name,
      category: document.getElementById('l-cat').value,
      value: parseFloat(document.getElementById('l-value').value) || 0,
      annualInterestRate: parseFloat(document.getElementById('l-rate').value) || 0,
      includeInLiquidNW: document.getElementById('l-liquid-nw').checked,
      useAmortization: document.getElementById('l-amort').checked,
      monthlyPayment: parseFloat(document.getElementById('l-pay').value) || 0,
      paymentAssetName: document.getElementById('l-pay-asset').value,
    };

    if (!bl.liabilities) bl.liabilities = [];
    if (existing) {
      bl.liabilities[bl.liabilities.findIndex(l => l.id === liabilityId)] = updated;
    } else {
      bl.liabilities.push(updated);
    }
    saveData();
    navigate('baseline-detail', { id: baselineId });
    showToast(existing ? 'Liability updated' : 'Liability added', 'success');
    return true;
  });
}

function toggleAmortFields() {
  document.getElementById('fields-amort').style.display =
    document.getElementById('l-amort').checked ? '' : 'none';
}

function deleteLiability(baselineId, liabilityId) {
  const bl = state.data.baselines.find(b => b.id === baselineId);
  const l  = (bl.liabilities ?? []).find(l => l.id === liabilityId);
  showConfirm('Delete Liability', `Delete "${l?.name}"?`, () => {
    bl.liabilities = bl.liabilities.filter(l => l.id !== liabilityId);
    saveData();
    navigate('baseline-detail', { id: baselineId });
    showToast('Liability deleted');
  });
}

// ═══════════════════════════════════════════════════════════════
// EVENTS PAGE
// ═══════════════════════════════════════════════════════════════

function renderEvents() {
  const { events } = state.data;
  const filter = state.params.filter ?? 'all';

  const filtered = events.filter(ev => {
    if (filter === 'income')  return ev.type === 'income';
    if (filter === 'expense') return ev.type === 'expense';
    if (filter === 'onetime') return !ev.isRecurring ||
      ev.type === 'one_time_inflow' || ev.type === 'one_time_outflow';
    return true;
  });

  const badgeClass = t => ({ income: 'income', expense: 'expense', one_time_inflow: 'one-time', one_time_outflow: 'one-time' }[t] ?? '');
  const typeLabel  = t => ({ income: 'Income', expense: 'Expense', one_time_inflow: 'One-time In', one_time_outflow: 'One-time Out' }[t] ?? t);

  return `<div class="page">
    <div class="page-header">
      <div><div class="page-title">Events</div><div class="page-subtitle">Recurring and one-time cash flows</div></div>
      <button class="btn btn-primary" onclick="openEventModal()">+ Add Event</button>
    </div>

    <div class="flex gap-2 items-center mb-4">
      <div class="toggle-group">
        ${[['all','All'],['income','Income'],['expense','Expenses'],['onetime','One-time']].map(([v,l]) =>
          `<button class="toggle-btn${filter === v ? ' active' : ''}" onclick="navigate('events',{filter:'${v}'})">${l}</button>`
        ).join('')}
      </div>
      <span class="text-muted" style="font-size:13px;">${filtered.length} event${filtered.length !== 1 ? 's' : ''}</span>
    </div>

    ${filtered.length === 0 ? `
      <div class="card">
        <div class="empty-state">
          <div class="empty-state-icon">📅</div>
          <div class="empty-state-title">${events.length === 0 ? 'No events yet' : 'No matching events'}</div>
          <div class="empty-state-body">Events model income, expenses, and one-time transactions that affect your cash flow over time.</div>
          <button class="btn btn-primary" onclick="openEventModal()">Add Event</button>
        </div>
      </div>
    ` : `
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Name</th><th>Type</th><th>Category</th>
            <th class="text-right">Amount</th>
            <th>Frequency</th><th>Period</th>
            <th>Inflation</th><th>Links</th><th></th>
          </tr></thead>
          <tbody>
            ${filtered.map(ev => `<tr>
              <td>
                <strong>${esc(ev.name)}</strong>
                ${ev.notes ? `<br><span class="text-muted" style="font-size:12px;">${esc(ev.notes)}</span>` : ''}
              </td>
              <td><span class="badge ${badgeClass(ev.type)}">${typeLabel(ev.type)}</span></td>
              <td class="text-muted">${esc(ev.category)}</td>
              <td class="text-right font-mono">
                ${fmt$(ev.amount)}
                ${ev.stdDevAmount > 0 ? `<br><span class="text-muted" style="font-size:11px;">± ${fmt$(ev.stdDevAmount)}</span>` : ''}
              </td>
              <td>${ev.isRecurring && ev.type !== 'one_time_inflow' && ev.type !== 'one_time_outflow' ? 'Monthly' : 'One-time'}</td>
              <td class="text-muted nowrap" style="font-size:12px;">
                ${monthLabel(ev.startDate)}${ev.isRecurring && ev.endDate ? ` – ${monthLabel(ev.endDate)}` : ev.isRecurring ? ' onwards' : ''}
              </td>
              <td>${ev.inflationAdjusted ? '✓' : '<span class="text-muted">—</span>'}</td>
              <td style="font-size:12px;">${(() => {
                const parts = [];
                if (ev.depositToAssetName)  parts.push(`→ ${esc(ev.depositToAssetName)}`);
                if (ev.payFromAssetName)    parts.push(`← ${esc(ev.payFromAssetName)}`);
                if (ev.linkedAssetName)     parts.push(`⇌ ${esc(ev.linkedAssetName)}`);
                if (ev.linkedLiabilityName) parts.push(`↓ ${esc(ev.linkedLiabilityName)}`);
                return parts.length ? parts.join('<br>') : '<span class="text-muted">—</span>';
              })()}</td>
              <td>
                <div class="flex gap-2 justify-end">
                  <button class="btn btn-sm btn-ghost" onclick="openEventModal('${ev.id}')">Edit</button>
                  <button class="btn btn-sm btn-ghost text-negative" onclick="deleteEvent('${ev.id}')">Delete</button>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    `}
  </div>`;
}

function openEventModal(id = null) {
  const existing = id ? state.data.events.find(e => e.id === id) : null;
  const ev = existing ?? defaultEvent();

  const allAssetNames = [...new Set(
    state.data.baselines.flatMap(bl => (bl.assets ?? []).map(a => a.name).filter(Boolean))
  )].sort();
  const allLiabNames = [...new Set(
    state.data.baselines.flatMap(bl => (bl.liabilities ?? []).map(l => l.name).filter(Boolean))
  )].sort();
  const assetOptions = (selected) => `<option value="">— None —</option>`
    + allAssetNames.map(n => `<option${selected === n ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const linkedAssetOptions = assetOptions(ev.linkedAssetName ?? '');
  const isInflow = ev.type === 'income' || ev.type === 'one_time_inflow';
  const isOutflow = ev.type === 'expense' || ev.type === 'one_time_outflow';

  showModal(existing ? 'Edit Event' : 'Add Event', `
    <div class="form-row">
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="ev-name" value="${esc(ev.name)}" placeholder="e.g., Monthly Salary">
      </div>
      <div class="form-group">
        <label>Category</label>
        <select id="ev-cat">${EVENT_CATEGORIES.map(c => `<option${ev.category === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Type</label>
        <select id="ev-type" onchange="onEvTypeChange()">
          <option value="income"          ${ev.type === 'income'           ? 'selected' : ''}>Income</option>
          <option value="expense"         ${ev.type === 'expense'          ? 'selected' : ''}>Expense</option>
          <option value="one_time_inflow" ${ev.type === 'one_time_inflow'  ? 'selected' : ''}>One-time Inflow</option>
          <option value="one_time_outflow"${ev.type === 'one_time_outflow' ? 'selected' : ''}>One-time Outflow</option>
        </select>
      </div>
      <div class="form-group">
        <label>Amount ($)</label>
        <input type="number" id="ev-amt" value="${ev.amount}" min="0" step="100">
      </div>
    </div>

    <div id="ev-tax-note" class="alert alert-info mb-4" ${ev.type !== 'income' ? 'style="display:none"' : ''}>
      Income events will have the household tax rate applied during analysis.
    </div>

    <div class="form-group" id="ev-rec-wrap">
      <label class="checkbox-label">
        <input type="checkbox" id="ev-rec" ${ev.isRecurring ? 'checked' : ''} onchange="onEvRecChange()">
        Recurring — happens every month
      </label>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label id="ev-start-lbl">${ev.isRecurring ? 'Start Date' : 'Date'}</label>
        <input type="month" id="ev-start" value="${ev.startDate}">
      </div>
      <div class="form-group" id="ev-end-wrap" ${!ev.isRecurring ? 'style="display:none"' : ''}>
        <label>End Date <span class="label-note">(blank = indefinite)</span></label>
        <input type="month" id="ev-end" value="${ev.endDate ?? ''}">
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="checkbox-label"><input type="checkbox" id="ev-inf" ${ev.inflationAdjusted ? 'checked' : ''}> Adjust for inflation</label>
        <div class="form-hint">Amount grows at the configured inflation rate each month</div>
      </div>
      <div class="form-group">
        <label>Variability / Std Dev ($) <span class="label-note">for Monte Carlo</span></label>
        <input type="number" id="ev-std" value="${ev.stdDevAmount ?? 0}" min="0" step="100">
        <div class="form-hint">Use for variable income (bonuses, freelance, etc.)</div>
      </div>
    </div>

    <div class="form-group">
      <label>Notes <span class="label-note">(optional)</span></label>
      <input type="text" id="ev-notes" value="${esc(ev.notes ?? '')}" placeholder="Any additional context">
    </div>
    <div class="form-group" id="ev-deposit-wrap"${isInflow ? '' : ' style="display:none"'}>
      <label>Deposit into Asset <span class="label-note">(income / inflow only)</span></label>
      <select id="ev-deposit-asset">${assetOptions(ev.depositToAssetName ?? '')}</select>
      <div class="form-hint">Income goes directly into this asset instead of the general cash pool (e.g., paycheck auto-invested).</div>
    </div>
    <div class="form-group" id="ev-pay-from-wrap"${isOutflow ? '' : ' style="display:none"'}>
      <label>Pay from Asset <span class="label-note">(expense / outflow only)</span></label>
      <select id="ev-pay-from-asset">${assetOptions(ev.payFromAssetName ?? '')}</select>
      <div class="form-hint">Deduct this expense from a specific asset instead of the cash pool (e.g., bill paid from savings account).</div>
    </div>
    <div class="form-group" id="ev-link-wrap"${isOutflow ? '' : ' style="display:none"'}>
      <label>Transfer to Asset <span class="label-note">(expense / outflow only)</span></label>
      <select id="ev-link-asset">${linkedAssetOptions}</select>
      <div class="form-hint">Outflow also adds the same amount to this asset (e.g., cash purchase of an investment). Net worth change = $0.</div>
    </div>
    <div class="form-group" id="ev-link-liab-wrap"${isOutflow ? '' : ' style="display:none"'}>
      <label>Extra Payment to Liability <span class="label-note">(expense / outflow only)</span></label>
      <select id="ev-link-liab"><option value="">— None —</option>${allLiabNames.map(n => `<option${(ev.linkedLiabilityName ?? '') === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <div class="form-hint">Also reduces this liability's principal balance (e.g., extra mortgage payment). Net worth change = $0.</div>
    </div>
  `, () => {
    const name = document.getElementById('ev-name').value.trim();
    if (!name) { showToast('Name is required', 'error'); return false; }
    const startDate = document.getElementById('ev-start').value;
    if (!startDate) { showToast('Date is required', 'error'); return false; }

    const type = document.getElementById('ev-type').value;
    const isOutflowSave = type === 'expense' || type === 'one_time_outflow';
    const isInflowSave  = type === 'income'  || type === 'one_time_inflow';

    const updated = {
      id: existing?.id ?? uuid(),
      name,
      category: document.getElementById('ev-cat').value,
      type,
      amount: parseFloat(document.getElementById('ev-amt').value) || 0,
      stdDevAmount: parseFloat(document.getElementById('ev-std').value) || 0,
      isRecurring: document.getElementById('ev-rec').checked,
      startDate,
      endDate: document.getElementById('ev-end').value || '',
      inflationAdjusted: document.getElementById('ev-inf').checked,
      notes: document.getElementById('ev-notes').value.trim(),
      linkedAssetName:     isOutflowSave ? document.getElementById('ev-link-asset').value    : '',
      depositToAssetName:  isInflowSave  ? document.getElementById('ev-deposit-asset').value : '',
      payFromAssetName:    isOutflowSave ? document.getElementById('ev-pay-from-asset').value : '',
      linkedLiabilityName: isOutflowSave ? document.getElementById('ev-link-liab').value      : '',
    };

    if (existing) {
      state.data.events[state.data.events.findIndex(e => e.id === id)] = updated;
    } else {
      state.data.events.push(updated);
    }
    saveData();
    navigate('events', state.params);
    showToast(existing ? 'Event updated' : 'Event added', 'success');
    return true;
  });
}

function onEvTypeChange() {
  const type = document.getElementById('ev-type').value;
  const oneTime   = type === 'one_time_inflow' || type === 'one_time_outflow';
  const isOutflow = type === 'expense' || type === 'one_time_outflow';
  const isInflow  = type === 'income'  || type === 'one_time_inflow';
  document.getElementById('ev-tax-note').style.display      = type === 'income' ? '' : 'none';
  document.getElementById('ev-deposit-wrap').style.display  = isInflow  ? '' : 'none';
  document.getElementById('ev-pay-from-wrap').style.display = isOutflow ? '' : 'none';
  document.getElementById('ev-link-wrap').style.display     = isOutflow ? '' : 'none';
  document.getElementById('ev-link-liab-wrap').style.display = isOutflow ? '' : 'none';
  if (oneTime) {
    document.getElementById('ev-rec').checked = false;
    document.getElementById('ev-rec').disabled = true;
    document.getElementById('ev-end-wrap').style.display = 'none';
    document.getElementById('ev-start-lbl').textContent = 'Date';
  } else {
    document.getElementById('ev-rec').disabled = false;
  }
}

function onEvRecChange() {
  const rec = document.getElementById('ev-rec').checked;
  document.getElementById('ev-end-wrap').style.display = rec ? '' : 'none';
  document.getElementById('ev-start-lbl').textContent = rec ? 'Start Date' : 'Date';
}

function deleteEvent(id) {
  const ev = state.data.events.find(e => e.id === id);
  showConfirm('Delete Event', `Delete "${ev?.name}"?`, () => {
    state.data.events = state.data.events.filter(e => e.id !== id);
    // Remove from any event sets that reference it
    for (const es of state.data.eventSets) {
      es.eventIds = (es.eventIds ?? []).filter(eid => eid !== id);
    }
    saveData();
    navigate('events', state.params);
    showToast('Event deleted');
  });
}

// ═══════════════════════════════════════════════════════════════
// EVENT SETS PAGE
// ═══════════════════════════════════════════════════════════════

function renderEventSets() {
  const { eventSets } = state.data;
  return `<div class="page">
    <div class="page-header">
      <div>
        <div class="page-title">Event Sets</div>
        <div class="page-subtitle">Named groups of events you can apply to analyses</div>
      </div>
      <button class="btn btn-primary" onclick="openEventSetModal()">+ New Event Set</button>
    </div>

    ${eventSets.length === 0 ? `
      <div class="card">
        <div class="empty-state">
          <div class="empty-state-icon">🗂</div>
          <div class="empty-state-title">No event sets yet</div>
          <div class="empty-state-body">An event set is a named collection of events — income, expenses, or one-time items — that you can attach to a specific analysis. Create multiple sets to compare scenarios side-by-side.</div>
          <button class="btn btn-primary" onclick="openEventSetModal()">Create Event Set</button>
        </div>
      </div>
    ` : `
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Name</th><th>Description</th><th class="text-right">Events</th><th></th>
          </tr></thead>
          <tbody>
            ${eventSets.map(es => {
              const count = (es.eventIds ?? []).length;
              return `<tr>
                <td><strong>${esc(es.name)}</strong></td>
                <td class="text-muted" style="font-size:13px;">${es.description ? esc(es.description) : '<span class="text-muted">—</span>'}</td>
                <td class="text-right">${count} event${count !== 1 ? 's' : ''}</td>
                <td>
                  <div class="flex gap-2 justify-end">
                    <button class="btn btn-sm btn-secondary" onclick="navigate('event-set-detail',{id:'${es.id}'})">Manage Events</button>
                    <button class="btn btn-sm btn-ghost" onclick="openEventSetModal('${es.id}')">Edit</button>
                    <button class="btn btn-sm btn-ghost text-negative" onclick="deleteEventSet('${es.id}')">Delete</button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>
    `}
  </div>`;
}

function renderEventSetDetail() {
  const es = state.data.eventSets.find(s => s.id === state.params.id);
  if (!es) return '<div class="page"><p class="text-muted">Event set not found.</p></div>';

  const setEvents = state.data.events.filter(e => (es.eventIds ?? []).includes(e.id));
  const badgeClass = t => ({ income: 'income', expense: 'expense', one_time_inflow: 'one-time', one_time_outflow: 'one-time' }[t] ?? '');
  const typeLabel  = t => ({ income: 'Income', expense: 'Expense', one_time_inflow: 'One-time In', one_time_outflow: 'One-time Out' }[t] ?? t);

  return `<div class="page">
    <div class="page-header">
      <div>
        <div class="page-title">${esc(es.name)}</div>
        <div class="page-subtitle">${es.description ? esc(es.description) : 'Event Set'}</div>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-primary" onclick="openEventSetEventsModal('${es.id}')">+ Add / Remove Events</button>
        <button class="btn btn-secondary" onclick="navigate('event-sets')">← Back</button>
      </div>
    </div>

    ${setEvents.length === 0 ? `
      <div class="card">
        <div class="empty-state">
          <div class="empty-state-icon">📅</div>
          <div class="empty-state-title">No events in this set</div>
          <div class="empty-state-body">Add existing events to this set, or create new events on the Events page first.</div>
          <button class="btn btn-primary" onclick="openEventSetEventsModal('${es.id}')">Add Events</button>
        </div>
      </div>
    ` : `
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Name</th><th>Type</th><th>Category</th>
            <th class="text-right">Amount</th><th>Frequency</th><th>Period</th><th></th>
          </tr></thead>
          <tbody>
            ${setEvents.map(ev => `<tr>
              <td>
                <strong>${esc(ev.name)}</strong>
                ${ev.notes ? `<br><span class="text-muted" style="font-size:12px;">${esc(ev.notes)}</span>` : ''}
              </td>
              <td><span class="badge ${badgeClass(ev.type)}">${typeLabel(ev.type)}</span></td>
              <td class="text-muted">${esc(ev.category)}</td>
              <td class="text-right font-mono">${fmt$(ev.amount)}</td>
              <td>${ev.isRecurring && ev.type !== 'one_time_inflow' && ev.type !== 'one_time_outflow' ? 'Monthly' : 'One-time'}</td>
              <td class="text-muted nowrap" style="font-size:12px;">
                ${monthLabel(ev.startDate)}${ev.isRecurring && ev.endDate ? ` – ${monthLabel(ev.endDate)}` : ev.isRecurring ? ' onwards' : ''}
              </td>
              <td>
                <button class="btn btn-sm btn-ghost text-negative" onclick="removeEventFromSet('${es.id}','${ev.id}')">Remove</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    `}
  </div>`;
}

function openEventSetModal(id = null) {
  const existing = id ? state.data.eventSets.find(s => s.id === id) : null;
  const es = existing ?? defaultEventSet();
  showModal(existing ? 'Edit Event Set' : 'New Event Set', `
    <div class="form-group">
      <label>Name</label>
      <input type="text" id="es-name" value="${esc(es.name)}" placeholder="e.g., Base Expenses, Optimistic Income">
    </div>
    <div class="form-group">
      <label>Description <span class="label-note">(optional)</span></label>
      <input type="text" id="es-desc" value="${esc(es.description ?? '')}" placeholder="e.g., Assumes job change in 2027">
    </div>
  `, () => {
    const name = document.getElementById('es-name').value.trim();
    if (!name) { showToast('Name is required', 'error'); return false; }
    if (existing) {
      existing.name = name;
      existing.description = document.getElementById('es-desc').value.trim();
    } else {
      state.data.eventSets.push({
        id: uuid(), name,
        description: document.getElementById('es-desc').value.trim(),
        eventIds: [],
      });
    }
    saveData();
    navigate('event-sets');
    showToast(existing ? 'Event set updated' : 'Event set created', 'success');
    return true;
  });
}

function openEventSetEventsModal(setId) {
  const es = state.data.eventSets.find(s => s.id === setId);
  if (!es) return;
  const currentIds = new Set(es.eventIds ?? []);
  const { events } = state.data;

  if (events.length === 0) {
    showToast('No events exist yet — create some on the Events page first.', 'error');
    return;
  }

  const badgeClass = t => ({ income: 'income', expense: 'expense', one_time_inflow: 'one-time', one_time_outflow: 'one-time' }[t] ?? '');
  const typeLabel  = t => ({ income: 'Income', expense: 'Expense', one_time_inflow: 'One-time In', one_time_outflow: 'One-time Out' }[t] ?? t);

  showModal(`Add / Remove Events — ${esc(es.name)}`, `
    <div class="form-hint" style="margin-bottom:10px;">Check each event to include it in this set.</div>
    <div style="max-height:360px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;">
      ${events.map(ev => `
        <label class="checkbox-label" style="padding:5px 4px;align-items:flex-start;">
          <input type="checkbox" name="es-ev" value="${ev.id}" ${currentIds.has(ev.id) ? 'checked' : ''} style="margin-top:2px;">
          <span>
            <strong>${esc(ev.name)}</strong>
            <span class="badge ${badgeClass(ev.type)}" style="margin-left:6px;font-size:10px;">${typeLabel(ev.type)}</span>
            <span style="color:var(--muted);font-size:12px;margin-left:6px;">${fmt$(ev.amount)}</span>
          </span>
        </label>
      `).join('')}
    </div>
  `, () => {
    es.eventIds = [...document.querySelectorAll('input[name="es-ev"]:checked')].map(el => el.value);
    saveData();
    navigate('event-set-detail', { id: setId });
    showToast('Event set updated', 'success');
    return true;
  }, 'Save');
}

function removeEventFromSet(setId, eventId) {
  const es = state.data.eventSets.find(s => s.id === setId);
  if (!es) return;
  es.eventIds = (es.eventIds ?? []).filter(id => id !== eventId);
  saveData();
  navigate('event-set-detail', { id: setId });
  showToast('Event removed from set');
}

function deleteEventSet(id) {
  const es = state.data.eventSets.find(s => s.id === id);
  showConfirm('Delete Event Set', `Delete "${es?.name}"? The events themselves will not be deleted.`, () => {
    state.data.eventSets = state.data.eventSets.filter(s => s.id !== id);
    // Remove from any analysis configs that reference it
    for (const cfg of state.data.analysisConfigs) {
      cfg.eventSetIds = (cfg.eventSetIds ?? []).filter(sid => sid !== id);
      cfg.compareEventSetIds = (cfg.compareEventSetIds ?? []).filter(sid => sid !== id);
    }
    saveData();
    navigate('event-sets');
    showToast('Event set deleted');
  });
}

// ═══════════════════════════════════════════════════════════════
// ANALYSIS PAGE
// ═══════════════════════════════════════════════════════════════

function renderAnalysis() {
  const { baselines, analysisConfigs, eventSets } = state.data;

  if (!baselines.length) return `<div class="page">
    <div class="page-header"><div class="page-title">Analysis</div></div>
    <div class="card"><div class="empty-state">
      <div class="empty-state-icon">📈</div>
      <div class="empty-state-title">No baselines found</div>
      <div class="empty-state-body">Create a baseline first, then come back to run a forecast.</div>
      <button class="btn btn-primary" onclick="navigate('baselines')">Create Baseline</button>
    </div></div>
  </div>`;

  return `<div class="page">
    <div class="page-header">
      <div><div class="page-title">Analysis</div><div class="page-subtitle">Configure and run net worth forecasts</div></div>
      <button class="btn btn-primary" onclick="openConfigModal()">+ New Configuration</button>
    </div>

    ${analysisConfigs.length === 0 ? `
      <div class="card"><div class="empty-state">
        <div class="empty-state-icon">📈</div>
        <div class="empty-state-title">No analysis configurations</div>
        <div class="empty-state-body">Create a configuration to set your baseline, time range, tax rate, inflation, and Monte Carlo settings.</div>
        <button class="btn btn-primary" onclick="openConfigModal()">Create Configuration</button>
      </div></div>
    ` : `
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Name</th><th>Primary Baseline</th><th>Primary Event Sets</th>
            <th>Compare Baseline</th><th>Compare Event Sets</th>
            <th>Period</th><th>Inflation</th><th>Tax</th><th>Monte Carlo</th><th></th>
          </tr></thead>
          <tbody>
            ${analysisConfigs.map(cfg => {
              const bl  = baselines.find(b => b.id === cfg.baselineId);
              const cbl = baselines.find(b => b.id === cfg.compareBaselineId);
              const primarySetNames  = (cfg.eventSetIds ?? []).map(sid => eventSets.find(s => s.id === sid)?.name).filter(Boolean);
              const compareSetNames  = (cfg.compareEventSetIds ?? []).map(sid => eventSets.find(s => s.id === sid)?.name).filter(Boolean);
              const renderSets = names => names.length
                ? names.map(n => `<span class="badge">${esc(n)}</span>`).join(' ')
                : '<span class="text-muted" style="font-size:12px;">All events</span>';
              return `<tr>
                <td><strong>${esc(cfg.name)}</strong></td>
                <td>${bl ? esc(bl.name) : '<span class="text-muted">—</span>'}</td>
                <td>${renderSets(primarySetNames)}</td>
                <td>${cbl ? esc(cbl.name) : '<span class="text-muted">—</span>'}</td>
                <td>${compareSetNames.length ? renderSets(compareSetNames) : (cbl || primarySetNames.length ? renderSets(primarySetNames) : '<span class="text-muted">—</span>')}</td>
                <td class="text-muted nowrap" style="font-size:12px;">${monthLabel(cfg.startDate)} – ${monthLabel(cfg.endDate)}</td>
                <td class="font-mono" style="font-size:12px;">${cfg.inflationRate}%</td>
                <td class="font-mono" style="font-size:12px;">${cfg.taxRate}%</td>
                <td>${cfg.monteCarlo?.enabled
                  ? `<span class="badge">${cfg.monteCarlo.numSimulations} runs</span>`
                  : '<span class="text-muted">—</span>'}</td>
                <td>
                  <div class="flex gap-2 justify-end">
                    <button class="btn btn-sm btn-primary" onclick="runAndView('${cfg.id}')">Run</button>
                    <button class="btn btn-sm btn-ghost" onclick="openConfigModal('${cfg.id}')">Edit</button>
                    <button class="btn btn-sm btn-ghost text-negative" onclick="deleteConfig('${cfg.id}')">Delete</button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>
    `}
  </div>`;
}

function openConfigModal(id = null) {
  const { baselines, eventSets } = state.data;
  const existing = id ? state.data.analysisConfigs.find(c => c.id === id) : null;
  const cfg = existing ?? defaultAnalysisConfig();

  const blOptions = baselines.map(bl =>
    `<option value="${bl.id}"${cfg.baselineId === bl.id ? ' selected' : ''}>${esc(bl.name)} (${monthLabel(bl.date)})</option>`
  ).join('');
  const cblOptions = `<option value="">— None —</option>` + baselines.map(bl =>
    `<option value="${bl.id}"${cfg.compareBaselineId === bl.id ? ' selected' : ''}>${esc(bl.name)} (${monthLabel(bl.date)})</option>`
  ).join('');

  const primaryIds = new Set(cfg.eventSetIds ?? []);
  const compareIds = new Set(cfg.compareEventSetIds ?? []);

  const renderSetCheckboxes = (name, checkedIds) => eventSets.length === 0
    ? `<div class="form-hint">No event sets yet — <a href="#" onclick="hideModal();navigate('event-sets');return false;">create one first</a>.</div>`
    : `<div style="max-height:120px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:6px 8px;">
        ${eventSets.map(es => `
          <label class="checkbox-label" style="padding:3px 0;">
            <input type="checkbox" name="${name}" value="${es.id}" ${checkedIds.has(es.id) ? 'checked' : ''}>
            ${esc(es.name)} <span class="label-note">(${(es.eventIds ?? []).length} events)</span>
          </label>`).join('')}
       </div>
       <div class="form-hint">Leave all unchecked to use all global events.</div>`;

  showModal(existing ? 'Edit Configuration' : 'New Analysis Configuration', `
    <div class="form-group">
      <label>Name</label>
      <input type="text" id="cfg-name" value="${esc(cfg.name)}" placeholder="e.g., 10-Year Retirement Forecast">
    </div>

    <hr class="divider">
    <div style="font-weight:600;margin-bottom:12px;">Primary Scenario</div>
    <div class="form-row">
      <div class="form-group">
        <label>Baseline</label>
        <select id="cfg-bl"><option value="">— Select —</option>${blOptions}</select>
      </div>
    </div>
    <div class="form-group">
      <label>Event Sets <span class="label-note">(select which to include)</span></label>
      ${renderSetCheckboxes('cfg-es-primary', primaryIds)}
    </div>

    <hr class="divider">
    <div style="font-weight:600;margin-bottom:12px;">Compare Scenario <span class="label-note" style="font-weight:400;">(optional)</span></div>
    <div class="form-row">
      <div class="form-group">
        <label>Compare Baseline <span class="label-note">(leave blank to use same baseline)</span></label>
        <select id="cfg-cbl">${cblOptions}</select>
      </div>
    </div>
    <div class="form-group">
      <label>Compare Event Sets <span class="label-note">(leave blank to use same as primary)</span></label>
      ${renderSetCheckboxes('cfg-es-compare', compareIds)}
    </div>

    <hr class="divider">
    <div class="form-row">
      <div class="form-group">
        <label>Start Date</label>
        <input type="month" id="cfg-start" value="${cfg.startDate}">
      </div>
      <div class="form-group">
        <label>End Date</label>
        <input type="month" id="cfg-end" value="${cfg.endDate}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Annual Inflation Rate (%)</label>
        <input type="number" id="cfg-inf" value="${cfg.inflationRate}" step="0.1" min="0">
      </div>
      <div class="form-group">
        <label>Household Tax Rate (%) <span class="label-note">on income</span></label>
        <input type="number" id="cfg-tax" value="${cfg.taxRate}" step="0.1" min="0" max="100">
      </div>
    </div>

    <hr class="divider">
    <div style="font-weight:600;margin-bottom:12px;">Monte Carlo Simulation</div>

    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="cfg-mc" ${cfg.monteCarlo?.enabled ? 'checked' : ''} onchange="toggleMCFields()">
        Enable Monte Carlo for investment assets
      </label>
      <div class="form-hint">Runs many simulations with randomised investment returns to show probability ranges of outcomes.</div>
    </div>

    <div id="mc-fields" ${!cfg.monteCarlo?.enabled ? 'style="display:none"' : ''}>
      <div class="form-row">
        <div class="form-group">
          <label>Number of Simulations</label>
          <input type="number" id="cfg-sims" value="${cfg.monteCarlo?.numSimulations ?? 500}" min="100" max="5000" step="100">
          <div class="form-hint">500–1000 is a good balance of speed and accuracy. More = slower.</div>
        </div>
        <div class="form-group">
          <label>Standard of Living ($/mo) <span class="label-note">optional</span></label>
          <input type="number" id="cfg-sol" value="${cfg.monteCarlo?.standardOfLivingMonthly ?? 0}" step="500" min="0">
          <div class="form-hint">Shown as a 25× sustainability target line on the chart (4% safe withdrawal rule).</div>
        </div>
      </div>
    </div>
  `, () => {
    const name = document.getElementById('cfg-name').value.trim();
    if (!name) { showToast('Name is required', 'error'); return false; }
    const baselineId = document.getElementById('cfg-bl').value;
    if (!baselineId) { showToast('Select a baseline', 'error'); return false; }
    const start = document.getElementById('cfg-start').value;
    const end   = document.getElementById('cfg-end').value;
    if (!start || !end || start >= end) { showToast('Invalid date range', 'error'); return false; }

    const updated = {
      id: existing?.id ?? uuid(),
      name, baselineId,
      compareBaselineId: document.getElementById('cfg-cbl').value || '',
      eventSetIds: [...document.querySelectorAll('input[name="cfg-es-primary"]:checked')].map(el => el.value),
      compareEventSetIds: [...document.querySelectorAll('input[name="cfg-es-compare"]:checked')].map(el => el.value),
      startDate: start, endDate: end,
      viewMode: existing?.viewMode ?? 'yearly',
      inflationRate: parseFloat(document.getElementById('cfg-inf').value) || 0,
      taxRate: parseFloat(document.getElementById('cfg-tax').value) || 0,
      monteCarlo: {
        enabled: document.getElementById('cfg-mc').checked,
        numSimulations: parseInt(document.getElementById('cfg-sims').value) || 500,
        standardOfLivingMonthly: parseFloat(document.getElementById('cfg-sol').value) || 0,
      },
    };

    if (existing) {
      state.data.analysisConfigs[state.data.analysisConfigs.findIndex(c => c.id === id)] = updated;
    } else {
      state.data.analysisConfigs.push(updated);
    }
    saveData();
    navigate('analysis');
    showToast(existing ? 'Configuration updated' : 'Configuration saved', 'success');
    return true;
  });
}

function toggleMCFields() {
  document.getElementById('mc-fields').style.display =
    document.getElementById('cfg-mc').checked ? '' : 'none';
}

function deleteConfig(id) {
  const cfg = state.data.analysisConfigs.find(c => c.id === id);
  showConfirm('Delete Configuration', `Delete "${cfg?.name}"?`, () => {
    state.data.analysisConfigs = state.data.analysisConfigs.filter(c => c.id !== id);
    saveData();
    navigate('analysis');
    showToast('Configuration deleted');
  });
}

// Returns the events array for a config based on its eventSetIds.
// Empty / missing eventSetIds → all global events (backward-compatible default).
function resolveEventSets(setIds) {
  if (!setIds?.length) return state.data.events;
  const ids = new Set(setIds.flatMap(sid => {
    const es = state.data.eventSets.find(s => s.id === sid);
    return es ? es.eventIds : [];
  }));
  return state.data.events.filter(e => ids.has(e.id));
}

function runAndView(configId) {
  const cfg = state.data.analysisConfigs.find(c => c.id === configId);
  if (!cfg) return;

  const primaryEvents = resolveEventSets(cfg.eventSetIds);
  const hasCompare = cfg.compareBaselineId || cfg.compareEventSetIds?.length;
  const compareEvents = cfg.compareEventSetIds?.length
    ? resolveEventSets(cfg.compareEventSetIds)
    : primaryEvents;

  const detResults = runDeterministicForecast(cfg.baselineId, cfg, primaryEvents);
  const cmpResults = hasCompare
    ? runDeterministicForecast(cfg.compareBaselineId || cfg.baselineId, cfg, compareEvents)
    : null;

  if (cfg.monteCarlo?.enabled) {
    showToast(`Running ${cfg.monteCarlo.numSimulations} simulations…`);
    // Yield to browser for toast paint, then run (may block briefly for large N)
    setTimeout(() => {
      const mcResults = runMonteCarloForecast(cfg.baselineId, cfg, cfg.monteCarlo, primaryEvents);
      state.lastRun = { detResults, cmpResults, mcResults };
      state.lastRunConfig = cfg;
      navigate('results', { configId });
    }, 60);
  } else {
    state.lastRun = { detResults, cmpResults, mcResults: null };
    state.lastRunConfig = cfg;
    navigate('results', { configId });
  }
}

// ═══════════════════════════════════════════════════════════════
// RESULTS PAGE
// ═══════════════════════════════════════════════════════════════

function renderResults() {
  const cfg = state.lastRunConfig;
  const run = state.lastRun;

  if (!cfg || !run) return `<div class="page">
    <div class="page-header"><div class="page-title">Results</div></div>
    <div class="card"><div class="empty-state">
      <div class="empty-state-body">No results yet — run an analysis first.</div>
      <button class="btn btn-primary" onclick="navigate('analysis')">Go to Analysis</button>
    </div></div>
  </div>`;

  const vm   = cfg.viewMode ?? 'yearly';
  const pBl  = state.data.baselines.find(b => b.id === cfg.baselineId);
  const cBl  = state.data.baselines.find(b => b.id === cfg.compareBaselineId);

  const det  = vm === 'yearly' ? aggregateYearly(run.detResults) : run.detResults;
  const cmp  = run.cmpResults ? (vm === 'yearly' ? aggregateYearly(run.cmpResults) : run.cmpResults) : null;
  const mc   = run.mcResults  ? (vm === 'yearly' ? aggregateMCYearly(run.mcResults) : run.mcResults) : null;

  const first = det[0], last = det[det.length - 1];
  const change = last.netWorth - first.netWorth;
  const peak   = Math.max(...det.map(r => r.netWorth));

  const mcFinal = mc ? mc[mc.length - 1] : null;

  return `<div class="page">
    <div class="page-header">
      <div>
        <div class="page-title">Results: ${esc(cfg.name)}</div>
        <div class="page-subtitle">
          ${monthLabel(cfg.startDate)} – ${monthLabel(cfg.endDate)}
          · ${pBl ? esc(pBl.name) : ''}${cBl ? ` vs ${esc(cBl.name)}` : ''}
        </div>
      </div>
      <div class="flex gap-2 flex-wrap items-center">
        <div class="toggle-group">
          <button class="toggle-btn${vm === 'monthly' ? ' active' : ''}" onclick="setViewMode('monthly')">Monthly</button>
          <button class="toggle-btn${vm === 'yearly'  ? ' active' : ''}" onclick="setViewMode('yearly')">Yearly</button>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="exportCSV()">Export CSV</button>
        <button class="btn btn-secondary btn-sm" onclick="navigate('analysis')">← Back</button>
      </div>
    </div>

    <!-- Summary stats -->
    <div class="stat-grid" style="margin-bottom:20px;">
      <div class="stat-card">
        <div class="stat-label">Starting Net Worth</div>
        <div class="stat-value">${fmt$(first.netWorth)}</div>
      </div>
      ${mc ? `
        <div class="stat-card">
          <div class="stat-label">Median Final (P50)</div>
          <div class="stat-value ${mcFinal.p50 >= 0 ? 'positive' : 'negative'}">${fmt$(mcFinal.p50)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Pessimistic Final (P10)</div>
          <div class="stat-value ${mcFinal.p10 >= 0 ? 'positive' : 'negative'}">${fmt$(mcFinal.p10)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Optimistic Final (P90)</div>
          <div class="stat-value positive">${fmt$(mcFinal.p90)}</div>
        </div>
      ` : `
        <div class="stat-card">
          <div class="stat-label">Final Net Worth</div>
          <div class="stat-value ${last.netWorth >= 0 ? 'positive' : 'negative'}">${fmt$(last.netWorth)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Change</div>
          <div class="stat-value ${change >= 0 ? 'positive' : 'negative'}">${change >= 0 ? '+' : ''}${fmt$(change)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Peak Net Worth</div>
          <div class="stat-value positive">${fmt$(peak)}</div>
        </div>
      `}
    </div>

    <!-- Net worth chart -->
    <div class="card mb-4">
      <div class="section-header" style="margin-bottom:16px;">
        <div class="section-title">Net Worth Over Time${mc ? ' — Monte Carlo' : ''}</div>
      </div>
      <div class="chart-container" style="height:360px;"><canvas id="chart-nw"></canvas></div>
      ${mc ? `<div class="chart-note">
        Light bands = 10th–90th percentile range. Medium bands = 25th–75th (interquartile). Centre line = median.
        Dashed line = deterministic forecast.
        ${cfg.monteCarlo.standardOfLivingMonthly > 0
          ? `Orange reference line = ${fmt$(cfg.monteCarlo.standardOfLivingMonthly)}/mo sustainability target (25× annual at 4% SWR).`
          : ''}
      </div>` : ''}
    </div>

    <!-- Cash flow chart -->
    <div class="card mb-4">
      <div class="section-title" style="margin-bottom:14px;">Cumulative Cash Flow</div>
      <div class="chart-container" style="height:200px;"><canvas id="chart-cf"></canvas></div>
      <div class="chart-note">Accumulated net cash from all events (income after tax minus expenses and loan payments). Excludes asset appreciation.</div>
    </div>

    <!-- Data table -->
    <div class="card">
      <div class="section-header" style="margin-bottom:12px;">
        <div class="section-title">${vm === 'yearly' ? 'Annual' : 'Monthly'} Detail</div>
      </div>
      <div class="result-table-wrap">
        <table>
          <thead><tr>
            <th>${vm === 'yearly' ? 'Year' : 'Month'}</th>
            <th class="text-right">Start NW</th>
            <th class="text-right">+ Income</th>
            <th class="text-right">− Expenses</th>
            <th class="text-right">→ Transfers</th>
            <th class="text-right">= Cash Flow</th>
            <th class="text-right">Cum. Cash Flow</th>
            <th class="text-right">Δ NW</th>
            <th class="text-right">End NW</th>
            <th class="text-right">Liquid NW</th>
            <th class="text-right">Assets</th>
            <th class="text-right">Liabilities</th>
            ${cmp ? '<th class="text-right">Compare NW</th>' : ''}
            ${mc  ? '<th class="text-right">P10</th><th class="text-right">P50</th><th class="text-right">P90</th>' : ''}
          </tr></thead>
          <tbody>
            ${det.reduce((acc, r, i) => {
              const delta    = r.netWorth - (r.startNetWorth ?? r.netWorth);
              const transfer = r.transferThisMonth ?? 0;
              const cf       = (r.incomeThisMonth ?? 0) - (r.expenseThisMonth ?? 0);
              const cumCF    = acc.cumCF + cf;
              acc.cumCF = cumCF;
              acc.html += `<tr>
              <td class="nowrap">${vm === 'yearly' ? r.month : monthLabel(r.month)}</td>
              <td class="text-right font-mono text-muted">${fmt$(r.startNetWorth ?? 0)}</td>
              <td class="text-right font-mono text-positive">${fmt$(r.incomeThisMonth ?? 0)}</td>
              <td class="text-right font-mono text-negative">${fmt$(r.expenseThisMonth ?? 0)}</td>
              <td class="text-right font-mono text-muted">${transfer > 0 ? fmt$(transfer) : '—'}</td>
              <td class="text-right font-mono ${cf >= 0 ? 'text-positive' : 'text-negative'}">${fmt$(cf)}</td>
              <td class="text-right font-mono ${cumCF >= 0 ? '' : 'text-negative'}">${fmt$(cumCF)}</td>
              <td class="text-right font-mono ${delta >= 0 ? 'text-positive' : 'text-negative'}">${delta >= 0 ? '+' : ''}${fmt$(delta)}</td>
              <td class="text-right font-mono ${r.netWorth >= 0 ? 'text-positive' : 'text-negative'}">${fmt$(r.netWorth)}</td>
              <td class="text-right font-mono">${fmt$(r.liquidNetWorth)}</td>
              <td class="text-right font-mono">${fmt$(r.assetTotal)}</td>
              <td class="text-right font-mono text-negative">${fmt$(r.liabTotal)}</td>
              ${cmp ? `<td class="text-right font-mono">${fmt$(cmp[i]?.netWorth)}</td>` : ''}
              ${mc  ? `
                <td class="text-right font-mono text-muted">${fmt$(mc[i]?.p10)}</td>
                <td class="text-right font-mono">${fmt$(mc[i]?.p50)}</td>
                <td class="text-right font-mono">${fmt$(mc[i]?.p90)}</td>
              ` : ''}
            </tr>`;
              return acc;
            }, { html: '', cumCF: 0 }).html}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Baseline values over time -->
    ${(() => {
      const baseline = pBl;
      if (!baseline) return '';
      const first = run.detResults[0];
      const last  = run.detResults[run.detResults.length - 1];

      const monthOptions = run.detResults.map(r =>
        `<option value="${r.month}">${monthLabel(r.month)}</option>`
      ).join('');

      const baselineAssetNames = new Set((baseline.assets ?? []).map(a => a.name));
      const virtualAssets = (first.assetSnapshots ?? []).filter(s => !baselineAssetNames.has(s.name));

      const rows = [
        ...(baseline.assets ?? []).map(a => ({
          type: 'asset', name: a.name, startVal: a.value,
          endVal: last.assetSnapshots?.find(s => s.name === a.name)?.value ?? 0,
          atVal:  first.assetSnapshots?.find(s => s.name === a.name)?.value ?? 0,
        })),
        ...virtualAssets.map(s => ({
          type: 'asset-virtual', name: s.name, startVal: 0,
          endVal: last.assetSnapshots?.find(snap => snap.name === s.name)?.value ?? 0,
          atVal:  s.value,
        })),
        { type: 'cash', name: 'Cash Flow (accumulated)', startVal: 0,
          endVal: last.cashFlow, atVal: first.cashFlow },
        ...(baseline.liabilities ?? []).map(l => ({
          type: 'liability', name: l.name, startVal: l.value,
          endVal: last.liabSnapshots?.find(s => s.name === l.name)?.value ?? 0,
          atVal:  first.liabSnapshots?.find(s => s.name === l.name)?.value ?? 0,
        })),
      ];

      const tableRows = rows.map(item => {
        const typeLabel = item.type === 'asset' ? 'Asset'
          : item.type === 'asset-virtual' ? 'Asset (new)'
          : item.type === 'liability' ? 'Liability' : 'Cash';
        const endChange = item.endVal - item.startVal;
        return `<tr data-bv-type="${item.type}" data-bv-name="${esc(item.name)}">
          <td>${esc(item.name)}</td>
          <td class="text-muted">${typeLabel}</td>
          <td class="text-right font-mono">${fmt$(item.startVal)}</td>
          <td class="text-right font-mono bv-at-val">${fmt$(item.atVal)}</td>
          <td class="text-right font-mono ${item.type === 'liability' ? (endChange <= 0 ? 'text-positive' : 'text-negative') : (endChange >= 0 ? 'text-positive' : 'text-negative')}">${endChange >= 0 ? '+' : ''}${fmt$(endChange)}</td>
          <td class="text-right font-mono">${fmt$(item.endVal)}</td>
        </tr>`;
      }).join('');

      return `<div class="card" style="margin-top:20px;">
        <div class="section-header" style="margin-bottom:12px;">
          <div class="section-title">Baseline Values Over Time</div>
          <div class="flex items-center gap-2">
            <label style="font-size:13px;color:var(--text-muted);">At month:</label>
            <select id="bv-month-select" style="width:auto;" onchange="updateBaselineValuesAt()">
              ${monthOptions}
            </select>
          </div>
        </div>
        <div class="result-table-wrap">
          <table>
            <thead><tr>
              <th>Name</th>
              <th>Type</th>
              <th class="text-right">Start (${monthLabel(cfg.startDate)})</th>
              <th class="text-right" id="bv-at-header">At ${monthLabel(cfg.startDate)}</th>
              <th class="text-right">Change (total)</th>
              <th class="text-right">End (${monthLabel(cfg.endDate)})</th>
            </tr></thead>
            <tbody id="bv-tbody">${tableRows}</tbody>
          </table>
        </div>
      </div>`;
    })()}
  </div>`;
}

function attachResultsCharts() {
  const cfg = state.lastRunConfig;
  const run = state.lastRun;
  if (!cfg || !run) return;

  const vm  = cfg.viewMode ?? 'yearly';
  const pBl = state.data.baselines.find(b => b.id === cfg.baselineId);
  const cBl = state.data.baselines.find(b => b.id === cfg.compareBaselineId);

  const det = vm === 'yearly' ? aggregateYearly(run.detResults) : run.detResults;
  const cmp = run.cmpResults ? (vm === 'yearly' ? aggregateYearly(run.cmpResults) : run.cmpResults) : null;
  const mc  = run.mcResults  ? (vm === 'yearly' ? aggregateMCYearly(run.mcResults) : run.mcResults) : null;

  const labels = det.map(r => vm === 'yearly' ? r.month : monthLabel(r.month));

  const commonOpts = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16, font: { size: 12 } } } },
    elements: { point: { radius: 0, hoverRadius: 4 } },
  };
  const yAxis = {
    grid: { color: '#f0f0f0' },
    ticks: { font: { size: 11 }, callback: v => fmtCompact(v) },
  };
  const xAxis = { grid: { display: false }, ticks: { maxTicksLimit: 14, font: { size: 11 } } };

  // ── Net Worth Chart ──
  const nwDatasets = [];

  if (mc) {
    // Confidence bands using fill:'+1' to fill between adjacent percentile lines
    nwDatasets.push(
      { label: '', data: mc.map(r => r.p90), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(37,99,235,0.07)', fill: '+1', tension: 0.3 },
      { label: '', data: mc.map(r => r.p75), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(37,99,235,0.13)', fill: '+1', tension: 0.3 },
      { label: '', data: mc.map(r => r.p25), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(37,99,235,0.07)', fill: '+1', tension: 0.3 },
      { label: '', data: mc.map(r => r.p10), borderWidth: 0, pointRadius: 0, backgroundColor: 'transparent', fill: false, tension: 0.3 },
      { label: 'Median', data: mc.map(r => r.p50), borderColor: '#2563eb', borderWidth: 2.5, fill: false, tension: 0.3 },
      { label: 'Deterministic', data: det.map(r => r.netWorth), borderColor: '#94a3b8', borderWidth: 1.5, borderDash: [5, 4], fill: false, tension: 0.3 }
    );
    if (cfg.monteCarlo.standardOfLivingMonthly > 0) {
      const target = cfg.monteCarlo.standardOfLivingMonthly * 12 * 25;
      nwDatasets.push({
        label: `Sustainability Target (${fmt$(cfg.monteCarlo.standardOfLivingMonthly)}/mo)`,
        data: labels.map(() => target),
        borderColor: '#ca8a04', borderWidth: 1.5, borderDash: [8, 4], fill: false, pointRadius: 0,
      });
    }
  } else {
    nwDatasets.push({
      label: pBl?.name ?? 'Net Worth',
      data: det.map(r => r.netWorth),
      borderColor: '#2563eb', borderWidth: 2.5,
      backgroundColor: 'rgba(37,99,235,0.07)', fill: 'origin', tension: 0.3,
    });
  }

  if (cmp) {
    nwDatasets.push({
      label: cBl?.name ?? 'Compare',
      data: cmp.map(r => r.netWorth),
      borderColor: '#16a34a', borderWidth: 2.5,
      backgroundColor: 'transparent', fill: false, tension: 0.3,
    });
  }

  makeChart('chart-nw', {
    type: 'line',
    data: { labels, datasets: nwDatasets },
    options: {
      ...commonOpts,
      plugins: {
        ...commonOpts.plugins,
        legend: {
          ...commonOpts.plugins.legend,
          labels: {
            ...commonOpts.plugins.legend.labels,
            filter: item => item.text.length > 0,
          },
        },
        tooltip: {
          filter: item => item.dataset.label.length > 0,
          callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt$(ctx.raw)}` },
        },
      },
      scales: { x: xAxis, y: yAxis },
    },
  });

  // ── Cash Flow Chart ──
  const cfColor = det[det.length - 1].cashFlow >= 0 ? '#16a34a' : '#dc2626';
  makeChart('chart-cf', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Cumulative Cash Flow',
        data: det.map(r => r.cashFlow),
        borderColor: cfColor, borderWidth: 2,
        backgroundColor: cfColor.replace(')', ',0.07)').replace('rgb', 'rgba'),
        fill: 'origin', tension: 0.3,
      }],
    },
    options: {
      ...commonOpts,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `Cash Flow: ${fmt$(ctx.raw)}` } },
      },
      scales: { x: xAxis, y: yAxis },
    },
  });
}

function setViewMode(vm) {
  if (state.lastRunConfig) {
    const cfg = state.data.analysisConfigs.find(c => c.id === state.lastRunConfig.id);
    if (cfg) cfg.viewMode = vm;
    state.lastRunConfig.viewMode = vm;
    saveData();
  }
  destroyCharts();
  navigate('results', state.params);
}

function exportCSV() {
  const cfg = state.lastRunConfig;
  const run = state.lastRun;
  if (!cfg || !run) return;

  const vm  = cfg.viewMode ?? 'yearly';
  const det = vm === 'yearly' ? aggregateYearly(run.detResults) : run.detResults;
  const cmp = run.cmpResults ? (vm === 'yearly' ? aggregateYearly(run.cmpResults) : run.cmpResults) : null;
  const mc  = run.mcResults  ? (vm === 'yearly' ? aggregateMCYearly(run.mcResults) : run.mcResults) : null;

  const headers = ['Period','Start NW','+ Income','- Expenses','-> Transfers','Cash Flow','Cum Cash Flow','Delta NW','End NW','Liquid Net Worth','Assets','Liabilities'];
  if (cmp) headers.push('Compare Net Worth');
  if (mc)  headers.push('P10','P25','P50','P75','P90');

  let cumCF = 0;
  const rows = det.map((r, i) => {
    const delta    = r.netWorth - (r.startNetWorth ?? r.netWorth);
    const transfer = r.transferThisMonth ?? 0;
    const cf       = (r.incomeThisMonth ?? 0) - (r.expenseThisMonth ?? 0);
    cumCF += cf;
    const row = [
      vm === 'yearly' ? r.month : monthLabel(r.month),
      (r.startNetWorth ?? 0).toFixed(2),
      (r.incomeThisMonth ?? 0).toFixed(2),
      (r.expenseThisMonth ?? 0).toFixed(2),
      transfer.toFixed(2),
      cf.toFixed(2),
      cumCF.toFixed(2),
      delta.toFixed(2),
      r.netWorth.toFixed(2), r.liquidNetWorth.toFixed(2),
      r.assetTotal.toFixed(2), r.liabTotal.toFixed(2),
    ];
    if (cmp) row.push((cmp[i]?.netWorth ?? 0).toFixed(2));
    if (mc)  row.push(mc[i].p10.toFixed(2), mc[i].p25.toFixed(2), mc[i].p50.toFixed(2), mc[i].p75.toFixed(2), mc[i].p90.toFixed(2));
    return row;
  });

  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `forecast-${cfg.name.replace(/\s+/g, '-')}-${today()}.csv`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV exported');
}

function updateBaselineValuesAt() {
  const sel = document.getElementById('bv-month-select');
  if (!sel || !state.lastRun) return;
  const month = sel.value;
  const result = state.lastRun.detResults.find(r => r.month === month);
  if (!result) return;

  const header = document.getElementById('bv-at-header');
  if (header) header.textContent = `At ${monthLabel(month)}`;

  document.querySelectorAll('#bv-tbody tr').forEach(row => {
    const type = row.dataset.bvType;
    const name = row.dataset.bvName;
    const cell = row.querySelector('.bv-at-val');
    if (!cell) return;
    let val;
    if (type === 'asset' || type === 'asset-virtual') {
      val = result.assetSnapshots?.find(s => s.name === name)?.value ?? 0;
    } else if (type === 'cash') {
      val = result.cashFlow;
    } else {
      val = result.liabSnapshots?.find(s => s.name === name)?.value ?? 0;
    }
    cell.textContent = fmt$(val);
  });
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS PAGE
// ═══════════════════════════════════════════════════════════════

function renderSettings() {
  const s = state.data.settings;
  return `<div class="page">
    <div class="page-header">
      <div><div class="page-title">Settings</div><div class="page-subtitle">Defaults and data management</div></div>
    </div>

    <div class="card">
      <div class="card-title">Default Values</div>
      <div class="form-row">
        <div class="form-group">
          <label>Default Inflation Rate (%/yr)</label>
          <input type="number" id="s-inf" value="${s.defaultInflationRate}" step="0.1" min="0">
          <div class="form-hint">Applied to new analysis configurations</div>
        </div>
        <div class="form-group">
          <label>Default Tax Rate (%) <span class="label-note">on income events</span></label>
          <input type="number" id="s-tax" value="${s.defaultTaxRate}" step="0.1" min="0" max="100">
          <div class="form-hint">Effective household rate — applied to all income events in analysis</div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="saveSettings()">Save Settings</button>
    </div>

    <div class="card mt-4">
      <div class="card-title">Data Management</div>
      <p class="text-muted" style="font-size:13px;margin-bottom:14px;">
        All data is saved automatically in your browser's local storage. Export regularly as a backup — clearing browser data will erase it.
      </p>
      <div class="flex gap-2 flex-wrap">
        <button class="btn btn-secondary" onclick="exportData()">Export All Data (JSON)</button>
        <button class="btn btn-secondary" onclick="triggerImport()">Import Data (JSON)</button>
        <button class="btn btn-danger" onclick="confirmClear()">Clear All Data</button>
      </div>
    </div>

    <div class="card mt-4">
      <div class="card-title">How the Forecast Works</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.7;">
        <p><strong style="color:var(--text);">Net Worth = Assets + Cumulative Cash Flow − Liabilities</strong></p>
        <p style="margin-top:8px;">Each month the engine: (1) grows each asset by its growth rate or sampled investment return, (2) amortises liabilities with enabled amortisation and deducts their payment from cash, (3) applies all active events (income after tax, expenses, one-time items) to cumulative cash, then (4) computes net worth.</p>
        <p style="margin-top:8px;"><strong style="color:var(--text);">Monte Carlo</strong> runs the forecast N times, sampling each investment asset's monthly return from a normal distribution defined by its mean and standard deviation. The resulting percentile bands show the range of likely outcomes.</p>
        <p style="margin-top:8px;"><strong style="color:var(--text);">Sustainability target</strong> uses the 4% safe withdrawal rule (25× annual spending). If your net worth exceeds this line, you could theoretically sustain that spending level indefinitely from investment returns.</p>
      </div>
    </div>
  </div>`;
}

function saveSettings() {
  state.data.settings.defaultInflationRate = parseFloat(document.getElementById('s-inf').value) || 3;
  state.data.settings.defaultTaxRate = parseFloat(document.getElementById('s-tax').value) || 22;
  saveData();
  showToast('Settings saved', 'success');
}

function confirmClear() {
  showConfirm(
    'Clear All Data',
    'This will permanently delete all baselines, events, and configurations. This cannot be undone.',
    () => {
      state.data = defaultData();
      state.lastRun = null;
      state.lastRunConfig = null;
      saveData();
      navigate('dashboard');
      showToast('All data cleared');
    },
    'Clear Everything'
  );
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════

function buildSidebar() {
  const nav = [
    { page: 'dashboard',  icon: '⊞', label: 'Dashboard' },
    { page: 'baselines',  icon: '🏦', label: 'Baselines' },
    { page: 'events',     icon: '📅', label: 'Events' },
    { page: 'event-sets', icon: '🗂', label: 'Event Sets' },
    { page: 'analysis',   icon: '📈', label: 'Analysis' },
    { page: 'settings',   icon: '⚙',  label: 'Settings' },
  ];
  const activeNav = SIDEBAR_MAP[state.page] ?? state.page;

  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-logo">
      <span>Fin<span class="logo-dim">Tom</span></span>
      <button class="help-btn" onclick="showHelpModal()" title="Help &amp; Documentation">?</button>
    </div>
    <nav class="sidebar-nav">
      ${nav.map(({ page, icon, label }) => `
        <a class="nav-item${activeNav === page ? ' active' : ''}" data-page="${page}" onclick="navigate('${page}')">
          <span class="nav-icon">${icon}</span>${label}
        </a>`).join('')}
    </nav>
    <div class="sidebar-footer">
      <button class="btn btn-secondary btn-sm btn-full" onclick="exportData()">Export Data</button>
      <button class="btn btn-secondary btn-sm btn-full" onclick="triggerImport()">Import Data</button>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  buildSidebar();
  navigate('dashboard');
});
