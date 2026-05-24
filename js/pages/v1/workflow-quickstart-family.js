'use strict';

// ═══════════════════════════════════════════════════════════════
// 20-YEAR BASIC OUTLOOK
// ═══════════════════════════════════════════════════════════════
//
// User-facing name: "20-year basic outlook". Internal id remains
// 'quickstart-family' so workflow instances persisted by earlier
// versions still resolve. The `qsf` function prefix is similarly
// historical — kept to avoid churn across all the onclick handlers.
//
// Branching 4/5-step workflow with 3 entry paths on step 1:
//   1. "Use a sample scenario" — currently only "Family with
//      mortgage". Adds a pick-sample step before generation.
//   2. "Start from scratch"    — empty baseline + empty event set;
//      user fills it in on the Review step via + Add buttons.
//   3. "Guided questionnaire"  — disabled placeholder.
//
// All paths share the common backbone: choose-path → … →
// review → confirm-run → summary. Generation is idempotent and
// path-locked: once records are produced, the user can't switch
// paths without discarding the workflow first.

// ═══════════════════════════════════════════════════════════════
// QUESTIONNAIRE — topic list
// ═══════════════════════════════════════════════════════════════
// The set of topics the user can opt in/out of on the q-topics step.
// Order matters — it determines the order of subsequent questions.
// Each topic has a key (used in step keys, e.g. 'q-income') and a
// user-facing label + description shown on the q-topics checklist.

// Order matters in two ways:
//   1. Assets & liabilities come BEFORE events. Events can reference
//      assets (depositToAssetName, payFromAssetName, linkedAssetName)
//      and liabilities (linkedLiabilityName), so those records need
//      to exist by the time the user is filling in events.
//   2. 'assumptions' is first so the rates the user picks here become
//      the defaults baked into every asset/liability/event below.
const QSF_QUESTIONNAIRE_TOPICS = [
  { key: 'assumptions', label: 'Assumptions',              desc: 'Default rates: inflation, income tax, asset growth, investment return & volatility.' },
  // Assets & liabilities
  { key: 'savings',     label: 'Savings & investments',    desc: 'Cash, emergency fund, investment accounts, retirement accounts.' },
  { key: 'housing',     label: 'Housing',                  desc: 'Rent or own — and related monthly expenses.' },
  { key: 'debts',       label: 'Other debts',              desc: 'Auto loans, student loans, lines of credit (not the mortgage).' },
  // Events (referenced after assets/liabilities are defined)
  { key: 'income',      label: 'Income',                   desc: 'Salary, partner\'s salary, side income — including any future changes.' },
  { key: 'recurring',   label: 'Other recurring expenses', desc: 'Groceries, transportation, healthcare, entertainment, etc.' },
  { key: 'onetime',     label: 'Upcoming one-time events', desc: 'Planned purchases, bonuses, gifts, or other one-off cash flows.' },
];

// ═══════════════════════════════════════════════════════════════
// SELECTION HELPERS
// ═══════════════════════════════════════════════════════════════

function qsfSelectPath(workflowId, path) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  if (path !== 'sample' && path !== 'scratch' && path !== 'questionnaire') return;
  // Once records are generated, the path is locked. Selecting a
  // different option from the chosen path is rejected with a toast.
  const locked = (wf.producedRecordIds?.baselineIds?.length ?? 0) > 0;
  if (locked && wf.draftData.path && wf.draftData.path !== path) {
    showToast('Path is locked. Exit and discard the workflow to start over.', 'error');
    return;
  }
  wf.draftData.path = path;
  wf.updatedAt = new Date().toISOString();
  saveData();
  navigate('v1-workflow', { workflowId });
}

function qsfSelectSample(workflowId, sampleId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  wf.draftData.sampleId = sampleId;
  wf.updatedAt = new Date().toISOString();
  saveData();
  navigate('v1-workflow', { workflowId });
}

function qsfRenameScenario(workflowId, newName) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  const cfgId = wf.producedRecordIds.analysisConfigIds[0];
  const cfg = state.data.analysisConfigs.find(c => c.id === cfgId);
  if (!cfg) return;
  const trimmed = (newName || '').trim();
  if (!trimmed) {
    const input = document.getElementById('qsf-scenario-name');
    if (input) input.value = cfg.name;
    return;
  }
  cfg.name = trimmed;
  wf.updatedAt = new Date().toISOString();
  saveData();
}

function qsfGenerateReport(workflowId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) { generateSummaryReport(); return; }
  const cfgId = wf.producedRecordIds.analysisConfigIds[0];
  const cfg = state.data.analysisConfigs.find(c => c.id === cfgId);
  generateSummaryReport(cfg?.name);
}

// ═══════════════════════════════════════════════════════════════
// RECORD GENERATION
// ═══════════════════════════════════════════════════════════════
// Idempotent: if records already exist on this workflow instance,
// generation is skipped (so going back-and-forward doesn't duplicate).

function qsfGenerateRecords(wf) {
  if (wf.producedRecordIds.baselineIds.length > 0) return; // already generated

  const start = today();
  const amortEnd = addMonths(start, 300); // 25 years
  const termEnd = addMonths(start, 60);   // 5-year term

  // ── Baseline ────────────────────────────────────────────────
  const blName = uniqueName('Family with Mortgage Plan', state.data.baselines.map(b => b.name));
  const bl = {
    id: uuid(),
    name: blName,
    description: 'Generated by the Family with Mortgage quick-start workflow.',
    date: start,
    createdAt: new Date().toISOString(),
    assets: [
      { id: uuid(), name: 'Joint Chequing',       value:  15000, category: 'Bank Account',       isInvestment: false, isLiquid: true,  monthlyGrowthRate: 0,    annualMeanReturn: 7, annualStdDev: 15 },
      { id: uuid(), name: 'Emergency Fund',       value:  20000, category: 'Bank Account',       isInvestment: false, isLiquid: true,  monthlyGrowthRate: 0.35, annualMeanReturn: 7, annualStdDev: 15 },
      { id: uuid(), name: 'TFSA',                 value:  80000, category: 'Investment Account', isInvestment: true,  isLiquid: true,  monthlyGrowthRate: 0,    annualMeanReturn: 8, annualStdDev: 14 },
      { id: uuid(), name: 'RRSP',                 value: 120000, category: 'Investment Account', isInvestment: true,  isLiquid: false, monthlyGrowthRate: 0,    annualMeanReturn: 7, annualStdDev: 12 },
      { id: uuid(), name: 'Primary Residence',    value: 750000, category: 'Real Estate',        isInvestment: false, isLiquid: false, monthlyGrowthRate: 0.33, annualMeanReturn: 7, annualStdDev: 15 },
    ],
    liabilities: [
      {
        id: uuid(), name: 'Primary Mortgage', value: 520000, category: 'Mortgage',
        annualInterestRate: 5.25, useAmortization: true,
        monthlyPayment: 0, includeInLiquidNW: false,
        paymentAssetName: 'Joint Chequing',
        paymentMode: 'calculated', paymentFrequency: 'monthly',
        amortizationEndDate: amortEnd,
        termStartDate: start,
        termEndDate: termEnd,
        renewalRate: 4.5,
      },
    ],
  };
  state.data.baselines.push(bl);
  wf.producedRecordIds.baselineIds.push(bl.id);

  // ── Events ──────────────────────────────────────────────────
  // Mortgage payment is handled by amortization on the liability,
  // NOT as a separate event (matches CLAUDE.md guidance).
  const evDefs = [
    { name: 'Primary Income',            amount: 7500, type: 'income',  category: 'Income',               inflation: true,  deposit: 'Joint Chequing' },
    { name: 'Partner Income',            amount: 5800, type: 'income',  category: 'Income',               inflation: true,  deposit: 'Joint Chequing' },
    { name: 'Property Taxes',            amount:  550, type: 'expense', category: 'Housing',              inflation: true,  payFrom: 'Joint Chequing' },
    { name: 'Utilities',                 amount:  280, type: 'expense', category: 'Utilities',            inflation: true,  payFrom: 'Joint Chequing' },
    { name: 'Groceries & Food',          amount: 1100, type: 'expense', category: 'Food & Dining',        inflation: true,  payFrom: 'Joint Chequing' },
    { name: 'Transportation',            amount:  450, type: 'expense', category: 'Transportation',       inflation: true,  payFrom: 'Joint Chequing' },
    { name: 'Entertainment & Dining',    amount:  320, type: 'expense', category: 'Entertainment',        inflation: true,  payFrom: 'Joint Chequing' },
    { name: 'Childcare',                 amount: 1400, type: 'expense', category: 'Childcare',            inflation: true,  payFrom: 'Joint Chequing' },
    { name: 'Vacation (Monthly Avg)',    amount:  400, type: 'expense', category: 'Travel',               inflation: true,  payFrom: 'Joint Chequing' },
    { name: 'Monthly TFSA Contribution', amount:  800, type: 'expense', category: 'Savings & Investment', inflation: false, payFrom: 'Joint Chequing', linkAsset: 'TFSA' },
    { name: 'Monthly RRSP Contribution', amount:  700, type: 'expense', category: 'Savings & Investment', inflation: false, payFrom: 'Joint Chequing', linkAsset: 'RRSP' },
  ];

  const newEventIds = [];
  for (const def of evDefs) {
    const ev = {
      id: uuid(),
      name: def.name,
      notes: '',
      category: def.category,
      type: def.type,
      amount: def.amount,
      stdDevAmount: 0,
      isRecurring: true,
      startDate: start,
      endDate: '',
      inflationAdjusted: !!def.inflation,
      depositToAssetName: def.deposit ?? '',
      payFromAssetName:   def.payFrom ?? '',
      linkedAssetName:    def.linkAsset ?? '',
      linkedLiabilityName: '',
    };
    state.data.events.push(ev);
    wf.producedRecordIds.eventIds.push(ev.id);
    newEventIds.push(ev.id);
  }

  // ── Event Set ───────────────────────────────────────────────
  const es = {
    id: uuid(),
    name: uniqueName('Family Plan Events', state.data.eventSets.map(s => s.name)),
    description: 'Income, recurring household expenses, and monthly savings contributions for the Family quick-start.',
    eventIds: newEventIds,
  };
  state.data.eventSets.push(es);
  wf.producedRecordIds.eventSetIds.push(es.id);

  // ── Analysis Config ─────────────────────────────────────────
  const cfg = {
    id: uuid(),
    name: uniqueName('20-Year Family Plan', state.data.analysisConfigs.map(c => c.name)),
    scenarioTitle: '', compareScenarioTitle: '',
    baselineId: bl.id, compareBaselineId: '',
    eventSetIds: [es.id], compareEventSetIds: [],
    startDate: start,
    endDate: addMonths(start, 240), // 20 years
    viewMode: 'yearly',
    inflationRate: state.data.settings?.defaultInflationRate ?? 3,
    taxRate:       state.data.settings?.defaultTaxRate ?? 30,
    monteCarlo: { enabled: true, numSimulations: 500, standardOfLivingMonthly: 7000 },
    eventOverrides: [],
    resultsStale: false,
  };
  state.data.analysisConfigs.push(cfg);
  wf.producedRecordIds.analysisConfigIds.push(cfg.id);

  wf.updatedAt = new Date().toISOString();
  saveData();
}

// Generation for the "Start from scratch" path. Creates an empty
// baseline, empty event set, and a default 20-year analysis config.
// User fills in records via the + Add buttons on the Review step.
// Idempotent — bails if records already exist on this workflow.
function qsfGenerateScratchRecords(wf) {
  if (wf.producedRecordIds.baselineIds.length > 0) return;

  const start = today();

  const bl = {
    id: uuid(),
    name: uniqueName('Custom Plan', state.data.baselines.map(b => b.name)),
    description: 'Generated by the 20-year basic outlook workflow (start from scratch).',
    date: start,
    createdAt: new Date().toISOString(),
    assets: [],
    liabilities: [],
  };
  state.data.baselines.push(bl);
  wf.producedRecordIds.baselineIds.push(bl.id);

  const es = {
    id: uuid(),
    name: uniqueName('Custom Plan Events', state.data.eventSets.map(s => s.name)),
    description: 'Events for the 20-year basic outlook (start from scratch).',
    eventIds: [],
  };
  state.data.eventSets.push(es);
  wf.producedRecordIds.eventSetIds.push(es.id);

  const cfg = {
    id: uuid(),
    name: uniqueName('20-Year Custom Plan', state.data.analysisConfigs.map(c => c.name)),
    scenarioTitle: '', compareScenarioTitle: '',
    baselineId: bl.id, compareBaselineId: '',
    eventSetIds: [es.id], compareEventSetIds: [],
    startDate: start,
    endDate: addMonths(start, 240),
    viewMode: 'yearly',
    inflationRate: state.data.settings?.defaultInflationRate ?? 3,
    taxRate:       state.data.settings?.defaultTaxRate ?? 30,
    monteCarlo: { enabled: true, numSimulations: 500, standardOfLivingMonthly: 7000 },
    eventOverrides: [],
    resultsStale: false,
  };
  state.data.analysisConfigs.push(cfg);
  wf.producedRecordIds.analysisConfigIds.push(cfg.id);

  wf.updatedAt = new Date().toISOString();
  saveData();
}

// ═══════════════════════════════════════════════════════════════
// FORECAST EXECUTION
// ═══════════════════════════════════════════════════════════════

function qsfHasFreshRun(wf) {
  const cfgId = wf.producedRecordIds.analysisConfigIds[0];
  return !!(cfgId && state.lastRun && state.lastRunConfig?.id === cfgId);
}

function qsfRunForecastAndAdvance(wf, nextStepKey) {
  const cfgId = wf.producedRecordIds.analysisConfigIds[0];
  const cfg = state.data.analysisConfigs.find(c => c.id === cfgId);
  if (!cfg) { showToast('Analysis config missing', 'error'); return; }

  const events = resolveEffectiveEvents(cfg);
  const detResults = runDeterministicForecast(cfg.baselineId, cfg, events);

  const finish = (mcResults) => {
    state.lastRun = { detResults, cmpResults: null, mcResults };
    state.lastRunConfig = cfg;
    if (nextStepKey) {
      wf.currentStep = nextStepKey;
      wf.updatedAt = new Date().toISOString();
      saveData();
    }
    navigate('v1-workflow', { workflowId: wf.id });
  };

  if (cfg.monteCarlo?.enabled) {
    showToast(`Running ${cfg.monteCarlo.numSimulations} simulations…`);
    setTimeout(() => {
      const mcResults = runMonteCarloForecast(cfg.baselineId, cfg, cfg.monteCarlo, events);
      finish(mcResults);
    }, 60);
  } else {
    finish(null);
  }
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY COMPONENT BUILDER
// ═══════════════════════════════════════════════════════════════

function qsfBuildSummaryComponents(wf) {
  const cfg = state.lastRunConfig;
  const run = state.lastRun;
  if (!cfg || !run?.detResults?.length) return [];

  const det = run.detResults;
  const mc  = run.mcResults; // may be null
  const last = det[det.length - 1];
  const first = det[0];
  const horizonYears = Math.round(monthsBetween(cfg.startDate, cfg.endDate) / 12);

  // Mortgage payoff scan — first month the mortgage hits $0.
  // Match by ID so renames during review don't break the lookup.
  const bl0 = state.data.baselines.find(b => b.id === cfg.baselineId);
  const mortgageLiabId = bl0?.liabilities?.[0]?.id;
  let payoffMonth = null;
  let endingMortgageBalance = null;
  if (mortgageLiabId) {
    for (const r of det) {
      const m = (r.liabSnapshots || []).find(l => l.id === mortgageLiabId);
      if (!m) continue;
      endingMortgageBalance = m.value;
      if (payoffMonth === null && m.value <= 0.5) payoffMonth = r.month;
    }
  }

  const finalMc = mc && mc.length ? mc[mc.length - 1] : null;

  // ── Narrative ────────────────────────────────────────────────
  const startNw = first.netWorth;
  const endNw   = finalMc ? finalMc.p50 : last.netWorth;
  const growthLine = `from ${esc(fmt$(startNw))} today to about ${esc(fmt$(endNw))}${finalMc ? ' (median outcome)' : ''} in ${horizonYears} years`;
  const payoffLine = payoffMonth
    ? `The mortgage is fully paid off by ${esc(monthLabel(payoffMonth))}.`
    : endingMortgageBalance !== null && endingMortgageBalance > 0
      ? `At the end of the ${horizonYears}-year view, the mortgage balance is about ${esc(fmt$(endingMortgageBalance))} (the amortization extends past this horizon).`
      : '';
  const mcLine = finalMc
    ? `Running ${cfg.monteCarlo.numSimulations} Monte Carlo simulations, your projected net worth at year ${horizonYears} ranges from <strong>${esc(fmt$(finalMc.p10))}</strong> (10th percentile) to <strong>${esc(fmt$(finalMc.p90))}</strong> (90th percentile), with a median of <strong>${esc(fmt$(finalMc.p50))}</strong>.`
    : '';

  // ── KPI grid ─────────────────────────────────────────────────
  const kpis = [
    { label: 'Current net worth', value: fmt$(startNw) },
    finalMc
      ? { label: `Projected at year ${horizonYears}`, value: fmt$(finalMc.p50), sublabel: 'median outcome' }
      : { label: `Projected at year ${horizonYears}`, value: fmt$(last.netWorth), sublabel: 'deterministic' },
  ];
  if (finalMc) {
    kpis.push({ label: '10th–90th percentile', value: `${fmtCompact(finalMc.p10)} – ${fmtCompact(finalMc.p90)}`, sublabel: 'monte carlo range' });
  }
  kpis.push({
    label: 'Mortgage payoff',
    value: payoffMonth ? monthLabel(payoffMonth) : `${horizonYears}y+`,
    sublabel: payoffMonth ? '' : 'past horizon',
  });

  // ── Chart config (yearly net worth) ──────────────────────────
  const detYr = aggregateYearly(det);
  const mcYr  = mc ? aggregateMCYearly(mc) : null;
  const labels = detYr.map(r => r.month.slice(0, 4));

  const datasets = [];
  if (mcYr) {
    // Band datasets (drawn first so the deterministic line sits on top)
    datasets.push(
      { label: '', data: mcYr.map(r => r.p90), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(37,99,235,0.07)' },
      { label: '', data: mcYr.map(r => r.p75), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(37,99,235,0.13)' },
      { label: '', data: mcYr.map(r => r.p25), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(37,99,235,0.13)' },
      { label: '', data: mcYr.map(r => r.p10), borderWidth: 0, pointRadius: 0, fill: false },
      { label: 'Median (p50)', data: mcYr.map(r => r.p50), borderColor: 'rgba(37,99,235,0.9)', backgroundColor: 'rgba(37,99,235,0.9)', borderWidth: 1.5, pointRadius: 0, fill: false },
    );
  }
  datasets.push({
    label: 'Net Worth (deterministic)',
    data: detYr.map(r => r.netWorth),
    borderColor: mcYr ? 'rgba(55,65,81,0.85)' : '#2563eb',
    backgroundColor: mcYr ? 'rgba(55,65,81,0.85)' : 'rgba(37,99,235,0.12)',
    borderWidth: 2,
    borderDash: mcYr ? [4, 4] : [],
    pointRadius: 0,
    fill: mcYr ? false : 'origin',
    tension: 0.15,
  });

  const chartConfig = {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: !!mcYr, position: 'bottom', labels: { boxWidth: 14, filter: it => it.text && it.text.length > 0 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label || 'Net Worth'}: ${fmt$(ctx.parsed.y)}` } },
      },
      scales: {
        y: { ticks: { callback: v => fmtCompact(v) } },
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
      },
    },
  };

  // ── Scenario inputs ──────────────────────────────────────────
  const eventCount = wf.producedRecordIds.eventIds.length;
  const inputRows = [
    { label: 'Baseline',         value: bl0?.name ?? '—' },
    { label: 'Baseline date',    value: monthLabel(bl0?.date ?? cfg.startDate) },
    { label: 'Forecast horizon', value: `${horizonYears} years (${monthLabel(cfg.startDate)} → ${monthLabel(cfg.endDate)})` },
    { label: 'Events',           value: `${eventCount} recurring` },
    { label: 'Inflation rate',   value: `${cfg.inflationRate}% / year` },
    { label: 'Income tax rate',  value: `${cfg.taxRate}%` },
    { label: 'Monte Carlo',      value: cfg.monteCarlo?.enabled ? `${cfg.monteCarlo.numSimulations} simulations` : 'Off' },
  ];

  return [
    {
      type: 'narrative',
      html: `<p>Based on the <strong>Family with Mortgage</strong> sample, this plan projects your household's net worth ${growthLine}. ${payoffLine}</p>${mcLine ? `<p>${mcLine}</p>` : ''}`,
    },
    { type: 'kpi-grid', items: kpis },
    { type: 'chart', id: 'qsf-summary-nw', title: `Net worth over ${horizonYears} years`, config: chartConfig, height: 320 },
    { type: 'data-section', title: 'Scenario inputs', rows: inputRows },
  ];
}

// ═══════════════════════════════════════════════════════════════
// STEP RENDERERS
// ═══════════════════════════════════════════════════════════════

function qsfRenderChoosePath(wf) {
  const sel = wf.draftData.path;
  const locked = (wf.producedRecordIds?.baselineIds?.length ?? 0) > 0;

  const cardClass = (key, { disabled = false } = {}) => {
    if (disabled) return 'v1-option-card disabled';
    if (sel === key) return 'v1-option-card selected';
    // Once locked, dim the non-selected enabled cards too.
    if (locked) return 'v1-option-card disabled';
    return 'v1-option-card';
  };
  const clickAttr = (key, { disabled = false } = {}) => {
    if (disabled) return '';
    if (locked && sel !== key) return ''; // no-op; visually disabled
    return `onclick="qsfSelectPath('${esc(wf.id)}','${key}')"`;
  };

  return `
    <p>Pick how you'd like to build your plan.</p>
    <div class="alert alert-info" style="margin: 14px 0 18px 0; font-size: 13px;">
      <strong>Heads up:</strong> after you Continue, this choice is locked. If you want to try a different path later, Exit, then Discard the workflow from Get Started and start fresh.
    </div>
    <div class="v1-card-grid">
      <div class="${cardClass('sample')}" ${clickAttr('sample')}>
        <div class="v1-option-icon">📋</div>
        <div class="v1-option-body">
          <div class="v1-option-title">Use a sample scenario</div>
          <div class="v1-option-desc">Start from a realistic template you can edit. Fastest path to a first forecast.</div>
        </div>
        <div class="v1-option-check">${sel === 'sample' ? '✓' : ''}</div>
      </div>
      <div class="${cardClass('scratch')}" ${clickAttr('scratch')}>
        <div class="v1-option-icon">✏️</div>
        <div class="v1-option-body">
          <div class="v1-option-title">Start from scratch</div>
          <div class="v1-option-desc">Start with an empty plan. Add your own assets, liabilities, and events on the next step.</div>
        </div>
        <div class="v1-option-check">${sel === 'scratch' ? '✓' : ''}</div>
      </div>
      <div class="${cardClass('questionnaire')}" ${clickAttr('questionnaire')}>
        <div class="v1-option-icon">📝</div>
        <div class="v1-option-body">
          <div class="v1-option-title">Guided questionnaire</div>
          <div class="v1-option-desc">Answer a series of short questions about your income, savings, housing, and expenses — we'll build your plan from your answers.</div>
        </div>
        <div class="v1-option-check">${sel === 'questionnaire' ? '✓' : ''}</div>
      </div>
    </div>
  `;
}

function qsfRenderPickSample(wf) {
  const sel = wf.draftData.sampleId;
  return `
    <p>Choose a sample scenario to start from. You'll be able to review and edit every record on the next step.</p>
    <div class="v1-card-grid" style="margin-top:20px">
      <div class="v1-option-card${sel === 'family-mortgage' ? ' selected' : ''}" onclick="qsfSelectSample('${esc(wf.id)}','family-mortgage')">
        <div class="v1-option-icon">🏡</div>
        <div class="v1-option-body">
          <div class="v1-option-title">Family with mortgage</div>
          <div class="v1-option-desc">Two-income household, primary residence with an amortizing mortgage, mixed investment accounts, and typical monthly expenses.</div>
        </div>
        <div class="v1-option-check">${sel === 'family-mortgage' ? '✓' : ''}</div>
      </div>
    </div>
  `;
}

function qsfRenderReview(wf) {
  const blId = wf.producedRecordIds.baselineIds[0];
  const bl = blId ? state.data.baselines.find(b => b.id === blId) : null;
  const cfgId = wf.producedRecordIds.analysisConfigIds[0];
  const cfg = cfgId ? state.data.analysisConfigs.find(c => c.id === cfgId) : null;
  if (!bl || !cfg) return `<p style="color:var(--danger)">Generation failed — please go back and re-select the sample.</p>`;

  const assets = bl.assets ?? [];
  const liabs  = bl.liabilities ?? [];
  const eventIds = wf.producedRecordIds.eventIds;
  const events = state.data.events.filter(e => eventIds.includes(e.id));

  const assetSub = a => {
    const bits = [a.category];
    if (a.isInvestment) bits.push(`${a.annualMeanReturn}% ± ${a.annualStdDev}%`);
    else if (a.monthlyGrowthRate) bits.push(`${(a.monthlyGrowthRate * 12).toFixed(1)}% / yr`);
    if (!a.isLiquid) bits.push('illiquid');
    return bits.join(' · ');
  };

  const liabSub = l => {
    const bits = [l.category, `${l.annualInterestRate}% / yr`];
    if (l.useAmortization) bits.push('amortizing');
    if (l.amortizationEndDate) bits.push(`payoff ${monthLabel(l.amortizationEndDate)}`);
    return bits.join(' · ');
  };

  const evSub = e => {
    const bits = [e.category, e.type.replace(/_/g, ' ')];
    if (e.isRecurring) bits.push('recurring');
    if (e.inflationAdjusted) bits.push('inflation-adj');
    if (e.linkedAssetName) bits.push(`→ ${e.linkedAssetName}`);
    return bits.join(' · ');
  };

  const renderAssetRow = a => `
    <div class="v1-review-row">
      <div class="v1-review-row-body">
        <div class="v1-review-row-title">${esc(a.name)} · ${esc(fmt$(a.value))}</div>
        <div class="v1-review-row-sub">${esc(assetSub(a))}</div>
      </div>
      <div class="v1-review-row-actions">
        <button class="btn btn-sm btn-ghost" onclick="openAssetModal('${esc(bl.id)}','${esc(a.id)}')">Edit</button>
        <button class="btn btn-sm btn-ghost" onclick="deleteAsset('${esc(bl.id)}','${esc(a.id)}')">Delete</button>
      </div>
    </div>
  `;
  const renderLiabRow = l => `
    <div class="v1-review-row">
      <div class="v1-review-row-body">
        <div class="v1-review-row-title">${esc(l.name)} · ${esc(fmt$(l.value))}</div>
        <div class="v1-review-row-sub">${esc(liabSub(l))}</div>
      </div>
      <div class="v1-review-row-actions">
        <button class="btn btn-sm btn-ghost" onclick="openLiabilityModal('${esc(bl.id)}','${esc(l.id)}')">Edit</button>
        <button class="btn btn-sm btn-ghost" onclick="deleteLiability('${esc(bl.id)}','${esc(l.id)}')">Delete</button>
      </div>
    </div>
  `;
  const renderEvRow = e => `
    <div class="v1-review-row">
      <div class="v1-review-row-body">
        <div class="v1-review-row-title">${esc(e.name)} · ${esc(fmt$(e.amount))}${e.isRecurring ? ' / mo' : ''}</div>
        <div class="v1-review-row-sub">${esc(evSub(e))}</div>
      </div>
      <div class="v1-review-row-actions">
        <button class="btn btn-sm btn-ghost" onclick="openEventModal('${esc(e.id)}')">Edit</button>
        <button class="btn btn-sm btn-ghost" onclick="deleteEvent('${esc(e.id)}')">Delete</button>
      </div>
    </div>
  `;

  return `
    <p>Review the records this workflow generated for you. Edit anything that doesn't fit your situation; changes save immediately.</p>

    <div class="form-group" style="margin-bottom: 24px;">
      <label for="qsf-scenario-name">Scenario name</label>
      <input type="text" id="qsf-scenario-name" value="${esc(cfg.name)}"
             onchange="qsfRenameScenario('${esc(wf.id)}', this.value)" />
      <div class="form-hint">Labels this scenario in your Analysis list and is used as the title when you Generate Report.</div>
    </div>

    <div class="v1-review-section">
      <div class="v1-review-section-header">
        <div class="v1-review-section-title">Assets</div>
        <button class="btn btn-sm btn-secondary" onclick="openAssetModal('${esc(bl.id)}')">+ Add Asset</button>
      </div>
      ${assets.length ? assets.map(renderAssetRow).join('') : '<div class="v1-review-empty">No assets.</div>'}
    </div>

    <div class="v1-review-section">
      <div class="v1-review-section-header">
        <div class="v1-review-section-title">Liabilities</div>
        <button class="btn btn-sm btn-secondary" onclick="openLiabilityModal('${esc(bl.id)}')">+ Add Liability</button>
      </div>
      ${liabs.length ? liabs.map(renderLiabRow).join('') : '<div class="v1-review-empty">No liabilities.</div>'}
    </div>

    <div class="v1-review-section">
      <div class="v1-review-section-header">
        <div class="v1-review-section-title">Events (${events.length})</div>
        <button class="btn btn-sm btn-secondary" onclick="openEventModal()">+ Add Event</button>
      </div>
      ${events.length ? events.map(renderEvRow).join('') : '<div class="v1-review-empty">No events.</div>'}
    </div>
  `;
}

function qsfRenderConfirmRun(wf) {
  const cfgId = wf.producedRecordIds.analysisConfigIds[0];
  const cfg = cfgId ? state.data.analysisConfigs.find(c => c.id === cfgId) : null;
  const horizonYears = cfg ? Math.round(monthsBetween(cfg.startDate, cfg.endDate) / 12) : 20;
  const numSims = cfg?.monteCarlo?.numSimulations ?? 500;

  return `
    <p>You're ready to run the forecast. This will project your net worth over <strong>${horizonYears} years</strong> using your generated records and run <strong>${numSims} Monte Carlo simulations</strong> to estimate a range of outcomes.</p>
    <p style="color:var(--muted); font-size: 13.5px;">The simulation runs in your browser and takes a few seconds. Hit Continue when you're ready.</p>
  `;
}

function qsfRenderSummary(wf) {
  if (!qsfHasFreshRun(wf)) {
    // Resume scenario — cached run is missing. Re-run automatically.
    requestAnimationFrame(() => qsfRunForecastAndAdvance(wf, null));
    return `<p style="color:var(--muted)">Re-running analysis…</p>`;
  }

  const components = qsfBuildSummaryComponents(wf);
  const cfgId = wf.producedRecordIds.analysisConfigIds[0];

  const cfg = state.data.analysisConfigs.find(c => c.id === cfgId);
  const scenarioName = cfg?.name || 'this scenario';

  return `
    <p>Here's your projected starting picture for <strong>${esc(scenarioName)}</strong>. You can dive deeper into the full analysis, generate a PDF report, or finish the workflow.</p>
    <div class="v1-summary-zone">
      ${renderSummaryComponents(components)}
    </div>
    <div class="v1-summary-cta-row">
      <button class="btn btn-primary" onclick="qsfGenerateReport('${esc(wf.id)}')">Generate Report</button>
      <button class="btn btn-secondary" onclick="navigate('results',{configId:'${esc(cfgId)}'})">Explore full analysis</button>
    </div>
  `;
}

function qsfAttachSummary(wf) {
  const components = qsfBuildSummaryComponents(wf);
  attachSummaryCharts(components);
}

// ═══════════════════════════════════════════════════════════════
// QUESTIONNAIRE — helpers
// ═══════════════════════════════════════════════════════════════
// Each question step renders a form, captures values from the DOM on
// Continue (and on Add/Remove for multi-row list builders), and stores
// answers on wf.draftData.q.<topic>. Generation runs at the end and
// converts answers into baseline + events + event set + analysis
// config. All questions are skippable — empty forms produce no records.

function qsfEnsureQDraft(wf) {
  wf.draftData.q = wf.draftData.q ?? {};
  return wf.draftData.q;
}

function qsfToggleTopic(workflowId, topicKey) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  const q = qsfEnsureQDraft(wf);
  // Capture current checkbox states from DOM (not just the flipped one)
  // so the user's other toggles survive the rerender.
  const checked = QSF_QUESTIONNAIRE_TOPICS
    .map(t => t.key)
    .filter(k => document.getElementById(`qtopic-${k}`)?.checked);
  q.topics = checked;
  wf.updatedAt = new Date().toISOString();
  saveData();
  // No rerender — the checkboxes already reflect the DOM state and
  // we don't need to mutate any HTML. We just persist the answer.
}

// ── Multi-row list capture helpers ──────────────────────────────────

function qsfCaptureIncomeRows() {
  const rows = [];
  document.querySelectorAll('.qsf-income-row').forEach(rowEl => {
    rows.push({
      name:      rowEl.querySelector('[data-field=name]')?.value.trim() || '',
      amount:    parseFloat(rowEl.querySelector('[data-field=amount]')?.value) || 0,
      startDate: rowEl.querySelector('[data-field=startDate]')?.value || '',
      endDate:   rowEl.querySelector('[data-field=endDate]')?.value || '',
    });
  });
  return rows;
}

function qsfCaptureOnetimeRows() {
  const rows = [];
  document.querySelectorAll('.qsf-onetime-row').forEach(rowEl => {
    rows.push({
      name:   rowEl.querySelector('[data-field=name]')?.value.trim() || '',
      date:   rowEl.querySelector('[data-field=date]')?.value || '',
      amount: parseFloat(rowEl.querySelector('[data-field=amount]')?.value) || 0,
      type:   rowEl.querySelector('[data-field=type]')?.value || 'one_time_outflow',
    });
  });
  return rows;
}

function qsfCaptureDebtRows() {
  const rows = [];
  document.querySelectorAll('.qsf-debt-row').forEach(rowEl => {
    rows.push({
      name:        rowEl.querySelector('[data-field=name]')?.value.trim() || '',
      balance:     parseFloat(rowEl.querySelector('[data-field=balance]')?.value) || 0,
      rate:        parseFloat(rowEl.querySelector('[data-field=rate]')?.value) || 0,
      payoffYear:  rowEl.querySelector('[data-field=payoffYear]')?.value || '',
    });
  });
  return rows;
}

// ── Add / remove row handlers ───────────────────────────────────────

function qsfAddIncomeRow(workflowId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  const q = qsfEnsureQDraft(wf);
  q.income = q.income || { streams: [] };
  q.income.streams = qsfCaptureIncomeRows();
  q.income.streams.push({ name: '', amount: 0, startDate: '', endDate: '' });
  saveData();
  navigate('v1-workflow', { workflowId });
}
function qsfRemoveIncomeRow(workflowId, idx) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  const q = qsfEnsureQDraft(wf);
  q.income = q.income || { streams: [] };
  q.income.streams = qsfCaptureIncomeRows();
  q.income.streams.splice(idx, 1);
  saveData();
  navigate('v1-workflow', { workflowId });
}

function qsfAddOnetimeRow(workflowId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  const q = qsfEnsureQDraft(wf);
  q.onetime = q.onetime || { events: [] };
  q.onetime.events = qsfCaptureOnetimeRows();
  q.onetime.events.push({ name: '', date: today(), amount: 0, type: 'one_time_outflow' });
  saveData();
  navigate('v1-workflow', { workflowId });
}
function qsfRemoveOnetimeRow(workflowId, idx) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  const q = qsfEnsureQDraft(wf);
  q.onetime = q.onetime || { events: [] };
  q.onetime.events = qsfCaptureOnetimeRows();
  q.onetime.events.splice(idx, 1);
  saveData();
  navigate('v1-workflow', { workflowId });
}

function qsfAddDebtRow(workflowId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  const q = qsfEnsureQDraft(wf);
  q.debts = q.debts || { items: [] };
  q.debts.items = qsfCaptureDebtRows();
  q.debts.items.push({ name: '', balance: 0, rate: 6, payoffYear: '' });
  saveData();
  navigate('v1-workflow', { workflowId });
}
function qsfRemoveDebtRow(workflowId, idx) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  const q = qsfEnsureQDraft(wf);
  q.debts = q.debts || { items: [] };
  q.debts.items = qsfCaptureDebtRows();
  q.debts.items.splice(idx, 1);
  saveData();
  navigate('v1-workflow', { workflowId });
}

// ── Housing mode toggle ─────────────────────────────────────────────

function qsfChangeHousingMode(workflowId, mode) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  const q = qsfEnsureQDraft(wf);
  q.housing = qsfCaptureHousing(q.housing || qsfDefaultHousing());
  q.housing.mode = mode;
  saveData();
  navigate('v1-workflow', { workflowId });
}

function qsfDefaultHousing() {
  return {
    mode: '',
    rent: {
      amount: 0,
      addons: {
        renterInsurance: { included: false, amount:  25 },
        utilities:       { included: false, amount: 150 },
        internet:        { included: false, amount:  60 },
      },
    },
    own: {
      value: 0,
      mortgageBalance: 0,
      mortgageRate: 5.0,
      mortgageYear: '',
      addons: {
        propertyTax:   { included: false, amount: 500 },
        homeInsurance: { included: false, amount: 120 },
        utilities:     { included: false, amount: 200 },
        internet:      { included: false, amount:  60 },
        maintenance:   { included: false, amount: 200 },
      },
    },
  };
}

function qsfCaptureHousing(prev) {
  // Capture whatever is on screen now, falling back to prev for fields
  // not currently rendered (e.g. rent fields when mode === 'own').
  const out = JSON.parse(JSON.stringify(prev));
  const modeEl = document.querySelector('input[name=qhousing-mode]:checked');
  if (modeEl) out.mode = modeEl.value;

  if (out.mode === 'rent') {
    out.rent.amount = parseFloat(document.getElementById('qhousing-rent-amount')?.value) || 0;
    for (const k of Object.keys(out.rent.addons)) {
      out.rent.addons[k] = {
        included: !!document.getElementById(`qhousing-rent-ck-${k}`)?.checked,
        amount:   parseFloat(document.getElementById(`qhousing-rent-amt-${k}`)?.value) || 0,
      };
    }
  } else if (out.mode === 'own') {
    out.own.value           = parseFloat(document.getElementById('qhousing-own-value')?.value) || 0;
    out.own.mortgageBalance = parseFloat(document.getElementById('qhousing-own-mtg-balance')?.value) || 0;
    out.own.mortgageRate    = parseFloat(document.getElementById('qhousing-own-mtg-rate')?.value) || 0;
    out.own.mortgageYear    = document.getElementById('qhousing-own-mtg-year')?.value || '';
    for (const k of Object.keys(out.own.addons)) {
      out.own.addons[k] = {
        included: !!document.getElementById(`qhousing-own-ck-${k}`)?.checked,
        amount:   parseFloat(document.getElementById(`qhousing-own-amt-${k}`)?.value) || 0,
      };
    }
  }
  return out;
}

// ── Recurring capture ───────────────────────────────────────────────

const QSF_RECURRING_ITEMS = [
  { key: 'groceries',      label: 'Groceries & food',     defaultAmount: 800, category: 'Food & Dining' },
  { key: 'transportation', label: 'Transportation / auto', defaultAmount: 400, category: 'Transportation' },
  { key: 'healthcare',     label: 'Healthcare',           defaultAmount: 150, category: 'Healthcare' },
  { key: 'entertainment',  label: 'Entertainment & dining out', defaultAmount: 250, category: 'Entertainment' },
  { key: 'insurance',      label: 'Insurance (non-housing)', defaultAmount: 100, category: 'Insurance' },
  { key: 'childcare',      label: 'Childcare',            defaultAmount:   0, category: 'Childcare' },
];

function qsfDefaultRecurring() {
  const out = {};
  for (const it of QSF_RECURRING_ITEMS) out[it.key] = { included: false, amount: it.defaultAmount };
  return out;
}
function qsfCaptureRecurring(prev) {
  const out = JSON.parse(JSON.stringify(prev));
  for (const it of QSF_RECURRING_ITEMS) {
    out[it.key] = {
      included: !!document.getElementById(`qrec-ck-${it.key}`)?.checked,
      amount:   parseFloat(document.getElementById(`qrec-amt-${it.key}`)?.value) || 0,
    };
  }
  return out;
}

// ── Assumptions capture ─────────────────────────────────────────────

function qsfDefaultAssumptions() {
  return {
    inflationRate:    state.data.settings?.defaultInflationRate ?? 3,
    taxRate:          state.data.settings?.defaultTaxRate ?? 30,
    assetGrowthRate:  4.0,
    investmentReturn: 7.5,
    investmentStdDev: 13.0,
  };
}
function qsfCaptureAssumptions() {
  return {
    inflationRate:    parseFloat(document.getElementById('qassum-inflation')?.value)   || 0,
    taxRate:          parseFloat(document.getElementById('qassum-tax')?.value)         || 0,
    assetGrowthRate:  parseFloat(document.getElementById('qassum-asset-rate')?.value)  || 0,
    investmentReturn: parseFloat(document.getElementById('qassum-inv-return')?.value)  || 0,
    investmentStdDev: parseFloat(document.getElementById('qassum-inv-stddev')?.value)  || 0,
  };
}

// ── Savings capture ─────────────────────────────────────────────────

function qsfDefaultSavings() {
  return { chequing: 0, emergency: 0, investments: 0, retirement: 0 };
}
function qsfCaptureSavings() {
  return {
    chequing:    parseFloat(document.getElementById('qsav-chequing')?.value)    || 0,
    emergency:   parseFloat(document.getElementById('qsav-emergency')?.value)   || 0,
    investments: parseFloat(document.getElementById('qsav-investments')?.value) || 0,
    retirement:  parseFloat(document.getElementById('qsav-retirement')?.value)  || 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// QUESTIONNAIRE — render functions
// ═══════════════════════════════════════════════════════════════

function qsfRenderQTopics(wf) {
  const q = qsfEnsureQDraft(wf);
  const checked = new Set(q.topics ?? QSF_QUESTIONNAIRE_TOPICS.map(t => t.key));
  return `
    <p>Pick the topics you want to cover. We'll only ask you about the ones you check. You can leave any field blank within a question to skip it.</p>
    <div class="qsf-topic-list">
      ${QSF_QUESTIONNAIRE_TOPICS.map(t => `
        <label class="qsf-topic-row">
          <input type="checkbox" id="qtopic-${esc(t.key)}" ${checked.has(t.key) ? 'checked' : ''}
                 onchange="qsfToggleTopic('${esc(wf.id)}','${esc(t.key)}')">
          <span class="qsf-topic-body">
            <span class="qsf-topic-label">${esc(t.label)}</span>
            <span class="qsf-topic-desc">${esc(t.desc)}</span>
          </span>
        </label>
      `).join('')}
    </div>
  `;
}

function qsfRenderQAssumptions(wf) {
  const q = qsfEnsureQDraft(wf);
  q.assumptions = q.assumptions || qsfDefaultAssumptions();
  const a = q.assumptions;
  return `
    <p>These default rates are applied throughout your forecast. You can fine-tune them later on individual records, but starting with realistic numbers here saves time.</p>
    <div class="form-row">
      <div class="form-group">
        <label>Inflation rate <span class="label-note">(% / year)</span></label>
        <input type="number" id="qassum-inflation" value="${Number(a.inflationRate) || 0}" min="0" step="0.1">
        <div class="form-hint">Inflates recurring income and expenses each year.</div>
      </div>
      <div class="form-group">
        <label>Income tax rate <span class="label-note">(%)</span></label>
        <input type="number" id="qassum-tax" value="${Number(a.taxRate) || 0}" min="0" step="0.5">
        <div class="form-hint">Applied to income events. Set to 0% if you're entering after-tax income amounts — often the preferred approach.</div>
      </div>
    </div>
    <div class="form-group">
      <label>Default growth rate for interest-bearing assets <span class="label-note">(% / year)</span></label>
      <input type="number" id="qassum-asset-rate" value="${Number(a.assetGrowthRate) || 0}" min="0" step="0.1">
      <div class="form-hint">Used for non-investment accounts like an emergency fund. Chequing / cash stays at 0%.</div>
    </div>
    <div class="qsf-section-heading">Investment assets (TFSA, RRSP, brokerage)</div>
    <div class="form-row">
      <div class="form-group">
        <label>Default mean return <span class="label-note">(% / year)</span></label>
        <input type="number" id="qassum-inv-return" value="${Number(a.investmentReturn) || 0}" min="0" step="0.1">
      </div>
      <div class="form-group">
        <label>Default standard deviation <span class="label-note">(% / year)</span></label>
        <input type="number" id="qassum-inv-stddev" value="${Number(a.investmentStdDev) || 0}" min="0" step="0.1">
        <div class="form-hint">Drives Monte Carlo variability — higher = wider range of outcomes.</div>
      </div>
    </div>
  `;
}

function qsfRenderQIncome(wf) {
  const q = qsfEnsureQDraft(wf);
  q.income = q.income || { streams: [{ name: '', amount: 0, startDate: '', endDate: '' }] };
  const rows = q.income.streams;
  return `
    <p>List each income stream you expect. If your income changes over time (e.g. salary now, lower retirement income later), add a separate row for each period with start and end dates.</p>
    <p class="qsf-hint">Leave the list empty (or every row blank) to skip this section.</p>
    <div class="qsf-list">
      ${rows.map((r, i) => `
        <div class="qsf-list-row qsf-income-row">
          <div class="form-group">
            <label>Name</label>
            <input type="text" data-field="name" value="${esc(r.name || '')}" placeholder="e.g. Salary">
          </div>
          <div class="form-group">
            <label>Monthly amount</label>
            <input type="number" data-field="amount" value="${Number(r.amount) || 0}" min="0" step="100">
          </div>
          <div class="form-group">
            <label>Start <span class="label-note">(optional)</span></label>
            <input type="month" data-field="startDate" value="${esc(r.startDate || '')}">
          </div>
          <div class="form-group">
            <label>End <span class="label-note">(blank = indefinite)</span></label>
            <input type="month" data-field="endDate" value="${esc(r.endDate || '')}">
          </div>
          <button type="button" class="btn btn-sm btn-ghost qsf-row-remove"
                  onclick="qsfRemoveIncomeRow('${esc(wf.id)}',${i})">Remove</button>
        </div>
      `).join('')}
    </div>
    <button type="button" class="btn btn-sm btn-secondary" onclick="qsfAddIncomeRow('${esc(wf.id)}')">+ Add another income stream</button>
  `;
}

function qsfRenderQSavings(wf) {
  const q = qsfEnsureQDraft(wf);
  q.savings = q.savings || qsfDefaultSavings();
  const s = q.savings;
  return `
    <p>What are your current account balances? Leave anything at $0 to skip it.</p>
    <div class="form-row">
      <div class="form-group">
        <label>Chequing / cash</label>
        <input type="number" id="qsav-chequing" value="${Number(s.chequing) || 0}" min="0" step="1000">
      </div>
      <div class="form-group">
        <label>Emergency fund</label>
        <input type="number" id="qsav-emergency" value="${Number(s.emergency) || 0}" min="0" step="1000">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Investment account <span class="label-note">(e.g. TFSA, brokerage)</span></label>
        <input type="number" id="qsav-investments" value="${Number(s.investments) || 0}" min="0" step="1000">
      </div>
      <div class="form-group">
        <label>Retirement account <span class="label-note">(e.g. RRSP, 401k)</span></label>
        <input type="number" id="qsav-retirement" value="${Number(s.retirement) || 0}" min="0" step="1000">
      </div>
    </div>
    <p class="qsf-hint">Investment & retirement account returns are driven by the defaults you set in the Assumptions step. You can tweak any account individually on the Review step.</p>
  `;
}

function qsfRenderQHousing(wf) {
  const q = qsfEnsureQDraft(wf);
  q.housing = q.housing || qsfDefaultHousing();
  const h = q.housing;
  const mode = h.mode || '';

  const renderAddon = (groupPrefix, key, label, addon) => `
    <div class="qsf-checkamount-row">
      <label class="checkbox-label">
        <input type="checkbox" id="qhousing-${groupPrefix}-ck-${key}" ${addon.included ? 'checked' : ''}>
        ${esc(label)}
      </label>
      <input type="number" id="qhousing-${groupPrefix}-amt-${key}" value="${Number(addon.amount) || 0}" min="0" step="10" aria-label="${esc(label)} monthly amount">
    </div>
  `;

  const rentBlock = `
    <div class="qsf-housing-detail">
      <div class="form-group">
        <label>Monthly rent</label>
        <input type="number" id="qhousing-rent-amount" value="${Number(h.rent.amount) || 0}" min="0" step="50">
      </div>
      <div class="qsf-section-heading">Common rental expenses (check to include)</div>
      <div class="qsf-checkamount-list">
        ${renderAddon('rent', 'renterInsurance', "Renter's insurance / mo", h.rent.addons.renterInsurance)}
        ${renderAddon('rent', 'utilities',       'Utilities / mo',          h.rent.addons.utilities)}
        ${renderAddon('rent', 'internet',        'Internet / mo',           h.rent.addons.internet)}
      </div>
    </div>
  `;

  const ownBlock = `
    <div class="qsf-housing-detail">
      <div class="form-row">
        <div class="form-group">
          <label>Home value</label>
          <input type="number" id="qhousing-own-value" value="${Number(h.own.value) || 0}" min="0" step="10000">
        </div>
        <div class="form-group">
          <label>Mortgage balance <span class="label-note">(0 if paid off)</span></label>
          <input type="number" id="qhousing-own-mtg-balance" value="${Number(h.own.mortgageBalance) || 0}" min="0" step="10000">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Mortgage annual rate %</label>
          <input type="number" id="qhousing-own-mtg-rate" value="${Number(h.own.mortgageRate) || 0}" min="0" step="0.05">
        </div>
        <div class="form-group">
          <label>Mortgage payoff month</label>
          <input type="month" id="qhousing-own-mtg-year" value="${esc(h.own.mortgageYear || '')}">
        </div>
      </div>
      <div class="qsf-section-heading">Common ownership expenses (check to include)</div>
      <div class="qsf-checkamount-list">
        ${renderAddon('own', 'propertyTax',   'Property tax / mo',  h.own.addons.propertyTax)}
        ${renderAddon('own', 'homeInsurance', 'Home insurance / mo', h.own.addons.homeInsurance)}
        ${renderAddon('own', 'utilities',     'Utilities / mo',      h.own.addons.utilities)}
        ${renderAddon('own', 'internet',      'Internet / mo',       h.own.addons.internet)}
        ${renderAddon('own', 'maintenance',   'Home maintenance / mo', h.own.addons.maintenance)}
      </div>
    </div>
  `;

  return `
    <p>Do you rent or own your home? Pick one to see the relevant fields, or skip if you'd prefer to add housing later.</p>
    <div class="qsf-radio-row">
      <label class="qsf-radio-card${mode === 'rent' ? ' selected' : ''}">
        <input type="radio" name="qhousing-mode" value="rent" ${mode === 'rent' ? 'checked' : ''}
               onchange="qsfChangeHousingMode('${esc(wf.id)}','rent')">
        <span>🏘️ Rent</span>
      </label>
      <label class="qsf-radio-card${mode === 'own' ? ' selected' : ''}">
        <input type="radio" name="qhousing-mode" value="own" ${mode === 'own' ? 'checked' : ''}
               onchange="qsfChangeHousingMode('${esc(wf.id)}','own')">
        <span>🏡 Own</span>
      </label>
      <label class="qsf-radio-card${mode === 'skip' ? ' selected' : ''}">
        <input type="radio" name="qhousing-mode" value="skip" ${mode === 'skip' ? 'checked' : ''}
               onchange="qsfChangeHousingMode('${esc(wf.id)}','skip')">
        <span>⏭️ Skip</span>
      </label>
    </div>
    ${mode === 'rent' ? rentBlock : ''}
    ${mode === 'own' ? ownBlock : ''}
  `;
}

function qsfRenderQRecurring(wf) {
  const q = qsfEnsureQDraft(wf);
  q.recurring = q.recurring || qsfDefaultRecurring();
  const r = q.recurring;
  return `
    <p>Check each common expense you want to include. The amounts are typical starting points — edit any to fit your situation.</p>
    <div class="qsf-checkamount-list">
      ${QSF_RECURRING_ITEMS.map(it => {
        const v = r[it.key] || { included: false, amount: it.defaultAmount };
        return `
          <div class="qsf-checkamount-row">
            <label class="checkbox-label">
              <input type="checkbox" id="qrec-ck-${esc(it.key)}" ${v.included ? 'checked' : ''}>
              ${esc(it.label)} <span class="label-note">/ mo</span>
            </label>
            <input type="number" id="qrec-amt-${esc(it.key)}" value="${Number(v.amount) || 0}" min="0" step="25" aria-label="${esc(it.label)} amount">
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function qsfRenderQOnetime(wf) {
  const q = qsfEnsureQDraft(wf);
  q.onetime = q.onetime || { events: [] };
  const rows = q.onetime.events;
  return `
    <p>Add any one-time cash flows you expect in the future — purchases, bonuses, gifts, anything that's not a recurring monthly event.</p>
    <p class="qsf-hint">Leave the list empty to skip this section.</p>
    <div class="qsf-list">
      ${rows.map((r, i) => `
        <div class="qsf-list-row qsf-onetime-row">
          <div class="form-group">
            <label>Name</label>
            <input type="text" data-field="name" value="${esc(r.name || '')}" placeholder="e.g. New car, Annual bonus">
          </div>
          <div class="form-group">
            <label>Date</label>
            <input type="month" data-field="date" value="${esc(r.date || '')}">
          </div>
          <div class="form-group">
            <label>Amount</label>
            <input type="number" data-field="amount" value="${Number(r.amount) || 0}" min="0" step="100">
          </div>
          <div class="form-group">
            <label>Direction</label>
            <select data-field="type">
              <option value="one_time_outflow" ${r.type === 'one_time_outflow' ? 'selected' : ''}>Money out (purchase)</option>
              <option value="one_time_inflow"  ${r.type === 'one_time_inflow'  ? 'selected' : ''}>Money in (windfall)</option>
            </select>
          </div>
          <button type="button" class="btn btn-sm btn-ghost qsf-row-remove"
                  onclick="qsfRemoveOnetimeRow('${esc(wf.id)}',${i})">Remove</button>
        </div>
      `).join('')}
    </div>
    <button type="button" class="btn btn-sm btn-secondary" onclick="qsfAddOnetimeRow('${esc(wf.id)}')">+ Add event</button>
  `;
}

function qsfRenderQDebts(wf) {
  const q = qsfEnsureQDraft(wf);
  q.debts = q.debts || { items: [] };
  const rows = q.debts.items;
  return `
    <p>Add any other amortizing debts — auto loans, student loans, lines of credit. The mortgage is handled in the Housing question.</p>
    <p class="qsf-hint">Leave the list empty to skip this section.</p>
    <div class="qsf-list">
      ${rows.map((r, i) => `
        <div class="qsf-list-row qsf-debt-row">
          <div class="form-group">
            <label>Name</label>
            <input type="text" data-field="name" value="${esc(r.name || '')}" placeholder="e.g. Car loan">
          </div>
          <div class="form-group">
            <label>Current balance</label>
            <input type="number" data-field="balance" value="${Number(r.balance) || 0}" min="0" step="100">
          </div>
          <div class="form-group">
            <label>Annual rate %</label>
            <input type="number" data-field="rate" value="${Number(r.rate) || 0}" min="0" step="0.1">
          </div>
          <div class="form-group">
            <label>Payoff month</label>
            <input type="month" data-field="payoffYear" value="${esc(r.payoffYear || '')}">
          </div>
          <button type="button" class="btn btn-sm btn-ghost qsf-row-remove"
                  onclick="qsfRemoveDebtRow('${esc(wf.id)}',${i})">Remove</button>
        </div>
      `).join('')}
    </div>
    <button type="button" class="btn btn-sm btn-secondary" onclick="qsfAddDebtRow('${esc(wf.id)}')">+ Add debt</button>
  `;
}

// ═══════════════════════════════════════════════════════════════
// QUESTIONNAIRE — generation
// ═══════════════════════════════════════════════════════════════
// Converts wf.draftData.q into actual baseline + events + event set
// + analysis config. Idempotent: skips if records already exist.

function qsfGenerateQuestionnaireRecords(wf) {
  if (wf.producedRecordIds.baselineIds.length > 0) return;

  const start = today();
  const q = wf.draftData.q ?? {};
  const assum = q.assumptions ?? qsfDefaultAssumptions();
  const interestMonthly = (assum.assetGrowthRate || 0) / 12;
  const invReturn = assum.investmentReturn || 0;
  const invStdDev = assum.investmentStdDev || 0;

  // ── Baseline ─────────────────────────────────────────────────
  const bl = {
    id: uuid(),
    name: uniqueName('Questionnaire Plan', state.data.baselines.map(b => b.name)),
    description: 'Generated by the 20-year basic outlook workflow (guided questionnaire).',
    date: start,
    createdAt: new Date().toISOString(),
    assets: [],
    liabilities: [],
  };

  // Savings → assets
  const sav = q.savings ?? {};
  const chequingName = (sav.chequing > 0) ? 'Chequing & Cash' : '';
  if (sav.chequing > 0)    bl.assets.push({ id: uuid(), name: chequingName,         value: sav.chequing,    category: 'Bank Account',       isInvestment: false, isLiquid: true,  monthlyGrowthRate: 0,                annualMeanReturn: invReturn, annualStdDev: invStdDev });
  if (sav.emergency > 0)   bl.assets.push({ id: uuid(), name: 'Emergency Fund',     value: sav.emergency,   category: 'Bank Account',       isInvestment: false, isLiquid: true,  monthlyGrowthRate: interestMonthly,  annualMeanReturn: invReturn, annualStdDev: invStdDev });
  if (sav.investments > 0) bl.assets.push({ id: uuid(), name: 'Investment Account', value: sav.investments, category: 'Investment Account', isInvestment: true,  isLiquid: true,  monthlyGrowthRate: 0,                annualMeanReturn: invReturn, annualStdDev: invStdDev });
  if (sav.retirement > 0)  bl.assets.push({ id: uuid(), name: 'Retirement Account', value: sav.retirement,  category: 'Investment Account', isInvestment: true,  isLiquid: false, monthlyGrowthRate: 0,                annualMeanReturn: invReturn, annualStdDev: invStdDev });

  // Housing (own) → real estate asset + mortgage liability
  const h = q.housing ?? {};
  if (h.mode === 'own' && (h.own?.value > 0 || h.own?.mortgageBalance > 0)) {
    if (h.own.value > 0) {
      bl.assets.push({ id: uuid(), name: 'Primary Residence', value: h.own.value, category: 'Real Estate', isInvestment: false, isLiquid: false, monthlyGrowthRate: interestMonthly, annualMeanReturn: invReturn, annualStdDev: invStdDev });
    }
    if (h.own.mortgageBalance > 0 && h.own.mortgageYear) {
      bl.liabilities.push({
        id: uuid(), name: 'Primary Mortgage', value: h.own.mortgageBalance, category: 'Mortgage',
        annualInterestRate: h.own.mortgageRate || 5,
        useAmortization: true, monthlyPayment: 0,
        includeInLiquidNW: false,
        paymentAssetName: chequingName,
        paymentMode: 'calculated', paymentFrequency: 'monthly',
        amortizationEndDate: h.own.mortgageYear,
        termStartDate: start,
        termEndDate: '',
        renewalRate: 0,
      });
    }
  }

  // Other debts → amortizing liabilities
  for (const d of (q.debts?.items ?? [])) {
    if (!d.name || d.balance <= 0 || !d.payoffYear) continue;
    bl.liabilities.push({
      id: uuid(), name: d.name, value: d.balance, category: 'Personal Loan',
      annualInterestRate: d.rate || 0,
      useAmortization: true, monthlyPayment: 0,
      includeInLiquidNW: true,
      paymentAssetName: chequingName,
      paymentMode: 'calculated', paymentFrequency: 'monthly',
      amortizationEndDate: d.payoffYear,
      termStartDate: start,
      termEndDate: '',
      renewalRate: 0,
    });
  }

  state.data.baselines.push(bl);
  wf.producedRecordIds.baselineIds.push(bl.id);

  // ── Events ───────────────────────────────────────────────────
  const newEventIds = [];
  const pushEvent = (ev) => {
    state.data.events.push(ev);
    wf.producedRecordIds.eventIds.push(ev.id);
    newEventIds.push(ev.id);
  };

  // Income streams
  for (const s of (q.income?.streams ?? [])) {
    if (!s.name || s.amount <= 0) continue;
    pushEvent({
      id: uuid(), name: s.name, notes: '',
      category: 'Income', type: 'income',
      amount: s.amount, stdDevAmount: 0,
      isRecurring: true,
      startDate: s.startDate || start,
      endDate:   s.endDate   || '',
      inflationAdjusted: true,
      depositToAssetName: chequingName,
      payFromAssetName: '', linkedAssetName: '', linkedLiabilityName: '',
    });
  }

  // Housing addons (rent or own)
  const housingExpense = (name, amount, category) => pushEvent({
    id: uuid(), name, notes: '',
    category, type: 'expense',
    amount, stdDevAmount: 0,
    isRecurring: true,
    startDate: start, endDate: '',
    inflationAdjusted: true,
    depositToAssetName: '', payFromAssetName: chequingName,
    linkedAssetName: '', linkedLiabilityName: '',
  });

  if (h.mode === 'rent') {
    if (h.rent?.amount > 0) housingExpense('Rent', h.rent.amount, 'Housing');
    const ra = h.rent?.addons ?? {};
    if (ra.renterInsurance?.included && ra.renterInsurance.amount > 0) housingExpense("Renter's insurance", ra.renterInsurance.amount, 'Insurance');
    if (ra.utilities?.included       && ra.utilities.amount > 0)       housingExpense('Utilities',           ra.utilities.amount,       'Utilities');
    if (ra.internet?.included        && ra.internet.amount > 0)        housingExpense('Internet',            ra.internet.amount,        'Utilities');
  } else if (h.mode === 'own') {
    const oa = h.own?.addons ?? {};
    if (oa.propertyTax?.included   && oa.propertyTax.amount > 0)   housingExpense('Property taxes',  oa.propertyTax.amount,   'Housing');
    if (oa.homeInsurance?.included && oa.homeInsurance.amount > 0) housingExpense('Home insurance',  oa.homeInsurance.amount, 'Insurance');
    if (oa.utilities?.included     && oa.utilities.amount > 0)     housingExpense('Utilities',       oa.utilities.amount,     'Utilities');
    if (oa.internet?.included      && oa.internet.amount > 0)      housingExpense('Internet',        oa.internet.amount,      'Utilities');
    if (oa.maintenance?.included   && oa.maintenance.amount > 0)   housingExpense('Home maintenance', oa.maintenance.amount,  'Housing');
  }

  // Recurring expenses
  const r = q.recurring ?? {};
  for (const it of QSF_RECURRING_ITEMS) {
    const v = r[it.key];
    if (v?.included && v.amount > 0) {
      pushEvent({
        id: uuid(), name: it.label, notes: '',
        category: it.category, type: 'expense',
        amount: v.amount, stdDevAmount: 0,
        isRecurring: true,
        startDate: start, endDate: '',
        inflationAdjusted: true,
        depositToAssetName: '', payFromAssetName: chequingName,
        linkedAssetName: '', linkedLiabilityName: '',
      });
    }
  }

  // One-time events
  for (const e of (q.onetime?.events ?? [])) {
    if (!e.name || !e.date || e.amount <= 0) continue;
    const isInflow = e.type === 'one_time_inflow';
    pushEvent({
      id: uuid(), name: e.name, notes: '',
      category: isInflow ? 'Income' : 'Other',
      type: e.type, amount: e.amount, stdDevAmount: 0,
      isRecurring: false,
      startDate: e.date, endDate: '',
      inflationAdjusted: false,
      depositToAssetName: isInflow  ? chequingName : '',
      payFromAssetName:   !isInflow ? chequingName : '',
      linkedAssetName: '', linkedLiabilityName: '',
    });
  }

  // ── Event Set ────────────────────────────────────────────────
  const es = {
    id: uuid(),
    name: uniqueName('Questionnaire Plan Events', state.data.eventSets.map(s => s.name)),
    description: 'Events from the 20-year basic outlook guided questionnaire.',
    eventIds: newEventIds,
  };
  state.data.eventSets.push(es);
  wf.producedRecordIds.eventSetIds.push(es.id);

  // ── Analysis Config ──────────────────────────────────────────
  const cfg = {
    id: uuid(),
    name: uniqueName('20-Year Questionnaire Plan', state.data.analysisConfigs.map(c => c.name)),
    scenarioTitle: '', compareScenarioTitle: '',
    baselineId: bl.id, compareBaselineId: '',
    eventSetIds: [es.id], compareEventSetIds: [],
    startDate: start,
    endDate: addMonths(start, 240),
    viewMode: 'yearly',
    inflationRate: assum.inflationRate,
    taxRate:       assum.taxRate,
    monteCarlo: { enabled: true, numSimulations: 500, standardOfLivingMonthly: 7000 },
    eventOverrides: [],
    resultsStale: false,
  };
  state.data.analysisConfigs.push(cfg);
  wf.producedRecordIds.analysisConfigIds.push(cfg.id);

  wf.updatedAt = new Date().toISOString();
  saveData();
}

// ── Sequence navigation helpers ─────────────────────────────────────
// Used by question steps to compute their next / previous step from
// the dynamic questionnaire sequence (depends on selected topics).

function qsfNextQStep(wf, currentKey) {
  const def = getV1WorkflowDefinition('quickstart-family');
  const seq = def.getStepSequence(wf);
  const idx = seq.indexOf(currentKey);
  return (idx >= 0 && idx < seq.length - 1) ? seq[idx + 1] : 'review';
}
function qsfPrevQStep(wf, currentKey) {
  const def = getV1WorkflowDefinition('quickstart-family');
  const seq = def.getStepSequence(wf);
  const idx = seq.indexOf(currentKey);
  return (idx > 0) ? seq[idx - 1] : null;
}

// Generic onContinue body shared by the 4 simple capture-and-advance
// question steps. Captures via `capture`, writes to draftData under
// `topicKey`, advances; if next step is review, runs generation first.
function qsfAdvanceQ(wf, currentKey, topicKey, capture) {
  const q = qsfEnsureQDraft(wf);
  if (capture) q[topicKey] = capture(q[topicKey]);
  const next = qsfNextQStep(wf, currentKey);
  if (next === 'review') qsfGenerateQuestionnaireRecords(wf);
  return { ok: true, nextStepKey: next };
}

// ═══════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════

registerV1Workflow({
  id: 'quickstart-family',
  title: '20-year basic outlook',
  description: 'Project your household\'s net worth over 20 years. Start from a sample scenario or build from scratch — review your records, run the forecast, and get a summary you can save.',
  icon: '📈',
  estimatedTime: '5 min',
  category: 'main',
  eligible: () => true,
  initialStepKey: 'choose-path',
  initialDraft: () => ({ path: null, sampleId: null }),
  // Branching:
  //   sample path        → choose-path → pick-sample → review → confirm-run → summary
  //   scratch path       → choose-path → review → confirm-run → summary
  //   questionnaire path → choose-path → q-topics → [N selected topic Qs] → review → confirm-run → summary
  // Before path is selected, default to the sample sequence as a reasonable upper bound.
  getStepSequence: (wf) => {
    const tail = ['review', 'confirm-run', 'summary'];
    if (wf.draftData.path === 'scratch') return ['choose-path', ...tail];
    if (wf.draftData.path === 'questionnaire') {
      const topics = wf.draftData.q?.topics ?? QSF_QUESTIONNAIRE_TOPICS.map(t => t.key);
      const topicSteps = QSF_QUESTIONNAIRE_TOPICS
        .filter(t => topics.includes(t.key))
        .map(t => `q-${t.key}`);
      return ['choose-path', 'q-topics', ...topicSteps, ...tail];
    }
    return ['choose-path', 'pick-sample', ...tail];
  },
  steps: {
    'choose-path': {
      key: 'choose-path',
      title: 'How would you like to start?',
      render: qsfRenderChoosePath,
      onContinue: (wf) => {
        const path = wf.draftData.path;
        if (path !== 'sample' && path !== 'scratch' && path !== 'questionnaire') {
          return { ok: false, errors: ['Pick an option to continue.'] };
        }
        if (path === 'sample') return { ok: true, nextStepKey: 'pick-sample' };
        if (path === 'questionnaire') return { ok: true, nextStepKey: 'q-topics' };
        // 'scratch' — generate an empty baseline + event set + config
        // and jump straight to Review. Idempotent.
        qsfGenerateScratchRecords(wf);
        return { ok: true, nextStepKey: 'review' };
      },
      previousStepKey: null,
    },
    'pick-sample': {
      key: 'pick-sample',
      title: 'Pick a sample scenario',
      render: qsfRenderPickSample,
      onContinue: (wf) => {
        if (!wf.draftData.sampleId) {
          return { ok: false, errors: ['Pick a sample to continue.'] };
        }
        qsfGenerateRecords(wf); // idempotent
        return { ok: true, nextStepKey: 'review' };
      },
      previousStepKey: 'choose-path',
    },
    // ── Questionnaire path steps ───────────────────────────────────
    'q-topics': {
      key: 'q-topics',
      title: 'Which topics do you want to answer?',
      render: qsfRenderQTopics,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-topics', null, null),
      previousStepKey: 'choose-path',
    },
    'q-assumptions': {
      key: 'q-assumptions',
      title: 'Default assumptions',
      render: qsfRenderQAssumptions,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-assumptions', 'assumptions',
        () => qsfCaptureAssumptions()),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'q-assumptions'),
    },
    'q-income': {
      key: 'q-income',
      title: 'Income',
      render: qsfRenderQIncome,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-income', 'income',
        () => ({ streams: qsfCaptureIncomeRows() })),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'q-income'),
    },
    'q-savings': {
      key: 'q-savings',
      title: 'Savings & investments',
      render: qsfRenderQSavings,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-savings', 'savings',
        () => qsfCaptureSavings()),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'q-savings'),
    },
    'q-housing': {
      key: 'q-housing',
      title: 'Housing',
      render: qsfRenderQHousing,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-housing', 'housing',
        (prev) => qsfCaptureHousing(prev || qsfDefaultHousing())),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'q-housing'),
    },
    'q-recurring': {
      key: 'q-recurring',
      title: 'Recurring expenses',
      render: qsfRenderQRecurring,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-recurring', 'recurring',
        (prev) => qsfCaptureRecurring(prev || qsfDefaultRecurring())),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'q-recurring'),
    },
    'q-onetime': {
      key: 'q-onetime',
      title: 'Upcoming one-time events',
      render: qsfRenderQOnetime,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-onetime', 'onetime',
        () => ({ events: qsfCaptureOnetimeRows() })),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'q-onetime'),
    },
    'q-debts': {
      key: 'q-debts',
      title: 'Other debts',
      render: qsfRenderQDebts,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-debts', 'debts',
        () => ({ items: qsfCaptureDebtRows() })),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'q-debts'),
    },
    'review': {
      key: 'review',
      title: 'Review your starting records',
      render: qsfRenderReview,
      onContinue: () => ({ ok: true, nextStepKey: 'confirm-run' }),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'review'),
      continueLabel: 'Looks good — continue',
    },
    'confirm-run': {
      key: 'confirm-run',
      title: 'Run the forecast',
      render: qsfRenderConfirmRun,
      onContinue: (wf) => {
        qsfRunForecastAndAdvance(wf, 'summary');
        // Async path manages its own navigation; suppress runtime transition.
        return { ok: false };
      },
      previousStepKey: 'review',
      continueLabel: 'Run forecast',
    },
    'summary': {
      key: 'summary',
      title: 'Your starting picture',
      render: qsfRenderSummary,
      postRender: qsfAttachSummary,
      onContinue: () => ({ ok: true, nextStepKey: 'complete' }),
      previousStepKey: 'confirm-run',
      continueLabel: 'Finish',
    },
  },
});
