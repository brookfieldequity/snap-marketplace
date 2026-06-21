import React, { useEffect, useState } from 'react'
import { adminAPI } from '../api.js'

// Weekly scorecard (EOS "seven numbers") for the admin home. Reads
// GET /admin/scorecard (AUTO metrics from existing data + roiCalc) and lets the
// admin set the MANUAL inputs (MRR / pipeline / days-to-close / CAPA NPS) that
// the platform can't auto-compute yet. See docs/admin-scorecard-spec.md.

const RAG = { green: '#10B981', yellow: '#F59E0B', red: '#DC2626', na: '#94A3B8' }

function fmt(value, unit) {
  if (value == null) return '—'
  if (unit === '$') return '$' + Number(value).toLocaleString()
  if (unit === '%') return value + '%'
  return `${value}${unit || ''}`
}

export default function WeeklyScorecard() {
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  function load() {
    adminAPI.getScorecard().then(setData).catch(() => setData(null))
  }
  useEffect(() => { load() }, [])

  function openEditor() {
    const m = data?.manual || {}
    setForm({
      mrrMonthly: m.mrrMonthly ?? '', pipelineActive: m.pipelineActive ?? '',
      avgDaysToClose: m.avgDaysToClose ?? '', capaNps: m.capaNps ?? '',
    })
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    try {
      const num = (v) => (v === '' || v == null ? null : Number(v))
      await adminAPI.setScorecardManual({
        mrrMonthly: num(form.mrrMonthly), pipelineActive: num(form.pipelineActive),
        avgDaysToClose: num(form.avgDaysToClose), capaNps: num(form.capaNps),
      })
      setEditing(false)
      load()
    } catch { alert('Failed to save scorecard inputs.') } finally { setSaving(false) }
  }

  if (!data) return null
  const metrics = data.metrics || []

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: 0 }}>Weekly Scorecard</h2>
        <button onClick={openEditor}
          style={{ padding: '6px 12px', background: '#fff', color: '#2563EB', border: '1.5px solid #C7D2FE', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          Update manual inputs
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {metrics.map((m) => (
          <div key={m.key} style={{ background: '#fff', border: '1px solid #E2E8F0', borderLeft: `4px solid ${RAG[m.status] || RAG.na}`, borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748B', minHeight: 30 }}>{m.label}</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em', marginTop: 4 }}>
              {fmt(m.value, m.unit)}
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
              {m.secondary ? `${m.secondary} · ` : ''}{m.target != null ? `target ${fmt(m.target, m.unit)}` : ''}
            </div>
            <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {m.source}
            </div>
          </div>
        ))}
      </div>

      {data.secondary?.credentialsExpiringSoon > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#B45309' }}>
          ⚠️ {data.secondary.credentialsExpiringSoon} credential(s) expiring soon
        </div>
      )}

      {editing && (
        <div style={{ marginTop: 14, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginBottom: 4 }}>Manual inputs</div>
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 12 }}>
            MRR (until billing exists), pipeline + days-to-close (from HubSpot), and Facility NPS (until a survey exists). Leave blank to use the auto estimate / show no data.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            {[
              { k: 'mrrMonthly', label: 'MRR ($/mo)' },
              { k: 'pipelineActive', label: 'Active pipeline (#)' },
              { k: 'avgDaysToClose', label: 'Avg days to close' },
              { k: 'capaNps', label: 'Facility NPS (1-10)' },
            ].map(({ k, label }) => (
              <label key={k} style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>
                {label}
                <input type="number" value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  style={{ width: '100%', marginTop: 4, padding: '8px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={save} disabled={saving}
              style={{ padding: '8px 18px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)}
              style={{ padding: '8px 18px', background: '#fff', color: '#475569', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
