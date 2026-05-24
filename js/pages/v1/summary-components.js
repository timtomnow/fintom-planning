'use strict';

// ═══════════════════════════════════════════════════════════════
// v1 SUMMARY COMPONENTS
// ═══════════════════════════════════════════════════════════════
//
// Reusable building blocks for workflow summary pages. Each component
// is a plain object describing what to render. A workflow's summary
// step emits an array of these; the runtime renders them in order.
//
// Component shapes:
//
//   { type: 'narrative', html: 'string' }
//       A paragraph of text. `html` is rendered as-is, so callers
//       must esc() any user-supplied content first.
//
//   { type: 'kpi-grid', items: [{ label, value, sublabel? }, ...] }
//       A row of stat cards. Wraps to multiple lines on narrow widths.
//
//   { type: 'chart', id: 'unique-id', title?: 'string',
//     config: { /* Chart.js config */ }, height?: 300 }
//       A titled chart. id must be globally unique within the page.
//       config is passed straight to Chart.js; attached via
//       requestAnimationFrame after DOM insert.
//
//   { type: 'data-section', title: 'string', rows: [{ label, value }, ...] }
//       A list of label/value pairs grouped under a heading.
//       Useful for "Scenario inputs", "Records used", etc.
//
// Same component list is consumed by both screen render and PDF
// report generation (via window.print), so anything you add here
// works in both places for free.

// ═══════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════

function renderSummaryComponents(components) {
  if (!Array.isArray(components)) return '';
  return components.map(renderSummaryComponent).join('');
}

function renderSummaryComponent(c) {
  if (!c || !c.type) return '';
  switch (c.type) {
    case 'narrative':    return renderSC_Narrative(c);
    case 'kpi-grid':     return renderSC_KpiGrid(c);
    case 'chart':        return renderSC_Chart(c);
    case 'data-section': return renderSC_DataSection(c);
    default:
      return `<div class="v1-summary-component v1-summary-unknown">Unknown component: ${esc(c.type)}</div>`;
  }
}

function renderSC_Narrative(c) {
  return `<div class="v1-summary-component v1-summary-narrative">${c.html ?? ''}</div>`;
}

function renderSC_KpiGrid(c) {
  const items = c.items ?? [];
  return `
    <div class="v1-summary-component v1-summary-kpi-grid">
      ${items.map(it => `
        <div class="v1-kpi-card">
          <div class="v1-kpi-label">${esc(it.label ?? '')}</div>
          <div class="v1-kpi-value">${esc(it.value ?? '')}</div>
          ${it.sublabel ? `<div class="v1-kpi-sublabel">${esc(it.sublabel)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderSC_Chart(c) {
  const height = c.height ?? 300;
  return `
    <div class="v1-summary-component v1-summary-chart">
      ${c.title ? `<h3 class="v1-summary-chart-title">${esc(c.title)}</h3>` : ''}
      <div class="v1-summary-chart-canvas-wrap" style="height:${Number(height)}px">
        <canvas id="${esc(c.id)}"></canvas>
      </div>
    </div>
  `;
}

function renderSC_DataSection(c) {
  const rows = c.rows ?? [];
  return `
    <div class="v1-summary-component v1-summary-data-section">
      ${c.title ? `<h3 class="v1-summary-data-title">${esc(c.title)}</h3>` : ''}
      <dl class="v1-summary-data-list">
        ${rows.map(r => `
          <div class="v1-summary-data-row">
            <dt>${esc(r.label ?? '')}</dt>
            <dd>${esc(r.value ?? '')}</dd>
          </div>
        `).join('')}
      </dl>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// CHART ATTACH — instantiate Chart.js after DOM insert
// ═══════════════════════════════════════════════════════════════

function attachSummaryCharts(components) {
  if (!Array.isArray(components)) return;
  for (const c of components) {
    if (c?.type === 'chart' && c.config && c.id) {
      makeChart(c.id, c.config);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// REPORT (placeholder) — uses window.print for now.
// The browser's "Save as PDF" produces an actual PDF file.
// Future iterations can swap this for jsPDF without changing the
// component API.
// ═══════════════════════════════════════════════════════════════

function generateSummaryReport() {
  // The summary content is already rendered inside .v1-summary-zone.
  // Print-mode CSS hides everything else and removes workflow chrome.
  document.body.classList.add('v1-print-mode');

  const cleanup = () => {
    document.body.classList.remove('v1-print-mode');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  // Defer one frame so the class takes effect before print is invoked.
  requestAnimationFrame(() => {
    try {
      window.print();
    } catch (e) {
      cleanup();
      showToast('Could not open the print dialog', 'error');
    }
  });
}
