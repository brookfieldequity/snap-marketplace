import React from 'react'

const STATUS_CONFIG = {
  DEPOSIT_PENDING: { label: 'Deposit Pending', bg: '#F1F5F9', color: '#64748B', border: '#CBD5E1' },
  LIVE:            { label: 'Live',             bg: '#EFF6FF', color: '#1D4ED8', border: '#A5B4FC' },
  FILLED:          { label: 'Filled',           bg: '#FFFBEB', color: '#D97706', border: '#FCD34D' },
  COMPLETED:       { label: 'Completed',        bg: '#ECFDF5', color: '#059669', border: '#6EE7B7' },
  CANCELLED:       { label: 'Cancelled',        bg: '#FEF2F2', color: '#DC2626', border: '#FCA5A5' },
  EXPIRED:         { label: 'Expired',          bg: '#F8FAFC', color: '#94A3B8', border: '#E2E8F0' },
  DISPUTED:        { label: 'Disputed',         bg: '#FEF2F2', color: '#DC2626', border: '#FCA5A5' },
  PENDING:         { label: 'Pending',          bg: '#FFF7ED', color: '#C2410C', border: '#FDBA74' },
  CONFIRMED:       { label: 'Confirmed',        bg: '#ECFDF5', color: '#059669', border: '#6EE7B7' },
}

export default function StatusBadge({ status, style = {} }) {
  const cfg = STATUS_CONFIG[status] || {
    label: status || 'Unknown',
    bg: '#F1F5F9',
    color: '#64748B',
    border: '#CBD5E1',
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.02em',
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {cfg.label}
    </span>
  )
}
