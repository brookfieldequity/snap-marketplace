-- Add totalBonus and totalReimbursement to PayrollRun so historical runs
-- accurately reflect all components of a payroll export, not just base hours×rate.
ALTER TABLE "PayrollRun" ADD COLUMN "totalBonus" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PayrollRun" ADD COLUMN "totalReimbursement" DOUBLE PRECISION NOT NULL DEFAULT 0;
