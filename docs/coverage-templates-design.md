# Coverage Templates — design v1

**Status:** Design approved 2026-06-02. Implementation queued; user has flagged this as important for letting CAPA test the SNAP Shifts schedule builder.

**Module:** SNAP Shifts (internal staffing) → Schedule Builder.

---

## Why this exists

Today, every time a coordinator builds a new month's schedule in SNAP Shifts, they re-enter the same baseline: which locations they cover, how many rooms at each location on each day of the week. This is high-volume repetitive work — a typical practice covers 5–10 locations across 7 days = 35–70 cell entries per month, almost all of which are the same month after month.

Coverage Templates eliminate that re-entry. Each practice declares its standard coverage pattern once (a *Coverage Template*); when generating a future month, the system materializes `ScheduleDay` rows from the template, leaving the coordinator to only adjust deltas (sick days, holidays, special weeks).

**But the bigger picture:** "save time on entry" is the v1 framing. The v1.1 evolution is that **this same template becomes the home for per-site coverage RULES that feed StaffIQ**. The richer the rules at template-creation time, the smarter StaffIQ's monthly schedule recommendations become. The user was explicit on this point — name the feature accordingly ("Coverage Template", not "default schedule") because we'll be putting much more than counts here over time.

Two features in one data model:
1. **v1:** Eliminate boilerplate entry on monthly schedule creation.
2. **v1.1:** Encode per-site coverage rules (anesthesia care model, ratios, role mix) as direct inputs to StaffIQ.

---

## What changes vs what stays the same

| | Today | After v1 |
|---|---|---|
| Create a fresh month's schedule | Enter every location × day from scratch | Pick a Coverage Template → "Generate" → schedule pre-fills |
| Click-a-day editing (add/remove location, change rooms, assign provider) | Works as it does | **Unchanged.** Generation just materializes the rows; existing UI takes over from there. |
| Holidays | Coordinator manually zeros out room counts on each holiday | Federal holidays auto-skipped; practice can add/remove overrides |
| StaffIQ inputs | Per-month entries | (v1.1) Per-site rules from template directly inform StaffIQ |

The user was explicit: **the existing click-a-day UX is sacred and must not change**. Templates are a starting point; everything downstream stays the same.

---

## Scope of v1 (locked 2026-06-02)

| Decision | Value | Notes |
|---|---|---|
| Ownership | Per-practice (per-Facility) | One+ templates per Facility; not per-coordinator |
| Template count | Multiple named templates per practice | e.g., "Standard Week", "Summer Schedule", "Holiday Week" |
| Locations | Owned by each template (list of strings) | No new `FacilityLocation` table for v1. Duplicating a template duplicates its locations. |
| Materialization | On-demand "Generate Schedule for [Month]" button | Not auto-generated on month-view; not nightly-cron'd |
| Template captures | `(location, dayOfWeek, roomsRequired)` triples — total count only | No per-room specialty in v1 |
| Holidays | US federal holiday calendar inherited; practice overrides | Holiday dates auto-skip during generation (no `ScheduleDay` rows created) |
| Naming | **"Coverage Template"** | NOT "Default Schedule" — undersells the v1.1 expansion |

### What's deferred to v1.1

- **Per-site coverage rules** for StaffIQ — examples user gave:
  - Kenmore: "1 MD covering 3 or even 4 CRNAs" → 1:3 or 1:4 MD-supervising-CRNA ratio
  - Shields Natick: "MD only" → solo MD model, no CRNAs at this site
  - Per-day overrides (e.g., team model weekdays, MD-only Saturdays)
- Per-day exceptions inside a template (e.g., "Standard Week" but for the week of July 4)
- Per-template holiday exception lists

### What's not in scope at all (yet)

- Cross-template inheritance (e.g., "Summer Schedule inherits Standard Week, just changes Friday")
- Time-of-day cuts (early case vs late case rooms)
- Auto-suggest template based on which months coordinator typically uses
- Per-location FacilityLocation catalog (might come in a Phase 2 if location-name typos become painful)

---

## Architecture

### New tables (Prisma)

```prisma
model CoverageTemplate {
  id          String   @id @default(cuid())
  facilityId  String
  facility    Facility @relation(fields: [facilityId], references: [id])
  name        String   // "Standard Week", "Summer Schedule", etc.
  isDefault   Boolean  @default(false)  // marked as the practice's default pick
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  days CoverageTemplateDay[]

  @@unique([facilityId, name])
}

model CoverageTemplateDay {
  id              String           @id @default(cuid())
  templateId      String
  template        CoverageTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  location        String           // free-text, matches ScheduleDay.location semantics
  dayOfWeek       Int              // 0=Sunday, 1=Monday, ... 6=Saturday
  roomsRequired   Int              @default(1)

  // v1.1 hooks (not used in v1; reserved column names for forward-compat):
  // roleMix       Json?            // { CRNA: 3, ANESTHESIOLOGIST: 1 } or coverage-ratio rules
  // notes         String?

  @@unique([templateId, location, dayOfWeek])
}

model FacilityHoliday {
  id          String   @id @default(cuid())
  facilityId  String
  facility    Facility @relation(fields: [facilityId], references: [id])
  date        DateTime @db.Date
  label       String   // "Christmas", "Patriots' Day", etc.
  // null = inherited from federal calendar (read-only display); true = practice added; false = practice excluded from federal
  source      HolidaySource

  @@unique([facilityId, date])
}

enum HolidaySource {
  FEDERAL_INHERITED   // shown but stored only for traceability
  PRACTICE_ADDED      // practice added beyond federal list
  PRACTICE_EXCLUDED   // practice opted out of a federal holiday
}
```

Plus add `coverageTemplates CoverageTemplate[]` and `holidays FacilityHoliday[]` relations to the existing `Facility` model.

### Federal holiday calendar

The "default federal calendar" is baked into the application code (not the DB) — there's no need to enumerate it for every facility. A util function `getFederalHolidaysForMonth(year, month)` returns the standard list:

- New Year's Day (Jan 1)
- MLK Day (3rd Monday in January)
- Presidents' Day (3rd Monday in February)
- Memorial Day (last Monday in May)
- Juneteenth (Jun 19)
- Independence Day (Jul 4)
- Labor Day (1st Monday in September)
- Columbus / Indigenous Peoples' Day (2nd Monday in October)
- Veterans Day (Nov 11)
- Thanksgiving (4th Thursday in November)
- Christmas (Dec 25)

When generating, the effective holiday set for a month is:
```
effective = federal(month) - practiceExcluded + practiceAdded
```

Practice override is via a UI that lets them toggle each federal holiday (excludes it) or add a new one (e.g., MA's Patriots' Day, the 3rd Monday in April).

### Generation flow

```
POST /api/schedule/generate
  body: { facilityId, year, month, templateId }
  
  1. Validate caller owns/admins the facility
  2. Load template + its days; load practice's holidays for that month
  3. Compute effective holiday set
  4. For each date in the month:
       skip if in effective holiday set
       lookup template days for date.dayOfWeek
       for each (location, roomsRequired) entry:
         upsert ScheduleDay(facilityId, date, location) with roomsRequired
  5. Return summary: { rowsCreated, holidaysSkipped, conflicts }
```

**Idempotency / re-generation.** If a coordinator hits "Generate" twice or with a different template, we use `upsert` keyed on the existing `@@unique([facilityId, date, location])`. Re-generating bumps `roomsRequired` but does NOT delete `ScheduleDay` rows from a previous run that aren't in the new template (those become orphan locations the coordinator can manually remove). This is the conservative choice — never silently destroy a coordinator's prior work.

A separate `DELETE /api/schedule/generate` could let the coordinator wipe a month and start fresh, but not in v1.

---

## API endpoints

### Coverage Templates

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/coverage-templates` | List templates for `facilityId` (query param) |
| `GET` | `/api/coverage-templates/:id` | Get one with `days[]` |
| `POST` | `/api/coverage-templates` | Create. Body: `{ facilityId, name, days: [{location, dayOfWeek, roomsRequired}, ...] }` |
| `PATCH` | `/api/coverage-templates/:id` | Rename, mark default, or replace `days[]` (full replace, not partial) |
| `DELETE` | `/api/coverage-templates/:id` | Soft-delete? Or hard? **TBD.** Soft is safer if coordinator regrets it. |
| `POST` | `/api/coverage-templates/:id/duplicate` | Create a copy with `name: <original> (copy)`. Quick path to "make a Summer variant" |

### Holidays

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/facilities/:id/holidays` | Returns the *effective* list for a given year (federal merged with overrides), with a `source` field so the UI can render which are inherited vs custom |
| `POST` | `/api/facilities/:id/holidays` | Add a practice holiday. Body: `{ date, label }` |
| `PATCH` | `/api/facilities/:id/holidays/:date` | Toggle inclusion of a federal holiday (sets `source: PRACTICE_EXCLUDED`) |
| `DELETE` | `/api/facilities/:id/holidays/:id` | Remove a practice-added holiday |

### Schedule generation

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/schedule/generate` | Materialize a month from a template. Body: `{ facilityId, year, month, templateId }`. Returns: `{ rowsCreated, rowsUpdated, holidaysSkipped, locations: [...] }` |

---

## Web UX (`snap-marketplace/web` — facility portal)

### New page: Coverage Templates

Path under the facility portal → SNAP Shifts → Coverage Templates.

```
┌──────────────────────────────────────────────────────────────┐
│ Coverage Templates                                           │
│                                                              │
│ A coverage template captures your standard staffing pattern  │
│ — locations and rooms by day of week — so when you build a   │
│ new month's schedule, you don't have to enter it all again.  │
│                                                              │
│ [+ New Template]                                             │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Standard Week                          ★ default  ⋮   │  │
│ │ 7 locations, 25 rooms/week — last edited 3 days ago    │  │
│ └────────────────────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Summer Schedule                                    ⋮   │  │
│ │ 6 locations, 18 rooms/week — last edited 2 weeks ago  │  │
│ └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Template editor

```
┌──────────────────────────────────────────────────────────────┐
│ ← Standard Week                              [Duplicate]     │
│                                                              │
│ [+ Add Location]                                             │
│                                                              │
│         Mon  Tue  Wed  Thu  Fri  Sat  Sun                    │
│ Atrius   [4]  [3]  [4]  [4]  [3]  [0]  [0]   ⋮              │
│ Kenmore                                                      │
│                                                              │
│ Atrius   [3]  [2]  [3]  [3]  [2]  [0]  [0]   ⋮              │
│ Weymouth                                                     │
│                                                              │
│ Shields  [2]  [2]  [3]  [2]  [2]  [1]  [0]   ⋮              │
│ Natick                                                       │
│                                                              │
│ ...                                                          │
│                                                              │
│ [Save]                                                       │
└──────────────────────────────────────────────────────────────┘
```

- Each cell is a small number-stepper input
- "Add Location" prompts for a name; appends a row
- Row menu (⋮) → rename, remove
- Save commits the full `days[]` array to the API

### Integration with existing Schedule Builder view

The existing Schedule Builder shows a month grid. When the coordinator navigates to a month that has **no `ScheduleDay` rows yet**, show a top banner:

```
┌──────────────────────────────────────────────────────────────┐
│ This month is empty. Generate from a Coverage Template?      │
│                                                              │
│ Template: [Standard Week ▾]   [Generate]                     │
└──────────────────────────────────────────────────────────────┘
```

When `ScheduleDay` rows already exist for the month, the banner is hidden and the existing UI is unchanged. (Optionally show a small "Regenerate from template" action in a settings menu — handles the case where coordinator decides to switch templates after the fact.)

### Holidays page

```
┌──────────────────────────────────────────────────────────────┐
│ Holidays — 2026                                              │
│                                                              │
│ Federal holidays we automatically skip when generating:      │
│ ☑ New Year's Day — Jan 1                                    │
│ ☑ MLK Day — Jan 19                                          │
│ ☐ Columbus / Indigenous Peoples' Day — Oct 12 (excluded)    │
│ ☑ ...                                                        │
│                                                              │
│ Your additional closed days:                                 │
│ • Patriots' Day — Apr 20 (third Monday in April) [×]         │
│ • Practice Holiday Party — Dec 15 [×]                        │
│ [+ Add a closed day]                                         │
└──────────────────────────────────────────────────────────────┘
```

Checkbox unchecks → POST a PRACTICE_EXCLUDED override. Add-row → POST a PRACTICE_ADDED row.

---

## Mobile (out of scope for v1)

The SNAP Shifts mobile experience for coordinators is not yet defined. Coverage Templates are a desktop / web feature for v1. Providers don't interact with templates directly.

---

## Implementation sequence — estimated ~10-12 working days for v1

| Chunk | Days |
|---|---|
| Schema (3 new models + enum), migration, regen client | 0.5 |
| Federal holiday utility (`getFederalHolidaysForMonth`) + tests | 0.5 |
| Backend: CRUD endpoints for Coverage Templates | 1.5 |
| Backend: CRUD endpoints for FacilityHoliday | 1 |
| Backend: `POST /api/schedule/generate` (template + holidays → bulk upsert) | 1.5 |
| Web: Coverage Templates list page | 0.5 |
| Web: Coverage Template editor (the location × day-of-week grid) | 2 |
| Web: Holidays page | 1 |
| Web: "Generate from template" banner in existing Schedule Builder | 1 |
| E2E test: create template → generate month → verify ScheduleDay rows | 1 |
| Polish, error handling, empty-state UX | 1 |
| **Total** | **~11.5 days** |

## Open questions (TBD before/during build)

1. **Soft vs hard delete on templates.** A practice that deletes "Standard Week" might regret it. Soft-delete (set `deletedAt`) gives a 30-day undo; hard delete is simpler. Lean soft for safety.
2. **Permissions.** Who can edit Coverage Templates? Today the facility portal has multiple `FacilityUser` roles. Coverage Templates are practice-wide, so probably restricted to OWNER / SCHEDULER roles, not all users. Confirm exact role list during build.
3. **Regenerate semantics.** Current design: re-running generate upserts (bumps room counts, never deletes). Should there be a "Replace all" mode? Not for v1.
4. **Template change → already-generated months.** If a coordinator updates "Standard Week" after generating August, does August change? **No** — only future generations use the new template. Existing months are decoupled. (Worth surfacing this clearly in the UI to prevent confusion.)
5. **Year boundary on holidays page.** Show current year by default; need a year picker for past/future. Trivial but call it out.
6. **Default federal list maintenance.** Federal holidays don't change often, but: when Congress adds Juneteenth-style new ones, we need to ship a release to include it. Document this somewhere.
