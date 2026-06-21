-- APNE payroll-sheet ingest: period-level extras on ProviderHourEntry.
-- See capa-pilot/eor-model-spec.md / APNE bridge. Additive, nullable — applied in
-- prod via `db push`; committed here to keep migrations/ in sync.
ALTER TABLE "ProviderHourEntry"
  ADD COLUMN "reimbursementAmount" DOUBLE PRECISION,
  ADD COLUMN "bonusAmount"         DOUBLE PRECISION,
  ADD COLUMN "bonusDetail"         TEXT;
