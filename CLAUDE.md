# FinTom — Codebase Guide for Claude

This is a self-contained, single-page financial planning app. No framework, no build step, no npm. Runs by opening `index.html` in any browser. Chart.js and marked.js are vendored in `js/vendor/` — no internet required for core functionality. Data persisted to `localStorage`.

---

## File Map

| File | Purpose |
|---|---|
| `index.html` | Shell. Loads `js/vendor/chart.umd.min.js`, `js/vendor/marked.min.js`, `styles.css`, and all JS files in order. Contains `#app`, `#sidebar`, `#main`, `#modal-overlay`, `#toast-container`. |
| `styles.css` | Full design system. CSS variables in `:root`. No external dependencies. |
| `js/utils.js` | Pure utility functions — uuid, date math, formatters (fmt$, fmtCompact, fmtPct), esc, deepClone, sampleNormal, pctValue, isEventActive. No state dependencies. |
| `js/data.js` | Constants (STORAGE_KEY, ASSET_CATEGORIES, etc., SIDEBAR_MAP, BOTTOM_NAV_MAP), state object, default-record factories (defaultData, defaultAsset, etc.), storage (loadData, saveData, exportData, triggerImport). |
| `js/engine.js` | Forecast engine — runSingleForecast, runDeterministicForecast, runMonteCarloForecast, aggregateYearly, aggregateMCYearly. Reads state; no DOM. |
| `js/ui.js` | Shared UI infrastructure — chart helpers (destroyCharts, makeChart), modals (showModal, showConfirm, hideModal, showHelpModal, switchHelpTab), showToast, navigate, buildSidebar, DOMContentLoaded init. |
| `js/pages/dashboard.js` | renderDashboard. |
| `js/pages/baselines.js` | renderBaselines, renderBaselineDetail, openBaselineModal, duplicateBaseline, deleteBaseline, openAssetModal, toggleInvestFields, deleteAsset, openLiabilityModal, toggleAmortFields, onPayModeChange, deleteLiability. |
| `js/pages/events.js` | renderEvents, openEventModal, onEvTypeChange, onEvRecChange, deleteEvent, renderEventSets, renderEventSetDetail, openEventSetModal, openEventSetEventsModal, removeEventFromSet, deleteEventSet. |
| `js/pages/inputs.js` | renderInputs. Mobile navigation hub — three tap-to-navigate cards linking to Baselines, Events, and Event Sets. Shown via the mobile bottom nav Inputs tab; not in the desktop sidebar. |
| `js/pages/analysis.js` | renderAnalysis, openConfigModal, toggleMCFields, deleteConfig, resolveEventSets, resolveEffectiveEvents, getEventsForPeriod, runAndView. |
| `js/pages/results.js` | reRunAnalysis, markResultsStale, toggleEventDetail, openOverrideEventModal, onOevTypeChange, onOevRecChange, events-table state + functions (_evTableData, _cmpEvTableData, renderEventsTableSection, etc.), tab state (_resultsTab, _brSelectedItem, _brChart, _overviewScenario, _evTableScenario) + functions (switchResultsTab, switchOverviewScenario, switchEvTableScenario, renderBalanceReviewContent, attachBalanceReviewChart, onBrItemChange, renderBaselineValuesContent, renderAnalysisConfigContent), renderResults, attachResultsCharts, setViewMode, exportCSV, updateBaselineValuesAt, updateBaselineCmpValuesAt. |
| `js/pages/settings.js` | renderSettings, saveSettings, confirmClear. |
| `js/pages/v1/shell.js` | renderV1Shell — sticky topbar + actionbar chrome wrapped around every workflow step body. |
| `js/pages/v1/summary-components.js` | renderSummaryComponents, renderSC_* (per component type incl. `data-table`), attachSummaryCharts, generateSummaryReport. Reusable summary primitives shared across workflows. |
| `js/pages/v1/v1-samples.js` | Shared sample-scenario registry. `V1_SAMPLES`, `registerV1Sample`, `getV1SampleDefinition`, `listV1Samples`. Currently hosts the `family-mortgage` sample. Workflows consume samples by id; the sample's `generate(ctx)` returns `{ baseline, events, eventSet }` and the workflow attaches its own analysis config. |
| `js/pages/v1/v1-questionnaires.js` | Shared questionnaire registry. `V1_QUESTIONNAIRES`, `registerV1Questionnaire`, `getV1QuestionnaireDefinition`. Currently hosts `household-v1`. Owns topics, per-topic renders/captures/defaults, and `generate(answers, ctx)` → `{ baseline, events, eventSet }`. Workflows consume by id, own only the step keys + the analysis config, and call into `renders[topic]` / `captures[topic]` from their step lifecycle. |
| `js/pages/v1/workflows.js` | V1_WORKFLOWS registry, registerV1Workflow, getV1WorkflowInstance/Definition, lifecycle (startV1Workflow, resumeV1Workflow, advanceV1Workflow, goBackV1Workflow, exitV1Workflow, discardV1Workflow, deleteV1WorkflowRecord, rollbackProducedRecords), renderV1Workflow. Also registers the `demo-2step` admin workflow. |
| `js/pages/v1/workflow-quickstart-family.js` | `quickstart-family` workflow ("20-year basic outlook"). Branches across `sample`/`scratch`/`questionnaire` paths, consumes the shared `family-mortgage` sample and the `household-v1` questionnaire, attaches a 20-year analysis config, runs forecast, builds a 20-year-focused summary. `qsf*` prefix on helpers is historical. |
| `js/pages/v1/workflow-12month-plan.js` | `twelve-month-plan` workflow ("12-month plan"). Same path-branching surface as the 20-year workflow (also consumes the shared sample + questionnaire), but generates a 12-month analysis config and renders a Review step with (1) an inline **assumptions** block (inflation, tax, Monte Carlo toggle + sim count) wired to onchange handlers that mutate the analysis config, and (2) a **per-month events editor** that renders one section per month listing every event firing that month with an editable amount — saving creates a monthly override in `cfg.eventOverrides` (`monthly-${sourceId}-${month}` id). Summary is framed around the next 12 months and includes a per-month appendix table (Starting NW, Income, Expenses, Transfers, Net Cash Flow, Δ NW, Ending NW + totals row). `t12*` prefix on helpers. |
| `js/pages/v1/get-started.js` | renderV1GetStarted, listV1Workflows, renderWorkflowCard, renderResumeCard, renderEmptyStateCards. |
| `js/pages/v1/history.js` | renderV1History, renderHistoryCard. |
| `README.md` | End-user instructions (Markdown). |

### Script load order in index.html

```
js/utils.js → js/data.js → js/engine.js → js/ui.js →
js/pages/dashboard.js → js/pages/baselines.js → js/pages/events.js →
js/pages/inputs.js → js/pages/analysis.js → js/pages/results.js → js/pages/settings.js →
js/pages/v1/shell.js → js/pages/v1/summary-components.js →
js/pages/v1/v1-samples.js → js/pages/v1/v1-questionnaires.js →
js/pages/v1/workflows.js →
js/pages/v1/workflow-quickstart-family.js → js/pages/v1/workflow-12month-plan.js →
js/pages/v1/get-started.js → js/pages/v1/history.js
```

`v1-samples.js` and `v1-questionnaires.js` are pure registries — they self-register their definitions at load time and expose `getV1*Definition(id)` lookups. They must load before any workflow file that consumes them. Workflow files load in any order relative to each other since they each independently call `registerV1Workflow(...)`.

All files use global scope (no ES modules). Order enforces dependencies. `file://` compatible.

The v1 platform files depend on legacy ones (engine, ui, baselines/events modals reused for Review-step editing), so they load after the legacy pages. Within the v1 group, `workflows.js` defines the registry, then individual workflow files load and self-register, then `get-started.js` consumes the registry.

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

`state.lastRun` / `state.lastRunConfig` are in-memory only. Navigating away from results and back requires re-running the analysis. Workflow Summary steps that depend on these (e.g. the quick-start family workflow) detect a missing cached run on render and re-execute the forecast automatically — see § v1 Workflow Platform.

### Navigation

```js
navigate(page, params = {})
```

Destroys active charts, sets `state.page` / `state.params`, updates sidebar active class, calls the appropriate render function, sets `#main.innerHTML`. For `'results'`, also calls `attachResultsCharts()` via `requestAnimationFrame` after the DOM update.

Sub-pages that don't have their own sidebar item are mapped in `SIDEBAR_MAP`:
- `'baseline-detail'` highlights `'baselines'`
- `'event-set-detail'` highlights `'event-sets'`
- `'results'` highlights `'analysis'`

Any page key starting with `'v1-'` toggles `document.body.classList` to include `v1-mode`, which hides the desktop sidebar, the mobile bottom nav, and the legacy chrome via CSS in `styles.css`. The default landing page on init is `V1_LANDING_PAGE` (= `'v1-get-started'`). The legacy pages are still fully accessible via the v1 surface's "Open advanced view" Admin card and via Edit buttons on individual records (which open legacy modals inside the v1 chrome — see § v1 Workflow Platform → Modal reuse).

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
  workflows: Workflow[],  // v1 workflow platform — see § v1 Workflow Platform
}
```

Older saves are migrated on load:
- `state.data.eventSets = state.data.eventSets ?? []` (predates event sets)
- `state.data.workflows = state.data.workflows ?? []` (predates the v1 workflow platform)

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

Steps 1 is always executed. Steps 2–4 are gated by `month >= baseline.date` — for months before the baseline date, the forecast holds at the initial snapshot values (flat net worth, zero income/expenses). This allows comparisons between baselines with different start dates: a "future" baseline simply contributes no activity until its date arrives.

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
- `_evTableData` — built in `renderResults`: recurring events from `resolveEffectiveEvents(cfg)` are expanded into per-month entries (one row per active month, with inflation pre-applied), one-time events are included once, and synthetic `loan_payment` entries are appended (one per month per amortizing liability). Each per-month recurring row has a synthetic ID `monthly-${ev.id}-${month}`, `_sourceId = ev.id`, `_month = month`, `isRecurring: false`, `inflationAdjusted: false`. Events are suppressed for months before `pBl.date` (mirrors the engine's baseline-date gating). The effective floor is `max(cfg.startDate, pBl.date)`.
- `_cmpEvTableData` — same structure as `_evTableData` but for the compare scenario. Built from `resolveEventSets(cfg.compareEventSetIds)` (no overrides) + compare baseline liab snapshots. Populated immediately after `_evTableData` in `renderResults`; empty array when no compare scenario. Events are likewise suppressed before `cmpBl.date`.
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

## v1 Workflow Platform

A guided, task-oriented surface that sits alongside the legacy app and is the default landing experience for new users. Each workflow is a small state machine: an ordered set of steps where each step renders its own UI and decides where to advance next. Workflows can create records (baselines, events, event sets, analysis configs), run forecasts, and present results — all without leaving a consistent topbar / actionbar shell.

The legacy app is never hidden; it's reachable from the Admin section of Get Started and via Edit buttons inside the Review step (which open the existing legacy modals — see § Modal reuse below).

### Routing & body mode

Three page keys make up the v1 surface:

- `'v1-get-started'` — landing page (cards for available workflows, in-progress Resume list, Admin section). `V1_LANDING_PAGE` constant.
- `'v1-workflow'` — the step shell. Requires `state.params.workflowId`.
- `'v1-history'` — completed workflows.

`navigate()` toggles `document.body.classList` to include `v1-mode` whenever `state.page.startsWith('v1-')`. The `body.v1-mode` selector in `styles.css` hides `#sidebar` and `#bottom-nav` (display: none) and clears their reserved space so the v1 shell can take the full viewport.

### Workflow definition shape

A workflow is a plain object registered via `registerV1Workflow(def)`. Shape:

```js
{
  id:               string,                            // matches the registry key
  title:            string,
  description:      string,                            // one-line shown on cards
  icon:             string,                            // emoji
  estimatedTime:    string,                            // e.g. '5 min'
  category:         'main' | 'admin',                  // drives Get Started placement
  eligible:         (data) => boolean,                 // gates visibility on state.data
  initialStepKey:   string,
  initialDraft:     () => object,
  steps: {
    [stepKey]: {
      key:              string,
      title:            string,
      render:           (wf) => htmlString,
      onContinue:       (wf) => { ok: boolean, nextStepKey?: string, errors?: string[] },
      postRender:       (wf) => void,                  // optional; rAF after DOM insert
      previousStepKey:  string | null,
      continueLabel:    string,                        // optional
      backLabel:        string,                        // optional
    },
  },
}
```

`onContinue` return contract:
- `{ ok: true, nextStepKey: '<key>' }` — advance to that step.
- `{ ok: true, nextStepKey: 'complete' }` — mark workflow complete (`completedAt` set), navigate to landing.
- `{ ok: false, errors: [...] }` — show error toasts, stay on the step.
- Falsy (`undefined`, `{ ok: false }` with no errors) — silently no-op. Used by **async steps** that schedule their own `navigate()` call (e.g. the family workflow's `confirm-run` step kicks off a Monte Carlo run via `setTimeout`, then advances itself when results land).

`postRender(wf)` is called via `requestAnimationFrame` after the step's HTML is inserted. It's where Chart.js (or any DOM-dependent setup) is wired up. The runtime guards against late-firing callbacks by re-checking `currentStep === stepDef.key` before invoking.

### Workflow instance shape

Persisted under `state.data.workflows`. One entry per started workflow run:

```js
{
  id:                  uuid,
  type:                string,                // matches a registered workflow id
  currentStep:         string,                // the step key the user is on
  draftData:           object,                // workflow-defined scratch space (e.g. selections)
  startedAt:           ISO string,
  updatedAt:           ISO string,
  completedAt:         ISO string | null,
  producedRecordIds: {
    baselineIds:        string[],
    eventIds:           string[],
    eventSetIds:        string[],
    analysisConfigIds:  string[],
  },
}
```

`producedRecordIds` is the rollback ledger. Whenever a workflow generates a record in `state.data`, the ID is pushed here. `discardV1Workflow` reads this and removes those records (and cleans references from any event sets / analysis configs that point at them). `completedAt` being non-null means the workflow is done — it's hidden from the Resume list but appears in History.

Once `completedAt` is set, `advanceV1Workflow` preserves the original timestamp on subsequent finishes (e.g. user reopens from History and clicks Finish again).

### Lifecycle API

All exported from `js/pages/v1/workflows.js`:

| Function | What it does |
|---|---|
| `registerV1Workflow(def)` | Add a workflow definition to the registry. Called at module load by each workflow file. |
| `getV1WorkflowDefinition(type)` | Lookup by type (registry key). |
| `getV1WorkflowInstance(id)` | Find a persisted instance in `state.data.workflows`. |
| `startV1Workflow(type)` | Create a new instance with `initialDraft()`, `currentStep = initialStepKey`, push to `state.data.workflows`, `navigate('v1-workflow', { workflowId })`. |
| `resumeV1Workflow(id)` | Navigate to a workflow at its current step. Used by Resume cards AND by clickable History cards (completed workflows resume at their final step). |
| `advanceV1Workflow()` | Read `state.params.workflowId`, run the current step's `onContinue`, handle the return contract. |
| `goBackV1Workflow()` | Navigate to `previousStepKey` (null = no-op). |
| `exitV1Workflow()` | Navigate to landing without changing workflow state — the instance keeps `completedAt: null` and surfaces in Resume. |
| `discardV1Workflow(id)` | Confirm + rollback `producedRecordIds` + remove the instance. |
| `deleteV1WorkflowRecord(id)` | History-only "Remove" action — drops the instance but preserves the records it created. |
| `rollbackProducedRecords(wf)` | Internal helper; filters `state.data.{baselines,events,eventSets,analysisConfigs}` to drop the workflow's records and cleans cross-references. |
| `renderV1Workflow()` | The render entry called by `navigate()` for `'v1-workflow'`. Looks up wf + def + step, schedules `postRender` if defined, wraps `step.render(wf)` in `renderV1Shell(...)`. |

### Shell

`renderV1Shell({ definition, stepDef, stepIndex, totalSteps, bodyHtml })` from `js/pages/v1/shell.js` wraps every step body with:
- Sticky topbar — workflow title + "Step N of M" + Exit button.
- The step body (`v1-body`) — scrollable middle.
- Sticky actionbar — Back (if `previousStepKey`) + Continue (uses `stepDef.continueLabel` or 'Continue').

The shell has no knowledge of any specific workflow — it just renders the chrome. All page-specific markup comes from `stepDef.render(wf)`.

### Summary components

Workflows that need to show results render them as a **list of component descriptors**, not custom HTML per step. This guarantees the same content can be reused in the future "Generate Report" pipeline (currently `window.print`, future jsPDF) without each workflow re-implementing layout for both screen and print.

Component types (in `js/pages/v1/summary-components.js`):

| Type | Shape | Notes |
|---|---|---|
| `narrative`    | `{ type, html }` | Paragraph. `html` is rendered as-is — callers must `esc()` any user content. |
| `kpi-grid`     | `{ type, items: [{ label, value, sublabel? }] }` | Auto-fitting row of stat cards. |
| `chart`        | `{ type, id, title?, config, height? }` | `id` must be unique on the page; `config` is a Chart.js config passed straight to `makeChart`. |
| `data-section` | `{ type, title, rows: [{ label, value }] }` | Label/value list under a heading. Useful for "Scenario inputs", "Records used", etc. |
| `data-table`   | `{ type, title?, columns: string[], rows: cell[][], align?: ('left'\|'right'\|'center')[] }` | Multi-column tabular report. `align` is per-column (defaults to left for col 0, right for the rest). Cells are passed through `esc()`. Used for the 12-month workflow's per-month appendix. |

API:

| Function | What it does |
|---|---|
| `renderSummaryComponents(components)` | Returns HTML for an array of components. |
| `attachSummaryCharts(components)` | Iterates components and calls `makeChart(id, config)` for each `chart` component. Call via `postRender`. |
| `generateSummaryReport(title)` | Toggles `body.v1-print-mode`, sets `document.title` to `title` so it becomes the default PDF filename + print-dialog header, calls `window.print()`, restores both on `afterprint`. |

To add a new component type: add the case in `renderSummaryComponent`, an entry in this table, and a `.v1-summary-*` CSS block in `styles.css`. Print-mode behavior under `@media print` should be checked too — anything with a background, border, or fixed height needs explicit print rules to render usably.

### Modal reuse (legacy edit from inside a workflow)

The Review step's Edit / Delete buttons call existing legacy functions directly (`openAssetModal`, `openLiabilityModal`, `openEventModal`, `deleteAsset`, `deleteLiability`, `deleteEvent`). The save / delete handlers in `baselines.js` and `events.js` end with:

```js
if (state.page.startsWith('v1-')) navigate(state.page, state.params);
else navigate('baseline-detail', { id: baselineId }); // or 'events', etc.
```

So when the same modal is opened from a v1 workflow, the post-save navigation re-renders the workflow page instead of jumping to the legacy detail page. No modal duplication; the existing UI (with its full validation, asset routing fields, mortgage amortization fields, etc.) just works inside the workflow surface.

### Print mode (Generate Report)

A summary step that calls `generateSummaryReport(title)` triggers a temporary CSS state via `body.v1-print-mode` + `@media print` rules in `styles.css`:
- Workflow topbar, actionbar, summary CTA row, sidebar, bottom nav, modal overlay, and toast container are hidden.
- The v1-shell becomes block-flow with no max-width.
- KPI cards, chart panels, and data sections get page-break-inside: avoid.
- Chart canvases are clamped to ~280px so they don't overflow a printed page.

The browser's print dialog handles the actual PDF generation via "Save as PDF" — no client-side PDF library is bundled. If we want richer / templated PDFs later, swap the implementation of `generateSummaryReport` for jsPDF; the workflow code (which just passes a `title`) stays unchanged.

### Shared sample and questionnaire registries

`v1-samples.js` and `v1-questionnaires.js` host workflow-agnostic generators so multiple workflows can share the same "Family with mortgage" sample and the same guided questionnaire. Both are id-keyed registries, which makes them versionable: when a sample or questionnaire's shape needs to change in a breaking way, register a new id (e.g. `family-mortgage-v2`, `household-v2`) instead of mutating the existing one. Workflows pin to a specific id via constants at the top of their file, so older completed runs and other workflows keep producing the expected records.

Sample API (`v1-samples.js`):

```js
registerV1Sample({
  id, label, description, icon,
  generate: (ctx) => ({ baseline, events, eventSet }),
});
// ctx = { startDate, takenBaselineNames, takenEventSetNames, namePrefix? }
```

Questionnaire API (`v1-questionnaires.js`):

```js
registerV1Questionnaire({
  id, version, label,
  topics: [{ key, label, desc }],
  recurringItems,                       // for the 'recurring' topic
  defaults: { [topicKey]: () => answer },
  captures: { [topicKey]: (prev) => answer },
  renders:  { [topicKey]: (wfId, draft) => htmlString },
  generate: (answers, ctx) => ({ baseline, events, eventSet }),
});
// ctx = { startDate, takenBaselineNames, takenEventSetNames,
//         namePrefix?, baselineDescription?, eventSetDescription? }
```

Both `generate(...)` calls are **pure** — they return records but do not push into `state.data`. The workflow that calls them is responsible for persisting the result and recording produced ids for rollback. This is what lets the workflow layer its own analysis config on top (12-month horizon, 20-year horizon, MC settings, etc.) without the sample/questionnaire having to know about it.

The `household-v1` questionnaire's per-topic renders rely on DOM ids prefixed `qassum-`, `qsav-`, `qhousing-`, `qrec-`, plus the css classes `.qsf-income-row`, `.qsf-onetime-row`, `.qsf-debt-row` for the multi-row capture helpers. Any future workflow that consumes `household-v1` will inherit those ids — they're internal to the questionnaire module and don't need workflow-specific prefixes.

### Adding a new workflow

1. Create `js/pages/v1/workflow-<name>.js`.
2. Pick a short helper prefix (e.g. `qsf` for quickstart-family, `t12` for the 12-month plan) to keep your module's globals isolated.
3. Decide whether to reuse the shared sample (`getV1SampleDefinition(id).generate(ctx)`) and/or the shared questionnaire (`getV1QuestionnaireDefinition(id)` + its `renders`/`captures`/`generate`), or to provide bespoke generation. Most workflows should reuse — it keeps the surface consistent.
4. Define a `commitRecords` helper that takes the `{ baseline, events, eventSet }` from the shared generator, pushes everything into `state.data`, records the ids in `wf.producedRecordIds.*` (for rollback), and attaches the workflow-specific analysis config.
5. Call `registerV1Workflow({ id, title, description, icon, estimatedTime, category, eligible, initialStepKey, initialDraft, getStepSequence?, steps: { … } })` at module load.
6. For branching workflows, implement `getStepSequence(wf)` to drive the topbar's "Step N of M" indicator and the `previousStepKey` lookups.
7. Use `uniqueName(base, takenList)` (in `js/utils.js`) when generating record names so re-running the workflow doesn't collide.
8. If a step renders a summary, build a component list with the primitives above and use `postRender: (wf) => attachSummaryCharts(buildComponents(wf))` to attach Chart.js instances.
9. Add a `<script src="js/pages/v1/workflow-<name>.js"></script>` tag to `index.html` between the existing workflow files and `get-started.js`.
10. Add the new file path to `CORE_ASSETS` in `sw.js` and bump `CACHE_VERSION` so installed PWA clients pick up the change.

### 20-year basic outlook (reference implementation)

`js/pages/v1/workflow-quickstart-family.js` registers `id: 'quickstart-family'` (the historical internal id; user-facing title is **"20-year basic outlook"**). It uses 3 branching paths off the `choose-path` step:

- **sample** → `choose-path` → `pick-sample` → `review` → `confirm-run` → `summary`. The sample is `family-mortgage` from `v1-samples.js` (5 assets + 1 amortizing mortgage with `paymentMode: 'calculated'`, `termStartDate`, `termEndDate`, `renewalRate`; 11 recurring events). On Continue from `pick-sample`, `qsfGenerateSampleRecords(wf)` calls `sample.generate(...)` then `qsfCommitRecords(...)` which attaches a 20-year analysis config (`viewMode: 'yearly'`, `monteCarlo.enabled: true`, 500 simulations). Idempotent: bails if records already exist on the workflow.
- **scratch** → `choose-path` → `review` → `confirm-run` → `summary`. `qsfGenerateScratchRecords(wf)` builds an empty baseline + empty event set + the same 20-year analysis config. User fills in records via the + Add buttons on Review.
- **questionnaire** → `choose-path` → `q-topics` → [N selected topic Qs] → `review` → `confirm-run` → `summary`. Steps `q-*` are rendered by thin proxies (`qsfRenderQAssumptions`, etc.) that call into `getV1QuestionnaireDefinition('household-v1').renders[topic](wfId, draft)`. On Continue, `qsfAdvanceQ(wf, currentKey, topicKey)` invokes the questionnaire's `captures[topic]` to read the DOM, stores the answer on `wf.draftData.q.<topic>`, then advances. On entry to `review`, `qsfGenerateQuestionnaireRecords(wf)` calls `qDef.generate(answers, ctx)` and commits with the inflation/tax rates from the assumptions topic.

The `review` step is shared across all three paths: scenario-name input at the top (writes to `cfg.name` on blur via `qsfRenameScenario`); Assets / Liabilities / Events sections with Edit + Delete using the legacy modals. `confirm-run` and `summary` are also shared.

`qsfRunForecastAndAdvance(wf, 'summary')` runs `runDeterministicForecast` synchronously, then schedules `runMonteCarloForecast` via `setTimeout` so the "Running N simulations…" toast paints first. The async callback caches results in `state.lastRun` / `state.lastRunConfig`, updates `wf.currentStep = 'summary'`, and navigates. The `onContinue` returns `{ ok: false }` so the runtime doesn't try to advance synchronously.

`summary` builds the component list via `qsfBuildSummaryComponents(wf)`: narrative paragraph, KPI grid (current NW, projected median NW at year 20, p10–p90 range, mortgage payoff month), 20-year Chart.js line chart (deterministic line + MC bands), data-section listing scenario inputs. CTAs: **Generate Report** (calls `qsfGenerateReport(wf.id)` which passes `cfg.name` as the PDF title), **Explore full analysis** (navigates to legacy results page with the cached run).

The summary step also handles a **stale-cache fallback**: if `state.lastRun` is missing or doesn't match the workflow's analysis config (e.g. user resumed from History after a browser refresh), the render returns a "Re-running analysis…" placeholder and schedules `qsfRunForecastAndAdvance(wf, null)` to repopulate the cache + re-render. This is what makes History entries clickable — they reopen at the summary step and the cache fills itself.

### 12-month plan workflow

`js/pages/v1/workflow-12month-plan.js` registers `id: 'twelve-month-plan'`. The branching surface (`choose-path` + `pick-sample` + `q-*`) is structurally identical to the 20-year workflow and consumes the same shared sample (`family-mortgage`) and questionnaire (`household-v1`) — see the `t12*` helpers and the `T12_QUESTIONNAIRE_ID` / `T12_SAMPLE_ID` constants. Two pieces are deliberately different:

**1. Review step (`t12RenderReview`)** — in addition to the standard scenario-name + Assets + Liabilities + Events sections, the page renders two extra blocks:

- **Assumptions block** (`t12RenderAssumptionsBlock`) — inline edits for `cfg.inflationRate`, `cfg.taxRate`, and `cfg.monteCarlo` (enabled toggle + numSimulations input). Each input wires `onchange` to a `t12Set*` handler that mutates the analysis config and saves. Toggling MC also shows/hides the sim-count input via direct DOM `style.display` (no rerender needed).
- **Per-month events editor** (`t12RenderMonthlyEventsBlock`) — for each of the next 12 months, expands to a section listing every event firing that month (via `resolveEffectiveEvents(cfg)` + `getEventsForPeriod(month, 'monthly', events, cfg)`, then `loan_payment` synthetic entries filtered out). Each row has the event name + a positive/negative type badge + an editable amount input. `onchange` calls `t12SaveMonthOverride(workflowId, sourceId, month, value)`, which creates / updates a record in `cfg.eventOverrides` keyed `monthly-${sourceId}-${month}` with `_sourceId` + `_month` (same schema the legacy Results page uses for per-month overrides). The parent recurring event is left untouched; `resolveEffectiveEvents` uses `_excludedMonths` to suppress the original for the overridden month. A "modified" pill + Reset button appear on overridden rows. Loan payments are intentionally not editable here — they're auto-derived from the liability's amortization schedule.

**2. Summary step (`t12BuildSummaryComponents`)** — the focus is the next 12 months rather than a long-horizon projection:

- KPI grid: Current NW, NW at month 12, Total income (12 mo), Total expenses (12 mo), Net cash flow.
- Chart: monthly net-worth line over 12 months (with MC bands if `cfg.monteCarlo.enabled`).
- Data section: scenario inputs (horizon, inflation, tax, MC, event count).
- **Appendix table** (`data-table` component): one row per month with **Starting NW · Income · Expenses · Transfers · Net Cash Flow · Δ NW · Ending NW**, plus a totals row at the bottom.

`t12RunForecastAndAdvance`, `t12HasFreshRun`, the stale-cache fallback in `t12RenderSummary`, and the `confirm-run` page are direct analogues of the `qsf*` versions. Defaults: `viewMode: 'monthly'`, `monteCarlo.enabled: false` (off by default since 12-month percentile fans are narrow), `monteCarlo.numSimulations: 200`.

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
BOTTOM_NAV_MAP        // maps any page → one of: dashboard | inputs | analysis | settings (mobile bottom nav active state)
V1_LANDING_PAGE       // 'v1-get-started' — default landing page on app init
V1_WORKFLOWS          // registry object — `registerV1Workflow(def)` populates it
```

---

## PWA & Responsive Design

### Breakpoints

| Range | Layout |
|---|---|
| ≥ 1024px | Desktop — full 224px sidebar (`--sidebar-w`), no bottom nav |
| 768px – 1023px | Tablet — icon-only sidebar rail (`--sidebar-w: 52px`), labels hidden via `font-size: 0`, footer hidden |
| ≤ 767px | Mobile — sidebar hidden, `#bottom-nav` shown as `display: flex` |

### Bottom Nav

`#bottom-nav` is a `<nav>` element in `index.html` (sibling of `#app`), populated by `buildSidebar()` in `js/ui.js` alongside the desktop sidebar. It contains 4 `.bottom-nav-item` elements (Dashboard, Inputs, Analysis, Settings). Active state is set in `navigate()` using `BOTTOM_NAV_MAP` from `js/data.js`, which maps every page to one of those 4 keys. Pages not in the map fall through to their own name via `BOTTOM_NAV_MAP[page] ?? page`.

On mobile, `#main` gets `padding-bottom: calc(60px + env(safe-area-inset-bottom))` so content is never hidden behind the bar. `#toast-container` is raised by the same amount.

### Service Worker

`sw.js` uses a cache-first strategy. `CORE_ASSETS` are pre-cached on install and must all resolve (404 will fail the SW install). `OPTIONAL_ASSETS` (the four icon files) are cached with individual `catch(() => {})` so a missing icon doesn't block installation.

**To pick up app file changes on installed clients:** bump `CACHE_VERSION` in `sw.js` (e.g. `fintom-v1` → `fintom-v2`). The `activate` handler deletes all caches whose key doesn't match the current version.

### Icons

Four PNG files in `icons/` are required for full PWA installability — see `icons/ICONS_NEEDED.md` for exact dimensions. Chrome will not show the install prompt until at least a 192×192 icon is present. The app runs fine without them; only installability is affected.

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
