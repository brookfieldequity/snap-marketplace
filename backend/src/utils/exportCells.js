// Formula-injection guard for generated CSV/XLSX EXPORTS (hardening audit
// 2026-07-13, input #5). User-entered strings (provider names, facility names,
// notes, line-item labels) that begin with = + - @ (or a tab/CR variant)
// execute as formulas when a coordinator opens the export in Excel/Sheets —
// e.g. a roster name of `=HYPERLINK(...)` or `@SUM(...)`. Prefixing a single
// quote makes Excel render the value as literal text.
//
// ALL export writers must go through this module — do not copy the regex into
// individual routes. Current writers:
//   services/payroll.js   generateCsv (ADP/Gusto payroll CSV, via csvCell)
//   routes/payroll.js     GET /agency-invoice/export (xlsx, via sanitizeAoa)
//   routes/credentialing.js GET /providers/export (roster CSV, via csvCell)
//   routes/admin.js       GET /calculator-leads/export (leads CSV, via csvCell)

// Sanitize ONE cell value. Strings only — numbers, Dates, booleans, and null
// pass through untouched so numeric columns keep computing in Excel. A string
// that is itself a plain number (e.g. "-350.00" from money()) is also left
// alone: a bare numeric literal is not a formula vector, and quoting it would
// break downstream payroll-system parsing.
function sanitizeCell(v) {
  if (typeof v !== 'string' || v === '') return v;
  const c = v[0];
  if (c === '=' || c === '@' || c === '\t' || c === '\r') return `'${v}`;
  if ((c === '+' || c === '-') && Number.isNaN(Number(v))) return `'${v}`;
  return v;
}

// CSV-escape a single cell, sanitizing first. Null/undefined become ''.
function csvCell(v) {
  const s = String(v == null ? '' : sanitizeCell(v));
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// For XLSX array-of-arrays sheets: sanitize every string cell, leave the rest.
function sanitizeAoa(aoa) {
  return aoa.map((row) => row.map(sanitizeCell));
}

module.exports = { sanitizeCell, csvCell, sanitizeAoa };
