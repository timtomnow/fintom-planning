'use strict';

// ═══════════════════════════════════════════════════════════════
// v1 SHELL — chrome for workflow step pages
// (no sidebar, no bottom-nav; sticky topbar + actionbar)
// ═══════════════════════════════════════════════════════════════

function renderV1Shell({ definition, stepDef, stepIndex, totalSteps, bodyHtml }) {
  const hasBack = !!stepDef.previousStepKey;
  const continueLabel = stepDef.continueLabel || 'Continue';
  const backLabel = stepDef.backLabel || '← Back';

  return `
    <div class="v1-shell">
      <header class="v1-topbar">
        <div class="v1-topbar-title">${esc(definition.title)}</div>
        <div class="v1-topbar-step">Step ${stepIndex + 1} of ${totalSteps}</div>
        <button class="v1-topbar-exit" onclick="exitV1Workflow()">Exit</button>
      </header>
      <div class="v1-body">
        <h1 class="v1-step-title">${esc(stepDef.title)}</h1>
        ${bodyHtml}
      </div>
      <footer class="v1-actionbar">
        ${hasBack
          ? `<button class="btn btn-secondary" onclick="goBackV1Workflow()">${esc(backLabel)}</button>`
          : '<span></span>'}
        <button class="btn btn-primary" id="v1-continue-btn" onclick="advanceV1Workflow()">${esc(continueLabel)}</button>
      </footer>
    </div>
  `;
}
