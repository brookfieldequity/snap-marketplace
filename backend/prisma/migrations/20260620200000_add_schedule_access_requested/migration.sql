-- Provider schedule access v1.1: a provider whose access was revoked can request
-- it back; the facility sees the request and grants. Additive/defaulted; applied
-- in prod via db push. See eor-model-spec.md.
ALTER TABLE "InternalRosterEntry"
  ADD COLUMN "scheduleAccessRequested" BOOLEAN NOT NULL DEFAULT false;
