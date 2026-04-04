# FinTom — Codebase Guide for Claude

This is a self-contained, single-page financial planning app. No framework, no build step, no npm. Four files: `index.html`, `styles.css`, `app.js`, `README.md`. Runs by opening `index.html` in any browser. Chart.js and marked.js loaded from CDN (internet required). Data persisted to `localStorage`.

---

## File Map

| File | Purpose |
|---|---|
| `index.html` | Shell. Loads Chart.js CDN, marked.js CDN, `styles.css`, `app.js`. Contains `#app`, `#sidebar`, `#main`, `#modal-overlay`, `#toast-container`. Also embeds doc content in `script[type="text/x-markdown"]` tags (`#doc-readme`, `#doc-claude`) for the in-app help modal. |
| `styles.css` | Full design system. CSS variables in `:root`. No external dependencies. |
| `app.js` | Everything else — state, data, forecast engine, Monte Carlo, all page renders, charts, modals, routing, help modal. |
| `README.md` | End-user instructions (Markdown). |

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
  useAmortization,   // bool
  monthlyPayment,    // only relevant when useAmortization = true
  includeInLiquidNW, // bool (default true) — whether to subtract this liability in liquidNetWorth
  paymentAssetName,  // string (optional) — name of asset to deduct payment from instead of cashFlow
}
```

**Important:** When `useAmortization` is true, the forecast engine deducts `monthlyPayment` from `cashFlow` each month (or from `paymentAssetName` asset if set) and reduces the liability balance by the principal portion. The user should NOT also create an expense event for the same payment — that would double-count it.

`includeInLiquidNW` — when false, this liability is excluded from the `liquidNetWorth` calculation. Use for mortgages on illiquid property you would not sell to settle the debt.

`paymentAssetName` — matched by name against assets in the baseline being analysed. If the named asset is found, the payment reduces its `.value` instead of `cashFlow`. Net worth effect is identical either way.

### Event

```js
{
  id, name, notes,
  category,          // from EVENT_CATEGORIES constant
  type,              // 'income' | 'expense' | 'one_time_inflow' | 'one_time_outflow'
  amount,
  stdDevAmount,      // optional; used in Monte Carlo to sample variable amounts
  isRecurring,       // bool
  startDate,         // 'YYYY-MM'
  endDate,           // 'YYYY-MM' or '' (blank = indefinite for recurring)
  inflationAdjusted, // bool
  linkedAssetName,   // string (optional) — for expense/outflow: also adds amount to this asset
}
```

One-time events: `isRecurring = false`, active only in the month matching `startDate`. Types `one_time_inflow` / `one_time_outflow` are always treated as one-time regardless of `isRecurring`.

Income events have tax applied: `amount * (1 - taxRate/100)`.

`linkedAssetName` — only meaningful on `expense` and `one_time_outflow` types. When set and the named asset is found, the engine deducts the amount from `cashFlow` AND adds it to the asset's value (NW-neutral transfer). The amount counts as `transferThisMonth`, not `expenseThisMonth`. If the named asset is not found, the linkage is silently skipped and the amount counts as a normal expense.

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
}
```

---

## Forecast Engine

### `runSingleForecast(baselineId, config, returnSampler, amountSampler, events = null)`

Core engine. Deep-clones baseline assets/liabilities (never mutates `state.data`), builds a `Map<name, asset>` for fast lookup, then iterates month by month:

1. **Capture start NW** — `sum(assets) + cashFlow - sum(liabilities)` before any mutation (stored as `startNetWorth`).
2. **Grow assets** — non-investment: `value *= (1 + monthlyGrowthRate/100)`. Investment: `value *= (1 + annualReturn/12/100)` where `annualReturn` comes from `returnSampler(asset)` if provided (MC mode) or `asset.annualMeanReturn` (deterministic). Values clamped to ≥ 0.
3. **Amortise liabilities** — for each liability with `useAmortization`, compute monthly interest, reduce balance by principal, deduct payment from `paymentAssetName` asset's value (if set and found) or from `cashFlow`. Adds payment to `expenseThisMonth`.
4. **Apply events** — uses the `events` array if provided, otherwise falls back to `state.data.events`. `isEventActive(event, month)` gates each event. Inflation adjustment compounds from `config.startDate`. Income multiplied by `(1 - taxRate/100)`, added to both `cashFlow` and `incomeThisMonth`. Expenses deducted from `cashFlow`; if `linkedAssetName` resolves to an asset, the amount also adds to that asset's value and goes to `transferThisMonth` (not `expenseThisMonth`); if the asset is not found it falls back to `expenseThisMonth`. One-time inflows/outflows follow the same pattern.
5. **Compute net worth** — `netWorth = sum(assets) + cashFlow - sum(liabilities)`. `liquidNetWorth` uses only `isLiquid` assets minus only liabilities with `includeInLiquidNW === true`.

Returns an array of monthly result objects:
```js
{ month, netWorth, liquidNetWorth, assetTotal, liabTotal, cashFlow,
  startNetWorth, incomeThisMonth, expenseThisMonth, transferThisMonth }
```

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

`showHelpModal(tab)` — opens a wide modal (`modal-wide` class, 760px) with two tabs: **User Guide** and **Developer Guide**. Content is read from `script[type="text/x-markdown"]` elements in `index.html` (`#doc-readme` and `#doc-claude`) and rendered with `marked.parse()`. Falls back to `<pre>` display if marked is unavailable.

`switchHelpTab(tab)` — toggles visibility of `#help-readme` / `#help-claude` divs and updates `.active` class on the tab buttons.

`hideModal()` removes the `modal-wide` class in addition to closing the overlay, so normal modals are not affected.

The `?` button is rendered in the sidebar logo area via `buildSidebar()` — it's a `.help-btn` element positioned with flexbox on the `.sidebar-logo` div.

---

## Adding a New Page

1. Write a `renderFoo()` function returning an HTML string.
2. Add a `case 'foo':` in the `navigate()` switch.
3. Add a nav item to the `nav` array in `buildSidebar()` if it needs a sidebar entry.
4. If it's a sub-page of an existing section, add it to `SIDEBAR_MAP`.

## Adding a New Field to a Data Model

1. Add the field to the relevant `default*()` function so new records get it.
2. Update the modal form (add input, read it in `onSave`).
3. Update the forecast engine or display logic as needed.
4. Existing records without the field will get `undefined` — use `?? defaultValue` defensively in any code that reads it.

---

## Key Constants

```js
STORAGE_KEY = 'fp_v1'
ASSET_CATEGORIES      // array of strings
LIABILITY_CATEGORIES  // array of strings
EVENT_CATEGORIES      // array of strings
SIDEBAR_MAP           // { 'baseline-detail': 'baselines', 'event-set-detail': 'event-sets', 'results': 'analysis' }
```
