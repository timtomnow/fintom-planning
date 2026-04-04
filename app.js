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
    // Mortgage-specific fields (optional)
    paymentMode: 'calculated',   // 'calculated' | 'set' — how the monthly payment is determined
    paymentFrequency: 'monthly', // 'monthly' | 'semi-monthly' | 'bi-weekly' (calculated mode only)
    amortizationEndDate: '',     // 'YYYY-MM' — when mortgage is fully paid off (required for calculated mode)
    termStartDate: '',           // 'YYYY-MM' — when current term started; fixes amortization period for payment calc
    termEndDate: '',             // 'YYYY-MM' — when current mortgage term expires
    renewalRate: 0,              // % annual rate assumed at renewal
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
    eventOverrides: [], // analysis-specific event edits/additions; do not affect global events
    resultsStale: false, // true when overrides changed but analysis not yet re-run
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

  // Pre-compute fixed term payments for calculated-mode liabilities that have a termStartDate.
  // Payment is calculated once from the initial balance and the full term period, then held constant
  // until a term renewal occurs, at which point it is recomputed once from the post-renewal balance.
  const _freqMap = { 'monthly': 12, 'semi-monthly': 24, 'bi-weekly': 26 };
  for (const l of liabilities) {
    const pm = l.paymentMode ?? (l.amortizationEndDate ? 'calculated' : 'set');
    if (l.useAmortization && pm === 'calculated' && l.amortizationEndDate && l.termStartDate) {
      const freq = _freqMap[l.paymentFrequency ?? 'monthly'] ?? 12;
      const periodsTotal = Math.max(1, Math.round(monthsBetween(l.termStartDate, l.amortizationEndDate) * freq / 12));
      const initRate = l.annualInterestRate ?? 0;
      const ratePerPeriod = initRate / freq / 100;
      const perPeriodPayment = ratePerPeriod === 0
        ? l.value / periodsTotal
        : l.value * ratePerPeriod / (1 - Math.pow(1 + ratePerPeriod, -periodsTotal));
      l._fixedPayment = perPeriodPayment * freq / 12;
      l._renewalDone = false;
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
        a.value = a.value * (1 + annualPct / 12 / 100);
      } else {
        a.value = a.value * (1 + (a.monthlyGrowthRate ?? 0) / 100);
      }
    }

    // 2. Amortise liabilities and deduct payments from cash (or from a linked asset)
    for (const l of liabilities) {
      if (l.useAmortization && l.value > 0) {
        // Determine effective rate — switch to renewalRate after termEndDate
        const effectiveRate = (l.termEndDate && month > l.termEndDate && (l.renewalRate ?? 0) > 0)
          ? l.renewalRate : (l.annualInterestRate ?? 0);
        const mRate = effectiveRate / 12 / 100;
        const interest = l.value * mRate;

        // Calculate monthly-equivalent payment
        let payment;
        const paymentMode = l.paymentMode ?? (l.amortizationEndDate ? 'calculated' : 'set');
        if (paymentMode === 'calculated' && l.amortizationEndDate) {
          const freqMap = { 'monthly': 12, 'semi-monthly': 24, 'bi-weekly': 26 };
          const freq = freqMap[l.paymentFrequency ?? 'monthly'] ?? 12;
          if (l._fixedPayment !== undefined) {
            // termStartDate was set: use fixed payment, recompute once at term renewal
            const pastTermEnd = l.termEndDate && month > l.termEndDate;
            if (pastTermEnd && !l._renewalDone) {
              // First month of renewed term: lock in a new fixed payment from current balance
              const remainingMonths = Math.max(1, monthsBetween(month, l.amortizationEndDate));
              const periodsRemaining = Math.max(1, Math.round(remainingMonths * freq / 12));
              const ratePerPeriod = effectiveRate / freq / 100;
              const perPeriodPayment = ratePerPeriod === 0
                ? l.value / periodsRemaining
                : l.value * ratePerPeriod / (1 - Math.pow(1 + ratePerPeriod, -periodsRemaining));
              l._fixedPayment = perPeriodPayment * freq / 12;
              l._renewalDone = true;
            }
            payment = l._fixedPayment;
          } else {
            // No termStartDate: recalculate each month from remaining time (original behaviour)
            const remainingMonths = Math.max(1, monthsBetween(month, l.amortizationEndDate));
            const periodsRemaining = Math.max(1, Math.round(remainingMonths * freq / 12));
            const ratePerPeriod = effectiveRate / freq / 100;
            const perPeriodPayment = ratePerPeriod === 0
              ? l.value / periodsRemaining
              : l.value * ratePerPeriod / (1 - Math.pow(1 + ratePerPeriod, -periodsRemaining));
            payment = perPeriodPayment * freq / 12;
          }
        } else {
          // 'set' mode: use the user-specified payment; still correctly splits into principal + interest
          payment = l.monthlyPayment ?? 0;
        }

        payment = Math.min(payment, l.value + interest);
        l.value = Math.max(0, l.value - (payment - interest));
        const payAsset = l.paymentAssetName ? assetMap.get(l.paymentAssetName) : null;
        if (payAsset) {
          payAsset.value = payAsset.value - payment;
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
            srcAsset.value = srcAsset.value - amount;
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
            srcAsset.value = srcAsset.value - amount;
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
            <th>Payment</th><th>Amortization End</th><th>Term End / Renewal</th>
            <th>Payment From</th><th>Liquid NW</th>
            <th class="text-right">Balance</th><th></th>
          </tr></thead>
          <tbody>
            ${liabs.map(l => {
              const freqLabel = { 'monthly': 'Monthly', 'semi-monthly': 'Semi-Mo.', 'bi-weekly': 'Bi-Wkly' }[l.paymentFrequency ?? 'monthly'] ?? 'Monthly';
              const effPayMode = l.paymentMode ?? (l.amortizationEndDate ? 'calculated' : 'set');
              const paymentCell = !l.useAmortization
                ? '<span class="text-muted">—</span>'
                : effPayMode === 'calculated'
                  ? `<span style="font-size:12px;">Calc. (${freqLabel}${l.termStartDate ? ', fixed period' : ''})</span>`
                  : fmt$(l.monthlyPayment);
              const amortCell = l.useAmortization && effPayMode === 'calculated' && l.amortizationEndDate
                ? `<span style="font-size:12px;">${esc(l.amortizationEndDate)}${l.termStartDate ? `<br><span class="text-muted">from ${esc(l.termStartDate)}</span>` : ''}</span>`
                : '<span class="text-muted">—</span>';
              const termCell = l.useAmortization && l.termEndDate
                ? `<span style="font-size:12px;">${esc(l.termEndDate)} @ ${fmtPct(l.renewalRate ?? 0)}</span>`
                : '<span class="text-muted">—</span>';
              return `<tr>
              <td><strong>${esc(l.name)}</strong></td>
              <td class="text-muted">${esc(l.category)}</td>
              <td class="font-mono" style="font-size:12px;">${fmtPct(l.annualInterestRate)}/yr</td>
              <td>${paymentCell}</td>
              <td>${amortCell}</td>
              <td>${termCell}</td>
              <td class="text-muted" style="font-size:12px;">${l.useAmortization && l.paymentAssetName ? esc(l.paymentAssetName) : '<span class="text-muted">—</span>'}</td>
              <td>${(l.includeInLiquidNW ?? true) ? '✓' : '<span class="text-muted">—</span>'}</td>
              <td class="text-right text-negative">${fmt$(l.value)}</td>
              <td>
                <div class="flex gap-2 justify-end">
                  <button class="btn btn-sm btn-ghost" onclick="openLiabilityModal('${bl.id}','${l.id}')">Edit</button>
                  <button class="btn btn-sm btn-ghost text-negative" onclick="deleteLiability('${bl.id}','${l.id}')">Delete</button>
                </div>
              </td>
            </tr>`; }).join('')}
          </tbody>
          <tfoot><tr>
            <td colspan="9"><strong>Total Liabilities</strong></td>
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
        <input type="number" id="a-value" value="${a.value}" step="1000">
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
        <label>Payment Mode</label>
        <div style="display:flex;gap:24px;margin-top:4px;">
          <label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer;">
            <input type="radio" name="l-pay-mode" value="calculated" onchange="onPayModeChange()"
              ${(l.paymentMode ?? (l.amortizationEndDate ? 'calculated' : 'set')) === 'calculated' ? 'checked' : ''}>
            Calculated (auto from amortization formula)
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer;">
            <input type="radio" name="l-pay-mode" value="set" onchange="onPayModeChange()"
              ${(l.paymentMode ?? (l.amortizationEndDate ? 'calculated' : 'set')) === 'set' ? 'checked' : ''}>
            Set payment (fixed amount you specify)
          </label>
        </div>
        <div class="form-hint">Calculated: payment derived from balance, rate, and amortization period. Set: you specify the exact payment; principal/interest split is still calculated correctly.</div>
      </div>
      <div id="fields-pay-calculated" ${(l.paymentMode ?? (l.amortizationEndDate ? 'calculated' : 'set')) !== 'calculated' ? 'style="display:none"' : ''}>
        <div class="form-row">
          <div class="form-group">
            <label>Payment Frequency</label>
            <select id="l-freq">
              <option value="monthly"${(l.paymentFrequency ?? 'monthly') === 'monthly' ? ' selected' : ''}>Monthly</option>
              <option value="semi-monthly"${l.paymentFrequency === 'semi-monthly' ? ' selected' : ''}>Semi-Monthly (2×/month)</option>
              <option value="bi-weekly"${l.paymentFrequency === 'bi-weekly' ? ' selected' : ''}>Bi-Weekly (26×/year)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Amortization End Date <span class="label-note">(YYYY-MM)</span></label>
            <input type="text" id="l-amort-end" value="${esc(l.amortizationEndDate ?? '')}" placeholder="e.g. 2050-01">
            <div class="form-hint">Required. When the loan is fully paid off.</div>
          </div>
        </div>
        <div class="form-group">
          <label>Term Start Date <span class="label-note">(YYYY-MM, optional)</span></label>
          <input type="text" id="l-term-start" value="${esc(l.termStartDate ?? '')}" placeholder="e.g. 2025-01">
          <div class="form-hint">When the current mortgage term started. If set, the amortization period for payment calculation is fixed from this date to the end date (gives a stable payment that matches what was agreed at term start). Leave blank to recalculate monthly from remaining time.</div>
        </div>
      </div>
      <div id="fields-pay-set" ${(l.paymentMode ?? (l.amortizationEndDate ? 'calculated' : 'set')) !== 'set' ? 'style="display:none"' : ''}>
        <div class="form-group">
          <label>Monthly Payment ($)</label>
          <input type="number" id="l-pay" value="${l.monthlyPayment}" step="10" min="0">
          <div class="form-hint">Fixed payment amount. Automatically split into principal and interest each month based on the current balance and rate.</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Term End Date <span class="label-note">(YYYY-MM, optional)</span></label>
          <input type="text" id="l-term-end" value="${esc(l.termEndDate ?? '')}" placeholder="e.g. 2030-01">
          <div class="form-hint">When the current rate term expires and the mortgage renews.</div>
        </div>
        <div class="form-group">
          <label>Rate at Renewal (%) <span class="label-note">(optional)</span></label>
          <input type="number" id="l-renewal-rate" value="${l.renewalRate ?? 0}" step="0.01" min="0">
          <div class="form-hint">Assumed annual interest rate applied after the term end date.</div>
        </div>
      </div>
      <div class="form-group">
        <label>Payment Source Asset <span class="label-note">(optional)</span></label>
        <select id="l-pay-asset">${payAssetOptions}</select>
        <div class="form-hint">Payment is deducted from this asset's balance instead of the general cash flow pool (e.g., mortgage paid from chequing account).</div>
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
      paymentMode: document.querySelector('input[name="l-pay-mode"]:checked')?.value ?? 'calculated',
      paymentFrequency: document.getElementById('l-freq')?.value ?? 'monthly',
      amortizationEndDate: document.getElementById('l-amort-end')?.value.trim() ?? '',
      termStartDate: document.getElementById('l-term-start')?.value.trim() ?? '',
      termEndDate: document.getElementById('l-term-end')?.value.trim() ?? '',
      renewalRate: parseFloat(document.getElementById('l-renewal-rate')?.value) || 0,
      monthlyPayment: parseFloat(document.getElementById('l-pay')?.value) || 0,
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
  onPayModeChange();
}

function onPayModeChange() {
  const calcEl = document.getElementById('fields-pay-calculated');
  const setEl = document.getElementById('fields-pay-set');
  if (!calcEl || !setEl) return;
  const mode = document.querySelector('input[name="l-pay-mode"]:checked')?.value ?? 'calculated';
  calcEl.style.display = mode === 'calculated' ? '' : 'none';
  setEl.style.display = mode === 'set' ? '' : 'none';
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

// Returns the effective event list for an analysis config: base events with overrides applied.
// Overrides replace matching events by ID; overrides with new IDs are appended.
function resolveEffectiveEvents(cfg) {
  const base = resolveEventSets(cfg.eventSetIds);
  const overrides = cfg.eventOverrides ?? [];
  if (!overrides.length) return base;
  const overrideMap = new Map(overrides.map(e => [e.id, e]));
  const merged = base.map(e => overrideMap.has(e.id) ? overrideMap.get(e.id) : e);
  const baseIds = new Set(base.map(e => e.id));
  overrides.filter(e => !baseIds.has(e.id)).forEach(e => merged.push(e));
  return merged;
}

// Returns events active in a given period along with their amounts and cash-flow impact.
// periodKey: 'YYYY-MM' (monthly) or 'YYYY' (yearly). viewMode: 'monthly'|'yearly'.
function getEventsForPeriod(periodKey, viewMode, events, cfg) {
  const taxRate = cfg.taxRate ?? 0;
  const calcCF = (ev, amount) => {
    const isTransfer = (ev.type === 'expense' || ev.type === 'one_time_outflow')
      && (ev.linkedAssetName || ev.linkedLiabilityName);
    if (isTransfer) return 0;
    // Money routed to an asset doesn't change the cashFlow accumulator
    if ((ev.type === 'income' || ev.type === 'one_time_inflow') && ev.depositToAssetName) return 0;
    // Money paid from an asset doesn't change the cashFlow accumulator
    if ((ev.type === 'expense' || ev.type === 'one_time_outflow') && ev.payFromAssetName) return 0;
    if (ev.type === 'income') return amount * (1 - taxRate / 100);
    if (ev.type === 'one_time_inflow') return amount;
    return -amount; // expense / one_time_outflow
  };
  const inflated = (ev, month) => {
    let amt = ev.amount;
    if (ev.inflationAdjusted && cfg.inflationRate) {
      amt *= Math.pow(1 + cfg.inflationRate / 12 / 100, monthsBetween(cfg.startDate, month));
    }
    return amt;
  };

  if (viewMode === 'monthly') {
    return events
      .filter(ev => isEventActive(ev, periodKey))
      .map(ev => {
        const amount = inflated(ev, periodKey);
        return { ev, amount, cfAmount: calcCF(ev, amount) };
      });
  }

  // Yearly: aggregate across all months in the year that fall within the analysis range
  const months = Array.from({ length: 12 }, (_, i) =>
    `${periodKey}-${String(i + 1).padStart(2, '0')}`)
    .filter(m => m >= cfg.startDate && m <= cfg.endDate);
  const byId = new Map();
  for (const month of months) {
    for (const ev of events) {
      if (!isEventActive(ev, month)) continue;
      const amount = inflated(ev, month);
      if (!byId.has(ev.id)) byId.set(ev.id, { ev, amount: 0, cfAmount: 0 });
      const entry = byId.get(ev.id);
      entry.amount += amount;
      entry.cfAmount += calcCF(ev, amount);
    }
  }
  return [...byId.values()];
}

function runAndView(configId) {
  const cfg = state.data.analysisConfigs.find(c => c.id === configId);
  if (!cfg) return;

  cfg.resultsStale = false;
  saveData();

  const primaryEvents = resolveEffectiveEvents(cfg);
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
// RESULTS — HELPERS
// ═══════════════════════════════════════════════════════════════

function reRunAnalysis() {
  const cfg = state.lastRunConfig;
  if (cfg) runAndView(cfg.id);
}

function markResultsStale() {
  if (state.lastRunConfig) state.lastRunConfig.resultsStale = true;
  saveData();
  const banner = document.getElementById('results-stale-banner');
  if (banner) banner.style.display = '';
}

function toggleEventDetail(key) {
  const row = document.getElementById('evd-' + key);
  const chev = document.getElementById('chev-' + key);
  if (!row) return;
  const open = row.style.display !== 'none';
  row.style.display = open ? 'none' : '';
  if (chev) chev.textContent = open ? '▶' : '▼';
}

function openOverrideEventModal(cfgId, existingId, defaultMonth) {
  const cfg = state.data.analysisConfigs.find(c => c.id === cfgId);
  if (!cfg) return;

  // Find existing override first, then fall back to global event, then synthetic table entries
  const existingOverride = existingId ? (cfg.eventOverrides ?? []).find(e => e.id === existingId) : null;
  const existingGlobal   = existingId ? state.data.events.find(e => e.id === existingId) : null;
  const existingTable    = existingId ? _evTableData.find(e => e.id === existingId) : null;
  let existing = existingOverride ?? existingGlobal;
  // Synthetic loan_payment entries: remap to expense so they're editable in the modal
  if (!existing && existingTable) {
    existing = existingTable.type === 'loan_payment'
      ? { ...existingTable, type: 'expense', isRecurring: false, endDate: '', linkedLiabilityName: existingTable.name }
      : { ...existingTable };
  }
  const ev = existing ? { ...existing } : { ...defaultEvent(), startDate: defaultMonth ?? today() };

  const allAssetNames = [...new Set(
    state.data.baselines.flatMap(bl => (bl.assets ?? []).map(a => a.name).filter(Boolean))
  )].sort();
  const allLiabNames = [...new Set(
    state.data.baselines.flatMap(bl => (bl.liabilities ?? []).map(l => l.name).filter(Boolean))
  )].sort();
  const assetOpts = (sel) => `<option value="">— None —</option>`
    + allAssetNames.map(n => `<option${sel === n ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const isInflow  = ev.type === 'income' || ev.type === 'one_time_inflow';
  const isOutflow = ev.type === 'expense' || ev.type === 'one_time_outflow';

  showModal(existing ? 'Edit Analysis Event' : 'Add Analysis Event', `
    <div class="alert alert-info mb-4" style="font-size:12.5px;">
      Changes here are saved to this analysis only and do not affect the global Events page.
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="oev-name" value="${esc(ev.name)}" placeholder="e.g., Monthly Salary">
      </div>
      <div class="form-group">
        <label>Category</label>
        <select id="oev-cat">${EVENT_CATEGORIES.map(c => `<option${ev.category === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Type</label>
        <select id="oev-type" onchange="onOevTypeChange()">
          <option value="income"          ${ev.type === 'income'           ? 'selected' : ''}>Income</option>
          <option value="expense"         ${ev.type === 'expense'          ? 'selected' : ''}>Expense</option>
          <option value="one_time_inflow" ${ev.type === 'one_time_inflow'  ? 'selected' : ''}>One-time Inflow</option>
          <option value="one_time_outflow"${ev.type === 'one_time_outflow' ? 'selected' : ''}>One-time Outflow</option>
        </select>
      </div>
      <div class="form-group">
        <label>Amount ($)</label>
        <input type="number" id="oev-amt" value="${ev.amount}" step="100">
      </div>
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="oev-rec" ${ev.isRecurring ? 'checked' : ''} onchange="onOevRecChange()">
        Recurring — happens every month
      </label>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label id="oev-start-lbl">${ev.isRecurring ? 'Start Date' : 'Date'}</label>
        <input type="month" id="oev-start" value="${ev.startDate}">
      </div>
      <div class="form-group" id="oev-end-wrap" ${!ev.isRecurring ? 'style="display:none"' : ''}>
        <label>End Date <span class="label-note">(blank = indefinite)</span></label>
        <input type="month" id="oev-end" value="${ev.endDate ?? ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="checkbox-label"><input type="checkbox" id="oev-inf" ${ev.inflationAdjusted ? 'checked' : ''}> Adjust for inflation</label>
      </div>
    </div>
    <div class="form-group" id="oev-deposit-wrap"${isInflow ? '' : ' style="display:none"'}>
      <label>Deposit into Asset <span class="label-note">(income / inflow only)</span></label>
      <select id="oev-deposit-asset">${assetOpts(ev.depositToAssetName ?? '')}</select>
    </div>
    <div class="form-group" id="oev-pay-from-wrap"${isOutflow ? '' : ' style="display:none"'}>
      <label>Pay from Asset <span class="label-note">(expense / outflow only)</span></label>
      <select id="oev-pay-from-asset">${assetOpts(ev.payFromAssetName ?? '')}</select>
    </div>
    <div class="form-group" id="oev-link-wrap"${isOutflow ? '' : ' style="display:none"'}>
      <label>Transfer to Asset <span class="label-note">(expense / outflow only)</span></label>
      <select id="oev-link-asset">${assetOpts(ev.linkedAssetName ?? '')}</select>
    </div>
    <div class="form-group" id="oev-link-liab-wrap"${isOutflow ? '' : ' style="display:none"'}>
      <label>Extra Payment to Liability <span class="label-note">(expense / outflow only)</span></label>
      <select id="oev-link-liab"><option value="">— None —</option>${allLiabNames.map(n => `<option${(ev.linkedLiabilityName ?? '') === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
    </div>
  `, () => {
    const name = document.getElementById('oev-name').value.trim();
    if (!name) { showToast('Name is required', 'error'); return false; }
    const startDate = document.getElementById('oev-start').value;
    if (!startDate) { showToast('Date is required', 'error'); return false; }
    const type = document.getElementById('oev-type').value;
    const isOut = type === 'expense' || type === 'one_time_outflow';
    const isIn  = type === 'income'  || type === 'one_time_inflow';
    const updated = {
      id: ev.id,
      name,
      category: document.getElementById('oev-cat').value,
      type,
      amount: parseFloat(document.getElementById('oev-amt').value) || 0,
      stdDevAmount: 0,
      isRecurring: document.getElementById('oev-rec').checked,
      startDate,
      endDate: document.getElementById('oev-end').value || '',
      inflationAdjusted: document.getElementById('oev-inf').checked,
      notes: '',
      linkedAssetName:     isOut ? document.getElementById('oev-link-asset').value     : '',
      depositToAssetName:  isIn  ? document.getElementById('oev-deposit-asset').value  : '',
      payFromAssetName:    isOut ? document.getElementById('oev-pay-from-asset').value  : '',
      linkedLiabilityName: isOut ? document.getElementById('oev-link-liab').value       : '',
    };
    if (!cfg.eventOverrides) cfg.eventOverrides = [];
    const idx = cfg.eventOverrides.findIndex(e => e.id === updated.id);
    if (idx >= 0) cfg.eventOverrides[idx] = updated;
    else cfg.eventOverrides.push(updated);
    markResultsStale();
    showToast(existing ? 'Analysis event updated' : 'Analysis event added', 'success');
    return true;
  });
}

function onOevTypeChange() {
  const type = document.getElementById('oev-type').value;
  const isOut = type === 'expense' || type === 'one_time_outflow';
  const isIn  = type === 'income'  || type === 'one_time_inflow';
  const oneTime = type === 'one_time_inflow' || type === 'one_time_outflow';
  document.getElementById('oev-deposit-wrap').style.display   = isIn  ? '' : 'none';
  document.getElementById('oev-pay-from-wrap').style.display  = isOut ? '' : 'none';
  document.getElementById('oev-link-wrap').style.display      = isOut ? '' : 'none';
  document.getElementById('oev-link-liab-wrap').style.display = isOut ? '' : 'none';
  if (oneTime) {
    document.getElementById('oev-rec').checked = false;
    document.getElementById('oev-end-wrap').style.display = 'none';
  }
}

function onOevRecChange() {
  const rec = document.getElementById('oev-rec').checked;
  document.getElementById('oev-end-wrap').style.display = rec ? '' : 'none';
  document.getElementById('oev-start-lbl').textContent   = rec ? 'Start Date' : 'Date';
}

// ═══════════════════════════════════════════════════════════════
// EVENTS TABLE (issue #18) — module-level filter/page state
// ═══════════════════════════════════════════════════════════════

let _evTablePage = 0;
let _evTableCatFilter  = new Set(); // empty = show all
let _evTableTypeFilter = new Set(); // empty = show all
let _evTableNameFilter = '';
let _evTableData = []; // populated by renderResults

const EV_PAGE_SIZE = 25;

function renderEventsTableSection() {
  const typeLabel = t => ({ income: 'Income', expense: 'Expense', one_time_inflow: 'One-time In', one_time_outflow: 'One-time Out', loan_payment: 'Loan Payment' }[t] ?? t);
  const badgeClass = t => ({ income: 'income', expense: 'expense', one_time_inflow: 'one-time', one_time_outflow: 'one-time', loan_payment: 'neutral' }[t] ?? '');

  const cfg = state.lastRunConfig;
  const taxRate = cfg?.taxRate ?? 0;
  const bl = cfg ? state.data.baselines.find(b => b.id === cfg.baselineId) : null;

  const calcRowCF = (e) => {
    if (e.type === 'loan_payment') {
      const liab = bl?.liabilities?.find(l => l.id === e._liabId);
      return liab?.paymentAssetName ? 0 : -e.amount;
    }
    const isTransfer = (e.type === 'expense' || e.type === 'one_time_outflow')
      && (e.linkedAssetName || e.linkedLiabilityName);
    if (isTransfer) return 0;
    if ((e.type === 'income' || e.type === 'one_time_inflow') && e.depositToAssetName) return 0;
    if ((e.type === 'expense' || e.type === 'one_time_outflow') && e.payFromAssetName) return 0;
    if (e.type === 'income') return e.amount * (1 - taxRate / 100);
    if (e.type === 'one_time_inflow') return e.amount;
    return -e.amount;
  };

  const allCats  = [...new Set(_evTableData.map(e => e.category))].sort();
  const allTypes = [...new Set(_evTableData.map(e => e.type))].sort();

  const filtered = _evTableData.filter(e => {
    if (_evTableNameFilter && !e.name.toLowerCase().includes(_evTableNameFilter.toLowerCase())) return false;
    if (_evTableCatFilter.size  && !_evTableCatFilter.has(e.category))  return false;
    if (_evTableTypeFilter.size && !_evTableTypeFilter.has(e.type))     return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / EV_PAGE_SIZE));
  const page = Math.min(_evTablePage, totalPages - 1);
  const pageData = filtered.slice(page * EV_PAGE_SIZE, (page + 1) * EV_PAGE_SIZE);

  const catDD = allCats.map(c => `<label class="ev-filter-item"><input type="checkbox" ${_evTableCatFilter.has(c) ? 'checked' : ''} onchange="evTableFilter('cat','${esc(c)}',this.checked)"> ${esc(c)}</label>`).join('');
  const typeDD = allTypes.map(t => `<label class="ev-filter-item"><input type="checkbox" ${_evTableTypeFilter.has(t) ? 'checked' : ''} onchange="evTableFilter('type','${esc(t)}',this.checked)"> ${typeLabel(t)}</label>`).join('');

  const rows = pageData.map(e => {
    const cfAmount = calcRowCF(e);
    const cfClass = cfAmount > 0 ? 'text-positive' : cfAmount < 0 ? 'text-negative' : 'text-muted';
    const cfStr   = cfAmount === 0 ? '—' : (cfAmount > 0 ? '+' : '') + fmt$(cfAmount);
    const editAction = `openOverrideEventModal('${esc(cfg?.id ?? '')}','${esc(e.id)}','${esc(e.startDate)}')`;
    return `<tr>
      <td class="nowrap" style="font-size:12px;">${monthLabel(e.startDate)}</td>
      <td><strong>${esc(e.name)}</strong></td>
      <td class="text-muted">${esc(e.category)}</td>
      <td><span class="badge ${badgeClass(e.type)}">${typeLabel(e.type)}</span></td>
      <td class="text-right font-mono">${fmt$(e.amount)}</td>
      <td class="text-right font-mono ${cfClass}">${cfStr}</td>
      <td><button class="btn btn-sm btn-ghost" onclick="${editAction}">Edit</button></td>
    </tr>`;
  }).join('');

  const pagerHtml = totalPages > 1 ? `
    <div class="flex items-center gap-2 mt-3" style="font-size:13px;">
      <button class="btn btn-sm btn-ghost" onclick="evTablePage(${page - 1})" ${page === 0 ? 'disabled' : ''}>← Prev</button>
      <span class="text-muted">Page ${page + 1} of ${totalPages} &nbsp;(${filtered.length} events)</span>
      <button class="btn btn-sm btn-ghost" onclick="evTablePage(${page + 1})" ${page >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
    </div>` : `<div class="text-muted mt-2" style="font-size:13px;">${filtered.length} event${filtered.length !== 1 ? 's' : ''}</div>`;

  return `
    <div class="section-header" style="margin-bottom:12px;align-items:flex-start;gap:12px;flex-wrap:wrap;">
      <div class="section-title">All Analysis Events</div>
      <div class="flex gap-2 flex-wrap items-center">
        <input type="search" placeholder="Search name…" value="${esc(_evTableNameFilter)}"
          oninput="evTableNameSearch(this.value)"
          style="width:160px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
        <div class="ev-filter-wrap">
          <button class="btn btn-sm btn-ghost" onclick="toggleEvFilterDD('ev-dd-cat')">Category${_evTableCatFilter.size ? ` (${_evTableCatFilter.size})` : ''} ▾</button>
          <div id="ev-dd-cat" class="ev-filter-dropdown" style="display:none;">${catDD}</div>
        </div>
        <div class="ev-filter-wrap">
          <button class="btn btn-sm btn-ghost" onclick="toggleEvFilterDD('ev-dd-type')">Type${_evTableTypeFilter.size ? ` (${_evTableTypeFilter.size})` : ''} ▾</button>
          <div id="ev-dd-type" class="ev-filter-dropdown" style="display:none;">${typeDD}</div>
        </div>
        ${(_evTableCatFilter.size || _evTableTypeFilter.size || _evTableNameFilter)
          ? `<button class="btn btn-sm btn-ghost text-negative" onclick="evTableClearFilters()">Clear filters</button>` : ''}
        <button class="btn btn-sm btn-secondary" onclick="exportEventsCSV()">Export CSV</button>
      </div>
    </div>
    <div class="result-table-wrap">
      <table>
        <thead><tr>
          <th>Month</th><th>Name</th><th>Category</th><th>Type</th>
          <th class="text-right">Amount</th>
          <th class="text-right">Cash Flow</th>
          <th></th>
        </tr></thead>
        <tbody id="ev-table-body">${rows}</tbody>
      </table>
    </div>
    ${pagerHtml}`;
}

function toggleEvFilterDD(id) {
  // Close all other dropdowns first
  document.querySelectorAll('.ev-filter-dropdown').forEach(el => {
    if (el.id !== id) el.style.display = 'none';
  });
  const dd = document.getElementById(id);
  if (dd) dd.style.display = dd.style.display === 'none' ? '' : 'none';
}

function evTableFilter(col, value, checked) {
  if (col === 'cat')  { checked ? _evTableCatFilter.add(value)  : _evTableCatFilter.delete(value); }
  if (col === 'type') { checked ? _evTableTypeFilter.add(value) : _evTableTypeFilter.delete(value); }
  _evTablePage = 0;
  _refreshEvTable();
}

function evTableNameSearch(val) {
  _evTableNameFilter = val;
  _evTablePage = 0;
  _refreshEvTable();
}

function evTablePage(p) {
  _evTablePage = p;
  _refreshEvTable();
}

function evTableClearFilters() {
  _evTableCatFilter.clear();
  _evTableTypeFilter.clear();
  _evTableNameFilter = '';
  _evTablePage = 0;
  _refreshEvTable();
}

function _refreshEvTable() {
  const wrap = document.getElementById('ev-table-section');
  if (wrap) wrap.innerHTML = renderEventsTableSection();
}

function exportEventsCSV() {
  const cfg = state.lastRunConfig;
  const taxRate = cfg?.taxRate ?? 0;
  const bl = cfg ? state.data.baselines.find(b => b.id === cfg.baselineId) : null;
  const calcRowCF = (e) => {
    if (e.type === 'loan_payment') {
      const liab = bl?.liabilities?.find(l => l.id === e._liabId);
      return liab?.paymentAssetName ? 0 : -e.amount;
    }
    const isTransfer = (e.type === 'expense' || e.type === 'one_time_outflow') && (e.linkedAssetName || e.linkedLiabilityName);
    if (isTransfer) return 0;
    if ((e.type === 'income' || e.type === 'one_time_inflow') && e.depositToAssetName) return 0;
    if ((e.type === 'expense' || e.type === 'one_time_outflow') && e.payFromAssetName) return 0;
    if (e.type === 'income') return e.amount * (1 - taxRate / 100);
    if (e.type === 'one_time_inflow') return e.amount;
    return -e.amount;
  };
  const rows = [['Name','Category','Type','Amount','CashFlow','Month']];
  for (const e of _evTableData) {
    rows.push([e.name, e.category, e.type, e.amount, calcRowCF(e), e.startDate]);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'analysis-events.csv' });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

  // Populate events table data before rendering
  _evTableData = resolveEffectiveEvents(cfg);

  // Append one synthetic loan-payment entry per month per amortizing liability.
  // Pre-capture user events before synthetics are added for extra-principal lookup.
  if (pBl && run.detResults) {
    const userEvents = _evTableData.slice();
    for (const l of (pBl.liabilities ?? [])) {
      if (!l.useAmortization) continue;
      for (let i = 0; i < run.detResults.length; i++) {
        const currResult = run.detResults[i];
        const prevResult = i > 0 ? run.detResults[i - 1] : null;
        const month = currResult.month;
        const currBalance = currResult.liabSnapshots?.find(s => s.id === l.id)?.value ?? 0;
        const prevBalance = prevResult
          ? (prevResult.liabSnapshots?.find(s => s.id === l.id)?.value ?? l.value)
          : l.value;
        if (prevBalance <= 0) continue;
        const effectiveRate = (l.termEndDate && month > l.termEndDate && (l.renewalRate ?? 0) > 0)
          ? l.renewalRate : (l.annualInterestRate ?? 0);
        const interest = prevBalance * effectiveRate / 12 / 100;
        // Exclude extra principal payments from events so they stay as separate rows
        const extraPrincipal = userEvents
          .filter(ev => ev.linkedLiabilityName === l.name && isEventActive(ev, month))
          .reduce((s, ev) => s + (ev.amount ?? 0), 0);
        const payment = Math.max(0, (prevBalance - currBalance - extraPrincipal) + interest);
        if (payment <= 0) continue;
        _evTableData.push({
          id: `liab-payment-${l.id}-${month}`,
          name: l.name,
          category: l.category ?? 'Liability',
          type: 'loan_payment',
          amount: payment,
          startDate: month,
          isRecurring: false,
          inflationAdjusted: false,
          _liabId: l.id,
        });
      }
    }
  }
  _evTablePage = 0;

  const numCols = 12 + (cmp ? 1 : 0) + (mc ? 3 : 0);
  // Exclude synthetic loan_payment entries from event processing — they're handled by liabEntries
  const effectiveEvents = _evTableData.filter(e => e.type !== 'loan_payment');
  const typeLabel = t => ({ income: 'Income', expense: 'Expense', one_time_inflow: 'One-time In', one_time_outflow: 'One-time Out', loan_payment: 'Loan Payment' }[t] ?? t);
  const badgeClass = t => ({ income: 'income', expense: 'expense', one_time_inflow: 'one-time', one_time_outflow: 'one-time', loan_payment: 'neutral' }[t] ?? '');

  const renderPeriodEvents = (periodKey) => {
    const periodEvs = getEventsForPeriod(periodKey, vm, effectiveEvents, cfg);

    // Build amortizing liability payment rows from the last run's snapshots.
    // Extra principal payments (events with linkedLiabilityName) are excluded here —
    // they already appear as separate event rows above.
    const liabEntries = [];
    const detMonthly = run.detResults; // always the monthly array
    if (pBl && detMonthly) {
      for (const l of (pBl.liabilities ?? [])) {
        if (!l.useAmortization) continue;
        const months = vm === 'monthly'
          ? [periodKey]
          : Array.from({ length: 12 }, (_, i) => `${periodKey}-${String(i + 1).padStart(2, '0')}`)
              .filter(m => m >= cfg.startDate && m <= cfg.endDate);
        let totalPayment = 0;
        let totalCF = 0;
        for (const month of months) {
          const currIdx = detMonthly.findIndex(r => r.month === month);
          if (currIdx < 0) continue;
          const currResult = detMonthly[currIdx];
          const prevResult = currIdx > 0 ? detMonthly[currIdx - 1] : null;
          const currBalance = currResult.liabSnapshots?.find(s => s.id === l.id)?.value ?? 0;
          const prevBalance = prevResult
            ? (prevResult.liabSnapshots?.find(s => s.id === l.id)?.value ?? l.value)
            : l.value;
          if (prevBalance <= 0) continue;
          const effectiveRate = (l.termEndDate && month > l.termEndDate && (l.renewalRate ?? 0) > 0)
            ? l.renewalRate : (l.annualInterestRate ?? 0);
          const interest = prevBalance * effectiveRate / 12 / 100;
          // Exclude extra principal payments made by events in this month
          const extraPrincipal = effectiveEvents
            .filter(ev => ev.linkedLiabilityName === l.name && isEventActive(ev, month))
            .reduce((s, ev) => {
              let amt = ev.amount ?? 0;
              if (ev.inflationAdjusted && cfg.inflationRate) {
                amt *= Math.pow(1 + cfg.inflationRate / 12 / 100, monthsBetween(cfg.startDate, month));
              }
              return s + amt;
            }, 0);
          const payment = Math.max(0, (prevBalance - currBalance - extraPrincipal) + interest);
          if (payment <= 0) continue;
          totalPayment += payment;
          if (!l.paymentAssetName) totalCF -= payment;
        }
        if (totalPayment > 0) {
          liabEntries.push({ liabId: l.id, name: l.name, category: l.category ?? 'Liability', payment: totalPayment, cfAmount: totalCF });
        }
      }
    }

    if (!periodEvs.length && !liabEntries.length) {
      return `<div style="padding:8px 16px 12px;font-size:13px;color:var(--text-muted);">No events in this period.
        <button class="btn btn-sm btn-ghost" style="margin-left:8px;" onclick="openOverrideEventModal('${esc(cfg.id)}',null,'${esc(vm === 'yearly' ? periodKey + '-01' : periodKey)}')">+ Add Event</button>
      </div>`;
    }
    const evRows = periodEvs.map(({ ev, amount, cfAmount }) => `<tr>
      <td style="padding:5px 8px;">${esc(ev.name)}</td>
      <td style="padding:5px 8px;" class="text-muted">${esc(ev.category)}</td>
      <td style="padding:5px 8px;"><span class="badge ${badgeClass(ev.type)}">${typeLabel(ev.type)}</span></td>
      <td style="padding:5px 8px;" class="text-right font-mono">${fmt$(amount)}</td>
      <td style="padding:5px 8px;" class="text-right font-mono ${cfAmount > 0 ? 'text-positive' : cfAmount < 0 ? 'text-negative' : 'text-muted'}">${cfAmount === 0 ? '—' : (cfAmount > 0 ? '+' : '') + fmt$(cfAmount)}</td>
      <td style="padding:5px 8px;">
        <button class="btn btn-sm btn-ghost" onclick="openOverrideEventModal('${esc(cfg.id)}','${esc(ev.id)}','${esc(vm === 'yearly' ? periodKey + '-01' : periodKey)}')">Edit</button>
      </td>
    </tr>`).join('');
    const liabRows = liabEntries.map(({ liabId, name, category, payment, cfAmount }) => `<tr>
      <td style="padding:5px 8px;">${esc(name)}</td>
      <td style="padding:5px 8px;" class="text-muted">${esc(category)}</td>
      <td style="padding:5px 8px;"><span class="badge ${badgeClass('loan_payment')}">${typeLabel('loan_payment')}</span></td>
      <td style="padding:5px 8px;" class="text-right font-mono">${fmt$(payment)}</td>
      <td style="padding:5px 8px;" class="text-right font-mono ${cfAmount < 0 ? 'text-negative' : 'text-muted'}">${cfAmount === 0 ? '—' : fmt$(cfAmount)}</td>
      <td style="padding:5px 8px;">
        <button class="btn btn-sm btn-ghost" onclick="openOverrideEventModal('${esc(cfg.id)}','${vm === 'monthly' ? `liab-payment-${esc(liabId)}-${esc(periodKey)}` : ''}','${esc(vm === 'yearly' ? periodKey + '-01' : periodKey)}')">Edit</button>
      </td>
    </tr>`).join('');
    return `<div style="padding:6px 12px 12px;">
      <table style="font-size:12.5px;width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="padding:5px 8px;text-align:left;font-weight:600;">Name</th>
          <th style="padding:5px 8px;text-align:left;font-weight:600;">Category</th>
          <th style="padding:5px 8px;text-align:left;font-weight:600;">Type</th>
          <th style="padding:5px 8px;text-align:right;font-weight:600;">Amount</th>
          <th style="padding:5px 8px;text-align:right;font-weight:600;">Cash Flow</th>
          <th></th>
        </tr></thead>
        <tbody>${evRows}${liabRows}</tbody>
      </table>
      <button class="btn btn-sm btn-ghost" style="margin-top:6px;font-size:12px;" onclick="openOverrideEventModal('${esc(cfg.id)}',null,'${esc(vm === 'yearly' ? periodKey + '-01' : periodKey)}')">+ Add Event to this period</button>
    </div>`;
  };

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
        <button class="btn btn-primary btn-sm" onclick="reRunAnalysis()">Re-Run</button>
        <button class="btn btn-secondary btn-sm" onclick="exportCSV()">Export CSV</button>
        <button class="btn btn-secondary btn-sm" onclick="navigate('analysis')">← Back</button>
      </div>
    </div>

    <!-- Stale warning banner -->
    <div id="results-stale-banner" class="alert alert-warning mb-4" ${cfg.resultsStale ? '' : 'style="display:none"'}>
      Analysis results are out of date — event overrides have been changed.
      <a href="#" onclick="reRunAnalysis();return false;" style="margin-left:8px;font-weight:600;">Re-run now →</a>
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
              const key = r.month; // 'YYYY-MM' or 'YYYY'
              acc.html += `<tr class="result-row" style="cursor:pointer;" onclick="toggleEventDetail('${key}')">
              <td class="nowrap">
                <span id="chev-${key}" style="display:inline-block;width:14px;font-size:9px;color:var(--text-muted);vertical-align:middle;">▶</span>
                ${vm === 'yearly' ? r.month : monthLabel(r.month)}
              </td>
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
            </tr>
            <tr id="evd-${key}" style="display:none;">
              <td colspan="${numCols}" style="padding:0;background:var(--bg,#f8f9fb);border-bottom:1px solid var(--border);">
                ${renderPeriodEvents(key)}
              </td>
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

    <!-- All Analysis Events table (issue #18) -->
    <div class="card" style="margin-top:20px;" id="ev-table-section">
      ${renderEventsTableSection()}
    </div>

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
