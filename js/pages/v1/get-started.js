'use strict';

// ═══════════════════════════════════════════════════════════════
// v1 GET STARTED — workflow landing page
// ═══════════════════════════════════════════════════════════════

function renderV1GetStarted() {
  const hasData = state.data.baselines.length > 0
    || state.data.events.length > 0
    || state.data.analysisConfigs.length > 0;

  const inProgress = state.data.workflows
    .filter(w => !w.completedAt)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  const mainWorkflows = listV1Workflows('main');
  const adminWorkflows = listV1Workflows('admin');

  return `
    <div class="v1-page">
      <header class="v1-page-header">
        <div class="v1-brand">Fin<span class="v1-brand-dim">Tom</span></div>
        <h1 class="v1-page-title">${hasData ? 'What would you like to do?' : 'Welcome to FinTom'}</h1>
        ${!hasData ? `
          <p class="v1-page-sub">Build a household financial plan in minutes. Pick a workflow to get started, or import an existing plan.</p>
        ` : ''}
      </header>

      ${!hasData ? renderEmptyStateCards(mainWorkflows) : ''}

      ${inProgress.length > 0 ? `
        <section class="v1-section">
          <h2 class="v1-section-title">Resume in progress</h2>
          <div class="v1-card-grid">
            ${inProgress.map(renderResumeCard).join('')}
          </div>
        </section>
      ` : ''}

      ${hasData && mainWorkflows.length > 0 ? `
        <section class="v1-section">
          <h2 class="v1-section-title">Workflows</h2>
          <div class="v1-card-grid">
            ${mainWorkflows.map(def => renderWorkflowCard(def)).join('')}
          </div>
        </section>
      ` : ''}

      <section class="v1-section v1-section-muted">
        <h2 class="v1-section-title">Admin</h2>
        <div class="v1-card-grid">
          <div class="v1-card v1-card-sm" onclick="navigate('v1-history')">
            <div class="v1-card-icon">🕒</div>
            <div class="v1-card-body">
              <div class="v1-card-title">History</div>
              <div class="v1-card-desc">Past workflow runs.</div>
            </div>
            <div class="v1-card-chev">›</div>
          </div>
          <div class="v1-card v1-card-sm" onclick="navigate('settings')">
            <div class="v1-card-icon">⚙</div>
            <div class="v1-card-body">
              <div class="v1-card-title">Settings</div>
              <div class="v1-card-desc">Defaults, data backup, and import / export.</div>
            </div>
            <div class="v1-card-chev">›</div>
          </div>
          <div class="v1-card v1-card-sm" onclick="navigate('dashboard')">
            <div class="v1-card-icon">🛠</div>
            <div class="v1-card-body">
              <div class="v1-card-title">Open advanced view</div>
              <div class="v1-card-desc">Direct access to baselines, events, and analysis configs.</div>
            </div>
            <div class="v1-card-chev">›</div>
          </div>
          ${adminWorkflows.map(def => renderWorkflowCard(def, { compact: true })).join('')}
        </div>
      </section>
    </div>
  `;
}

function listV1Workflows(category) {
  return Object.values(V1_WORKFLOWS)
    .filter(def => (def.category || 'main') === category)
    .filter(def => def.eligible ? def.eligible(state.data) : true);
}

function renderEmptyStateCards(mainWorkflows) {
  const firstWf = mainWorkflows[0];
  return `
    <section class="v1-section">
      <div class="v1-card-grid">
        ${firstWf ? `
          <div class="v1-card v1-card-primary" onclick="startV1Workflow('${esc(firstWf.id)}')">
            <div class="v1-card-icon">${esc(firstWf.icon || '✨')}</div>
            <div class="v1-card-body">
              <div class="v1-card-title">Get Started — ${esc(firstWf.title)}</div>
              <div class="v1-card-desc">${esc(firstWf.description)}</div>
              ${firstWf.estimatedTime ? `<div class="v1-card-meta v1-card-meta-light">${esc(firstWf.estimatedTime)}</div>` : ''}
            </div>
            <div class="v1-card-chev">›</div>
          </div>
        ` : `
          <div class="v1-card">
            <div class="v1-card-icon">✨</div>
            <div class="v1-card-body">
              <div class="v1-card-title">No workflows available yet</div>
              <div class="v1-card-desc">Workflows will appear here as they're added.</div>
            </div>
          </div>
        `}
        <div class="v1-card" onclick="triggerImport()">
          <div class="v1-card-icon">📥</div>
          <div class="v1-card-body">
            <div class="v1-card-title">Import existing data</div>
            <div class="v1-card-desc">Already have a FinTom backup? Load it from a .json file.</div>
          </div>
          <div class="v1-card-chev">›</div>
        </div>
      </div>
    </section>
  `;
}

function renderWorkflowCard(def, opts = {}) {
  const compact = !!opts.compact;
  return `
    <div class="v1-card${compact ? ' v1-card-sm' : ''}" onclick="startV1Workflow('${esc(def.id)}')">
      <div class="v1-card-icon">${esc(def.icon || '✨')}</div>
      <div class="v1-card-body">
        <div class="v1-card-title">${esc(def.title)}</div>
        <div class="v1-card-desc">${esc(def.description)}</div>
        ${def.estimatedTime ? `<div class="v1-card-meta">${esc(def.estimatedTime)}</div>` : ''}
      </div>
      <div class="v1-card-chev">›</div>
    </div>
  `;
}

function renderResumeCard(wf) {
  const def = getV1WorkflowDefinition(wf.type);
  const title = def?.title || wf.type;
  const icon = def?.icon || '⏵';
  const stepKeys = def ? Object.keys(def.steps) : [];
  const stepIdx = stepKeys.indexOf(wf.currentStep);
  const totalSteps = stepKeys.length;
  const progress = (stepIdx >= 0 && totalSteps > 0)
    ? `Step ${stepIdx + 1} of ${totalSteps}`
    : 'In progress';
  const updated = wf.updatedAt ? new Date(wf.updatedAt).toLocaleString() : '';

  return `
    <div class="v1-card">
      <div class="v1-card-icon">${esc(icon)}</div>
      <div class="v1-card-body" onclick="resumeV1Workflow('${esc(wf.id)}')" style="cursor:pointer">
        <div class="v1-card-title">${esc(title)}</div>
        <div class="v1-card-desc">${esc(progress)}${updated ? ` · last updated ${esc(updated)}` : ''}</div>
      </div>
      <div class="v1-card-actions">
        <button class="btn btn-primary btn-sm" onclick="resumeV1Workflow('${esc(wf.id)}')">Continue</button>
        <button class="btn btn-ghost btn-sm" onclick="discardV1Workflow('${esc(wf.id)}')">Discard</button>
      </div>
    </div>
  `;
}
