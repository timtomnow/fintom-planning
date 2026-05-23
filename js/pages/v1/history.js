'use strict';

// ═══════════════════════════════════════════════════════════════
// v1 HISTORY — list of completed workflows
// ═══════════════════════════════════════════════════════════════

function renderV1History() {
  const completed = state.data.workflows
    .filter(w => w.completedAt)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));

  return `
    <div class="v1-page">
      <header class="v1-page-header">
        <div class="v1-brand">Fin<span class="v1-brand-dim">Tom</span></div>
        <div class="v1-page-back">
          <button class="btn btn-ghost btn-sm" onclick="navigate('${V1_LANDING_PAGE}')">← Back to Get Started</button>
        </div>
        <h1 class="v1-page-title">History</h1>
        <p class="v1-page-sub">Workflows you've completed.</p>
      </header>

      ${completed.length === 0 ? `
        <p style="color:var(--muted)">No completed workflows yet.</p>
      ` : `
        <div class="v1-card-grid">
          ${completed.map(renderHistoryCard).join('')}
        </div>
      `}
    </div>
  `;
}

function renderHistoryCard(wf) {
  const def = getV1WorkflowDefinition(wf.type);
  const title = def?.title || wf.type;
  const icon = def?.icon || '✓';
  const completed = wf.completedAt ? new Date(wf.completedAt).toLocaleString() : '';
  return `
    <div class="v1-card v1-card-sm">
      <div class="v1-card-icon">${esc(icon)}</div>
      <div class="v1-card-body">
        <div class="v1-card-title">${esc(title)}</div>
        <div class="v1-card-desc">Completed ${esc(completed)}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="deleteV1WorkflowRecord('${esc(wf.id)}')">Remove</button>
    </div>
  `;
}
