'use strict';

// ═══════════════════════════════════════════════════════════════
// v1 SAMPLE SCENARIO REGISTRY
// ═══════════════════════════════════════════════════════════════
//
// Shared library of pre-built sample scenarios that workflows can
// consume. Each sample knows how to generate a baseline + a set of
// events + an event set tying them together. The workflow that calls
// it owns the analysis config (so different workflows can use the
// same sample for different forecast horizons / Monte Carlo settings).
//
// Sample shape:
//   {
//     id:          string,    // unique registry key
//     label:       string,    // user-facing card title
//     description: string,    // one-liner shown on the pick-sample card
//     icon:        string,    // emoji
//     // generate(ctx) -> { baseline, events, eventSet }
//     //   Pushes nothing into state.data — the caller persists the
//     //   returned records (so it can record producedRecordIds and
//     //   layer its own analysis config on top).
//     //
//     // ctx = {
//     //   startDate:    'YYYY-MM',  // forecast / baseline start month
//     //   takenBaselineNames:  string[],
//     //   takenEventSetNames:  string[],
//     //   namePrefix:   string,     // optional prefix for record names
//     // }
//     generate: (ctx) => ({ baseline, events, eventSet }),
//   }
//
// Versioning: when a sample needs to change shape, register a new
// id (e.g. 'family-mortgage-v2') rather than mutating the existing
// one. Workflows pin to a specific id so older runs keep producing
// the same records.

const V1_SAMPLES = {};

function registerV1Sample(def) {
  V1_SAMPLES[def.id] = def;
}

function getV1SampleDefinition(id) {
  return V1_SAMPLES[id] || null;
}

function listV1Samples() {
  return Object.values(V1_SAMPLES);
}

// ═══════════════════════════════════════════════════════════════
// SAMPLE: family-mortgage
// ═══════════════════════════════════════════════════════════════
// A realistic two-income household with a primary residence,
// amortizing mortgage on a 5-year term, mixed investment accounts,
// and typical monthly expenses + TFSA/RRSP contributions.

registerV1Sample({
  id: 'family-mortgage',
  label: 'Family with mortgage',
  description: 'Two-income household, primary residence with an amortizing mortgage, mixed investment accounts, and typical monthly expenses.',
  icon: '🏡',
  generate: (ctx) => {
    const start = ctx.startDate || today();
    const amortEnd = addMonths(start, 300); // 25 years
    const termEnd  = addMonths(start, 60);  // 5-year term
    const prefix   = ctx.namePrefix ? `${ctx.namePrefix} ` : '';

    const baseline = {
      id: uuid(),
      name: uniqueName(`${prefix}Family with Mortgage Plan`.trim(), ctx.takenBaselineNames ?? []),
      description: 'Generated from the "Family with mortgage" sample.',
      date: start,
      createdAt: new Date().toISOString(),
      assets: [
        { id: uuid(), name: 'Joint Chequing',    value:  15000, category: 'Bank Account',       isInvestment: false, isLiquid: true,  monthlyGrowthRate: 0,    annualMeanReturn: 7, annualStdDev: 15 },
        { id: uuid(), name: 'Emergency Fund',    value:  20000, category: 'Bank Account',       isInvestment: false, isLiquid: true,  monthlyGrowthRate: 0.35, annualMeanReturn: 7, annualStdDev: 15 },
        { id: uuid(), name: 'TFSA',              value:  80000, category: 'Investment Account', isInvestment: true,  isLiquid: true,  monthlyGrowthRate: 0,    annualMeanReturn: 8, annualStdDev: 14 },
        { id: uuid(), name: 'RRSP',              value: 120000, category: 'Investment Account', isInvestment: true,  isLiquid: false, monthlyGrowthRate: 0,    annualMeanReturn: 7, annualStdDev: 12 },
        { id: uuid(), name: 'Primary Residence', value: 750000, category: 'Real Estate',        isInvestment: false, isLiquid: false, monthlyGrowthRate: 0.33, annualMeanReturn: 7, annualStdDev: 15 },
      ],
      liabilities: [
        {
          id: uuid(), name: 'Primary Mortgage', value: 520000, category: 'Mortgage',
          annualInterestRate: 5.25, useAmortization: true,
          monthlyPayment: 0, includeInLiquidNW: false,
          paymentAssetName: 'Joint Chequing',
          paymentMode: 'calculated', paymentFrequency: 'monthly',
          amortizationEndDate: amortEnd,
          termStartDate: start,
          termEndDate: termEnd,
          renewalRate: 4.5,
        },
      ],
    };

    // Mortgage payment is handled by amortization on the liability —
    // do NOT add a separate expense event for the payment (would double-count).
    const evDefs = [
      { name: 'Primary Income',            amount: 7500, type: 'income',  category: 'Income',               inflation: true,  deposit: 'Joint Chequing' },
      { name: 'Partner Income',            amount: 5800, type: 'income',  category: 'Income',               inflation: true,  deposit: 'Joint Chequing' },
      { name: 'Property Taxes',            amount:  550, type: 'expense', category: 'Housing',              inflation: true,  payFrom: 'Joint Chequing' },
      { name: 'Utilities',                 amount:  280, type: 'expense', category: 'Utilities',            inflation: true,  payFrom: 'Joint Chequing' },
      { name: 'Groceries & Food',          amount: 1100, type: 'expense', category: 'Food & Dining',        inflation: true,  payFrom: 'Joint Chequing' },
      { name: 'Transportation',            amount:  450, type: 'expense', category: 'Transportation',       inflation: true,  payFrom: 'Joint Chequing' },
      { name: 'Entertainment & Dining',    amount:  320, type: 'expense', category: 'Entertainment',        inflation: true,  payFrom: 'Joint Chequing' },
      { name: 'Childcare',                 amount: 1400, type: 'expense', category: 'Childcare',            inflation: true,  payFrom: 'Joint Chequing' },
      { name: 'Vacation (Monthly Avg)',    amount:  400, type: 'expense', category: 'Travel',               inflation: true,  payFrom: 'Joint Chequing' },
      { name: 'Monthly TFSA Contribution', amount:  800, type: 'expense', category: 'Savings & Investment', inflation: false, payFrom: 'Joint Chequing', linkAsset: 'TFSA' },
      { name: 'Monthly RRSP Contribution', amount:  700, type: 'expense', category: 'Savings & Investment', inflation: false, payFrom: 'Joint Chequing', linkAsset: 'RRSP' },
    ];

    const events = evDefs.map(def => ({
      id: uuid(),
      name: def.name,
      notes: '',
      category: def.category,
      type: def.type,
      amount: def.amount,
      stdDevAmount: 0,
      isRecurring: true,
      startDate: start,
      endDate: '',
      inflationAdjusted: !!def.inflation,
      depositToAssetName: def.deposit ?? '',
      payFromAssetName:   def.payFrom ?? '',
      linkedAssetName:    def.linkAsset ?? '',
      linkedLiabilityName: '',
    }));

    const eventSet = {
      id: uuid(),
      name: uniqueName(`${prefix}Family Plan Events`.trim(), ctx.takenEventSetNames ?? []),
      description: 'Income, recurring household expenses, and monthly savings contributions for the Family with mortgage sample.',
      eventIds: events.map(e => e.id),
    };

    return { baseline, events, eventSet };
  },
});
