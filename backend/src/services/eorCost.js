// EOR (Employer-of-Record) cost rollup — Phase 0.
// See capa-pilot/eor-model-spec.md and the `eor-multi-employer-and-staffing-arm`
// memory.
//
// Half of CAPA's schedule is staffed by 1099s who work for APNE, not CAPA. When
// APNE runs payroll it pays each 1099 their PAY rate; CAPA then reimburses APNE
// the "all-in cost" (pay + malpractice + margin) for those providers. So each
// pay period APNE needs: (a) its payroll cost, and (b) a one-click invoice total
// to send CAPA. This module produces both, plus the savings vs. the manual
// baseline.
//
// Two per-provider numbers (both on InternalRosterEntry, both optional):
//   • hourlyRate       = the PAY rate — what the provider earns. Drives payroll.
//   • allInCostPerHour = the facility's all-in cost rate for this provider — what
//                        the facility owes the agency (or the loaded cost of its
//                        own W-2 staff). Blank = not tracked (excluded from the
//                        agency invoice; facility cost falls back to pay rate).
//
// Per provider, per period:
//   payroll        = payGross(hourlyRate)                  (what the agency pays out)
//   facilityAllIn  = allInCostPerHour x hours              (what the facility owes)
//   margin         = facilityAllIn - payroll              (the agency's spread)
// The agency invoice to the facility = Σ facilityAllIn over its tracked providers.
//
// The math is PURE (no DB) so it's testable and reusable, mirroring roiCalc.js.
// buildFacilityCostForPeriod() is the thin DB layer that gathers inputs the same
// way the Payroll Builder does (hours from SchedulingRecord, matched by name key).
//
// Itemized pass-throughs (AssignmentCostComponent) are a LATER, more-detailed
// option for facilities that want to break the spread into malpractice/margin/
// travel lines. They're additive on top of the labor base; v1 just uses the
// single all-in rate. Component semantics (paidBy / reimbursable):
//   paidBy=FACILITY, reimbursable=true   agency fronts it, facility repays   → facility outflow, on the invoice
//   paidBy=FACILITY, reimbursable=false  facility pays it directly            → facility outflow, not owed to agency
//   paidBy=EMPLOYER                      the agency eats it                   → not facility outflow
//   paidBy=PROVIDER                      deducted from the provider's pay     → reduces payroll, not facility outflow

const prisma = require('../config/db');
const { buildNameKey } = require('./nameKey');
const { computeGross, splitRegularOt, fmtDate } = require('./payroll');
const { submittedShiftDetailByRoster, submittedExtrasByRoster } = require('./hourEntry');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Dollar value of one cost component. Per-hour scales by worked hours; per-shift
// scales by shift count. Exactly one of amountPerHour / amountPerShift is set.
function componentValue(c, { hours, shiftCount }) {
  if (c.amountPerHour != null) return Number(c.amountPerHour) * Number(hours || 0);
  if (c.amountPerShift != null) return Number(c.amountPerShift) * Number(shiftCount || 0);
  return 0;
}

// Bucket a provider's itemized cost components by who-bears-it. See table above.
function rollupComponents(components = [], ctx) {
  let reimbursableToEmployer = 0; // FACILITY + reimbursable  (also on the invoice)
  let facilityDirect = 0;         // FACILITY + not reimbursable
  let employerBorne = 0;          // EMPLOYER
  let providerDeductions = 0;     // PROVIDER (off the provider's pay)
  const byType = {};
  for (const c of components) {
    const v = componentValue(c, ctx);
    byType[c.type] = round2((byType[c.type] || 0) + v);
    if (c.paidBy === 'PROVIDER') providerDeductions += v;
    else if (c.paidBy === 'EMPLOYER') employerBorne += v;
    else if (c.reimbursable) reimbursableToEmployer += v; // paidBy FACILITY
    else facilityDirect += v;                              // paidBy FACILITY
  }
  return {
    reimbursableToEmployer: round2(reimbursableToEmployer),
    facilityDirect: round2(facilityDirect),
    employerBorne: round2(employerBorne),
    providerDeductions: round2(providerDeductions),
    byType,
  };
}

/**
 * All-in cost of ONE provider for the period.
 *
 *   hourlyRate        the PAY rate (provider earnings) — drives payroll
 *   annualRate        salaried fallback for payroll gross
 *   allInCostPerHour  the facility's all-in cost rate — drives the invoice;
 *                     null = not tracked → facility cost falls back to pay rate
 *   loadFactor        only used in the fallback (no all-in rate) to approximate
 *                     loaded W-2 cost; default 1 = pay rate as-is
 *   components        optional itemized pass-throughs (additive; usually empty)
 */
function computeProviderCost({
  employerKind,
  hourlyRate = null,
  annualRate = null,
  allInCostPerHour = null,
  regularHours = 0,
  otHours = 0,
  shiftCount = 0,
  components = [],
  loadFactor = 1,
}) {
  const hours = round2(Number(regularHours || 0) + Number(otHours || 0));
  const payGross = computeGross({ regularHours, otHours, hourlyRate, annualRate });
  const roll = rollupComponents(components, { hours, shiftCount });

  const allInTracked = allInCostPerHour != null;
  const laborBase = allInTracked
    ? computeGross({ regularHours, otHours, hourlyRate: allInCostPerHour, annualRate: null })
    : payGross * loadFactor;

  // What the facility actually spends on this provider.
  const facilityAllIn = round2(laborBase + roll.reimbursableToEmployer + roll.facilityDirect);
  // What the agency pays out for this provider.
  const payroll = round2(payGross - roll.providerDeductions);
  // The agency's spread (for the facility's own W-2 staff this is the burden).
  const margin = round2(facilityAllIn - payroll);

  return {
    employerKind: employerKind || null,
    hours,
    payroll,
    facilityAllIn,
    margin,
    allInTracked,
    componentsByType: roll.byType,
  };
}

/**
 * Group per-provider costs by employer and total them. Each input row is a
 * computeProviderCost() result augmented with employerId/employerName/employerKind.
 * Produces the per-employer breakdown, the grand totals, and one invoice per
 * agency: { amount (Σ facilityAllIn of tracked providers), payroll, margin }.
 */
function aggregateByEmployer(rows = []) {
  const byEmployer = {};
  let facilityAllIn = 0;
  let payroll = 0;
  let hours = 0;

  for (const r of rows) {
    const key = r.employerId || r.employerName || 'UNASSIGNED';
    const g = (byEmployer[key] = byEmployer[key] || {
      employerId: r.employerId || null,
      employerName: r.employerName || null,
      employerKind: r.employerKind || null,
      providers: 0,
      hours: 0,
      payroll: 0,
      facilityAllIn: 0,
      invoiceTotal: 0,   // Σ facilityAllIn of providers with a tracked all-in rate
      invoicePayroll: 0, // Σ payroll of those SAME providers (for the margin)
    });
    g.providers += 1;
    g.hours += r.hours;
    g.payroll += r.payroll;
    g.facilityAllIn += r.facilityAllIn;
    if (r.allInTracked) {
      g.invoiceTotal += r.facilityAllIn;
      g.invoicePayroll += r.payroll;
    }

    facilityAllIn += r.facilityAllIn;
    payroll += r.payroll;
    hours += r.hours;
  }

  const employers = Object.values(byEmployer).map((g) => ({
    ...g,
    hours: round2(g.hours),
    payroll: round2(g.payroll),
    facilityAllIn: round2(g.facilityAllIn),
    invoiceTotal: round2(g.invoiceTotal),
    invoicePayroll: round2(g.invoicePayroll),
  }));

  // One invoice per agency the facility owes money to (tracked all-in only).
  // payroll/margin reflect ONLY the billed (tracked) providers.
  const agencyInvoices = employers
    .filter((g) => g.employerKind === 'STAFFING_AGENCY' && g.invoiceTotal > 0)
    .map((g) => ({
      employerId: g.employerId,
      employerName: g.employerName,
      amount: g.invoiceTotal,
      payroll: g.invoicePayroll,
      margin: round2(g.invoiceTotal - g.invoicePayroll),
    }));

  return {
    byEmployer: employers,
    totals: {
      providers: rows.length,
      hours: round2(hours),
      facilityAllIn: round2(facilityAllIn),
      payroll: round2(payroll),
    },
    agencyInvoices,
  };
}

/**
 * SNAP savings for the schedule: the manual baseline (room-days x industry
 * rate/day, the same baseline the Schedule Builder uses, see
 * Facility.industryRoomRatePerDay / FacilitySiteRate.ratePerDay) minus the
 * facility's actual all-in labor cost.
 */
function computeScheduleSavings({ facilityAllIn, roomDays, ratePerDay }) {
  const baseline = Number(roomDays || 0) * Number(ratePerDay || 0);
  const actual = Number(facilityAllIn || 0);
  const savings = baseline - actual;
  return {
    baseline: round2(baseline),
    actual: round2(actual),
    savings: round2(savings),
    savingsPct: baseline > 0 ? round2((savings / baseline) * 100) : 0,
  };
}

/**
 * DB layer: gather a facility's all-in cost for a pay period. Hours are pulled
 * from SchedulingRecord matched to roster by name fingerprint — identical to the
 * Payroll Builder's seedLineItems(), so payroll and cost stay consistent.
 *
 * Only STANDING per-provider cost components (assignmentId = null) are applied;
 * per-assignment one-offs belong to an assignment-level path (future).
 * employerKind falls back to is1099 when a row isn't linked to an Employer yet.
 *
 * Returns { providerCosts, byEmployer, totals, agencyInvoices }.
 */
async function buildFacilityCostForPeriod({ facilityId, periodStart, periodEnd, loadFactor = 1 }) {
  const roster = await prisma.internalRosterEntry.findMany({
    where: { facilityId },
    include: {
      employerRef: true,
      costComponents: { where: { assignmentId: null } },
    },
  });

  const records = await prisma.schedulingRecord.findMany({
    where: {
      facilityId,
      shiftDate: { gte: new Date(periodStart), lte: new Date(periodEnd) },
    },
  });

  // Bucket scheduling records by provider name fingerprint.
  const recsByKey = {};
  for (const r of records) {
    const key = buildNameKey(r.providerName);
    if (!key) continue;
    (recsByKey[key] = recsByKey[key] || []).push(r);
  }

  // SUBMITTED provider hour entries override raw schedule hours for 1099s — the
  // confirmed worked hours are authoritative for billing. Empty → falls back.
  const submittedByRoster = await submittedShiftDetailByRoster({ facilityId, periodStart, periodEnd });
  // CAPA-billable reimbursements (e.g. mileage) + APNE-site bonus, per provider.
  const extrasByRoster = await submittedExtrasByRoster({ facilityId, periodStart, periodEnd });

  const providerCosts = roster.map((entry) => {
    // A provider has a 1099/agency side if pure-1099 OR dual-employment.
    const isAgency = entry.is1099 === true || entry.dualEmployment === true;
    const submitted = isAgency ? submittedByRoster[entry.id] : null;
    let shiftDetail;
    if (submitted && submitted.length) {
      // CAPA invoice bills only NON-external (facility-site) hours. Hours at a
      // non-CAPA site (e.g. an APNE site) are the agency's to pay — excluded here.
      shiftDetail = submitted.filter((s) => !s.isExternal).map((s) => ({ date: s.date, hours: s.hours }));
    } else {
      const key = buildNameKey(entry.providerName);
      const recs = (key && recsByKey[key]) || [];
      shiftDetail = recs.map((r) => ({
        date: fmtDate(r.shiftDate),
        hours: Number(r.durationHours || 0),
      }));
    }
    // Submitted/imported hours are an authoritative period total lumped on one
    // date — re-deriving a weekly >40 OT split from a lump wrongly bills the
    // remainder at 1.5x the all-in rate (1099 contractors aren't OT-eligible,
    // and the invoice is a flat hours x rate bill). Pass submitted totals
    // through as regular; only split real per-day scheduling records.
    const usingSubmitted = !!(submitted && submitted.length);
    const { regularHours, otHours } = usingSubmitted
      ? { regularHours: round2(shiftDetail.reduce((s, x) => s + Number(x.hours || 0), 0)), otHours: 0 }
      : splitRegularOt(shiftDetail);

    // For the invoice, the 1099/agency nature wins (a dual provider's W-2 side
    // never appears here — it has no billable hours and is paid as salary).
    const employerKind = isAgency ? 'STAFFING_AGENCY' : (entry.employerRef?.kind || 'FACILITY_SELF');

    const cost = computeProviderCost({
      employerKind,
      hourlyRate: entry.hourlyRate ?? null,
      annualRate: entry.annualRate ?? null,
      allInCostPerHour: entry.allInCostPerHour ?? null,
      regularHours,
      otHours,
      shiftCount: shiftDetail.length,
      components: entry.costComponents,
      loadFactor: employerKind === 'FACILITY_SELF' ? loadFactor : 1,
    });

    const payeeType =
      entry.payeeType || (entry.useBusinessNameForPayroll || entry.businessName ? 'Business' : 'Individual');

    return {
      rosterEntryId: entry.id,
      providerName: entry.providerName,
      businessName: entry.businessName || null,
      payeeType,
      is1099: entry.is1099 ?? null,
      allInCostPerHour: entry.allInCostPerHour ?? null,
      employerId: entry.employerId || null,
      // The agency that bills the facility: for a dual provider it's the 1099
      // employer (e.g. APNE / their business), not their W-2 employer.
      employerName: entry.dualEmployment
        ? (entry.contractorEmployer || entry.employer || null)
        : (entry.employerRef?.name || entry.employer || null),
      // Period extras: reimbursement is CAPA-billable; apneSiteBonus is the
      // separate APNE-site bucket (never billed to the facility).
      reimbursement: isAgency ? round2(extrasByRoster[entry.id]?.reimbursement || 0) : 0,
      apneSiteBonus: isAgency ? round2(extrasByRoster[entry.id]?.bonus || 0) : 0,
      payRate: entry.hourlyRate ?? null, // what the agency pays this provider/hr
      ...cost,
    };
  });

  return {
    providerCosts,
    ...aggregateByEmployer(providerCosts),
  };
}

/**
 * Compose the facility-facing agency invoice(s) — the "CAPA All in" deliverable.
 * One invoice per STAFFING_AGENCY the facility owes money to, listing only
 * providers with billable CAPA-site hours AND a tracked all-in rate. Each line:
 * { payeeName, contractorType, hours, capaRate, amount }. amount = capaRate×hours.
 *
 * Firewall: this is what the facility legitimately owes — it deliberately omits
 * the provider PAY rate, payroll, and margin (those are APNE-internal, Phase 1
 * employer portal only).
 */
function composeAgencyInvoices({ providerCosts = [], periodStart, periodEnd }) {
  const byEmployer = {};
  for (const r of providerCosts) {
    if (r.employerKind !== 'STAFFING_AGENCY') continue;
    const reimbursement = round2(r.reimbursement || 0);
    const hasHours = r.allInTracked && r.hours > 0;
    // Include a provider if they have billable hours OR a CAPA reimbursement
    // (e.g. a mileage-only line).
    if (!hasHours && !(reimbursement > 0)) continue;
    // Group by normalized employer NAME first: duplicate Employer rows with
    // the same name (or a name-only roster link) must not split one agency's
    // billing into two invoice cards. Fall back to id, then UNASSIGNED.
    const key = String(r.employerName || '').trim().toLowerCase() || r.employerId || 'UNASSIGNED';
    const inv = (byEmployer[key] = byEmployer[key] || {
      employerId: null,
      employerName: r.employerName || null,
      periodStart: periodStart || null,
      periodEnd: periodEnd || null,
      lines: [],
      total: 0,
    });
    if (!inv.employerId && r.employerId) inv.employerId = r.employerId; // first non-null id wins
    const laborAmount = hasHours ? round2(r.facilityAllIn) : 0;
    const amount = round2(laborAmount + reimbursement); // hours×rate + reimbursement
    inv.lines.push({
      rosterEntryId: r.rosterEntryId,
      payeeName: r.payeeType === 'Business' && r.businessName ? r.businessName : r.providerName,
      contractorType: r.payeeType,
      hours: round2(r.hours),
      capaRate: r.allInCostPerHour,
      reimbursement,
      amount,
    });
    inv.total = round2(inv.total + amount);
  }
  return Object.values(byEmployer).map((inv) => ({
    ...inv,
    providerCount: inv.lines.length,
    lines: inv.lines.sort((a, b) => a.payeeName.localeCompare(b.payeeName)),
  }));
}

module.exports = {
  componentValue,
  rollupComponents,
  computeProviderCost,
  aggregateByEmployer,
  computeScheduleSavings,
  buildFacilityCostForPeriod,
  composeAgencyInvoices,
};
