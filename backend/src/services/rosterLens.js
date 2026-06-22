// ─────────────────────────────────────────────────────────────────────────────
// Roster rate firewall (EOR lens)
//
// An employer-of-record (CAPA for its own W-2 staff; APNE/JJM for their 1099
// contractors) owns its providers' PAY rates. A facility scheduling an agency's
// provider may see what it OWES (allInCostPerHour, the loaded bill rate) but
// must NEVER see the agency's underlying payroll rate.
//
// This module strips the employer-private pay-rate fields from any roster entry
// the VIEWING facility does not employ. It's applied server-side so the masked
// values never reach the browser — not merely hidden in the UI.
//
// See eor-model-spec.md and the InternalRosterEntry / Employer models.
// ─────────────────────────────────────────────────────────────────────────────

// Employer-private PAY rates. Stripped when the viewer isn't the employer.
// allInCostPerHour is deliberately NOT here — it's the facility's own cost.
const PAYROLL_RATE_FIELDS = ['hourlyRate', 'annualRate', 'contractorPayRate'];

/**
 * Does the viewing facility employ this provider (own its employer-of-record)?
 *
 * Conservative by design: returns true (show pay) unless the entry is
 * POSITIVELY tagged to a different org. An untagged entry (employerRef null)
 * is treated as the facility's own staff so we never accidentally hide a
 * facility's own payroll. Protection therefore requires agency rows to carry
 * an employerId — that's what the backfill/upload tagging guarantees.
 *
 * `entry.employerRef` must be included by the caller.
 */
function viewerEmploysProvider(entry, viewerFacilityId) {
  const emp = entry.employerRef;
  if (!emp) return true;
  return emp.ownerFacilityId === viewerFacilityId;
}

// Replace the heavy employerRef relation with a light, non-sensitive descriptor
// the UI can use to label the row ("payroll via APNE") without leaking rates.
function summarizeEmployer(entry) {
  if (!entry.employerRef) return entry;
  const { employerRef, ...rest } = entry;
  return {
    ...rest,
    employerName: employerRef.name,
    employerKind: employerRef.kind,
    employerOwnerFacilityId: employerRef.ownerFacilityId,
  };
}

/**
 * Apply the rate lens to one roster entry for a given viewer. Returns a copy;
 * does not mutate the input. Adds `payrollMasked: true` when pay rates were
 * stripped so the UI can show "payroll via <employer>" instead of a misleading
 * "no rate" warning.
 */
function lensRosterEntry(entry, viewerFacilityId) {
  if (viewerEmploysProvider(entry, viewerFacilityId)) {
    return summarizeEmployer(entry);
  }
  const masked = { ...entry };
  for (const f of PAYROLL_RATE_FIELDS) masked[f] = null;
  masked.payrollMasked = true;
  return summarizeEmployer(masked);
}

/** Apply the lens to a list of roster entries. */
function applyRosterRateLens(entries, viewerFacilityId) {
  return entries.map((e) => lensRosterEntry(e, viewerFacilityId));
}

module.exports = {
  PAYROLL_RATE_FIELDS,
  viewerEmploysProvider,
  lensRosterEntry,
  applyRosterRateLens,
};
