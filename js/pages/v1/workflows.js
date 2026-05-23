'use strict';

// ═══════════════════════════════════════════════════════════════
// v1 WORKFLOW RUNTIME
// ═══════════════════════════════════════════════════════════════
//
// Workflow definition shape:
// {
//   id:               string (matches the registry key),
//   title:            string,
//   description:      string (one-line shown on cards),
//   icon:             emoji string,
//   estimatedTime:    string (e.g. '5 min'),
//   category:         'main' | 'admin' — drives placement on Get Started,
//   eligible:         (data) => bool — gates visibility based on state.data,
//   initialStepKey:   string,
//   initialDraft:     () => object,
//   steps: {
//     [stepKey]: {
//       key:              string,
//       title:            string,
//       render:           (wf) => htmlString,
//       onContinue:       (wf) => { ok: bool, nextStepKey?: string, errors?: string[] },
//                                 nextStepKey === 'complete' marks the workflow done.
//       previousStepKey:  string | null,
//       continueLabel:    string (optional),
//       backLabel:        string (optional),
//     },
//   },
// }
//
// Workflow instance shape (persisted in state.data.workflows):
// {
//   id, type, currentStep, draftData,
//   startedAt, updatedAt, completedAt,
//   producedRecordIds: { baselineIds, eventIds, eventSetIds, analysisConfigIds },
// }

const V1_WORKFLOWS = {};

function registerV1Workflow(def) {
  V1_WORKFLOWS[def.id] = def;
}

function getV1WorkflowInstance(workflowId) {
  return state.data.workflows.find(w => w.id === workflowId) || null;
}

function getV1WorkflowDefinition(type) {
  return V1_WORKFLOWS[type] || null;
}

// ═══════════════════════════════════════════════════════════════
// LIFECYCLE
// ═══════════════════════════════════════════════════════════════

function startV1Workflow(type) {
  const def = getV1WorkflowDefinition(type);
  if (!def) { showToast('Unknown workflow type', 'error'); return; }
  const wf = {
    id: uuid(),
    type,
    currentStep: def.initialStepKey,
    draftData: def.initialDraft ? def.initialDraft() : {},
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    producedRecordIds: {
      baselineIds: [], eventIds: [], eventSetIds: [], analysisConfigIds: [],
    },
  };
  state.data.workflows.push(wf);
  saveData();
  navigate('v1-workflow', { workflowId: wf.id });
}

function resumeV1Workflow(workflowId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) { showToast('Workflow not found', 'error'); navigate(V1_LANDING_PAGE); return; }
  navigate('v1-workflow', { workflowId });
}

function advanceV1Workflow() {
  const wf = getV1WorkflowInstance(state.params.workflowId);
  if (!wf) { navigate(V1_LANDING_PAGE); return; }
  const def = getV1WorkflowDefinition(wf.type);
  if (!def) { showToast('Workflow definition missing', 'error'); return; }
  const stepDef = def.steps[wf.currentStep];
  if (!stepDef) { showToast('Step missing', 'error'); return; }

  const result = stepDef.onContinue
    ? stepDef.onContinue(wf)
    : { ok: true, nextStepKey: null };

  if (!result || !result.ok) {
    if (result?.errors) result.errors.forEach(e => showToast(e, 'error'));
    return;
  }

  wf.updatedAt = new Date().toISOString();

  if (result.nextStepKey === 'complete' || !result.nextStepKey) {
    wf.completedAt = new Date().toISOString();
    saveData();
    showToast('Workflow complete', 'success');
    navigate(V1_LANDING_PAGE);
    return;
  }

  if (!def.steps[result.nextStepKey]) {
    showToast(`Step "${result.nextStepKey}" not defined`, 'error');
    return;
  }

  wf.currentStep = result.nextStepKey;
  saveData();
  navigate('v1-workflow', { workflowId: wf.id });
}

function goBackV1Workflow() {
  const wf = getV1WorkflowInstance(state.params.workflowId);
  if (!wf) return;
  const def = getV1WorkflowDefinition(wf.type);
  const stepDef = def?.steps[wf.currentStep];
  const prev = stepDef?.previousStepKey;
  if (!prev) return;
  wf.currentStep = prev;
  wf.updatedAt = new Date().toISOString();
  saveData();
  navigate('v1-workflow', { workflowId: wf.id });
}

function exitV1Workflow() {
  // Workflow remains in-progress and surfaces in the Resume list.
  navigate(V1_LANDING_PAGE);
}

function discardV1Workflow(workflowId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  const def = getV1WorkflowDefinition(wf.type);
  const title = def?.title || 'this workflow';
  showConfirm(
    'Discard workflow?',
    `This removes your in-progress "${title}" and any records it created. This cannot be undone.`,
    () => {
      rollbackProducedRecords(wf);
      state.data.workflows = state.data.workflows.filter(w => w.id !== workflowId);
      saveData();
      showToast('Workflow discarded');
      navigate(V1_LANDING_PAGE);
    },
    'Discard',
  );
}

function rollbackProducedRecords(wf) {
  const ids = wf.producedRecordIds;
  if (!ids) return;
  if (ids.baselineIds?.length) {
    state.data.baselines = state.data.baselines.filter(b => !ids.baselineIds.includes(b.id));
  }
  if (ids.eventIds?.length) {
    state.data.events = state.data.events.filter(e => !ids.eventIds.includes(e.id));
    // Clean references from any event sets
    state.data.eventSets.forEach(s => {
      s.eventIds = s.eventIds.filter(id => !ids.eventIds.includes(id));
    });
  }
  if (ids.eventSetIds?.length) {
    state.data.eventSets = state.data.eventSets.filter(s => !ids.eventSetIds.includes(s.id));
    // Clean references from any analysis configs
    state.data.analysisConfigs.forEach(c => {
      c.eventSetIds = (c.eventSetIds || []).filter(id => !ids.eventSetIds.includes(id));
      c.compareEventSetIds = (c.compareEventSetIds || []).filter(id => !ids.eventSetIds.includes(id));
    });
  }
  if (ids.analysisConfigIds?.length) {
    state.data.analysisConfigs = state.data.analysisConfigs.filter(c => !ids.analysisConfigIds.includes(c.id));
  }
}

function deleteV1WorkflowRecord(workflowId) {
  const wf = getV1WorkflowInstance(workflowId);
  if (!wf) return;
  showConfirm(
    'Remove from history?',
    'This only removes the workflow record. Any records the workflow created (baselines, events, analyses) are kept.',
    () => {
      state.data.workflows = state.data.workflows.filter(w => w.id !== workflowId);
      saveData();
      navigate('v1-history');
    },
    'Remove',
  );
}

// ═══════════════════════════════════════════════════════════════
// RENDER ENTRY — called by navigate() for 'v1-workflow' page
// ═══════════════════════════════════════════════════════════════

function renderV1Workflow() {
  const wf = getV1WorkflowInstance(state.params.workflowId);
  if (!wf) {
    setTimeout(() => navigate(V1_LANDING_PAGE), 0);
    return `<div class="v1-page"><p style="color:var(--muted)">Workflow not found.</p></div>`;
  }
  const def = getV1WorkflowDefinition(wf.type);
  if (!def) {
    return `<div class="v1-page">
      <p style="color:var(--danger)">Unknown workflow type: ${esc(wf.type)}</p>
      <button class="btn btn-secondary" onclick="navigate('${V1_LANDING_PAGE}')">Back to Get Started</button>
    </div>`;
  }
  const stepDef = def.steps[wf.currentStep];
  if (!stepDef) {
    return `<div class="v1-page">
      <p style="color:var(--danger)">Step "${esc(wf.currentStep)}" not defined for workflow "${esc(def.title)}".</p>
      <button class="btn btn-secondary" onclick="navigate('${V1_LANDING_PAGE}')">Back to Get Started</button>
    </div>`;
  }

  const stepKeys = Object.keys(def.steps);
  const stepIndex = stepKeys.indexOf(stepDef.key);
  const totalSteps = stepKeys.length;

  return renderV1Shell({
    definition: def,
    stepDef,
    stepIndex,
    totalSteps,
    bodyHtml: stepDef.render(wf),
  });
}

// ═══════════════════════════════════════════════════════════════
// DEMO WORKFLOW — proves the runtime end-to-end
// ═══════════════════════════════════════════════════════════════

registerV1Workflow({
  id: 'demo-2step',
  title: 'Demo Workflow',
  description: 'A short two-step example used to verify the workflow runtime. Creates no records.',
  icon: '🧪',
  estimatedTime: '< 1 min',
  category: 'admin',
  eligible: () => true,
  initialStepKey: 'intro',
  initialDraft: () => ({ name: '' }),
  steps: {
    'intro': {
      key: 'intro',
      title: 'Welcome to the demo',
      render: (wf) => `
        <p>This workflow exists to verify the workflow runtime works end-to-end. It has two steps and creates no records in your data.</p>
        <p>You can exit at any time and resume from the Get Started page.</p>
        <div class="form-group" style="margin-top: 24px;">
          <label for="demo-name">What's your name? <span class="label-note">(optional)</span></label>
          <input type="text" id="demo-name" value="${esc(wf.draftData.name || '')}" placeholder="Your name" />
          <div class="form-hint">This is saved to the workflow draft so it persists across step transitions.</div>
        </div>
      `,
      onContinue: (wf) => {
        const name = document.getElementById('demo-name')?.value.trim() || '';
        wf.draftData.name = name;
        return { ok: true, nextStepKey: 'finish' };
      },
      previousStepKey: null,
    },
    'finish': {
      key: 'finish',
      title: 'All done',
      render: (wf) => `
        <p>${wf.draftData.name ? `Thanks, ${esc(wf.draftData.name)}.` : 'Thanks for testing.'}</p>
        <p>The runtime worked: state persisted across the step transition, your draft was saved, and the workflow will be marked complete when you finish.</p>
        <p style="color: var(--muted); font-size: 13px;">After finishing, this run will appear under Admin → History.</p>
      `,
      onContinue: () => ({ ok: true, nextStepKey: 'complete' }),
      previousStepKey: 'intro',
      continueLabel: 'Finish',
    },
  },
});
