-- EOR Phase 0 — DATA BACKFILL (run manually, ONCE, after the schema is applied).
--
-- The marketplace backend boots via `prisma db push`, which applies the new
-- TABLES/COLUMNS but never runs data migrations. This script populates the new
-- Employer rows and backfills InternalRosterEntry.employerId from the legacy
-- free-form `employer` string.
--
-- It is IDEMPOTENT (guarded by NOT EXISTS / employerId IS NULL) — safe to re-run.
-- It runs in a transaction: review the verification counts at the bottom BEFORE
-- you COMMIT. If anything looks wrong, `ROLLBACK;` instead.
--
-- gen_random_uuid() is built in on Postgres 13+ (Neon). The generated ids are
-- plain unique TEXT — they don't need to be cuids; @default(cuid()) only applies
-- to rows the app creates later.

BEGIN;

-- ── 0. EDIT ME ────────────────────────────────────────────────────────────────
-- employer-string values that mean "the facility's OWN W-2 staff" (not an
-- external agency). The CAPA pilot uses the literal "CAPA". Matching is
-- case-insensitive. The facility's own name is ALWAYS treated as self too.
CREATE TEMP TABLE _self_alias(name TEXT) ON COMMIT DROP;
INSERT INTO _self_alias(name) VALUES ('CAPA');

-- ── 1. One FACILITY_SELF Employer per facility ─────────────────────────────────
INSERT INTO "Employer" ("id","name","kind","ownerFacilityId","createdAt","updatedAt")
SELECT gen_random_uuid()::text, f."name", 'FACILITY_SELF', f."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Facility" f
WHERE NOT EXISTS (SELECT 1 FROM "Employer" e WHERE e."ownerFacilityId" = f."id");

-- ── 2. One STAFFING_AGENCY Employer per distinct non-self employer string ──────
INSERT INTO "Employer" ("id","name","kind","createdAt","updatedAt")
SELECT gen_random_uuid()::text, x.emp, 'STAFFING_AGENCY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT TRIM(r."employer") AS emp
  FROM "InternalRosterEntry" r
  JOIN "Facility" f ON f."id" = r."facilityId"
  WHERE r."employer" IS NOT NULL AND TRIM(r."employer") <> ''
    AND LOWER(TRIM(r."employer")) <> LOWER(TRIM(f."name"))
    AND LOWER(TRIM(r."employer")) NOT IN (SELECT LOWER(name) FROM _self_alias)
) x
WHERE NOT EXISTS (
  SELECT 1 FROM "Employer" e
  WHERE e."kind" = 'STAFFING_AGENCY' AND LOWER(e."name") = LOWER(x.emp)
);

-- ── 3. Link each agency to every facility whose roster references it ────────────
INSERT INTO "EmployerFacilityLink" ("id","employerId","facilityId","status","createdAt")
SELECT gen_random_uuid()::text, e."id", t."facilityId", 'ACTIVE', CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT r."facilityId" AS "facilityId", LOWER(TRIM(r."employer")) AS empl
  FROM "InternalRosterEntry" r
  JOIN "Facility" f ON f."id" = r."facilityId"
  WHERE r."employer" IS NOT NULL AND TRIM(r."employer") <> ''
    AND LOWER(TRIM(r."employer")) <> LOWER(TRIM(f."name"))
    AND LOWER(TRIM(r."employer")) NOT IN (SELECT LOWER(name) FROM _self_alias)
) t
JOIN "Employer" e ON e."kind" = 'STAFFING_AGENCY' AND LOWER(e."name") = t.empl
WHERE NOT EXISTS (
  SELECT 1 FROM "EmployerFacilityLink" l
  WHERE l."employerId" = e."id" AND l."facilityId" = t."facilityId"
);

-- ── 4a. Backfill roster rows that are the facility's OWN staff → FACILITY_SELF ──
UPDATE "InternalRosterEntry" r
SET "employerId" = e."id"
FROM "Facility" f
JOIN "Employer" e ON e."ownerFacilityId" = f."id"
WHERE r."facilityId" = f."id"
  AND r."employerId" IS NULL
  AND (
       r."employer" IS NULL
    OR TRIM(r."employer") = ''
    OR LOWER(TRIM(r."employer")) = LOWER(TRIM(f."name"))
    OR LOWER(TRIM(r."employer")) IN (SELECT LOWER(name) FROM _self_alias)
  );

-- ── 4b. Backfill agency roster rows → the matching STAFFING_AGENCY ─────────────
UPDATE "InternalRosterEntry" r
SET "employerId" = e."id"
FROM "Employer" e
WHERE r."employerId" IS NULL
  AND e."kind" = 'STAFFING_AGENCY'
  AND LOWER(e."name") = LOWER(TRIM(r."employer"));

-- ── 5. VERIFY before committing ────────────────────────────────────────────────
-- Expect: every roster row resolved (unresolved = 0). Eyeball the per-employer
-- breakdown — CAPA self vs APNE/JJM counts should match expectations.
SELECT
  (SELECT count(*) FROM "InternalRosterEntry" WHERE "employerId" IS NULL) AS unresolved_roster_rows,
  (SELECT count(*) FROM "Employer" WHERE "kind" = 'FACILITY_SELF')        AS self_employers,
  (SELECT count(*) FROM "Employer" WHERE "kind" = 'STAFFING_AGENCY')      AS agency_employers,
  (SELECT count(*) FROM "EmployerFacilityLink")                           AS facility_links;

SELECT e."name", e."kind", count(r."id") AS providers
FROM "Employer" e
LEFT JOIN "InternalRosterEntry" r ON r."employerId" = e."id"
GROUP BY e."name", e."kind"
ORDER BY e."kind", providers DESC;

-- If the numbers look right:
COMMIT;
-- otherwise: ROLLBACK;
