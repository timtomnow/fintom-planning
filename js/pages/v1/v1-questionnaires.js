'use strict';

// ═══════════════════════════════════════════════════════════════
// v1 QUESTIONNAIRE REGISTRY
// ═══════════════════════════════════════════════════════════════
//
// Shared library of guided questionnaires that workflows can consume.
// Each questionnaire defines a list of topics, per-topic render and
// capture functions, and a record generator that converts captured
// answers into a baseline + events + event set. Workflows reference
// a questionnaire by id (e.g. 'household-v1') and layer their own
// analysis config on top.
//
// Versioning model:
//   - A questionnaire's id is its identity (e.g. 'household-v1').
//   - When the shape changes meaningfully, register a new id
//     ('household-v2') rather than mutating the existing one. Older
//     workflow runs and other workflows can keep pointing at v1.
//   - In the future an admin UI can swap a workflow's default
//     questionnaire id, which only changes future runs.
//
// Questionnaire definition shape:
//   {
//     id:      string,
//     version: number,    // human-readable version, e.g. 1
//     label:   string,
//     topics:  [{ key, label, desc }],
//     // For each topic key, defaults() returns the seed draft state
//     // and capture() reads the current DOM and returns the answer.
//     defaults: {  [topicKey]: () => answer },
//     captures: {  [topicKey]: (prev) => answer },
//     renders:  {  [topicKey]: (wfId, draft) => htmlString },
//     // generate(answers, ctx) -> { baseline, events, eventSet }
//     //   Pure: builds the records but does NOT persist them. The
//     //   caller (workflow) pushes into state.data and wires up the
//     //   analysis config it wants.
//     // ctx = { startDate, takenBaselineNames, takenEventSetNames,
//     //         namePrefix, baselineDescription, eventSetDescription }
//     generate: (answers, ctx) => ({ baseline, events, eventSet }),
//   }

const V1_QUESTIONNAIRES = {};

function registerV1Questionnaire(def) {
  V1_QUESTIONNAIRES[def.id] = def;
}

function getV1QuestionnaireDefinition(id) {
  return V1_QUESTIONNAIRES[id] || null;
}

// ═══════════════════════════════════════════════════════════════
// QUESTIONNAIRE: household-v1
// ═══════════════════════════════════════════════════════════════
// First-cut household questionnaire. Mirrors the original quickstart
// questionnaire so the existing workflow can switch over without any
// visible change. The 12-month-plan workflow reuses the same one.

const HOUSEHOLD_V1_TOPICS = [
  { key: 'assumptions', label: 'Assumptions',              desc: 'Default rates: inflation, income tax, asset growth, investment return & volatility.' },
  { key: 'savings',     label: 'Savings & investments',    desc: 'Cash, emergency fund, investment accounts, retirement accounts.' },
  { key: 'housing',     label: 'Housing',                  desc: 'Rent or own — and related monthly expenses.' },
  { key: 'debts',       label: 'Other debts',              desc: 'Auto loans, student loans, lines of credit (not the mortgage).' },
  { key: 'income',      label: 'Income',                   desc: 'Salary, partner\'s salary, side income — including any future changes.' },
  { key: 'recurring',   label: 'Other recurring expenses', desc: 'Groceries, transportation, healthcare, entertainment, etc.' },
  { key: 'onetime',     label: 'Upcoming one-time events', desc: 'Planned purchases, bonuses, gifts, or other one-off cash flows.' },
];

const HOUSEHOLD_V1_RECURRING_ITEMS = [
  { key: 'groceries',      label: 'Groceries & food',           defaultAmount: 800, category: 'Food & Dining' },
  { key: 'transportation', label: 'Transportation / auto',      defaultAmount: 400, category: 'Transportation' },
  { key: 'healthcare',     label: 'Healthcare',                 defaultAmount: 150, category: 'Healthcare' },
  { key: 'entertainment',  label: 'Entertainment & dining out', defaultAmount: 250, category: 'Entertainment' },
  { key: 'insurance',      label: 'Insurance (non-housing)',    defaultAmount: 100, category: 'Insurance' },
  { key: 'childcare',      label: 'Childcare',                  defaultAmount:   0, category: 'Childcare' },
];

// ── Defaults ───────────────────────────────────────────────────────

function hhv1DefaultAssumptions() {
  return {
    inflationRate:    state.data.settings?.defaultInflationRate ?? 3,
    taxRate:          state.data.settings?.defaultTaxRate ?? 30,
    assetGrowthRate:  4.0,
    investmentReturn: 7.5,
    investmentStdDev: 13.0,
  };
}
function hhv1DefaultSavings() {
  return { chequing: 0, emergency: 0, investments: 0, retirement: 0 };
}
function hhv1DefaultHousing() {
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
      // Mortgage mirrors the Liability "amortising loan" feature 1:1.
      mortgage: {
        balance: 0,
        rate: 5.0,
        includeInLiquidNW: false,
        paymentMode: 'calculated',   // 'calculated' | 'set'
        paymentFrequency: 'monthly', // 'monthly' | 'semi-monthly' | 'bi-weekly'
        amortizationEndDate: '',     // 'YYYY-MM' — required for calculated mode
        termStartDate: '',           // 'YYYY-MM' — optional, fixes amortization period
        termEndDate: '',             // 'YYYY-MM' — optional, current term expiry
        renewalRate: 0,              // % annual rate after term end
        monthlyPayment: 0,           // used when paymentMode = 'set'
      },
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
// Reads a normalized mortgage object out of an `own` answer, tolerating
// the legacy flat shape (mortgageBalance / mortgageRate / mortgageYear)
// from drafts started before the mortgage fields matched the Liability feature.
function hhv1NormalizeOwnMortgage(own) {
  const o = own || {};
  const m = o.mortgage || {};
  return {
    balance:             Number(m.balance ?? o.mortgageBalance) || 0,
    rate:                Number(m.rate ?? o.mortgageRate ?? 5) || 0,
    includeInLiquidNW:   m.includeInLiquidNW ?? false,
    paymentMode:         m.paymentMode || 'calculated',
    paymentFrequency:    m.paymentFrequency || 'monthly',
    // Default the payoff month to 25 years (300 months) out from today,
    // matching a typical fresh mortgage amortization.
    amortizationEndDate: m.amortizationEndDate || o.mortgageYear || addMonths(today(), 300),
    termStartDate:       m.termStartDate || '',
    termEndDate:         m.termEndDate || '',
    renewalRate:         Number(m.renewalRate) || 0,
    monthlyPayment:      Number(m.monthlyPayment) || 0,
  };
}
function hhv1DefaultRecurring() {
  const out = {};
  for (const it of HOUSEHOLD_V1_RECURRING_ITEMS) out[it.key] = { included: false, amount: it.defaultAmount };
  return out;
}

// ── Captures (read DOM) ────────────────────────────────────────────

function hhv1CaptureAssumptions() {
  return {
    inflationRate:    parseFloat(document.getElementById('qassum-inflation')?.value)   || 0,
    taxRate:          parseFloat(document.getElementById('qassum-tax')?.value)         || 0,
    assetGrowthRate:  parseFloat(document.getElementById('qassum-asset-rate')?.value)  || 0,
    investmentReturn: parseFloat(document.getElementById('qassum-inv-return')?.value)  || 0,
    investmentStdDev: parseFloat(document.getElementById('qassum-inv-stddev')?.value)  || 0,
  };
}
function hhv1CaptureSavings() {
  return {
    chequing:    parseFloat(document.getElementById('qsav-chequing')?.value)    || 0,
    emergency:   parseFloat(document.getElementById('qsav-emergency')?.value)   || 0,
    investments: parseFloat(document.getElementById('qsav-investments')?.value) || 0,
    retirement:  parseFloat(document.getElementById('qsav-retirement')?.value)  || 0,
  };
}
function hhv1CaptureIncomeRows() {
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
function hhv1CaptureOnetimeRows() {
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
function hhv1CaptureDebtRows() {
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
function hhv1CaptureHousing(prev) {
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
    out.own.value = parseFloat(document.getElementById('qhousing-own-value')?.value) || 0;
    out.own.mortgage = out.own.mortgage || {};
    const m = out.own.mortgage;
    m.balance             = parseFloat(document.getElementById('qhousing-own-mtg-balance')?.value) || 0;
    m.rate                = parseFloat(document.getElementById('qhousing-own-mtg-rate')?.value) || 0;
    m.includeInLiquidNW   = !!document.getElementById('qhousing-own-mtg-liquid-nw')?.checked;
    m.paymentMode         = document.querySelector('input[name=qhousing-own-paymode]:checked')?.value || 'calculated';
    m.paymentFrequency    = document.getElementById('qhousing-own-mtg-freq')?.value || 'monthly';
    m.amortizationEndDate = document.getElementById('qhousing-own-mtg-amort-end')?.value || '';
    m.termStartDate       = document.getElementById('qhousing-own-mtg-term-start')?.value || '';
    m.termEndDate         = document.getElementById('qhousing-own-mtg-term-end')?.value || '';
    m.renewalRate         = parseFloat(document.getElementById('qhousing-own-mtg-renewal-rate')?.value) || 0;
    m.monthlyPayment      = parseFloat(document.getElementById('qhousing-own-mtg-pay')?.value) || 0;
    // Drop the legacy flat keys so they don't shadow the new shape on later reads.
    delete out.own.mortgageBalance;
    delete out.own.mortgageRate;
    delete out.own.mortgageYear;
    for (const k of Object.keys(out.own.addons)) {
      out.own.addons[k] = {
        included: !!document.getElementById(`qhousing-own-ck-${k}`)?.checked,
        amount:   parseFloat(document.getElementById(`qhousing-own-amt-${k}`)?.value) || 0,
      };
    }
  }
  return out;
}
function hhv1CaptureRecurring(prev) {
  const out = JSON.parse(JSON.stringify(prev));
  for (const it of HOUSEHOLD_V1_RECURRING_ITEMS) {
    out[it.key] = {
      included: !!document.getElementById(`qrec-ck-${it.key}`)?.checked,
      amount:   parseFloat(document.getElementById(`qrec-amt-${it.key}`)?.value) || 0,
    };
  }
  return out;
}

// ── Row add/remove handlers (used by inline onclicks rendered below)

function hhv1AddIncomeRow(workflowId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  wf.draftData.q = wf.draftData.q ?? {};
  wf.draftData.q.income = wf.draftData.q.income || { streams: [] };
  wf.draftData.q.income.streams = hhv1CaptureIncomeRows();
  wf.draftData.q.income.streams.push({ name: '', amount: 0, startDate: '', endDate: '' });
  saveData();
  navigate('v1-workflow', { workflowId });
}
function hhv1RemoveIncomeRow(workflowId, idx) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  wf.draftData.q = wf.draftData.q ?? {};
  wf.draftData.q.income = wf.draftData.q.income || { streams: [] };
  wf.draftData.q.income.streams = hhv1CaptureIncomeRows();
  wf.draftData.q.income.streams.splice(idx, 1);
  saveData();
  navigate('v1-workflow', { workflowId });
}
function hhv1AddOnetimeRow(workflowId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  wf.draftData.q = wf.draftData.q ?? {};
  wf.draftData.q.onetime = wf.draftData.q.onetime || { events: [] };
  wf.draftData.q.onetime.events = hhv1CaptureOnetimeRows();
  wf.draftData.q.onetime.events.push({ name: '', date: today(), amount: 0, type: 'one_time_outflow' });
  saveData();
  navigate('v1-workflow', { workflowId });
}
function hhv1RemoveOnetimeRow(workflowId, idx) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  wf.draftData.q = wf.draftData.q ?? {};
  wf.draftData.q.onetime = wf.draftData.q.onetime || { events: [] };
  wf.draftData.q.onetime.events = hhv1CaptureOnetimeRows();
  wf.draftData.q.onetime.events.splice(idx, 1);
  saveData();
  navigate('v1-workflow', { workflowId });
}
function hhv1AddDebtRow(workflowId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  wf.draftData.q = wf.draftData.q ?? {};
  wf.draftData.q.debts = wf.draftData.q.debts || { items: [] };
  wf.draftData.q.debts.items = hhv1CaptureDebtRows();
  wf.draftData.q.debts.items.push({ name: '', balance: 0, rate: 6, payoffYear: '' });
  saveData();
  navigate('v1-workflow', { workflowId });
}
function hhv1RemoveDebtRow(workflowId, idx) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  wf.draftData.q = wf.draftData.q ?? {};
  wf.draftData.q.debts = wf.draftData.q.debts || { items: [] };
  wf.draftData.q.debts.items = hhv1CaptureDebtRows();
  wf.draftData.q.debts.items.splice(idx, 1);
  saveData();
  navigate('v1-workflow', { workflowId });
}
function hhv1ChangeHousingMode(workflowId, mode) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  wf.draftData.q = wf.draftData.q ?? {};
  wf.draftData.q.housing = hhv1CaptureHousing(wf.draftData.q.housing || hhv1DefaultHousing());
  wf.draftData.q.housing.mode = mode;
  saveData();
  navigate('v1-workflow', { workflowId });
}
// Pure DOM show/hide for the mortgage payment-mode fields — no rerender,
// so typed values are preserved. Mirrors onPayModeChange() in baselines.js.
function hhv1ToggleOwnPayMode() {
  const mode = document.querySelector('input[name=qhousing-own-paymode]:checked')?.value || 'calculated';
  const calc = document.getElementById('qhousing-own-pay-calculated');
  const set  = document.getElementById('qhousing-own-pay-set');
  if (calc) calc.style.display = mode === 'calculated' ? '' : 'none';
  if (set)  set.style.display  = mode === 'set' ? '' : 'none';
}
function hhv1ToggleTopic(workflowId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  wf.draftData.q = wf.draftData.q ?? {};
  const checked = HOUSEHOLD_V1_TOPICS
    .map(t => t.key)
    .filter(k => document.getElementById(`qtopic-${k}`)?.checked);
  wf.draftData.q.topics = checked;
  wf.updatedAt = new Date().toISOString();
  saveData();
}

// ── Renders ────────────────────────────────────────────────────────

function hhv1RenderTopics(wfId, q) {
  const checked = new Set(q.topics ?? HOUSEHOLD_V1_TOPICS.map(t => t.key));
  return `
    <p>Pick the topics you want to cover. We'll only ask you about the ones you check. You can leave any field blank within a question to skip it.</p>
    <div class="qsf-topic-list">
      ${HOUSEHOLD_V1_TOPICS.map(t => `
        <label class="qsf-topic-row">
          <input type="checkbox" id="qtopic-${esc(t.key)}" ${checked.has(t.key) ? 'checked' : ''}
                 onchange="hhv1ToggleTopic('${esc(wfId)}')">
          <span class="qsf-topic-body">
            <span class="qsf-topic-label">${esc(t.label)}</span>
            <span class="qsf-topic-desc">${esc(t.desc)}</span>
          </span>
        </label>
      `).join('')}
    </div>
  `;
}

function hhv1RenderAssumptions(wfId, q) {
  q.assumptions = q.assumptions || hhv1DefaultAssumptions();
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

function hhv1RenderIncome(wfId, q) {
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
                  onclick="hhv1RemoveIncomeRow('${esc(wfId)}',${i})">Remove</button>
        </div>
      `).join('')}
    </div>
    <button type="button" class="btn btn-sm btn-secondary" onclick="hhv1AddIncomeRow('${esc(wfId)}')">+ Add another income stream</button>
  `;
}

function hhv1RenderSavings(wfId, q) {
  q.savings = q.savings || hhv1DefaultSavings();
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

function hhv1RenderHousing(wfId, q) {
  q.housing = q.housing || hhv1DefaultHousing();
  const h = q.housing;
  const mode = h.mode || '';
  const m = hhv1NormalizeOwnMortgage(h.own);

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
          <input type="number" id="qhousing-own-mtg-balance" value="${m.balance}" min="0" step="10000">
        </div>
      </div>
      <div class="qsf-section-heading">Mortgage details</div>
      <p class="qsf-hint">These match the full Amortising Loan settings. The payment is auto-deducted from your cash (or chequing account) each month — don't also add a mortgage payment as a recurring expense.</p>
      <div class="form-row">
        <div class="form-group">
          <label>Annual interest rate %</label>
          <input type="number" id="qhousing-own-mtg-rate" value="${m.rate}" min="0" step="0.01">
        </div>
        <div class="form-group" style="display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:8px;">
          <label class="checkbox-label">
            <input type="checkbox" id="qhousing-own-mtg-liquid-nw" ${m.includeInLiquidNW ? 'checked' : ''}>
            Include in Liquid Net Worth
          </label>
          <div class="form-hint">Usually unchecked — your home isn't a liquid asset you'd sell to settle the debt.</div>
        </div>
      </div>
      <div class="form-group">
        <label>Payment mode</label>
        <div style="display:flex;gap:24px;margin-top:4px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer;">
            <input type="radio" name="qhousing-own-paymode" value="calculated" onchange="hhv1ToggleOwnPayMode()"
              ${m.paymentMode === 'calculated' ? 'checked' : ''}>
            Calculated (auto from amortization)
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer;">
            <input type="radio" name="qhousing-own-paymode" value="set" onchange="hhv1ToggleOwnPayMode()"
              ${m.paymentMode === 'set' ? 'checked' : ''}>
            Set payment (fixed amount)
          </label>
        </div>
      </div>
      <div id="qhousing-own-pay-calculated" ${m.paymentMode !== 'calculated' ? 'style="display:none"' : ''}>
        <div class="form-row">
          <div class="form-group">
            <label>Payment frequency</label>
            <select id="qhousing-own-mtg-freq">
              <option value="monthly"${m.paymentFrequency === 'monthly' ? ' selected' : ''}>Monthly</option>
              <option value="semi-monthly"${m.paymentFrequency === 'semi-monthly' ? ' selected' : ''}>Semi-Monthly (2×/month)</option>
              <option value="bi-weekly"${m.paymentFrequency === 'bi-weekly' ? ' selected' : ''}>Bi-Weekly (26×/year)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Amortization end <span class="label-note">(payoff month)</span></label>
            <input type="month" id="qhousing-own-mtg-amort-end" value="${esc(m.amortizationEndDate)}">
            <div class="form-hint">Required — when the loan is fully paid off.</div>
          </div>
        </div>
        <div class="form-group">
          <label>Term start <span class="label-note">(optional)</span></label>
          <input type="month" id="qhousing-own-mtg-term-start" value="${esc(m.termStartDate)}">
          <div class="form-hint">When the current term started. If set, the payment is fixed for the term. Leave blank to recalculate monthly.</div>
        </div>
      </div>
      <div id="qhousing-own-pay-set" ${m.paymentMode !== 'set' ? 'style="display:none"' : ''}>
        <div class="form-group">
          <label>Monthly payment $</label>
          <input type="number" id="qhousing-own-mtg-pay" value="${m.monthlyPayment}" min="0" step="50">
          <div class="form-hint">Fixed payment; the principal / interest split is still calculated each month.</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Term end <span class="label-note">(optional)</span></label>
          <input type="month" id="qhousing-own-mtg-term-end" value="${esc(m.termEndDate)}">
          <div class="form-hint">When the current rate term expires and the mortgage renews.</div>
        </div>
        <div class="form-group">
          <label>Rate at renewal % <span class="label-note">(optional)</span></label>
          <input type="number" id="qhousing-own-mtg-renewal-rate" value="${m.renewalRate}" min="0" step="0.01">
          <div class="form-hint">Assumed annual rate applied after the term end.</div>
        </div>
      </div>
      <div class="qsf-section-heading">Common ownership expenses (check to include)</div>
      <div class="qsf-checkamount-list">
        ${renderAddon('own', 'propertyTax',   'Property tax / mo',     h.own.addons.propertyTax)}
        ${renderAddon('own', 'homeInsurance', 'Home insurance / mo',   h.own.addons.homeInsurance)}
        ${renderAddon('own', 'utilities',     'Utilities / mo',        h.own.addons.utilities)}
        ${renderAddon('own', 'internet',      'Internet / mo',         h.own.addons.internet)}
        ${renderAddon('own', 'maintenance',   'Home maintenance / mo', h.own.addons.maintenance)}
      </div>
    </div>
  `;

  return `
    <p>Do you rent or own your home? Pick one to see the relevant fields, or skip if you'd prefer to add housing later.</p>
    <div class="qsf-radio-row">
      <label class="qsf-radio-card${mode === 'rent' ? ' selected' : ''}">
        <input type="radio" name="qhousing-mode" value="rent" ${mode === 'rent' ? 'checked' : ''}
               onchange="hhv1ChangeHousingMode('${esc(wfId)}','rent')">
        <span>🏘️ Rent</span>
      </label>
      <label class="qsf-radio-card${mode === 'own' ? ' selected' : ''}">
        <input type="radio" name="qhousing-mode" value="own" ${mode === 'own' ? 'checked' : ''}
               onchange="hhv1ChangeHousingMode('${esc(wfId)}','own')">
        <span>🏡 Own</span>
      </label>
      <label class="qsf-radio-card${mode === 'skip' ? ' selected' : ''}">
        <input type="radio" name="qhousing-mode" value="skip" ${mode === 'skip' ? 'checked' : ''}
               onchange="hhv1ChangeHousingMode('${esc(wfId)}','skip')">
        <span>⏭️ Skip</span>
      </label>
    </div>
    ${mode === 'rent' ? rentBlock : ''}
    ${mode === 'own' ? ownBlock : ''}
  `;
}

function hhv1RenderRecurring(wfId, q) {
  q.recurring = q.recurring || hhv1DefaultRecurring();
  const r = q.recurring;
  return `
    <p>Check each common expense you want to include. The amounts are typical starting points — edit any to fit your situation.</p>
    <div class="qsf-checkamount-list">
      ${HOUSEHOLD_V1_RECURRING_ITEMS.map(it => {
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

function hhv1RenderOnetime(wfId, q) {
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
                  onclick="hhv1RemoveOnetimeRow('${esc(wfId)}',${i})">Remove</button>
        </div>
      `).join('')}
    </div>
    <button type="button" class="btn btn-sm btn-secondary" onclick="hhv1AddOnetimeRow('${esc(wfId)}')">+ Add event</button>
  `;
}

function hhv1RenderDebts(wfId, q) {
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
                  onclick="hhv1RemoveDebtRow('${esc(wfId)}',${i})">Remove</button>
        </div>
      `).join('')}
    </div>
    <button type="button" class="btn btn-sm btn-secondary" onclick="hhv1AddDebtRow('${esc(wfId)}')">+ Add debt</button>
  `;
}

// ── Record generation ──────────────────────────────────────────────
// Converts captured answers into a baseline + events + event set.
// Pure — caller persists. Empty / blank answers produce empty records;
// the caller decides how to handle that (e.g. the workflow may still
// create the baseline+set so the user can add items via Review).

function hhv1Generate(answers, ctx) {
  const start  = ctx.startDate || today();
  const prefix = ctx.namePrefix ? `${ctx.namePrefix} ` : '';
  const q = answers ?? {};
  const assum = q.assumptions ?? hhv1DefaultAssumptions();
  const interestMonthly = (assum.assetGrowthRate || 0) / 12;
  const invReturn = assum.investmentReturn || 0;
  const invStdDev = assum.investmentStdDev || 0;

  const baseline = {
    id: uuid(),
    name: uniqueName(`${prefix}Questionnaire Plan`.trim(), ctx.takenBaselineNames ?? []),
    description: ctx.baselineDescription || 'Generated by the guided questionnaire.',
    date: start,
    createdAt: new Date().toISOString(),
    assets: [],
    liabilities: [],
  };

  const sav = q.savings ?? {};
  const chequingName = (sav.chequing > 0) ? 'Chequing & Cash' : '';
  if (sav.chequing > 0)    baseline.assets.push({ id: uuid(), name: chequingName,         value: sav.chequing,    category: 'Bank Account',       isInvestment: false, isLiquid: true,  monthlyGrowthRate: 0,               annualMeanReturn: invReturn, annualStdDev: invStdDev });
  if (sav.emergency > 0)   baseline.assets.push({ id: uuid(), name: 'Emergency Fund',     value: sav.emergency,   category: 'Bank Account',       isInvestment: false, isLiquid: true,  monthlyGrowthRate: interestMonthly, annualMeanReturn: invReturn, annualStdDev: invStdDev });
  if (sav.investments > 0) baseline.assets.push({ id: uuid(), name: 'Investment Account', value: sav.investments, category: 'Investment Account', isInvestment: true,  isLiquid: true,  monthlyGrowthRate: 0,               annualMeanReturn: invReturn, annualStdDev: invStdDev });
  if (sav.retirement > 0)  baseline.assets.push({ id: uuid(), name: 'Retirement Account', value: sav.retirement,  category: 'Investment Account', isInvestment: true,  isLiquid: false, monthlyGrowthRate: 0,               annualMeanReturn: invReturn, annualStdDev: invStdDev });

  const h = q.housing ?? {};
  if (h.mode === 'own') {
    if (h.own?.value > 0) {
      baseline.assets.push({ id: uuid(), name: 'Primary Residence', value: h.own.value, category: 'Real Estate', isInvestment: false, isLiquid: false, monthlyGrowthRate: interestMonthly, annualMeanReturn: invReturn, annualStdDev: invStdDev });
    }
    const m = hhv1NormalizeOwnMortgage(h.own);
    // Only create the liability when the payment can actually be derived:
    // calculated mode needs an amortization end date, set mode needs a payment.
    const mortgageReady = m.balance > 0 &&
      (m.paymentMode === 'set' ? m.monthlyPayment > 0 : !!m.amortizationEndDate);
    if (mortgageReady) {
      baseline.liabilities.push({
        id: uuid(), name: 'Primary Mortgage', value: m.balance, category: 'Mortgage',
        annualInterestRate: m.rate || 5,
        useAmortization: true,
        monthlyPayment: m.monthlyPayment || 0,
        includeInLiquidNW: m.includeInLiquidNW,
        paymentAssetName: chequingName,
        paymentMode: m.paymentMode,
        paymentFrequency: m.paymentFrequency,
        amortizationEndDate: m.amortizationEndDate,
        termStartDate: m.termStartDate,
        termEndDate: m.termEndDate,
        renewalRate: m.renewalRate,
      });
    }
  }

  for (const d of (q.debts?.items ?? [])) {
    if (!d.name || d.balance <= 0 || !d.payoffYear) continue;
    baseline.liabilities.push({
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

  const events = [];

  for (const s of (q.income?.streams ?? [])) {
    if (!s.name || s.amount <= 0) continue;
    events.push({
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

  const housingExpense = (name, amount, category) => events.push({
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

  const r = q.recurring ?? {};
  for (const it of HOUSEHOLD_V1_RECURRING_ITEMS) {
    const v = r[it.key];
    if (v?.included && v.amount > 0) {
      events.push({
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

  for (const e of (q.onetime?.events ?? [])) {
    if (!e.name || !e.date || e.amount <= 0) continue;
    const isInflow = e.type === 'one_time_inflow';
    events.push({
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

  const eventSet = {
    id: uuid(),
    name: uniqueName(`${prefix}Questionnaire Plan Events`.trim(), ctx.takenEventSetNames ?? []),
    description: ctx.eventSetDescription || 'Events from the guided questionnaire.',
    eventIds: events.map(e => e.id),
  };

  return { baseline, events, eventSet };
}

registerV1Questionnaire({
  id:      'household-v1',
  version: 1,
  label:   'Household questionnaire (v1)',
  topics:  HOUSEHOLD_V1_TOPICS,
  recurringItems: HOUSEHOLD_V1_RECURRING_ITEMS,
  defaults: {
    assumptions: hhv1DefaultAssumptions,
    savings:     hhv1DefaultSavings,
    housing:     hhv1DefaultHousing,
    recurring:   hhv1DefaultRecurring,
    income:      () => ({ streams: [{ name: '', amount: 0, startDate: '', endDate: '' }] }),
    onetime:     () => ({ events: [] }),
    debts:       () => ({ items: [] }),
  },
  captures: {
    assumptions: () => hhv1CaptureAssumptions(),
    savings:     () => hhv1CaptureSavings(),
    housing:     (prev) => hhv1CaptureHousing(prev || hhv1DefaultHousing()),
    recurring:   (prev) => hhv1CaptureRecurring(prev || hhv1DefaultRecurring()),
    income:      () => ({ streams: hhv1CaptureIncomeRows() }),
    onetime:     () => ({ events: hhv1CaptureOnetimeRows() }),
    debts:       () => ({ items: hhv1CaptureDebtRows() }),
  },
  renders: {
    topics:      hhv1RenderTopics,
    assumptions: hhv1RenderAssumptions,
    savings:     hhv1RenderSavings,
    housing:     hhv1RenderHousing,
    recurring:   hhv1RenderRecurring,
    income:      hhv1RenderIncome,
    onetime:     hhv1RenderOnetime,
    debts:       hhv1RenderDebts,
  },
  generate: hhv1Generate,
});
