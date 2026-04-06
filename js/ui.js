'use strict';

// ═══════════════════════════════════════════════════════════════
// CHART HELPERS
// ═══════════════════════════════════════════════════════════════

function destroyCharts() {
  state.activeCharts.forEach(c => c.destroy());
  state.activeCharts = [];
}

function makeChart(canvasId, config) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const chart = new Chart(ctx, config);
  state.activeCharts.push(chart);
  return chart;
}

// ═══════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════

function showModal(title, bodyHtml, onSave, saveLabel = 'Save') {
  document.getElementById('modal').innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${esc(title)}</span>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="hideModal()">Cancel</button>
      <button class="btn btn-primary" id="modal-save">${esc(saveLabel)}</button>
    </div>`;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-save').onclick = () => { if (onSave()) hideModal(); };
}

function showConfirm(title, msg, onConfirm, confirmLabel = 'Delete') {
  document.getElementById('modal').innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${esc(title)}</span>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="modal-body"><p style="color:var(--muted);font-size:14px;">${esc(msg)}</p></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="hideModal()">Cancel</button>
      <button class="btn btn-danger" id="modal-confirm">${esc(confirmLabel)}</button>
    </div>`;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-confirm').onclick = () => { onConfirm(); hideModal(); };
}

function hideModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('modal').classList.remove('modal-wide');
}

async function showHelpModal(tab = 'readme') {
  const render = md => typeof marked !== 'undefined'
    ? marked.parse(md)
    : `<pre style="white-space:pre-wrap;font-size:12.5px;">${esc(md)}</pre>`;
  const errHtml = '<p style="color:var(--danger)">Could not load documentation. Help requires the app to be served over HTTP.</p><p>To develop locally, run this from the project folder:</p><pre style="background:var(--bg-secondary);padding:8px 12px;border-radius:6px;font-size:13px;">python3 -m http.server 8080</pre><p>Then open <a href="http://localhost:8080" target="_blank">http://localhost:8080</a></p>';

  document.getElementById('modal').innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Help &amp; Documentation</span>
      <button class="modal-close" onclick="hideModal()">×</button>
    </div>
    <div class="help-tabs">
      <button class="help-tab-btn${tab === 'readme' ? ' active' : ''}" onclick="switchHelpTab('readme')">User Guide</button>
      <button class="help-tab-btn${tab === 'claude' ? ' active' : ''}" onclick="switchHelpTab('claude')">Developer Guide</button>
    </div>
    <div class="help-content" id="help-readme" ${tab !== 'readme' ? 'style="display:none"' : ''}>
      <p style="color:var(--text-muted)">Loading…</p>
    </div>
    <div class="help-content" id="help-claude" ${tab !== 'claude' ? 'style="display:none"' : ''}>
      <p style="color:var(--text-muted)">Loading…</p>
    </div>`;
  document.getElementById('modal').classList.add('modal-wide');
  document.getElementById('modal-overlay').classList.add('open');

  const load = async (url, elId) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      document.getElementById(elId).innerHTML = render(await res.text());
    } catch {
      document.getElementById(elId).innerHTML = errHtml;
    }
  };

  load('./README.md', 'help-readme');
  load('./CLAUDE.md', 'help-claude');
}

function switchHelpTab(tab) {
  document.getElementById('help-readme').style.display = tab === 'readme' ? '' : 'none';
  document.getElementById('help-claude').style.display = tab === 'claude' ? '' : 'none';
  document.querySelectorAll('.help-tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', (i === 0 && tab === 'readme') || (i === 1 && tab === 'claude'));
  });
}

document.addEventListener('click', e => {
  if (e.target.id === 'modal-overlay') hideModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('modal-overlay').classList.contains('open')) {
    hideModal();
  }
});

// ═══════════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════════

function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

function navigate(page, params = {}) {
  destroyCharts();
  state.page = page;
  state.params = params;

  const activeNav = SIDEBAR_MAP[page] ?? page;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.page === activeNav));

  const main = document.getElementById('main');
  switch (page) {
    case 'dashboard':         main.innerHTML = renderDashboard(); break;
    case 'baselines':         main.innerHTML = renderBaselines(); break;
    case 'baseline-detail':   main.innerHTML = renderBaselineDetail(); break;
    case 'events':            main.innerHTML = renderEvents(); break;
    case 'event-sets':        main.innerHTML = renderEventSets(); break;
    case 'event-set-detail':  main.innerHTML = renderEventSetDetail(); break;
    case 'analysis':          main.innerHTML = renderAnalysis(); break;
    case 'results':
      main.innerHTML = renderResults();
      requestAnimationFrame(attachResultsCharts);
      break;
    case 'settings':          main.innerHTML = renderSettings(); break;
    default:                  main.innerHTML = renderDashboard();
  }
}

// ═══════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════

function buildSidebar() {
  const nav = [
    { page: 'dashboard',  icon: '⊞', label: 'Dashboard' },
    { page: 'baselines',  icon: '🏦', label: 'Baselines' },
    { page: 'events',     icon: '📅', label: 'Events' },
    { page: 'event-sets', icon: '🗂', label: 'Event Sets' },
    { page: 'analysis',   icon: '📈', label: 'Analysis' },
    { page: 'settings',   icon: '⚙',  label: 'Settings' },
  ];
  const activeNav = SIDEBAR_MAP[state.page] ?? state.page;

  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-logo">
      <span>Fin<span class="logo-dim">Tom</span></span>
      <button class="help-btn" onclick="showHelpModal()" title="Help &amp; Documentation">?</button>
    </div>
    <nav class="sidebar-nav">
      ${nav.map(({ page, icon, label }) => `
        <a class="nav-item${activeNav === page ? ' active' : ''}" data-page="${page}" onclick="navigate('${page}')">
          <span class="nav-icon">${icon}</span>${label}
        </a>`).join('')}
    </nav>
    <div class="sidebar-footer">
      <button class="btn btn-secondary btn-sm btn-full" onclick="exportData()">Export Data</button>
      <button class="btn btn-secondary btn-sm btn-full" onclick="triggerImport()">Import Data</button>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  buildSidebar();
  navigate('dashboard');
});
