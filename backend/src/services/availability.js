'use strict';

// Shared availability resolution — used by BOTH the schedule builder and the
// facility availability screen so they always agree on who's available.
//
// Policy (set 2026-06-17; PART_TIME added 2026-07-31; onSetSchedule split
// 2026-07-31 — schedule classification is NOT payroll classification):
//   - "Set schedule" people are available by default (exception-based: mark
//     PTO/off) and are drafted onto every month automatically.
//   - Who's on the set schedule: the entry's explicit onSetSchedule override
//     when set (e.g. a full-time 1099 — PER_DIEM for payroll, set-schedule
//     for drafting), otherwise FULL_TIME/PART_TIME yes, PER_DIEM/LOCUMS no.
//   - Everyone else is UNAVAILABLE by default (opt-in: must be marked
//     available by the provider in-app or by the admin).

/** The one place "is this person automatically on the schedule?" is decided. */
function isSetSchedule(entry) {
  if (!entry) return false;
  if (entry.onSetSchedule === true || entry.onSetSchedule === false) return entry.onSetSchedule;
  return entry.employmentCategory === 'FULL_TIME' || entry.employmentCategory === 'PART_TIME';
}

function defaultAvailable(employmentCategory, onSetSchedule) {
  return isSetSchedule({ employmentCategory, onSetSchedule });
}

// Resolve effective availability for one (roster entry, date).
// Precedence: ADMIN override > admin PTO range > provider self-submitted > default.
// Pass null/undefined for any signal that's absent.
//   adminAvailable:    boolean | null  (RosterAvailability source=ADMIN)
//   ptoCovers:         boolean         (a RosterTimeOff range covers the date)
//   providerAvailable: boolean | null  (in-app submission / source=PROVIDER)
function resolveDayAvailability({ employmentCategory, onSetSchedule, adminAvailable, ptoCovers, providerAvailable }) {
  if (adminAvailable === true || adminAvailable === false) {
    return { available: adminAvailable, source: 'ADMIN' };
  }
  if (ptoCovers) {
    return { available: false, source: 'PTO' };
  }
  if (providerAvailable === true || providerAvailable === false) {
    return { available: providerAvailable, source: 'PROVIDER' };
  }
  return { available: defaultAvailable(employmentCategory, onSetSchedule), source: 'DEFAULT' };
}

module.exports = { defaultAvailable, resolveDayAvailability, isSetSchedule };
