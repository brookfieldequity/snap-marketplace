-- Provider schedule access (v1): facility can revoke a linked provider's view of
-- its daily board. Default false = access granted when linked. Additive/nullable-
-- safe; applied in prod via db push. See eor-model-spec.md.
ALTER TABLE "InternalRosterEntry"
  ADD COLUMN "scheduleAccessRevoked" BOOLEAN NOT NULL DEFAULT false;
