'use strict';

// Shared availability resolution — used by BOTH the schedule builder and the
// facility availability screen so they always agree on who's available.
//
// Policy (set 2026-06-17; PART_TIME added 2026-07-31):
//   - FULL_TIME staff are available by default (exception-based: mark PTO/off).
//   - PART_TIME (W2 set-schedule people — the 80%/60% folks) work every
//     month too: available by default, exception-based like full-timers.
//     Their reduced load is expressed as fteHours (32 = 80%, 24 = 60%),
//     which drives the expected-days math, not day-by-day opt-in.
//   - PER_DIEM / LOCUMS are UNAVAILABLE by default (opt-in: must be marked
//     available by the provider in-app or by the admin).

function defaultAvailable(employmentCategory) {
  return employmentCategory === 'FULL_TIME' || employmentCategory === 'PART_TIME';
}

// Resolve effective availability for one (roster entry, date).
// Precedence: ADMIN override > admin PTO range > provider self-submitted > default.
// Pass null/undefined for any signal that's absent.
//   adminAvailable:    boolean | null  (RosterAvailability source=ADMIN)
//   ptoCovers:         boolean         (a RosterTimeOff range covers the date)
//   providerAvailable: boolean | null  (in-app submission / source=PROVIDER)
function resolveDayAvailability({ employmentCategory, adminAvailable, ptoCovers, providerAvailable }) {
  if (adminAvailable === true || adminAvailable === false) {
    return { available: adminAvailable, source: 'ADMIN' };
  }
  if (ptoCovers) {
    return { available: false, source: 'PTO' };
  }
  if (providerAvailable === true || providerAvailable === false) {
    return { available: providerAvailable, source: 'PROVIDER' };
  }
  return { available: defaultAvailable(employmentCategory), source: 'DEFAULT' };
}

module.exports = { defaultAvailable, resolveDayAvailability };
