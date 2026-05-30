// VITE_API_URL is set per-environment:
//   - Railway: set in the web service's Variables tab
//   - Local dev: set in web/.env.local (points to localhost:3001)
//   - Netlify: set in site environment variables
const BASE = import.meta.env.VITE_API_URL || 'https://snap-marketplace-backend.onrender.com/api'

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
  createRosterEntry: (data) => apiFetch(`${BASE}/roster`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  updateRosterEntry: (id, data) => apiFetch(`${BASE}/roster/${id}`, { method: 'PATCH', headers: facilityHeaders(), body: JSON.stringify(data) }),
  deleteRosterEntry: (id) => apiFetch(`${BASE}/roster/${id}`, { method: 'DELETE', headers: facilityHeaders() }),
  inviteRosterProvider: (id) => apiFetch(`${BASE}/roster/${id}/invite`, { method: 'POST', headers: facilityHeaders() }),

  // Availability Windows
  getWindows: () => apiFetch(`${BASE}/windows`, { headers: facilityHeaders() }),
  createWindow: (data) => apiFetch(`${BASE}/windows`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  updateWindow: (id, data) => apiFetch(`${BASE}/windows/${id}`, { method: 'PATCH', headers: facilityHeaders(), body: JSON.stringify(data) }),
  deleteWindow: (id) => apiFetch(`${BASE}/windows/${id}`, { method: 'DELETE', headers: facilityHeaders() }),
  activateWindow: (id) => apiFetch(`${BASE}/windows/${id}/activate`, { method: 'POST', headers: facilityHeaders() }),
  sendWindowReminder: (id) => apiFetch(`${BASE}/windows/${id}/remind`, { method: 'POST', headers: facilityHeaders() }),
  getWindowReport: (id) => apiFetch(`${BASE}/windows/${id}/report`, { headers: facilityHeaders() }),

  // Schedule Builder
  getScheduleMonth: (year, month) => apiFetch(`${BASE}/schedule/month?year=${year}&month=${month}`, { headers: facilityHeaders() }),
  upsertScheduleDay: (data) => apiFetch(`${BASE}/schedule/days`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  deleteScheduleDay: (dayId) => apiFetch(`${BASE}/schedule/days/${dayId}`, { method: 'DELETE', headers: facilityHeaders() }),
  recordScheduleFeedback: (data) => apiFetch(`${BASE}/schedule/feedback`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify(data) }),
  getScheduleIntelligence: () => apiFetch(`${BASE}/schedule/intelligence`, { headers: facilityHeaders() }),
  assignProvider: (dayId, roomNumber, rosterId) => apiFetch(`${BASE}/schedule/days/${dayId}/assignments/${roomNumber}`, { method: 'PUT', headers: facilityHeaders(), body: JSON.stringify({ rosterId }) }),
  publishSchedule: (year, month) => apiFetch(`${BASE}/schedule/publish`, { method: 'POST', headers: facilityHeaders(), body: JSON.stringify({ year, month }) }),
  exportSchedule: (year, month) => apiFetch(`${BASE}/schedule/export?year=${year}&month=${month}`, { headers: facilityHeaders() }),
  getScheduleSummary: (year, month) => apiFetch(`${BASE}/schedule/summary?year=${year}&month=${month}`, { headers: facilityHeaders() }),

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

  // Audit
  getAuditLog: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return apiFetch(`${BASE}/credentialing/audit${q ? `?${q}` : ''}`, { headers: credHeaders() })
  },
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

  updateSubscription: (facilityId, tier) =>
    apiFetch(`${BASE}/admin/facilities/${facilityId}/subscription`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ tier }),
    }),

  getShifts: (filters = {}) => {
    const params = new URLSearchParams(filters).toString()
    return apiFetch(`${BASE}/admin/shifts${params ? `?${params}` : ''}`, {
      headers: adminHeaders(),
    })
  },

  overrideShift: (shiftId, status) =>
    apiFetch(`${BASE}/admin/shifts/${shiftId}/status`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ status }),
    }),

  getDisputes: () =>
    apiFetch(`${BASE}/admin/disputes`, {
      headers: adminHeaders(),
    }),

  resolveDispute: (shiftId, payload) =>
    apiFetch(`${BASE}/admin/disputes/${shiftId}/resolve`, {
      method: 'POST',
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

  getStaffIQAnalytics: () => apiFetch(`${BASE}/admin/staffiq/analytics`, { headers: adminHeaders() }),
  getAdminLeads: (status) => apiFetch(`${BASE}/admin/leads${status ? `?status=${status}` : ''}`, { headers: adminHeaders() }),
  updateLeadStatus: (id, followUpStatus) => apiFetch(`${BASE}/admin/leads/${id}`, { method: 'PATCH', headers: adminHeaders(), body: JSON.stringify({ followUpStatus }) }),
  getAdminWindows: () => apiFetch(`${BASE}/admin/windows`, { headers: adminHeaders() }),
  getAdminIncentiveShifts: () => apiFetch(`${BASE}/admin/incentive-shifts`, { headers: adminHeaders() }),
  getAdminUploads: () => apiFetch(`${BASE}/admin/uploads`, { headers: adminHeaders() }),
  getStaffIQScores: () => apiFetch(`${BASE}/admin/staffiq-scores`, { headers: adminHeaders() }),
  getCalculatorLeads: () => apiFetch(`${BASE}/admin/calculator-leads`, { headers: adminHeaders() }),
  updateCalculatorLead: (id, followUpStatus) => apiFetch(`${BASE}/admin/calculator-leads/${id}`, { method: 'PATCH', headers: adminHeaders(), body: JSON.stringify({ followUpStatus }) }),
  getGaryPresentation: () => apiFetch(`${BASE}/admin/staffiq/gary-presentation`, { headers: adminHeaders() }),
}
