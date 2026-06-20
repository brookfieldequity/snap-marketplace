-- EOR (Employer-of-Record) — Phase 0
-- See capa-pilot/eor-model-spec.md.
--
-- Promotes the free-form InternalRosterEntry.employer string to a first-class
-- Employer entity (who actually pays a provider) and adds itemized pass-through
-- cost lines (malpractice etc.) so CAPA's savings number and the APNE->CAPA
-- reimbursement total are both computable. Additive only — no data is dropped,
-- the legacy `employer` string column is retained as a denormalized mirror.
--
-- NOTE: the marketplace backend boots via `prisma db push`, so prod gets these
-- changes from the schema, not from this file. This migration is committed to
-- keep prisma/migrations/ in sync for local `migrate dev`. The DATA backfill is
-- a SEPARATE step (see prisma/migrations/20260618000000_add_eor_phase0/backfill.sql)
-- and is NOT run automatically by db push.

-- ────────────────────────────────────────────────────────────────────────────
-- Enums
-- ────────────────────────────────────────────────────────────────────────────
CREATE TYPE "EmployerKind" AS ENUM (
  'FACILITY_SELF',
  'STAFFING_AGENCY'
);

CREATE TYPE "CostComponentType" AS ENUM (
  'MALPRACTICE',
  'AGENCY_MARGIN',
  'STIPEND',
  'TRAVEL',
  'OTHER'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Employer — the Employer-of-Record (who pays the provider)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE "Employer" (
  "id"              TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "legalName"       TEXT,
  "ein"             TEXT,
  "kind"            "EmployerKind" NOT NULL DEFAULT 'STAFFING_AGENCY',
  "ownerFacilityId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Employer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Employer_ownerFacilityId_key"
  ON "Employer"("ownerFacilityId");

ALTER TABLE "Employer"
  ADD CONSTRAINT "Employer_ownerFacilityId_fkey"
  FOREIGN KEY ("ownerFacilityId") REFERENCES "Facility"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- EmployerFacilityLink — which facilities an agency may staff (firewall allow-list)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE "EmployerFacilityLink" (
  "id"         TEXT NOT NULL,
  "employerId" TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployerFacilityLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployerFacilityLink_employerId_facilityId_key"
  ON "EmployerFacilityLink"("employerId", "facilityId");

ALTER TABLE "EmployerFacilityLink"
  ADD CONSTRAINT "EmployerFacilityLink_employerId_fkey"
  FOREIGN KEY ("employerId") REFERENCES "Employer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmployerFacilityLink"
  ADD CONSTRAINT "EmployerFacilityLink_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- AssignmentCostComponent — itemized pass-throughs on top of the bill rate
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE "AssignmentCostComponent" (
  "id"              TEXT NOT NULL,
  "rosterEntryId"   TEXT,
  "assignmentId"    TEXT,
  "type"            "CostComponentType" NOT NULL,
  "amountPerHour"   DOUBLE PRECISION,
  "amountPerShift"  DOUBLE PRECISION,
  "paidBy"          TEXT NOT NULL DEFAULT 'FACILITY',
  "reimbursable"    BOOLEAN NOT NULL DEFAULT false,
  "facilityVisible" BOOLEAN NOT NULL DEFAULT true,
  "note"            TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssignmentCostComponent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssignmentCostComponent_rosterEntryId_idx"
  ON "AssignmentCostComponent"("rosterEntryId");

CREATE INDEX "AssignmentCostComponent_assignmentId_idx"
  ON "AssignmentCostComponent"("assignmentId");

ALTER TABLE "AssignmentCostComponent"
  ADD CONSTRAINT "AssignmentCostComponent_rosterEntryId_fkey"
  FOREIGN KEY ("rosterEntryId") REFERENCES "InternalRosterEntry"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssignmentCostComponent"
  ADD CONSTRAINT "AssignmentCostComponent_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "ScheduleAssignment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- InternalRosterEntry — add the EOR foreign key (legacy `employer` string kept)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE "InternalRosterEntry"
  ADD COLUMN "employerId" TEXT;

ALTER TABLE "InternalRosterEntry"
  ADD CONSTRAINT "InternalRosterEntry_employerId_fkey"
  FOREIGN KEY ("employerId") REFERENCES "Employer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
