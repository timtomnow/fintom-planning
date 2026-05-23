'use strict';

// ═══════════════════════════════════════════════════════════════
// SETTINGS PAGE
// ═══════════════════════════════════════════════════════════════

function renderSettings() {
  const s = state.data.settings;
  return `<div class="page">
    <div class="page-header">
      <div><div class="page-title">Settings</div><div class="page-subtitle">Defaults and data management</div></div>
    </div>

    <div class="card">
      <div class="card-title">Default Values</div>
      <div class="form-row">
        <div class="form-group">
          <label>Default Inflation Rate (%/yr)</label>
          <input type="number" id="s-inf" value="${s.defaultInflationRate}" step="0.1" min="0">
          <div class="form-hint">Applied to new analysis configurations</div>
        </div>
        <div class="form-group">
          <label>Default Tax Rate (%) <span class="label-note">on income events</span></label>
          <input type="number" id="s-tax" value="${s.defaultTaxRate}" step="0.1" min="0" max="100">
          <div class="form-hint">Effective household rate — applied to all income events in analysis</div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="saveSettings()">Save Settings</button>
    </div>

    <div class="card mt-4">
      <div class="card-title">Data Management</div>
      <p class="text-muted" style="font-size:13px;margin-bottom:14px;">
        All data is saved automatically in your browser's local storage. Export regularly as a backup — clearing browser data will erase it.
      </p>
      <div class="flex gap-2 flex-wrap">
        <button class="btn btn-secondary" onclick="exportData()">Export All Data (JSON)</button>
        <button class="btn btn-secondary" onclick="triggerImport()">Import Data (JSON)</button>
        <button class="btn btn-danger" onclick="confirmClear()">Clear All Data</button>
      </div>
    </div>

    <div class="card mt-4">
      <div class="card-title">About</div>
      <div style="font-size:15px;font-weight:600;margin-bottom:6px">FinTom</div>
      <div class="form-hint" style="margin-bottom:14px">
        A self-contained financial planning app for modelling baselines, events, and Monte Carlo forecasts. Local-first — your data stays in your browser.
      </div>

      <div style="display:flex;flex-direction:column;gap:10px">
        <a href="https://github.com/timtomnow/fintom-planning/" target="_blank" rel="noopener noreferrer"
           style="display:inline-flex;align-items:center;gap:6px;color:var(--text);text-decoration:none;font-weight:500;font-size:13.5px;width:fit-content">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="flex-shrink:0">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          <span>github.com/timtomnow/fintom-planning</span>
        </a>
        <a href="https://timtomnow.github.io/app-portfolio/" target="_blank" rel="noopener noreferrer"
           style="color:var(--accent);text-decoration:none;font-weight:500;font-size:13.5px;width:fit-content">
          Check out my other apps on the portfolio site →
        </a>
      </div>
    </div>

    <div class="card mt-4">
      <div class="card-title">How the Forecast Works</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.7;">
        <p><strong style="color:var(--text);">Net Worth = Assets + Cumulative Cash Flow − Liabilities</strong></p>
        <p style="margin-top:8px;">Each month the engine: (1) grows each asset by its growth rate or sampled investment return, (2) amortises liabilities with enabled amortisation and deducts their payment from cash, (3) applies all active events (income after tax, expenses, one-time items) to cumulative cash, then (4) computes net worth.</p>
        <p style="margin-top:8px;"><strong style="color:var(--text);">Monte Carlo</strong> runs the forecast N times, sampling each investment asset's monthly return from a normal distribution defined by its mean and standard deviation. The resulting percentile bands show the range of likely outcomes.</p>
        <p style="margin-top:8px;"><strong style="color:var(--text);">Sustainability target</strong> uses the 4% safe withdrawal rule (25× annual spending). If your net worth exceeds this line, you could theoretically sustain that spending level indefinitely from investment returns.</p>
      </div>
    </div>
  </div>`;
}

function saveSettings() {
  state.data.settings.defaultInflationRate = parseFloat(document.getElementById('s-inf').value) || 3;
  state.data.settings.defaultTaxRate = parseFloat(document.getElementById('s-tax').value) || 22;
  saveData();
  showToast('Settings saved', 'success');
}

function confirmClear() {
  showConfirm(
    'Clear All Data',
    'This will permanently delete all baselines, events, and configurations. This cannot be undone.',
    () => {
      state.data = defaultData();
      state.lastRun = null;
      state.lastRunConfig = null;
      saveData();
      navigate('dashboard');
      showToast('All data cleared');
    },
    'Clear Everything'
  );
}
