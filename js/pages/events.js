'use strict';

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
