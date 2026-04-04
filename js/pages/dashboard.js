'use strict';

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

function renderDashboard() {
  const { baselines, events, eventSets, analysisConfigs } = state.data;

  let latestNW = null;
  if (baselines.length) {
    const bl = baselines[baselines.length - 1];
    latestNW = (bl.assets ?? []).reduce((s, a) => s + a.value, 0)
             - (bl.liabilities ?? []).reduce((s, l) => s + l.value, 0);
  }

  const recIncome   = events.filter(e => e.type === 'income'   && e.isRecurring).reduce((s, e) => s + e.amount, 0);
  const recExpense  = events.filter(e => e.type === 'expense'  && e.isRecurring).reduce((s, e) => s + e.amount, 0);
  const taxRate     = state.data.settings.defaultTaxRate ?? 22;
  const monthlyCF   = recIncome * (1 - taxRate / 100) - recExpense;

  return `<div class="page">
    <div class="page-header">
      <div><div class="page-title">Dashboard</div><div class="page-subtitle">Your financial planning overview</div></div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Latest Net Worth</div>
        <div class="stat-value ${latestNW === null ? '' : latestNW >= 0 ? 'positive' : 'negative'}">
          ${latestNW === null ? '—' : fmt$(latestNW)}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Est. Monthly Cash Flow</div>
        <div class="stat-value ${events.length ? (monthlyCF >= 0 ? 'positive' : 'negative') : ''}">
          ${events.length ? fmt$(monthlyCF) : '—'}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Baselines</div>
        <div class="stat-value">${baselines.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Events / Event Sets</div>
        <div class="stat-value">${events.length} / ${eventSets.length}</div>
      </div>
    </div>

    ${baselines.length === 0 ? `
      <div class="card">
        <div class="empty-state">
          <div class="empty-state-icon">📊</div>
          <div class="empty-state-title">Welcome to FinTom</div>
          <div class="empty-state-body">Start by creating a baseline — a snapshot of your current assets and liabilities. Then add events for income and expenses.</div>
          <button class="btn btn-primary" onclick="navigate('baselines')">Create First Baseline</button>
        </div>
      </div>
    ` : `
      <div class="card">
        <div class="card-title">Quick Actions</div>
        <div class="flex gap-2 flex-wrap">
          <button class="btn btn-secondary" onclick="navigate('baselines')">Manage Baselines</button>
          <button class="btn btn-secondary" onclick="navigate('events')">Manage Events</button>
          <button class="btn btn-primary"   onclick="navigate('analysis')">Run Analysis</button>
        </div>
      </div>

      ${analysisConfigs.length ? `
        <div class="card mt-4">
          <div class="card-title">Saved Configurations</div>
          <div class="table-wrap"><table>
            <thead><tr>
              <th>Name</th><th>Baseline</th><th>Period</th><th>Monte Carlo</th><th></th>
            </tr></thead>
            <tbody>
              ${analysisConfigs.map(cfg => {
                const bl = baselines.find(b => b.id === cfg.baselineId);
                return `<tr>
                  <td><strong>${esc(cfg.name)}</strong></td>
                  <td>${bl ? esc(bl.name) : '<span class="text-muted">—</span>'}</td>
                  <td class="text-muted nowrap" style="font-size:12px;">${monthLabel(cfg.startDate)} – ${monthLabel(cfg.endDate)}</td>
                  <td>${cfg.monteCarlo?.enabled ? `<span class="badge">${cfg.monteCarlo.numSimulations} runs</span>` : '<span class="text-muted">—</span>'}</td>
                  <td><button class="btn btn-sm btn-primary" onclick="runAndView('${cfg.id}')">Run</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>
        </div>
      ` : ''}
    `}
  </div>`;
}
