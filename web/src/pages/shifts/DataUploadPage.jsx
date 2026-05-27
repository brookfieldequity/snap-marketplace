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

export default function DataUploadPage({ onNavigate }) {
  // Step: 1 = file select, 2 = column mapping, 3 = success
  const [step, setStep] = useState(1)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  // Step 2 data
  const [uploadResult, setUploadResult] = useState(null) // API response
  const [mapping, setMapping] = useState({}) // { standardKey: detectedColumnName }
  const [fileData, setFileData] = useState(null) // base64

  // Step 3
  const [confirming, setConfirming] = useState(false)
  const [confirmResult, setConfirmResult] = useState(null)
  const [runningAnalysis, setRunningAnalysis] = useState(false)

  // Upload history
  const [uploads, setUploads] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const fileRef = useRef(null)

  useEffect(() => {
    facilityAPI.getUploads()
      .then(d => setUploads(Array.isArray(d) ? d : d.uploads || []))
      .catch(() => setUploads([]))
      .finally(() => setHistoryLoading(false))
  }, [])

  async function handleFile(file) {
    if (!file) return
    if (isPDF(file)) {
      setUploadError('PDF files cannot be parsed for scheduling data. Please export your data as CSV or Excel from your scheduling system such as Schedule4, QGenda, OpenShift, or OpenTempo.')
      return
    }
    if (!isAccepted(file)) {
      setUploadError('Please upload a .csv, .xlsx, or .xls file.')
      return
    }
    setUploadError(null)
    setUploading(true)

    // Read as base64
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const base64 = ev.target.result
      setFileData(base64)
      try {
        const fd = new FormData()
        fd.append('file', file)
        const result = await facilityAPI.uploadScheduleData(fd)
        setUploadResult(result)

        // Initialize mapping from suggested mapping in result
        const suggested = result.suggestedMapping || result.mapping || {}
        const initMap = {}
        STANDARD_FIELDS.forEach(f => {
          initMap[f.key] = suggested[f.key] || ''
        })
        setMapping(initMap)
        setStep(2)
      } catch (e) {
        setUploadError(e.message || 'Upload failed. Please try again.')
      } finally {
        setUploading(false)
      }
    }
    reader.readAsDataURL(file)
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
      const result = await facilityAPI.confirmUpload({
        mapping,
        fileData,
        uploadId: uploadResult?.uploadId || uploadResult?.id,
      })
      setConfirmResult(result)
      setStep(3)
      // Refresh upload history
      facilityAPI.getUploads().then(d => setUploads(Array.isArray(d) ? d : d.uploads || [])).catch(() => {})
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
    setFileData(null)
    setMapping({})
    setUploadError(null)
    setConfirmResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const detectedColumns = uploadResult?.columns || uploadResult?.detectedColumns || []
  const previewRows = uploadResult?.preview || uploadResult?.previewRows || []

  // ── STEP 1 ──
  if (step === 1) {
    return (
      <div style={{ padding: '32px 40px', maxWidth: 820, margin: '0 auto' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0 }}>Upload Scheduling Data</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>Import CSV or Excel exports from Schedule4, QGenda, OpenShift, OpenTempo, or any scheduling system.</p>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
          {[{ n: 1, label: 'Upload File' }, { n: 2, label: 'Map Columns' }, { n: 3, label: 'Done' }].map((s, i) => (
            <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: step >= s.n ? '#6366F1' : '#E2E8F0', color: step >= s.n ? '#fff' : '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>
                {step > s.n ? '✓' : s.n}
              </div>
              <span style={{ fontSize: 13, fontWeight: step === s.n ? 700 : 400, color: step === s.n ? '#0F172A' : '#94A3B8' }}>{s.label}</span>
              {i < 2 && <div style={{ width: 32, height: 1, background: '#E2E8F0', margin: '0 4px' }} />}
            </div>
          ))}
        </div>

        {/* Drop zone */}
        <div
          onClick={() => !uploading && fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${dragOver ? '#6366F1' : '#CBD5E1'}`,
            borderRadius: 16, padding: '56px 40px', textAlign: 'center',
            cursor: uploading ? 'default' : 'pointer',
            background: dragOver ? '#F5F3FF' : '#F8FAFC',
            transition: 'all 0.15s ease', marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>{uploading ? '⏳' : '📤'}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
            {uploading ? 'Uploading…' : 'Drop your file here'}
          </div>
          <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 16 }}>
            Supports .csv, .xlsx, .xls only
          </div>
          {!uploading && (
            <button
              onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}
              style={{ padding: '9px 20px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
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

        {/* Upload History */}
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
                      {u.rowCount != null ? `${u.rowCount} rows` : ''}
                      {u.dateRange ? ` · ${u.dateRange}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: '#94A3B8' }}>
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      background: u.status === 'CONFIRMED' ? '#F0FDF4' : '#F8FAFC',
                      color: u.status === 'CONFIRMED' ? '#15803D' : '#64748B',
                      border: `1px solid ${u.status === 'CONFIRMED' ? '#86EFAC' : '#E2E8F0'}`,
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

  // ── STEP 2: Column Mapping ──
  if (step === 2) {
    return (
      <div style={{ padding: '32px 40px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <button onClick={resetToStep1} style={{ background: 'none', border: 'none', color: '#6366F1', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
            ← Back to Upload
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0 }}>Map Your Columns</h1>
          <p style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>We detected {detectedColumns.length} columns in your file. Confirm the mapping below.</p>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {[{ n: 1, label: 'Upload File' }, { n: 2, label: 'Map Columns' }, { n: 3, label: 'Done' }].map((s, i) => (
            <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: step >= s.n ? '#6366F1' : '#E2E8F0', color: step >= s.n ? '#fff' : '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>
                {step > s.n ? '✓' : s.n}
              </div>
              <span style={{ fontSize: 13, fontWeight: step === s.n ? 700 : 400, color: step === s.n ? '#0F172A' : '#94A3B8' }}>{s.label}</span>
              {i < 2 && <div style={{ width: 32, height: 1, background: '#E2E8F0', margin: '0 4px' }} />}
            </div>
          ))}
        </div>

        {/* Mapping table */}
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

        {/* Preview table */}
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
          <button onClick={handleConfirm} disabled={confirming} style={{ padding: '10px 22px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: confirming ? 'not-allowed' : 'pointer', opacity: confirming ? 0.7 : 1 }}>
            {confirming ? 'Importing...' : 'Confirm Import'}
          </button>
        </div>
      </div>
    )
  }

  // ── STEP 3: Success ──
  return (
    <div style={{ padding: '32px 40px', maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 36, justifyContent: 'center' }}>
        {[{ n: 1, label: 'Upload File' }, { n: 2, label: 'Map Columns' }, { n: 3, label: 'Done' }].map((s, i) => (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#6366F1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>✓</div>
            <span style={{ fontSize: 13, fontWeight: s.n === 3 ? 700 : 400, color: s.n === 3 ? '#0F172A' : '#94A3B8' }}>{s.label}</span>
            {i < 2 && <div style={{ width: 32, height: 1, background: '#86EFAC', margin: '0 4px' }} />}
          </div>
        ))}
      </div>

      <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 20, padding: '48px 40px', marginBottom: 24 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#15803D', marginBottom: 8 }}>Import Complete!</div>
        <div style={{ fontSize: 15, color: '#064E3B' }}>
          Successfully imported{' '}
          <strong>
            {confirmResult?.recordCount ?? confirmResult?.rowsImported ?? confirmResult?.rowsProcessed ?? ''}
          </strong>{' '}
          records.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={handleRunAnalysis}
          disabled={runningAnalysis}
          style={{ padding: '12px 24px', background: '#6366F1', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: runningAnalysis ? 'not-allowed' : 'pointer', opacity: runningAnalysis ? 0.7 : 1, boxShadow: '0 4px 12px rgba(99,102,241,0.35)' }}
        >
          {runningAnalysis ? '⚡ Running Analysis...' : '⚡ Run StaffIQ Analysis'}
        </button>
        <button
          onClick={resetToStep1}
          style={{ padding: '12px 24px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', color: '#374151' }}
        >
          Upload Another File
        </button>
      </div>
    </div>
  )
}
