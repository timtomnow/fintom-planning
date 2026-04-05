'use strict';

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
  // Per-month entries (edits scoped to a single occurrence of a recurring event)
  const isMonthly = !!ev._sourceId;

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
    <div class="form-group" ${isMonthly ? 'style="display:none"' : ''}>
      <label class="checkbox-label">
        <input type="checkbox" id="oev-rec" ${ev.isRecurring ? 'checked' : ''} onchange="onOevRecChange()">
        Recurring — happens every month
      </label>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label id="oev-start-lbl">${ev.isRecurring ? 'Start Date' : 'Date'}</label>
        <input type="month" id="oev-start" value="${ev.startDate}"${isMonthly ? ' readonly' : ''}>
      </div>
      <div class="form-group" id="oev-end-wrap" ${!ev.isRecurring ? 'style="display:none"' : ''}>
        <label>End Date <span class="label-note">(blank = indefinite)</span></label>
        <input type="month" id="oev-end" value="${ev.endDate ?? ''}">
      </div>
    </div>
    <div class="form-row" ${isMonthly ? 'style="display:none"' : ''}>
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
      // Per-month overrides are always one-time and never inflation-adjusted (amount is pre-applied)
      isRecurring: isMonthly ? false : document.getElementById('oev-rec').checked,
      startDate,
      endDate: isMonthly ? '' : (document.getElementById('oev-end').value || ''),
      inflationAdjusted: isMonthly ? false : document.getElementById('oev-inf').checked,
      notes: '',
      linkedAssetName:     isOut ? document.getElementById('oev-link-asset').value     : '',
      depositToAssetName:  isIn  ? document.getElementById('oev-deposit-asset').value  : '',
      payFromAssetName:    isOut ? document.getElementById('oev-pay-from-asset').value  : '',
      linkedLiabilityName: isOut ? document.getElementById('oev-link-liab').value       : '',
    };
    // Preserve monthly-override routing fields so resolveEffectiveEvents can exclude
    // the corresponding month from the original recurring event
    if (isMonthly) {
      updated._sourceId = ev._sourceId;
      updated._month    = ev._month;
    }
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
// EVENTS TABLE — module-level filter/page state
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

  // Populate events table data before rendering.
  // Recurring events are expanded into one entry per active month so the table
  // shows every occurrence individually and each month can be edited independently.
  const baseEvents = resolveEffectiveEvents(cfg);
  _evTableData = [];
  for (const ev of baseEvents) {
    // Monthly per-instance overrides are already one-time for a specific month — add directly
    if (ev._sourceId) {
      if (ev.startDate >= cfg.startDate && ev.startDate <= cfg.endDate) _evTableData.push(ev);
      continue;
    }
    const isOneTime = !ev.isRecurring || ev.type === 'one_time_inflow' || ev.type === 'one_time_outflow';
    if (isOneTime) {
      if (ev.startDate >= cfg.startDate && ev.startDate <= cfg.endDate) _evTableData.push(ev);
    } else {
      // Expand recurring: one entry per active month within the analysis range
      const startM = ev.startDate > cfg.startDate ? ev.startDate : cfg.startDate;
      const endM   = ev.endDate ? (ev.endDate < cfg.endDate ? ev.endDate : cfg.endDate) : cfg.endDate;
      let month = startM;
      while (month <= endM) {
        if (!ev._excludedMonths?.has(month)) {
          const inflMult = (ev.inflationAdjusted && cfg.inflationRate)
            ? Math.pow(1 + cfg.inflationRate / 12 / 100, monthsBetween(cfg.startDate, month))
            : 1;
          _evTableData.push({
            ...ev,
            id: `monthly-${ev.id}-${month}`,
            _sourceId: ev.id,
            _month: month,
            startDate: month,
            isRecurring: false,
            inflationAdjusted: false,
            amount: ev.amount * inflMult,
          });
        }
        month = addMonths(month, 1);
      }
    }
  }

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

    <!-- All Analysis Events table -->
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
