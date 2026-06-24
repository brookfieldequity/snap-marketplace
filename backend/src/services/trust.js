// Trust layer — aggregate ratings + verification badges.
//
// Ratings and credential state already live in the DB (ProviderRating /
// FacilityRating / ProviderProfile); this module is the single place that
// turns them into the small, display-ready trust signals the marketplace
// surfaces on shift cards, provider profiles, and applicant lists.
//
// Keep these helpers batch-friendly (take an array of ids, return a Map) so
// callers never N+1 a list of shifts or applicants.

const prisma = require('../config/db');

// Round to one decimal, but only when there's at least one rating.
function summarize(stars) {
  if (!stars.length) return { avg: null, count: 0 };
  const sum = stars.reduce((a, s) => a + s, 0);
  return { avg: Math.round((sum / stars.length) * 10) / 10, count: stars.length };
}

// facilityId -> { avg, count } over ProviderRating? No — a *facility's* public
// rating is what providers gave it, i.e. FacilityRating rows for that facility.
async function aggregateFacilityRatings(facilityIds = []) {
  const ids = [...new Set(facilityIds.filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const rows = await prisma.facilityRating.findMany({
    where: { facilityId: { in: ids } },
    select: { facilityId: true, stars: true },
  });
  const byFacility = new Map(ids.map((id) => [id, []]));
  for (const r of rows) byFacility.get(r.facilityId)?.push(r.stars);
  for (const [id, stars] of byFacility) map.set(id, summarize(stars));
  return map;
}

// providerId -> { avg, count } over the ratings facilities gave the provider.
async function aggregateProviderRatings(providerIds = []) {
  const ids = [...new Set(providerIds.filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const rows = await prisma.providerRating.findMany({
    where: { providerId: { in: ids } },
    select: { providerId: true, stars: true },
  });
  const byProvider = new Map(ids.map((id) => [id, []]));
  for (const r of rows) byProvider.get(r.providerId)?.push(r.stars);
  for (const [id, stars] of byProvider) map.set(id, summarize(stars));
  return map;
}

// Derive the verification badges for one provider from data already on the
// profile. Each badge is { key, label, tone } so the client renders without
// re-deriving logic. `tone` maps to a color treatment (good / info / neutral).
//
// Pass `{ completedShifts }` when known (e.g. from _count.bookings) to unlock
// the experience badge; it's optional so callers without the count still work.
function deriveProviderBadges(provider, { completedShifts } = {}) {
  if (!provider) return [];
  const badges = [];

  if (provider.credentialed) {
    badges.push({ key: 'CREDENTIALED', label: 'SNAP Credentialed', tone: 'good' });
  }

  // License on file AND not expired → "Licensed". Expired but on file → flag.
  if (provider.maLicenseNumber) {
    const exp = provider.maLicenseExpiry ? new Date(provider.maLicenseExpiry) : null;
    const expired = exp && exp.getTime() < Date.now();
    if (!expired) {
      badges.push({ key: 'LICENSED', label: 'License Verified', tone: 'good' });
    } else {
      badges.push({ key: 'LICENSE_EXPIRED', label: 'License Expired', tone: 'warn' });
    }
  }

  if (provider.vipStatus) {
    badges.push({ key: 'VIP', label: 'VIP Provider', tone: 'info' });
  }

  if (typeof completedShifts === 'number' && completedShifts >= 5) {
    badges.push({ key: 'EXPERIENCED', label: `${completedShifts}+ SNAP shifts`, tone: 'info' });
  }

  return badges;
}

module.exports = {
  aggregateFacilityRatings,
  aggregateProviderRatings,
  deriveProviderBadges,
};
