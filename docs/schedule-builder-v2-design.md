# Schedule Builder v2 — design

**Status:** Design approved 2026-06-02 (after extensive user conversation). Implementation queued; this is the natural sequel to Coverage Templates v1.

**Module:** SNAP Shifts → Schedule Builder (existing page, significantly extended).

---

## Why this exists

Coverage Templates v1 (shipped earlier today) lets practices declare their standard staffing pattern and pre-fills `ScheduleDay` rows for a month with the right *room counts* per location per day. But the rooms are still **empty** — no providers assigned. Coordinators then go room-by-room, manually picking who fills each one.

For a practice covering 5–10 locations × ~25 working days × multiple rooms per day, that's hundreds of manual assignments per month. Hand-assignment is slow, locks in the coordinator's biases, and doesn't optimize for cost vs quality trade-offs the practice cares about.

**Schedule Builder v2 introduces an intelligent build step** between "rooms pre-filled" (templates) and "schedule published":

1. Coordinator opens an unfilled month (rooms exist, no assignments)
2. Clicks new **"Build the Schedule"** button
3. Picks an algorithm mode (or runs all four)
4. System fills all rooms with providers, produces a StaffIQ score per candidate
5. Coordinator compares, picks one, edits a few cells, re-scores
6. Hits existing **"Publish Schedule"** → providers notified, schedule appears in their calendars

The strategic bet (user's own framing): **"If the facilities can't believe that StaffIQ is smarter than them, we are in trouble as a company."** So this isn't just a convenience feature — it's the credibility test for SNAP's proprietary algorithm.

---

## What changes vs what stays the same

| | Today | After v2 |
|---|---|---|
| Coverage Template generates rooms | ✅ Works (v1) | Same |
| Click-a-day editor (add/remove location, change room count, manual assign) | ✅ Works | **Unchanged.** Still works for surgical edits. |
| Filling all the rooms | Manual cell-by-cell | New "Build the Schedule" button does it in one click |
| Comparing staffing strategies | Not possible | 4 algorithm modes side-by-side with scores |
| Provider notification on publish | Limited | Push + SMS (when Twilio enabled), with iCal calendar subscription |
| Master view of the org's day | Not present | New daily view: where everyone is, scoped to the org |
| Post-publish edits | Possible, no provider feedback loop | Provider must tap "Accept" before change takes effect |

Existing click-a-day UX stays sacred (same principle as Coverage Templates). The Build button is an *addition*, not a replacement.

---

## Scope of v1 (locked 2026-06-02)

| Decision | Value | Notes |
|---|---|---|
| Number of algorithm modes | **4**: Cost-efficient, Highest quality, Hybrid, Let StaffIQ decide | Coordinator can run one or all four |
| Mode definitions | Cost = lowest labor rate; Quality = senior providers + fewer locums; Hybrid = weighted balance; StaffIQ-decide = algorithm picks based on practice's historical priorities | See "Algorithm details" below |
| Compare-all UI | 4 candidates shown side-by-side with scores + 1-line insight each | Coordinator picks one to make active |
| Post-build editing | Coordinator can edit any cell using existing click-a-day UI | Re-score button recomputes the StaffIQ score for the edited version |
| Publish behavior | Same button as today; broadcasts notifications | Push + SMS (SMS feature-flagged; enabled when Twilio is configured) |
| Calendar sync | **iCal feed URL** | Provider subscribes once in Apple/Google Calendar; auto-updates when schedule changes |
| Master daily view | Yes, both provider app and facility portal | Scoped to provider's own org (e.g., CAPA coordinators see only CAPA providers' assignments) |
| Post-publish edits | Edits take effect ONLY after provider taps "Accept" | If provider declines, coordinator handles manually |
| StaffIQ learning | Every Build Run, every coordinator edit, every accept/decline stored | Feeds back into the StaffIQ algorithm over time |
| Cross-customer learning | SNAP Admin site aggregates anonymized data across all facilities | Algorithm gets smarter as the SaaS scales |

### Deferred to v2.1 or later

- Multi-coordinator concurrent editing (locks, conflict resolution)
- "What-if" sandbox mode (try edits without saving)
- Coordinator-tunable hybrid slider (v1 is fixed 50/50)
- Provider preference inputs that affect algorithm decisions
- Auto-fill remaining rooms after partial manual fill
- Schedule diff view (show what changed since last run)

---

## Architecture

### New Prisma models

```prisma
// Each invocation of "Build the Schedule" — stores enough to reconstruct,
// score, and learn from later. Multiple runs (one per mode) can share a
// buildBatchId so the compare-all UI groups them.
enum BuildMode {
  COST_EFFICIENT
  HIGHEST_QUALITY
  HYBRID
  STAFFIQ
}

enum BuildRunStatus {
  RUNNING
  COMPLETE
  FAILED
  SUPERSEDED   // newer run for the same month replaced this one
}

model ScheduleBuildRun {
  id                String         @id @default(cuid())
  facilityId        String
  facility          Facility       @relation(fields: [facilityId], references: [id])
  year              Int
  month             Int            // 1-12
  buildBatchId      String         // groups multi-mode runs the coordinator triggered together
  mode              BuildMode
  status            BuildRunStatus
  // Snapshot of input state so we can reproduce / explain the run later.
  inputSnapshot     Json           // ScheduleDay rows + roster + availability used as input
  // The output assignments. Stored as JSON for forward compatibility; once
  // the coordinator picks a run, we materialize these into ScheduleAssignment rows.
  assignments       Json
  staffiqScore      Int?           // 0-100; null while RUNNING / FAILED
  insights          Json?          // { totalCost, locumsUsed, avgSeniority, etc. }
  warnings          String[]       // human-readable: e.g. "Could not staff Kenmore Mon 8/4 — no available CRNA"
  selectedAt        DateTime?      // when the coordinator picked this run as the active one
  startedAt         DateTime       @default(now())
  completedAt       DateTime?
  triggeredByUserId String
  triggeredByUser   User           @relation(fields: [triggeredByUserId], references: [id])

  edits             ScheduleEdit[]

  @@index([facilityId, year, month, buildBatchId])
  @@index([facilityId, selectedAt])
}

// Audit log: every coordinator edit after a Build Run is selected, so we
// can learn from what coordinators override. ALSO covers post-publish
// edits (those have requiresAcceptance=true).
model ScheduleEdit {
  id                String       @id @default(cuid())
  buildRunId        String
  buildRun          ScheduleBuildRun @relation(fields: [buildRunId], references: [id])
  scheduleDayId     String
  scheduleDay       ScheduleDay  @relation(fields: [scheduleDayId], references: [id])
  roomNumber        Int
  beforeRosterId    String?      // null if room was unfilled
  afterRosterId     String?      // null if room was emptied
  editedByUserId    String
  editedByUser      User         @relation(fields: [editedByUserId], references: [id])
  reason            String?      // optional free-text from coordinator
  requiresAcceptance Boolean     @default(false)   // true for post-publish edits
  acceptanceStatus  EditAcceptance? // null for pre-publish edits
  acceptedAt        DateTime?
  declinedAt        DateTime?
  declineReason     String?
  createdAt         DateTime     @default(now())

  @@index([buildRunId])
  @@index([scheduleDayId, roomNumber])
  @@index([requiresAcceptance, acceptanceStatus])
}

enum EditAcceptance {
  PENDING
  ACCEPTED
  DECLINED
}

// Provider-facing notification log (push + SMS dispatch records).
// Existing notification infra in services/notifications.js gets extended;
// this table tracks the per-provider sends + delivery state.
enum NotificationChannel {
  PUSH
  SMS
  EMAIL
}

enum NotificationStatus {
  QUEUED
  SENT
  DELIVERED
  FAILED
}

model ScheduleNotification {
  id              String              @id @default(cuid())
  providerProfileId String
  providerProfile ProviderProfile     @relation(fields: [providerProfileId], references: [id])
  facilityId      String
  facility        Facility            @relation(fields: [facilityId], references: [id])
  // What this notification is about — published schedule, post-publish
  // change requiring acceptance, etc.
  kind            String              // 'SCHEDULE_PUBLISHED' | 'CHANGE_REQUIRES_ACCEPTANCE' | 'CHANGE_ACCEPTED' | 'CHANGE_DECLINED'
  scheduleEditId  String?             // set when kind = CHANGE_REQUIRES_ACCEPTANCE et al
  channel         NotificationChannel
  status          NotificationStatus  @default(QUEUED)
  payload         Json                // template variables for the notification body
  externalId      String?             // Twilio SID, Expo receipt ID, etc.
  sentAt          DateTime?
  deliveredAt     DateTime?
  failureReason   String?
  createdAt       DateTime            @default(now())

  @@index([providerProfileId, kind])
  @@index([facilityId, createdAt])
}
```

Add reverse relations on `Facility`, `ProviderProfile`, `ScheduleDay`, `User` as needed.

### iCal feed

```
GET /api/providers/me/schedule.ics
GET /api/providers/:id/schedule.ics?token=<opaque>   // for unauthenticated calendar app polling
```

Returns an iCalendar (RFC 5545) feed of all the provider's published assignments across all facilities they work at. Calendar apps poll this URL periodically; new published schedules → new events appear.

Token-based variant uses an opaque per-provider token (stored on `ProviderProfile.calendarFeedToken`) so calendar apps don't have to authenticate with JWT.

### Existing models extended

- `ScheduleAssignment` gains `lastBuildRunId String?` so we can trace back "this assignment came from build run X" for future-edit context.
- `ProviderProfile` gains `calendarFeedToken String? @unique` for the iCal feed.
- `ProviderProfile.expoPushToken` already exists; SMS uses the existing `User`-facing phone fields once we add them (currently no phone storage — need to add `phoneNumber` to ProviderProfile).

---

## Algorithm details

All four modes share the same skeleton:

```
input:  ScheduleDay rows for (facility, year, month)
        Roster (InternalRosterEntry: providers + rates + employment category)
        Availability (which providers are available which days)
        StaffIQInputs (practice's existing inputs/preferences)
        BuildHistory (past selected builds + coordinator edits — for the smarter-over-time loop)

for each ScheduleDay × roomNumber:
    candidates = available providers for that date with required specialty
    if no candidates: warn and leave empty
    else: pick one based on the mode's scoring function

output: assignments[], score, insights, warnings
```

### Cost-efficient mode

**Scoring fn per candidate:** `1 / hourlyRate` (lower rate = higher score).

**Tiebreaker:** prefer FULL_TIME > PER_DIEM > LOCUMS (long-term cost via retention).

**Insights surfaced:** total monthly labor cost, $X saved vs the highest-cost candidate per slot.

### Highest-quality mode

**Scoring fn per candidate:** weighted combination of:
- Seniority (yearsExperience)
- Provider rating (from `ProviderRating` averaged)
- Penalty for locum status
- Bonus for "preferred provider" on `PreferredProvider`

**Tiebreaker:** higher rating wins.

**Insights surfaced:** avg seniority, number of locums avoided vs cost mode, % preferred providers.

### Hybrid mode

**Scoring fn:** `0.5 * costScore + 0.5 * qualityScore` (normalized to 0-1).

**v1 weighting is fixed at 50/50.** v2.x adds a coordinator-tunable slider.

**Insights surfaced:** "Cost: $X (Y% above cheapest); Quality: avg seniority Z years".

### "Let StaffIQ decide" mode

For v1: same as Hybrid, but the weighting comes from the practice's StaffIQ Inputs (their stated priorities) rather than a fixed 50/50. If the practice indicated cost is their top priority, this mode tilts toward cost.

**Future:** trained ML model that learns from past `ScheduleBuildRun.selectedAt` choices + `ScheduleEdit` overrides. The more schedules the practice builds, the better this mode gets at matching THEIR preferences. Eventually trained cross-customer (anonymized) so a new SNAP customer benefits from the network effect.

For v1 we ship the simple version + we LOG everything needed to train the better version later. The story "StaffIQ gets smarter every time you build" is enabled by the logging from day one even if the smarter model isn't live yet.

### Constraints common to all modes

- **No double-booking:** a provider can only fill one room per (date, hours).
- **Availability:** only assign providers whose `AvailabilityWindow` covers the date.
- **Specialty match:** match `Specialty` (CRNA, ANESTHESIOLOGIST, ANESTHESIA_ASSISTANT) to whatever the practice has declared for that location/day. (NOTE: Coverage Templates v1.1 adds per-site role rules — this consumes those rules.)
- **Hard caps:** any per-provider max-hours-per-week / max-shifts-per-month from policy data.

### Warnings, not failures

When the algorithm can't fill a room (no available candidate), it leaves the room empty and adds a `warning` to the output. The coordinator sees "3 rooms could not be staffed" in the comparison view and decides how to handle. The build run still completes with a score; it's not a hard failure.

---

## API endpoints

### Build + comparison

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/schedule/build` | Trigger one or more build runs. Body: `{ year, month, modes: ['COST_EFFICIENT','HIGHEST_QUALITY','HYBRID','STAFFIQ'] }`. Returns `buildBatchId`. Runs each mode in parallel server-side. |
| `GET` | `/api/schedule/build/:batchId` | Poll for build status + results (frontend can long-poll or just refresh). Returns array of runs with score, insights, warnings. |
| `POST` | `/api/schedule/build/:runId/select` | Coordinator picks this run as the active schedule. Backend materializes the run's `assignments` JSON into real `ScheduleAssignment` rows, marking other runs in the batch as `SUPERSEDED`. |
| `POST` | `/api/schedule/build/:runId/rescore` | Recompute StaffIQ score after coordinator edits. Returns new score + delta from original. |

### Edits + post-publish acceptance

| Method | Path | Purpose |
|---|---|---|
| Existing | `PUT /api/schedule/days/:dayId/assignments/:roomNumber` | Already exists. v2 adds: records a `ScheduleEdit` row; if month is published, sets `requiresAcceptance=true` and triggers notification to affected provider. |
| `POST` | `/api/schedule/edits/:editId/accept` | Provider acknowledges a post-publish change. |
| `POST` | `/api/schedule/edits/:editId/decline` | Provider declines. Edit is rolled back; coordinator notified. |

### Daily view

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/schedule/day?facilityId=...&date=YYYY-MM-DD` | Returns all assignments across all locations for the org on that date. Powers the master daily view. |

### iCal feed

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/providers/me/schedule.ics` | Authenticated provider's schedule, all facilities. |
| `GET` | `/api/calendar/:token.ics` | Public unauthenticated iCal feed via opaque token. URL given to provider to subscribe in Apple/Google Calendar. |

### Notification settings

| Method | Path | Purpose |
|---|---|---|
| `PATCH` | `/api/providers/me/notifications` | Provider preferences for push / SMS / email per notification kind. |

---

## UX flow

### Facility portal — build flow

```
[Schedule Builder view, month is template-generated but no assignments yet]

┌────────────────────────────────────────────────────────────────────┐
│ August 2026                                  [Publish] [Build →]   │
│ 30 days · 5 locations · 78 rooms · 0 assigned                      │
└────────────────────────────────────────────────────────────────────┘

[Coordinator clicks Build]

┌────────────────────────────────────────────────────────────────────┐
│ Build Schedule for August 2026                                     │
│                                                                    │
│ Pick a mode (or run all four and compare):                         │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐                                │
│  │💰 Cost-      │  │⭐ Highest    │                                │
│  │   Efficient  │  │   Quality    │                                │
│  └──────────────┘  └──────────────┘                                │
│  ┌──────────────┐  ┌──────────────┐                                │
│  │⚖️ Hybrid     │  │🧠 Let StaffIQ│                                │
│  │              │  │   Decide     │                                │
│  └──────────────┘  └──────────────┘                                │
│                                                                    │
│  [ Run all 4 and compare ]   [ Cancel ]                            │
└────────────────────────────────────────────────────────────────────┘

[Run all 4 — typically 2-5 seconds; can long-poll]

┌────────────────────────────────────────────────────────────────────┐
│ Compare Builds                                                     │
│ ┌──────────┬──────────┬──────────┬──────────┐                      │
│ │Cost      │Quality   │Hybrid    │StaffIQ   │                      │
│ │          │          │          │          │                      │
│ │Score: 72 │Score: 81 │Score: 88 │Score: 86 │                      │
│ │          │          │          │          │                      │
│ │$X total  │$X+18% but│$X+9% +   │Tilted to │                      │
│ │3 locums  │0 locums  │1 locum   │your past │                      │
│ │1 unstaffed│0 unstaffd│0 unstaffd│priorities│                     │
│ │          │          │          │          │                      │
│ │[Use this]│[Use this]│[Use this]│[Use this]│                      │
│ └──────────┴──────────┴──────────┴──────────┘                      │
└────────────────────────────────────────────────────────────────────┘

[Coordinator picks Hybrid]
[Schedule Builder view now shows assignments — existing click-a-day UI takes over]
[Coordinator edits 3 cells]

┌────────────────────────────────────────────────────────────────────┐
│ You've made 3 edits since this build was generated.                │
│ Re-score with current edits?              [Re-score]               │
└────────────────────────────────────────────────────────────────────┘

[Coordinator re-scores; sees new score]
[Coordinator hits existing Publish button → notifications fire]
```

### Provider mobile — published notification + acceptance

When schedule published: provider gets a push (and SMS if Twilio is wired up) like

> Your August schedule is ready. 18 shifts. Open in app.

When a post-publish edit affects them:

> Hospital X changed one of your shifts (Aug 12: Kenmore → Weymouth). Tap to review.

Provider opens app → sees diff → either:

- **Accept** → edit takes effect; coordinator sees green check
- **Decline** → edit rolls back; coordinator gets push saying "X declined the change; reassign needed"

### Master daily view (both facility portal + provider mobile)

A single-page view of "where is everyone on August 12?" — shows each provider, where they're assigned, with hand-offs visible. Scoped to the org (CAPA coordinator sees only CAPA's roster; CAPA provider sees only CAPA's roster).

### Calendar subscription onboarding (provider mobile)

In Settings → Calendar Sync:

```
┌────────────────────────────────────────────┐
│ Calendar Sync                              │
│                                            │
│ Subscribe in your phone's calendar app to  │
│ see your SNAP shifts alongside the rest    │
│ of your schedule.                          │
│                                            │
│ [ Copy iCal URL ]                          │
│ [ Open in Apple Calendar ]                 │
│ [ Open in Google Calendar ]                │
│                                            │
│ Updates automatically when your schedule   │
│ changes.                                   │
└────────────────────────────────────────────┘
```

Tapping "Open in Apple Calendar" deep-links to `webcal://...schedule.ics` which Apple Calendar handles natively. Google Calendar gets a URL that opens the Add-Calendar-by-URL flow.

---

## Notifications

### Channels (v1)

- **Push** — always on; uses `expo-server-sdk` already wired up
- **SMS** — feature-flagged (`SMS_ENABLED=true` env). Code paths exist but no-op until Twilio creds are set (matches existing pattern in `services/notifications.js` per `PILOT_HARDENING.md`)
- **Email** — already wired via SendGrid for some flows; reused here

### Trigger events

| Event | Default channels |
|---|---|
| Schedule published | Push + Email (SMS optional) |
| Schedule changed — requires acceptance | Push + SMS (urgent) |
| Schedule change accepted | Coordinator gets Push |
| Schedule change declined | Coordinator gets Push + Email |
| Calendar feed URL ready | One-time onboarding email |

### Provider preferences

Provider can opt out per channel × per kind via `/api/providers/me/notifications`. Defaults are sensible (all on); they can quiet push for non-urgent kinds, etc.

---

## How StaffIQ gets smarter

User's principle (verbatim): *"if the facilities can't believe that StaffIQ is smarter than them, we are in trouble as a company."*

The credibility comes from a learning loop, not a one-shot algorithm. v1 ships the **logging infrastructure**; the model trains on logs over time.

### What gets logged

- Every `ScheduleBuildRun` (input state, output assignments, score, mode)
- Every `ScheduleEdit` (what the coordinator overrode after picking a build)
- Every accept/decline on post-publish edits
- The `selectedAt` field on a run tells us which mode the coordinator *trusted enough to pick*

### How the data flows

- Per-practice: every build run + edit + selection is local to that practice. Used by "Let StaffIQ decide" mode to learn THIS practice's priorities.
- Cross-practice (SNAP Admin dashboard): aggregated, anonymized data flows to a SNAP-internal dataset. Lets us train a global model that benefits new customers (network effects).
- Anonymization: provider IDs replaced with synthetic IDs; facility IDs replaced with bucketed practice-size + region tokens. No PHI, no names.

### What "smarter" means concretely

- **Round 1 of build:** uses static heuristics
- **Round N:** the "Let StaffIQ decide" mode reflects the practice's learned priorities. Insights become more accurate ("you typically prefer locum-free Mondays — this build maintains that")
- **Cross-practice:** when a new practice signs up, "Let StaffIQ decide" starts not from zero but from "practices similar to yours typically optimize for X"

For v1, the table-stakes is the LOGGING. The trained models are post-v1 — but the story holds because every build the coordinator runs makes the data better.

---

## Open product questions (TBD before/during build)

1. **Hourly rate data source.** Existing schema has `Shift.baseRate` and `Shift.currentRate` — those are per-shift. Do we have per-provider hourly rates anywhere? Need to add `InternalRosterEntry.hourlyRate` (or similar) for the cost algorithm to work.
2. **Quality data source.** `yearsExperience` and `ProviderRating` exist. Is that enough? Or do we need a "reliability" stat (no-show rate, late arrivals, etc.)?
3. **Availability data completeness.** Algorithm depends on `AvailabilityWindow` being filled in. What's the policy when a provider has no availability declared — assume available everywhere, assume unavailable, or surface a warning?
4. **Build run timeout.** If the algorithm takes longer than ~30 seconds (large month, many providers), what happens? Show a progress bar? Queue and email when done?
5. **iCal feed token rotation.** Per-provider opaque token in the URL — what's the rotation story? Generate-once, no rotation? Or rotation on demand if a provider believes their calendar URL was leaked?
6. **Master daily view scoping.** "Within their own organization" — does this mean only providers under the same `Facility`, or all providers a facility has booked, or providers in the same SNAP organization (multi-facility)? Probably the first; confirm.
7. **Post-publish change rollback.** Edit creates a `ScheduleEdit` row with `requiresAcceptance=true`. UI shows the edit as PROPOSED until accepted. What does the published schedule LOOK like in the meantime — does the coordinator see the old or new? Does the provider see the proposed or old? Need to decide.
8. **Provider phone number collection.** SMS requires phone. We don't collect this today. Add to provider onboarding? Backfill via a one-time prompt?
9. **Calendar event content.** The iCal event for a shift — title, location, description? Include compensation? Include hand-off info? Decide before shipping.
10. **Multi-org providers.** A locum CRNA could be on the roster of multiple practices. iCal feed shows ALL their assignments. Confirm that's desired (vs per-practice feeds).

---

## Implementation sequence — estimated 4-6 weeks total for v1

| Chunk | Days |
|---|---|
| Schema additions (ScheduleBuildRun, ScheduleEdit, ScheduleNotification, providers' calendarFeedToken + phoneNumber) + migration | 1 |
| Algorithm engine scaffold: shared input/output shape, candidate-scoring framework | 2 |
| 4 mode implementations (cost, quality, hybrid, staffiq-decide) | 3 |
| StaffIQ scoring + insights generators | 2 |
| Build endpoints: POST build, GET batch, POST select, POST rescore | 2 |
| Build run logging + audit infrastructure | 1 |
| Web UI: Build button + 4-mode modal + comparison view | 3 |
| Web UI: Re-score button + insights badges + warnings panel | 2 |
| Post-publish edit flow: backend + audit log + notification trigger | 2 |
| Web UI: edit highlighting + acceptance-pending state | 1 |
| Provider mobile: change-required notification + accept/decline UI | 3 |
| Master daily view backend endpoint | 1 |
| Master daily view UI (facility web + provider mobile) | 3 |
| iCal feed endpoint + token management | 2 |
| Calendar subscription onboarding screen + deep links | 1 |
| Notification dispatcher extensions (Push always, SMS feature-flagged) | 2 |
| E2E test on a real month + load test the algorithms | 2 |
| Polish, error handling, edge-case warnings | 2 |
| **Total** | **~35 days = 5-6 calendar weeks at one focused dev** |

### Phased delivery options if 5-6 weeks is too long

- **Phase 1 (2 weeks):** Schema + 4 modes + build endpoints + web UI compare. No mobile changes, no calendar sync, no post-publish acceptance. Coordinator can use the new build flow; providers experience same as today.
- **Phase 2 (1 week):** Post-publish edit flow + provider accept/decline UI in mobile (needs TestFlight build).
- **Phase 3 (1 week):** iCal feed + calendar subscription onboarding.
- **Phase 4 (1 week):** Master daily view (facility + provider).
- **Phase 5 (ongoing):** StaffIQ ML training off the accumulated logs.

This phasing lets us **demo the core "build the schedule" value prop within 2 weeks**; the broader vision lands across the following 3-4 weeks.

---

## Cross-references

- Coverage Templates v1: `docs/coverage-templates-design.md` (prerequisite — populates the rooms)
- E-signature v1: `snap-credentialing/docs/esign-design.md` (parallel feature, separate vertical)
- Passport API: `snap-credentialing/docs/passport-api-design.md` (future foundation for marketplace credential consumption)
- Existing StaffIQ infra: `snap-marketplace/backend/src/routes/staffiq.js`, `routes/staffiqInputs.js`, `utils/staffiqScore.js` — extend, don't rewrite
- Existing notification infra: `snap-marketplace/backend/src/services/notifications.js` (PILOT_HARDENING.md notes Twilio currently disabled)
