// ============================================================================
// Massachusetts WC anesthesia fee schedule — cold-start entitlement config
// ============================================================================
//
// This module is the SINGLE source of truth for the MA Workers' Compensation
// anesthesia entitlement math (see WC-RECOVERY-BRIEF.md §6). It is pre-filled
// from the authoritative Massachusetts regulation. Every WcEntitlementCalc must
// record which SCHEDULE_VERSION it used, so a demand letter can cite the source.
//
// PRIMARY SOURCE (workers' comp — the one we bill on):
//   114.3 CMR 40.00 "Rates for Services under M.G.L. c. 152, Workers' Compensation Act"
//   Anesthesia policy: 114.3 CMR 40.05(2); base units: 40.06(2); modifiers: 40.07(1) App. A
//   Effective date on the operative regulation text: April 1, 2009.
//   Verbatim rule (40.05(2)): "Payments are determined by adding base units, time
//   units and modifying units (if any) and multiplying this sum by a rate per unit.
//   Each time unit equals 15 minutes." → (TIME UNITS + BASE UNITS + MODIFYING UNITS) × $39.00
//
// ⚠️ CONFIRM-BEFORE-PRODUCTION: 114.3 CMR 40.00 is the DHCFP-era WC schedule
//   (effective 2009) and is still the operative WC regulation as published, but WC
//   schedules can be amended without renumbering. Before go-live, verify no newer
//   amendment has changed the $39.00 rate-per-unit or the 15-minute time unit, and
//   bump SCHEDULE_VERSION if so. Do NOT silently trust these constants forever.
//
// COMMERCIAL / GENERAL schedules are included ONLY for the "repriced to commercial
// or Medicare" underpayment-detection pattern — NOT for billing. They pay ~half of
// WC on a typical case, which is exactly how groups get shorted.
// ============================================================================

const SCHEDULE_VERSION = 'MA-WC-114.3CMR40-2009-04-01';

// ---------------------------------------------------------------------------
// WORKERS' COMP schedule — 114.3 CMR 40.05(2). THIS is what we compute entitlement on.
// ---------------------------------------------------------------------------
const MA_WC = {
  version: SCHEDULE_VERSION,
  citation: '114.3 CMR 40.05(2)',
  effectiveDate: '2009-04-01',

  // Single conversion factor applied to (base + time + modifier) units.
  RATE_PER_UNIT: 39.0,

  // MA WC time units are 15 minutes each (NOT per-minute like the commercial
  // schedule). Partial time units are rounded to one decimal place.
  MINUTES_PER_TIME_UNIT: 15,
  TIME_UNIT_DECIMALS: 1,

  // Physical-status modifying units (114.3 CMR 40.07(1) Appendix A).
  // P1/P2 are not assigned units by the schedule → 0.
  PHYSICAL_STATUS_UNITS: {
    P1: 0,
    P2: 0,
    P3: 1,
    P4: 2,
    P5: 3,
    // P6 (brain-dead organ donor) is not assigned units by 40.07(1) App. A → 0.
    P6: 0,
  },

  // Qualifying-circumstance add-on units (114.3 CMR 40.05(2)(f), CPT 99100–99140).
  QUALIFYING_CIRCUMSTANCE_UNITS: {
    '99100': 1, // extreme age (<1yr or >=70yr)
    '99116': 5, // complicated by total body hypothermia
    '99135': 5, // complicated by controlled hypotension
    '99140': 2, // complicated by emergency conditions
  },

  // Base units per anesthesia CPT (00100–01999) come from the base-unit table
  // adopted at 114.3 CMR 40.06(2), which tracks the ASA Relative Value Guide
  // base units. Populate BASE_UNITS_BY_CPT from the 40.06(2) table (or the
  // corresponding ASA RVG year the reg adopts). Left as a lookup the reader fills
  // per case; the engine must NOT invent base units — pull from the code.
  BASE_UNITS_BY_CPT: {
    // '00790': 7,   // example only — populate from 40.06(2)
  },
};

// ---------------------------------------------------------------------------
// COMMERCIAL / GENERAL schedules — detection only, NEVER used to bill.
// If an EOB's implied allowance matches one of these instead of MA_WC, that is a
// "repriced to commercial/Medicare" underpayment (a top recovery pattern).
// ---------------------------------------------------------------------------
const MA_COMMERCIAL_101CMR316 = {
  citation: '101 CMR 316.04',
  effectiveDate: '2024-04-26',
  PER_BASE_UNIT: 19.9,
  PER_TIME_UNIT: 1.33,     // per ONE minute
  MINUTES_PER_TIME_UNIT: 1,
};

const MA_GENERAL_114_3CMR16 = {
  citation: '114.3 CMR 16.04',
  PER_BASE_UNIT: 18.86,
  PER_TIME_UNIT: 1.26,     // per ONE minute
  MINUTES_PER_TIME_UNIT: 1,
};

// ---------------------------------------------------------------------------
// Cold-start entitlement calculator (WC). Returns the full auditable breakdown
// that WcEntitlementCalc.inputsJson should persist. See brief §6a.
// ---------------------------------------------------------------------------
function computeWcEntitlement({
  cptCode,
  baseUnits,           // from BASE_UNITS_BY_CPT[cptCode] (40.06(2)); required
  anesthesiaMinutes,   // actual reported minutes
  physicalStatus,      // e.g. 'P3' | null
  qualifyingCircs = [], // e.g. ['99140']
}) {
  if (baseUnits == null) {
    throw new Error(`Missing base units for CPT ${cptCode}; refuse to estimate (brief §6b rule).`);
  }

  const rawTimeUnits = (anesthesiaMinutes || 0) / MA_WC.MINUTES_PER_TIME_UNIT;
  const timeUnits = Number(rawTimeUnits.toFixed(MA_WC.TIME_UNIT_DECIMALS));

  const psUnits = physicalStatus ? (MA_WC.PHYSICAL_STATUS_UNITS[physicalStatus] || 0) : 0;
  const qcUnits = qualifyingCircs.reduce(
    (sum, code) => sum + (MA_WC.QUALIFYING_CIRCUMSTANCE_UNITS[code] || 0), 0
  );
  const modifierUnits = psUnits + qcUnits;

  const totalUnits = baseUnits + timeUnits + modifierUnits;
  const entitledAmount = Number((totalUnits * MA_WC.RATE_PER_UNIT).toFixed(2));

  return {
    method: 'MA_COLD_START',
    scheduleVersion: MA_WC.version,
    citation: MA_WC.citation,
    conversionFactor: MA_WC.RATE_PER_UNIT,
    minutesPerUnit: MA_WC.MINUTES_PER_TIME_UNIT,
    baseUnits,
    timeUnits,
    physicalStatusUnits: psUnits,
    qualifyingCircumstanceUnits: qcUnits,
    modifierUnits,
    totalUnits,
    entitledAmount,
  };
}

// What a payer would owe if it (improperly) repriced the same case to the
// commercial schedule. Used to label the underpayment pattern on the demand.
function commercialRepriceAmount({ baseUnits, anesthesiaMinutes }, sched = MA_COMMERCIAL_101CMR316) {
  if (baseUnits == null) return null;
  return Number(
    (baseUnits * sched.PER_BASE_UNIT + (anesthesiaMinutes || 0) * sched.PER_TIME_UNIT).toFixed(2)
  );
}

// Worked example (documents the ~2× WC-vs-commercial gap that is the whole thesis):
//   6 base units, 60 min, no modifiers
//   WC:         (6 + 60/15) * $39.00                       = 10 * 39      = $390.00
//   Commercial: 6 * $19.90 + 60 * $1.33 (101 CMR 316)      = 119.40+79.80 = $199.20
//   → a payer repricing WC to commercial shorts the group ~$190.80 on ONE case.

module.exports = {
  SCHEDULE_VERSION,
  MA_WC,
  MA_COMMERCIAL_101CMR316,
  MA_GENERAL_114_3CMR16,
  computeWcEntitlement,
  commercialRepriceAmount,
};
