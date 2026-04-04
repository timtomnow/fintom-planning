'use strict';

// ═══════════════════════════════════════════════════════════════
// FORECAST ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Run one simulation pass.
 * returnSampler(asset)  → annualReturn%  (null = use asset.annualMeanReturn)
 * amountSampler(event)  → amount         (null = use event.amount)
 * events                → event array to use (null = all global events)
 */
function runSingleForecast(baselineId, config, returnSampler = null, amountSampler = null, events = null) {
  const baseline = state.data.baselines.find(b => b.id === baselineId);
  if (!baseline) return [];

  const months = getMonthRange(config.startDate, config.endDate);
  const assets = deepClone(baseline.assets ?? []);
  const liabilities = deepClone(baseline.liabilities ?? []);
  let cashFlow = 0; // accumulated net cash since baseline date

  // Build name→asset/liability maps for event linking (references same objects as arrays)
  const assetMap = new Map(assets.map(a => [a.name, a]));
  const liabMap  = new Map(liabilities.map(l => [l.name, l]));

  // Pre-create any deposit-target assets that don't exist in the baseline (start at $0)
  const eventsToScan = events ?? state.data.events;
  for (const ev of eventsToScan) {
    if (ev.depositToAssetName && !assetMap.has(ev.depositToAssetName)) {
      const virtual = { id: `virtual-${ev.depositToAssetName}`, name: ev.depositToAssetName,
        value: 0, isInvestment: false, isLiquid: true, monthlyGrowthRate: 0, _virtual: true };
      assets.push(virtual);
      assetMap.set(ev.depositToAssetName, virtual);
    }
  }

  // Pre-compute fixed term payments for calculated-mode liabilities that have a termStartDate.
  // Payment is calculated once from the initial balance and the full term period, then held constant
  // until a term renewal occurs, at which point it is recomputed once from the post-renewal balance.
  const _freqMap = { 'monthly': 12, 'semi-monthly': 24, 'bi-weekly': 26 };
  for (const l of liabilities) {
    const pm = l.paymentMode ?? (l.amortizationEndDate ? 'calculated' : 'set');
    if (l.useAmortization && pm === 'calculated' && l.amortizationEndDate && l.termStartDate) {
      const freq = _freqMap[l.paymentFrequency ?? 'monthly'] ?? 12;
      const periodsTotal = Math.max(1, Math.round(monthsBetween(l.termStartDate, l.amortizationEndDate) * freq / 12));
      const initRate = l.annualInterestRate ?? 0;
      const ratePerPeriod = initRate / freq / 100;
      const perPeriodPayment = ratePerPeriod === 0
        ? l.value / periodsTotal
        : l.value * ratePerPeriod / (1 - Math.pow(1 + ratePerPeriod, -periodsTotal));
      l._fixedPayment = perPeriodPayment * freq / 12;
      l._renewalDone = false;
    }
  }

  return months.map(month => {
    // Capture net worth at start of month (before any updates)
    const startNetWorth = assets.reduce((s, a) => s + a.value, 0) + cashFlow
                        - liabilities.reduce((s, l) => s + l.value, 0);

    let incomeThisMonth   = 0;
    let expenseThisMonth  = 0;
    let transferThisMonth = 0;

    // 1. Grow assets
    for (const a of assets) {
      if (a.isInvestment) {
        const annualPct = returnSampler ? returnSampler(a) : a.annualMeanReturn;
        a.value = a.value * (1 + annualPct / 12 / 100);
      } else {
        a.value = a.value * (1 + (a.monthlyGrowthRate ?? 0) / 100);
      }
    }

    // 2. Amortise liabilities and deduct payments from cash (or from a linked asset)
    for (const l of liabilities) {
      if (l.useAmortization && l.value > 0) {
        // Determine effective rate — switch to renewalRate after termEndDate
        const effectiveRate = (l.termEndDate && month > l.termEndDate && (l.renewalRate ?? 0) > 0)
          ? l.renewalRate : (l.annualInterestRate ?? 0);
        const mRate = effectiveRate / 12 / 100;
        const interest = l.value * mRate;

        // Calculate monthly-equivalent payment
        let payment;
        const paymentMode = l.paymentMode ?? (l.amortizationEndDate ? 'calculated' : 'set');
        if (paymentMode === 'calculated' && l.amortizationEndDate) {
          const freqMap = { 'monthly': 12, 'semi-monthly': 24, 'bi-weekly': 26 };
          const freq = freqMap[l.paymentFrequency ?? 'monthly'] ?? 12;
          if (l._fixedPayment !== undefined) {
            // termStartDate was set: use fixed payment, recompute once at term renewal
            const pastTermEnd = l.termEndDate && month > l.termEndDate;
            if (pastTermEnd && !l._renewalDone) {
              // First month of renewed term: lock in a new fixed payment from current balance
              const remainingMonths = Math.max(1, monthsBetween(month, l.amortizationEndDate));
              const periodsRemaining = Math.max(1, Math.round(remainingMonths * freq / 12));
              const ratePerPeriod = effectiveRate / freq / 100;
              const perPeriodPayment = ratePerPeriod === 0
                ? l.value / periodsRemaining
                : l.value * ratePerPeriod / (1 - Math.pow(1 + ratePerPeriod, -periodsRemaining));
              l._fixedPayment = perPeriodPayment * freq / 12;
              l._renewalDone = true;
            }
            payment = l._fixedPayment;
          } else {
            // No termStartDate: recalculate each month from remaining time (original behaviour)
            const remainingMonths = Math.max(1, monthsBetween(month, l.amortizationEndDate));
            const periodsRemaining = Math.max(1, Math.round(remainingMonths * freq / 12));
            const ratePerPeriod = effectiveRate / freq / 100;
            const perPeriodPayment = ratePerPeriod === 0
              ? l.value / periodsRemaining
              : l.value * ratePerPeriod / (1 - Math.pow(1 + ratePerPeriod, -periodsRemaining));
            payment = perPeriodPayment * freq / 12;
          }
        } else {
          // 'set' mode: use the user-specified payment; still correctly splits into principal + interest
          payment = l.monthlyPayment ?? 0;
        }

        payment = Math.min(payment, l.value + interest);
        l.value = Math.max(0, l.value - (payment - interest));
        const payAsset = l.paymentAssetName ? assetMap.get(l.paymentAssetName) : null;
        if (payAsset) {
          payAsset.value = payAsset.value - payment;
        } else {
          cashFlow -= payment;
        }
        expenseThisMonth += payment;
      }
    }

    // 3. Apply events
    const activeEvents = events ?? state.data.events;
    for (const ev of activeEvents) {
      if (!isEventActive(ev, month)) continue;

      let amount = amountSampler ? amountSampler(ev) : ev.amount;
      amount = Math.max(0, amount);

      if (ev.inflationAdjusted && config.inflationRate) {
        const mElapsed = monthsBetween(config.startDate, month);
        amount *= Math.pow(1 + config.inflationRate / 12 / 100, mElapsed);
      }

      switch (ev.type) {
        case 'income': {
          const net = amount * (1 - (config.taxRate ?? 0) / 100);
          const depositAsset = ev.depositToAssetName ? assetMap.get(ev.depositToAssetName) : null;
          if (depositAsset) {
            depositAsset.value += net;
          } else {
            cashFlow += net;
          }
          incomeThisMonth += net;
          break;
        }
        case 'expense': {
        // Deduct from source asset or cash flow
          const srcAsset = ev.payFromAssetName ? assetMap.get(ev.payFromAssetName) : null;
          if (srcAsset) {
            srcAsset.value = srcAsset.value - amount;
          } else {
            cashFlow -= amount;
          }
          // Apply to liability (extra principal), destination asset (transfer), or count as expense
          if (ev.linkedLiabilityName) {
            const liab = liabMap.get(ev.linkedLiabilityName);
            if (liab) { liab.value = Math.max(0, liab.value - amount); transferThisMonth += amount; }
            else { expenseThisMonth += amount; }
          } else if (ev.linkedAssetName) {
            const linked = assetMap.get(ev.linkedAssetName);
            if (linked) { linked.value += amount; transferThisMonth += amount; }
            else { expenseThisMonth += amount; }
          } else {
            expenseThisMonth += amount;
          }
          break;
        }
        case 'one_time_inflow': {
          const depositAsset = ev.depositToAssetName ? assetMap.get(ev.depositToAssetName) : null;
          if (depositAsset) {
            depositAsset.value += amount;
          } else {
            cashFlow += amount;
          }
          incomeThisMonth += amount;
          break;
        }
        case 'one_time_outflow': {
          // Deduct from source asset or cash flow
          const srcAsset = ev.payFromAssetName ? assetMap.get(ev.payFromAssetName) : null;
          if (srcAsset) {
            srcAsset.value = srcAsset.value - amount;
          } else {
            cashFlow -= amount;
          }
          // Apply to liability, destination asset, or count as expense
          if (ev.linkedLiabilityName) {
            const liab = liabMap.get(ev.linkedLiabilityName);
            if (liab) { liab.value = Math.max(0, liab.value - amount); transferThisMonth += amount; }
            else { expenseThisMonth += amount; }
          } else if (ev.linkedAssetName) {
            const linked = assetMap.get(ev.linkedAssetName);
            if (linked) { linked.value += amount; transferThisMonth += amount; }
            else { expenseThisMonth += amount; }
          } else {
            expenseThisMonth += amount;
          }
          break;
        }
      }
    }

    // 4. Net worth = assets + cashFlow − liabilities
    const assetTotal      = assets.reduce((s, a) => s + a.value, 0);
    const liabTotal       = liabilities.reduce((s, l) => s + l.value, 0);
    const liquidTotal     = assets.filter(a => a.isLiquid).reduce((s, a) => s + a.value, 0);
    const liquidLiabTotal = liabilities.filter(l => l.includeInLiquidNW ?? true).reduce((s, l) => s + l.value, 0);
    const netWorth        = assetTotal + cashFlow - liabTotal;
    const liquidNetWorth  = liquidTotal + cashFlow - liquidLiabTotal;

    return { month, netWorth, liquidNetWorth, assetTotal, liabTotal, cashFlow,
             startNetWorth, incomeThisMonth, expenseThisMonth, transferThisMonth,
             assetSnapshots: assets.map(a => ({ id: a.id, name: a.name, value: a.value })),
             liabSnapshots:  liabilities.map(l => ({ id: l.id, name: l.name, value: l.value })) };
  });
}

function runDeterministicForecast(baselineId, config, events = null) {
  return runSingleForecast(baselineId, config, null, null, events);
}

function runMonteCarloForecast(baselineId, config, mcConfig, events = null) {
  const n = mcConfig.numSimulations ?? 500;
  const months = getMonthRange(config.startDate, config.endDate);
  // Collect net worth per time step across all simulations
  const buckets = months.map(() => []);

  for (let sim = 0; sim < n; sim++) {
    const returnSampler = a => sampleNormal(a.annualMeanReturn, a.annualStdDev);
    const amtSampler    = ev => ev.stdDevAmount > 0
      ? Math.max(0, sampleNormal(ev.amount, ev.stdDevAmount))
      : ev.amount;
    const results = runSingleForecast(baselineId, config, returnSampler, amtSampler, events);
    results.forEach((r, i) => buckets[i].push(r.netWorth));
  }

  return months.map((month, i) => {
    const sorted = [...buckets[i]].sort((a, b) => a - b);
    return {
      month,
      p10: pctValue(sorted, 10),
      p25: pctValue(sorted, 25),
      p50: pctValue(sorted, 50),
      p75: pctValue(sorted, 75),
      p90: pctValue(sorted, 90),
    };
  });
}

// Collapse monthly results to one row per year.
// Balance-sheet fields: last month of year wins.
// Flow fields (income, expenses): summed across all months in the year.
// startNetWorth: first month of year's value.
function aggregateYearly(monthly) {
  const map = {};
  for (const r of monthly) {
    const yr = r.month.slice(0, 4);
    if (!map[yr]) {
      map[yr] = { ...r, incomeThisMonth: 0, expenseThisMonth: 0, transferThisMonth: 0 };
      // startNetWorth stays as the first month's value (set once here)
    }
    map[yr].incomeThisMonth   += r.incomeThisMonth   ?? 0;
    map[yr].expenseThisMonth  += r.expenseThisMonth  ?? 0;
    map[yr].transferThisMonth += r.transferThisMonth ?? 0;
    // Overwrite balance-sheet fields with the latest month's values
    map[yr].month        = r.month;
    map[yr].netWorth     = r.netWorth;
    map[yr].liquidNetWorth = r.liquidNetWorth;
    map[yr].assetTotal   = r.assetTotal;
    map[yr].liabTotal    = r.liabTotal;
    map[yr].cashFlow     = r.cashFlow;
  }
  return Object.values(map);
}

function aggregateMCYearly(monthly) {
  const map = {};
  for (const r of monthly) map[r.month.slice(0, 4)] = r;
  return Object.values(map);
}
