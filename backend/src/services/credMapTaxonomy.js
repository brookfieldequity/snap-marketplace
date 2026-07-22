/**
 * Cred Map canonical taxonomy (2026-07-22).
 *
 * Every facility words its requirements differently ("Copy of current MA
 * license", "Licensure — attach"), but the underlying asks repeat. Map items
 * normalize to these canonical keys so (a) auto-fill wiring is stable across
 * facilities and (b) cross-facility requirement overlap is measurable — the
 * dataset behind the eventual "common app" case to the boards.
 *
 * `credentialType` links a key to the passport credential it populates from
 * (null = the passport doesn't hold this today). `fulfillment` is the default
 * CredMapFulfillment for new items of this key — the coordinator can override
 * per item in the builder.
 */

const TAXONOMY = {
  APPLICATION_FORM: { label: 'Application form (demographics)', fulfillment: 'AUTO_PASSPORT', credentialType: null },
  STATE_LICENSE: { label: 'State professional license', fulfillment: 'AUTO_PASSPORT', credentialType: 'STATE_LICENSE' },
  STATE_CS_LICENSE: { label: 'State controlled-substance registration', fulfillment: 'AUTO_PASSPORT', credentialType: 'MA_CS_LICENSE' },
  DEA_CERTIFICATE: { label: 'DEA registration', fulfillment: 'AUTO_PASSPORT', credentialType: 'DEA_CERTIFICATE' },
  BOARD_CERTIFICATION: { label: 'Board certification', fulfillment: 'AUTO_PASSPORT', credentialType: 'BOARD_CERTIFICATION' },
  EDUCATION_TRAINING: { label: 'Education & training history', fulfillment: 'AUTO_PASSPORT', credentialType: 'EDUCATION_HISTORY' },
  WORK_HISTORY_CV: { label: 'CV / work history', fulfillment: 'AUTO_PASSPORT', credentialType: 'CV' },
  HOSPITAL_PRIVILEGES: { label: 'Hospital privileges / affiliations', fulfillment: 'AUTO_PASSPORT', credentialType: 'HOSPITAL_PRIVILEGES' },
  MALPRACTICE_INSURANCE: { label: 'Malpractice insurance certificate', fulfillment: 'AUTO_PASSPORT', credentialType: 'MALPRACTICE_INSURANCE' },
  MALPRACTICE_HISTORY: { label: 'Malpractice claims history', fulfillment: 'AUTO_PASSPORT', credentialType: 'MALPRACTICE_HISTORY' },
  NPDB_QUERY: { label: 'NPDB self-query / authorization', fulfillment: 'AUTO_PASSPORT', credentialType: 'NPDB_AUTHORIZATION' },
  ACLS: { label: 'ACLS certification', fulfillment: 'AUTO_PASSPORT', credentialType: 'ACLS_CERTIFICATION' },
  BLS: { label: 'BLS certification', fulfillment: 'AUTO_PASSPORT', credentialType: 'BLS_CERTIFICATION' },
  PALS: { label: 'PALS certification', fulfillment: 'DOCUMENT', credentialType: null },
  PHOTO_ID: { label: 'Government photo ID', fulfillment: 'DOCUMENT', credentialType: null },
  TB_TEST: { label: 'TB test / screening', fulfillment: 'DOCUMENT', credentialType: null },
  IMMUNIZATIONS: { label: 'Immunization records', fulfillment: 'DOCUMENT', credentialType: null },
  FLU_VACCINE: { label: 'Influenza vaccination', fulfillment: 'DOCUMENT', credentialType: null },
  HEP_B: { label: 'Hepatitis B vaccination / titer', fulfillment: 'DOCUMENT', credentialType: null },
  PHYSICAL_EXAM: { label: 'Health statement / physical exam', fulfillment: 'DOCUMENT', credentialType: null },
  DRUG_SCREEN: { label: 'Drug screen', fulfillment: 'DOCUMENT', credentialType: null },
  BACKGROUND_CHECK: { label: 'Criminal background check (CORI)', fulfillment: 'MANUAL', credentialType: null },
  OIG_SAM_EXCLUSION: { label: 'OIG / SAM exclusion check', fulfillment: 'MANUAL', credentialType: null },
  MEDICARE_ENROLLMENT: { label: 'Medicare/Medicaid enrollment status', fulfillment: 'MANUAL', credentialType: null },
  PEER_REFERENCES: { label: 'Peer references', fulfillment: 'MANUAL', credentialType: null },
  DELINEATION_OF_PRIVILEGES: { label: 'Delineation of privileges request', fulfillment: 'SIGNATURE', credentialType: null },
  ATTESTATION_SIGNATURE: { label: 'Attestation / release signature', fulfillment: 'SIGNATURE', credentialType: null },
  FACILITY_SPECIFIC: { label: 'Facility-specific form', fulfillment: 'MANUAL', credentialType: null },
  OTHER: { label: 'Other', fulfillment: 'MANUAL', credentialType: null },
}

const CANONICAL_KEYS = Object.keys(TAXONOMY)

// Starter checklist for the no-AI / from-scratch path: the requirements that
// appear on essentially every ASC medical-staff application.
const STARTER_ITEMS = [
  { canonicalType: 'APPLICATION_FORM', section: 'Application' },
  { canonicalType: 'ATTESTATION_SIGNATURE', section: 'Application' },
  { canonicalType: 'DELINEATION_OF_PRIVILEGES', section: 'Application' },
  { canonicalType: 'STATE_LICENSE', section: 'Licensure' },
  { canonicalType: 'STATE_CS_LICENSE', section: 'Licensure' },
  { canonicalType: 'DEA_CERTIFICATE', section: 'Licensure' },
  { canonicalType: 'BOARD_CERTIFICATION', section: 'Certifications' },
  { canonicalType: 'ACLS', section: 'Certifications' },
  { canonicalType: 'BLS', section: 'Certifications' },
  { canonicalType: 'WORK_HISTORY_CV', section: 'History' },
  { canonicalType: 'EDUCATION_TRAINING', section: 'History' },
  { canonicalType: 'MALPRACTICE_INSURANCE', section: 'Insurance' },
  { canonicalType: 'MALPRACTICE_HISTORY', section: 'Insurance' },
  { canonicalType: 'NPDB_QUERY', section: 'Verification' },
  { canonicalType: 'PEER_REFERENCES', section: 'Verification' },
  { canonicalType: 'TB_TEST', section: 'Health' },
  { canonicalType: 'IMMUNIZATIONS', section: 'Health' },
].map((it) => ({
  ...it,
  label: TAXONOMY[it.canonicalType].label,
  fulfillment: TAXONOMY[it.canonicalType].fulfillment,
  credentialType: TAXONOMY[it.canonicalType].credentialType,
}))

/** Defaults (fulfillment + passport credentialType) for a canonical key. */
function defaultsFor(canonicalType) {
  const t = TAXONOMY[canonicalType] || TAXONOMY.OTHER
  return { fulfillment: t.fulfillment, credentialType: t.credentialType }
}

module.exports = { TAXONOMY, CANONICAL_KEYS, STARTER_ITEMS, defaultsFor }
