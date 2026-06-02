-- Add FacilityType enum and migrate Facility.facilityType from free-form text.
-- Existing values are bucketed by keyword; anything unmatched but non-null becomes 'OTHER'.

CREATE TYPE "FacilityType" AS ENUM (
  'HOSPITAL',
  'SURGERY_CENTER',
  'OUTPATIENT',
  'DENTAL',
  'OTHER'
);

-- Normalize the existing text column into the enum's labels first, in place.
UPDATE "Facility"
SET "facilityType" = CASE
  WHEN "facilityType" IS NULL THEN NULL
  WHEN LOWER("facilityType") LIKE '%hospital%' THEN 'HOSPITAL'
  WHEN LOWER("facilityType") LIKE '%surg%' OR LOWER("facilityType") LIKE '%asc%' THEN 'SURGERY_CENTER'
  WHEN LOWER("facilityType") LIKE '%outpat%' OR LOWER("facilityType") LIKE '%clinic%' OR LOWER("facilityType") LIKE '%amb%' THEN 'OUTPATIENT'
  WHEN LOWER("facilityType") LIKE '%dental%' OR LOWER("facilityType") LIKE '%dent%' THEN 'DENTAL'
  ELSE 'OTHER'
END;

-- Swap the column type to the enum.
ALTER TABLE "Facility"
  ALTER COLUMN "facilityType" TYPE "FacilityType" USING "facilityType"::"FacilityType";
