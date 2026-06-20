-- Provider hour-entry + all-in cost + payee identity + location default windows
-- (everything added after 20260618000000_add_eor_phase0).
-- See capa-pilot/eor-model-spec.md.
--
-- Additive only — no drops. The marketplace backend boots via `prisma db push`,
-- so prod gets these from the schema; this file keeps prisma/migrations/ in sync
-- for local `migrate dev`. No data backfill needed (all new columns are nullable
-- or defaulted, and ProviderHourEntry is a fresh table).

-- ── InternalRosterEntry: all-in cost rate + payee identity ──────────────────────
ALTER TABLE "InternalRosterEntry"
  ADD COLUMN "allInCostPerHour" DOUBLE PRECISION,
  ADD COLUMN "payeeType"        TEXT,
  ADD COLUMN "ein"              TEXT;

-- ── CoverageTemplateDay: default shift window per location-day ───────────────────
ALTER TABLE "CoverageTemplateDay"
  ADD COLUMN "defaultStartTime" TEXT,
  ADD COLUMN "defaultEndTime"   TEXT;

-- ── ProviderHourEntry: confirmed worked hours per provider/day ──────────────────
CREATE TABLE "ProviderHourEntry" (
  "id"            TEXT NOT NULL,
  "facilityId"    TEXT NOT NULL,
  "rosterEntryId" TEXT NOT NULL,
  "date"          DATE NOT NULL,
  "location"      TEXT,
  "startTime"     TEXT,
  "endTime"       TEXT,
  "hours"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status"        TEXT NOT NULL DEFAULT 'DRAFT',
  "source"        TEXT NOT NULL DEFAULT 'MANUAL',
  "enteredBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderHourEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderHourEntry_rosterEntryId_date_location_key"
  ON "ProviderHourEntry"("rosterEntryId", "date", "location");

CREATE INDEX "ProviderHourEntry_facilityId_date_idx"
  ON "ProviderHourEntry"("facilityId", "date");

ALTER TABLE "ProviderHourEntry"
  ADD CONSTRAINT "ProviderHourEntry_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProviderHourEntry"
  ADD CONSTRAINT "ProviderHourEntry_rosterEntryId_fkey"
  FOREIGN KEY ("rosterEntryId") REFERENCES "InternalRosterEntry"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
