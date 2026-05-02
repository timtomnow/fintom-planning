'use strict';

function renderInputs() {
  const blCount = state.data.baselines.length;
  const evCount = state.data.events.length;
  const esCount = state.data.eventSets.length;

  const sections = [
    {
      page: 'baselines',
      icon: '🏦',
      title: 'Baselines',
      desc: 'Starting financial snapshots — your assets and liabilities at a point in time.',
      count: `${blCount} baseline${blCount !== 1 ? 's' : ''}`,
    },
    {
      page: 'events',
      icon: '📅',
      title: 'Events',
      desc: 'Income, expenses, and one-time cash flows applied during a forecast.',
      count: `${evCount} event${evCount !== 1 ? 's' : ''}`,
    },
    {
      page: 'event-sets',
      icon: '🗂',
      title: 'Event Sets',
      desc: 'Named collections of events attached to specific analysis configurations.',
      count: `${esCount} event set${esCount !== 1 ? 's' : ''}`,
    },
  ];

  return `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">Inputs</div>
          <div class="page-subtitle">Your financial data — the building blocks for all forecasts.</div>
        </div>
      </div>
      <div class="inputs-hub">
        ${sections.map(s => `
          <div class="inputs-hub-card" onclick="navigate('${s.page}')">
            <span class="inputs-hub-icon">${s.icon}</span>
            <div class="inputs-hub-body">
              <div class="inputs-hub-title">${s.title}</div>
              <div class="inputs-hub-desc">${s.desc}</div>
              <div class="inputs-hub-count">${s.count}</div>
            </div>
            <span class="inputs-hub-arrow">›</span>
          </div>`).join('')}
      </div>
    </div>`;
}
