// Shared name-fingerprint helpers. Extracted so the Payroll Builder can match
// SchedulingRecord rows to InternalRosterEntry rows using the SAME rule the
// roster importer uses (first-initial + last-name, alphanumeric, lowercased).
// roster.js still has its own inline copy for the multi-sheet import path; if
// that is ever refactored it should import from here too.

const NAME_SUFFIXES = new Set([
  'jr', 'sr', 'ii', 'iii', 'iv', 'v',
  'md', 'do', 'crna', 'aa', 'phd', 'rn', 'pa', 'np',
  'esq', 'esquire',
]);

function stripSuffix(token) {
  return token.replace(/[.,]/g, '').toLowerCase();
}

/**
 * Build a name fingerprint from a raw name string.
 * Handles both "First Last" and "Last, First". Returns lowercase
 * first-initial + last-name (alphanumeric only), or null if unparseable.
 */
function buildNameKey(rawName) {
  if (!rawName) return null;
  const s = String(rawName).trim();
  let firstName, lastName;
  if (s.includes(',')) {
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2 && parts[1].split(/\s+/).every((t) => NAME_SUFFIXES.has(stripSuffix(t)))) {
      const tokens = parts[0].split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        firstName = tokens[0];
        lastName = tokens[tokens.length - 1];
      }
    } else {
      lastName = parts[0];
      firstName = parts[1] || '';
    }
  } else {
    let parts = s.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return null;
    while (parts.length > 2 && NAME_SUFFIXES.has(stripSuffix(parts[parts.length - 1]))) {
      parts = parts.slice(0, -1);
    }
    firstName = parts[0];
    lastName = parts[parts.length - 1];
  }
  if (!firstName || !lastName) return null;
  const lastTokens = lastName.split(/\s+/).filter(Boolean);
  if (lastTokens.length > 1 && NAME_SUFFIXES.has(stripSuffix(lastTokens[lastTokens.length - 1]))) {
    lastName = lastTokens.slice(0, -1).join(' ');
  }
  return (firstName[0] + lastName).toLowerCase().replace(/[^a-z0-9]/g, '');
}

module.exports = { buildNameKey };
