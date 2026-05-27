'use strict';

// ═══════════════════════════════════════════════════════════════
// BUILD OR EDIT A SCENARIO
// ═══════════════════════════════════════════════════════════════
//
// A foundational workflow that creates persistent "built scenarios"
// other workflows can load as a starting point. It does not produce
// a forecast or report. The output is a baseline + events + event set
// + a lightweight analysis config holding the assumptions
// (inflation rate, income tax rate, Monte Carlo on/off + simulations).
//
// Build mode  — choose-mode (Build) → choose-path (Scratch | Guided
//               questionnaire — sample option intentionally omitted)
//               → [questionnaire steps if chosen] → Review → Save
//               Scenario (workflow completes).
// Edit mode   — choose-mode (Edit) → pick-scenario (select from
//               existing built scenarios) → Review → Save Scenario.
//               Edits write through to the underlying records as the
//               user makes them; "Save Scenario" simply marks the
//               workflow run complete.
//
// The Review step is identical to the 20-year workflow's Review (name
// + assets + liabilities + events with legacy modal Edit/Delete), with
// the assumptions block from the 12-month workflow layered on top.
// The terminal CTA is labeled "Save Scenario" — pressing it sends the
// user back to the Get Started landing page.
//
// `bes` prefix on helpers — short for "Build or Edit a Scenario".

const BES_QUESTIONNAIRE_ID = 'household-v1';
const BES_WORKFLOW_ID      = 'build-edit-scenario';

// Default forecast period stored on the scenario's analysis config.
// The number is essentially arbitrary — built scenarios aren't run
// from this workflow; consumer workflows attach their own period
// when they clone. Keeping a 12-month default means the scenario is
// still meaningfully runnable from the legacy Analysis page.
const BES_DEFAULT_PERIOD_MONTHS = 12;

// ═══════════════════════════════════════════════════════════════
// PUBLIC HELPERS — used by consumer workflows
// ═══════════════════════════════════════════════════════════════

// Returns an array of `{ workflowId, configId, baselineId, eventSetId,
// name, baselineName, completedAt }` for every completed Build run of
// this workflow whose records still exist in state.data. Used by the
// consumer workflows (20-year, 12-month) to populate the "My Built
// Scenarios" section on their pick-sample step.
//
// Edit-mode workflow runs do not produce records, so they don't show
// up here — the underlying scenario was created by an earlier Build.
function listBuiltScenarios() {
  const out = [];
  for (const wf of state.data.workflows) {
    if (wf.type !== BES_WORKFLOW_ID) continue;
    if (!wf.completedAt) continue;
    const configId = wf.producedRecordIds?.analysisConfigIds?.[0];
    if (!configId) continue;
    const cfg = state.data.analysisConfigs.find(c => c.id === configId);
    if (!cfg) continue;
    const bl = state.data.baselines.find(b => b.id === cfg.baselineId);
    if (!bl) continue;
    const es = (cfg.eventSetIds ?? []).map(id => state.data.eventSets.find(s => s.id === id))[0];
    out.push({
      workflowId:   wf.id,
      configId,
      baselineId:   bl.id,
      eventSetId:   es?.id ?? null,
      name:         cfg.name,
      baselineName: bl.name,
      completedAt:  wf.completedAt,
    });
  }
  // Newest first.
  out.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  return out;
}

// Deep-clones the baseline + events + event set behind a built
// scenario's analysis config into fresh records (new uuids, new
// timestamps, unique names). Returns { baseline, events, eventSet,
// assumptions } where `assumptions` is the inflation/tax/MC settings
// the source scenario was designed with. Pure — the caller commits.
// Returns `null` if the source config or its records are missing.
function cloneBuiltScenarioFromConfig(sourceConfigId, ctx) {
  const sourceCfg = state.data.analysisConfigs.find(c => c.id === sourceConfigId);
  if (!sourceCfg) return null;
  const sourceBl  = state.data.baselines.find(b => b.id === sourceCfg.baselineId);
  if (!sourceBl)  return null;
  const sourceEs  = (sourceCfg.eventSetIds ?? []).map(id => state.data.eventSets.find(s => s.id === id))[0];
  if (!sourceEs)  return null;

  const prefix = ctx?.namePrefix ? `${ctx.namePrefix} ` : '';

  // Deep-clone the baseline with new ids on every nested record.
  const baseline = JSON.parse(JSON.stringify(sourceBl));
  baseline.id = uuid();
  baseline.assets       = (baseline.assets ?? []).map(a => ({ ...a, id: uuid() }));
  baseline.liabilities  = (baseline.liabilities ?? []).map(l => ({ ...l, id: uuid() }));
  baseline.name         = uniqueName(`${prefix}${sourceBl.name}`.trim(), ctx?.takenBaselineNames ?? []);
  baseline.createdAt    = new Date().toISOString();

  // Clone the events referenced by the source's event set, in order.
  const sourceEvents = (sourceEs.eventIds ?? [])
    .map(id => state.data.events.find(e => e.id === id))
    .filter(Boolean);
  const events = sourceEvents.map(e => ({ ...JSON.parse(JSON.stringify(e)), id: uuid() }));

  const eventSet = {
    id: uuid(),
    name: uniqueName(`${prefix}${sourceEs.name}`.trim(), ctx?.takenEventSetNames ?? []),
    description: sourceEs.description ?? '',
    eventIds: events.map(e => e.id),
  };

  return {
    baseline,
    events,
    eventSet,
    assumptions: {
      inflationRate: sourceCfg.inflationRate,
      taxRate:       sourceCfg.taxRate,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// SELECTION HELPERS
// ═══════════════════════════════════════════════════════════════

function besSelectMode(workflowId, mode) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  if (mode !== 'build' && mode !== 'edit') return;
  // Once records are generated (Build mode), the mode is locked.
  // Edit mode never produces records, so it's freely changeable
  // until Continue advances past choose-mode.
  const locked = (wf.producedRecordIds?.baselineIds?.length ?? 0) > 0;
  if (locked && wf.draftData.mode && wf.draftData.mode !== mode) {
    showToast('Mode is locked. Exit and discard the workflow to start over.', 'error');
    return;
  }
  wf.draftData.mode = mode;
  wf.updatedAt = new Date().toISOString();
  saveData();
  navigate('v1-workflow', { workflowId });
}

function besSelectScenarioToEdit(workflowId, configId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  if (!state.data.analysisConfigs.find(c => c.id === configId)) {
    showToast('Scenario not found', 'error');
    return;
  }
  wf.draftData.editingConfigId = configId;
  wf.updatedAt = new Date().toISOString();
  saveData();
  navigate('v1-workflow', { workflowId });
}

function besSelectPath(workflowId, path) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  if (path !== 'scratch' && path !== 'questionnaire') return;
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

function besRenameScenario(workflowId, newName) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  const cfg = besResolveCfg(wf);
  if (!cfg) return;
  const trimmed = (newName || '').trim();
  if (!trimmed) {
    const input = document.getElementById('bes-scenario-name');
    if (input) input.value = cfg.name;
    return;
  }
  cfg.name = trimmed;
  wf.updatedAt = new Date().toISOString();
  saveData();
}

// ═══════════════════════════════════════════════════════════════
// ASSUMPTIONS EDITS (Review step)
// ═══════════════════════════════════════════════════════════════
// Mirrors the 12-month workflow's pattern: each onchange writes
// through to the analysis config and saves.

function besSetInflation(workflowId, value) {
  const wf = getV1WorkflowInstance(workflowId);
  const cfg = wf && besResolveCfg(wf);
  if (!cfg) return;
  cfg.inflationRate = parseFloat(value) || 0;
  saveData();
}
function besSetTax(workflowId, value) {
  const wf = getV1WorkflowInstance(workflowId);
  const cfg = wf && besResolveCfg(wf);
  if (!cfg) return;
  cfg.taxRate = parseFloat(value) || 0;
  saveData();
}
function besSetMcEnabled(workflowId, enabled) {
  const wf = getV1WorkflowInstance(workflowId);
  const cfg = wf && besResolveCfg(wf);
  if (!cfg) return;
  cfg.monteCarlo = cfg.monteCarlo || { enabled: false, numSimulations: 200, standardOfLivingMonthly: 7000 };
  cfg.monteCarlo.enabled = !!enabled;
  saveData();
  const wrap = document.getElementById('bes-mc-sims-wrap');
  if (wrap) wrap.style.display = enabled ? '' : 'none';
}
function besSetMcSims(workflowId, value) {
  const wf = getV1WorkflowInstance(workflowId);
  const cfg = wf && besResolveCfg(wf);
  if (!cfg) return;
  cfg.monteCarlo = cfg.monteCarlo || { enabled: false, numSimulations: 200, standardOfLivingMonthly: 7000 };
  cfg.monteCarlo.numSimulations = Math.max(1, parseInt(value, 10) || 200);
  saveData();
}

// ═══════════════════════════════════════════════════════════════
// RECORD ACCESS — works in both Build and Edit modes
// ═══════════════════════════════════════════════════════════════

// Returns the analysis config the workflow is currently operating on:
//   - Build mode: the config recorded in producedRecordIds.
//   - Edit mode: the config the user selected on pick-scenario.
function besResolveCfg(wf) {
  if (wf.draftData?.mode === 'edit') {
    const id = wf.draftData?.editingConfigId;
    return id ? state.data.analysisConfigs.find(c => c.id === id) : null;
  }
  const id = wf.producedRecordIds?.analysisConfigIds?.[0];
  return id ? state.data.analysisConfigs.find(c => c.id === id) : null;
}

function besResolveScenarioRecords(wf) {
  const cfg = besResolveCfg(wf);
  if (!cfg) return null;
  const bl = state.data.baselines.find(b => b.id === cfg.baselineId);
  if (!bl) return null;
  const es = (cfg.eventSetIds ?? []).map(id => state.data.eventSets.find(s => s.id === id))[0];
  // Resolve the events referenced by the event set (preserving order).
  const events = (es?.eventIds ?? [])
    .map(id => state.data.events.find(e => e.id === id))
    .filter(Boolean);
  return { cfg, baseline: bl, eventSet: es, events };
}

// ═══════════════════════════════════════════════════════════════
// RECORD GENERATION (Build mode only)
// ═══════════════════════════════════════════════════════════════

function besCommitRecords(wf, { baseline, events, eventSet, configName, assumptions }) {
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
    endDate: addMonths(start, BES_DEFAULT_PERIOD_MONTHS),
    viewMode: 'monthly',
    inflationRate: assumptions?.inflationRate ?? (state.data.settings?.defaultInflationRate ?? 3),
    taxRate:       assumptions?.taxRate       ?? (state.data.settings?.defaultTaxRate ?? 30),
    monteCarlo: { enabled: false, numSimulations: 200, standardOfLivingMonthly: 7000 },
    eventOverrides: [],
    resultsStale: false,
  };
  state.data.analysisConfigs.push(cfg);
  wf.producedRecordIds.analysisConfigIds.push(cfg.id);

  wf.updatedAt = new Date().toISOString();
  saveData();
}

function besGenerateScratchRecords(wf) {
  if (wf.producedRecordIds.baselineIds.length > 0) return;
  const start = today();
  const baseline = {
    id: uuid(),
    name: uniqueName('Custom Scenario', state.data.baselines.map(b => b.name)),
    description: 'Built via the Build or Edit a Scenario workflow (start from scratch).',
    date: start,
    createdAt: new Date().toISOString(),
    assets: [],
    liabilities: [],
  };
  const eventSet = {
    id: uuid(),
    name: uniqueName('Custom Scenario Events', state.data.eventSets.map(s => s.name)),
    description: 'Events for a custom scenario built from scratch.',
    eventIds: [],
  };
  besCommitRecords(wf, { baseline, events: [], eventSet, configName: 'Custom Scenario' });
}

function besGenerateQuestionnaireRecords(wf) {
  if (wf.producedRecordIds.baselineIds.length > 0) return;
  const qDef = getV1QuestionnaireDefinition(BES_QUESTIONNAIRE_ID);
  if (!qDef) { showToast('Questionnaire missing', 'error'); return; }

  const answers = wf.draftData.q ?? {};
  const assum = answers.assumptions ?? qDef.defaults.assumptions();

  const { baseline, events, eventSet } = qDef.generate(answers, {
    startDate: today(),
    takenBaselineNames: state.data.baselines.map(b => b.name),
    takenEventSetNames: state.data.eventSets.map(s => s.name),
    baselineDescription: 'Built via the Build or Edit a Scenario workflow (guided questionnaire).',
    eventSetDescription: 'Events from a custom scenario built via the guided questionnaire.',
  });

  besCommitRecords(wf, {
    baseline, events, eventSet,
    configName: 'Custom Scenario',
    assumptions: { inflationRate: assum.inflationRate, taxRate: assum.taxRate },
  });
}

// ═══════════════════════════════════════════════════════════════
// STEP RENDERERS
// ═══════════════════════════════════════════════════════════════

function besRenderChooseMode(wf) {
  const sel = wf.draftData.mode;
  const locked = (wf.producedRecordIds?.baselineIds?.length ?? 0) > 0;
  const scenarios = listBuiltScenarios();
  const hasScenarios = scenarios.length > 0;

  const cardClass = (key, { disabled = false } = {}) => {
    if (disabled) return 'v1-option-card disabled';
    if (sel === key) return 'v1-option-card selected';
    if (locked) return 'v1-option-card disabled';
    return 'v1-option-card';
  };
  const clickAttr = (key, { disabled = false } = {}) => {
    if (disabled) return '';
    if (locked && sel !== key) return '';
    return `onclick="besSelectMode('${esc(wf.id)}','${key}')"`;
  };

  return `
    <p>Pick how you'd like to use this workflow.</p>
    <div class="alert alert-info" style="margin: 14px 0 18px 0; font-size: 13px;">
      <strong>How it works:</strong> built scenarios are saved as reusable starting points. Other workflows (20-year basic outlook, 12-month plan) will show your built scenarios under <em>My Built Scenarios</em> on their starting-scenario step.
    </div>
    <div class="v1-card-grid">
      <div class="${cardClass('build')}" ${clickAttr('build')}>
        <div class="v1-option-icon">🛠️</div>
        <div class="v1-option-body">
          <div class="v1-option-title">Build a new scenario</div>
          <div class="v1-option-desc">Start from scratch or answer a guided questionnaire. You'll review every record and tweak the assumptions before saving.</div>
        </div>
        <div class="v1-option-check">${sel === 'build' ? '✓' : ''}</div>
      </div>
      <div class="${cardClass('edit', { disabled: !hasScenarios })}" ${clickAttr('edit', { disabled: !hasScenarios })}>
        <div class="v1-option-icon">✏️</div>
        <div class="v1-option-body">
          <div class="v1-option-title">Edit an existing scenario</div>
          <div class="v1-option-desc">${hasScenarios
              ? `Pick one of your ${scenarios.length} saved scenario${scenarios.length === 1 ? '' : 's'} to tweak any record or assumption. Edits save immediately.`
              : "You don't have any built scenarios yet. Build one first to enable this option."}</div>
        </div>
        <div class="v1-option-check">${sel === 'edit' ? '✓' : ''}</div>
      </div>
    </div>
  `;
}

function besRenderPickScenario(wf) {
  const scenarios = listBuiltScenarios();
  const sel = wf.draftData.editingConfigId;

  if (!scenarios.length) {
    return `<p style="color:var(--muted)">No built scenarios available. Go back and pick <strong>Build a new scenario</strong>.</p>`;
  }

  return `
    <p>Pick a scenario to edit. Changes save immediately, so you can come back and tweak it again any time.</p>
    <div class="v1-card-grid" style="margin-top:18px">
      ${scenarios.map(s => `
        <div class="v1-option-card${sel === s.configId ? ' selected' : ''}" onclick="besSelectScenarioToEdit('${esc(wf.id)}','${esc(s.configId)}')">
          <div class="v1-option-icon">🗂️</div>
          <div class="v1-option-body">
            <div class="v1-option-title">${esc(s.name)}</div>
            <div class="v1-option-desc">Baseline: ${esc(s.baselineName)} · saved ${esc(new Date(s.completedAt).toLocaleDateString())}</div>
          </div>
          <div class="v1-option-check">${sel === s.configId ? '✓' : ''}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function besRenderChoosePath(wf) {
  const sel = wf.draftData.path;
  const locked = (wf.producedRecordIds?.baselineIds?.length ?? 0) > 0;

  const cardClass = (key) => {
    if (sel === key) return 'v1-option-card selected';
    if (locked) return 'v1-option-card disabled';
    return 'v1-option-card';
  };
  const clickAttr = (key) => {
    if (locked && sel !== key) return '';
    return `onclick="besSelectPath('${esc(wf.id)}','${key}')"`;
  };

  return `
    <p>Pick how you'd like to build your scenario.</p>
    <div class="alert alert-info" style="margin: 14px 0 18px 0; font-size: 13px;">
      <strong>Heads up:</strong> after you Continue, this choice is locked. If you want to try a different path later, Exit, then Discard the workflow from Get Started and start fresh.
    </div>
    <div class="v1-card-grid">
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
          <div class="v1-option-desc">Answer a series of short questions about your income, savings, housing, and expenses — we'll build your scenario from your answers.</div>
        </div>
        <div class="v1-option-check">${sel === 'questionnaire' ? '✓' : ''}</div>
      </div>
    </div>
  `;
}

function besRenderAssumptionsBlock(wf, cfg) {
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
                 onchange="besSetInflation('${esc(wf.id)}', this.value)">
          <div class="form-hint">Grows inflation-adjusted event amounts each month.</div>
        </div>
        <div class="form-group">
          <label>Income tax rate <span class="label-note">(%)</span></label>
          <input type="number" value="${Number(cfg.taxRate) || 0}" min="0" step="0.5"
                 onchange="besSetTax('${esc(wf.id)}', this.value)">
          <div class="form-hint">Applied to income events. Set to 0% if amounts are already after-tax.</div>
        </div>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" ${mcOn ? 'checked' : ''}
                 onchange="besSetMcEnabled('${esc(wf.id)}', this.checked)">
          Run Monte Carlo simulation
        </label>
        <div class="form-hint">When a consuming workflow uses this scenario, Monte Carlo is inherited by default. Each workflow's Review step lets the user override.</div>
      </div>
      <div class="form-group" id="bes-mc-sims-wrap" style="${mcOn ? '' : 'display:none'}">
        <label>Number of simulations</label>
        <input type="number" value="${sims}" min="50" step="50"
               onchange="besSetMcSims('${esc(wf.id)}', this.value)">
      </div>
    </div>
  `;
}

function besRenderReview(wf) {
  const records = besResolveScenarioRecords(wf);
  if (!records) return `<p style="color:var(--danger)">Could not load this scenario. Go back and re-select.</p>`;
  const { cfg, baseline: bl, events } = records;
  const assets = bl.assets ?? [];
  const liabs  = bl.liabilities ?? [];

  const isEdit = wf.draftData?.mode === 'edit';

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
    <p>${isEdit
        ? 'Tweak any record or assumption. Changes save immediately.'
        : "Review and customise the records this workflow generated. Edit anything that doesn't fit. Changes save immediately."}</p>

    <div class="form-group" style="margin-bottom: 24px;">
      <label for="bes-scenario-name">Scenario name</label>
      <input type="text" id="bes-scenario-name" value="${esc(cfg.name)}"
             onchange="besRenameScenario('${esc(wf.id)}', this.value)" />
      <div class="form-hint">Labels this scenario in your Analysis list and is the name other workflows will show under <em>My Built Scenarios</em>.</div>
    </div>

    ${besRenderAssumptionsBlock(wf, cfg)}

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

// ═══════════════════════════════════════════════════════════════
// QUESTIONNAIRE GLUE
// ═══════════════════════════════════════════════════════════════

function besQDef() { return getV1QuestionnaireDefinition(BES_QUESTIONNAIRE_ID); }

function besEnsureQDraft(wf) {
  wf.draftData.q = wf.draftData.q ?? {};
  return wf.draftData.q;
}

function besNextQStep(wf, currentKey) {
  const def = getV1WorkflowDefinition(BES_WORKFLOW_ID);
  const seq = def.getStepSequence(wf);
  const idx = seq.indexOf(currentKey);
  return (idx >= 0 && idx < seq.length - 1) ? seq[idx + 1] : 'review';
}
function besPrevQStep(wf, currentKey) {
  const def = getV1WorkflowDefinition(BES_WORKFLOW_ID);
  const seq = def.getStepSequence(wf);
  const idx = seq.indexOf(currentKey);
  return (idx > 0) ? seq[idx - 1] : null;
}

function besAdvanceQ(wf, currentKey, topicKey) {
  const qDef = besQDef();
  const q = besEnsureQDraft(wf);
  const capture = topicKey ? qDef?.captures?.[topicKey] : null;
  if (capture) q[topicKey] = capture(q[topicKey]);
  const next = besNextQStep(wf, currentKey);
  if (next === 'review') besGenerateQuestionnaireRecords(wf);
  return { ok: true, nextStepKey: next };
}

function besRenderQTopics(wf)      { return besQDef().renders.topics     (wf.id, besEnsureQDraft(wf)); }
function besRenderQAssumptions(wf) { return besQDef().renders.assumptions(wf.id, besEnsureQDraft(wf)); }
function besRenderQIncome(wf)      { return besQDef().renders.income     (wf.id, besEnsureQDraft(wf)); }
function besRenderQSavings(wf)     { return besQDef().renders.savings    (wf.id, besEnsureQDraft(wf)); }
function besRenderQHousing(wf)     { return besQDef().renders.housing    (wf.id, besEnsureQDraft(wf)); }
function besRenderQRecurring(wf)   { return besQDef().renders.recurring  (wf.id, besEnsureQDraft(wf)); }
function besRenderQOnetime(wf)     { return besQDef().renders.onetime    (wf.id, besEnsureQDraft(wf)); }
function besRenderQDebts(wf)       { return besQDef().renders.debts      (wf.id, besEnsureQDraft(wf)); }

// ═══════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════

registerV1Workflow({
  id: BES_WORKFLOW_ID,
  title: 'Build or edit a scenario',
  description: 'Design a reusable scenario that other workflows can load. Build a new one from scratch or via the guided questionnaire, or edit one you saved earlier.',
  icon: '🗂️',
  estimatedTime: '5 min',
  category: 'main',
  eligible: () => true,
  initialStepKey: 'choose-mode',
  initialDraft: () => ({ mode: null, path: null, editingConfigId: null }),
  // Branching:
  //   build/scratch       → choose-mode → choose-path → review
  //   build/questionnaire → choose-mode → choose-path → q-topics → [N topic Qs] → review
  //   edit                → choose-mode → pick-scenario → review
  // Before mode is selected, default to the build/scratch sequence
  // as a reasonable upper bound for the topbar "Step N of M" count.
  getStepSequence: (wf) => {
    if (wf.draftData?.mode === 'edit') {
      return ['choose-mode', 'pick-scenario', 'review'];
    }
    // build path
    if (wf.draftData?.path === 'questionnaire') {
      const qDef = getV1QuestionnaireDefinition(BES_QUESTIONNAIRE_ID);
      const allTopics = qDef?.topics ?? [];
      const selected = wf.draftData.q?.topics ?? allTopics.map(t => t.key);
      const topicSteps = allTopics
        .filter(t => selected.includes(t.key))
        .map(t => `q-${t.key}`);
      return ['choose-mode', 'choose-path', 'q-topics', ...topicSteps, 'review'];
    }
    return ['choose-mode', 'choose-path', 'review'];
  },
  steps: {
    'choose-mode': {
      key: 'choose-mode',
      title: 'Build or edit?',
      render: besRenderChooseMode,
      onContinue: (wf) => {
        const mode = wf.draftData.mode;
        if (mode !== 'build' && mode !== 'edit') {
          return { ok: false, errors: ['Pick an option to continue.'] };
        }
        if (mode === 'edit') return { ok: true, nextStepKey: 'pick-scenario' };
        return { ok: true, nextStepKey: 'choose-path' };
      },
      previousStepKey: null,
    },
    'pick-scenario': {
      key: 'pick-scenario',
      title: 'Pick a scenario to edit',
      render: besRenderPickScenario,
      onContinue: (wf) => {
        if (!wf.draftData.editingConfigId) {
          return { ok: false, errors: ['Pick a scenario to continue.'] };
        }
        return { ok: true, nextStepKey: 'review' };
      },
      previousStepKey: 'choose-mode',
    },
    'choose-path': {
      key: 'choose-path',
      title: 'How would you like to start?',
      render: besRenderChoosePath,
      onContinue: (wf) => {
        const path = wf.draftData.path;
        if (path !== 'scratch' && path !== 'questionnaire') {
          return { ok: false, errors: ['Pick an option to continue.'] };
        }
        if (path === 'questionnaire') return { ok: true, nextStepKey: 'q-topics' };
        besGenerateScratchRecords(wf);
        return { ok: true, nextStepKey: 'review' };
      },
      previousStepKey: 'choose-mode',
    },
    // ── Questionnaire path steps ───────────────────────────────────
    'q-topics': {
      key: 'q-topics',
      title: 'Which topics do you want to answer?',
      render: besRenderQTopics,
      onContinue: (wf) => besAdvanceQ(wf, 'q-topics', null),
      previousStepKey: 'choose-path',
    },
    'q-assumptions': {
      key: 'q-assumptions',
      title: 'Default assumptions',
      render: besRenderQAssumptions,
      onContinue: (wf) => besAdvanceQ(wf, 'q-assumptions', 'assumptions'),
      previousStepKey: (wf) => besPrevQStep(wf, 'q-assumptions'),
    },
    'q-income': {
      key: 'q-income',
      title: 'Income',
      render: besRenderQIncome,
      onContinue: (wf) => besAdvanceQ(wf, 'q-income', 'income'),
      previousStepKey: (wf) => besPrevQStep(wf, 'q-income'),
    },
    'q-savings': {
      key: 'q-savings',
      title: 'Savings & investments',
      render: besRenderQSavings,
      onContinue: (wf) => besAdvanceQ(wf, 'q-savings', 'savings'),
      previousStepKey: (wf) => besPrevQStep(wf, 'q-savings'),
    },
    'q-housing': {
      key: 'q-housing',
      title: 'Housing',
      render: besRenderQHousing,
      onContinue: (wf) => besAdvanceQ(wf, 'q-housing', 'housing'),
      previousStepKey: (wf) => besPrevQStep(wf, 'q-housing'),
    },
    'q-recurring': {
      key: 'q-recurring',
      title: 'Recurring expenses',
      render: besRenderQRecurring,
      onContinue: (wf) => besAdvanceQ(wf, 'q-recurring', 'recurring'),
      previousStepKey: (wf) => besPrevQStep(wf, 'q-recurring'),
    },
    'q-onetime': {
      key: 'q-onetime',
      title: 'Upcoming one-time events',
      render: besRenderQOnetime,
      onContinue: (wf) => besAdvanceQ(wf, 'q-onetime', 'onetime'),
      previousStepKey: (wf) => besPrevQStep(wf, 'q-onetime'),
    },
    'q-debts': {
      key: 'q-debts',
      title: 'Other debts',
      render: besRenderQDebts,
      onContinue: (wf) => besAdvanceQ(wf, 'q-debts', 'debts'),
      previousStepKey: (wf) => besPrevQStep(wf, 'q-debts'),
    },
    'review': {
      key: 'review',
      title: 'Review your scenario',
      render: besRenderReview,
      // Save Scenario → mark workflow complete and return to the
      // Get Started landing page. The completed workflow shows up in
      // History and the records persist (so other workflows can load
      // them via "My Built Scenarios").
      onContinue: () => ({ ok: true, nextStepKey: 'complete' }),
      previousStepKey: (wf) => besPrevQStep(wf, 'review'),
      continueLabel: 'Save Scenario',
    },
  },
});
