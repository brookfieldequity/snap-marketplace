import { useEffect, useMemo, useState } from 'react'
import { facilityAPI } from '../../api.js'

/**
 * Coverage Templates — per-practice staffing patterns.
 *
 * v1 captures (location, dayOfWeek, roomsRequired) per template. Used to
 * materialize ScheduleDay rows when a coordinator generates a new month.
 * See docs/coverage-templates-design.md.
 *
 * UI:
 *   - List view: cards of existing templates with name, location count,
 *     total rooms/week, default-flag, plus actions (Edit, Duplicate, Delete)
 *   - Editor view: grid of (location row × day-of-week column) with a
 *     number stepper in each cell. Add Location / Remove Location actions.
 */

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function CoverageTemplatesPage() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null) // string id, 'NEW', or null
  const [error, setError] = useState(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await facilityAPI.getCoverageTemplates()
      setTemplates(res.templates || [])
    } catch (err) {
      setError(err.message || 'Failed to load templates.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (editingId === 'NEW') {
    return (
      <TemplateEditor
        templateId={null}
        onSaved={() => {
          setEditingId(null)
          load()
        }}
        onCancel={() => setEditingId(null)}
      />
    )
  }

  if (editingId) {
    return (
      <TemplateEditor
        templateId={editingId}
        onSaved={() => {
          setEditingId(null)
          load()
        }}
        onCancel={() => setEditingId(null)}
      />
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div>
          <h1 style={styles.title}>Coverage Templates</h1>
          <p style={styles.subtitle}>
            Standard staffing patterns for your practice. When you build a new month's schedule,
            pick a template to pre-fill it with the right locations and room counts. Edit any day
            afterward as you normally would.
          </p>
        </div>
        <button style={styles.primaryBtn} onClick={() => setEditingId('NEW')}>
          + New Template
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {loading ? (
        <div style={styles.empty}>Loading templates…</div>
      ) : templates.length === 0 ? (
        <div style={styles.empty}>
          No templates yet. Click "+ New Template" above to create your first one.
        </div>
      ) : (
        <div style={styles.list}>
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onEdit={() => setEditingId(t.id)}
              onDuplicate={async () => {
                try {
                  await facilityAPI.duplicateCoverageTemplate(t.id)
                  load()
                } catch (err) {
                  alert('Failed to duplicate: ' + err.message)
                }
              }}
              onDelete={async () => {
                if (!confirm(`Delete "${t.name}"? This can't be undone.`)) return
                try {
                  await facilityAPI.deleteCoverageTemplate(t.id)
                  load()
                } catch (err) {
                  alert('Failed to delete: ' + err.message)
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TemplateCard({ template, onEdit, onDuplicate, onDelete }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div>
          <div style={styles.cardName}>
            {template.name}
            {template.isDefault && <span style={styles.defaultBadge}>★ default</span>}
          </div>
          <div style={styles.cardMeta}>
            {template.locationCount} location{template.locationCount !== 1 ? 's' : ''} ·
            &nbsp;{template.totalRoomsPerWeek} rooms/week
          </div>
        </div>
        <div style={styles.cardActions}>
          <button style={styles.secondaryBtn} onClick={onEdit}>Edit</button>
          <button style={styles.secondaryBtn} onClick={onDuplicate}>Duplicate</button>
          <button style={styles.dangerBtn} onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor
// ─────────────────────────────────────────────────────────────────────────────

function TemplateEditor({ templateId, onSaved, onCancel }) {
  const isNew = !templateId
  const [name, setName] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  /** rows: Array<{ location: string, counts: number[7] }> */
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [newLocation, setNewLocation] = useState('')

  useEffect(() => {
    if (isNew) return
    facilityAPI
      .getCoverageTemplate(templateId)
      .then((res) => {
        const t = res.template
        setName(t.name)
        setIsDefault(t.isDefault)
        // Pivot days[] into rows by location. supervisionRatio is a
        // per-location setting in the UI (usually consistent across days);
        // take the first non-null value seen for the location.
        const byLocation = {}
        const ratioByLocation = {}
        for (const d of t.days) {
          if (!byLocation[d.location]) byLocation[d.location] = Array(7).fill(0)
          byLocation[d.location][d.dayOfWeek] = d.roomsRequired
          if (d.supervisionRatio != null && ratioByLocation[d.location] == null) {
            ratioByLocation[d.location] = d.supervisionRatio
          }
        }
        setRows(
          Object.keys(byLocation)
            .sort()
            .map((loc) => ({
              location: loc,
              counts: byLocation[loc],
              // Default to MD-only (0) for locations with no coverage model
              // set (legacy days). null in the data = legacy role-agnostic;
              // the UI surfaces it as MD-only so saving makes it explicit.
              supervisionRatio: ratioByLocation[loc] ?? 0,
            }))
        )
      })
      .catch((err) => setError(err.message || 'Failed to load.'))
      .finally(() => setLoading(false))
  }, [templateId, isNew])

  function updateCell(rowIdx, dayIdx, value) {
    setRows((current) => {
      const next = current.map((r) => ({ ...r, counts: [...r.counts] }))
      const n = Math.max(0, Math.min(99, Number(value) || 0))
      next[rowIdx].counts[dayIdx] = n
      return next
    })
  }

  function updateRatio(rowIdx, value) {
    setRows((current) => {
      const next = current.map((r) => ({ ...r, counts: [...r.counts] }))
      // '0' → MD-only; '3'/'4' → team ratio
      next[rowIdx].supervisionRatio = Number(value)
      return next
    })
  }

  function addLocation() {
    const trimmed = newLocation.trim()
    if (!trimmed) return
    if (rows.some((r) => r.location.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" is already in this template.`)
      return
    }
    setRows([...rows, { location: trimmed, counts: Array(7).fill(0), supervisionRatio: 0 }])
    setNewLocation('')
    setError(null)
  }

  function removeLocation(idx) {
    setRows((current) => current.filter((_, i) => i !== idx))
  }

  function flattenForSave() {
    const days = []
    for (const r of rows) {
      for (let dow = 0; dow < 7; dow++) {
        const rooms = r.counts[dow] || 0
        if (rooms > 0) {
          days.push({
            location: r.location,
            dayOfWeek: dow,
            roomsRequired: rooms,
            // Apply the location's coverage model to every active day.
            supervisionRatio: r.supervisionRatio ?? null,
          })
        }
      }
    }
    return days
  }

  async function save() {
    setError(null)
    const trimmedName = name.trim()
    if (!trimmedName) return setError('Template name is required.')
    if (rows.length === 0) return setError('Add at least one location.')
    const days = flattenForSave()
    if (days.length === 0) return setError('Set at least one day with rooms > 0.')

    setSaving(true)
    try {
      if (isNew) {
        await facilityAPI.createCoverageTemplate({ name: trimmedName, isDefault, days })
      } else {
        await facilityAPI.updateCoverageTemplate(templateId, { name: trimmedName, isDefault, days })
      }
      onSaved()
    } catch (err) {
      setError(err.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={styles.empty}>Loading template…</div>

  return (
    <div style={styles.page}>
      <button style={styles.backLink} onClick={onCancel}>← Back to templates</button>

      <div style={styles.editorHeader}>
        <input
          style={styles.editorNameInput}
          placeholder="Template name (e.g., Standard Week)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label style={styles.checkboxLabel}>
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Make this the default template for the practice
        </label>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.gridWrap}>
        <table style={styles.grid}>
          <thead>
            <tr>
              <th style={{ ...styles.gridTh, textAlign: 'left', width: '22%' }}>Location</th>
              <th style={{ ...styles.gridTh, width: '130px' }}>Coverage</th>
              {DAY_LABELS.map((d) => (
                <th key={d} style={styles.gridTh}>{d}</th>
              ))}
              <th style={styles.gridTh}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.location}>
                <td style={styles.gridLocCell}>{row.location}</td>
                <td style={styles.gridCell}>
                  <select
                    value={String(row.supervisionRatio ?? 0)}
                    onChange={(e) => updateRatio(idx, e.target.value)}
                    style={styles.coverageSelect}
                  >
                    <option value="0">MD only</option>
                    <option value="3">Team 1:3</option>
                    <option value="4">Team 1:4</option>
                  </select>
                </td>
                {row.counts.map((count, dow) => (
                  <td key={dow} style={styles.gridCell}>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={count}
                      onChange={(e) => updateCell(idx, dow, e.target.value)}
                      style={styles.stepperInput}
                    />
                  </td>
                ))}
                <td style={styles.gridCell}>
                  <button style={styles.linkDanger} onClick={() => removeLocation(idx)}>Remove</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} style={{ ...styles.gridCell, color: '#94A3B8', textAlign: 'center', padding: 24 }}>
                  No locations yet. Add one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={styles.addLocationRow}>
        <input
          style={styles.field}
          placeholder="Add a location (e.g., Atrius Kenmore)"
          value={newLocation}
          onChange={(e) => setNewLocation(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addLocation()
            }
          }}
        />
        <button style={styles.secondaryBtn} onClick={addLocation}>+ Add Location</button>
      </div>

      <div style={styles.saveBar}>
        <button style={styles.secondaryBtn} onClick={onCancel} disabled={saving}>Cancel</button>
        <button style={styles.primaryBtn} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Template'}
        </button>
      </div>
    </div>
  )
}

const styles = {
  page: { padding: 32, maxWidth: 1200, margin: '0 auto' },
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: 700, color: '#1E293B', margin: '0 0 8px' },
  subtitle: { fontSize: 14, color: '#64748B', margin: 0, maxWidth: 720, lineHeight: 1.5 },
  primaryBtn: { padding: '10px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap' },
  secondaryBtn: { padding: '8px 16px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 8, fontWeight: 500, cursor: 'pointer', fontSize: 13 },
  dangerBtn: { padding: '8px 16px', background: '#fff', color: '#DC2626', border: '1.5px solid #FECACA', borderRadius: 8, fontWeight: 500, cursor: 'pointer', fontSize: 13 },
  linkDanger: { background: 'none', border: 'none', color: '#DC2626', fontWeight: 500, fontSize: 12, cursor: 'pointer', padding: 0 },
  backLink: { background: 'none', border: 'none', color: '#2563EB', fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 16 },
  empty: { textAlign: 'center', padding: 60, color: '#94A3B8', fontSize: 15, background: '#fff', borderRadius: 12, border: '1px dashed #E2E8F0' },
  error: { background: '#FEF2F2', color: '#991B1B', padding: 12, borderRadius: 8, fontSize: 14, marginBottom: 16, border: '1px solid #FECACA' },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  card: { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 20 },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  cardName: { fontSize: 16, fontWeight: 600, color: '#1E293B', display: 'flex', alignItems: 'center', gap: 10 },
  defaultBadge: { fontSize: 11, fontWeight: 600, color: '#1E3A8A', background: '#DBEAFE', padding: '2px 8px', borderRadius: 999 },
  cardMeta: { fontSize: 13, color: '#64748B', marginTop: 4 },
  cardActions: { display: 'flex', gap: 8 },

  editorHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' },
  editorNameInput: { flex: 1, minWidth: 280, padding: '12px 16px', fontSize: 18, fontWeight: 600, border: '1.5px solid #E2E8F0', borderRadius: 8, outline: 'none' },
  checkboxLabel: { fontSize: 13, color: '#475569', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
  gridWrap: { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden', marginBottom: 16 },
  grid: { width: '100%', borderCollapse: 'collapse' },
  gridTh: { padding: '12px 8px', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5, background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', textAlign: 'center' },
  gridLocCell: { padding: '10px 16px', fontSize: 14, fontWeight: 500, color: '#1E293B', borderBottom: '1px solid #F1F5F9' },
  gridCell: { padding: 6, textAlign: 'center', borderBottom: '1px solid #F1F5F9' },
  stepperInput: { width: 56, padding: '6px 4px', textAlign: 'center', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 14, fontWeight: 600, color: '#1E293B', outline: 'none' },
  coverageSelect: { width: 110, padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#1E293B', background: '#fff', outline: 'none', cursor: 'pointer' },
  addLocationRow: { display: 'flex', gap: 8, marginBottom: 24 },
  field: { flex: 1, padding: '10px 14px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 14, outline: 'none' },
  saveBar: { display: 'flex', justifyContent: 'flex-end', gap: 12 },
}
