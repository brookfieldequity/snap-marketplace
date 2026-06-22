// VITE_API_URL is set per-environment:
//   - Railway: set in the web service's Variables tab
//   - Local dev: set in web/.env.local (points to localhost:3001)
//   - Netlify: set in site environment variables
const BASE = import.meta.env.VITE_API_URL || 'https://api.snapmedical.app/api'

// ─── Token helpers ────────────────────────────────────────────────────────────

function getFacilityToken() {
  return localStorage.getItem('snapFacilityToken')
}

function getAdminToken() {
  return localStorage.getItem('snapAdminToken')
}

function facilityHeaders(extra = {}) {
  const token = getFacilityToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

function adminHeaders(extra = {}) {
  const token = getAdminToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.message || data.error || `HTTP ${res.status}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

// ─── Shared auth API (forgot/reset password — OTP code flow, no auth header) ───

export const authAPI = {
  forgotPassword: (email) =>
    apiFetch(`${BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  resetPassword: (email, code, newPassword) =>
    apiFetch(`${BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, newPassword }),
    }),
}

// ─── Facility API ─────────────────────────────────────────────────────────────

export const facilityAPI = {
  login: (email, password) =>
    apiFetch(`${BASE}/auth/facility/login`, {
      method: 'POST',
      headers: facilityHeaders(),
      body: JSON.stringify({ email, password }),
    }),

  register: (payload) =>
    apiFetch(`${BASE}/auth/facility/register`, {
      method: 'POST',
      headers: facilityHeaders(),
      body: JSON.stringify(payload),
    }),

  getMe: () =>
    apiFetch(`${BASE}/facilities/me`, {
      headers: facilityHeaders(),
    }),

  updateMe: (payload) =>
    apiFetch(`${BASE}/facilities/me`, {
      method: 'PATCH',
      headers: facilityHeaders(),
      body: JSON.stringify(payload),
    }),

  getDashboard: () =>
    apiFetch(`${BASE}/facilities/me/dashboard`, {
      headers: facilityHeaders(),
    }),

  getSubscription: () =>
    apiFetch(`${BASE}/facilities/me/subscription`, {
      headers: facilityHeaders(),
    }),

  upgradeSubscription: (tier) =>
    apiFetch(`${BASE}/facilities/me/subscription/upgrade`, {
      method: 'POST',
      headers: facilityHeaders(),
      body: JSON.stringify({ tier }),
    }),

  getShifts: () =>
    apiFetch(`${BASE}/shifts/facility/mine`, {
      headers: facilityHeaders(),
    }),

  postShift: (payload) =>
    apiFetch(`${BASE}/shifts`, {
      method: 'POST',
      headers: facilityHeaders(),
      body: JSON.stringify(payload),
    }),

  confirmDeposit: (shiftId) =>
    apiFetch(`${BASE}/shifts/${shiftId}/confirm-deposit`, {
      method: 'POST',
      headers: facilityHeaders(),
    }),

  reviewApplication: (shiftId, applicationId, status) =>
    apiFetch(`${BASE}/shifts/${shiftId}/applications/${applicationId}`, {
      method: 'PATCH',
      headers: facilityHeaders(),
      body: JSON.stringify({ status }),
    }),

  getProviders: () =>
    apiFetch(`${BASE}/facilities/me/providers`, {
      headers: facilityHeaders(),
    }),

  addPreferred: (providerId) =>
    apiFetch(`${BASE}/facilities/me/preferred/${providerId}`, {
      method: 'POST',
      headers: facilityHeaders(),
    }),

  removePreferred: (providerId) =>
    apiFetch(`${BASE}/facilities/me/preferred/${providerId}`, {
      method: 'DELETE',
      headers: facilityHeaders(),
    }),

  uploadPhotos: async (formData) => {
    const token = getFacilityToken()
    const res = await fetch(`${BASE}/uploads/facility-photos`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  },

  deletePhoto: (url) =>
    apiFetch(`${BASE}/uploads/facility-photos`, {
      method: 'DELETE',
      headers: facilityHeaders(),
      body: JSON.stringify({ url }),
    }),

  // Mode
  setMode: (snapMode) =>
    apiFetch(`${BASE}/facilities/me/mode`, {
      method: 'PATCH',
      headers: facilityHeaders(),
      body: JSON.stringify({ snapMode }),
    }),

  // Internal Roster
  getRoster: () => apiFetch(`${BASE}/roster`, { headers: facilityHeaders() }),
  getPtoSummary: (year) => apiFetch(`${BASE}/roster/pto-summary${year ? `?year=${year}` : ''}`, { headers: facilityHeaders() }),
  getRosterLocations: () => apiFetch(`${BASE}/roster/locations`, { headers: facilityHeaders() }),
  createRosterEntry: (data) => apiFetch(`${BASE}/roster`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  updateRosterEntry: (id, data) => apiFetch(`${BASE}/roster/${id}`, { method: 'PATCH', headers: facilityHeaders(), body: JSON.stringify(data) }),
  deleteRosterEntry: (id) => apiFetch(`${BASE}/roster/${id}`, { method: 'DELETE', headers: facilityHeaders() }),
  bulkDeleteRoster: (ids) => apiFetch(`${BASE}/roster/bulk-delete`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ ids, confirm: 'DELETE SELECTED' }) }),
  clearAllRoster: () => apiFetch(`${BASE}/roster/clear-all`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ confirm: 'DELETE ALL' }) }),
  getSiteRates: () => apiFetch(`${BASE}/facilities/me/site-rates`, { headers: facilityHeaders() }),
  setSiteRate: (siteName, ratePerDay) => apiFetch(`${BASE}/facilities/me/site-rates/${encodeURIComponent(siteName)}`, { method: 'PUT', headers: facilityHeaders(), body: JSON.stringify({ ratePerDay }) }),
  deleteSiteRate: (siteName) => apiFetch(`${BASE}/facilities/me/site-rates/${encodeURIComponent(siteName)}`, { method: 'DELETE', headers: facilityHeaders() }),
  inviteRosterProvider: (id) => apiFetch(`${BASE}/roster/${id}/invite`, { method: 'POST', headers: facilityHeaders() }),

  // Provider schedule requests (Task #21) — facility side
  getScheduleRequests: (status) => apiFetch(`${BASE}/schedule-requests${status ? `?status=${status}` : ''}`, { headers: facilityHeaders() }),
  decideScheduleRequest: (id, decision) => apiFetch(`${BASE}/schedule-requests/${id}/decide`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ decision }) }),

  // Snappy AI assistant (Task #17)
  snappyChat: (messages) => apiFetch(`${BASE}/snappy/chat`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ messages }) }),
  bulkInviteCredentialing: (rosterIds) => apiFetch(`${BASE}/roster/bulk-invite`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ rosterIds }) }),
  syncCredentialingStatus: () => apiFetch(`${BASE}/roster/sync-credentialing`, { method: 'POST', headers: facilityHeaders() }),
  reclassifyRosterTypes: () => apiFetch(`${BASE}/roster/reclassify-from-nppes`, { method: 'POST', headers: facilityHeaders() }),
  resolveRosterFromRegistry: () => apiFetch(`${BASE}/roster/resolve-from-registry`, { method: 'POST', headers: facilityHeaders() }),
  inviteRosterToApp: (id) => apiFetch(`${BASE}/roster/${id}/invite-to-app`, { method: 'POST', headers: facilityHeaders() }),
  bulkInviteRosterToApp: (ids) => apiFetch(`${BASE}/roster/bulk-invite-to-app`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ ids }) }),
  relinkRoster: () => apiFetch(`${BASE}/roster/relink`, { method: 'POST', headers: facilityHeaders() }),

  // Availability Windows
  getWindows: () => apiFetch(`${BASE}/windows`, { headers: facilityHeaders() }),
  createWindow: (data) => apiFetch(`${BASE}/windows`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  updateWindow: (id, data) => apiFetch(`${BASE}/windows/${id}`, { method: 'PATCH', headers: facilityHeaders(), body: JSON.stringify(data) }),
  deleteWindow: (id) => apiFetch(`${BASE}/windows/${id}`, { method: 'DELETE', headers: facilityHeaders() }),
  activateWindow: (id) => apiFetch(`${BASE}/windows/${id}/activate`, { method: 'POST', headers: facilityHeaders() }),
  sendWindowReminder: (id) => apiFetch(`${BASE}/windows/${id}/remind`, { method: 'POST', headers: facilityHeaders() }),
  getWindowReport: (id) => apiFetch(`${BASE}/windows/${id}/report`, { headers: facilityHeaders() }),

  // Schedule Builder
  scheduleExists: () => apiFetch(`${BASE}/schedule/exists`, { headers: facilityHeaders() }),
  getScheduleMonth: (year, month) => apiFetch(`${BASE}/schedule/month?year=${year}&month=${month}`, { headers: facilityHeaders() }),
  upsertScheduleDay: (data) => apiFetch(`${BASE}/schedule/days`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  deleteScheduleDay: (dayId) => apiFetch(`${BASE}/schedule/days/${dayId}`, { method: 'DELETE', headers: facilityHeaders() }),
  recordScheduleFeedback: (data) => apiFetch(`${BASE}/schedule/feedback`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  getScheduleIntelligence: () => apiFetch(`${BASE}/schedule/intelligence`, { headers: facilityHeaders() }),
  assignProvider: (dayId, roomNumber, rosterId, role) => apiFetch(`${BASE}/schedule/days/${dayId}/assignments/${roomNumber}`, { method: 'PUT', headers: facilityHeaders(), body: JSON.stringify(role !== undefined ? { rosterId, role } : { rosterId }) }),
  publishSchedule: (year, month) => apiFetch(`${BASE}/schedule/publish`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ year, month }) }),
  // Out-List Builder (release order). order = [assignmentId, …] 1=leaves first.
  getOutList: (dayId) => apiFetch(`${BASE}/schedule/days/${dayId}/out-list`, { headers: facilityHeaders() }),
  saveOutList: (dayId, order, publish) => apiFetch(`${BASE}/schedule/days/${dayId}/out-list`, { method: 'PUT', headers: facilityHeaders(), body: JSON.stringify({ order, publish }) }),
  // Out-List rule set (admin) + one-click auto-build over a week/month.
  getOutListRules: () => apiFetch(`${BASE}/schedule/out-list-rules`, { headers: facilityHeaders() }),
  saveOutListRules: (rules) => apiFetch(`${BASE}/schedule/out-list-rules`, { method: 'PUT', headers: facilityHeaders(), body: JSON.stringify({ rules }) }),
  autoBuildOutList: (body) => apiFetch(`${BASE}/schedule/out-list/auto`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(body) }),
  exportSchedule: (year, month) => apiFetch(`${BASE}/schedule/export?year=${year}&month=${month}`, { headers: facilityHeaders() }),
  getScheduleSummary: (year, month) => apiFetch(`${BASE}/schedule/summary?year=${year}&month=${month}`, { headers: facilityHeaders() }),
  // Materialize ScheduleDay rows for a month from a Coverage Template.
  // Skips holidays automatically (computed server-side). Idempotent.
  generateScheduleFromTemplate: (year, month, templateId) =>
    apiFetch(`${BASE}/schedule/generate`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ year, month, templateId }) }),
  clearScheduleMonth: (year, month) =>
    apiFetch(`${BASE}/schedule/month?year=${year}&month=${month}`, { method: 'DELETE', headers: facilityHeaders() }),

  // Internal Roster — monthly availability (feeds the Schedule Builder)
  getRosterAvailability: (month) => apiFetch(`${BASE}/roster-availability?month=${encodeURIComponent(month)}`, { headers: facilityHeaders() }),
  setRosterAvailability: (body) => apiFetch(`${BASE}/roster-availability`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(body) }),
  setRosterAvailabilityRange: (body) => apiFetch(`${BASE}/roster-availability/range`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(body) }),
  clearRosterAvailability: (body) => apiFetch(`${BASE}/roster-availability`, { method: 'DELETE', headers: facilityHeaders(), body: JSON.stringify(body) }),
  copyRosterAvailabilityMonth: (body) => apiFetch(`${BASE}/roster-availability/copy-month`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(body) }),

  // Internal Roster — time off / PTO
  getTimeOff: (from, to) => {
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    const qs = q.toString()
    return apiFetch(`${BASE}/roster/time-off${qs ? `?${qs}` : ''}`, { headers: facilityHeaders() })
  },
  addTimeOff: (rosterId, data) => apiFetch(`${BASE}/roster/${rosterId}/time-off`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  deleteTimeOff: (timeOffId) => apiFetch(`${BASE}/roster/time-off/${timeOffId}`, { method: 'DELETE', headers: facilityHeaders() }),

  // Internal Roster — NPI disambiguation (review queue from multi-sheet imports)
  getNpiReview: () => apiFetch(`${BASE}/roster/npi-review`, { headers: facilityHeaders() }),
  resolveNpi: (id, body) => apiFetch(`${BASE}/roster/${id}/resolve-npi`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(body) }),
  searchNpi: (name, state = 'MA') => apiFetch(`${BASE}/roster/npi-search?name=${encodeURIComponent(name)}&state=${encodeURIComponent(state)}`, { headers: facilityHeaders() }),

  // Internal Roster — bulk CSV/XLSX upload
  uploadRoster: async (file) => {
    const fd = new FormData()
    fd.append('file', file)
    const token = localStorage.getItem('snapFacilityToken')
    return apiFetch(`${BASE}/roster/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
  },
  // Returns a CSV template URL (with auth token in URL via fetch + blob)
  downloadRosterTemplateUrl: () => `${BASE}/roster/upload/template`,

  // Schedule Builder v2 — kick off one or more algorithm modes; results
  // grouped by buildBatchId. See docs/schedule-builder-v2-design.md.
  buildSchedule: (year, month, modes) =>
    apiFetch(`${BASE}/schedule/build`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ year, month, modes }) }),
  getBuildBatch: (batchId) => apiFetch(`${BASE}/schedule/build/${batchId}`, { headers: facilityHeaders() }),
  selectBuildRun: (runId) => apiFetch(`${BASE}/schedule/build/${runId}/select`, { method: 'POST', headers: facilityHeaders() }),
  rescoreBuildRun: (runId) => apiFetch(`${BASE}/schedule/build/${runId}/rescore`, { method: 'POST', headers: facilityHeaders() }),

  // Coverage Templates (per-practice staffing patterns).
  // See docs/coverage-templates-design.md.
  getCoverageTemplates: () => apiFetch(`${BASE}/coverage-templates`, { headers: facilityHeaders() }),
  getCoverageTemplate: (id) => apiFetch(`${BASE}/coverage-templates/${id}`, { headers: facilityHeaders() }),
  createCoverageTemplate: (data) => apiFetch(`${BASE}/coverage-templates`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  updateCoverageTemplate: (id, data) => apiFetch(`${BASE}/coverage-templates/${id}`, { method: 'PATCH', headers: facilityHeaders(), body: JSON.stringify(data) }),
  deleteCoverageTemplate: (id) => apiFetch(`${BASE}/coverage-templates/${id}`, { method: 'DELETE', headers: facilityHeaders() }),
  duplicateCoverageTemplate: (id, name) => apiFetch(`${BASE}/coverage-templates/${id}/duplicate`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ name }) }),

  // Holidays (effective per-facility list = federal merged with overrides).
  getHolidays: (facilityId, year) => apiFetch(`${BASE}/facilities/${facilityId}/holidays?year=${year}`, { headers: facilityHeaders() }),
  addHoliday: (facilityId, date, label) => apiFetch(`${BASE}/facilities/${facilityId}/holidays`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ date, label }) }),
  excludeFederalHoliday: (facilityId, date) => apiFetch(`${BASE}/facilities/${facilityId}/holidays/exclude`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ date }) }),
  removeHolidayOverride: (facilityId, date) => apiFetch(`${BASE}/facilities/${facilityId}/holidays/${date}`, { method: 'DELETE', headers: facilityHeaders() }),

  // Incentive Shifts
  getIncentiveShifts: (status) => apiFetch(`${BASE}/incentive${status ? `?status=${status}` : ''}`, { headers: facilityHeaders() }),
  createIncentiveShift: (data) => apiFetch(`${BASE}/incentive`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  escalateIncentiveShift: (id) => apiFetch(`${BASE}/incentive/${id}/escalate`, { method: 'POST', headers: facilityHeaders() }),

  // StaffIQ
  getStaffIQInsights: () => apiFetch(`${BASE}/staffiq`, { headers: facilityHeaders() }),
  runStaffIQAnalysis: () => apiFetch(`${BASE}/staffiq/analyze`, { method: 'POST', headers: facilityHeaders() }),
  getStaffIQDashboard: () => apiFetch(`${BASE}/staffiq/dashboard`, { headers: facilityHeaders() }),
  getStaffIQScore: (period) => apiFetch(`${BASE}/staffiq/score?period=${period}`, { headers: facilityHeaders() }),
  getStaffIQInputs: () => apiFetch(`${BASE}/staffiq/inputs`, { headers: facilityHeaders() }),
  saveStaffIQInputs: (data) => apiFetch(`${BASE}/staffiq/inputs`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  getStaffIQScoreHistory: () => apiFetch(`${BASE}/staffiq/score-history`, { headers: facilityHeaders() }),
  submitStaffIQLead: (data) => apiFetch(`${BASE}/calculator/generate-report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),

  // Data Upload
  getUploads: () => apiFetch(`${BASE}/data-upload`, { headers: facilityHeaders() }),
  uploadScheduleData: async (formData) => {
    const token = localStorage.getItem('snapFacilityToken');
    const res = await fetch(`${BASE}/data-upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  confirmUpload: (data) => apiFetch(`${BASE}/data-upload/confirm`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),

  // Calculator
  calcAgencyReplacement: (inputs) => apiFetch(`${BASE}/calculator/agency-replacement`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inputs) }),
  calcEfficiency: (inputs) => apiFetch(`${BASE}/calculator/efficiency`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inputs) }),
  generateCalcReport: (data) => apiFetch(`${BASE}/calculator/generate-report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),

  // StaffIQ Inputs
  getStaffIQScore: (period) => apiFetch(`${BASE}/staffiq-inputs/score${period ? `?period=${period}` : ''}`, { headers: facilityHeaders() }),
  getStaffIQInputs: () => apiFetch(`${BASE}/staffiq-inputs`, { headers: facilityHeaders() }),
  saveStaffIQInputs: (data) => apiFetch(`${BASE}/staffiq-inputs`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  getStaffIQScoreHistory: () => apiFetch(`${BASE}/staffiq-inputs/history`, { headers: facilityHeaders() }),

  // StaffIQ Calculator (no auth)
  calcStaffIQSimple: (inputs) => apiFetch(`${BASE}/calculator/staffiq-simple`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inputs) }),
  submitStaffIQLead: (data) => apiFetch(`${BASE}/calculator/staffiq-simple/lead`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),

  // Feature flags — this facility's effective access (drives nav gating)
  getFeatureFlags: () => apiFetch(`${BASE}/feature-flags/me`, { headers: facilityHeaders() }),
}

// ─── Payroll Builder API (SNAP Shifts) ────────────────────────────────────────

export const payrollAPI = {
  getConfig: () => apiFetch(`${BASE}/payroll/config`, { headers: facilityHeaders() }),
  uploadTemplate: async (system, file, fileCode) => {
    const fd = new FormData()
    fd.append('system', system)
    fd.append('file', file)
    if (fileCode) fd.append('fileCode', fileCode)
    const token = localStorage.getItem('snapFacilityToken')
    return apiFetch(`${BASE}/payroll/template`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
  },
  saveMapping: (system, fieldMapping, fileCode) =>
    apiFetch(`${BASE}/payroll/template/${system}/mapping`, {
      method: 'PUT',
      headers: facilityHeaders(),
      body: JSON.stringify({ fieldMapping, fileCode }),
    }),
  resetTemplate: (system) =>
    apiFetch(`${BASE}/payroll/template/${system}`, { method: 'DELETE', headers: facilityHeaders() }),
  preview: ({ payClass, periodStart, periodEnd }) =>
    apiFetch(`${BASE}/payroll/preview?payClass=${payClass}&periodStart=${periodStart}&periodEnd=${periodEnd}`, {
      headers: facilityHeaders(),
    }),
  exportRun: (payload) =>
    apiFetch(`${BASE}/payroll/runs`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(payload) }),
  getRuns: () => apiFetch(`${BASE}/payroll/runs`, { headers: facilityHeaders() }),
  getRun: (id) => apiFetch(`${BASE}/payroll/runs/${id}`, { headers: facilityHeaders() }),
  setProviderRate: (rosterEntryId, data) =>
    apiFetch(`${BASE}/payroll/providers/${rosterEntryId}/rate`, {
      method: 'PATCH',
      headers: facilityHeaders(),
      body: JSON.stringify(data),
    }),
  getRateHistory: (rosterEntryId) =>
    apiFetch(`${BASE}/payroll/providers/${rosterEntryId}/rate-history`, { headers: facilityHeaders() }),
  // Provider worked-hours entry (coordinator surface).
  getHourEntries: ({ periodStart, periodEnd }) =>
    apiFetch(`${BASE}/hour-entry?periodStart=${periodStart}&periodEnd=${periodEnd}`, { headers: facilityHeaders() }),
  seedHourEntries: ({ periodStart, periodEnd }) =>
    apiFetch(`${BASE}/hour-entry/seed`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ periodStart, periodEnd }) }),
  // Ingest an APNE Gusto-format 1099 payroll sheet for a period (seeds roster +
  // records CAPA hours + bonus + reimbursement).
  importPayrollSheet: async ({ periodStart, periodEnd, file }) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('periodStart', periodStart)
    fd.append('periodEnd', periodEnd)
    const token = localStorage.getItem('snapFacilityToken')
    return apiFetch(`${BASE}/hour-entry/import-payroll-sheet`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
  },
  addHourEntry: (payload) =>
    apiFetch(`${BASE}/hour-entry`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(payload) }),
  updateHourEntry: (id, patch) =>
    apiFetch(`${BASE}/hour-entry/${id}`, { method: 'PATCH', headers: facilityHeaders(), body: JSON.stringify(patch) }),
  submitHourEntries: ({ periodStart, periodEnd, rosterEntryId }) =>
    apiFetch(`${BASE}/hour-entry/submit`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ periodStart, periodEnd, rosterEntryId }) }),
  deleteHourEntry: (id) =>
    apiFetch(`${BASE}/hour-entry/${id}`, { method: 'DELETE', headers: facilityHeaders() }),
  // Agency invoice — the "CAPA All in" deliverable. JSON for the on-screen view.
  getAgencyInvoice: ({ periodStart, periodEnd }) =>
    apiFetch(`${BASE}/payroll/agency-invoice?periodStart=${periodStart}&periodEnd=${periodEnd}`, {
      headers: facilityHeaders(),
    }),
  getAgencyMetrics: ({ periodStart, periodEnd }) =>
    apiFetch(`${BASE}/payroll/agency-metrics?periodStart=${periodStart}&periodEnd=${periodEnd}`, {
      headers: facilityHeaders(),
    }),
  // Download one agency's invoice as .xlsx (auth header → blob → save).
  downloadAgencyInvoice: async ({ periodStart, periodEnd, employerId, fileName }) => {
    const qs = new URLSearchParams({ periodStart, periodEnd, ...(employerId ? { employerId } : {}) })
    const res = await fetch(`${BASE}/payroll/agency-invoice/export?${qs}`, { headers: facilityHeaders() })
    if (!res.ok) throw new Error('Failed to download invoice')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || 'agency-invoice.xlsx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}

// ─── PTO Builder API (Feature B) ──────────────────────────────────────────────
export const ptoBuilderAPI = {
  // Facility / admin (authenticated)
  getWindows: (year) => apiFetch(`${BASE}/pto-builder/windows${year ? `?year=${year}` : ''}`, { headers: facilityHeaders() }),
  createWindow: (data) => apiFetch(`${BASE}/pto-builder/windows`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  getWindow: (id) => apiFetch(`${BASE}/pto-builder/windows/${id}`, { headers: facilityHeaders() }),
  updateWindow: (id, data) => apiFetch(`${BASE}/pto-builder/windows/${id}`, { method: 'PATCH', headers: facilityHeaders(), body: JSON.stringify(data) }),
  setStatus: (id, status) => apiFetch(`${BASE}/pto-builder/windows/${id}/status`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ status }) }),
  setCapacity: (id, overrides) => apiFetch(`${BASE}/pto-builder/windows/${id}/capacity`, { method: 'PUT', headers: facilityHeaders(), body: JSON.stringify({ overrides }) }),
  allocate: (id) => apiFetch(`${BASE}/pto-builder/windows/${id}/allocate`, { method: 'POST', headers: facilityHeaders() }),
  getCalendar: (id) => apiFetch(`${BASE}/pto-builder/windows/${id}/calendar`, { headers: facilityHeaders() }),
  getResults: (id) => apiFetch(`${BASE}/pto-builder/windows/${id}/results`, { headers: facilityHeaders() }),
  getRankLinks: (id) => apiFetch(`${BASE}/pto-builder/windows/${id}/rank-links`, { headers: facilityHeaders() }),
  cancelAllocation: (id) => apiFetch(`${BASE}/pto-builder/allocations/${id}/cancel`, { method: 'POST', headers: facilityHeaders() }),
  promoteAllocation: (id, force) => apiFetch(`${BASE}/pto-builder/allocations/${id}/promote`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ force: !!force }) }),
  // Provider ranking (public — token in URL, no auth header)
  getRank: (token) => apiFetch(`${BASE}/pto-builder/rank/${token}`),
  submitRank: (token, bids) => apiFetch(`${BASE}/pto-builder/rank/${token}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bids }) }),
}

// ─── Credential API ───────────────────────────────────────────────────────────

function getCredToken() {
  return localStorage.getItem('snapCredToken')
}

function credHeaders(extra = {}) {
  const token = getCredToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

export const credentialAPI = {
  login: (email, password) =>
    apiFetch(`${BASE}/credentialing/auth/login`, { method: 'POST', headers: credHeaders(), body: JSON.stringify({ email, password }) }),
  me: () => apiFetch(`${BASE}/credentialing/auth/me`, { headers: credHeaders() }),
  forgotPassword: (email) =>
    apiFetch(`${BASE}/credentialing/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }),
  resetPassword: (token, password) =>
    apiFetch(`${BASE}/credentialing/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) }),
  changePassword: (newPassword) =>
    apiFetch(`${BASE}/credentialing/auth/change-password`, { method: 'POST', headers: credHeaders(), body: JSON.stringify({ newPassword }) }),

  // Users
  getUsers: () => apiFetch(`${BASE}/credentialing/users`, { headers: credHeaders() }),
  createUser: (data) => apiFetch(`${BASE}/credentialing/users`, { method: 'POST', headers: credHeaders(), body: JSON.stringify(data) }),
  updateUser: (id, data) => apiFetch(`${BASE}/credentialing/users/${id}`, { method: 'PATCH', headers: credHeaders(), body: JSON.stringify(data) }),
  deleteUser: (id) => apiFetch(`${BASE}/credentialing/users/${id}`, { method: 'DELETE', headers: credHeaders() }),

  // Roster
  getRoster: () => apiFetch(`${BASE}/credentialing/roster`, { headers: credHeaders() }),
  addRosterEntry: (data) => apiFetch(`${BASE}/credentialing/roster`, { method: 'POST', headers: credHeaders(), body: JSON.stringify(data) }),
  removeRosterEntry: (id) => apiFetch(`${BASE}/credentialing/roster/${id}`, { method: 'DELETE', headers: credHeaders() }),
  inviteRosterEntry: (id) => apiFetch(`${BASE}/credentialing/roster/${id}/invite`, { method: 'POST', headers: credHeaders() }),
  getRosterTemplate: () => `${BASE}/credentialing/roster/template`,
  bulkUploadRoster: async (csvText) => {
    const token = getCredToken()
    const res = await fetch(`${BASE}/credentialing/roster/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: csvText,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  },

  // Providers
  getSummary: () => apiFetch(`${BASE}/credentialing/providers/summary`, { headers: credHeaders() }),
  getProviders: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return apiFetch(`${BASE}/credentialing/providers${q ? `?${q}` : ''}`, { headers: credHeaders() })
  },
  getProvider: (providerId) => apiFetch(`${BASE}/credentialing/providers/${providerId}`, { headers: credHeaders() }),
  getProviderActivity: (providerId) => apiFetch(`${BASE}/credentialing/providers/${providerId}/activity`, { headers: credHeaders() }),
  exportProviders: () => `${BASE}/credentialing/providers/export`,

  // Credentials
  getDocToken: (providerId, type) => apiFetch(`${BASE}/credentialing/providers/${providerId}/documents/${type}/token`, { headers: credHeaders() }),
  uploadDocument: async (providerId, type, file) => {
    const token = getCredToken()
    const form = new FormData()
    form.append('document', file)
    const res = await fetch(`${BASE}/credentialing/providers/${providerId}/documents/${type}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  },

  // Actions
  verifyCredential: (providerId, type, notes) => apiFetch(`${BASE}/credentialing/providers/${providerId}/credentials/${type}/verify`, { method: 'POST', headers: credHeaders(), body: JSON.stringify({ notes }) }),
  unverifyCredential: (providerId, type) => apiFetch(`${BASE}/credentialing/providers/${providerId}/credentials/${type}/verify`, { method: 'DELETE', headers: credHeaders() }),
  flagCredential: (providerId, type, notes) => apiFetch(`${BASE}/credentialing/providers/${providerId}/credentials/${type}/flag`, { method: 'POST', headers: credHeaders(), body: JSON.stringify({ notes }) }),
  resolveFlag: (providerId, type, flagId) => apiFetch(`${BASE}/credentialing/providers/${providerId}/credentials/${type}/flag/${flagId}`, { method: 'DELETE', headers: credHeaders() }),
  addNote: (providerId, noteText, credentialId) => apiFetch(`${BASE}/credentialing/providers/${providerId}/notes`, { method: 'POST', headers: credHeaders(), body: JSON.stringify({ noteText, credentialId }) }),
  sendReminder: (providerId, credentialType, message) => apiFetch(`${BASE}/credentialing/providers/${providerId}/remind`, { method: 'POST', headers: credHeaders(), body: JSON.stringify({ credentialType, message }) }),
  requestDocument: (providerId, credentialType, toEmail, message) => apiFetch(`${BASE}/credentialing/providers/${providerId}/request-document`, { method: 'POST', headers: credHeaders(), body: JSON.stringify({ credentialType, toEmail, message }) }),

  // Roster-keyed provider file (unlinked providers)
  getRosterFile: (rosterId) => apiFetch(`${BASE}/credentialing/roster/${rosterId}/file`, { headers: credHeaders() }),
  uploadRosterDocument: async (rosterId, type, file) => {
    const token = getCredToken()
    const form = new FormData()
    form.append('document', file)
    const res = await fetch(`${BASE}/credentialing/roster/${rosterId}/documents/${type}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  },
  getRosterDocToken: (rosterId, type) => apiFetch(`${BASE}/credentialing/roster/${rosterId}/documents/${type}/token`, { headers: credHeaders() }),
  verifyRosterCredential: (rosterId, type, notes) => apiFetch(`${BASE}/credentialing/roster/${rosterId}/credentials/${type}/verify`, { method: 'POST', headers: credHeaders(), body: JSON.stringify({ notes }) }),
  unverifyRosterCredential: (rosterId, type) => apiFetch(`${BASE}/credentialing/roster/${rosterId}/credentials/${type}/verify`, { method: 'DELETE', headers: credHeaders() }),
  flagRosterCredential: (rosterId, type, notes) => apiFetch(`${BASE}/credentialing/roster/${rosterId}/credentials/${type}/flag`, { method: 'POST', headers: credHeaders(), body: JSON.stringify({ notes }) }),
  resolveRosterFlag: (rosterId, type, flagId) => apiFetch(`${BASE}/credentialing/roster/${rosterId}/credentials/${type}/flag/${flagId}`, { method: 'DELETE', headers: credHeaders() }),
  addRosterNote: (rosterId, noteText, credentialId) => apiFetch(`${BASE}/credentialing/roster/${rosterId}/notes`, { method: 'POST', headers: credHeaders(), body: JSON.stringify({ noteText, credentialId }) }),

  // Audit
  getAuditLog: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return apiFetch(`${BASE}/credentialing/audit${q ? `?${q}` : ''}`, { headers: credHeaders() })
  },

  // Cost-savings widget — time-saved by SNAP automation across this facility.
  // Returns { thisWeek, thisMonth, total } where each is
  // { eventCount, minutesSaved, hoursSaved, dollarsSaved }.
  getSavings: () => apiFetch(`${BASE}/credentialing/savings`, { headers: credHeaders() }),
}

// ─── Admin API ────────────────────────────────────────────────────────────────

export const adminAPI = {
  login: (email, password) =>
    apiFetch(`${BASE}/auth/admin/login`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email, password }),
    }),

  getProviders: () =>
    apiFetch(`${BASE}/admin/providers`, {
      headers: adminHeaders(),
    }),

  updateCredentialed: (providerId, credentialed) =>
    apiFetch(`${BASE}/admin/providers/${providerId}/credentialed`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ credentialed }),
    }),

  getFacilities: () =>
    apiFetch(`${BASE}/admin/facilities`, {
      headers: adminHeaders(),
    }),

  // Feature flags (SNAP admin only)
  getFlagCatalog: () => apiFetch(`${BASE}/feature-flags/catalog`, { headers: adminHeaders() }),
  getFacilityFlags: (facilityId) => apiFetch(`${BASE}/feature-flags/facility/${facilityId}`, { headers: adminHeaders() }),
  setFacilityFlag: (facilityId, payload) =>
    apiFetch(`${BASE}/feature-flags/facility/${facilityId}`, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify(payload) }),

  // Marketplace fee ledger (Position 1)
  getMarketplaceFeeSummary: () => apiFetch(`${BASE}/admin/marketplace-fees/summary`, { headers: adminHeaders() }),
  getMarketplaceFees: (status) =>
    apiFetch(`${BASE}/admin/marketplace-fees${status ? `?status=${status}` : ''}`, { headers: adminHeaders() }),

  updateSubscription: (facilityId, tier) =>
    apiFetch(`${BASE}/admin/facilities/${facilityId}/subscription`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ tier }),
    }),

  // Facility invite + claim flow — see capa-pilot/facility-invite-spec.md
  createFacility: (data) =>
    apiFetch(`${BASE}/admin/facilities`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(data),
    }),

  deleteFacility: (facilityId, force = false) =>
    apiFetch(`${BASE}/admin/facility/${facilityId}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    }),

  inviteFacilityUser: (facilityId, email, facilityRole = 'ADMIN', recipientName) =>
    apiFetch(`${BASE}/admin/facilities/${facilityId}/invite`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ email, facilityRole, recipientName }),
    }),

  listFacilityInvites: (facilityId) =>
    apiFetch(`${BASE}/admin/facilities/${facilityId}/invites`, {
      headers: adminHeaders(),
    }),

  getShifts: (filters = {}) => {
    const params = new URLSearchParams(filters).toString()
    return apiFetch(`${BASE}/admin/shifts${params ? `?${params}` : ''}`, {
      headers: adminHeaders(),
    })
  },

  overrideShift: (shiftId, status) =>
    apiFetch(`${BASE}/admin/shifts/${shiftId}/override`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ status }),
    }),

  getDisputes: () =>
    apiFetch(`${BASE}/admin/disputes`, {
      headers: adminHeaders(),
    }),

  resolveDispute: (completionId, payload) =>
    apiFetch(`${BASE}/admin/disputes/${completionId}/resolve`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify(payload),
    }),

  getFlaggedMessages: () =>
    apiFetch(`${BASE}/admin/messages/flagged`, {
      headers: adminHeaders(),
    }),

  getAnalytics: () =>
    apiFetch(`${BASE}/admin/analytics`, {
      headers: adminHeaders(),
    }),

  getScorecard: () => apiFetch(`${BASE}/admin/scorecard`, { headers: adminHeaders() }),
  setScorecardManual: (values) =>
    apiFetch(`${BASE}/admin/scorecard/manual`, {
      method: 'POST', headers: adminHeaders(), body: JSON.stringify(values),
    }),

  getStaffIQAnalytics: () => apiFetch(`${BASE}/admin/staffiq/analytics`, { headers: adminHeaders() }),
  getAdminLeads: (status) => apiFetch(`${BASE}/admin/leads${status ? `?status=${status}` : ''}`, { headers: adminHeaders() }),
  updateLeadStatus: (id, followUpStatus) => apiFetch(`${BASE}/admin/leads/${id}`, { method: 'PATCH', headers: adminHeaders(), body: JSON.stringify({ followUpStatus }) }),
  getAdminWindows: () => apiFetch(`${BASE}/admin/windows`, { headers: adminHeaders() }),
  getAdminIncentiveShifts: () => apiFetch(`${BASE}/admin/incentive-shifts`, { headers: adminHeaders() }),
  getAdminUploads: () => apiFetch(`${BASE}/admin/uploads`, { headers: adminHeaders() }),
  getStaffIQScores: () => apiFetch(`${BASE}/admin/staffiq-scores`, { headers: adminHeaders() }),
  getCalculatorLeads: () => apiFetch(`${BASE}/admin/calculator-leads`, { headers: adminHeaders() }),
  updateCalculatorLead: (id, followUpStatus) => apiFetch(`${BASE}/admin/calculator-leads/${id}`, { method: 'PATCH', headers: adminHeaders(), body: JSON.stringify({ followUpStatus }) }),
  getFacilityPitch: () => apiFetch(`${BASE}/admin/staffiq/facility-pitch`, { headers: adminHeaders() }),

  // Credential user management
  getCredentialUsers: () => apiFetch(`${BASE}/admin/credential-users`, { headers: adminHeaders() }),
  createCredentialUser: (data) => apiFetch(`${BASE}/admin/credential-users`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify(data) }),
  resetCredentialUserPassword: (id) => apiFetch(`${BASE}/admin/credential-users/${id}/reset-password`, { method: 'POST', headers: adminHeaders() }),
  updateCredentialUser: (id, data) => apiFetch(`${BASE}/admin/credential-users/${id}`, { method: 'PATCH', headers: adminHeaders(), body: JSON.stringify(data) }),

  // ROI Tracker
  getRoiFacilities: () => apiFetch(`${BASE}/admin/roi/facilities`, { headers: adminHeaders() }),
  getRoiRollup: () => apiFetch(`${BASE}/admin/roi/rollup`, { headers: adminHeaders() }),
  getRoiForFacility: (facilityId, month) => apiFetch(`${BASE}/admin/roi/${facilityId}${month ? `?month=${month}` : ''}`, { headers: adminHeaders() }),
  saveRoiBaseline: (facilityId, data) => apiFetch(`${BASE}/admin/roi/${facilityId}/baseline`, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify(data) }),
  saveRoiSnapshot: (facilityId, data) => apiFetch(`${BASE}/admin/roi/${facilityId}/snapshot`, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify(data) }),
  autoPullRoi: (facilityId, month) => apiFetch(`${BASE}/admin/roi/${facilityId}/auto-pull?month=${month}`, { headers: adminHeaders() }),
  projectRoi: ({ providerCount, monthlyProviderCost, sourceFacilityId }) => {
    const qs = new URLSearchParams({ providerCount: String(providerCount) })
    if (monthlyProviderCost != null) qs.set('monthlyProviderCost', String(monthlyProviderCost))
    if (sourceFacilityId) qs.set('sourceFacilityId', sourceFacilityId)
    return apiFetch(`${BASE}/admin/roi/projection/run?${qs.toString()}`, { headers: adminHeaders() })
  },
}

// ─── Public facility-claim API ────────────────────────────────────────────────
// No auth required — the invite token IS the auth. Used by the public claim
// page rendered at /facility-claim/:token.
export const facilityClaimAPI = {
  getInfo: (token) =>
    apiFetch(`${BASE}/facility-claim/info/${token}`, {
      headers: { 'Content-Type': 'application/json' },
    }),
  claim: (token, password) =>
    apiFetch(`${BASE}/facility-claim/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }),
}
