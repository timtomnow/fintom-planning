# FinTom — Household Financial Planning

## How to Run

1. Open `index.html` in any modern web browser (Chrome, Firefox, Safari, Edge)
2. An internet connection is required (Chart.js and help rendering are loaded from CDN)
3. No installation, coding environment, or build step needed

---

## Data Storage

Your data is saved automatically in the browser's **local storage** after every change. If you clear browser data, your FinTom data will be lost.

**Back up regularly:**
- Go to **Settings → Export All Data (JSON)** and save the file somewhere safe
- To restore: **Settings → Import Data (JSON)**
- To move to another device: export on the old device → copy the `.json` file → import on the new device

---

## Features

### Baselines

A baseline is a snapshot of your net worth at a specific date. It contains a list of assets and liabilities. You can create multiple baselines, duplicate them, and use any one as the starting point for an analysis run.

**Tip:** Duplicate your current baseline to model "what if" scenarios — e.g., selling a house, changing jobs, paying off a loan early.

---

### Assets

Each asset has a name, category, and current value, plus a growth model:

| Mode | When to use | Parameters |
|---|---|---|
| **Non-investment** | Home, car, savings account | Monthly growth rate % (e.g. 0.33% ≈ 4%/yr) |
| **Investment** | Brokerage, 401k, IRA | Annual mean return % + annual std deviation % |

- Mark assets as **Liquid** if they can be sold or spent quickly. Liquid assets feed into the *Liquid Net Worth* calculation.
- Investment mode enables Monte Carlo — each simulation samples the monthly return from a normal distribution defined by mean and std deviation.

---

### Liabilities

Each liability has a name, category, current balance, and annual interest rate.

**Amortisation (for mortgages and instalment loans):**
- Enable the **Amortising loan** toggle and enter the full monthly payment
- Each month the engine automatically splits the payment into principal and interest, reduces the balance, and deducts the payment from cash flow (or from a Payment Source Asset — see below)
- **Do NOT** also create an expense event for the same payment — that double-counts it

**Include in Liquid NW:**
- Checked by default. Uncheck for liabilities tied to illiquid assets (e.g., a mortgage on a home you wouldn't liquidate to pay it off). Unchecked liabilities are excluded from the Liquid Net Worth calculation.

**Payment Source Asset** *(amortising loans only — optional):*
- Select which asset account the monthly payment comes from (e.g., your mortgage is paid from your Checking Account)
- When set, the payment deducts from that asset's balance each month instead of the general cash flow pool
- Net worth effect is identical either way — this controls how individual account balances track

---

### Events

Events model all recurring and one-time cash flows.

| Type | Description |
|---|---|
| **Income** | Taxable inflows (salary, rental income, consulting). The analysis tax rate is applied. |
| **Expense** | Recurring costs (groceries, utilities, subscriptions). |
| **One-time Inflow** | Single cash inflow (inheritance, asset sale, bonus). |
| **One-time Outflow** | Single cash outflow (car purchase, home renovation, large expense). |

**Options:**
- **Recurring** — runs every month between start and end date (leave end blank for indefinite)
- **Adjust for inflation** — amount grows at the configured inflation rate each month
- **Std Dev ($)** — add variability for Monte Carlo (e.g., a bonus that might be $5k–$15k)

**Transfer to Asset** *(expense / outflow only — optional):*
- Links the outflow to a specific asset. The cash flow decreases by the amount AND the named asset's value increases by the same amount.
- **Net worth change = $0** — this is a transfer, not a real expense (you're moving money from cash into an asset)
- **Example:** A $1,000/month savings deposit into your Investment account. Without this link, the $1,000 reduces net worth. With the link, cash decreases by $1,000 and the investment increases by $1,000 — net worth is unchanged, which correctly models a savings contribution.
- Transfers appear in their own column in the Results table and are excluded from the Expenses and Cash Flow columns.
- The asset name must match an asset in the baseline being analysed (matched by name)

---

### Event Sets

Event sets are named collections of events that you can attach to a specific analysis configuration. They let you layer scenario-specific events on top of your global events without creating duplicates.

**Example uses:**
- A "Job Change 2028" set with a new income event and a one-time relocation outflow
- An "Optimistic" set with a higher bonus amount alongside a "Pessimistic" set with lower income

Each analysis configuration can have a **Primary Event Set** and a **Compare Event Set**. The forecast merges global events with the selected set's events for that run.

**Note:** Deleting an event automatically removes it from any event sets that reference it.

---

### Analysis Configurations

Each configuration stores the settings for one forecast run:

| Setting | Description |
|---|---|
| **Primary Baseline** | Starting point for the forecast |
| **Compare Baseline** | Optional second baseline shown as a second line on the chart |
| **Primary Event Set** | Optional set of events merged with global events for the primary forecast |
| **Compare Event Set** | Optional set of events merged with global events for the compare forecast |
| **Period** | Start and end month for the forecast |
| **Inflation Rate** | Annual % — grows inflation-adjusted event amounts |
| **Tax Rate** | Household effective rate — applied to all income events |
| **Monte Carlo** | Enables probability simulation (see below) |
| **Standard of Living** | Monthly spending target for the 4% SWR sustainability line |

**Monte Carlo simulation:**
- Runs N simulations, each sampling investment returns from Normal(mean, stddev) for each investment asset
- Also samples variable event amounts if a Std Dev is set on the event
- Displays 10th / 25th / 50th / 75th / 90th percentile bands on the chart
- 500–1000 simulations is a good balance of accuracy and speed

---

### Results

Toggle between **Monthly** and **Yearly** view. Export the full table to **CSV**.

**Charts:**
- **Net Worth Over Time** — single line (deterministic), or percentile bands (Monte Carlo). Compare baseline shown in green. Sustainability target shown in orange.
- **Cumulative Cash Flow** — running sum of Income minus Expenses (transfers excluded) since the forecast start

**Detail table columns:**

| Column | Description |
|---|---|
| Start NW | Net worth at the start of the period (before growth, payments, events) |
| + Income | After-tax income and one-time inflows received during the period |
| − Expenses | Expenses, one-time outflows, and loan payments during the period (transfers excluded) |
| → Transfers | NW-neutral transfers to assets (expense/outflow events with Transfer to Asset set) |
| = Cash Flow | Income minus Expenses for the period (transfers not counted) |
| Cum. Cash Flow | Running cumulative sum of Cash Flow from the start of the forecast |
| Δ NW | Change in net worth — includes asset appreciation, not just cash flows |
| End NW | Net worth at the end of the period |
| Liquid NW | End NW using only liquid assets and selected liabilities |
| Assets | Total asset value at end of period |
| Liabilities | Total liability balance at end of period |

> **Note on Δ NW vs Cash Flow:** Cash Flow ≠ Δ NW. The difference is asset appreciation (investment growth, property appreciation) which increases net worth without appearing in the cash flow columns.

---

## How the Forecast Works

Each month the engine:

1. **Grows each asset** — non-investment: `value × (1 + monthlyRate/100)` — investment: `value × (1 + annualReturn/12/100)` where the return is the mean (deterministic) or a sampled value (Monte Carlo)
2. **Amortises liabilities** — for each amortising loan, splits the payment into principal and interest, reduces the balance, and deducts the payment from the payment source asset (or cash flow if none set)
3. **Applies events** — income after tax adds to cash flow; expenses and outflows subtract; outflows with a Transfer to Asset add the amount to that asset's value and count as a transfer (not an expense)
4. **Computes net worth** — `Total Assets + Cumulative Cash Flow − Total Liabilities`

**Liquid Net Worth** uses only liquid assets and only liabilities with "Include in Liquid NW" enabled.

**Sustainability target** uses the 4% safe withdrawal rule: if your net worth exceeds `monthly spend × 12 × 25`, your investments could theoretically sustain that spending indefinitely from returns alone.

---

## Tips

- For a mortgage: add it as a **liability with amortisation**. Do not add a separate expense event for the payment.
- Set the **Payment Source Asset** on your mortgage to track your checking account balance accurately.
- For savings contributions: use **Transfer to Asset** on an expense event so your investment account grows from deposits while net worth stays unchanged (it's just moving money).
- For variable income (bonuses, freelance): add a **Std Dev** to the event so Monte Carlo reflects the uncertainty.
- Run Monte Carlo with **500+ simulations** for reliable percentile bands.
- Use the **sustainability target line** to see when your portfolio could sustain your lifestyle indefinitely.
- **Duplicate a baseline** to model scenarios side-by-side — compare them using the "Compare Baseline" setting in an analysis configuration.
- Use **Event Sets** to model scenario-specific events (e.g. a job change, an inheritance) without cluttering your global event list.
