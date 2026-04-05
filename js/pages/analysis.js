'use strict';

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

  // Monthly per-instance overrides have _sourceId set (created by editing a single month
  // of a recurring event). Separate them from regular full-event overrides.
  const monthlyOverrides  = overrides.filter(e => e._sourceId);
  const regularOverrides  = overrides.filter(e => !e._sourceId);

  // Build excluded-months map: originalEventId -> Set<month>
  // The original recurring event must NOT fire in these months (the monthly override fires instead).
  const excludedMonths = new Map();
  for (const mo of monthlyOverrides) {
    if (!excludedMonths.has(mo._sourceId)) excludedMonths.set(mo._sourceId, new Set());
    excludedMonths.get(mo._sourceId).add(mo._month);
  }

  const overrideMap = new Map(regularOverrides.map(e => [e.id, e]));
  const merged = base.map(e => {
    let result = overrideMap.has(e.id) ? overrideMap.get(e.id) : e;
    const excl = excludedMonths.get(e.id);
    if (excl) result = { ...result, _excludedMonths: excl };
    return result;
  });
  const baseIds = new Set(base.map(e => e.id));
  regularOverrides.filter(e => !baseIds.has(e.id)).forEach(e => merged.push(e));
  // Append monthly overrides — each is a one-time event for its specific month
  monthlyOverrides.forEach(e => merged.push(e));
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
