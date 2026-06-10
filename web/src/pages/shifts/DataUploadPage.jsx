import React, { useState, useRef, useEffect } from 'react'
import { facilityAPI } from '../../api.js'

const STANDARD_FIELDS = [
  { key: 'date', label: 'Date' },
  { key: 'location', label: 'Location / Room' },
  { key: 'providerName', label: 'Provider Name' },
  { key: 'providerType', label: 'Provider Type' },
  { key: 'startTime', label: 'Start Time' },
  { key: 'endTime', label: 'End Time' },
  { key: 'duration', label: 'Duration (hrs)' },
  { key: 'caseType', label: 'Case Type' },
]

const ACCEPTED_TYPES = ['.csv', '.xlsx', '.xls']
const ACCEPTED_MIME = ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']

function isAccepted(file) {
  if (ACCEPTED_MIME.includes(file.type)) return true
  const ext = '.' + file.name.split('.').pop().toLowerCase()
  return ACCEPTED_TYPES.includes(ext)
}

function isPDF(file) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function StepIndicator({ step }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
      {[{ n: 1, label: 'Upload File' }, { n: 2, label: 'Review' }, { n: 3, label: 'Done' }].map((s, i) => (
        <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%',
            background: step >= s.n ? '#2563EB' : '#E2E8F0',
            color: step >= s.n ? '#fff' : '#94A3B8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 12,
          }}>
            {step > s.n ? '✓' : s.n}
          </div>
          <span style={{ fontSize: 13, fontWeight: step === s.n ? 700 : 400, color: step === s.n ? '#0F172A' : '#94A3B8' }}>{s.label}</span>
          {i < 2 && <div style={{ width: 32, height: 1, background: '#E2E8F0', margin: '0 4px' }} />}
        </div>
      ))}
    </div>
  )
}

export default function DataUploadPage({ onNavigate }) {
  const [step, setStep] = useState(1)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  const [uploadResult, setUploadResult] = useState(null)
  const [mapping, setMapping] = useState({})

  const [confirming, setConfirming] = useState(false)
  const [confirmResult, setConfirmResult] = useState(null)
  const [runningAnalysis, setRunningAnalysis] = useState(false)

  const [uploads, setUploads] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const fileRef = useRef(null)

  useEffect(() => {
    facilityAPI.getUploads()
      .then(d => setUploads(Array.isArray(d) ? d : d.uploads || []))
      .catch(() => setUploads([]))
      .finally(() => setHistoryLoading(false))
  }, [])

  const isMatrixFormat = uploadResult?.format === 'schedule4_matrix'

  // Derive facility breakdown from matrix preview records
  const matrixFacilities = isMatrixFormat
    ? Object.entries(
        (uploadResult?.records || uploadResult?.preview || []).reduce((acc, r) => {
          if (!acc[r.facility]) acc[r.facility] = { anes: 0, crna: 0 }
          if (r.providerType === 'ANES') acc[r.facility].anes++
          else acc[r.facility].crna++
          return acc
        }, {})
      ).sort((a, b) => a[0].localeCompare(b[0]))
    : []

  const matrixDates = isMatrixFormat
    ? (uploadResult?.records || uploadResult?.preview || []).map(r => r.date).filter(Boolean).sort()
    : []
  const matrixDateStart = matrixDates[0] || null
  const matrixDateEnd = matrixDates[matrixDates.length - 1] || null

  async function handleFile(file) {
    if (!file) return
    if (isPDF(file)) {
      setUploadError('PDF files cannot be parsed for scheduling data. Please export your data as CSV or Excel from Schedule4, QGenda, OpenShift, or OpenTempo.')
      return
    }
    if (!isAccepted(file)) {
      setUploadError('Please upload a .csv, .xlsx, or .xls file.')
      return
    }
    setUploadError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const result = await facilityAPI.uploadScheduleData(fd)
      setUploadResult(result)

      if (result.format !== 'schedule4_matrix') {
        const suggested = result.suggestedMapping || result.mapping || {}
        const initMap = {}
        STANDARD_FIELDS.forEach(f => { initMap[f.key] = suggested[f.key] || '' })
        setMapping(initMap)
      }

      setStep(2)
    } catch (e) {
      setUploadError(e.message || 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  async function handleConfirm() {
    setConfirming(true)
    try {
      const payload = {
        fileName: uploadResult.fileName,
        fileData: uploadResult.fileData,
        format: uploadResult.format,
      }
      if (!isMatrixFormat) payload.mapping = mapping

      const result = await facilityAPI.confirmUpload(payload)
      setConfirmResult(result)
      setStep(3)
      facilityAPI.getUploads().then(d => setUploads(Array.isArray(d) ? d : d.uploads || [])).catch(() => {})

      // Auto-run analysis for Schedule4 uploads
      if (isMatrixFormat) {
        setRunningAnalysis(true)
        facilityAPI.runStaffIQAnalysis()
          .then(() => { onNavigate('staffiq') })
          .catch(() => { setRunningAnalysis(false) })
      }
    } catch (e) {
      alert('Confirm failed: ' + e.message)
    } finally {
      setConfirming(false)
    }
  }

  async function handleRunAnalysis() {
    setRunningAnalysis(true)
    try {
      await facilityAPI.runStaffIQAnalysis()
      onNavigate('staffiq')
    } catch (e) {
      alert('Analysis failed: ' + e.message)
    } finally {
      setRunningAnalysis(false)
    }
  }

  function resetToStep1() {
    setStep(1)
    setUploadResult(null)
    setMapping({})
    setUploadError(null)
    setConfirmResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const detectedColumns = uploadResult?.columns || uploadResult?.detectedColumns || []
  const previewRows = uploadResult?.preview || uploadResult?.previewRows || []

  // ── STEP 1 ────────────────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div style={{ padding: '32px 40px', maxWidth: 820, margin: '0 auto' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>Upload Scheduling Data</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>Import CSV or Excel exports from Schedule4, QGenda, OpenShift, OpenTempo, or any scheduling system.</p>
        </div>

        <StepIndicator step={step} />

        <div
          onClick={() => !uploading && fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${dragOver ? '#2563EB' : '#CBD5E1'}`,
            borderRadius: 16, padding: '56px 40px', textAlign: 'center',
            cursor: uploading ? 'default' : 'pointer',
            background: dragOver ? '#F5F3FF' : '#F8FAFC',
            transition: 'all 0.15s ease', marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>{uploading ? '⏳' : '📤'}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
            {uploading ? 'Uploading & parsing…' : 'Drop your file here'}
          </div>
          <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 16 }}>
            Supports .csv, .xlsx, .xls — Schedule4, QGenda, OpenTempo automatically detected
          </div>
          {!uploading && (
            <button
              onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}
              style={{ padding: '9px 20px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              Browse files
            </button>
          )}
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} style={{ display: 'none' }} />
        </div>

        {uploadError && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '14px 18px', color: '#DC2626', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
            {uploadError}
          </div>
        )}

        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 14 }}>Previous Uploads</div>
          {historyLoading && <div style={{ color: '#94A3B8', fontSize: 13 }}>Loading history...</div>}
          {!historyLoading && uploads.length === 0 && (
            <div style={{ color: '#94A3B8', fontSize: 13, fontStyle: 'italic' }}>No uploads yet.</div>
          )}
          {!historyLoading && uploads.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
              {uploads.map((u, i) => (
                <div key={u.id || i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', borderBottom: i < uploads.length - 1 ? '1px solid #F1F5F9' : 'none', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 20 }}>📄</div>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>{u.fileName || u.filename || 'Unnamed file'}</div>
                    <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                      {u.rowCount != null ? `${u.rowCount} records` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      background: u.status === 'COMPLETE' || u.status === 'CONFIRMED' ? '#F0FDF4' : '#F8FAFC',
                      color: u.status === 'COMPLETE' || u.status === 'CONFIRMED' ? '#15803D' : '#64748B',
                      border: `1px solid ${u.status === 'COMPLETE' || u.status === 'CONFIRMED' ? '#86EFAC' : '#E2E8F0'}`,
                    }}>
                      {u.status || 'Uploaded'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── STEP 2A: Schedule4 Matrix Preview ─────────────────────────────────────────
  if (step === 2 && isMatrixFormat) {
    return (
      <div style={{ padding: '32px 40px', maxWidth: 820, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <button onClick={resetToStep1} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
            ← Back to Upload
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0 }}>Schedule4 File Detected</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>
            SNAP automatically parsed your scheduling export. Review the summary below and import to run StaffIQ analysis.
          </p>
        </div>

        <StepIndicator step={step} />

        {/* Auto-detected badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 12, padding: '14px 18px', marginBottom: 24 }}>
          <span style={{ fontSize: 22 }}>✅</span>
          <div>
            <div style={{ fontWeight: 700, color: '#15803D', fontSize: 14 }}>Schedule4 Matrix Format Detected</div>
            <div style={{ fontSize: 13, color: '#064E3B' }}>
              {uploadResult.totalRecords} provider-shift records parsed across {matrixFacilities.length} facilities
              {matrixDateStart && matrixDateEnd ? ` · ${matrixDateStart} to ${matrixDateEnd}` : ''}
            </div>
          </div>
        </div>

        {/* Facility breakdown */}
        {matrixFacilities.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ padding: '12px 18px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Facility Breakdown</span>
            </div>
            {matrixFacilities.map(([facility, counts], i) => (
              <div key={facility} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: i < matrixFacilities.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0F172A' }}>{facility}</div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <span style={{ fontSize: 13, color: '#2563EB', fontWeight: 600 }}>{counts.anes} ANES</span>
                  <span style={{ fontSize: 13, color: '#10B981', fontWeight: 600 }}>{counts.crna} CRNA</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: '16px 18px', marginBottom: 28, fontSize: 13, color: '#475569', lineHeight: 1.7 }}>
          <strong style={{ color: '#0F172A' }}>What happens next:</strong> SNAP will import all {uploadResult.totalRecords} records and immediately run StaffIQ analysis — calculating your team model efficiency, Friday shortage risk, and annualized cost savings opportunity.
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={resetToStep1} style={{ padding: '10px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming}
            style={{ padding: '11px 26px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: confirming ? 'not-allowed' : 'pointer', opacity: confirming ? 0.7 : 1, boxShadow: '0 4px 12px rgba(37,99,235,0.3)' }}
          >
            {confirming ? '⚡ Importing & Analyzing…' : `⚡ Import ${uploadResult.totalRecords} Records & Run Analysis`}
          </button>
        </div>
      </div>
    )
  }

  // ── STEP 2B: Standard Column Mapping ─────────────────────────────────────────
  if (step === 2) {
    return (
      <div style={{ padding: '32px 40px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <button onClick={resetToStep1} style={{ background: 'none', border: 'none', color: '#2563EB', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
            ← Back to Upload
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0 }}>Map Your Columns</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>We detected {detectedColumns.length} columns in your file. Confirm the mapping below.</p>
        </div>

        <StepIndicator step={step} />

        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
            <div style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Standard Field</div>
            <div style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mapped To (your column)</div>
          </div>
          {STANDARD_FIELDS.map((f, i) => (
            <div key={f.key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: i < STANDARD_FIELDS.length - 1 ? '1px solid #F1F5F9' : 'none', alignItems: 'center' }}>
              <div style={{ padding: '12px 16px', fontSize: 14, fontWeight: 500, color: '#374151' }}>{f.label}</div>
              <div style={{ padding: '8px 12px' }}>
                <select
                  value={mapping[f.key] || ''}
                  onChange={(e) => setMapping(p => ({ ...p, [f.key]: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 7, fontSize: 13, color: '#374151', background: '#F8FAFC' }}
                >
                  <option value="">-- Skip --</option>
                  {detectedColumns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>

        {previewRows.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 10 }}>Preview (first {previewRows.length} rows)</div>
            <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #E2E8F0', background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    {detectedColumns.slice(0, 8).map(col => (
                      <th key={col} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 5).map((row, ri) => (
                    <tr key={ri} style={{ borderBottom: ri < 4 ? '1px solid #F1F5F9' : 'none' }}>
                      {detectedColumns.slice(0, 8).map(col => (
                        <td key={col} style={{ padding: '8px 12px', color: '#374151', whiteSpace: 'nowrap' }}>
                          {typeof row === 'object' ? row[col] ?? '' : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={resetToStep1} style={{ padding: '10px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#374151' }}>Cancel</button>
          <button onClick={handleConfirm} disabled={confirming} style={{ padding: '10px 22px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: confirming ? 'not-allowed' : 'pointer', opacity: confirming ? 0.7 : 1 }}>
            {confirming ? 'Importing...' : 'Confirm Import'}
          </button>
        </div>
      </div>
    )
  }

  // ── STEP 3: Success ───────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '32px 40px', maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 36, justifyContent: 'center' }}>
        {[{ n: 1, label: 'Upload File' }, { n: 2, label: 'Review' }, { n: 3, label: 'Done' }].map((s, i) => (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#2563EB', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>✓</div>
            <span style={{ fontSize: 13, fontWeight: s.n === 3 ? 700 : 400, color: s.n === 3 ? '#0F172A' : '#94A3B8' }}>{s.label}</span>
            {i < 2 && <div style={{ width: 32, height: 1, background: '#86EFAC', margin: '0 4px' }} />}
          </div>
        ))}
      </div>

      {runningAnalysis ? (
        <div style={{ background: '#F5F3FF', border: '1px solid #93C5FD', borderRadius: 20, padding: '48px 40px', marginBottom: 24 }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>⚡</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#2563EB', marginBottom: 8 }}>Running StaffIQ Analysis…</div>
          <div style={{ fontSize: 15, color: '#4C1D95' }}>
            Calculating team model efficiency, Friday shortage risk, and cost savings. Redirecting to your insights in a moment.
          </div>
        </div>
      ) : (
        <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 20, padding: '48px 40px', marginBottom: 24 }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#15803D', marginBottom: 8 }}>Import Complete!</div>
          <div style={{ fontSize: 15, color: '#064E3B' }}>
            Successfully imported{' '}
            <strong>{confirmResult?.rowCount ?? confirmResult?.recordCount ?? confirmResult?.rowsImported ?? ''}</strong>{' '}
            records.
          </div>
        </div>
      )}

      {!runningAnalysis && (
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleRunAnalysis}
            disabled={runningAnalysis}
            style={{ padding: '12px 24px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(37,99,235,0.35)' }}
          >
            ⚡ Run StaffIQ Analysis
          </button>
          <button
            onClick={resetToStep1}
            style={{ padding: '12px 24px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', color: '#374151' }}
          >
            Upload Another File
          </button>
        </div>
      )}
    </div>
  )
}
