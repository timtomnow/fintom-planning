FinTom — Household Financial Planning App
==========================================

HOW TO RUN
----------
1. Unzip the folder anywhere on your computer
2. Open index.html in any modern web browser (Chrome, Firefox, Safari, Edge)
3. An internet connection is required to load the charting library (Chart.js via CDN)

That's it. No installation, no coding environment needed.


DATA STORAGE
------------
Your data is saved automatically in the browser's local storage each time
you make a change. If you clear browser data, your FinTom data will be lost.

IMPORTANT: Export your data regularly as a backup.
- Go to Settings → Export All Data (JSON)
- Keep this .json file somewhere safe
- To restore: Settings → Import Data (JSON)

To use on a different computer or browser:
  Export on the old device → copy the .json file → Import on the new device.


FEATURES
--------
Baselines
  A baseline is a snapshot of your net worth at a specific date.
  It contains a list of assets (with growth rates or investment parameters)
  and liabilities (with optional amortisation logic for loans).
  You can create multiple baselines, duplicate them, and use any as the
  starting point for an analysis run.

Assets
  - Non-investment assets (home, car, savings): use a monthly growth rate %
  - Investment assets (brokerage, 401k/IRA): use annual mean return % and
    standard deviation % for Monte Carlo simulation
  - Mark assets as liquid or illiquid to track liquid net worth separately

Liabilities
  - Enter the current balance and annual interest rate
  - Enable amortisation for mortgages and instalment loans: the monthly
    payment is automatically deducted from cash flow and the balance reduces
    by the principal portion each month
  - Do NOT also create an expense event for an amortising liability's payment

Events
  - Income: taxable inflows (salary, rental income, etc.)
  - Expense: recurring costs (groceries, utilities, subscriptions, etc.)
  - One-time Inflow/Outflow: car purchase, inheritance, bonus, etc.
  - Recurring events run every month between start and end date (blank end = indefinite)
  - Check "Adjust for inflation" to grow the amount at the configured rate
  - Add a standard deviation for variable income (used in Monte Carlo)

Analysis Configurations
  - Select a primary baseline as the starting point
  - Optionally select a second baseline to compare scenarios on the same chart
  - Set the forecast period (start and end month)
  - Configure inflation rate and household effective tax rate on income
  - Enable Monte Carlo simulation (recommended for investment-heavy portfolios):
      * Runs N simulations with randomised investment returns each month
      * Displays 10th/25th/50th/75th/90th percentile bands on the chart
      * Set a Standard of Living ($/month) to show a sustainability target line
        (based on the 4% safe withdrawal rule: target = monthly × 12 × 25)

Results
  - Toggle between monthly and yearly view
  - Export the full data table to CSV
  - Net Worth Over Time chart with Monte Carlo bands (if enabled)
  - Cumulative Cash Flow chart
  - Full data table with all columns


HOW THE FORECAST WORKS
-----------------------
Each month, the engine:
  1. Grows each asset by its growth rate (or samples from normal distribution for investments)
  2. Amortises liabilities with amortisation enabled, deducting payments from cash
  3. Applies all active events (income after tax, expenses, one-time items) to cumulative cash
  4. Computes: Net Worth = sum(assets) + cumulative cash flow - sum(liabilities)

Net worth starts at the baseline value and evolves from there. Positive cash
flow (earning more than you spend) accumulates and adds to net worth. Negative
cash flow subtracts from net worth.


TIPS
----
- Start with one baseline for today's date, then duplicate it to model
  "what if" scenarios (e.g., selling a house, changing jobs)
- For a mortgage: add it as a liability with amortisation. Do not also
  add a mortgage expense event.
- For variable income like bonuses, set a standard deviation on the event
  so Monte Carlo reflects the uncertainty
- Run Monte Carlo with 500+ simulations for reliable percentile bands
- Use the sustainability target line (standard of living setting) to see
  when your portfolio could sustain your lifestyle indefinitely
