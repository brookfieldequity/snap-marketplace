/**
 * Renewal alerts (2026-07-22) — the recredentialing clock, on the new
 * appointment plane (CredAppointment), not the frozen legacy tables.
 *
 * Daily sweep: any tracked provider whose nextDueAt lands exactly on a
 * threshold day (90/60/30/7/0 days out) triggers one coordinator email per
 * facility, grouped. Exact-day matching keeps it one email per threshold —
 * no daily nagging, no dedupe table needed.
 */

const prisma = require('../config/db')
const { sendRenewalAlertToFacility } = require('../services/credentialEmail')

const THRESHOLDS = [90, 60, 30, 7, 0]

function daysUntil(date) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date)
  const end = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  return Math.round((end - start) / 86400000)
}

async function runRenewalAlerts() {
  try {
    const appointments = await prisma.credAppointment.findMany({
      where: { nextDueAt: { not: null } },
      include: { map: { select: { name: true } } },
    })

    // facilityId → items hitting a threshold today
    const byFacility = {}
    for (const a of appointments) {
      const days = daysUntil(a.nextDueAt)
      if (!THRESHOLDS.includes(days)) continue
      if (!byFacility[a.facilityId]) byFacility[a.facilityId] = []
      byFacility[a.facilityId].push({
        providerName: a.providerName || `NPI ${a.npi}`,
        facilityLabel: a.map?.name || 'Facility',
        dueDate: new Date(a.nextDueAt).toLocaleDateString('en-US'),
        daysLeft: days,
      })
    }

    let sent = 0
    for (const [facilityId, items] of Object.entries(byFacility)) {
      const coordinators = await prisma.credentialUser.findMany({
        where: { facilityId, permission: 'COORDINATOR', isActive: true },
        select: { email: true },
      })
      items.sort((x, y) => x.daysLeft - y.daysLeft)
      for (const c of coordinators) {
        await sendRenewalAlertToFacility(c.email, items).catch((err) =>
          console.error('[renewalAlerts] email failed:', err.message)
        )
        sent++
      }
    }

    console.log(`[renewalAlerts] Ran — ${appointments.length} tracked, ${Object.keys(byFacility).length} facilities hit thresholds, ${sent} emails`)
  } catch (err) {
    console.error('[renewalAlerts] Error:', err)
  }
}

module.exports = { runRenewalAlerts }
