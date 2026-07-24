/**
 * WC Recovery engine (2026-07-24) — the entitlement-first core.
 *
 * Design philosophy (WC-RECOVERY-BRIEF.md ★): the source of truth is what a
 * case is ENTITLED to under 114.3 CMR 40.05(2), computed the moment the case
 * exists — the payer's EOB is demoted to a reconciliation input. Every case is
 * born appeal-ready: when the engine flags an underpayment it auto-stages the
 * rung-1 packet rows (audit + corrected claim + demand) and a work item, so a
 * short payment is one human approval away from a demand in the mail.
 *
 * Software works every case; humans touch only exceptions — confidenceScore
 * routes low-confidence extractions to a CONFIRM_EXTRACTION work item instead
 * of emitting a weak entitlement number (accuracy-first, same posture as the
 * credentialing intake).
 */

const prisma = require('../config/db')
const {
  MA_WC,
  computeWcEntitlement,
  commercialRepriceAmount,
} = require('./maFeeSchedule')

// A gap below this is noise (rounding), not a recovery target.
const GAP_FLOOR = 5.0
// Within this fraction of the commercial reprice ⇒ label the pattern.
const REPRICE_TOLERANCE = 0.05

// ── Confidence ──────────────────────────────────────────────────────────────
// 0..1 — how solid the anesthesia-math inputs are. The entitlement number is
// only as good as base units + minutes; missing either forces human confirm.
function scoreConfidence(c) {
  let score = 0
  if (c.baseUnits != null && c.baseUnits > 0) score += 0.4
  if (c.anesthesiaMinutes != null && c.anesthesiaMinutes > 0) score += 0.3
  if (c.asaCptCode) score += 0.1
  if (c.claimNumber) score += 0.1
  if (c.payerName) score += 0.05
  if (c.dateOfService) score += 0.05
  return Math.round(score * 100) / 100
}

const CONFIDENCE_AUTO = 0.7 // ≥ this flows untouched; below routes to a human

// ── Underpayment pattern detection ──────────────────────────────────────────
// Names the payer's game so the demand letter can call it out explicitly.
function detectPattern({ entitledAmount, paidAmount, baseUnits, anesthesiaMinutes, totalUnits }) {
  if (paidAmount == null) return null
  if (entitledAmount - paidAmount < GAP_FLOOR) return 'PAID_IN_FULL'

  // The classic MA game: repricing the WC claim to the commercial schedule
  // ($19.90/base + $1.33/min, no modifier units) — pays roughly half.
  const commercial = commercialRepriceAmount({ baseUnits, anesthesiaMinutes })
  if (commercial != null && Math.abs(paidAmount - commercial) <= commercial * REPRICE_TOLERANCE) {
    return 'REPRICED_TO_COMMERCIAL'
  }

  // Paid a clean multiple of the WC $39 rate but fewer units than entitled ⇒
  // units were cut (usually the modifier or time units).
  const paidUnits = paidAmount / MA_WC.RATE_PER_UNIT
  if (Math.abs(paidUnits - Math.round(paidUnits * 10) / 10) < 0.05 && paidUnits < totalUnits) {
    return 'UNITS_CUT'
  }

  return 'UNDERPAID_OTHER'
}

// Human-readable label for documents/UI.
const PATTERN_LABELS = {
  REPRICED_TO_COMMERCIAL: 'Repriced to the commercial fee schedule instead of 114.3 CMR 40.05(2)',
  UNITS_CUT: 'Unit count reduced below the schedule entitlement (time and/or modifier units cut)',
  UNDERPAID_OTHER: 'Paid below the 114.3 CMR 40.05(2) entitlement',
  PAID_IN_FULL: 'Paid at or above the schedule entitlement',
}

// ── Next-best action (self-advancing case objects) ──────────────────────────
function nextActionFor(status, confidence) {
  if (confidence != null && confidence < CONFIDENCE_AUTO) {
    return 'Confirm extracted anesthesia detail (base units / minutes), then recompute'
  }
  switch (status) {
    case 'INGESTED': return 'Compute MA entitlement'
    case 'ENTITLEMENT_COMPUTED': return 'Awaiting remittance — no action needed'
    case 'UNDERPAYMENT_FLAGGED': return 'Review staged demand packet'
    case 'PACKET_GENERATED': return 'Approve and send the demand packet to the carrier'
    case 'SUBMITTED': return 'Awaiting carrier response — chase adjuster if silent 30+ days'
    case 'RESOLVED_RECOVERED': return 'Done — recovery recorded on the ledger'
    case 'RESOLVED_NO_RECOVERY': return 'Consider rung 2 (DIA prohibited-practice complaint)'
    default: return null
  }
}

async function logActivity(caseId, action, meta = null, actorId = null) {
  await prisma.wcActivityLog.create({
    data: { caseId, action, actorId, metaJson: meta ?? undefined },
  }).catch(() => {})
}

/**
 * Run the entitlement engine on one case: compute the MA number, reconcile
 * against payments, detect the pattern, advance the state machine, and — when
 * underpaid with adequate confidence — auto-stage rung-1 packets + work item.
 *
 * Returns the updated case (with calc). Never throws on a low-confidence case;
 * instead it parks the case with a CONFIRM_EXTRACTION work item.
 */
async function runCase(caseId, actorId = null) {
  const c = await prisma.wcCase.findUnique({
    where: { id: caseId },
    include: { remittances: true, documents: true, workItems: true },
  })
  if (!c) throw new Error('Case not found')

  const confidence = scoreConfidence(c)

  // Accuracy-first: no base units or no minutes ⇒ never emit a weak number.
  if (!(c.baseUnits > 0) || !(c.anesthesiaMinutes > 0)) {
    const hasConfirm = c.workItems.some((w) => w.type === 'CONFIRM_EXTRACTION' && w.status !== 'DONE')
    if (!hasConfirm) {
      await prisma.wcWorkItem.create({
        data: {
          caseId,
          type: 'CONFIRM_EXTRACTION',
          note: 'Anesthesia math incomplete — confirm base units and minutes before the entitlement is computed.',
        },
      })
    }
    await logActivity(caseId, 'ENGINE_PARKED_LOW_CONFIDENCE', { confidence }, actorId)
    return prisma.wcCase.update({
      where: { id: caseId },
      data: { confidenceScore: confidence, nextAction: nextActionFor(c.status, confidence) },
      include: { entitlementCalc: true },
    })
  }

  // 1. Entitlement — the truth the rest of the case reconciles against.
  const calc = computeWcEntitlement({
    cptCode: c.asaCptCode,
    baseUnits: c.baseUnits,
    anesthesiaMinutes: c.anesthesiaMinutes,
    physicalStatus: c.physicalStatus,
    qualifyingCircs: c.qualifyingCircs || [],
  })

  // 2. Reconcile payments (paidAmount = sum of remittances, else ingested value).
  const remitTotal = c.remittances.reduce((s, r) => s + r.paidAmount, 0)
  const paidAmount = c.remittances.length ? Math.round(remitTotal * 100) / 100 : c.paidAmount
  const gapAmount = paidAmount != null
    ? Math.round((calc.entitledAmount - paidAmount) * 100) / 100
    : null

  // 3. Pattern + state.
  const pattern = detectPattern({
    entitledAmount: calc.entitledAmount,
    paidAmount,
    baseUnits: c.baseUnits,
    anesthesiaMinutes: c.anesthesiaMinutes,
    totalUnits: calc.totalUnits,
  })

  const underpaid = gapAmount != null && gapAmount >= GAP_FLOOR
  // Don't regress cases already in flight (SUBMITTED etc.).
  const inFlight = ['SUBMITTED', 'RESOLVED_RECOVERED', 'RESOLVED_NO_RECOVERY', 'CLOSED'].includes(c.status)
  let status = c.status
  if (!inFlight) {
    if (underpaid) status = 'PACKET_GENERATED' // flagged AND armed in one step
    else if (paidAmount != null) status = 'ENTITLEMENT_COMPUTED'
    else status = 'ENTITLEMENT_COMPUTED'
  }

  // 4. Persist the calc snapshot (idempotent — one per case, replaced on rerun).
  await prisma.wcEntitlementCalc.upsert({
    where: { caseId },
    create: {
      caseId,
      scheduleVersion: calc.scheduleVersion,
      method: calc.method,
      conversionFactor: calc.conversionFactor,
      minutesPerUnit: calc.minutesPerUnit,
      totalUnits: calc.totalUnits,
      entitledAmount: calc.entitledAmount,
      inputsJson: calc,
    },
    update: {
      scheduleVersion: calc.scheduleVersion,
      method: calc.method,
      conversionFactor: calc.conversionFactor,
      minutesPerUnit: calc.minutesPerUnit,
      totalUnits: calc.totalUnits,
      entitledAmount: calc.entitledAmount,
      inputsJson: calc,
    },
  })

  // 5. Born appeal-ready: stage rung-1 packet rows + review work item once.
  let autoStaged = c.autoStaged
  if (underpaid && !inFlight) {
    const have = new Set(c.documents.map((d) => d.type))
    const stage = ['AUDIT', 'CORRECTED_CLAIM', 'DEMAND_LETTER'].filter((t) => !have.has(t))
    if (stage.length) {
      await prisma.wcDocument.createMany({
        data: stage.map((type) => ({ caseId, type, status: 'GENERATED' })),
      })
    }
    const hasReview = c.workItems.some((w) => w.type === 'REVIEW_UNDERPAYMENT' && w.status !== 'DONE')
    if (!hasReview) {
      await prisma.wcWorkItem.create({
        data: {
          caseId,
          type: 'REVIEW_UNDERPAYMENT',
          note: `Underpaid $${gapAmount.toFixed(2)} — ${PATTERN_LABELS[pattern] || 'below schedule'}. Demand packet staged.`,
        },
      })
    }
    autoStaged = true
    await logActivity(caseId, 'RUNG1_PACKET_STAGED', { gapAmount, pattern }, actorId)
  }

  await logActivity(caseId, 'ENTITLEMENT_COMPUTED', {
    entitledAmount: calc.entitledAmount, paidAmount, gapAmount, pattern, confidence,
  }, actorId)

  return prisma.wcCase.update({
    where: { id: caseId },
    data: {
      entitledAmount: calc.entitledAmount,
      paidAmount,
      gapAmount,
      confidenceScore: confidence,
      underpaymentReason: pattern,
      autoStaged,
      status,
      nextAction: nextActionFor(status, confidence),
    },
    include: { entitlementCalc: true, documents: true, workItems: true },
  })
}

/**
 * Record a received payment (EOB/835 line) and recognize recovery.
 *
 * Recovery recognition rule (brief §9): dollars received AFTER the demand
 * packet existed count as recovered — recognized only when RECEIVED, never
 * when expected. SNAP invoices against these events; it never holds the money.
 */
async function recordRemittance(caseId, { paidAmount, receivedDate, adjustments, source = 'MANUAL' }, actorId = null) {
  const c = await prisma.wcCase.findUnique({ where: { id: caseId } })
  if (!c) throw new Error('Case not found')

  const gapBefore = c.gapAmount
  const postDemand = ['PACKET_GENERATED', 'SUBMITTED'].includes(c.status)

  await prisma.wcRemittance.create({
    data: {
      caseId,
      paidAmount,
      receivedDate: receivedDate ? new Date(receivedDate) : null,
      adjustments: adjustments ?? undefined,
      source,
    },
  })

  if (postDemand && gapBefore != null && gapBefore > 0 && paidAmount > 0) {
    const recovered = Math.round(Math.min(paidAmount, gapBefore) * 100) / 100
    await prisma.wcRecoveryEvent.create({
      data: { caseId, amount: recovered, basis: 'POST_DEMAND_PAYMENT' },
    })
    await logActivity(caseId, 'RECOVERY_RECOGNIZED', { recovered, basis: 'POST_DEMAND_PAYMENT' }, actorId)
  }

  // Recompute entitlement/gap with the new payment in the ledger.
  const updated = await runCase(caseId, actorId)

  // Close the loop when the gap is (near) zero after a post-demand payment.
  if (postDemand && updated.gapAmount != null && updated.gapAmount < GAP_FLOOR) {
    return prisma.wcCase.update({
      where: { id: caseId },
      data: { status: 'RESOLVED_RECOVERED', nextAction: nextActionFor('RESOLVED_RECOVERED', updated.confidenceScore) },
      include: { entitlementCalc: true, documents: true, workItems: true },
    })
  }
  return updated
}

module.exports = {
  runCase,
  recordRemittance,
  scoreConfidence,
  detectPattern,
  nextActionFor,
  logActivity,
  PATTERN_LABELS,
  GAP_FLOOR,
  CONFIDENCE_AUTO,
}
