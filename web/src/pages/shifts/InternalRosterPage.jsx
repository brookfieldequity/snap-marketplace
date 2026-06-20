import React, { useState, useEffect } from 'react'
import { facilityAPI } from '../../api.js'
import NpiReviewModal from './NpiReviewModal.jsx'
import TimeOffModal from './TimeOffModal.jsx'

const TYPE_BADGE = {
  CRNA: { bg: '#EFF6FF', color: '#1D4ED8', label: 'CRNA' },
  ANESTHESIOLOGIST: { bg: '#F5F3FF', color: '#1E3A8A', label: 'Anesthesiologist' },
  ANESTHESIA_ASSISTANT: { bg: '#F0FDFA', color: '#0F766E', label: 'Anesthesia Asst.' },
  STAFF: { bg: '#F1F5F9', color: '#475569', label: 'Staff' },
}

const EMPLOY_BADGE = {
  FULL_TIME: { bg: '#F0FDF4', color: '#15803D', label: 'Full Time' },
  PER_DIEM: { bg: '#FEFCE8', color: '#A16207', label: 'Per Diem' },
  LOCUMS: { bg: '#FFF7ED', color: '#C2410C', label: 'Locums' },
}

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const SHIFT_LENGTHS = [
  { value: '8hr', label: '8 hours' },
  { value: '10hr', label: '10 hours' },
  { value: '12hr', label: '12 hours' },
  { value: 'none', label: 'No preference' },
]

const BLANK_FORM = {
  providerName: '', providerType: 'CRNA', employmentCategory: 'FULL_TIME', npi: '',
  snapEmail: '', phoneNumber: '', licenseNumber: '', licenseExpiration: '',
  // Category fields
  fteHours: '', annualRate: '', hourlyRate: '',
  // All-in cost ($/hr) — facility's true loaded cost for this provider (bill
  // rate for agency-staffed 1099s; loaded cost for W-2 staff). Optional/blank.
  allInCostPerHour: '',
  preferredShiftLength: 'none', preferredDays: [],
  locationRankings: [], maxShiftsPerMonth: '',
  contractStart: '', contractEnd: '', notes: '',
  // Employer / tax status / hours status. Empty string here means "unknown"
  // — submitted to the backend as null, which is the correct tri-state.
  employer: '', taxStatus: '', hoursStatus: '',
  // Business name (1099s paid as an LLC/business). useBusinessNameForPayroll
  // makes payroll export the business name instead of the personal name —
  // payroll only; the person is addressed by their name everywhere else.
  businessName: '', useBusinessNameForPayroll: false,
  // Payee identity for the payroll feed (groundwork). SSN intentionally not held.
  payeeType: '', ein: '',
  // Dual employment (W-2 at one employer + 1099 at another). When on, the payee
  // type / business / EIN / All-In Cost above describe the 1099 side.
  dualEmployment: false, w2Employer: '', contractorEmployer: '', contractorPayRate: '',
  // PTO. ptoDaysAnnual '' = use system default; ptoEligible '' = derive from
  // employment (W-2 / full-time eligible); seniorityRank '' = unset.
  ptoDaysAnnual: '', ptoEligible: '', seniorityRank: '',
}

function isExpiringSoon(dateStr) {
  if (!dateStr) return false
  const diff = new Date(dateStr) - new Date()
  return diff > 0 && diff < 90 * 24 * 60 * 60 * 1000
}

// Credentialing-passport lifecycle, shown as a per-card pill. Distinct from
// the marketplace "SNAP Account Linked" dot.
const CRED_STATUS = {
  NOT_INVITED: { label: 'Not invited', bg: '#F1F5F9', color: '#64748B' },
  INVITED: { label: 'Invited', bg: '#EFF6FF', color: '#1D4ED8' },
  CLAIMED: { label: 'Claimed', bg: '#ECFDF5', color: '#059669' },
  COMPLETED: { label: 'Credentialed', bg: '#ECFDF5', color: '#047857' },
}

// Back-office / NPI-exempt staff are never credentialed. A provider is
// invitable once they're clinical AND have an NPI to key the passport on.
function isClinical(p) {
  return !p.isNonClinical && !p.npiExempt
}
function canCredential(p) {
  return isClinical(p) && !!p.npi
}
function hasContact(p) {
  return !!(p.snapAccountEmail || p.phoneNumber)
}
// A clinical provider whose pay rate hasn't been entered. The Schedule Builder
// falls back to defaults when this is true, which makes the savings number an
// estimate rather than a real comparison — so the coordinator needs to see it.
function needsRate(p) {
  if (!isClinical(p)) return false
  return p.employmentCategory === 'FULL_TIME' ? !p.annualRate : !p.hourlyRate
}

function Badge({ bg, color, label }) {
  return (
    <span style={{ background: bg, color, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, border: `1px solid ${color}33` }}>
      {label}
    </span>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 640, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0F172A', margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#64748B', lineHeight: 1 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}{required && <span style={{ color: '#EF4444', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  )
}

function SectionDivider({ label }) {
  return (
    <div style={{ borderTop: '1px solid #E2E8F0', margin: '20px 0 14px', paddingTop: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '9px 12px', border: '1px solid #E2E8F0',
  borderRadius: 8, fontSize: 14, color: '#0F172A', background: '#F8FAFC',
  boxSizing: 'border-box', outline: 'none',
}

const primaryBtnStyle = { padding: '10px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer' }
const ghostBtnStyle = { padding: '10px 18px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const linkBtnStyle = { background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }

export default function InternalRosterPage({ onNavigate }) {
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  // Credentialed sites + shift-share. siteList = all facility sites; siteCred =
  // per-site { on, pct } for the provider being edited.
  const [siteList, setSiteList] = useState([])
  const [siteCred, setSiteCred] = useState({})
  const [invitedIds, setInvitedIds] = useState({})
  const [deletingIds, setDeletingIds] = useState({})
  // Bulk upload state
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null) // { summary, created, errors }
  const [uploadError, setUploadError] = useState(null)
  const [locationInput, setLocationInput] = useState('')

  // NPI review queue (from multi-sheet imports)
  const [npiReviewRows, setNpiReviewRows] = useState([])
  const [showNpiReview, setShowNpiReview] = useState(false)
  const [timeOffMember, setTimeOffMember] = useState(null) // roster member whose PTO modal is open
  const [ptoSummary, setPtoSummary] = useState({}) // { [rosterEntryId]: { annual, granted, used, eligible } }
  // Credentialing-invite modal
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteSel, setInviteSel] = useState({}) // { [rosterId]: true }
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState(null) // { sent, skippedCount, results }
  const [syncing, setSyncing] = useState(false)
  const [reclassifying, setReclassifying] = useState(false)
  const [reclassifyResult, setReclassifyResult] = useState(null)
  // Multi-select for bulk delete. `selectedIds` is a Set of roster-entry IDs
  // ticked by the coordinator. When non-empty a sticky action bar appears.
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  useEffect(() => { load(); loadNpiReview() }, [])

  async function load() {
    setLoading(true)
    try {
      const [data, sites, pto] = await Promise.all([
        facilityAPI.getRoster(),
        facilityAPI.getRosterLocations().catch(() => ({ locations: [] })),
        facilityAPI.getPtoSummary().catch(() => ({ summary: {} })),
      ])
      setRoster(Array.isArray(data) ? data : data.roster || [])
      setSiteList(sites.locations || [])
      setPtoSummary(pto.summary || {})
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadNpiReview() {
    try {
      const data = await facilityAPI.getNpiReview()
      setNpiReviewRows(data.rows || [])
    } catch {
      // Non-blocking — the review queue is a nice-to-have surface; never
      // block the roster page if it fails to load.
    }
  }

  function openAdd() {
    setEditTarget(null)
    setForm(BLANK_FORM)
    setSiteCred({})
    setLocationInput('')
    setShowModal(true)
  }

  // ─── Bulk upload ──────────────────────────────────────────────────────────
  function openUpload() {
    setUploadFile(null)
    setUploadResult(null)
    setUploadError(null)
    setShowUploadModal(true)
  }

  async function handleUpload() {
    if (!uploadFile) return
    setUploading(true)
    setUploadError(null)
    setUploadResult(null)
    try {
      const res = await facilityAPI.uploadRoster(uploadFile)
      setUploadResult(res)
      // Reload roster so the imported providers appear immediately
      await load()
    } catch (err) {
      setUploadError(err.message || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function downloadTemplate() {
    const token = localStorage.getItem('snapFacilityToken')
    try {
      const res = await fetch(facilityAPI.downloadRosterTemplateUrl(), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('Failed to download template.')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'snap-roster-template.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Could not download template: ' + err.message)
    }
  }

  function openEdit(p) {
    setEditTarget(p)
    const sc = {}
    ;(p.locations || []).forEach((l) => {
      // Only carry over credentialing for sites in the (coverage-template-driven)
      // list — ignore stale/garbage import location names so they don't reappear.
      if (siteList.includes(l.facilityName)) {
        sc[l.facilityName] = { on: true, pct: l.shiftSharePct != null ? String(l.shiftSharePct) : '' }
      }
    })
    setSiteCred(sc)
    setForm({
      providerName: p.providerName || '',
      providerType: p.isNonClinical ? 'STAFF' : (p.providerType || 'CRNA'),
      employmentCategory: p.employmentCategory || 'FULL_TIME',
      npi: p.npi || '',
      snapEmail: p.snapAccountEmail || '',
      phoneNumber: p.phoneNumber || '',
      licenseNumber: p.licenseNumber || '',
      licenseExpiration: p.licenseExpiration ? p.licenseExpiration.substring(0, 10) : '',
      fteHours: p.fteHours ?? '',
      annualRate: p.annualRate ?? '',
      hourlyRate: p.hourlyRate ?? '',
      allInCostPerHour: p.allInCostPerHour ?? '',
      preferredShiftLength: p.preferredShiftLength || 'none',
      preferredDays: Array.isArray(p.preferredDays) ? p.preferredDays : [],
      locationRankings: Array.isArray(p.locationRankings) ? p.locationRankings : [],
      maxShiftsPerMonth: p.maxShiftsPerMonth ?? '',
      contractStart: p.contractStart ? p.contractStart.substring(0, 10) : '',
      contractEnd: p.contractEnd ? p.contractEnd.substring(0, 10) : '',
      notes: p.notes || '',
      employer: p.employer || '',
      taxStatus: p.is1099 == null ? '' : (p.is1099 ? '1099' : 'W2'),
      hoursStatus: p.isFullTime == null ? '' : (p.isFullTime ? 'FT' : 'PT'),
      businessName: p.businessName || '',
      useBusinessNameForPayroll: !!p.useBusinessNameForPayroll,
      payeeType: p.payeeType || '',
      ein: p.ein || '',
      dualEmployment: !!p.dualEmployment,
      w2Employer: p.w2Employer || '',
      contractorEmployer: p.contractorEmployer || '',
      contractorPayRate: p.contractorPayRate ?? '',
      ptoDaysAnnual: p.ptoDaysAnnual ?? '',
      ptoEligible: p.ptoEligible == null ? '' : (p.ptoEligible ? 'YES' : 'NO'),
      seniorityRank: p.seniorityRank ?? '',
    })
    setLocationInput('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.providerName.trim()) return alert('Provider name is required.')
    if (form.employmentCategory === 'FULL_TIME' && !form.annualRate) return alert('Annual base rate is required for Full Time providers.')
    if ((form.employmentCategory === 'PER_DIEM' || form.employmentCategory === 'LOCUMS') && !form.hourlyRate) return alert('Base hourly rate is required.')
    setSaving(true)
    try {
      const payload = {
        providerName: form.providerName,
        providerType: form.providerType,
        employmentCategory: form.employmentCategory,
        npi: form.npi || null,
        snapAccountEmail: form.snapEmail || null,
        phoneNumber: form.phoneNumber || null,
        licenseNumber: form.licenseNumber || null,
        licenseExpiration: form.licenseExpiration || null,
        fteHours: form.fteHours !== '' ? parseFloat(form.fteHours) : null,
        annualRate: form.annualRate !== '' ? parseFloat(form.annualRate) : null,
        hourlyRate: form.hourlyRate !== '' ? parseFloat(form.hourlyRate) : null,
        allInCostPerHour: form.allInCostPerHour !== '' ? parseFloat(form.allInCostPerHour) : null,
        preferredShiftLength: form.preferredShiftLength !== 'none' ? form.preferredShiftLength : null,
        preferredDays: form.preferredDays.length > 0 ? form.preferredDays : null,
        locationRankings: form.locationRankings.length > 0 ? form.locationRankings : null,
        locations: Object.entries(siteCred)
          .filter(([, v]) => v.on)
          .map(([facilityName, v]) => ({ facilityName, shiftSharePct: v.pct !== '' && v.pct != null ? parseFloat(v.pct) : null })),
        maxShiftsPerMonth: form.maxShiftsPerMonth !== '' ? parseInt(form.maxShiftsPerMonth) : null,
        contractStart: form.contractStart || null,
        contractEnd: form.contractEnd || null,
        notes: form.notes || null,
        employer: form.employer.trim() || null,
        businessName: form.businessName.trim() || null,
        useBusinessNameForPayroll: !!form.useBusinessNameForPayroll,
        payeeType: form.payeeType || null,
        ein: form.ein.trim() || null,
        dualEmployment: !!form.dualEmployment,
        w2Employer: form.w2Employer.trim() || null,
        contractorEmployer: form.contractorEmployer.trim() || null,
        contractorPayRate: form.contractorPayRate !== '' ? parseFloat(form.contractorPayRate) : null,
        // taxStatus/hoursStatus are tri-state strings in form land; map to
        // booleans for the API. Empty string → null (unknown).
        is1099: form.taxStatus === '' ? null : form.taxStatus === '1099',
        isFullTime: form.hoursStatus === '' ? null : form.hoursStatus === 'FT',
        ptoDaysAnnual: form.ptoDaysAnnual !== '' ? parseInt(form.ptoDaysAnnual) : null,
        ptoEligible: form.ptoEligible === '' ? null : form.ptoEligible === 'YES',
        seniorityRank: form.seniorityRank !== '' ? parseInt(form.seniorityRank) : null,
      }
      if (editTarget) {
        await facilityAPI.updateRosterEntry(editTarget.id, payload)
      } else {
        await facilityAPI.createRosterEntry(payload)
      }
      setShowModal(false)
      await load()
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Remove this provider from the roster?')) return
    setDeletingIds((p) => ({ ...p, [id]: true }))
    try {
      await facilityAPI.deleteRosterEntry(id)
      await load()
    } catch (e) {
      alert('Delete failed: ' + e.message)
    } finally {
      setDeletingIds((p) => ({ ...p, [id]: false }))
    }
  }

  // ─── Multi-select bulk delete ───────────────────────────────────────────
  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function clearSelection() { setSelectedIds(new Set()) }
  function selectAllVisible() {
    setSelectedIds(new Set(roster.map((p) => p.id)))
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    const msg = `Permanently remove ${ids.length} provider${ids.length !== 1 ? 's' : ''} from the roster?\n\n` +
      'Schedule rooms they were assigned to will become empty. ' +
      'Their time-off, location credentialing, and incentive responses will be deleted.'
    if (!window.confirm(msg)) return
    setBulkDeleting(true)
    try {
      const res = await facilityAPI.bulkDeleteRoster(ids)
      clearSelection()
      await load()
      alert(`Removed ${res.rosterDeleted} provider${res.rosterDeleted !== 1 ? 's' : ''}. ` +
        `${res.assignmentsUnassigned} schedule assignment${res.assignmentsUnassigned !== 1 ? 's' : ''} unassigned.`)
    } catch (e) {
      alert('Bulk delete failed: ' + (e.message || 'Unknown error'))
    } finally {
      setBulkDeleting(false)
    }
  }

  async function handleClearAll() {
    const total = roster.length
    if (total === 0) return
    const phrase = window.prompt(
      `This will delete ALL ${total} providers on this facility's roster and unassign every schedule room they staff.\n\n` +
      'Type DELETE ALL (caps) to confirm.'
    )
    if (phrase !== 'DELETE ALL') return
    setBulkDeleting(true)
    try {
      const res = await facilityAPI.clearAllRoster()
      clearSelection()
      await load()
      alert(`Cleared ${res.rosterDeleted} provider${res.rosterDeleted !== 1 ? 's' : ''}. ` +
        `${res.assignmentsUnassigned} schedule assignment${res.assignmentsUnassigned !== 1 ? 's' : ''} unassigned.`)
    } catch (e) {
      alert('Clear all failed: ' + (e.message || 'Unknown error'))
    } finally {
      setBulkDeleting(false)
    }
  }

  async function handleInvite(id) {
    try {
      const res = await facilityAPI.inviteRosterProvider(id)
      await load()
      // Tell the coordinator what actually happened — a credentialing "invite"
      // doesn't always send an email: a provider who already has a passport gets
      // an in-app access request instead, which previously looked like nothing.
      const mode = res?.inviteResult?.mode
      const channels = res?.inviteResult?.delivered || []
      if (mode === 'INVITE_CREATED') {
        alert(`✅ Invite sent (${channels.join(' + ') || 'email'}). They'll get a link to create their SNAP Credentialing passport.`)
      } else if (mode === 'EXISTING_PROVIDER') {
        alert('✅ This provider already has a SNAP Credentialing passport. We sent them an in-app access request to share it with your facility — no email needed.')
      } else if (mode === 'ALREADY_GRANTED') {
        alert('✅ Your facility already has access to this provider\'s SNAP Credentialing passport.')
      } else {
        alert('✅ Credentialing invite processed.')
      }
    } catch (e) {
      alert('Invite failed: ' + (e.message || 'Unknown error'))
    }
  }

  // ─── Marketplace app invites (separate from credentialing invites) ──────
  const [invitingToApp, setInvitingToApp] = useState({})

  async function handleInviteToApp(id) {
    setInvitingToApp((p) => ({ ...p, [id]: true }))
    try {
      const res = await facilityAPI.inviteRosterToApp(id)
      const channels = (res?.channels || []).join(' + ') || 'no channels'
      const linkedNote = res?.linkedNow
        ? `\n\n✓ This provider was already registered in SNAP — linked instantly. Their next pull-to-refresh will show your schedule.`
        : ''
      alert(`Sent ${channels} invite to ${res.name || 'the provider'}.${linkedNote}`)
      await load()
    } catch (e) {
      alert('Invite failed: ' + (e.message || 'Unknown error'))
    } finally {
      setInvitingToApp((p) => ({ ...p, [id]: false }))
    }
  }

  async function handleBulkInviteToApp() {
    const eligible = [...selectedIds].filter((id) => {
      const p = roster.find((x) => x.id === id)
      return p && !p.snapAccountLinked && (p.snapAccountEmail || p.phoneNumber)
    })
    if (eligible.length === 0) {
      alert('No eligible providers selected. Already-linked providers and rows with no contact info are skipped.')
      return
    }
    if (!window.confirm(`Send marketplace-app invites to ${eligible.length} provider${eligible.length !== 1 ? 's' : ''}?`)) return
    setBulkDeleting(true) // reuse the disable-flag so the bar locks
    try {
      const res = await facilityAPI.bulkInviteRosterToApp(eligible)
      clearSelection()
      await load()
      const lines = [`Sent ${res.sent} invite${res.sent !== 1 ? 's' : ''}.`]
      if (res.skippedCount > 0) {
        lines.push(`${res.skippedCount} skipped:`)
        for (const r of (res.results || []).filter((x) => !x.ok).slice(0, 8)) {
          lines.push(`• ${r.name || r.id} — ${r.reason || 'unknown'}`)
        }
      }
      alert(lines.join('\n'))
    } catch (e) {
      alert('Bulk invite failed: ' + (e.message || 'Unknown error'))
    } finally {
      setBulkDeleting(false)
    }
  }

  const [relinking, setRelinking] = useState(false)
  async function handleRelink() {
    setRelinking(true)
    try {
      const res = await facilityAPI.relinkRoster()
      await load()
      alert(`Linked ${res.linked} of ${res.scanned} unlinked roster entr${res.scanned === 1 ? 'y' : 'ies'} to registered SNAP accounts.`)
    } catch (e) {
      alert('Re-link failed: ' + (e.message || 'Unknown error'))
    } finally {
      setRelinking(false)
    }
  }

  function openInviteModal() {
    // Pre-check the providers eligible by default: clinical, contactable, not
    // yet invited, and not already credentialed (unless their license is
    // expiring soon — then they're due to migrate to SNAP now).
    const sel = {}
    for (const p of roster) {
      if (!canCredential(p) || !hasContact(p)) continue
      const status = p.credentialingStatus || 'NOT_INVITED'
      const expiring = isExpiringSoon(p.licenseExpiration)
      if (status === 'NOT_INVITED' && (!p.externallyCredentialed || expiring)) sel[p.id] = true
    }
    setInviteSel(sel)
    setInviteResult(null)
    setShowInviteModal(true)
  }

  function toggleInvite(id) {
    setInviteSel((s) => ({ ...s, [id]: !s[id] }))
  }

  async function submitInvites() {
    const ids = Object.keys(inviteSel).filter((id) => inviteSel[id])
    if (ids.length === 0) return
    setInviting(true)
    try {
      const res = await facilityAPI.bulkInviteCredentialing(ids)
      setInviteResult(res)
      await load()
    } catch (e) {
      alert('Invite failed: ' + (e.message || 'Unknown error'))
    } finally {
      setInviting(false)
    }
  }

  async function handleSyncStatus() {
    setSyncing(true)
    try {
      const res = await facilityAPI.syncCredentialingStatus()
      await load()
      alert(res.updated > 0
        ? `${res.updated} provider${res.updated !== 1 ? 's' : ''} updated to Claimed.`
        : 'No new claims yet.')
    } catch (e) {
      alert('Refresh failed: ' + (e.message || 'Unknown error'))
    } finally {
      setSyncing(false)
    }
  }

  async function handleReclassify() {
    setReclassifying(true)
    try {
      const res = await facilityAPI.resolveRosterFromRegistry()
      setReclassifyResult(res)
      await load()
    } catch (e) {
      alert('Resolve from registry failed: ' + (e.message || 'Unknown error'))
    } finally {
      setReclassifying(false)
    }
  }

  function setF(k, v) { setForm((p) => ({ ...p, [k]: v })) }

  function toggleSite(name) {
    setSiteCred((s) => ({ ...s, [name]: { on: !s[name]?.on, pct: s[name]?.pct || '' } }))
  }
  function setSitePct(name, pct) {
    setSiteCred((s) => ({ ...s, [name]: { on: true, pct } }))
  }

  function toggleDay(day) {
    setForm(p => ({
      ...p,
      preferredDays: p.preferredDays.includes(day)
        ? p.preferredDays.filter(d => d !== day)
        : [...p.preferredDays, day],
    }))
  }

  function addLocation() {
    const loc = locationInput.trim()
    if (!loc || form.locationRankings.includes(loc)) return
    setForm(p => ({ ...p, locationRankings: [...p.locationRankings, loc] }))
    setLocationInput('')
  }

  function removeLocation(i) {
    setForm(p => ({ ...p, locationRankings: p.locationRankings.filter((_, idx) => idx !== i) }))
  }

  function moveLocation(i, dir) {
    const arr = [...form.locationRankings]
    const swap = i + dir
    if (swap < 0 || swap >= arr.length) return
    ;[arr[i], arr[swap]] = [arr[swap], arr[i]]
    setForm(p => ({ ...p, locationRankings: arr }))
  }

  const cat = form.employmentCategory

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>Internal Provider Roster</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>{roster.length} provider{roster.length !== 1 ? 's' : ''} on your roster</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={openUpload}
            style={{ padding: '11px 18px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>📥</span> Upload Roster
          </button>
          <button
            onClick={openInviteModal}
            style={{ padding: '11px 18px', background: '#fff', color: '#1D4ED8', border: '1.5px solid #C7D2FE', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>✉️</span> Invite to Credentialing
          </button>
          <button
            onClick={handleRelink}
            disabled={relinking}
            title="Link any roster entries whose providers have already registered in the SNAP mobile app (matches by NPI or email)"
            style={{ padding: '11px 16px', background: '#fff', color: '#047857', border: '1.5px solid #6EE7B7', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: relinking ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: relinking ? 0.6 : 1 }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>🔗</span> {relinking ? 'Linking…' : 'Sync app accounts'}
          </button>
          <button
            onClick={handleSyncStatus}
            disabled={syncing}
            title="Check for providers who have completed their invite"
            style={{ padding: '11px 16px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: syncing ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: syncing ? 0.6 : 1 }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>↻</span> {syncing ? 'Refreshing…' : 'Refresh status'}
          </button>
          <button
            onClick={handleReclassify}
            disabled={reclassifying}
            title="Look up every provider in the national NPI registry — fill in NPIs, set MD/CRNA type, and activate any clinicians the import benched"
            style={{ padding: '11px 16px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: reclassifying ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: reclassifying ? 0.6 : 1 }}
          >
            <span style={{ fontSize: 15, lineHeight: 1 }}>🔎</span> {reclassifying ? 'Resolving…' : 'Resolve from registry'}
          </button>
          <button
            onClick={openAdd}
            style={{ padding: '11px 22px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(37,99,235,0.35)', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add Provider
          </button>
          {roster.length > 0 && (
            <button
              onClick={handleClearAll}
              disabled={bulkDeleting}
              title="Delete every provider on this facility's roster — typed-confirmation required"
              style={{ padding: '11px 16px', background: '#fff', color: '#B91C1C', border: '1.5px solid #FCA5A5', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: bulkDeleting ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: bulkDeleting ? 0.6 : 1 }}
            >
              <span style={{ fontSize: 15, lineHeight: 1 }}>🗑️</span> Clear all
            </button>
          )}
        </div>
      </div>

      {/* Sticky selection bar — only shown when one or more cards are ticked.
          Stays in view as the coordinator scrolls a long roster so the bulk
          action stays one click away. */}
      {selectedIds.size > 0 && (
        <div style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: '#0F172A', color: '#fff', borderRadius: 12, padding: '12px 18px', marginBottom: 16, boxShadow: '0 4px 14px rgba(15,23,42,0.18)' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {selectedIds.size} selected
            {selectedIds.size < roster.length && (
              <button onClick={selectAllVisible} style={{ marginLeft: 14, background: 'none', border: 'none', color: '#A5B4FC', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                Select all {roster.length}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={clearSelection} disabled={bulkDeleting} style={{ padding: '8px 14px', background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: bulkDeleting ? 'default' : 'pointer', opacity: bulkDeleting ? 0.6 : 1 }}>
              Cancel
            </button>
            <button onClick={handleBulkInviteToApp} disabled={bulkDeleting} style={{ padding: '8px 16px', background: '#10B981', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: bulkDeleting ? 'default' : 'pointer', opacity: bulkDeleting ? 0.6 : 1 }}>
              📱 Invite {selectedIds.size} to SNAP
            </button>
            <button onClick={handleBulkDelete} disabled={bulkDeleting} style={{ padding: '8px 16px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: bulkDeleting ? 'default' : 'pointer', opacity: bulkDeleting ? 0.6 : 1 }}>
              {bulkDeleting ? 'Deleting…' : `🗑️ Delete ${selectedIds.size} selected`}
            </button>
          </div>
        </div>
      )}

      {/* Resolve-from-registry result */}
      {reclassifyResult && (
        <Modal title="Roster resolved from registry" onClose={() => setReclassifyResult(null)}>
          <div style={{ fontSize: 14, color: '#0F172A', marginBottom: 14 }}>
            Checked {reclassifyResult.checked} provider{reclassifyResult.checked !== 1 ? 's' : ''} against the national registry.{' '}
            <strong>{reclassifyResult.updated} updated.</strong>
          </div>
          {reclassifyResult.changes?.length > 0 ? (
            <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, maxHeight: 320, overflowY: 'auto' }}>
              {reclassifyResult.changes.map((c, i) => {
                const bits = []
                if (c.npiAdded) bits.push('+ NPI')
                if (c.to && c.to !== c.from) bits.push(`${(c.from && TYPE_BADGE[c.from]?.label) || 'untyped'} → ${TYPE_BADGE[c.to]?.label || c.to}`)
                if (c.unbenched) bits.push('activated')
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: '1px solid #F1F5F9', fontSize: 13 }}>
                    <span style={{ fontWeight: 600, color: '#0F172A' }}>{c.name}</span>
                    <span style={{ color: '#059669', whiteSpace: 'nowrap', fontWeight: 600 }}>{bits.join(' · ')}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#64748B' }}>Nothing to change — everyone already matched the registry.</div>
          )}
          {(reclassifyResult.needsReview > 0 || reclassifyResult.unmatched > 0) && (
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 10 }}>
              {reclassifyResult.needsReview > 0 && <div>{reclassifyResult.needsReview} had multiple possible matches — resolve them in NPI review.</div>}
              {reclassifyResult.unmatched > 0 && <div>{reclassifyResult.unmatched} couldn&apos;t be matched (likely back-office, or a name the registry couldn&apos;t resolve) and were left unchanged.</div>}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button onClick={() => setReclassifyResult(null)} style={primaryBtnStyle}>Done</button>
          </div>
        </Modal>
      )}

      {/* Credentialing invite modal */}
      {showInviteModal && (
        <Modal title="Invite to Credentialing" onClose={() => setShowInviteModal(false)}>
          {!inviteResult ? (
            <>
              <p style={{ fontSize: 13, color: '#64748B', marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
                Send each selected provider a secure link to build their verified SNAP credentialing passport.
                Nothing is sent until you click <strong>Send invites</strong>. Providers already credentialed are
                unchecked by default — they’ll move to SNAP at their next license renewal. Check anyone to override.
              </p>
              {(() => {
                const clinical = roster.filter(canCredential)
                const needsNpi = roster.filter((p) => isClinical(p) && !p.npi)
                if (clinical.length === 0) {
                  return <div style={{ fontSize: 14, color: '#64748B', padding: '20px 0' }}>No clinical providers with an NPI are ready to invite yet.</div>
                }
                const selCount = Object.values(inviteSel).filter(Boolean).length
                return (
                  <>
                    <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
                      <button onClick={() => { const s = {}; clinical.forEach((p) => { if (hasContact(p)) s[p.id] = true }); setInviteSel(s) }} style={linkBtnStyle}>Select all</button>
                      <button onClick={() => setInviteSel({})} style={linkBtnStyle}>Clear</button>
                    </div>
                    <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, maxHeight: 320, overflowY: 'auto' }}>
                      {clinical.map((p) => {
                        const contact = hasContact(p)
                        const status = p.credentialingStatus || 'NOT_INVITED'
                        const expiring = isExpiringSoon(p.licenseExpiration)
                        let note = 'Ready to invite'
                        let noteColor = '#059669'
                        if (!contact) { note = 'No email or phone on file'; noteColor = '#DC2626' }
                        else if (status === 'CLAIMED') { note = 'Passport claimed'; noteColor = '#059669' }
                        else if (status === 'COMPLETED') { note = 'Credentialed'; noteColor = '#047857' }
                        else if (status === 'INVITED') { note = 'Already invited — re-send'; noteColor = '#2563EB' }
                        else if (p.externallyCredentialed && !expiring) { note = `Already credentialed — defers to renewal${p.licenseExpiration ? ' (' + p.licenseExpiration.substring(0, 10) + ')' : ''}`; noteColor = '#A16207' }
                        return (
                          <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid #F1F5F9', cursor: contact ? 'pointer' : 'not-allowed', opacity: contact ? 1 : 0.6 }}>
                            <input type="checkbox" checked={!!inviteSel[p.id]} disabled={!contact} onChange={() => toggleInvite(p.id)} style={{ width: 16, height: 16 }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>{p.providerName}</div>
                              <div style={{ fontSize: 12, color: noteColor }}>{note}</div>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                    {needsNpi.length > 0 && (
                      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 10 }}>
                        {needsNpi.length} clinical provider{needsNpi.length !== 1 ? 's' : ''} need an NPI before they can be credentialed (resolve in NPI review).
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                      <button onClick={() => setShowInviteModal(false)} style={ghostBtnStyle}>Cancel</button>
                      <button onClick={submitInvites} disabled={inviting || selCount === 0} style={{ ...primaryBtnStyle, opacity: (inviting || selCount === 0) ? 0.6 : 1, cursor: (inviting || selCount === 0) ? 'default' : 'pointer' }}>
                        {inviting ? 'Sending…' : `Send ${selCount} invite${selCount !== 1 ? 's' : ''}`}
                      </button>
                    </div>
                  </>
                )
              })()}
            </>
          ) : (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 12 }}>
                ✅ {inviteResult.sent} invite{inviteResult.sent !== 1 ? 's' : ''} sent
              </div>
              {inviteResult.skippedCount > 0 && (
                <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#92400E', marginBottom: 6 }}>{inviteResult.skippedCount} skipped</div>
                  {inviteResult.results.filter((r) => !r.ok).map((r) => (
                    <div key={r.id} style={{ fontSize: 12, color: '#92400E' }}>{r.name} — {r.reason}</div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button onClick={() => setShowInviteModal(false)} style={primaryBtnStyle}>Done</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Missing-rate nudge — the savings demo assumes real per-provider rates.
          Without them, the Schedule Builder silently falls back to defaults and
          the dollar comparison is approximate. Surface the count up front. */}
      {(() => {
        const missing = roster.filter(needsRate)
        if (missing.length === 0) return null
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: '#EFF6FF', border: '1px solid #C7D2FE', borderRadius: 12, padding: '14px 20px', marginBottom: 20 }}>
            <div style={{ fontSize: 14, color: '#3730A3' }}>
              <strong>{missing.length} clinical provider{missing.length !== 1 ? 's' : ''}</strong> {missing.length !== 1 ? 'are' : 'is'} missing a pay rate. Enter their rates so the Schedule Builder's savings number reflects real labor cost instead of estimates.
            </div>
          </div>
        )
      })()}

      {/* NPI review nudge — gentle, dismissible by acting or ignoring */}
      {npiReviewRows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: '#FEFCE8', border: '1px solid #FDE68A', borderRadius: 12, padding: '14px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: '#92400E' }}>
            <strong>{npiReviewRows.length} provider{npiReviewRows.length !== 1 ? 's' : ''}</strong> couldn't be matched to an NPI automatically. Review them to keep your roster fully verified.
          </div>
          <button
            onClick={() => setShowNpiReview(true)}
            style={{ padding: '9px 16px', background: '#D97706', color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Review {npiReviewRows.length} →
          </button>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8', fontSize: 15 }}>Loading roster...</div>}
      {error && !loading && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '16px 20px', color: '#DC2626', marginBottom: 24 }}>
          Failed to load roster: {error}
        </div>
      )}

      {!loading && !error && roster.length === 0 && (
        <div style={{ textAlign: 'center', padding: '80px 40px', background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>👥</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>No providers on your roster yet.</div>
          <div style={{ fontSize: 14, color: '#64748B', marginBottom: 24 }}>Add your first provider to start building your schedule.</div>
          <button onClick={openAdd} style={{ padding: '11px 24px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            + Add Your First Provider
          </button>
        </div>
      )}

      {!loading && roster.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {roster.map((p) => {
            const typeBadge = p.isNonClinical ? TYPE_BADGE.STAFF : (TYPE_BADGE[p.providerType] || TYPE_BADGE.CRNA)
            const empBadge = EMPLOY_BADGE[p.employmentCategory] || EMPLOY_BADGE.FULL_TIME
            const linked = !!p.snapAccountLinked
            const expiringSoon = isExpiringSoon(p.licenseExpiration)
            const rateLabel = p.employmentCategory === 'FULL_TIME'
              ? (p.annualRate ? `$${Number(p.annualRate).toLocaleString()}/yr` : null)
              : (p.hourlyRate ? `$${p.hourlyRate}/hr` : null)

            const isSelected = selectedIds.has(p.id)
            return (
              <div key={p.id} style={{ position: 'relative', background: '#fff', borderRadius: 14, border: `1px solid ${isSelected ? '#2563EB' : '#E2E8F0'}`, padding: '20px 22px', boxShadow: isSelected ? '0 0 0 3px rgba(37,99,235,0.15)' : '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(p.id)}
                  title={isSelected ? 'Deselect' : 'Select for bulk action'}
                  style={{ position: 'absolute', top: 14, right: 14, width: 18, height: 18, cursor: 'pointer', accentColor: '#2563EB' }}
                />
                <div style={{ paddingRight: 28 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: '#0F172A', marginBottom: 8 }}>{p.providerName}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Badge bg={typeBadge.bg} color={typeBadge.color} label={typeBadge.label} />
                    <Badge bg={empBadge.bg} color={empBadge.color} label={empBadge.label} />
                    {(() => {
                      // Compact "1099 · FT" / "W-2 · PT" chip — only render
                      // when we know at least one of the two axes.
                      if (p.is1099 == null && p.isFullTime == null) return null
                      const tax = p.is1099 == null ? null : (p.is1099 ? '1099' : 'W-2')
                      const hrs = p.isFullTime == null ? null : (p.isFullTime ? 'FT' : 'PT')
                      const label = [tax, hrs].filter(Boolean).join(' · ')
                      return <Badge bg="#F1F5F9" color="#475569" label={label} />
                    })()}
                    {p.employer && (
                      <Badge bg="#FEF3C7" color="#92400E" label={`🏢 ${p.employer}`} />
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: linked ? '#10B981' : '#CBD5E1', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: linked ? '#059669' : '#94A3B8', fontWeight: 500 }}>
                    {linked ? 'SNAP Account Linked' : 'No SNAP Account'}
                  </span>
                </div>

                {isClinical(p) && (() => {
                  const cs = CRED_STATUS[p.credentialingStatus] || CRED_STATUS.NOT_INVITED
                  return <Badge bg={cs.bg} color={cs.color} label={`Passport: ${cs.label}`} />
                })()}

                {p.npi ? (
                  <div style={{ fontSize: 11, color: '#64748B' }}>NPI {p.npi}</div>
                ) : isClinical(p) ? (
                  <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>⚠️ No NPI on file</div>
                ) : null}

                {Array.isArray(p.locations) && p.locations.length > 0 && (
                  <div style={{ fontSize: 11, color: '#64748B' }}>
                    📍 {p.locations.map((l) => l.facilityName + (l.shiftSharePct != null ? ` ${l.shiftSharePct}%` : '')).join(' · ')}
                  </div>
                )}

                {rateLabel ? (
                  <div style={{ fontSize: 12, color: '#2563EB', fontWeight: 600 }}>{rateLabel}</div>
                ) : needsRate(p) ? (
                  <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>⚠️ No rate — savings demo uses default</div>
                ) : null}

                {p.allInCostPerHour != null && (
                  <div style={{ fontSize: 11, color: '#64748B' }}>
                    All-in cost: <strong style={{ color: '#475569' }}>${p.allInCostPerHour}/hr</strong>
                  </div>
                )}

                {p.preferredDays && Array.isArray(p.preferredDays) && p.preferredDays.length > 0 && (
                  <div style={{ fontSize: 11, color: '#64748B' }}>
                    Prefers: {p.preferredDays.join(', ')}
                    {p.preferredShiftLength && p.preferredShiftLength !== 'none' ? ` · ${p.preferredShiftLength}` : ''}
                  </div>
                )}

                {(() => {
                  // PTO counter — only for PTO-eligible members (W-2 / full-time
                  // by default). Three figures: annual allotment, granted
                  // (booked this year), used so far (elapsed). Days are weekdays.
                  const pto = ptoSummary[p.id]
                  if (!pto || !pto.eligible) return null
                  const remaining = pto.annual - pto.granted
                  return (
                    <div style={{ fontSize: 11, color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '7px 10px' }}>
                      <div style={{ fontWeight: 700, color: '#334155', marginBottom: 2 }}>🌴 PTO ({new Date().getUTCFullYear()})</div>
                      <span><strong>{pto.annual}</strong> annual</span>
                      <span style={{ color: '#CBD5E1' }}> · </span>
                      <span><strong>{pto.granted}</strong> granted</span>
                      <span style={{ color: '#CBD5E1' }}> · </span>
                      <span><strong>{pto.used}</strong> used</span>
                      <span style={{ color: '#CBD5E1' }}> · </span>
                      <span style={{ color: remaining < 0 ? '#DC2626' : '#059669', fontWeight: 600 }}>{remaining} left</span>
                    </div>
                  )
                })()}


                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  <button onClick={() => openEdit(p)} style={{ padding: '6px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                    ✏️ Edit
                  </button>
                  <button onClick={() => setTimeOffMember(p)} style={{ padding: '6px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#B45309' }}>
                    🌴 Time Off
                  </button>
                  {!p.snapAccountLinked && (
                    <button
                      onClick={() => handleInviteToApp(p.id)}
                      disabled={!hasContact(p) || invitingToApp[p.id]}
                      title={!hasContact(p) ? 'Add an email or phone before inviting' : 'Email/SMS a download link for the marketplace mobile app'}
                      style={{ padding: '6px 14px', background: '#ECFDF5', border: '1px solid #6EE7B7', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: hasContact(p) ? 'pointer' : 'not-allowed', color: '#047857', opacity: hasContact(p) ? 1 : 0.5 }}
                    >
                      {invitingToApp[p.id] ? '…' : (p.inviteSentAt ? '↻ Re-invite to SNAP' : '📱 Invite to SNAP')}
                    </button>
                  )}
                  {canCredential(p) && p.credentialingStatus !== 'CLAIMED' && p.credentialingStatus !== 'COMPLETED' && (
                    <button
                      onClick={() => handleInvite(p.id)}
                      disabled={!hasContact(p)}
                      title={!hasContact(p) ? 'Add an email or phone to send a credentialing invite' : 'Send credentialing invite'}
                      style={{ padding: '6px 14px', background: p.credentialingStatus === 'INVITED' ? '#F0FDF4' : '#EFF6FF', border: `1px solid ${p.credentialingStatus === 'INVITED' ? '#86EFAC' : '#A5B4FC'}`, borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: hasContact(p) ? 'pointer' : 'not-allowed', color: p.credentialingStatus === 'INVITED' ? '#15803D' : '#1D4ED8', opacity: hasContact(p) ? 1 : 0.5 }}
                    >
                      {p.credentialingStatus === 'INVITED' ? '↻ Re-invite to SNAP Credentialing' : '✉️ Invite to SNAP Credentialing'}
                    </button>
                  )}
                  <button onClick={() => handleDelete(p.id)} disabled={deletingIds[p.id]} style={{ padding: '6px 14px', background: '#FFF5F5', border: '1px solid #FCA5A5', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#DC2626', marginLeft: 'auto' }}>
                    {deletingIds[p.id] ? '...' : '🗑️'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <Modal title={editTarget ? 'Edit Provider' : 'Add Provider'} onClose={() => setShowModal(false)}>
          {/* Core fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Provider Name" required>
                <input style={inputStyle} value={form.providerName} onChange={(e) => setF('providerName', e.target.value)} placeholder="Dr. Jane Smith" />
              </Field>
            </div>
            <Field label="Provider Type">
              <select style={inputStyle} value={form.providerType} onChange={(e) => setF('providerType', e.target.value)}>
                <option value="CRNA">CRNA</option>
                <option value="ANESTHESIOLOGIST">Anesthesiologist</option>
                <option value="ANESTHESIA_ASSISTANT">Anesthesia Assistant</option>
                <option value="STAFF">Staff (non-clinical)</option>
              </select>
            </Field>
            <Field label="Employment Category">
              <select style={inputStyle} value={form.employmentCategory} onChange={(e) => setF('employmentCategory', e.target.value)}>
                <option value="FULL_TIME">Full Time</option>
                <option value="PER_DIEM">Per Diem</option>
                <option value="LOCUMS">Locums</option>
              </select>
            </Field>
            <Field label="Employer">
              <input style={inputStyle} value={form.employer} onChange={(e) => setF('employer', e.target.value)} placeholder="Staffing group or practice" />
            </Field>
            <Field label="Tax Status">
              <select style={inputStyle} value={form.taxStatus} onChange={(e) => setF('taxStatus', e.target.value)}>
                <option value="">— Unknown —</option>
                <option value="W2">W-2 (employee)</option>
                <option value="1099">1099 (contractor)</option>
              </select>
            </Field>
            <Field label="Hours">
              <select style={inputStyle} value={form.hoursStatus} onChange={(e) => setF('hoursStatus', e.target.value)}>
                <option value="">— Unknown —</option>
                <option value="FT">Full-time</option>
                <option value="PT">Part-time</option>
              </select>
            </Field>
            <Field label="Payee Type (payroll)">
              <select style={inputStyle} value={form.payeeType} onChange={(e) => setF('payeeType', e.target.value)}>
                <option value="">— Not set —</option>
                <option value="Individual">Individual</option>
                <option value="Business">Business (LLC/PLLC)</option>
              </select>
            </Field>
            <Field label="Business Name (for 1099s paid as an LLC)">
              <input style={inputStyle} value={form.businessName} onChange={(e) => setF('businessName', e.target.value)} placeholder="e.g. Bailin Anesthesia LLC" />
            </Field>
            <Field label="EIN (business payees)">
              <input style={inputStyle} value={form.ein} onChange={(e) => setF('ein', e.target.value)} placeholder="e.g. 92-0725051" />
            </Field>

            {/* Dual employment — W-2 at one employer + 1099 at another. */}
            <Field label="Dual employment">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151' }}>
                <input type="checkbox" checked={form.dualEmployment} onChange={(e) => setF('dualEmployment', e.target.checked)} />
                W-2 at one employer AND 1099 at another (e.g. W-2 at the facility + 1099 via an agency)
              </label>
            </Field>
            {form.dualEmployment && (
              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8 }}>
                  W-2 salary uses the Annual Base Rate above. The Payee Type / Business Name / EIN / All-In Cost above describe the <strong>1099</strong> side.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                  <Field label="W-2 paid by">
                    <input style={inputStyle} value={form.w2Employer} onChange={(e) => setF('w2Employer', e.target.value)} placeholder="e.g. the facility" />
                  </Field>
                  <Field label="1099 paid by">
                    <input style={inputStyle} value={form.contractorEmployer} onChange={(e) => setF('contractorEmployer', e.target.value)} placeholder="e.g. the agency" />
                  </Field>
                </div>
                <Field label="1099 Pay Rate ($/hr)">
                  <input style={inputStyle} type="number" min="0" step="0.01" value={form.contractorPayRate} onChange={(e) => setF('contractorPayRate', e.target.value)} placeholder="What the 1099 side pays this provider/hr" />
                </Field>
              </div>
            )}
            <Field label="Payroll Name">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: form.businessName.trim() ? '#374151' : '#94A3B8' }}>
                <input
                  type="checkbox"
                  checked={form.useBusinessNameForPayroll}
                  disabled={!form.businessName.trim()}
                  onChange={(e) => setF('useBusinessNameForPayroll', e.target.checked)}
                />
                Pay under the business name (payroll only — used everywhere else by their name)
              </label>
            </Field>
            <Field label="SNAP Account Email">
              <input style={inputStyle} type="email" value={form.snapEmail} onChange={(e) => setF('snapEmail', e.target.value)} placeholder="provider@example.com" />
            </Field>
            <Field label="Phone Number">
              <input style={inputStyle} type="tel" value={form.phoneNumber} onChange={(e) => setF('phoneNumber', e.target.value)} placeholder="(555) 000-0000" />
            </Field>
            <Field label="NPI Number">
              <input style={inputStyle} value={form.npi} onChange={(e) => setF('npi', e.target.value)} placeholder="10-digit NPI" inputMode="numeric" />
            </Field>
            <Field label="License Expiration">
              <input style={inputStyle} type="date" value={form.licenseExpiration} onChange={(e) => setF('licenseExpiration', e.target.value)} />
            </Field>

            {/* PTO — eligibility + annual allotment (counter is shown on the card). */}
            <div style={{ gridColumn: '1 / -1', marginTop: 8, fontSize: 12, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: 0.4 }}>🌴 PTO</div>
            <Field label="PTO Eligible">
              <select style={inputStyle} value={form.ptoEligible} onChange={(e) => setF('ptoEligible', e.target.value)}>
                <option value="">— Auto (W-2 / full-time) —</option>
                <option value="YES">Eligible</option>
                <option value="NO">Not eligible</option>
              </select>
            </Field>
            <Field label="Annual PTO Days">
              <input style={inputStyle} type="number" min="0" value={form.ptoDaysAnnual} onChange={(e) => setF('ptoDaysAnnual', e.target.value)} placeholder="Default 20" />
            </Field>
            <Field label="Seniority Rank">
              <input style={inputStyle} type="number" min="1" value={form.seniorityRank} onChange={(e) => setF('seniorityRank', e.target.value)} placeholder="1 = most senior (optional)" />
            </Field>
          </div>

          {/* FULL_TIME fields */}
          {cat === 'FULL_TIME' && (
            <>
              <SectionDivider label="Full Time Details" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Field label="FTE Hours / Week" required>
                  <input style={inputStyle} type="number" min="1" max="60" value={form.fteHours} onChange={(e) => setF('fteHours', e.target.value)} placeholder="40" />
                </Field>
                <Field label="Annual Base Rate ($)" required>
                  <input style={inputStyle} type="number" min="0" value={form.annualRate} onChange={(e) => setF('annualRate', e.target.value)} placeholder="e.g. 220000" />
                </Field>
              </div>
            </>
          )}

          {/* PER_DIEM fields */}
          {cat === 'PER_DIEM' && (
            <>
              <SectionDivider label="Per Diem Details" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Field label="Base Hourly Rate ($)" required>
                  <input style={inputStyle} type="number" min="0" value={form.hourlyRate} onChange={(e) => setF('hourlyRate', e.target.value)} placeholder="e.g. 185" />
                </Field>
                <Field label="Max Shifts / Month">
                  <input style={inputStyle} type="number" min="1" value={form.maxShiftsPerMonth} onChange={(e) => setF('maxShiftsPerMonth', e.target.value)} placeholder="e.g. 12" />
                </Field>
              </div>
            </>
          )}

          {/* LOCUMS fields */}
          {cat === 'LOCUMS' && (
            <>
              <SectionDivider label="Locums Details" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Field label="Base Hourly Rate ($)" required>
                  <input style={inputStyle} type="number" min="0" value={form.hourlyRate} onChange={(e) => setF('hourlyRate', e.target.value)} placeholder="e.g. 220" />
                </Field>
                <div />
                <Field label="Contract Start">
                  <input style={inputStyle} type="date" value={form.contractStart} onChange={(e) => setF('contractStart', e.target.value)} />
                </Field>
                <Field label="Contract End">
                  <input style={inputStyle} type="date" value={form.contractEnd} onChange={(e) => setF('contractEnd', e.target.value)} />
                </Field>
              </div>
            </>
          )}

          {/* All-in cost — generic, optional, applies to any category. The
              facility's true loaded cost per hour: bill rate for agency 1099s,
              loaded cost for W-2 staff. Powers the agency-invoice + savings calc. */}
          <SectionDivider label="Cost Analysis (optional)" />
          <Field label="All-In Cost ($/hr)">
            <input style={inputStyle} type="number" min="0" step="0.01" value={form.allInCostPerHour} onChange={(e) => setF('allInCostPerHour', e.target.value)} placeholder="Fully-loaded cost to the facility — e.g. 240" />
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
              Leave blank unless you track it. For agency-staffed providers this is what you owe the agency all-in (pay + malpractice + margin).
            </div>
          </Field>

          {/* Shared preference fields */}
          <SectionDivider label="Scheduling Preferences" />

          <Field label="Preferred Shift Length">
            <select style={inputStyle} value={form.preferredShiftLength} onChange={(e) => setF('preferredShiftLength', e.target.value)}>
              {SHIFT_LENGTHS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>

          <Field label="Preferred Days">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {ALL_DAYS.map(day => {
                const active = form.preferredDays.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    style={{
                      padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      background: active ? '#2563EB' : '#F8FAFC',
                      color: active ? '#fff' : '#64748B',
                      border: `1px solid ${active ? '#2563EB' : '#E2E8F0'}`,
                      transition: 'all 0.12s',
                    }}
                  >
                    {day}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label="Credentialed Sites & Shift Share">
            {(() => {
              const sites = Array.from(new Set([...siteList, ...Object.keys(siteCred)])).sort((a, b) => a.localeCompare(b))
              if (sites.length === 0) {
                return <div style={{ fontSize: 13, color: '#94A3B8', padding: '8px 0' }}>No sites yet — they appear here once you have a coverage template or schedule.</div>
              }
              const total = Object.values(siteCred).filter((v) => v.on).reduce((s, v) => s + (parseFloat(v.pct) || 0), 0)
              const anyOn = Object.values(siteCred).some((v) => v.on)
              return (
                <>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 6 }}>Check each site this provider is credentialed at, then set their share of shifts there.</div>
                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, maxHeight: 240, overflowY: 'auto' }}>
                    {sites.map((name, i) => {
                      const v = siteCred[name] || {}
                      return (
                        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: i < sites.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer' }}>
                            <input type="checkbox" checked={!!v.on} onChange={() => toggleSite(name)} style={{ width: 16, height: 16 }} />
                            <span style={{ fontSize: 13, color: '#0F172A' }}>{name}</span>
                          </label>
                          {v.on && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input type="number" min="0" max="100" value={v.pct || ''} onChange={(e) => setSitePct(name, e.target.value)} placeholder="—" style={{ ...inputStyle, width: 62, padding: '6px 8px', textAlign: 'right' }} />
                              <span style={{ fontSize: 12, color: '#64748B' }}>%</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {anyOn && (
                    <div style={{ fontSize: 12, color: total === 100 ? '#059669' : '#94A3B8', marginTop: 6 }}>
                      Shift share totals {total}%{total === 100 ? ' ✓' : ' — aim for 100% across sites (StaffIQ normalizes either way)'}
                    </div>
                  )}
                </>
              )
            })()}
          </Field>

          <Field label="Additional Notes">
            <textarea style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} value={form.notes} onChange={(e) => setF('notes', e.target.value)} placeholder="Any relevant notes..." />
          </Field>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => setShowModal(false)} style={{ padding: '9px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '9px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving...' : 'Save Provider'}
            </button>
          </div>
        </Modal>
      )}

      {/* Bulk roster upload modal */}
      {showUploadModal && (
        <Modal title="Upload Roster" onClose={() => !uploading && setShowUploadModal(false)}>
          {!uploadResult ? (
            <>
              <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '0 0 16px' }}>
                Upload a <strong>CSV</strong> or <strong>Excel</strong> file with your current roster. Each row becomes a provider card you can edit afterward.
                <br />
                <span style={{ fontSize: 13, color: '#64748B' }}>
                  Tip: include the <strong>NPI</strong> column to auto-link providers to their SNAP profile.
                </span>
              </p>

              <div style={{ marginBottom: 16 }}>
                <button
                  onClick={downloadTemplate}
                  style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                >
                  📄 Download blank template (.csv)
                </button>
              </div>

              <div style={{ border: '2px dashed #CBD5E1', borderRadius: 12, padding: 24, textAlign: 'center', background: '#F8FAFC', marginBottom: 16 }}>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  style={{ display: 'block', margin: '0 auto' }}
                  disabled={uploading}
                />
                {uploadFile && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#64748B' }}>
                    Ready: <strong>{uploadFile.name}</strong> ({(uploadFile.size / 1024).toFixed(1)} KB)
                  </div>
                )}
              </div>

              <details style={{ marginBottom: 16, fontSize: 13, color: '#64748B' }}>
                <summary style={{ cursor: 'pointer', color: '#475569', fontWeight: 600 }}>
                  Expected columns
                </summary>
                <div style={{ marginTop: 8, padding: 12, background: '#F8FAFC', borderRadius: 8 }}>
                  <strong>Required:</strong>
                  <ul style={{ marginTop: 4, marginBottom: 8 }}>
                    <li><code>name</code> — provider full name</li>
                    <li><code>type</code> — CRNA / ANESTHESIOLOGIST / ANESTHESIA_ASSISTANT</li>
                    <li><code>employment</code> — FULL_TIME / PER_DIEM / LOCUMS</li>
                  </ul>
                  <strong>Recommended:</strong>
                  <ul style={{ marginTop: 4 }}>
                    <li><code>npi</code> — auto-links to existing provider profile</li>
                    <li><code>email</code>, <code>phone</code>, <code>license_number</code>, <code>license_expiration</code></li>
                    <li><code>hourly_rate</code> (per-diem/locums) or <code>annual_rate</code> + <code>fte_hours</code> (full-time)</li>
                  </ul>
                </div>
              </details>

              {uploadError && (
                <div style={{ background: '#FEF2F2', color: '#991B1B', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                  {uploadError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowUploadModal(false)} disabled={uploading} style={{ padding: '9px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
                  Cancel
                </button>
                <button onClick={handleUpload} disabled={!uploadFile || uploading} style={{ padding: '9px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: !uploadFile || uploading ? 'not-allowed' : 'pointer', opacity: !uploadFile || uploading ? 0.6 : 1 }}>
                  {uploading ? 'Importing…' : 'Import'}
                </button>
              </div>
            </>
          ) : (
            // Result summary
            <>
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#065F46', marginBottom: 8 }}>
                  ✓ Import complete
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: 13, color: '#065F46' }}>
                  <div><strong>{uploadResult.summary.created}</strong> providers created</div>
                  <div><strong>{uploadResult.summary.matchedToProfiles}</strong> matched to existing SNAP profiles via NPI</div>
                  {uploadResult.summary.locationsCreated > 0 && <div><strong>{uploadResult.summary.locationsCreated}</strong> location credentialings imported</div>}
                  {uploadResult.summary.skipped > 0 && <div><strong>{uploadResult.summary.skipped}</strong> blank rows skipped</div>}
                  {uploadResult.summary.skippedDuplicates > 0 && <div><strong>{uploadResult.summary.skippedDuplicates}</strong> already on roster — skipped</div>}
                  {uploadResult.summary.errors > 0 && <div><strong>{uploadResult.summary.errors}</strong> rows had errors (see below)</div>}
                </div>
              </div>

              {uploadResult.summary.needsNpiReview > 0 && (
                <div style={{ background: '#FEFCE8', border: '1px solid #FDE68A', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>
                    {uploadResult.summary.needsNpiReview} provider{uploadResult.summary.needsNpiReview !== 1 ? 's' : ''} need NPI review
                  </div>
                  <div style={{ fontSize: 13, color: '#92400E' }}>
                    We couldn't auto-match these to a single NPI. You can resolve them now or anytime from the roster page — your roster works either way.
                  </div>
                </div>
              )}

              {uploadResult.errors && uploadResult.errors.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B', marginBottom: 6 }}>Errors</div>
                  <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 8, maxHeight: 200, overflowY: 'auto' }}>
                    {uploadResult.errors.map((e, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#991B1B', padding: '4px 8px', borderBottom: '1px solid #FECACA' }}>
                        {e.row ? `Row ${e.row}` : (e.name || e.nameKey || 'row')} ({e.name || 'no name'}): {e.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                {uploadResult.summary.needsNpiReview > 0 && (
                  <button
                    onClick={async () => { setShowUploadModal(false); await loadNpiReview(); setShowNpiReview(true) }}
                    style={{ padding: '9px 20px', background: '#D97706', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Review NPIs now
                  </button>
                )}
                <button onClick={async () => { setShowUploadModal(false); await load(); await loadNpiReview() }} style={{ padding: '9px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  Done
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {showNpiReview && (
        <NpiReviewModal
          rows={npiReviewRows}
          onClose={() => { setShowNpiReview(false); loadNpiReview() }}
          onAllResolved={() => { setShowNpiReview(false); loadNpiReview() }}
        />
      )}

      {timeOffMember && (
        <TimeOffModal member={timeOffMember} onClose={() => setTimeOffMember(null)} />
      )}
    </div>
  )
}
