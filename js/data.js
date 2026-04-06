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
    category: 'Investment Account',
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
    scenarioTitle: '', compareScenarioTitle: '',
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
    if (!raw) { state.data = defaultData(); return; }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object'
        || !Array.isArray(parsed.baselines)
        || !Array.isArray(parsed.events)
        || !Array.isArray(parsed.analysisConfigs)) {
      console.warn('FinTom: stored data is malformed — resetting to default');
      state.data = defaultData();
      return;
    }
    state.data = parsed;
    // Migrate older saves that predate event sets
    state.data.eventSets = state.data.eventSets ?? [];
  } catch (e) {
    console.warn('FinTom: could not parse stored data — resetting to default', e);
    state.data = defaultData();
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      showToast('Storage full — export a backup and clear some data', 'error');
    }
  }
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
        const parsed = JSON.parse(ev.target.result);
        if (!parsed || typeof parsed !== 'object'
            || !Array.isArray(parsed.baselines)
            || !Array.isArray(parsed.events)
            || !Array.isArray(parsed.analysisConfigs)) {
          showToast('Invalid file — missing required fields', 'error');
          return;
        }
        state.data = parsed;
        state.data.eventSets = state.data.eventSets ?? [];
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
