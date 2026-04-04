'use strict';

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
