import React, { useState, useEffect } from 'react'
import { adminAPI } from '../../api.js'

const STATUS_TABS = [
  { key: 'ALL',            label: 'All' },
  { key: 'NEW',            label: 'New' },
  { key: 'CONTACTED',      label: 'Contacted' },
  { key: 'DEMO_SCHEDULED', label: 'Demo Scheduled' },
  { key: 'CUSTOMER',       label: 'Customer' },
  { key: 'NOT_INTERESTED', label: 'Not Interested' },
]

const STATUS_OPTIONS = [
  { value: 'NEW',            label: 'New' },
  { value: 'CONTACTED',      label: 'Contacted' },
  { value: 'DEMO_SCHEDULED', label: 'Demo Scheduled' },
  { value: 'CUSTOMER',       label: 'Customer' },
  { value: 'NOT_INTERESTED', label: 'Not Interested' },
]

function fmt$(n) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function buildCSV(leads) {
  const headers = ['Facility Name', 'Contact', 'Email', 'Calculator Type', 'Savings Estimate', 'Report Sent', 'Received Date', 'Follow Up Status']
  const rows = leads.map((l) => [
    l.facilityName || '',
    l.contactName || '',
    l.email || '',
    l.calculatorType || '',
    l.savingsEstimate != null ? l.savingsEstimate : '',
    l.reportSent ? 'Yes' : 'No',
    l.createdAt ? new Date(l.createdAt).toISOString().slice(0, 10) : '',
    l.followUpStatus || '',
  ])
  return [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const STATUS_BADGE_COLORS = {
  NEW:            { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
  CONTACTED:      { bg: '#F5F3FF', color: '#172554', border: '#DDD6FE' },
  DEMO_SCHEDULED: { bg: '#FFF7ED', color: '#C2410C', border: '#FED7AA' },
  CUSTOMER:       { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  NOT_INTERESTED: { bg: '#F8FAFC', color: '#64748B', border: '#E2E8F0' },
}

export default function AdminLeadsPage() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('ALL')
  const [updating, setUpdating] = useState({})

  useEffect(() => {
    setLoading(true)
    adminAPI.getAdminLeads()
      .then((data) => setLeads(Array.isArray(data) ? data : data.leads || []))
      .catch(() => setLeads([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = activeTab === 'ALL' ? leads : leads.filter((l) => l.followUpStatus === activeTab)

  const totalLeads = leads.length
  const openLeads = leads.filter((l) => l.followUpStatus === 'NEW' || l.followUpStatus === 'CONTACTED').length
  const converted = leads.filter((l) => l.followUpStatus === 'CUSTOMER').length
  const totalSavings = leads.reduce((sum, l) => sum + (l.savingsEstimate || 0), 0)

  const handleStatusChange = async (id, status) => {
    setUpdating((prev) => ({ ...prev, [id]: true }))
    try {
      await adminAPI.updateLeadStatus(id, status)
      setLeads((prev) => prev.map((l) => l.id === id ? { ...l, followUpStatus: status } : l))
    } catch {
      // silently ignore
    } finally {
      setUpdating((prev) => ({ ...prev, [id]: false }))
    }
  }

  const handleExport = () => {
    downloadCSV(buildCSV(filtered), `snap-leads-${Date.now()}.csv`)
  }

  return (
    <div style={{ padding: '32px 40px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>
            Leads Management
          </h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4, marginBottom: 0 }}>
            Calculator submissions and follow-up pipeline
          </p>
        </div>
        <button
          onClick={handleExport}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 18px',
            background: '#0F172A',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <span>📥</span> Export CSV
        </button>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Total Leads',            value: totalLeads,       icon: '📬', color: '#2563EB' },
          { label: 'Open (New + Contacted)', value: openLeads,        icon: '🔓', color: '#F59E0B' },
          { label: 'Converted',              value: converted,        icon: '✅', color: '#10B981' },
          { label: 'Total Savings Est.',     value: fmt$(totalSavings), icon: '💰', color: '#2563EB' },
        ].map(({ label, value, icon, color }) => (
          <div
            key={label}
            style={{
              background: '#fff',
              borderRadius: 14,
              padding: '20px 24px',
              border: '1px solid #E2E8F0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {label}
              </div>
              <span style={{ fontSize: 20 }}>{icon}</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, color, letterSpacing: '-0.02em' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {STATUS_TABS.map((tab) => {
          const isActive = activeTab === tab.key
          const count = tab.key === 'ALL' ? leads.length : leads.filter((l) => l.followUpStatus === tab.key).length
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '7px 16px',
                borderRadius: 20,
                border: isActive ? '1px solid #2563EB' : '1px solid #E2E8F0',
                background: isActive ? '#EFF6FF' : '#fff',
                color: isActive ? '#1E40AF' : '#475569',
                fontSize: 13,
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              {tab.label} <span style={{ fontSize: 11, color: isActive ? '#2563EB' : '#94A3B8' }}>({count})</span>
            </button>
          )
        })}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        {loading ? (
          <div style={{ padding: '60px 40px', textAlign: 'center', color: '#94A3B8', fontSize: 15 }}>Loading leads…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '60px 40px', textAlign: 'center', color: '#94A3B8', fontSize: 15 }}>No leads found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                {['Facility Name', 'Contact', 'Email', 'Calc Type', 'Savings Est.', 'Report Sent', 'Received', 'Follow Up Status'].map((h) => (
                  <th
                    key={h}
                    style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead, idx) => {
                const badgeStyle = STATUS_BADGE_COLORS[lead.followUpStatus] || STATUS_BADGE_COLORS.NOT_INTERESTED
                return (
                  <tr
                    key={lead.id || idx}
                    style={{ borderBottom: '1px solid #F1F5F9', transition: 'background 0.1s' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#F8FAFC'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: '#0F172A' }}>
                      {lead.facilityName || '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#374151' }}>
                      {lead.contactName || '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#2563EB' }}>
                      {lead.email ? <a href={`mailto:${lead.email}`} style={{ color: '#2563EB', textDecoration: 'none' }}>{lead.email}</a> : '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: '#374151' }}>
                      {lead.calculatorType || '—'}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 700, color: '#10B981' }}>
                      {fmt$(lead.savingsEstimate)}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13 }}>
                      <span style={{ color: lead.reportSent ? '#10B981' : '#94A3B8', fontWeight: 600 }}>
                        {lead.reportSent ? '✓ Yes' : 'No'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748B' }}>
                      {fmtDate(lead.createdAt)}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <select
                        value={lead.followUpStatus || 'NEW'}
                        disabled={updating[lead.id]}
                        onChange={(e) => handleStatusChange(lead.id, e.target.value)}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 8,
                          border: `1px solid ${badgeStyle.border}`,
                          background: badgeStyle.bg,
                          color: badgeStyle.color,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          outline: 'none',
                        }}
                      >
                        {STATUS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
