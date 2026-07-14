import React, { useState, useEffect } from 'react'

/**
 * Controlled numeric input that behaves correctly, unlike a raw
 * `<input type="number" value={num} onChange={e => setX(Number(e.target.value)||0)}>`:
 *
 *  - Clearing the field shows BLANK, not a forced "0".
 *  - Leading zeros are stripped as you type ("010" → "10", "07" → "7").
 *  - It owns its own display string, so React's controlled-number re-render
 *    no-op can't leave a stale "010" on screen when the value normalizes to a
 *    number already in state.
 *
 * Drop-in for the common pattern. Props:
 *   value    — number (0/undefined shows blank)
 *   onChange — (n: number) => void   (called with the parsed number; empty → 0)
 *   ...rest  — min, max, step, placeholder, disabled, style, className, onBlur, etc.
 *
 * Note: onChange receives a NUMBER, not the event. Migrate callers from
 *   onChange={e => setX(Number(e.target.value) || 0)}   →   onChange={setX}
 */
export default function NumberInput({ value, onChange, ...rest }) {
  const blankValue = value === 0 || value == null || Number.isNaN(value)
  const [text, setText] = useState(blankValue ? '' : String(value))

  // Re-sync when the value changes externally (e.g. a slider, a reset, a load).
  useEffect(() => {
    setText(value === 0 || value == null || Number.isNaN(value) ? '' : String(value))
  }, [value])

  return (
    <input
      type="number"
      value={text}
      onChange={(e) => {
        // type=number already blocks non-numerics; strip only leading zeros so
        // "010" reads "10" while "0.5" is preserved (the 0 is followed by '.').
        const cleaned = e.target.value.replace(/^0+(?=\d)/, '')
        setText(cleaned)
        onChange(cleaned === '' ? 0 : Number(cleaned))
      }}
      {...rest}
    />
  )
}
