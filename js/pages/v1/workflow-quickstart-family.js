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
//      mortgage" (pulled from the shared sample registry). Adds a
//      pick-sample step before generation.
//   2. "Start from scratch"    — empty baseline + empty event set;
//      user fills it in on the Review step via + Add buttons.
//   3. "Guided questionnaire"  — runs the shared 'household-v1'
//      questionnaire (defined in v1-questionnaires.js).
//
// All paths share the common backbone: choose-path → … →
// review → confirm-run → summary. Generation is idempotent and
// path-locked: once records are produced, the user can't switch
// paths without discarding the workflow first.
//
// Sample scenarios and the questionnaire are owned by the v1-samples
// and v1-questionnaires modules respectively. This workflow refers to
// each by id, layers its own 20-year analysis config on top, and
// records what was produced for rollback purposes.

const QSF_QUESTIONNAIRE_ID = 'household-v1';
const QSF_SAMPLE_ID        = 'family-mortgage';
const QSF_HORIZON_MONTHS   = 240; // 20 years

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
// Each path generates a baseline + events + event set via the shared
// module, then attaches a 20-year analysis config. Idempotent: if
// records already exist on this workflow instance, generation is
// skipped (so going back-and-forward doesn't duplicate).

function qsfCommitRecords(wf, { baseline, events, eventSet, configName, monteCarlo }) {
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
    endDate: addMonths(start, QSF_HORIZON_MONTHS),
    viewMode: 'yearly',
    inflationRate: monteCarlo?.inflationRate ?? (state.data.settings?.defaultInflationRate ?? 3),
    taxRate:       monteCarlo?.taxRate       ?? (state.data.settings?.defaultTaxRate ?? 30),
    monteCarlo: { enabled: true, numSimulations: 500, standardOfLivingMonthly: 7000 },
    eventOverrides: [],
    resultsStale: false,
  };
  state.data.analysisConfigs.push(cfg);
  wf.producedRecordIds.analysisConfigIds.push(cfg.id);

  wf.updatedAt = new Date().toISOString();
  saveData();
}

function qsfGenerateSampleRecords(wf) {
  if (wf.producedRecordIds.baselineIds.length > 0) return;
  const sample = getV1SampleDefinition(QSF_SAMPLE_ID);
  if (!sample) { showToast('Sample missing', 'error'); return; }
  const { baseline, events, eventSet } = sample.generate({
    startDate: today(),
    takenBaselineNames: state.data.baselines.map(b => b.name),
    takenEventSetNames: state.data.eventSets.map(s => s.name),
  });
  qsfCommitRecords(wf, { baseline, events, eventSet, configName: '20-Year Family Plan' });
}

function qsfGenerateScratchRecords(wf) {
  if (wf.producedRecordIds.baselineIds.length > 0) return;

  const start = today();
  const baseline = {
    id: uuid(),
    name: uniqueName('Custom Plan', state.data.baselines.map(b => b.name)),
    description: 'Generated by the 20-year basic outlook workflow (start from scratch).',
    date: start,
    createdAt: new Date().toISOString(),
    assets: [],
    liabilities: [],
  };
  const eventSet = {
    id: uuid(),
    name: uniqueName('Custom Plan Events', state.data.eventSets.map(s => s.name)),
    description: 'Events for the 20-year basic outlook (start from scratch).',
    eventIds: [],
  };
  qsfCommitRecords(wf, { baseline, events: [], eventSet, configName: '20-Year Custom Plan' });
}

function qsfGenerateQuestionnaireRecords(wf) {
  if (wf.producedRecordIds.baselineIds.length > 0) return;
  const qDef = getV1QuestionnaireDefinition(QSF_QUESTIONNAIRE_ID);
  if (!qDef) { showToast('Questionnaire missing', 'error'); return; }

  const answers = wf.draftData.q ?? {};
  const assum = answers.assumptions ?? qDef.defaults.assumptions();

  const { baseline, events, eventSet } = qDef.generate(answers, {
    startDate: today(),
    takenBaselineNames: state.data.baselines.map(b => b.name),
    takenEventSetNames: state.data.eventSets.map(s => s.name),
    baselineDescription: 'Generated by the 20-year basic outlook workflow (guided questionnaire).',
    eventSetDescription: 'Events from the 20-year basic outlook guided questionnaire.',
  });

  qsfCommitRecords(wf, {
    baseline, events, eventSet,
    configName: '20-Year Questionnaire Plan',
    monteCarlo: { inflationRate: assum.inflationRate, taxRate: assum.taxRate },
  });
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

  const detYr = aggregateYearly(det);
  const mcYr  = mc ? aggregateMCYearly(mc) : null;
  const labels = detYr.map(r => r.month.slice(0, 4));

  const datasets = [];
  if (mcYr) {
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
      html: `<p>This plan projects your household's net worth ${growthLine}. ${payoffLine}</p>${mcLine ? `<p>${mcLine}</p>` : ''}`,
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
    if (locked) return 'v1-option-card disabled';
    return 'v1-option-card';
  };
  const clickAttr = (key, { disabled = false } = {}) => {
    if (disabled) return '';
    if (locked && sel !== key) return '';
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
  const sample = getV1SampleDefinition(QSF_SAMPLE_ID);
  if (!sample) return `<p style="color:var(--danger)">Sample missing.</p>`;
  return `
    <p>Choose a sample scenario to start from. You'll be able to review and edit every record on the next step.</p>
    <div class="v1-card-grid" style="margin-top:20px">
      <div class="v1-option-card${sel === sample.id ? ' selected' : ''}" onclick="qsfSelectSample('${esc(wf.id)}','${esc(sample.id)}')">
        <div class="v1-option-icon">${esc(sample.icon || '✨')}</div>
        <div class="v1-option-body">
          <div class="v1-option-title">${esc(sample.label)}</div>
          <div class="v1-option-desc">${esc(sample.description)}</div>
        </div>
        <div class="v1-option-check">${sel === sample.id ? '✓' : ''}</div>
      </div>
    </div>
  `;
}

function qsfRenderReview(wf) {
  const blId = wf.producedRecordIds.baselineIds[0];
  const bl = blId ? state.data.baselines.find(b => b.id === blId) : null;
  const cfgId = wf.producedRecordIds.analysisConfigIds[0];
  const cfg = cfgId ? state.data.analysisConfigs.find(c => c.id === cfgId) : null;
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
// QUESTIONNAIRE GLUE
// ═══════════════════════════════════════════════════════════════
// The questionnaire (topics, renders, captures, generate) is owned by
// `js/pages/v1/v1-questionnaires.js`. This file's job is to:
//   - own the step keys ('q-topics', 'q-assumptions', …) and their
//     order in the dynamic step sequence,
//   - call the appropriate qDef.renders[topic] from each step,
//   - call the appropriate qDef.captures[topic] on Continue,
//   - invoke qDef.generate() when the sequence reaches Review.

function qsfQDef() { return getV1QuestionnaireDefinition(QSF_QUESTIONNAIRE_ID); }

function qsfEnsureQDraft(wf) {
  wf.draftData.q = wf.draftData.q ?? {};
  return wf.draftData.q;
}

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

// Shared onContinue body for the per-topic question steps. Captures
// the topic answers (delegated to the questionnaire definition),
// advances through the sequence; generates records on entry to review.
function qsfAdvanceQ(wf, currentKey, topicKey) {
  const qDef = qsfQDef();
  const q = qsfEnsureQDraft(wf);
  const capture = topicKey ? qDef?.captures?.[topicKey] : null;
  if (capture) q[topicKey] = capture(q[topicKey]);
  const next = qsfNextQStep(wf, currentKey);
  if (next === 'review') qsfGenerateQuestionnaireRecords(wf);
  return { ok: true, nextStepKey: next };
}

// Render wrappers — pass through to the questionnaire definition.
function qsfRenderQTopics(wf)      { return qsfQDef().renders.topics     (wf.id, qsfEnsureQDraft(wf)); }
function qsfRenderQAssumptions(wf) { return qsfQDef().renders.assumptions(wf.id, qsfEnsureQDraft(wf)); }
function qsfRenderQIncome(wf)      { return qsfQDef().renders.income     (wf.id, qsfEnsureQDraft(wf)); }
function qsfRenderQSavings(wf)     { return qsfQDef().renders.savings    (wf.id, qsfEnsureQDraft(wf)); }
function qsfRenderQHousing(wf)     { return qsfQDef().renders.housing    (wf.id, qsfEnsureQDraft(wf)); }
function qsfRenderQRecurring(wf)   { return qsfQDef().renders.recurring  (wf.id, qsfEnsureQDraft(wf)); }
function qsfRenderQOnetime(wf)     { return qsfQDef().renders.onetime    (wf.id, qsfEnsureQDraft(wf)); }
function qsfRenderQDebts(wf)       { return qsfQDef().renders.debts      (wf.id, qsfEnsureQDraft(wf)); }

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
      const qDef = getV1QuestionnaireDefinition(QSF_QUESTIONNAIRE_ID);
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
      render: qsfRenderChoosePath,
      onContinue: (wf) => {
        const path = wf.draftData.path;
        if (path !== 'sample' && path !== 'scratch' && path !== 'questionnaire') {
          return { ok: false, errors: ['Pick an option to continue.'] };
        }
        if (path === 'sample') return { ok: true, nextStepKey: 'pick-sample' };
        if (path === 'questionnaire') return { ok: true, nextStepKey: 'q-topics' };
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
        qsfGenerateSampleRecords(wf);
        return { ok: true, nextStepKey: 'review' };
      },
      previousStepKey: 'choose-path',
    },
    // ── Questionnaire path steps ───────────────────────────────────
    'q-topics': {
      key: 'q-topics',
      title: 'Which topics do you want to answer?',
      render: qsfRenderQTopics,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-topics', null),
      previousStepKey: 'choose-path',
    },
    'q-assumptions': {
      key: 'q-assumptions',
      title: 'Default assumptions',
      render: qsfRenderQAssumptions,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-assumptions', 'assumptions'),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'q-assumptions'),
    },
    'q-income': {
      key: 'q-income',
      title: 'Income',
      render: qsfRenderQIncome,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-income', 'income'),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'q-income'),
    },
    'q-savings': {
      key: 'q-savings',
      title: 'Savings & investments',
      render: qsfRenderQSavings,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-savings', 'savings'),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'q-savings'),
    },
    'q-housing': {
      key: 'q-housing',
      title: 'Housing',
      render: qsfRenderQHousing,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-housing', 'housing'),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'q-housing'),
    },
    'q-recurring': {
      key: 'q-recurring',
      title: 'Recurring expenses',
      render: qsfRenderQRecurring,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-recurring', 'recurring'),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'q-recurring'),
    },
    'q-onetime': {
      key: 'q-onetime',
      title: 'Upcoming one-time events',
      render: qsfRenderQOnetime,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-onetime', 'onetime'),
      previousStepKey: (wf) => qsfPrevQStep(wf, 'q-onetime'),
    },
    'q-debts': {
      key: 'q-debts',
      title: 'Other debts',
      render: qsfRenderQDebts,
      onContinue: (wf) => qsfAdvanceQ(wf, 'q-debts', 'debts'),
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
