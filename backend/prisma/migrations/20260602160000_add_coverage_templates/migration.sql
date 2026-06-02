-- Coverage Templates — per-practice staffing patterns + holiday overrides.
-- See docs/coverage-templates-design.md for the design and v1.1 plans.

-- Holiday provenance. The federal-list inheritance is computed at read time,
-- so we only persist explicit additions and exclusions here.
CREATE TYPE "HolidaySource" AS ENUM (
  'PRACTICE_ADDED',
  'PRACTICE_EXCLUDED'
);

-- ────────────────────────────────────────────────────────────────────────────
-- CoverageTemplate
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE "CoverageTemplate" (
  "id"         TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "isDefault"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CoverageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoverageTemplate_facilityId_name_key"
  ON "CoverageTemplate"("facilityId", "name");

CREATE INDEX "CoverageTemplate_facilityId_isDefault_idx"
  ON "CoverageTemplate"("facilityId", "isDefault");

ALTER TABLE "CoverageTemplate"
  ADD CONSTRAINT "CoverageTemplate_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- CoverageTemplateDay
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE "CoverageTemplateDay" (
  "id"            TEXT NOT NULL,
  "templateId"    TEXT NOT NULL,
  "location"      TEXT NOT NULL,
  "dayOfWeek"     INTEGER NOT NULL,
  "roomsRequired" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "CoverageTemplateDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoverageTemplateDay_templateId_location_dayOfWeek_key"
  ON "CoverageTemplateDay"("templateId", "location", "dayOfWeek");

ALTER TABLE "CoverageTemplateDay"
  ADD CONSTRAINT "CoverageTemplateDay_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "CoverageTemplate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- FacilityHoliday
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE "FacilityHoliday" (
  "id"         TEXT NOT NULL,
  "facilityId" TEXT NOT NULL,
  "date"       DATE NOT NULL,
  "label"      TEXT NOT NULL,
  "source"     "HolidaySource" NOT NULL,
  CONSTRAINT "FacilityHoliday_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacilityHoliday_facilityId_date_key"
  ON "FacilityHoliday"("facilityId", "date");

CREATE INDEX "FacilityHoliday_facilityId_date_idx"
  ON "FacilityHoliday"("facilityId", "date");

ALTER TABLE "FacilityHoliday"
  ADD CONSTRAINT "FacilityHoliday_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
