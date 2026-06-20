-- Dual employment (W-2 + 1099) on the roster + per-site non-CAPA flag.
-- See capa-pilot/eor-model-spec.md (site-ownership + dual-employment section).
--
-- Additive only. Prod applies via `db push` on deploy; this keeps migrations/ in
-- sync for local `migrate dev`. No backfill needed (defaults + nullable cols, and
-- FacilityLocation is a fresh table populated as coordinators flag non-CAPA sites).

-- ── InternalRosterEntry: dual-employment fields ─────────────────────────────────
ALTER TABLE "InternalRosterEntry"
  ADD COLUMN "dualEmployment"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "w2Employer"         TEXT,
  ADD COLUMN "contractorEmployer" TEXT,
  ADD COLUMN "contractorPayRate"  DOUBLE PRECISION;

-- ── FacilityLocation: per-site settings (non-CAPA flag) ─────────────────────────
CREATE TABLE "FacilityLocation" (
  "id"         TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "siteName"   TEXT NOT NULL,
  "isExternal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacilityLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacilityLocation_facilityId_siteName_key"
  ON "FacilityLocation"("facilityId", "siteName");

ALTER TABLE "FacilityLocation"
  ADD CONSTRAINT "FacilityLocation_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
