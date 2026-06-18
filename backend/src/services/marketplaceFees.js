// Position 1 marketplace fee logic. SNAP is NOT the payor — it accrues the
// platform fee it is owed by the facility on each dual-verified marketplace
// shift, as a ledger entry. No money moves yet (no Stripe); the fee sits at
// PENDING until billing is wired, then flips to CHARGED/FAILED.

const prisma = require('../config/db');
const { isFlagEnabled } = require('../config/featureFlags');

// Locked go-to-market rate: 5% on MARKETPLACE shifts only. Internal shifts pay
// no fee (they never reach this code — they have no ShiftBooking).
const MARKETPLACE_FEE_RATE = 0.05;

// Accrue (or update) the fee ledger row for a completed marketplace booking.
// Idempotent — keyed on bookingId, safe to call from both the completion
// finalizer and the admin dispute-resolution path. Honors the facility's
// `transaction_fees` flag: when off, records a NOT_APPLICABLE row so the
// decision is auditable rather than silently skipped.
async function accrueBookingFee(bookingId) {
  const booking = await prisma.shiftBooking.findUnique({
    where: { id: bookingId },
    include: { shift: true },
  });
  if (!booking || !booking.shift) return null;

  const facilityId = booking.shift.facilityId;
  const shiftValue = booking.totalShiftValue || 0;
  const feesOn = await isFlagEnabled(facilityId, 'transaction_fees');

  const status = feesOn ? 'PENDING' : 'NOT_APPLICABLE';
  const feeRate = feesOn ? MARKETPLACE_FEE_RATE : 0;
  const feeAmount = Math.round(shiftValue * feeRate * 100) / 100;

  return prisma.marketplaceFeeLedger.upsert({
    where: { bookingId },
    create: {
      bookingId,
      facilityId,
      providerId: booking.providerId,
      shiftValue,
      feeRate,
      feeAmount,
      status,
    },
    update: {
      // Re-accrual after a dispute resolution recomputes value/amount, but
      // never downgrades a fee already CHARGED.
      shiftValue,
      feeRate,
      feeAmount,
      ...(status === 'PENDING' ? { status: 'PENDING', accruedAt: new Date() } : {}),
    },
  });
}

// Freeze a pending fee while a shift is disputed (defensive — disputed shifts
// don't finalize, so a ledger row usually won't exist yet, but if one does we
// leave it untouched and let resolution re-accrue).
async function feeSummary() {
  const rows = await prisma.marketplaceFeeLedger.findMany({
    select: { status: true, feeAmount: true, accruedAt: true },
  });
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const sum = (f) => rows.filter(f).reduce((s, r) => s + (r.feeAmount || 0), 0);
  const count = (f) => rows.filter(f).length;
  return {
    pendingCount: count((r) => r.status === 'PENDING'),
    pendingAmount: Math.round(sum((r) => r.status === 'PENDING') * 100) / 100,
    chargedAmount: Math.round(sum((r) => r.status === 'CHARGED') * 100) / 100,
    failedCount: count((r) => r.status === 'FAILED'),
    feesThisWeek: Math.round(sum((r) => r.status !== 'NOT_APPLICABLE' && r.accruedAt >= weekAgo) * 100) / 100,
  };
}

module.exports = { MARKETPLACE_FEE_RATE, accrueBookingFee, feeSummary };
