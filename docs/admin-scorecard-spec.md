# Admin Scorecard & Metrics — Code-Accurate Build Spec

> Rewrite of the Cowork "Full Metrics and Scorecard Specification," reconciled against the **actual `snap-marketplace` codebase** (2026-06-10). The goal is the same — a weekly 7-number scorecard that mostly self-populates — but this version **reuses what's already built, marks each metric AUTO / MANUAL / BLOCKED, and does not ask for things the code can't do yet.**

## Guiding principles
1. **Extend, don't duplicate.** A rich admin analytics endpoint and a full facility-ROI system already exist (below). Build on them.
2. **Be honest about data availability.** Tag every metric **AUTO** (computable from existing data), **MANUAL** (no source yet — admin enters it), or **BLOCKED** (needs a system that doesn't exist — billing, NPS survey). Never present a MANUAL/estimated number as if it were live.
3. **Pipeline lives in HubSpot**, not a rebuilt in-app CRM (decision locked 2026-06-10 — see the marketing-funnel plan). Pull or enter pipeline numbers; don't rebuild deal stages in Prisma.
4. Weekly report goes to **matt@snapmedical.app** via the existing SendGrid sender (domain is DKIM/DMARC-authenticated).

## What ALREADY EXISTS (reuse — do not rebuild)
- **`GET /api/admin/analytics`** (`backend/src/routes/admin.js:380`, consumed by `adminAPI.getAnalytics()` → `web/src/pages/admin/AdminOverviewPage.jsx`). Already computes: provider count, facility count, shift count, completed/all `shiftBooking`s (w/ rate, hours, facility, createdAt), `facilitySubscription` counts by tier, disputed shifts, shifts grouped by status (LIVE/FILLED/COMPLETED), top facilities/providers, flagged messages, active-provider count. **→ Extend this endpoint for the scorecard; extend `AdminOverviewPage` for the dashboard.**
- **Facility ROI system** = the Cowork spec's Module 5 + "facility baseline onboarding screen," already built:
  - `FacilityRoiBaseline` (schema:340) — `providerCount`, `monthlyProviderCost`, `providerHourlyRate`, `backupShiftsPerDay`(=5), `annualBackupStaffing`, `adminSchedulingStaff/Hours/Rate`, `credentialingStaff/Hours/Rate`, `credentialingTurnaround`, `schedulingGapRate`, `providerSatisfaction`.
  - `FacilityRoiSnapshot` (schema:376) — actuals per period.
  - `backend/src/services/roiCalc.js` — pure-function cost math; targets baked in (`backupReduction: 0.20`, `satisfactionTarget: 8.5`). Admin routes to read/write baselines: `admin.js:~1036/1066`.
  - `web/src/pages/admin/AdminRoiPage.jsx` — the per-facility ROI UI.
  - **→ The scorecard SURFACES these (backup-reduction %, hours/cost saved, satisfaction). Do NOT build a second baseline screen.**
- **`jobs/credentialAlerts.js`** (`runCredentialAlerts`, cron `0 6 * * *` in `index.js`) — already alerts on expiring credentials. **→ Extend for alert condition #1; don't rebuild.**
- **`Lead` model + `LeadFollowUpStatus` enum** + `AdminLeadsPage` — lightweight lead capture (source=calculator, savingsEstimate, followUpStatus). NOT a deal pipeline.
- **node-cron** is already wired in `index.js` (surge, vip, incentive, credentialAlerts jobs) — add the weekly-scorecard cron here.
- **SendGrid** `sendEmail()` in `services/notifications.js` — use for the weekly report.

## The 7 scorecard numbers — source & status
| # | Number | Source | Status |
|---|--------|--------|--------|
| 1 | Active credentialed providers | credentialing models (verified + current) | **AUTO** |
| 2 | Completed shifts (cumulative + this week) | `shiftBooking`/`shift` status COMPLETED (already in `/analytics`) | **AUTO** |
| 3 | Active pipeline conversations | **HubSpot** (or manual) | **MANUAL/HubSpot** |
| 4 | Avg days to close | **HubSpot** (or manual) | **MANUAL/HubSpot** |
| 5 | MRR | **No billing system exists.** Synthetic estimate (tier × count) OR manual entry, **clearly labeled "estimate"** until Stripe | **BLOCKED→manual** |
| 6 | Backup-staffing reduction % | `roiCalc.js` vs `FacilityRoiBaseline.backupShiftsPerDay` | **AUTO (exists)** |
| 7 | Facility NPS | **No survey mechanism.** Manual monthly entry per facility | **MANUAL** |

## Module-by-module build
### Module 1 — Provider & credentialing (AUTO)
Add to the analytics/scorecard endpoint, derived from the credentialing models:
`provider_total_count`, `provider_active_credentialed_count` (#1), `provider_pending_count`, `provider_incomplete_count`, `credential_turnaround_avg_days` (verified_at − submitted_at, rolling 30d — *requires those timestamps; confirm they exist, else mark MANUAL*), `credential_expiring_30_days` (already powering `runCredentialAlerts`), `provider_new_this_week`.

### Module 2 — Marketplace & shifts (AUTO, mostly already there)
Extend `/admin/analytics`: `shifts_completed_cumulative` (#2, exists), `shifts_completed_this_week`, `shifts_posted_this_week`, `shifts_filled_rate`, `shifts_unfilled_count` (status LIVE), `shift_avg_fill_time_hours` (`shiftBooking.confirmedAt − shift.createdAt`). `backup_staffing_reduction_pct` comes from `roiCalc.js` (not a new calc). **`shift_revenue_gross`/`platform_fee_revenue` = estimates only (no billing) — label as such.**

### Module 3 — Sales pipeline (HubSpot / MANUAL — do NOT rebuild in Prisma)
Pipeline conversations, days-to-close, close rate, pipeline ARR → **HubSpot**. Phase 1: a manual-entry block on the scorecard (or read via HubSpot API once connected). The existing `Lead`/`AdminLeadsPage` stays as calculator lead-capture; it is not the deal pipeline.

### Module 4 — Revenue / MRR (BLOCKED → manual/estimate)
No billing integration. Provide: (a) a **synthetic MRR estimate** from `facilitySubscription` tiers × the live prices ($2.5k/$5k/$10k) — already partially in AdminOverview — explicitly labeled "estimate," and (b) a **manual MRR override field**. `mrr_transaction_fees`, `churn`, `mrr_net_growth` → manual until Stripe (see roadmap). Revisit when billing lands.

### Module 5 — Facility ROI / health (REUSE — already built)
Surface `roiCalc.js` outputs per facility on the scorecard + facility health cards: `backup_cost_saved_monthly`, `admin_hours_saved_weekly`, `credentialing_staff_hours_saved`, `backup_staffing_reduction_pct`, `provider_count_per_facility`. Baseline entry already exists via `AdminRoiPage` + the baseline admin routes — **do not build a new onboarding-baseline screen; link to the existing one.** Add only what's missing: a **monthly facility NPS input** (extend `FacilityRoiSnapshot` with an `npsScore` field, or a small `FacilityNpsEntry` model) since `providerSatisfaction` is a static baseline, not a live survey.

### Module 6 — Alerts (partially exists)
Extend `runCredentialAlerts`/add a small alerts service:
1. Credential expiring ≤30d — **extend existing `runCredentialAlerts`.**
2. Shift unfilled >24h — AUTO from shift age + status LIVE.
3. Facility NPS <7 — fires only once NPS manual entry exists (Module 5).
4. New provider completed onboarding — AUTO.
5. Pipeline deal idle 14d — HubSpot-dependent (Phase 3) or manual.
6. **Weekly scorecard auto-compiled + emailed to matt@snapmedical.app, Sundays 20:00** — new node-cron job in `index.js`, sends via SendGrid.
7. Monthly per-facility ROI report (1st of month) — reuse `roiCalc.js` + SendGrid.
8. Credential upload flagged expired/invalid — extend credential verification flow.
9. Account inactive 30+ days — AUTO from last-activity timestamps.

### Module 7 — Dashboard layout (extend `AdminOverviewPage`)
Rows: (1) 7 scorecard tiles, color-coded **green on-target / yellow within 10% / red >10% below**; (2) 30-day sparklines (need history — see ScorecardSnapshot below); (3) alerts/action items; (4) facility health cards (from roiCalc); (5) pipeline board = **HubSpot embed or manual summary** (not a rebuilt kanban); (6) recent activity feed (last 20 platform events).

## New schema (minimal — most metrics compute on the fly)
- **`ScorecardSnapshot`** — stores the 7 numbers (+ secondaries) weekly, written by the Sunday cron. Powers sparklines/trends and the weekly report history without recomputing. `{ id, weekOf, activeProviders, shiftsCompletedWeek, pipelineActive(manual), daysToClose(manual), mrrEstimate, mrrManual, backupReductionPct, npsAvg(manual), createdAt }`.
- **NPS capture** — add `npsScore Int?` to `FacilityRoiSnapshot` (monthly manual) **or** a small `FacilityNpsEntry { facilityId, month, score, createdAt }`.
- **Manual scorecard inputs** — a tiny `ScorecardManualEntry` (or fields on ScorecardSnapshot) for MRR/pipeline/days-to-close until billing + HubSpot are wired.
- No pipeline/deal tables (HubSpot owns that). No new baseline table (exists).

## Endpoints / jobs to add
- `GET /api/admin/scorecard?from=&to=` (adminAuth) — returns the 7 numbers + secondaries + statuses, composing existing `/analytics` queries + `roiCalc` + manual inputs + latest `ScorecardSnapshot`s for trends. (Or fold into `/analytics`.)
- `POST /api/admin/scorecard/manual` (adminAuth) — set manual MRR / pipeline / NPS values.
- Cron in `index.js`: `0 20 * * 0` → write `ScorecardSnapshot` + email weekly report to matt@snapmedical.app.
- Extend `runCredentialAlerts` + add the other AUTO alert conditions.

## Phasing
- **Phase 1 (post-pilot, feasible now):** scorecard tiles + sparklines + alerts + weekly report on `AdminOverviewPage`; AUTO metrics (credentialing + shifts) + surfaced ROI (Module 5) + **labeled manual inputs** for MRR/NPS/pipeline.
- **Phase 2 (after Stripe billing):** real MRR/ARR/churn/transaction fees replace the estimates/manual entries.
- **Phase 3:** NPS survey mechanism (replaces manual NPS) + HubSpot pipeline API sync (replaces manual pipeline).

## Do NOT
- Rebuild the facility baseline/onboarding screen — it exists (`AdminRoiPage` + `FacilityRoiBaseline`).
- Rebuild a sales pipeline in Prisma — that's HubSpot.
- Present MRR as automatic/live — it's an estimate/manual until billing exists.
- Send the report from/to `snapmedicaltechnologies.com` — it's **matt@snapmedical.app** (the DKIM-authenticated domain).

## Timing
Internal ops tooling — **not pilot-blocking**, and more useful once pilot data flows. Build after the 6/15 launch settles.
