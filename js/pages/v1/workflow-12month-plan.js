'use strict';

// ═══════════════════════════════════════════════════════════════
// 12-MONTH PLAN
// ═══════════════════════════════════════════════════════════════
//
// A near-term, month-by-month planning workflow. Shares the
// choose-path + pick-sample + questionnaire surface with the 20-year
// basic outlook by consuming the shared sample registry
// (v1-samples.js) and the shared questionnaire registry
// (v1-questionnaires.js). Where this workflow differs:
//
//   - Forecast horizon is exactly 12 months from the workflow start.
//   - The Review step adds two sections on top of the standard records:
//       (a) Assumptions: inflation %, tax %, Monte Carlo toggle + sims.
//           Edits write straight into the analysis config and mark
//           results stale (no re-run prompt here — the Confirm-Run
//           step always runs the analysis fresh).
//       (b) Events for the next 12 months: each of the 12 months is
//           expanded into a sub-section listing every event firing
//           that month with an editable amount input. Editing a number
//           creates a per-month override via the existing monthly-
//           override mechanism (cfg.eventOverrides with _sourceId +
//           _month). The parent recurring event is left untouched, so
//           "edit January" doesn't mutate February.
//   - The Summary step is framed around the next 12 months (cash flow
//     focus, not 20-year projections) and includes a per-month
//     appendix table with starting NW, income, expenses, net cash
//     flow, and ending NW for every month.
//
// `t12` is the function prefix to keep handlers from colliding with
// the quickstart-family workflow.

const T12_QUESTIONNAIRE_ID = 'household-v1';
const T12_SAMPLE_ID        = 'family-mortgage';
const T12_HORIZON_MONTHS   = 12;

// ═══════════════════════════════════════════════════════════════
// SELECTION HELPERS
// ═══════════════════════════════════════════════════════════════

function t12SelectPath(workflowId, path) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  if (path !== 'sample' && path !== 'scratch' && path !== 'questionnaire') return;
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

function t12SelectSample(workflowId, sampleId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  wf.draftData.sampleId = sampleId;
  // Mutually exclusive with a built scenario selection.
  wf.draftData.builtScenarioId = null;
  wf.updatedAt = new Date().toISOString();
  saveData();
  navigate('v1-workflow', { workflowId });
}

function t12SelectBuiltScenario(workflowId, configId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  wf.draftData.builtScenarioId = configId;
  wf.draftData.sampleId = null;
  wf.updatedAt = new Date().toISOString();
  saveData();
  navigate('v1-workflow', { workflowId });
}

function t12RenameScenario(workflowId, newName) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  const cfg = t12Cfg(wf);
  if (!cfg) return;
  const trimmed = (newName || '').trim();
  if (!trimmed) {
    const input = document.getElementById('t12-scenario-name');
    if (input) input.value = cfg.name;
    return;
  }
  cfg.name = trimmed;
  wf.updatedAt = new Date().toISOString();
  saveData();
}

function t12GenerateReport(workflowId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) { generateSummaryReport(); return; }
  const cfg = t12Cfg(wf);
  generateSummaryReport(cfg?.name);
}

function t12Cfg(wf) {
  const cfgId = wf.producedRecordIds.analysisConfigIds[0];
  return cfgId ? state.data.analysisConfigs.find(c => c.id === cfgId) : null;
}

// ═══════════════════════════════════════════════════════════════
// ASSUMPTIONS EDITS (Review step)
// ═══════════════════════════════════════════════════════════════
// Each onchange handler writes through to the analysis config and
// saves. Toggling MC also shows/hides the sim-count input.

function t12SetInflation(workflowId, value) {
  const wf = getV1WorkflowInstance(workflowId);
  const cfg = wf && t12Cfg(wf);
  if (!cfg) return;
  cfg.inflationRate = parseFloat(value) || 0;
  saveData();
}
function t12SetTax(workflowId, value) {
  const wf = getV1WorkflowInstance(workflowId);
  const cfg = wf && t12Cfg(wf);
  if (!cfg) return;
  cfg.taxRate = parseFloat(value) || 0;
  saveData();
}
function t12SetMcEnabled(workflowId, enabled) {
  const wf = getV1WorkflowInstance(workflowId);
  const cfg = wf && t12Cfg(wf);
  if (!cfg) return;
  cfg.monteCarlo = cfg.monteCarlo || { enabled: false, numSimulations: 200, standardOfLivingMonthly: 7000 };
  cfg.monteCarlo.enabled = !!enabled;
  saveData();
  const wrap = document.getElementById('t12-mc-sims-wrap');
  if (wrap) wrap.style.display = enabled ? '' : 'none';
}
function t12SetMcSims(workflowId, value) {
  const wf = getV1WorkflowInstance(workflowId);
  const cfg = wf && t12Cfg(wf);
  if (!cfg) return;
  cfg.monteCarlo = cfg.monteCarlo || { enabled: false, numSimulations: 200, standardOfLivingMonthly: 7000 };
  cfg.monteCarlo.numSimulations = Math.max(1, parseInt(value, 10) || 200);
  saveData();
}

// ═══════════════════════════════════════════════════════════════
// PER-MONTH OVERRIDE HANDLERS (Review step)
// ═══════════════════════════════════════════════════════════════
// Uses the exact same monthly-override schema the legacy Results page
// uses: an entry in cfg.eventOverrides with _sourceId (= original
// event id) and _month (= 'YYYY-MM'). The forecast engine's
// resolveEffectiveEvents builds _excludedMonths from these, so the
// original recurring event is suppressed for the overridden month.

function t12SaveMonthOverride(workflowId, sourceId, month, value) {
  const wf = getV1WorkflowInstance(workflowId);
  const cfg = wf && t12Cfg(wf);
  if (!cfg) return;

  // Resolve the source event so we can copy across its routing fields
  // (depositToAssetName, payFromAssetName, etc.). Look in global
  // events first, then existing overrides (in case it was added via
  // the override modal).
  const src = state.data.events.find(e => e.id === sourceId)
    ?? (cfg.eventOverrides ?? []).find(e => e.id === sourceId);
  if (!src) { showToast('Event not found', 'error'); return; }

  const amount = parseFloat(value);
  if (!Number.isFinite(amount)) {
    showToast('Amount must be a number', 'error');
    return;
  }

  cfg.eventOverrides = cfg.eventOverrides ?? [];
  const id = `monthly-${sourceId}-${month}`;
  const overrideRecord = {
    id,
    _sourceId: sourceId,
    _month: month,
    name: src.name,
    notes: src.notes ?? '',
    category: src.category,
    type: src.type,
    amount,
    stdDevAmount: 0,
    isRecurring: false,
    startDate: month,
    endDate: '',
    inflationAdjusted: false,   // amount is the literal value for this month
    depositToAssetName:  src.depositToAssetName  ?? '',
    payFromAssetName:    src.payFromAssetName    ?? '',
    linkedAssetName:     src.linkedAssetName     ?? '',
    linkedLiabilityName: src.linkedLiabilityName ?? '',
  };
  const idx = cfg.eventOverrides.findIndex(e => e.id === id);
  if (idx >= 0) cfg.eventOverrides[idx] = overrideRecord;
  else cfg.eventOverrides.push(overrideRecord);
  cfg.resultsStale = true;
  saveData();

  // Re-render so the "modified" indicator + Reset button appear.
  navigate('v1-workflow', { workflowId });
}

function t12ResetMonthOverride(workflowId, sourceId, month) {
  const wf = getV1WorkflowInstance(workflowId);
  const cfg = wf && t12Cfg(wf);
  if (!cfg) return;
  const id = `monthly-${sourceId}-${month}`;
  cfg.eventOverrides = (cfg.eventOverrides ?? []).filter(e => e.id !== id);
  cfg.resultsStale = true;
  saveData();
  navigate('v1-workflow', { workflowId });
}

// ═══════════════════════════════════════════════════════════════
// RECORD GENERATION
// ═══════════════════════════════════════════════════════════════

function t12CommitRecords(wf, { baseline, events, eventSet, configName, monteCarlo }) {
  state.data.baselines.push(baseline);
  wf.producedRecordIds.baselineIds.push(baseline.id);

  for (const ev of events) {
    state.data.events.push(ev);
    wf.producedRecordIds.eventIds.push(ev.id);
  }

  state.data.eventSets.push(eventSet);
  wf.producedRecordIds.eventSetIds.push(eventSet.id);

  const start = baseline.date;
  const cfg = {
    id: uuid(),
    name: uniqueName(configName, state.data.analysisConfigs.map(c => c.name)),
    scenarioTitle: '', compareScenarioTitle: '',
    baselineId: baseline.id, compareBaselineId: '',
    eventSetIds: [eventSet.id], compareEventSetIds: [],
    startDate: start,
    endDate: addMonths(start, T12_HORIZON_MONTHS),
    viewMode: 'monthly',
    inflationRate: monteCarlo?.inflationRate ?? (state.data.settings?.defaultInflationRate ?? 3),
    taxRate:       monteCarlo?.taxRate       ?? (state.data.settings?.defaultTaxRate ?? 30),
    // Monte Carlo is off by default for a 12-month horizon — short
    // horizon means the percentile fan is narrow and adds little
    // information. The Review step lets the user turn it on.
    monteCarlo: { enabled: false, numSimulations: 200, standardOfLivingMonthly: 7000 },
    eventOverrides: [],
    resultsStale: false,
  };
  state.data.analysisConfigs.push(cfg);
  wf.producedRecordIds.analysisConfigIds.push(cfg.id);

  wf.updatedAt = new Date().toISOString();
  saveData();
}

function t12GenerateSampleRecords(wf) {
  if (wf.producedRecordIds.baselineIds.length > 0) return;
  const sample = getV1SampleDefinition(T12_SAMPLE_ID);
  if (!sample) { showToast('Sample missing', 'error'); return; }
  const { baseline, events, eventSet } = sample.generate({
    startDate: today(),
    takenBaselineNames: state.data.baselines.map(b => b.name),
    takenEventSetNames: state.data.eventSets.map(s => s.name),
    namePrefix: '12-Month',
  });
  t12CommitRecords(wf, { baseline, events, eventSet, configName: '12-Month Family Plan' });
}

// Clones a user's built scenario into fresh records for this run,
// then attaches a 12-month analysis config inheriting inflation +
// tax from the source. MC settings stay at the 12-month defaults
// (off) — the Review step's assumptions block lets the user enable.
function t12GenerateBuiltScenarioRecords(wf) {
  if (wf.producedRecordIds.baselineIds.length > 0) return;
  const cloned = cloneBuiltScenarioFromConfig(wf.draftData.builtScenarioId, {
    takenBaselineNames: state.data.baselines.map(b => b.name),
    takenEventSetNames: state.data.eventSets.map(s => s.name),
    namePrefix: '12-Month',
  });
  if (!cloned) { showToast('Built scenario not found', 'error'); return; }
  t12CommitRecords(wf, {
    baseline: cloned.baseline,
    events:   cloned.events,
    eventSet: cloned.eventSet,
    configName: `12-Month Plan from ${cloned.baseline.name}`,
    monteCarlo: {
      inflationRate: cloned.assumptions.inflationRate,
      taxRate:       cloned.assumptions.taxRate,
    },
  });
}

function t12GenerateScratchRecords(wf) {
  if (wf.producedRecordIds.baselineIds.length > 0) return;
  const start = today();
  const baseline = {
    id: uuid(),
    name: uniqueName('12-Month Custom Plan', state.data.baselines.map(b => b.name)),
    description: 'Generated by the 12-month plan workflow (start from scratch).',
    date: start,
    createdAt: new Date().toISOString(),
    assets: [],
    liabilities: [],
  };
  const eventSet = {
    id: uuid(),
    name: uniqueName('12-Month Custom Plan Events', state.data.eventSets.map(s => s.name)),
    description: 'Events for the 12-month plan (start from scratch).',
    eventIds: [],
  };
  t12CommitRecords(wf, { baseline, events: [], eventSet, configName: '12-Month Custom Plan' });
}

function t12GenerateQuestionnaireRecords(wf) {
  if (wf.producedRecordIds.baselineIds.length > 0) return;
  const qDef = getV1QuestionnaireDefinition(T12_QUESTIONNAIRE_ID);
  if (!qDef) { showToast('Questionnaire missing', 'error'); return; }

  const answers = wf.draftData.q ?? {};
  const assum = answers.assumptions ?? qDef.defaults.assumptions();

  const { baseline, events, eventSet } = qDef.generate(answers, {
    startDate: today(),
    takenBaselineNames: state.data.baselines.map(b => b.name),
    takenEventSetNames: state.data.eventSets.map(s => s.name),
    namePrefix: '12-Month',
    baselineDescription: 'Generated by the 12-month plan workflow (guided questionnaire).',
    eventSetDescription: 'Events from the 12-month plan guided questionnaire.',
  });

  t12CommitRecords(wf, {
    baseline, events, eventSet,
    configName: '12-Month Questionnaire Plan',
    monteCarlo: { inflationRate: assum.inflationRate, taxRate: assum.taxRate },
  });
}

// ═══════════════════════════════════════════════════════════════
// FORECAST EXECUTION
// ═══════════════════════════════════════════════════════════════

function t12HasFreshRun(wf) {
  const cfgId = wf.producedRecordIds.analysisConfigIds[0];
  return !!(cfgId && state.lastRun && state.lastRunConfig?.id === cfgId);
}

function t12RunForecastAndAdvance(wf, nextStepKey) {
  const cfg = t12Cfg(wf);
  if (!cfg) { showToast('Analysis config missing', 'error'); return; }

  cfg.resultsStale = false;
  saveData();

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

function t12BuildSummaryComponents(wf) {
  const cfg = state.lastRunConfig;
  const run = state.lastRun;
  if (!cfg || !run?.detResults?.length) return [];

  const det = run.detResults;
  const mc  = run.mcResults; // may be null
  const first = det[0];
  const last  = det[det.length - 1];

  // ── Aggregate flows across the horizon ──────────────────────────
  let totalIncome = 0, totalExpense = 0, totalTransfer = 0;
  for (const r of det) {
    totalIncome   += r.incomeThisMonth   || 0;
    totalExpense  += r.expenseThisMonth  || 0;
    totalTransfer += r.transferThisMonth || 0;
  }
  const netCashFlow = totalIncome - totalExpense;
  const finalMc = mc && mc.length ? mc[mc.length - 1] : null;

  // ── Narrative ────────────────────────────────────────────────────
  const startNw = first.netWorth;
  const endNw   = finalMc ? finalMc.p50 : last.netWorth;
  const nwDelta = endNw - startNw;
  const direction = nwDelta >= 0 ? 'grows' : 'declines';
  const narrative = `<p>Over the next 12 months, your projected net worth ${direction} from <strong>${esc(fmt$(startNw))}</strong> to <strong>${esc(fmt$(endNw))}</strong>${finalMc ? ' (median outcome)' : ''}. That's a net change of <strong>${esc(fmt$(nwDelta))}</strong>.</p>
    <p>You take in about <strong>${esc(fmt$(totalIncome))}</strong> in income and spend <strong>${esc(fmt$(totalExpense))}</strong> on living expenses and loan payments over the period, for a net cash flow of <strong>${esc(fmt$(netCashFlow))}</strong>.</p>`;

  // ── KPI grid ─────────────────────────────────────────────────────
  const kpis = [
    { label: 'Current net worth',     value: fmt$(startNw) },
    { label: 'NW at month 12',         value: fmt$(endNw), sublabel: finalMc ? 'median outcome' : 'deterministic' },
    { label: 'Total income (12 mo)',   value: fmt$(totalIncome) },
    { label: 'Total expenses (12 mo)', value: fmt$(totalExpense) },
    { label: 'Net cash flow',          value: fmt$(netCashFlow), sublabel: netCashFlow >= 0 ? 'surplus' : 'deficit' },
  ];

  // ── Net worth chart over 12 months ──────────────────────────────
  const labels = det.map(r => monthLabel(r.month));
  const datasets = [];
  if (mc && mc.length) {
    datasets.push(
      { label: '', data: mc.map(r => r.p90), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(37,99,235,0.07)' },
      { label: '', data: mc.map(r => r.p75), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(37,99,235,0.13)' },
      { label: '', data: mc.map(r => r.p25), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(37,99,235,0.13)' },
      { label: '', data: mc.map(r => r.p10), borderWidth: 0, pointRadius: 0, fill: false },
      { label: 'Median (p50)', data: mc.map(r => r.p50), borderColor: 'rgba(37,99,235,0.9)', backgroundColor: 'rgba(37,99,235,0.9)', borderWidth: 1.5, pointRadius: 0, fill: false },
    );
  }
  datasets.push({
    label: 'Net Worth',
    data: det.map(r => r.netWorth),
    borderColor: mc ? 'rgba(55,65,81,0.85)' : '#2563eb',
    backgroundColor: mc ? 'rgba(55,65,81,0.85)' : 'rgba(37,99,235,0.12)',
    borderWidth: 2,
    borderDash: mc ? [4, 4] : [],
    pointRadius: 3,
    fill: mc ? false : 'origin',
    tension: 0.15,
  });

  const chartConfig = {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: !!mc, position: 'bottom', labels: { boxWidth: 14, filter: it => it.text && it.text.length > 0 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label || 'Net Worth'}: ${fmt$(ctx.parsed.y)}` } },
      },
      scales: {
        y: { ticks: { callback: v => fmtCompact(v) } },
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
      },
    },
  };

  // ── Scenario inputs ──────────────────────────────────────────────
  const inputRows = [
    { label: 'Forecast horizon', value: `12 months (${monthLabel(cfg.startDate)} → ${monthLabel(cfg.endDate)})` },
    { label: 'Inflation rate',   value: `${cfg.inflationRate}% / year` },
    { label: 'Income tax rate',  value: `${cfg.taxRate}%` },
    { label: 'Monte Carlo',      value: cfg.monteCarlo?.enabled ? `${cfg.monteCarlo.numSimulations} simulations` : 'Off' },
    { label: 'Events used',      value: `${wf.producedRecordIds.eventIds.length} (excl. per-month overrides)` },
  ];

  // ── Appendix table: per-month breakdown ──────────────────────────
  const appendixColumns = ['Month', 'Starting NW', 'Income', 'Expenses', 'Transfers', 'Net Cash Flow', 'Δ NW', 'Ending NW'];
  const appendixRows = det.map(r => {
    const income   = r.incomeThisMonth   || 0;
    const expense  = r.expenseThisMonth  || 0;
    const transfer = r.transferThisMonth || 0;
    const netCf    = income - expense;
    const dnw      = r.netWorth - r.startNetWorth;
    return [
      monthLabel(r.month),
      fmt$(r.startNetWorth),
      fmt$(income),
      fmt$(expense),
      fmt$(transfer),
      fmt$(netCf),
      fmt$(dnw),
      fmt$(r.netWorth),
    ];
  });
  // Add a totals row.
  appendixRows.push([
    'Total',
    fmt$(first.startNetWorth),
    fmt$(totalIncome),
    fmt$(totalExpense),
    fmt$(totalTransfer),
    fmt$(netCashFlow),
    fmt$(last.netWorth - first.startNetWorth),
    fmt$(last.netWorth),
  ]);

  return [
    { type: 'narrative', html: narrative },
    { type: 'kpi-grid', items: kpis },
    { type: 'chart', id: 't12-summary-nw', title: 'Net worth over the next 12 months', config: chartConfig, height: 300 },
    { type: 'data-section', title: 'Scenario inputs', rows: inputRows },
    { type: 'data-table',
      title: 'Appendix — monthly detail',
      columns: appendixColumns,
      rows: appendixRows,
      align: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'] },
  ];
}

// ═══════════════════════════════════════════════════════════════
// STEP RENDERERS — paths & generation
// ═══════════════════════════════════════════════════════════════

function t12RenderChoosePath(wf) {
  const sel = wf.draftData.path;
  const locked = (wf.producedRecordIds?.baselineIds?.length ?? 0) > 0;

  const cardClass = (key) => {
    if (sel === key) return 'v1-option-card selected';
    if (locked) return 'v1-option-card disabled';
    return 'v1-option-card';
  };
  const clickAttr = (key) => {
    if (locked && sel !== key) return '';
    return `onclick="t12SelectPath('${esc(wf.id)}','${key}')"`;
  };

  return `
    <p>Pick how you'd like to build your 12-month plan.</p>
    <div class="alert alert-info" style="margin: 14px 0 18px 0; font-size: 13px;">
      <strong>Heads up:</strong> after you Continue, this choice is locked. If you want to try a different path later, Exit, then Discard the workflow from Get Started and start fresh.
    </div>
    <div class="v1-card-grid">
      <div class="${cardClass('sample')}" ${clickAttr('sample')}>
        <div class="v1-option-icon">📋</div>
        <div class="v1-option-body">
          <div class="v1-option-title">Use a sample scenario</div>
          <div class="v1-option-desc">Start from a realistic template and tweak any numbers for the next 12 months.</div>
        </div>
        <div class="v1-option-check">${sel === 'sample' ? '✓' : ''}</div>
      </div>
      <div class="${cardClass('scratch')}" ${clickAttr('scratch')}>
        <div class="v1-option-icon">✏️</div>
        <div class="v1-option-body">
          <div class="v1-option-title">Start from scratch</div>
          <div class="v1-option-desc">Build a plan from an empty baseline. Add your assets, liabilities, and events on the Review step.</div>
        </div>
        <div class="v1-option-check">${sel === 'scratch' ? '✓' : ''}</div>
      </div>
      <div class="${cardClass('questionnaire')}" ${clickAttr('questionnaire')}>
        <div class="v1-option-icon">📝</div>
        <div class="v1-option-body">
          <div class="v1-option-title">Guided questionnaire</div>
          <div class="v1-option-desc">Answer a series of short questions about income, savings, housing, and expenses — we'll generate your plan from your answers.</div>
        </div>
        <div class="v1-option-check">${sel === 'questionnaire' ? '✓' : ''}</div>
      </div>
    </div>
  `;
}

function t12RenderPickSample(wf) {
  const selSample = wf.draftData.sampleId;
  const selBuilt  = wf.draftData.builtScenarioId;
  const sample = getV1SampleDefinition(T12_SAMPLE_ID);
  const builtScenarios = listBuiltScenarios();

  const sampleSection = sample ? `
    <div class="v1-section-subtitle">Sample scenarios</div>
    <div class="v1-card-grid">
      <div class="v1-option-card${selSample === sample.id ? ' selected' : ''}" onclick="t12SelectSample('${esc(wf.id)}','${esc(sample.id)}')">
        <div class="v1-option-icon">${esc(sample.icon || '✨')}</div>
        <div class="v1-option-body">
          <div class="v1-option-title">${esc(sample.label)}</div>
          <div class="v1-option-desc">${esc(sample.description)}</div>
        </div>
        <div class="v1-option-check">${selSample === sample.id ? '✓' : ''}</div>
      </div>
    </div>
  ` : '';

  const builtSection = builtScenarios.length ? `
    <div class="v1-section-subtitle" style="margin-top:24px">My built scenarios</div>
    <p class="v1-section-hint">Scenarios you've saved via the <em>Build or edit a scenario</em> workflow. Selecting one clones it into this run, so your edits here won't affect the saved scenario.</p>
    <div class="v1-card-grid">
      ${builtScenarios.map(s => `
        <div class="v1-option-card${selBuilt === s.configId ? ' selected' : ''}" onclick="t12SelectBuiltScenario('${esc(wf.id)}','${esc(s.configId)}')">
          <div class="v1-option-icon">🗂️</div>
          <div class="v1-option-body">
            <div class="v1-option-title">${esc(s.name)}</div>
            <div class="v1-option-desc">Baseline: ${esc(s.baselineName)} · saved ${esc(new Date(s.completedAt).toLocaleDateString())}</div>
          </div>
          <div class="v1-option-check">${selBuilt === s.configId ? '✓' : ''}</div>
        </div>
      `).join('')}
    </div>
  ` : '';

  return `
    <p>Choose a starting scenario. You'll be able to review and edit every record on the next step.</p>
    ${sampleSection}
    ${builtSection}
  `;
}

// ═══════════════════════════════════════════════════════════════
// STEP RENDERERS — review (with assumptions + per-month editor)
// ═══════════════════════════════════════════════════════════════

function t12RenderAssumptionsBlock(wf, cfg) {
  const mcOn = !!cfg.monteCarlo?.enabled;
  const sims = cfg.monteCarlo?.numSimulations ?? 200;
  return `
    <div class="v1-review-section">
      <div class="v1-review-section-header">
        <div class="v1-review-section-title">Assumptions</div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Inflation rate <span class="label-note">(% / year)</span></label>
          <input type="number" value="${Number(cfg.inflationRate) || 0}" min="0" step="0.1"
                 onchange="t12SetInflation('${esc(wf.id)}', this.value)">
          <div class="form-hint">Grows inflation-adjusted event amounts each month.</div>
        </div>
        <div class="form-group">
          <label>Income tax rate <span class="label-note">(%)</span></label>
          <input type="number" value="${Number(cfg.taxRate) || 0}" min="0" step="0.5"
                 onchange="t12SetTax('${esc(wf.id)}', this.value)">
          <div class="form-hint">Applied to income events. Set to 0% if amounts are already after-tax.</div>
        </div>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" ${mcOn ? 'checked' : ''}
                 onchange="t12SetMcEnabled('${esc(wf.id)}', this.checked)">
          Run Monte Carlo simulation
        </label>
        <div class="form-hint">For a 12-month horizon the percentile fan is narrow — leave off for a deterministic projection, on to see the range.</div>
      </div>
      <div class="form-group" id="t12-mc-sims-wrap" style="${mcOn ? '' : 'display:none'}">
        <label>Number of simulations</label>
        <input type="number" value="${sims}" min="50" step="50"
               onchange="t12SetMcSims('${esc(wf.id)}', this.value)">
      </div>
    </div>
  `;
}

function t12RenderMonthlyEventsBlock(wf, cfg) {
  // Pull events with monthly overrides already applied (resolveEffectiveEvents
  // suppresses overridden months on the original recurring event and appends
  // the monthly override as a one-time event for that month).
  const events = resolveEffectiveEvents(cfg);
  const overrides = cfg.eventOverrides ?? [];
  const overrideById = new Map(
    overrides.filter(e => e._sourceId).map(e => [`${e._sourceId}|${e._month}`, e])
  );

  const months = [];
  for (let i = 0; i < T12_HORIZON_MONTHS; i++) {
    months.push(addMonths(cfg.startDate, i));
  }

  // PERIOD_TYPE_ORDER mirrors the legacy results page ordering.
  const TYPE_ORDER = { income: 0, one_time_inflow: 1, expense: 2, one_time_outflow: 3 };

  const monthSections = months.map((month, idx) => {
    // getEventsForPeriod returns [{ ev, amount, cfAmount }] with the
    // effective inflated amount for that month already computed.
    let entries = getEventsForPeriod(month, 'monthly', events, cfg);
    entries = entries
      .filter(e => e.ev.type !== 'loan_payment') // synthetic; not user-editable here
      .sort((a, b) => {
        const ta = TYPE_ORDER[a.ev.type] ?? 99;
        const tb = TYPE_ORDER[b.ev.type] ?? 99;
        if (ta !== tb) return ta - tb;
        return Math.abs(b.amount) - Math.abs(a.amount);
      });

    if (!entries.length) {
      return `
        <div class="t12-month-block">
          <div class="t12-month-header">Month ${idx + 1} · ${esc(monthLabel(month))}</div>
          <div class="t12-month-empty">No events fire this month.</div>
        </div>
      `;
    }

    const rows = entries.map(({ ev, amount }) => {
      // _sourceId on the entry tells us this is the override-stand-in
      // for a recurring event's month. For one-time events and
      // non-overridden recurring events, sourceId === ev.id and the
      // month lookup is ev.startDate.
      const isMonthlyOverride = !!ev._sourceId;
      const sourceId = ev._sourceId ?? ev.id;
      const monthKey = ev._month ?? month;
      const isOverridden = overrideById.has(`${sourceId}|${monthKey}`);
      const typeLabel = {
        income: 'Income',
        one_time_inflow: 'One-time In',
        expense: 'Expense',
        one_time_outflow: 'One-time Out',
      }[ev.type] || ev.type;
      const typeClass = (ev.type === 'income' || ev.type === 'one_time_inflow') ? 'positive' : 'negative';
      return `
        <div class="t12-event-row">
          <div class="t12-event-name">
            <span class="t12-event-name-text">${esc(ev.name)}</span>
            <span class="t12-event-type t12-event-type-${typeClass}">${esc(typeLabel)}</span>
            ${isOverridden ? `<span class="t12-event-flag">modified</span>` : ''}
          </div>
          <div class="t12-event-amount">
            <span class="t12-event-amount-prefix">$</span>
            <input type="number" step="0.01" value="${(Number(amount) || 0).toFixed(2)}"
                   onchange="t12SaveMonthOverride('${esc(wf.id)}','${esc(sourceId)}','${esc(monthKey)}', this.value)">
          </div>
          <div class="t12-event-actions">
            ${isOverridden
              ? `<button class="btn btn-sm btn-ghost" onclick="t12ResetMonthOverride('${esc(wf.id)}','${esc(sourceId)}','${esc(monthKey)}')">Reset</button>`
              : ''}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="t12-month-block">
        <div class="t12-month-header">Month ${idx + 1} · ${esc(monthLabel(month))}</div>
        <div class="t12-month-rows">${rows}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="v1-review-section">
      <div class="v1-review-section-header">
        <div class="v1-review-section-title">Events for the next 12 months</div>
      </div>
      <p class="v1-review-section-hint">Each row shows the amount the forecast will use for that month. Edit any number to override just that month — the underlying event for other months is unchanged. Loan payments are computed automatically from the liability's amortization schedule and don't appear here.</p>
      ${monthSections}
    </div>
  `;
}

function t12RenderReview(wf) {
  const blId = wf.producedRecordIds.baselineIds[0];
  const bl = blId ? state.data.baselines.find(b => b.id === blId) : null;
  const cfg = t12Cfg(wf);
  if (!bl || !cfg) return `<p style="color:var(--danger)">Generation failed — please go back and re-select the path.</p>`;

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
    <p>Review the records this workflow generated. Edit anything that doesn't fit; changes save immediately. The bottom section lets you fine-tune any single month's amounts.</p>

    <div class="form-group" style="margin-bottom: 24px;">
      <label for="t12-scenario-name">Scenario name</label>
      <input type="text" id="t12-scenario-name" value="${esc(cfg.name)}"
             onchange="t12RenameScenario('${esc(wf.id)}', this.value)" />
      <div class="form-hint">Labels this scenario in your Analysis list and is used as the title when you Generate Report.</div>
    </div>

    ${t12RenderAssumptionsBlock(wf, cfg)}

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
      <p class="v1-review-section-hint">Events here apply across all months. Use the section below to override a specific month's amount.</p>
      ${events.length ? events.map(renderEvRow).join('') : '<div class="v1-review-empty">No events.</div>'}
    </div>

    ${t12RenderMonthlyEventsBlock(wf, cfg)}
  `;
}

function t12RenderConfirmRun(wf) {
  const cfg = t12Cfg(wf);
  const numSims = cfg?.monteCarlo?.numSimulations ?? 200;
  const mcOn = !!cfg?.monteCarlo?.enabled;
  const overrideCount = (cfg?.eventOverrides ?? []).filter(e => e._sourceId).length;

  return `
    <p>You're ready to run the 12-month forecast.</p>
    <ul style="color:var(--muted); font-size: 13.5px; line-height: 1.7; margin: 0 0 14px 18px;">
      <li>Period: <strong>${esc(monthLabel(cfg?.startDate))}</strong> through <strong>${esc(monthLabel(cfg?.endDate))}</strong></li>
      <li>Inflation rate: <strong>${cfg?.inflationRate ?? 0}% / year</strong></li>
      <li>Tax rate: <strong>${cfg?.taxRate ?? 0}%</strong></li>
      <li>Monte Carlo: <strong>${mcOn ? `On (${numSims} simulations)` : 'Off'}</strong></li>
      <li>Per-month overrides: <strong>${overrideCount}</strong></li>
    </ul>
    <p style="color:var(--muted); font-size: 13.5px;">Click Run forecast when you're ready.</p>
  `;
}

function t12RenderSummary(wf) {
  if (!t12HasFreshRun(wf)) {
    requestAnimationFrame(() => t12RunForecastAndAdvance(wf, null));
    return `<p style="color:var(--muted)">Re-running analysis…</p>`;
  }

  const components = t12BuildSummaryComponents(wf);
  const cfgId = wf.producedRecordIds.analysisConfigIds[0];
  const cfg = state.data.analysisConfigs.find(c => c.id === cfgId);
  const scenarioName = cfg?.name || 'this scenario';

  return `
    <p>Here's how the next 12 months look for <strong>${esc(scenarioName)}</strong>. The appendix at the bottom shows every month in detail.</p>
    <div class="v1-summary-zone">
      ${renderSummaryComponents(components)}
    </div>
    <div class="v1-summary-cta-row">
      <button class="btn btn-primary" onclick="t12GenerateReport('${esc(wf.id)}')">Generate Report</button>
      <button class="btn btn-secondary" onclick="navigate('results',{configId:'${esc(cfgId)}'})">Explore full analysis</button>
    </div>
  `;
}

function t12AttachSummary(wf) {
  const components = t12BuildSummaryComponents(wf);
  attachSummaryCharts(components);
}

// ═══════════════════════════════════════════════════════════════
// QUESTIONNAIRE GLUE
// ═══════════════════════════════════════════════════════════════

function t12QDef() { return getV1QuestionnaireDefinition(T12_QUESTIONNAIRE_ID); }

function t12EnsureQDraft(wf) {
  wf.draftData.q = wf.draftData.q ?? {};
  return wf.draftData.q;
}

function t12NextQStep(wf, currentKey) {
  const def = getV1WorkflowDefinition('twelve-month-plan');
  const seq = def.getStepSequence(wf);
  const idx = seq.indexOf(currentKey);
  return (idx >= 0 && idx < seq.length - 1) ? seq[idx + 1] : 'review';
}
function t12PrevQStep(wf, currentKey) {
  const def = getV1WorkflowDefinition('twelve-month-plan');
  const seq = def.getStepSequence(wf);
  const idx = seq.indexOf(currentKey);
  return (idx > 0) ? seq[idx - 1] : null;
}

function t12AdvanceQ(wf, currentKey, topicKey) {
  const qDef = t12QDef();
  const q = t12EnsureQDraft(wf);
  const capture = topicKey ? qDef?.captures?.[topicKey] : null;
  if (capture) q[topicKey] = capture(q[topicKey]);
  const next = t12NextQStep(wf, currentKey);
  if (next === 'review') t12GenerateQuestionnaireRecords(wf);
  return { ok: true, nextStepKey: next };
}

function t12RenderQTopics(wf)      { return t12QDef().renders.topics     (wf.id, t12EnsureQDraft(wf)); }
function t12RenderQAssumptions(wf) { return t12QDef().renders.assumptions(wf.id, t12EnsureQDraft(wf)); }
function t12RenderQIncome(wf)      { return t12QDef().renders.income     (wf.id, t12EnsureQDraft(wf)); }
function t12RenderQSavings(wf)     { return t12QDef().renders.savings    (wf.id, t12EnsureQDraft(wf)); }
function t12RenderQHousing(wf)     { return t12QDef().renders.housing    (wf.id, t12EnsureQDraft(wf)); }
function t12RenderQRecurring(wf)   { return t12QDef().renders.recurring  (wf.id, t12EnsureQDraft(wf)); }
function t12RenderQOnetime(wf)     { return t12QDef().renders.onetime    (wf.id, t12EnsureQDraft(wf)); }
function t12RenderQDebts(wf)       { return t12QDef().renders.debts      (wf.id, t12EnsureQDraft(wf)); }

// ═══════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════

registerV1Workflow({
  id: 'twelve-month-plan',
  title: '12-month plan',
  description: 'Map out the next 12 months month-by-month. Pick a sample, answer a short questionnaire, or start from scratch — then fine-tune any individual month\'s amounts.',
  icon: '📅',
  estimatedTime: '5–10 min',
  category: 'main',
  eligible: () => true,
  initialStepKey: 'choose-path',
  initialDraft: () => ({ path: null, sampleId: null }),
  // Branching mirrors quickstart-family:
  //   sample        → choose-path → pick-sample → review → confirm-run → summary
  //   scratch       → choose-path → review → confirm-run → summary
  //   questionnaire → choose-path → q-topics → [N topic Qs] → review → confirm-run → summary
  getStepSequence: (wf) => {
    const tail = ['review', 'confirm-run', 'summary'];
    if (wf.draftData.path === 'scratch') return ['choose-path', ...tail];
    if (wf.draftData.path === 'questionnaire') {
      const qDef = getV1QuestionnaireDefinition(T12_QUESTIONNAIRE_ID);
      const allTopics = qDef?.topics ?? [];
      const selected = wf.draftData.q?.topics ?? allTopics.map(t => t.key);
      const topicSteps = allTopics
        .filter(t => selected.includes(t.key))
        .map(t => `q-${t.key}`);
      return ['choose-path', 'q-topics', ...topicSteps, ...tail];
    }
    return ['choose-path', 'pick-sample', ...tail];
  },
  steps: {
    'choose-path': {
      key: 'choose-path',
      title: 'How would you like to start?',
      render: t12RenderChoosePath,
      onContinue: (wf) => {
        const path = wf.draftData.path;
        if (path !== 'sample' && path !== 'scratch' && path !== 'questionnaire') {
          return { ok: false, errors: ['Pick an option to continue.'] };
        }
        if (path === 'sample') return { ok: true, nextStepKey: 'pick-sample' };
        if (path === 'questionnaire') return { ok: true, nextStepKey: 'q-topics' };
        t12GenerateScratchRecords(wf);
        return { ok: true, nextStepKey: 'review' };
      },
      previousStepKey: null,
    },
    'pick-sample': {
      key: 'pick-sample',
      title: 'Pick a starting scenario',
      render: t12RenderPickSample,
      onContinue: (wf) => {
        if (wf.draftData.builtScenarioId) {
          t12GenerateBuiltScenarioRecords(wf);
          return { ok: true, nextStepKey: 'review' };
        }
        if (wf.draftData.sampleId) {
          t12GenerateSampleRecords(wf);
          return { ok: true, nextStepKey: 'review' };
        }
        return { ok: false, errors: ['Pick a scenario to continue.'] };
      },
      previousStepKey: 'choose-path',
    },
    'q-topics': {
      key: 'q-topics',
      title: 'Which topics do you want to answer?',
      render: t12RenderQTopics,
      onContinue: (wf) => t12AdvanceQ(wf, 'q-topics', null),
      previousStepKey: 'choose-path',
    },
    'q-assumptions': {
      key: 'q-assumptions',
      title: 'Default assumptions',
      render: t12RenderQAssumptions,
      onContinue: (wf) => t12AdvanceQ(wf, 'q-assumptions', 'assumptions'),
      previousStepKey: (wf) => t12PrevQStep(wf, 'q-assumptions'),
    },
    'q-income': {
      key: 'q-income',
      title: 'Income',
      render: t12RenderQIncome,
      onContinue: (wf) => t12AdvanceQ(wf, 'q-income', 'income'),
      previousStepKey: (wf) => t12PrevQStep(wf, 'q-income'),
    },
    'q-savings': {
      key: 'q-savings',
      title: 'Savings & investments',
      render: t12RenderQSavings,
      onContinue: (wf) => t12AdvanceQ(wf, 'q-savings', 'savings'),
      previousStepKey: (wf) => t12PrevQStep(wf, 'q-savings'),
    },
    'q-housing': {
      key: 'q-housing',
      title: 'Housing',
      render: t12RenderQHousing,
      onContinue: (wf) => t12AdvanceQ(wf, 'q-housing', 'housing'),
      previousStepKey: (wf) => t12PrevQStep(wf, 'q-housing'),
    },
    'q-recurring': {
      key: 'q-recurring',
      title: 'Recurring expenses',
      render: t12RenderQRecurring,
      onContinue: (wf) => t12AdvanceQ(wf, 'q-recurring', 'recurring'),
      previousStepKey: (wf) => t12PrevQStep(wf, 'q-recurring'),
    },
    'q-onetime': {
      key: 'q-onetime',
      title: 'Upcoming one-time events',
      render: t12RenderQOnetime,
      onContinue: (wf) => t12AdvanceQ(wf, 'q-onetime', 'onetime'),
      previousStepKey: (wf) => t12PrevQStep(wf, 'q-onetime'),
    },
    'q-debts': {
      key: 'q-debts',
      title: 'Other debts',
      render: t12RenderQDebts,
      onContinue: (wf) => t12AdvanceQ(wf, 'q-debts', 'debts'),
      previousStepKey: (wf) => t12PrevQStep(wf, 'q-debts'),
    },
    'review': {
      key: 'review',
      title: 'Review your starting records',
      render: t12RenderReview,
      onContinue: () => ({ ok: true, nextStepKey: 'confirm-run' }),
      previousStepKey: (wf) => t12PrevQStep(wf, 'review'),
      continueLabel: 'Looks good — continue',
    },
    'confirm-run': {
      key: 'confirm-run',
      title: 'Run the 12-month forecast',
      render: t12RenderConfirmRun,
      onContinue: (wf) => {
        t12RunForecastAndAdvance(wf, 'summary');
        return { ok: false };
      },
      previousStepKey: 'review',
      continueLabel: 'Run forecast',
    },
    'summary': {
      key: 'summary',
      title: 'Your next 12 months',
      render: t12RenderSummary,
      postRender: t12AttachSummary,
      onContinue: () => ({ ok: true, nextStepKey: 'complete' }),
      previousStepKey: 'confirm-run',
      continueLabel: 'Finish',
    },
  },
});
