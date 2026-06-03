# Week 2 — Marketplace passport UI completion (plan)

**Status:** Locked 2026-06-03 after Week 1 finished in one day (Tue 6/3). All cred-side passport API work is shipped + end-to-end verified via curl. Week 2 is the marketplace UI side that consumes it.

**Window:** Wed 2026-06-10 → Tue 2026-06-16 (7 days).

**Companion memories:** [[passport-first-architecture]] (the locked architectural commitment Week 2 proves out), [[pdf-builder-direction]] (Path C — Anvil AI + template promotion; v1 builds the upload + signer flow in Day 2 below), [[project_snap_apps]] (current shipping state).

---

## Why this exists

Week 1 built the passport API foundation on `snap-credentialing/backend` (provider read, service read + grant-status, grant CRUD, grant-request + push, mobile approve/deny) and the marketplace consumer wrapper at `snap-marketplace/backend/src/services/passportClient.js`. Nothing in the marketplace **UI** consumes any of it yet.

Week 2 is where the consumer pattern stops being theoretical. Three concrete UIs ship:

1. **#17 — Web coordinator signature UI** — facility coordinator sends a signature request from the marketplace facility portal, consuming the existing `/api/service/signatures` bridge endpoint. Uses passport `getGrantStatus` + `requestGrant` to gate access.
2. **#18 — Mobile passport-blockers alert + tap-to-sign** — marketplace mobile shows an aggregated alert pulling `completeness.missingRequired` + `completeness.expiringSoon` + pending signatures from `passportClient.getPassport`. Tap → opens Anvil signing WebView.
3. **#19 — E2E rollout** — sandbox cycle through everything; production cutover; first coordinator + provider try the full loop end-to-end.

Plus **Path C template library v1** (per [[pdf-builder-direction]]) — "Save as template" UX inside the web coordinator UI.

---

## Day-by-day

| Day | Focus | Concrete output |
|---|---|---|
| **Wed 6/10** | Marketplace web facility-portal layout for credentialing. New page in `web/src/pages/credentialing/CredentialApp.jsx` (or a new component file) showing a provider's grant status + "Request access" CTA wired to `passportClient.getGrantStatus` / `requestGrant`. Hand-rolled routing per existing CredentialApp pattern (no React Router). | Coordinator sees provider grant state + can fire access requests from web UI |
| **Thu 6/11** | Signature-create modal: PDF upload → fill signer name/email/due date → call `/api/service/signatures`. Before send, hit Anvil's AI box-finder to detect signature fields (AI Pack tier — verify the endpoint shape; fall back to last-page bottom-right default which is the cred-backend default after Tue's fix). | #17 v1 ships — coordinators can send signature requests from marketplace web |
| **Fri 6/12** | Marketplace mobile passport-blockers alert. New home-screen card pulls `completeness.missingRequired` + `completeness.expiringSoon` + pending signatures into one aggregated alert. Tap → routes to `passportClient.getPassport(npi, facilityId)` consumer view, with per-credential tap → Anvil signing WebView (reuse `SignatureSigningScreen` pattern from cred mobile). | #18 logic complete |
| **Sat 6/13** | Marketplace mobile EAS build + TestFlight submit. While waiting (~25 min): start **Path C template library** — after a sent request, prompt "Save this as a template?" → opens Anvil dashboard URL in a WebView for coordinator to place fields → templates appear in a library list view in subsequent send flows. | Marketplace mobile build live in TestFlight; template promotion v1 |
| **Sun 6/14** | E2E sandbox cycle: coordinator (web) → grant request → cred mobile approval → coordinator opens passport view → coordinator sends signature → provider signs on cred mobile → coordinator sees status update. Document each step + screenshots for the pilot onboarding doc. | #19 cred-side loop verified manually |
| **Mon 6/15** | Production rollout: final auth/rate-limit tightening, sealed-PDF deferral confirmation, flip the marketplace credentialing portal feature flag if one exists OR announce internally to APNE/CAPA coordinators. | Pilot-ready for first real coordinator usage |
| **Tue 6/16** | Buffer + Week 3 prep. Scope sealed PDF + public `/verify/:token` (~3 days) and NPPES pre-fill (~2-3 weeks). Decide priority order for Week 3. | Week 3 plan locked |

---

## What's in scope (Week 2)

- Web coordinator UI for: grant-status check, request access, send signature request, "save as template", template library list
- Mobile passport-blockers alert on marketplace mobile home screen
- Mobile tap-to-sign WebView (reuses Anvil embedded URL pattern from `SignatureSigningScreen`)
- E2E manual verification + screenshots
- Production cutover

## What's deferred (Week 3+)

- **Sealed PDF passport snapshot + public `/verify/:token`** — ~3 days. Facility "download my copy" feature per [[credentialing-vision]]. High strategic value for facility trust; not gating Week 2 UI.
- **NPPES public-source pre-fill** — own dedicated 2-3 week chunk. Gates Motion B (B2C marketplace-driven onboarding) per [[credentialing-vision]].
- **Anvil webhook token rotation** (Task #1) — defer until first sensitive data lands on prod.
- **Cost savings widget on credentialing portal dashboard** (Task #13) — captured for after pilot stabilizes.
- **PTO feature** — after pilot stabilizes.
- **Phase1/Phase2 cleanup of dead-code screens** (per carry-over).
- **Schedule Builder Phase 2** (post-publish edits + provider mobile accept/decline) — after credentialing track stabilizes.

---

## Open questions to resolve Wed 6/10 morning

1. **Anvil AI box-finder API shape.** The AI Pack tier ($99/mo) is already paid; need to verify (a) the endpoint exists, (b) how to call it from `services/anvil.js`, (c) what response shape it returns. If the API is harder than expected, fall back to default last-page placement for Week 2 and revisit the AI call in Week 3.

2. **Where does the new marketplace web coordinator UI mount?** Three plausible homes:
   - As a new section inside the existing facility-side `CredentialApp.jsx`
   - As a top-level page under `pages/credentialing/`
   - As a sidebar item once the coordinator is in facility-portal mode
   Pick on day 1 before writing UI code.

3. **Marketplace facility-id → cred granteeRef mapping.** The cred-side `grantCheck` middleware expects `?granteeRef=<facility-id>`. The marketplace web has `facilityId` available via the facility-auth context. Confirm the string format matches what cred expects (it should — we're just passing through opaquely on the cred side).

4. **First production users.** Which APNE or CAPA coordinator wants to try the full loop first? Pick a friendly tester before Mon 6/15 cutover.

---

## Test users left from Week 1 in cred prod DB

These survive the week and can be reused for ad-hoc testing:

- `mobile-test-1238@snap.test` (NPI 1000000855, has 1 PENDING grant request from "Boston General Hospital" — keep for Week 2 mobile flow tests)
- `passport-task7-1780504218@snap.test` (NPI 1234567218, 1 approved + 1 revoked grant + 1 denied request)
- Three other `@snap.test` users from various Task #N smoke tests (clean up via Prisma Studio when convenient)

---

## Companion artifacts in the repos

- `snap-credentialing/docs/passport-api-design.md` — the API contract Week 1 implemented
- `snap-credentialing/docs/esign-design.md` — Anvil integration design (mostly shipped)
- `snap-marketplace/backend/src/services/passportClient.js` — Week 2's primary consumer; reference for all client calls
- `snap-credentialing/backend/src/routes/passport.js` — server-side reference; do NOT extend with marketplace-specific logic, per [[passport-first-architecture]]
