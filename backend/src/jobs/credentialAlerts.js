const prisma = require('../config/db')
const { sendExpirationAlertToFacility, sendExpirationReminderToProvider, credTypeName } = require('../services/credentialEmail')
const { daysUntil } = require('../utils/credentialStatus')

async function runCredentialAlerts() {
  try {
    const credentials = await prisma.providerCredential.findMany({
      where: { expirationDate: { not: null } },
      include: {
        provider: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            user: { select: { email: true } },
          },
        },
        reminders: { orderBy: { sentAt: 'desc' }, take: 1 },
      },
    })

    // Group by facility roster entry to alert coordinators
    const rosterEntries = await prisma.facilityRosterEntry.findMany({
      where: { providerId: { not: null }, matchStatus: 'LINKED' },
      include: {
        facility: {
          select: {
            id: true,
            name: true,
            credentialUsers: {
              where: { permission: 'COORDINATOR' },
              select: { email: true, name: true },
            },
          },
        },
      },
    })

    // Map providerId → facilities that have them on roster
    const facilityMap = {}
    for (const entry of rosterEntries) {
      if (!facilityMap[entry.providerId]) facilityMap[entry.providerId] = []
      facilityMap[entry.providerId].push(entry.facility)
    }

    // Facility-level: collect expiring credentials grouped by facility
    const facilityAlerts = {}

    for (const cred of credentials) {
      const days = daysUntil(cred.expirationDate)
      if (days === null) continue

      const providerName = `${cred.provider.firstName || ''} ${cred.provider.lastName || ''}`.trim() || 'Unknown'
      const expDate = new Date(cred.expirationDate).toLocaleDateString('en-US')

      // Facility alerts: 90-day window
      if (days <= 90) {
        const facilities = facilityMap[cred.providerId] || []
        for (const facility of facilities) {
          if (!facilityAlerts[facility.id]) {
            facilityAlerts[facility.id] = { facility, items: [] }
          }
          facilityAlerts[facility.id].items.push({
            providerName,
            credentialType: cred.credentialType,
            expirationDate: expDate,
            daysLeft: Math.floor(days),
          })
        }
      }

      // Provider alerts: 90, 60, 30, 0 days
      const thresholds = [90, 60, 30, 0]
      const floorDays = Math.floor(days)
      if (thresholds.includes(floorDays)) {
        const lastReminder = cred.reminders[0]
        const alreadySentToday = lastReminder &&
          new Date(lastReminder.sentAt).toDateString() === new Date().toDateString() &&
          lastReminder.reminderType === 'PROVIDER_REMINDER'

        if (!alreadySentToday && cred.provider.user?.email) {
          await sendExpirationReminderToProvider(
            cred.provider.user.email,
            providerName,
            cred.credentialType,
            expDate,
            floorDays
          )
          await prisma.credentialReminder.create({
            data: {
              facilityId: rosterEntries.find((e) => e.providerId === cred.providerId)?.facilityId || 'system',
              credentialId: cred.id,
              reminderType: 'PROVIDER_REMINDER',
              expirationDate: cred.expirationDate,
            },
          })
        }
      }
    }

    // Send facility coordinator alerts
    for (const { facility, items } of Object.values(facilityAlerts)) {
      for (const coordinator of facility.credentialUsers) {
        await sendExpirationAlertToFacility(coordinator.email, facility.name, items)
        // Log reminders for items within 30 days (daily)
        for (const item of items.filter((i) => i.daysLeft <= 30)) {
          const cred = credentials.find(
            (c) =>
              c.provider.firstName + ' ' + c.provider.lastName === item.providerName &&
              c.credentialType === item.credentialType
          )
          if (cred) {
            await prisma.credentialReminder.create({
              data: {
                facilityId: facility.id,
                credentialId: cred.id,
                reminderType: 'FACILITY_ALERT',
                expirationDate: cred.expirationDate,
              },
            }).catch(() => {}) // ignore duplicate errors
          }
        }
      }
    }

    console.log(`[credentialAlerts] Ran — checked ${credentials.length} credentials, alerted ${Object.keys(facilityAlerts).length} facilities`)
  } catch (err) {
    console.error('[credentialAlerts] Error:', err)
  }
}

module.exports = { runCredentialAlerts }
