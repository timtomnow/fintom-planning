# FinTom — Codebase Guide for Claude

This is a self-contained, single-page financial planning app. No framework, no build step, no npm. Runs by opening `index.html` in any browser. Chart.js and marked.js loaded from CDN (internet required). Data persisted to `localStorage`.

---

## File Map

| File | Purpose |
|---|---|
| `index.html` | Shell. Loads Chart.js CDN, marked.js CDN, `styles.css`, and all JS files in order. Contains `#app`, `#sidebar`, `#main`, `#modal-overlay`, `#toast-container`. |
| `styles.css` | Full design system. CSS variables in `:root`. No external dependencies. |
| `js/utils.js` | Pure utility functions — uuid, date math, formatters (fmt$, fmtCompact, fmtPct), esc, deepClone, sampleNormal, pctValue, isEventActive. No state dependencies. |
| `js/data.js` | Constants (STORAGE_KEY, ASSET_CATEGORIES, etc., SIDEBAR_MAP), state object, default-record factories (defaultData, defaultAsset, etc.), storage (loadData, saveData, exportData, triggerImport). |
| `js/engine.js` | Forecast engine — runSingleForecast, runDeterministicForecast, runMonteCarloForecast, aggregateYearly, aggregateMCYearly. Reads state; no DOM. |
| `js/ui.js` | Shared UI infrastructure — chart helpers (destroyCharts, makeChart), modals (showModal, showConfirm, hideModal, showHelpModal, switchHelpTab), showToast, navigate, buildSidebar, DOMContentLoaded init. |
| `js/pages/dashboard.js` | renderDashboard. |
| `js/pages/baselines.js` | renderBaselines, renderBaselineDetail, openBaselineModal, duplicateBaseline, deleteBaseline, openAssetModal, toggleInvestFields, deleteAsset, openLiabilityModal, toggleAmortFields, onPayModeChange, deleteLiability. |
| `js/pages/events.js` | renderEvents, openEventModal, onEvTypeChange, onEvRecChange, deleteEvent, renderEventSets, renderEventSetDetail, openEventSetModal, openEventSetEventsModal, removeEventFromSet, deleteEventSet. |
| `js/pages/analysis.js` | renderAnalysis, openConfigModal, toggleMCFields, deleteConfig, resolveEventSets, resolveEffectiveEvents, getEventsForPeriod, runAndView. |
| `js/pages/results.js` | reRunAnalysis, markResultsStale, toggleEventDetail, openOverrideEventModal, onOevTypeChange, onOevRecChange, events-table state + functions (_evTableData, _cmpEvTableData, renderEventsTableSection, etc.), tab state (_resultsTab, _brSelectedItem, _brChart, _overviewScenario, _evTableScenario) + functions (switchResultsTab, switchOverviewScenario, switchEvTableScenario, renderBalanceReviewContent, attachBalanceReviewChart, onBrItemChange, renderBaselineValuesContent, renderAnalysisConfigContent), renderResults, attachResultsCharts, setViewMode, exportCSV, updateBaselineValuesAt, updateBaselineCmpValuesAt. |
| `js/pages/settings.js` | renderSettings, saveSettings, confirmClear. |
| `README.md` | End-user instructions (Markdown). |

### Script load order in index.html

```
js/utils.js → js/data.js → js/engine.js → js/ui.js →
js/pages/dashboard.js → js/pages/baselines.js → js/pages/events.js →
js/pages/analysis.js → js/pages/results.js → js/pages/settings.js
```

All files use global scope (no ES modules). Order enforces dependencies. `file://` compatible.

---

## Architecture

Single-page app with manual routing. No framework. Pages are rendered by functions that return HTML strings assigned to `document.getElementById('main').innerHTML`. Charts are Chart.js instances created after render and destroyed on navigation.

### State

```js
const state = {
  data: null,           // all persisted data, mirrors localStorage
  page: 'dashboard',
  params: {},           // current page params (e.g. { id: 'baseline-id' })
  activeCharts: [],     // Chart.js instances; destroyed on each navigate()
  lastRun: null,        // { detResults, cmpResults, mcResults } — NOT persisted
  lastRunConfig: null,  // the AnalysisConfig object that produced lastRun
};
```

`state.data` is loaded from `localStorage` on init and saved (`saveData()`) after every mutation.

`state.lastRun` / `state.lastRunConfig` are in-memory only. Navigating away from results and back requires re-running the analysis.

### Navigation

```js
navigate(page, params = {})
```

Destroys active charts, sets `state.page` / `state.params`, updates sidebar active class, calls the appropriate render function, sets `#main.innerHTML`. For `'results'`, also calls `attachResultsCharts()` via `requestAnimationFrame` after the DOM update.

Sub-pages that don't have their own sidebar item are mapped in `SIDEBAR_MAP`:
- `'baseline-detail'` highlights `'baselines'`
- `'event-set-detail'` highlights `'event-sets'`
- `'results'` highlights `'analysis'`

---

## Data Model

All data lives in `state.data` and is saved as a single JSON blob to `localStorage` under key `fp_v1`.

### Top-level shape

```js
{
  version: 1,
  baselines: Baseline[],
  events: Event[],
  eventSets: EventSet[],
  analysisConfigs: AnalysisConfig[],
  settings: { defaultInflationRate: 3, defaultTaxRate: 22 },
}
```

Older saves without `eventSets` are migrated on load: `state.data.eventSets = state.data.eventSets ?? []`.

### Baseline

```js
{
  id, name, description, date,   // date is 'YYYY-MM'
  createdAt,
  assets: Asset[],
  liabilities: Liability[],
}
```

### Asset

```js
{
  id, name, value,
  category,          // from ASSET_CATEGORIES constant
  isInvestment,      // bool — drives which growth model is used
  isLiquid,          // bool — affects liquidNetWorth calculation
  // if !isInvestment:
  monthlyGrowthRate, // % per month (e.g. 0.33 ≈ 4%/yr)
  // if isInvestment (used in Monte Carlo):
  annualMeanReturn,  // % (e.g. 7)
  annualStdDev,      // % (e.g. 15)
}
```

### Liability

```js
{
  id, name, value,   // value = current outstanding balance
  category,
  annualInterestRate,
  useAmortization,      // bool
  monthlyPayment,       // fixed payment used when paymentMode = 'set'
  includeInLiquidNW,    // bool (default true) — whether to subtract this liability in liquidNetWorth
  paymentAssetName,     // string (optional) — name of asset to deduct payment from instead of cashFlow
  // Mortgage-specific fields (all optional)
  paymentMode,          // 'calculated' | 'set' — how the monthly payment is determined (default 'calculated')
  paymentFrequency,     // 'monthly' | 'semi-monthly' | 'bi-weekly' (default 'monthly'; calculated mode only)
  amortizationEndDate,  // 'YYYY-MM' — when the loan is fully paid off (required for calculated mode)
  termStartDate,        // 'YYYY-MM' — when the current term started; fixes amortization period for payment calc
  termEndDate,          // 'YYYY-MM' — when the current mortgage term expires
  renewalRate,          // % annual — rate assumed after termEndDate
}
```

**Important:** When `useAmortization` is true, the forecast engine deducts a payment from `cashFlow` each month (or from `paymentAssetName` asset if set) and reduces the liability balance by the principal portion. The user should NOT also create an expense event for the same payment — that would double-count it.

**Payment modes** — controlled by `paymentMode`:
- `'calculated'` (default): payment is auto-derived each month from the standard amortization formula using the current balance, effective rate, `amortizationEndDate`, and `paymentFrequency`. Requires `amortizationEndDate`.
- `'set'`: the user specifies `monthlyPayment` as a fixed amount. The engine still correctly splits it into principal and interest each month — the balance reduces by `payment - interest`. This matches how a real mortgage payment works: fixed amount, changing split.

**Term start date** — when `termStartDate` is set in `'calculated'` mode, the payment is pre-computed **once** before the month loop from the initial balance and `monthsBetween(termStartDate, amortizationEndDate)` periods, then held constant for the entire term. Stored as `l._fixedPayment` on the deep-cloned liability object (never persisted). At term renewal (first month after `termEndDate`), the payment is recomputed once from the post-renewal balance and remaining amortization (`_renewalDone` flag prevents further recomputes). Liabilities without `termStartDate` continue to recalculate the payment each month.

**Term renewal** — when `termEndDate` is set and the current forecast month is past that date, the engine switches from `annualInterestRate` to `renewalRate`. In `'calculated'` mode the payment is recalculated using the renewal rate and remaining amortization from the current month.

**Payment frequency** — `paymentFrequency` controls how many payments occur per year (monthly = 12, semi-monthly = 24, bi-weekly = 26). The engine converts to a monthly-equivalent cash outflow using the per-period amortization formula. Bi-weekly produces slightly higher annual payments than monthly (26 vs 24 half-monthly equivalents), which reduces the amortization period. Only applies in `'calculated'` mode.

**Backward compatibility** — existing records without `paymentMode` default to `'calculated'` if `amortizationEndDate` is set, `'set'` otherwise. This matches pre-existing behaviour.

`includeInLiquidNW` — when false, this liability is excluded from the `liquidNetWorth` calculation. Use for mortgages on illiquid property you would not sell to settle the debt.

`paymentAssetName` — matched by name against assets in the baseline being analysed. If the named asset is found, the payment reduces its `.value` instead of `cashFlow`. Net worth effect is identical either way.

### Event

```js
{
  id, name, notes,
  category,             // from EVENT_CATEGORIES constant
  type,                 // 'income' | 'expense' | 'one_time_inflow' | 'one_time_outflow'
  amount,
  stdDevAmount,         // optional; used in Monte Carlo to sample variable amounts
  isRecurring,          // bool
  startDate,            // 'YYYY-MM'
  endDate,              // 'YYYY-MM' or '' (blank = indefinite for recurring)
  inflationAdjusted,    // bool
  depositToAssetName,   // string (optional) — income/inflow: route net amount into this asset
  payFromAssetName,     // string (optional) — expense/outflow: deduct from this asset instead of cashFlow
  linkedAssetName,      // string (optional) — expense/outflow: NW-neutral transfer into this asset
  linkedLiabilityName,  // string (optional) — expense/outflow: extra principal payment to this liability
}
```

One-time events: `isRecurring = false`, active only in the month matching `startDate`. Types `one_time_inflow` / `one_time_outflow` are always treated as one-time regardless of `isRecurring`.

Income events have tax applied: `amount * (1 - taxRate/100)`.

**Event linking fields (all matched by name, silently skipped if name not found):**

`depositToAssetName` — income and `one_time_inflow` only. When set, the after-tax amount is added to that asset's `.value` instead of `cashFlow`. Useful for routing a paycheck directly into a brokerage or savings account. Amount still counted in `incomeThisMonth`.

`payFromAssetName` — expense and `one_time_outflow` only. When set, the amount is deducted from that asset's `.value` (clamped to ≥ 0) instead of `cashFlow`. Net worth effect is identical either way — this controls how individual account balances track.

`linkedAssetName` — expense and `one_time_outflow` only. When set and found, the engine deducts the amount from `cashFlow` (or `payFromAssetName` asset if also set) AND adds the same amount to the linked asset's value. Net worth change = $0. Amount counted as `transferThisMonth`, not `expenseThisMonth`. If asset not found, falls back to `expenseThisMonth`.

`linkedLiabilityName` — expense and `one_time_outflow` only. When set and the named liability is found, the amount also reduces that liability's balance (extra principal payment). Net worth change = $0. Amount counted as `transferThisMonth`. If liability not found, falls back to `expenseThisMonth`. Use for one-time or recurring extra mortgage/loan payments.

### EventSet

```js
{
  id, name, description,
  eventIds: string[],  // IDs of Event records belonging to this set
}
```

Event sets are named collections of events attached to a specific analysis config. `resolveEventSets(ids)` takes an array of EventSet IDs and returns the merged flat array of Event objects (global events + all events referenced by the sets). When an event is deleted it is automatically removed from all sets that reference it.

### AnalysisConfig

```js
{
  id, name,
  scenarioTitle,         // optional display label for the primary scenario (falls back to baseline name)
  compareScenarioTitle,  // optional display label for the compare scenario (falls back to compare baseline name)
  baselineId,            // primary baseline (starting point)
  compareBaselineId,     // optional; second baseline for scenario comparison
  eventSetIds: [],       // EventSet IDs merged into the primary forecast
  compareEventSetIds: [], // EventSet IDs merged into the compare forecast
  startDate, endDate,    // 'YYYY-MM'
  viewMode,              // 'monthly' | 'yearly' — affects results display only
  inflationRate,         // %/yr
  taxRate,               // % on income events
  monteCarlo: {
    enabled,
    numSimulations,           // typically 500–1000
    standardOfLivingMonthly, // $/mo; shown as 25× annual target line on chart
  },
  eventOverrides: [],  // analysis-specific event edits/additions; do not affect global events
  resultsStale: false, // true when overrides changed but analysis not yet re-run
}
```

`eventOverrides` — array of full Event objects. Two kinds:
- **Regular overrides** (no `_sourceId`): replace the matching global event by ID, or are appended if the ID is new.
- **Monthly overrides** (have `_sourceId` and `_month`): scoped to a single occurrence of a recurring event. The original event is excluded for that month (via `_excludedMonths` in `resolveEffectiveEvents`), and the monthly override fires as a one-time event. ID format: `monthly-${sourceId}-${month}`. Created when the user edits a specific month's row in the All Analysis Events table.

Managed via the expandable-row edit UI in the Results page. Global events on the Events page are never touched.

`resultsStale` — set to `true` by `markResultsStale()` after any override change. Reset to `false` by `runAndView()`. When true, a warning banner is shown on the Results page with a re-run link.

---

## Forecast Engine

### `runSingleForecast(baselineId, config, returnSampler, amountSampler, events = null)`

Core engine. Deep-clones baseline assets/liabilities (never mutates `state.data`), builds `assetMap` and `liabMap` (`Map<name, object>`) for fast lookup, then iterates month by month:

1. **Capture start NW** — `sum(assets) + cashFlow - sum(liabilities)` before any mutation (stored as `startNetWorth`).
2. **Grow assets** — non-investment: `value *= (1 + monthlyGrowthRate/100)`. Investment: `value *= (1 + annualReturn/12/100)` where `annualReturn` comes from `returnSampler(asset)` if provided (MC mode) or `asset.annualMeanReturn` (deterministic). Values clamped to ≥ 0.
3. **Amortise liabilities** — for each liability with `useAmortization`, determine the effective rate (switches to `renewalRate` after `termEndDate` if set), compute monthly interest, calculate the monthly-equivalent payment (auto-calculated from `amortizationEndDate` + `paymentFrequency` if set, otherwise `monthlyPayment`), reduce balance by the principal portion, deduct payment from `paymentAssetName` asset's value (if set and found) or from `cashFlow`. Adds payment to `expenseThisMonth`. Auto-calculated payment uses the standard amortization formula: `perPeriodPayment = balance * ratePerPeriod / (1 - (1+ratePerPeriod)^(-periodsRemaining))`; monthly equivalent = `perPeriodPayment * freq / 12`.
4. **Apply events** — uses the `events` array if provided, otherwise falls back to `state.data.events`. `isEventActive(event, month)` gates each event. Inflation adjustment compounds from `config.startDate`. For each active event:
   - **Income / one_time_inflow**: after-tax amount goes to `depositToAssetName` asset's value if set, otherwise to `cashFlow`. Always adds to `incomeThisMonth`.
   - **Expense / one_time_outflow**: amount deducted from `payFromAssetName` asset's value if set, otherwise from `cashFlow`. Then: if `linkedLiabilityName` resolves to a liability, reduces its balance (`transferThisMonth`); else if `linkedAssetName` resolves to an asset, adds to its value (`transferThisMonth`); otherwise `expenseThisMonth`. Unresolved names fall through to `expenseThisMonth`.
5. **Compute net worth** — `netWorth = sum(assets) + cashFlow - sum(liabilities)`. `liquidNetWorth` uses only `isLiquid` assets minus only liabilities with `includeInLiquidNW === true`.

Before the month loop, the engine pre-creates virtual assets (value = 0, `_virtual: true`) for any `depositToAssetName` that doesn't exist in the baseline — so income can be routed to an asset that starts at $0.

Returns an array of monthly result objects:
```js
{ month, netWorth, liquidNetWorth, assetTotal, liabTotal, cashFlow,
  startNetWorth, incomeThisMonth, expenseThisMonth, transferThisMonth,
  assetSnapshots: [{ id, name, value }, ...],   // per-asset balances at end of month
  liabSnapshots:  [{ id, name, value }, ...] }  // per-liability balances at end of month
```

`assetSnapshots` and `liabSnapshots` power the **Baseline Values Over Time** table in the Results page — they let the UI show what any individual account/loan balance is at any selected month.

### `runDeterministicForecast(baselineId, config, events = null)`

Calls `runSingleForecast` with no samplers.

### `runMonteCarloForecast(baselineId, config, mcConfig, events = null)`

Runs `runSingleForecast` N times. Each simulation uses:
- `returnSampler`: draws `annualReturn` from `Normal(asset.annualMeanReturn, asset.annualStdDev)` using Box-Muller
- `amountSampler`: draws amount from `Normal(event.amount, event.stdDevAmount)` if stdDevAmount > 0

Collects net worth values per time step across all simulations, then computes p10/p25/p50/p75/p90 at each step. Returns:
```js
[{ month, p10, p25, p50, p75, p90 }, ...]
```

### Aggregation

`aggregateYearly(monthly)` reduces monthly arrays to one row per calendar year:
- **Balance-sheet fields** (`netWorth`, `liquidNetWorth`, `assetTotal`, `liabTotal`, `cashFlow`, `month`): last month of the year wins.
- **Flow fields** (`incomeThisMonth`, `expenseThisMonth`, `transferThisMonth`): **summed** across all months in the year.
- `startNetWorth`: the **first** month of the year's value (captured at init of each year key).

`aggregateMCYearly(monthly)` uses the same last-wins logic for percentile fields. It does not handle flow fields (Monte Carlo only tracks net worth percentiles).

---

## Charts

All Chart.js instances are pushed to `state.activeCharts` and destroyed via `destroyCharts()` on every `navigate()` call.

`makeChart(canvasId, config)` is a thin wrapper that handles the push.

### Net Worth Chart (`chart-nw`)

- **Deterministic only**: single line, `fill: 'origin'` for area under curve.
- **Monte Carlo**: four band datasets (p90, p75, p25, p10) with `fill: '+1'` to fill between adjacent lines. p90→p75 and p25→p10 are lighter (`rgba(37,99,235,0.07)`); p75→p25 (IQR) is medium (`rgba(37,99,235,0.13)`). All band datasets have `borderWidth: 0` and empty `label: ''` so they're hidden from the legend (legend filter: `item.text.length > 0`).
- **Deterministic line shown alongside MC** as a dashed gray line.
- **Compare baseline** shown as a solid green line.
- **Standard of living target** shown as dashed orange at `standardOfLivingMonthly * 12 * 25` (25× annual = 4% SWR).

### Cash Flow Chart (`chart-cf`)

Simple line chart of the engine `cashFlow` accumulator over time, fill to origin.

---

## Results Page Features

### Tab Structure

The Results page uses five tabs managed by module-level state:

- `_resultsTab` — `'overview'` | `'events'` | `'balance-review'` | `'baseline-values'` | `'analysis-config'` (persists during the session; survives view-mode switches)
- `switchResultsTab(tab)` — toggles `display` on `#results-tab-overview`, `#results-tab-events`, `#results-tab-balance-review`, `#results-tab-baseline-values`, `#results-tab-analysis-config` divs and updates `.results-tab-btn.active`; calls `_refreshBalanceReview()` when switching to the balance-review tab

**Compare scenario state** (only active when `cfg.compareBaselineId` or `cfg.compareEventSetIds` is set):
- `_overviewScenario` — `'base'` | `'compare'`; controls which scenario's Monthly Detail and Baseline Values tables are shown in the Overview tab. Toggled by a **Tables showing:** toggle that appears below the charts. Switching calls `switchOverviewScenario(scenario)` which triggers a full `navigate('results')` re-render (needed to preserve expandable rows).
- `_evTableScenario` — `'base'` | `'compare'`; controls which scenario is shown in the Event Details tab. Toggled by a **Scenario:** toggle rendered inside `#ev-table-section`. Switching calls `switchEvTableScenario(scenario)` which calls `_refreshEvTable()` only.
- `_cmpEvTableData` — compare-scenario expanded events; built in `renderResults` immediately after `_evTableData` using `resolveEventSets(cfg.compareEventSetIds)` + compare baseline's liab snapshots. No overrides applied (overrides are primary-only). Read by `renderEventsTableSection` when `_evTableScenario === 'compare'` and by `renderBalanceReviewContent` for the compare breakdown table.

**Tab 1 — Overview:** summary stats, Net Worth chart, Cash Flow chart, optional scenario switcher, Monthly/Annual Detail table. When compare exists, the Detail table uses `ovDet`/`ovCmp`/`ovMc` locals (derived from `_overviewScenario`). Expandable detail rows are supported in both base and compare scenarios (monthly view only). For the base scenario, clicking a row calls `renderPeriodEvents(key)` (editable — includes Edit/Add buttons). For the compare scenario, clicking a row calls `renderCmpPeriodEvents(key)` — a read-only version using `cmpEffectiveEvents` and `run.cmpResults`, with no Edit/Add buttons. `numCols` (colspan for the expandable row) is computed after `showCmpOverview` is known: `12` when showing compare (no extra columns), `12 + (cmp?1:0) + (mc?3:0)` when showing base.

**Tab 2 — Event Details:** the `#ev-table-section` div containing `renderEventsTableSection()`. When compare exists, a scenario toggle is rendered inside the section (so it is refreshed by `_refreshEvTable()`). Compare events are read-only — no Edit buttons. `exportEventsCSV()` exports the currently-selected scenario's data.

**Tab 3 — Balance Review:** dropdown + balance chart (`chart-br`) + optional cumulative chart (`chart-br-2`) + breakdown table(s). When compare exists: each chart shows both scenarios as separate lines; two breakdown tables are stacked with scenario headings. See § Balance Review Tab below.

**Tab 4 — Baseline Values:** rendered by `renderBaselineValuesContent()` into `#baseline-values-section`. Shows per-account balances over the forecast horizon with an "At month:" dropdown to inspect values at any point in time. When no compare scenario: one card with section title "Baseline Values Over Time" using `run.detResults` + primary baseline. When compare exists: two stacked cards — base scenario first (titled with the baseline name or scenario title), compare scenario second — each with its own independent "At month:" dropdown (`#bv-month-select` / `#bv-cmp-month-select`) and tbody (`#bv-tbody` / `#bv-cmp-tbody`). `updateBaselineValuesAt()` drives the base table; `updateBaselineCmpValuesAt()` drives the compare table. Columns: Name · Type · Start · At [month] · Change (total) · End.

**Tab 5 — Analysis Config:** rendered inline by `renderAnalysisConfigContent()`. Shows a full audit of the run inputs:
- A configuration summary card (name, period, inflation, tax, MC settings, override count).
- A Primary Scenario card: scenario title (if set) + baseline name/date, assets table (name, category, value, growth model, liquidity), liabilities table (name, category, balance, rate, amortization), events table (all events resolved from `resolveEventSets(cfg.eventSetIds)`).
- A Compare Scenario card (when `hasCompare`): same structure for the compare scenario using `cfg.compareBaselineId` baseline and `resolveEventSets(cfg.compareEventSetIds)` events. Uses `cBl ?? pBl` so a same-baseline comparison still shows the correct baseline.

Scenario labels throughout the Results page use `cfg.scenarioTitle || pBl?.name || 'Base Scenario'` and `cfg.compareScenarioTitle || cBl?.name || 'Compare Scenario'` — computed as `pLabel`/`cLabel` locals in each function that needs them.

### Expandable Detail Rows

Only **Monthly view** rows are expandable. Each monthly row has a chevron (▶/▼) and is clickable. Clicking calls `toggleEventDetail(key)` which shows/hides a hidden `<tr id="evd-{key}">` containing a sub-table of events active in that month. Annual/Yearly view rows are plain (no chevron, no onclick, no detail row rendered).

- Each event row has an **Edit** button → `openOverrideEventModal(cfgId, ev.id, month)`
- An **+ Add Event to this period** button → `openOverrideEventModal(cfgId, null, month)`

In addition to user-defined events, `renderPeriodEvents(periodKey)` builds **loan payment entries** (`liabEntries`) for each amortizing liability in the primary baseline. These are derived from `run.detResults` liabSnapshots:
- `payment = (prevBalance − currBalance − extraPrincipal) + interest` — extra principal payments (events with `linkedLiabilityName === l.name`) are subtracted so they appear as separate rows.
- Rendered with a **neutral badge** ("Loan Payment"), the same column layout as event rows, and an **Edit** button.
- Edit passes the synthetic ID `liab-payment-${liabId}-${periodKey}` → `openOverrideEventModal` finds it in `_evTableData` and opens "Edit Analysis Event" pre-filled as an expense.
- `effectiveEvents` (the array passed to `getEventsForPeriod`) filters out `type === 'loan_payment'` entries so synthetic table entries are never double-processed.

`periodEvs` and `liabEntries` are merged into a single `combined` array and sorted before rendering. **Sort order:** type first (`PERIOD_TYPE_ORDER`: income=0, one_time_inflow=1, expense=2, loan_payment=3, one_time_outflow=4), then amount descending within each type. Sub-table columns: **Name · Category · Type · Amount · Edit** (no Cash Flow column).

`getEventsForPeriod(periodKey, viewMode, events, cfg)` computes the period event list with inflation-adjusted amounts and cash-flow signs.

**`calcCF` in `getEventsForPeriod`** — returns the actual impact on the `cashFlow` accumulator:
- Returns `0` for income/one_time_inflow with `depositToAssetName` set (money goes to asset, not cashFlow).
- Returns `0` for expense/one_time_outflow with `payFromAssetName` set (money comes from asset, not cashFlow).
- Returns `0` for expense/one_time_outflow that are transfers (`linkedAssetName` or `linkedLiabilityName`).
- Otherwise: income → `amount * (1 - taxRate/100)`, one_time_inflow → `amount`, expense/outflow → `-amount`.

### Override Event Modal

`openOverrideEventModal(cfgId, existingId, defaultMonth)` — opens a modal to edit or create an event scoped to a specific analysis config. Saves result to `cfg.eventOverrides`. After saving, calls `markResultsStale()` to show the stale warning banner. Does **not** touch `state.data.events`.

Event lookup order for `existingId`:
1. `cfg.eventOverrides` (analysis-specific overrides)
2. `state.data.events` (global events)
3. `_evTableData` (synthetic entries, e.g. loan payment rows)

When `existingId` resolves to a synthetic `loan_payment` entry in `_evTableData`, the entry is remapped to `type: 'expense', isRecurring: false, endDate: ''` before pre-populating the form, since `loan_payment` is not a user-editable type. The modal title shows "Edit Analysis Event" when any lookup succeeds, "Add Analysis Event" when `existingId` is null or unresolved.

When `existingId` is a per-month expansion of a recurring event (ID `monthly-${sourceId}-${month}`), `ev._sourceId` is set. In this case:
- The **Recurring** checkbox and **Adjust for inflation** row are hidden (`display:none`).
- The date field is `readonly` (locked to the specific month).
- On save, `isRecurring` and `inflationAdjusted` are forced to `false`, and `_sourceId`/`_month` are preserved so `resolveEffectiveEvents` can suppress the original event for that month.

`onOevTypeChange()` / `onOevRecChange()` — toggle visibility of conditional fields inside the override modal (same pattern as `onEvTypeChange` / `onEvRecChange`).

### Stale Warning Banner

`<div id="results-stale-banner">` — rendered in the Results page, hidden by default. Shown when `cfg.resultsStale` is true. `markResultsStale()` sets the flag, saves data, and reveals the banner via DOM. `reRunAnalysis()` calls `runAndView(cfg.id)`, which resets the flag before running.

### All Analysis Events Table

`renderEventsTableSection()` — renders the paginated, filterable, sortable events table at the bottom of the Results page into `<div id="ev-table-section">`. When a compare scenario exists, a scenario toggle is rendered at the top of the section (inside `#ev-table-section` so it refreshes with `_refreshEvTable()`). Module-level state:
- `_evTableData` — built in `renderResults`: recurring events from `resolveEffectiveEvents(cfg)` are expanded into per-month entries (one row per active month, with inflation pre-applied), one-time events are included once, and synthetic `loan_payment` entries are appended (one per month per amortizing liability). Each per-month recurring row has a synthetic ID `monthly-${ev.id}-${month}`, `_sourceId = ev.id`, `_month = month`, `isRecurring: false`, `inflationAdjusted: false`.
- `_cmpEvTableData` — same structure as `_evTableData` but for the compare scenario. Built from `resolveEventSets(cfg.compareEventSetIds)` (no overrides) + compare baseline liab snapshots. Populated immediately after `_evTableData` in `renderResults`; empty array when no compare scenario.
- `_evTablePage` — current page index (0-based)
- `_evTableCatFilter`, `_evTableTypeFilter` — `Set` of active filter values
- `_evTableNameFilter` — committed text search string (applied to the table)
- `_evTableNameInput` — pending text search string (typed but not yet committed; used to preserve input value on re-render without triggering a filter change)
- `_evTableSortAsc` — `true` = oldest first (default), `false` = newest first; toggled by `evTableToggleSort()`
- `EV_PAGE_SIZE = 25`

**Sorting** — after filtering, `filtered.slice().sort(...)` sorts by `startDate` string comparison. `_evTableSortAsc` flips the comparison direction. Sort order is shown as ▲/▼ in the Month column header. Clicking the header calls `evTableToggleSort()`, which flips the flag, resets page to 0, and calls `_refreshEvTable()`.

**Name search** — the search input (`#ev-name-input`) uses `oninput` to call `evTableNameInputChange(val)` which only updates `_evTableNameInput` (no re-render). The filter is committed (applied to `_evTableNameFilter`) when the user clicks the 🔍 button (`evTableNameCommit()`) or presses Enter in the input. This avoids a full table re-render on every keystroke. `evTableClearFilters()` resets both `_evTableNameFilter` and `_evTableNameInput`.

**Synthetic loan payment entries** — each has:
```js
{
  id: `liab-payment-${l.id}-${month}`,  // unique per liability per month
  name: l.name,
  category: l.category ?? 'Liability',
  type: 'loan_payment',                  // synthetic type; never persisted
  amount: payment,                       // computed from liabSnapshots delta + interest
  startDate: month,
  isRecurring: false,
  inflationAdjusted: false,
  _liabId: l.id,                         // used by calcRowCF to look up paymentAssetName
}
```
Payment = `(prevBalance − currBalance − extraPrincipal) + interest`. Extra principal payments (user events with `linkedLiabilityName === l.name` active that month) are pre-subtracted so they don't inflate the loan payment row. User events are captured in `userEvents = _evTableData.slice()` before the loop begins.

**Table columns**: Month · Name · Category · Type · Amount · Edit (no Cash Flow, no Start/End/Recurring/InflationAdj columns).

**Sort order:** primary sort by Month (toggled ▲/▼ via `_evTableSortAsc`); within a month, secondary sort by type (`TYPE_ORDER`: income=0, one_time_inflow=1, expense=2, loan_payment=3, one_time_outflow=4), then by amount descending.

**`calcRowCF(e)`** — mirrors the engine's actual cashFlow impact:
- `loan_payment`: `−amount` unless `l.paymentAssetName` is set (then `0`); liability found via `_liabId`.
- Other types: same rules as `calcCF` in `getEventsForPeriod` (transfers, asset routing → `0`).

**Edit button**: calls `openOverrideEventModal(cfg.id, e.id, e.startDate)` for all rows (base scenario only). Compare scenario rows have no Edit button (read-only).

Filter dropdowns use `.ev-filter-dropdown` (absolute-positioned, `z-index:50`). `toggleEvFilterDD(id)` shows one and hides others. `_refreshEvTable()` re-renders just the `#ev-table-section` innerHTML without navigating.

`typeLabel` and `badgeClass` in both `renderResults` and `renderEventsTableSection` map `'loan_payment'` → `'Loan Payment'` / `'neutral'` badge.

`exportEventsCSV()` exports either `_evTableData` or `_cmpEvTableData` depending on `_evTableScenario`.

### Balance Review Tab

`renderBalanceReviewContent()` — builds the dropdown, breakdown table(s), and chart canvases for the Balance Review tab. Uses `_evTableData` and (when compare exists) `_cmpEvTableData` to derive per-month event impacts without re-running the engine.

**Dropdown options** (built from primary baseline; shared between both scenarios when compare exists):
1. `''` → Accumulated Cash Flow (default)
2. `'asset:<name>'` → each asset in the primary baseline
3. `'asset:<name>'` → virtual assets (created by depositToAssetName events not in baseline)
4. `'liab:<name>'` → each liability in the primary baseline

`_brSelectedItem` stores the current dropdown value. `onBrItemChange(val)` updates it and calls `_refreshBalanceReview()`.

**When compare scenario exists:**
- The breakdown logic is extracted into `buildRows(results, blObj, evData)` and `buildTableHtml(rows)` local functions so it can be called for both scenarios.
- Two tables are rendered stacked: base scenario first (with the primary baseline name as heading), then compare scenario.
- Both charts (`chart-br` and `chart-br-2`) plot both scenarios as separate lines — base in blue, compare in green — with a legend shown.

**Breakdown columns by item type:**

| Type | Columns |
|---|---|
| Cash Flow | Starting Balance · + Inflows (income after tax + inflows routed to cashFlow, not to assets) · − Outflows (expenses + loan payments that come from cashFlow) · Net Change · Ending Balance |
| Asset | Starting Balance · Growth / Loss (net change minus events impact) · Events (deposits via depositToAssetName, withdrawals via payFromAssetName, transfers via linkedAssetName, loan payments via paymentAssetName) · Net Change · Ending Balance |
| Liability | Starting Balance · Interest (prevBalance × effectiveRate / 12 / 100) · Principal Paid (startBal − endBal, clamped ≥ 0) · Net Change · Ending Balance |

Starting/ending balances come directly from `assetSnapshots` / `liabSnapshots` / `r.cashFlow` on the monthly results — no recalculation needed.

**Chart 1 (`chart-br`):** `attachBalanceReviewChart()` creates a Chart.js line chart showing the selected item's balance over time. Pushed to `_brChart` and `state.activeCharts`. When compare exists it adds a second dataset (green, no fill). Legend is shown only when compare exists.

**Chart 2 (`chart-br-2`):** `attachBalanceReviewChart2()` creates a cumulative chart shown only for assets and liabilities (not for Cash Flow). For liabilities it plots cumulative total interest paid; for assets it plots cumulative total growth/loss. Uses module-level `_brBaseRows` / `_brCmpRows` (computed by `buildRows` inside `renderBalanceReviewContent` and stored before returning) so it doesn't need to recompute event impacts. Same color scheme as chart 1 (blue/green for compare). Pushed to `_brChart2` and `state.activeCharts`.

`_brChart = null`, `_brChart2 = null`, `_brBaseRows = null`, `_brCmpRows = null` are reset at the top of `renderResults` (after `destroyCharts()` has already destroyed them) to prevent double-destroy on the next render.

`attachResultsCharts()` calls both `attachBalanceReviewChart()` and `attachBalanceReviewChart2()` when `_resultsTab === 'balance-review'`.

---

## UI Patterns

### Modals

`showModal(title, bodyHtml, onSave, saveLabel)` — injects HTML into `#modal`, adds class `open` to `#modal-overlay`. `onSave` must return `true` to close, `false` to keep open (for validation).

`showConfirm(title, msg, onConfirm, confirmLabel)` — destructive action variant.

`hideModal()` — removes `open` class and `modal-wide` class. Also triggered by clicking the overlay backdrop.

All modal form fields use plain DOM reads (`document.getElementById(...).value`) inside the `onSave` callback.

### Toasts

`showToast(msg, type)` — type is `''` (dark), `'success'` (green), or `'error'` (red). Auto-removes after 3.2s.

### HTML Escaping

`esc(str)` escapes `& < > "` in all user-supplied strings interpolated into HTML templates. Use it everywhere names, descriptions, or notes appear in template literals.

### Date Format

All dates stored as `'YYYY-MM'` strings. `monthLabel('2026-04')` → `'Apr 2026'` for display. `addMonths(yyyymm, n)` for arithmetic. `monthsBetween(start, end)` returns integer month count.

### Help Modal

`showHelpModal(tab)` — async. Opens a wide modal (`modal-wide` class, 760px) with two tabs: **User Guide** and **Developer Guide**. Fetches `./README.md` and `./CLAUDE.md` via `fetch()` and renders them with `marked.parse()`. Shows a loading placeholder while fetching; shows an error message if fetch fails (e.g. opened as `file://`). Falls back to `<pre>` display if marked is unavailable.

`switchHelpTab(tab)` — toggles visibility of `#help-readme` / `#help-claude` divs and updates `.active` class on the tab buttons.

`hideModal()` removes the `modal-wide` class in addition to closing the overlay, so normal modals are not affected.

The `?` button is rendered in the sidebar logo area via `buildSidebar()` — it's a `.help-btn` element positioned with flexbox on the `.sidebar-logo` div.

---

## Adding a New Page

1. Write a `renderFoo()` function returning an HTML string — put it in a new `js/pages/foo.js` or add it to the most related existing page file.
2. Add a `case 'foo':` in the `navigate()` switch in `js/ui.js`.
3. Add a nav item to the `nav` array in `buildSidebar()` in `js/ui.js` if it needs a sidebar entry.
4. If it's a sub-page of an existing section, add it to `SIDEBAR_MAP` in `js/data.js`.
5. If a new file was created, add a `<script src="js/pages/foo.js"></script>` tag to `index.html` (before `js/ui.js` is not needed, but after `js/ui.js` is fine — pages depend on ui, not the reverse).

## Adding a New Field to a Data Model

1. Add the field to the relevant `default*()` function so new records get it.
2. Update the modal form (add input, read it in `onSave`).
3. Update the forecast engine or display logic as needed.
4. Existing records without the field will get `undefined` — use `?? defaultValue` defensively in any code that reads it.

---

## Sample Data

The `sample_data/` directory contains three importable JSON files for demo and onboarding:

| File | Description |
|---|---|
| `01-simple.json` | Single baseline, 5 events, one analysis config — good for a quick smoke test |
| `02-moderate.json` | Two baselines (car / no car), 7 events, one event set, comparison + Monte Carlo configs |
| `03-complex.json` | One baseline with full mortgage amortization, 14 events, one event set, two analysis configs |
| `04-mortgagepaydown.json` | One baseline ($500k mortgage, 5.5%/5yr term, 25yr amort), 24 events, two event sets, two comparison configs: base vs annual $10K lump-sum prepayments, and base vs $50K lump sum + $500/mo extra |

These files conform to the `state.data` shape (`version`, `baselines`, `events`, `eventSets`, `analysisConfigs`, `settings`). They are loaded via **Settings → Import Data (JSON)** — importing replaces the current `localStorage` state.

---

## Key Constants

```js
STORAGE_KEY = 'fp_v1'
ASSET_CATEGORIES      // array of strings
LIABILITY_CATEGORIES  // array of strings
EVENT_CATEGORIES      // array of strings
SIDEBAR_MAP           // { 'baseline-detail': 'baselines', 'event-set-detail': 'event-sets', 'results': 'analysis' }
```

---

## Syntax Check Policy

After every edit to any JS file, visually verify the changed region before considering the task done. There is no build step, so a syntax error produces a blank page with no helpful output.

Common pitfalls in this codebase:
- Block-body arrow functions inside template literals (`.map(x => { ... return \`...\`; })`) require a closing `}` before the `)` — easy to drop when building multi-line returns.
- Unmatched backticks or braces inside nested template literals.
- Switching from expression-body (`.map(x => \`...\``) to block-body (`.map(x => { ... })`) without adding both `return` and the closing `}`.

---

## Documentation Policy

When making any change to app functionality, the data model, UI patterns, or architecture, update **both** documentation files:

1. **`README.md`** — user-facing. Update any section affected by the change (features, how the forecast works, tips, column descriptions, etc.).
2. **`CLAUDE.md`** — developer-facing. Update the relevant data model, engine, chart, or UI pattern section to reflect the new behaviour.

`README.md` and `CLAUDE.md` are the single source of truth. The in-app help modal fetches them directly via `fetch()` — there is no embedded copy in `index.html` to update.
