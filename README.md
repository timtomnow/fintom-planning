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
| **Investment** | Investment accounts, ETFs, stocks | Annual mean return % + annual std deviation % |

- Mark assets as **Liquid** if they can be sold or spent quickly. Liquid assets feed into the *Liquid Net Worth* calculation.
- Investment mode enables Monte Carlo — each simulation samples the monthly return from a normal distribution defined by mean and std deviation.

---

### Liabilities

Each liability has a name, category, current balance, and annual interest rate.

**Amortisation (for mortgages and instalment loans):**
- Enable the **Amortising loan** toggle
- Each month the engine automatically splits the payment into principal and interest, reduces the balance, and deducts the payment from cash flow (or from a Payment Source Asset — see below)
- **Do NOT** also create an expense event for the same payment — that double-counts it

**Payment Mode** *(choose how the monthly payment is determined):*
- **Calculated** — the payment is derived automatically each month from the remaining balance, rate, amortization period, and payment frequency. Requires an Amortization End Date.
- **Set payment** — you specify the exact monthly payment amount. The engine still correctly splits it into principal and interest each month, so the balance amortizes accurately. Use this when you know your actual payment (e.g., `$2,800`) and want the forecast to match.

**Mortgage fields** *(optional — for true mortgage amortization):*
- **Amortization End Date** *(Calculated mode)* — the month/year when the loan is fully paid off (e.g. `2050-01`). Required for Calculated mode.
- **Payment Frequency** *(Calculated mode)* — how often payments are made: Monthly, Semi-Monthly (2×/month), or Bi-Weekly (26×/year). Bi-Weekly results in slightly faster payoff than monthly due to the extra annual payment.
- **Term Start Date** *(Calculated mode, optional)* — when the current mortgage term started (e.g. `2025-01`). If set, the amortization period for the payment formula is fixed as the span from this date to the Amortization End Date. This gives a stable payment that closely matches what was agreed at term origination, rather than a payment that drifts down as the balance decreases. After the Term End Date, the period reverts to remaining months so the renewed payment is realistic.
- **Term End Date** — when the current interest rate term expires and the mortgage renews (e.g. `2030-01`). After this date the engine automatically switches to the Renewal Rate.
- **Rate at Renewal** — the assumed annual interest rate applied after the term end date.

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

**Deposit into Asset** *(income / inflow only — optional):*
- Routes the after-tax amount directly into a specific asset's balance instead of the general cash pool.
- **Example:** Paycheck auto-invested into your brokerage — the account balance grows and cash flow is unchanged.
- If the named asset doesn't exist in the baseline, a virtual asset starting at $0 is created automatically.

**Pay from Asset** *(expense / outflow only — optional):*
- Deducts the expense from a specific asset's balance instead of the cash pool.
- **Example:** A monthly bill paid from your Checking Account — the checking balance decreases, not the general cash accumulator.
- Net worth effect is the same either way; this setting controls how individual account balances track over time.

**Transfer to Asset** *(expense / outflow only — optional):*
- Links the outflow to a specific asset. The source (cash or Pay From Asset) decreases AND the named asset's value increases by the same amount.
- **Net worth change = $0** — this is a transfer, not a real expense (you're moving money between accounts).
- **Example:** A $1,000/month savings contribution. Cash decreases by $1,000 and the investment account increases by $1,000 — net worth is unchanged.
- Transfers appear in their own column in the Results table and are excluded from the Expenses and Cash Flow columns.

**Extra Payment to Liability** *(expense / outflow only — optional):*
- Also reduces the named liability's principal balance by the payment amount (in addition to the regular amortisation schedule).
- **Net worth change = $0** — you're converting cash into reduced debt.
- **Example:** A one-time $10,000 extra mortgage payment. Counted as a transfer, not an expense.
- All link fields are matched by name against the baseline being analysed. Unmatched names are silently ignored and treated as a regular expense.

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

Toggle between **Monthly** and **Yearly** view. Use **Re-Run** to re-run the analysis with any override changes applied. Export the full table to **CSV**.

**Charts:**
- **Net Worth Over Time** — single line (deterministic), or percentile bands (Monte Carlo). Compare baseline shown in green. Sustainability target shown in orange.
- **Cumulative Cash Flow** — running sum of Income minus Expenses (transfers excluded) since the forecast start

**Detail table columns:**

| Column | Description |
|---|---|
| Start NW | Net worth at the start of the period (before growth, payments, events) |
| + Income | After-tax income and one-time inflows received during the period |
| − Expenses | Expenses, one-time outflows, and loan payments during the period (transfers excluded) |
| → Transfers | NW-neutral transfers — savings contributions, asset purchases, extra loan payments |
| = Cash Flow | Income minus Expenses for the period (transfers not counted) |
| Cum. Cash Flow | Running cumulative sum of Cash Flow from the start of the forecast |
| Δ NW | Change in net worth — includes asset appreciation, not just cash flows |
| End NW | Net worth at the end of the period |
| Liquid NW | End NW using only liquid assets and selected liabilities |
| Assets | Total asset value at end of period |
| Liabilities | Total liability balance at end of period |

> **Note on Δ NW vs Cash Flow:** Cash Flow ≠ Δ NW. The difference is asset appreciation (investment growth, property appreciation) which increases net worth without appearing in the cash flow columns.

**Expandable period rows:**

Every row in the detail table is clickable. Click any row to expand it and see which events were active in that period, along with their amounts and cash-flow impact (+income, −expense, 0 for transfers). You can **Edit** any event directly from the expanded view — edits are saved to this analysis only and do not affect the global Events page. You can also **+ Add Event** to any period.

After editing, a warning banner appears at the top of the page indicating the results are out of date. Click **Re-run now** or the **Re-Run** button in the header to refresh.

**Baseline Values Over Time table:**

Below the detail table, a second table shows every asset, liability, and the accumulated cash flow with four columns: **Start**, **At Month** (interactive), **Change**, and **End**. Use the dropdown to pick any month in the forecast period — the "At Month" column updates instantly to show what each account balance or loan balance looks like at that point. Assets created by "Deposit into Asset" events that don't exist in the baseline are shown as **Asset (new)** rows starting from $0.

**All Analysis Events table:**

At the bottom of the Results page, a full list of all events used in the analysis is shown. It is paginated (25 rows per page) and can be filtered by event name (text search), category, and type using the filter controls above the table. Click **Export CSV** to download the full filtered list.

---

## How the Forecast Works

Each month the engine:

1. **Grows each asset** — non-investment: `value × (1 + monthlyRate/100)` — investment: `value × (1 + annualReturn/12/100)` where the return is the mean (deterministic) or a sampled value (Monte Carlo)
2. **Amortises liabilities** — for each amortising loan, determines the effective rate (switches to renewal rate after term end date), determines the payment based on the Payment Mode: *Calculated* derives the payment from remaining balance, rate, and amortization period (using Term Start Date for a stable period if set); *Set* uses the fixed amount you specified. In both modes the payment is split correctly into principal and interest, the balance is reduced, and the payment is deducted from the payment source asset (or cash flow if none set)
3. **Applies events** — income after tax goes into the "Deposit into Asset" account if set, otherwise the cash pool; expenses deduct from the "Pay from Asset" account if set, otherwise the cash pool; outflows with "Transfer to Asset" or "Extra Payment to Liability" are NW-neutral and counted as transfers
4. **Computes net worth** — `Total Assets + Cumulative Cash Flow − Total Liabilities`

**Liquid Net Worth** uses only liquid assets and only liabilities with "Include in Liquid NW" enabled.

**Sustainability target** uses the 4% safe withdrawal rule: if your net worth exceeds `monthly spend × 12 × 25`, your investments could theoretically sustain that spending indefinitely from returns alone.

---

## Tips

- For a mortgage: add it as a **liability with amortisation**. Choose **Calculated** payment mode and set the Amortization End Date, Term End Date, and Rate at Renewal to model term renewals automatically. If you know your exact payment amount (e.g., agreed at last renewal), use **Set payment** mode instead — the engine will still amortize correctly. Do not add a separate expense event for the payment.
- Use **Term Start Date** (Calculated mode) to lock in a stable payment that reflects what was calculated when your term began, rather than having the payment drift down each month.
- Set the **Payment Source Asset** on your mortgage to track your chequing account balance accurately.
- For savings contributions: use **Transfer to Asset** on an expense event so your investment account grows from deposits while net worth stays unchanged (it's just moving money).
- For a paycheck deposited into a brokerage: use **Deposit into Asset** on an income event so the account balance tracks correctly.
- For a bill paid from a specific account: use **Pay from Asset** on an expense event to track that account's balance declining over time.
- For extra mortgage/loan payments: use **Extra Payment to Liability** on a one-time outflow to model accelerated payoff. Combine with **Pay from Asset** to show exactly which account it comes from.
- Use the **Baseline Values Over Time** table in Results to see when specific assets or liabilities hit key milestones — pick any month with the dropdown.
- For variable income (bonuses, freelance): add a **Std Dev** to the event so Monte Carlo reflects the uncertainty.
- Run Monte Carlo with **500+ simulations** for reliable percentile bands.
- Use the **sustainability target line** to see when your portfolio could sustain your lifestyle indefinitely.
- **Duplicate a baseline** to model scenarios side-by-side — compare them using the "Compare Baseline" setting in an analysis configuration.
- Use **Event Sets** to model scenario-specific events (e.g. a job change, an inheritance) without cluttering your global event list.
