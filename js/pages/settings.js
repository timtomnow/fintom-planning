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
