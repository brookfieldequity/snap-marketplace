# WC Recovery — Developer Build Brief (v1)

**Product:** A separately-priced SNAP tab that recovers underpaid Workers' Compensation dollars for anesthesia groups.
**Status:** ✅ **v1 BUILT (2026-07-24)** — schema, cold-start entitlement engine, AI ingestion reader, rung-1 packet PDFs, recovery ledger, `/api/wc` routes, and the WC Recovery web tab (gated by the `wc_recovery` feature flag) are all implemented per this spec. Not yet deployed/committed; calibrated mode (§6b) and rung-2 DIA filings remain future work. Key files: `backend/src/wc/{maFeeSchedule,wcEngine,wcIntake,wcDocs}.js`, `backend/src/routes/wc.js`, `web/src/pages/wc/WcApp.jsx`.
**Design partner / first client:** CAPA (Massachusetts).
**Owner:** Matt Haverkamp. **Date:** 2026-07-24.

---

## 1. The thesis (why this exists)

Anesthesia groups are systematically **underpaid on workers' comp cases**, and almost none of them recover the difference. The causes are well understood:

- **State-fee-schedule roulette.** WC is not one payer with one rule — every state has its own fee schedule and appeal process. Groups that bill every WC case the same way get underpaid in states whose schedule entitled them to more.
- **Mangled anesthesia math.** WC payers and their bill-review vendors reprice `base units + time units + modifier units` to a lower conversion factor (often Medicare), drop physical-status / qualifying-circumstance modifier units, or miscount time. The group's billers — for whom WC is <5% of volume — don't catch it.
- **Administrative gauntlet.** Each WC claim needs claim number, adjuster, employer, date of injury, body part, and an authorization tied to the *surgeon's* auth. Missing one field = denial or indefinite pend.
- **Nobody works the appeal.** Most states have a formal second-review / independent-bill-review path where underpayments get corrected. It's knowable and winnable, and virtually no anesthesia group has the staff or the state-by-state playbook to run it.

**The product is the appeal that never gets worked, plus the intelligence that proves the underpayment.** SNAP knows the state entitlement, catches every underpayment, generates the audit/demand/appeal packet, and tracks recovered dollars as an auditable ledger. Pricing is a contingency % of documented recovery — so the product literally measures its own value.

**The entitlement gap is a known, existing reality — we do NOT need to validate that it exists before building.** Instead, the MA entitlement math is baked into the algorithm as the **cold-start estimator** (see §6).

---

## ★ Design philosophy — reinvent the process, don't digitize it

**This is the most important section of the brief. Read the rest through this lens.**

The legacy WC process is: bill the case → wait for the payer's EOB → *maybe* someone notices the underpayment → *maybe* someone decides it's worth appealing → chase it. That process is reactive, lossy, and labor-bound — which is exactly why groups leave the money on the table. **We are not building a digital version of that process. We are replacing it.** Every design choice below serves the SNAP mission: a smarter, more efficient, more effective way to reach the goal — *the group collects their full Massachusetts entitlement on every WC case, automatically* — not a prettier to-do list for the old workflow.

Six flips define the reinvention. The concrete spec (§5–§13) exists to serve these:

1. **Entitlement-first, not EOB-first.** The source of truth is *what the case is entitled to under the MA schedule*, computed at ingestion/origination — **not** whatever the payer's EOB happens to say. The EOB stops being the thing that "reveals" an underpayment and becomes a mere reconciliation event against a number SNAP already owns. We don't discover shortfalls late; we *predict* them.

2. **Every case is born appeal-ready.** There is no "decide whether to appeal" step. The moment a case is ingested, its audit + demand + second-review packet is already staged. If payment lands short, the appeal is one human confirmation away — zero latency. The default posture is *"we will collect the full entitlement,"* not *"let's see if it's worth chasing."*

3. **Prevent upstream, don't just recover downstream.** The best recovery is the one never needed. Forward origination (day 15) engineers the *clean claim* so the payer can't underpay in the first place — correct units, correct modifiers, correct claim metadata, MA entitlement cited on the claim itself. Over time, value shifts from back-end recovery to front-end prevention. We cure, we don't just treat.

4. **Software works every case; humans touch only exceptions.** Invert the labor model. Instead of humans processing every case with software assisting, **software processes every case** and routes only the low-confidence exceptions to a human. Every case carries a **confidence score**; high-confidence cases flow through untouched, humans spend their scarce attention only where it changes the outcome. This is what makes it scale — and what makes the future services-desk flip trivial.

5. **Cases are self-advancing objects, not rows in a queue.** A case knows its own next-best action and advances itself through the state machine, pausing only at the gates that legally require a human (e.g. sending). Agentic case management — the system drives, the human approves — not a human dragging cards across a board.

6. **The payer-behavior model is a compounding moat.** Every case teaches SNAP how each MA payer / adjuster / bill-review vendor behaves — what units they cut, which citation reverses them, how many days it takes. Each case makes the next one faster and more certain. Over time SNAP *pre-empts* a payer's known games before they play them. This data asset — not the form-filling — is the defensible product.

**Litmus test for every feature during the build:** *"Would this exist in the group's current manual process?"* If yes, we probably haven't reinvented it — we've just digitized it. Push until the answer is *"no — this is only possible because software owns the entitlement truth and works every case."*

---

## 2. v1 scope

**In scope (v1):**
- Massachusetts only. One state, built to the bottom.
- CAPA as the single design-partner client.
- Retrospective recovery: ingest 3–6 months of the group's past WC billing → baseline + catch underpayments + build training corpus.
- Forward origination (from ~day 15): SNAP assembles clean WC claims going forward.
- Cold-start MA entitlement estimator (works before any batch data exists).
- Adapter-based ingestion reader → one normalized case model → renders all forms/letters/audits/appeals.
- "SNAP recovered $X" recovery ledger that doubles as the billing basis.
- Pure customer-operated software (CAPA's staff/billers operate it).

**Out of scope (v1), but must be *designed for*:**
- Any state other than MA.
- SNAP-operated done-for-you appeals desk ("services / Tier 3"). Not built — but four seams must exist so the switch can flip later without a rebuild (see §11).
- SNAP touching money / sitting in the payment flow. **SNAP stays outside the money** — software + invoice only. No escrow, no lockbox, no money transmission.

---

## 3. The five locked product decisions

1. **Both, sequenced.** Retrospective 3–6 month recovery batch first (baseline + immediate found-money + training data), then forward origination from ~day 15.
2. **Outside the money flow.** Pure software + invoice layer. The WC payer still pays the group directly; SNAP invoices a contingency % against documented, **received** recovery. Never holds or routes funds.
3. **Massachusetts-deep first**, CAPA as first client. Hard-code MA correctly rather than a fragile any-state abstraction.
4. **Adapter-based reader → one normalized case model.** Billing-company export, EMR feed, and PDF EOB are three adapters into the same internal `WcCase`. Everything downstream (forms, letters, audits, appeals) renders off that one object. Same architecture as the existing CV Reader / IMA extraction engine.
5. **Pure customer-operated software now.** Flip to a SNAP-operated appeals desk only after it proves a significant revenue engine (expected to be a long while). Build the flip-the-switch seams now; don't build the service.

---

## 4. Architecture fit (SNAP marketplace stack)

This ships inside `snap-marketplace` (Express 4 + Prisma/Postgres backend, React SPA web). It reuses existing patterns:

- **Backend:** new router `src/routes/wc.js` mounted at `/api/wc/*` in `src/index.js`. Prisma models added to `backend/prisma/schema.prisma` under a new "SNAP WC Recovery models" section. Follows the same conventions as the credentialing router.
- **Auth:** gate on the existing facility audience. The anesthesia group is the tenant. Add a `wcEnabled` flag (and a `WC` value to the `snapMode` gating that already decides which sidebar pages render) rather than a new token type. Reuse `facilityAuth.js`. **Every WC record is tenant-scoped by group** from day one.
- **AI reader:** reuse the Anthropic-backed extraction pattern already used by CV Reader and IMA form extraction. Same `ANTHROPIC_API_KEY` plumbing as Snappy. For PDF text extraction reuse the **pinned `pdfjs-dist@3.11.174`** (v4 is ESM-only and crashes under Node — see existing gotcha); scanned/image EOBs fall back to a vision path.
- **Uploads:** reuse multer + S3 (`AWS_S3_BUCKET`) for source documents and generated packets. Local disk fallback when the bucket env is unset, same as credentialing.
- **Frontend:** new tab in the single-SPA `web/src/App.jsx`, hand-rolled `useState` routing like the other portals. Contain the WC UI in `web/src/pages/wc/WcApp.jsx`.
- **Deploy:** Railway, schema push-synced on boot (`prisma db push`). No new service — rides the existing backend + web services.

---

## 5. Data model (Prisma)

New section in `backend/prisma/schema.prisma`. The heart is `WcCase` (the normalized case model); everything else hangs off it.

```prisma
// ===== SNAP WC Recovery models =====

enum WcCaseSource   { BILLING_EXPORT  EMR_EXPORT  EOB_PDF  MANUAL }
enum WcCaseStatus   { INGESTED  ENTITLEMENT_COMPUTED  UNDERPAYMENT_FLAGGED  PACKET_GENERATED  SUBMITTED  RESOLVED_RECOVERED  RESOLVED_NO_RECOVERY  CLOSED }
enum WcOwnerType    { CUSTOMER  SNAP_OPERATOR }        // the services-switch seam
enum WcWorkItemType { REVIEW_UNDERPAYMENT  DRAFT_PACKET  SUBMIT_APPEAL  CHASE_ADJUSTER  RECONCILE_REMIT }
enum WcWorkItemStatus { OPEN  IN_PROGRESS  BLOCKED  DONE }
enum WcDocType      { AUDIT  CORRECTED_CLAIM  DEMAND_LETTER  PROHIBITED_PRACTICE_COMPLAINT  DIA_CLAIM  CLEAN_CLAIM }
enum WcDocStatus    { DRAFT  GENERATED  SENT }          // generation vs sending decoupled

model WcClient {                 // the anesthesia group / tenant
  id            String   @id @default(cuid())
  facilityId    String   @unique                        // link to existing Facility/group
  name          String
  contingencyPct Float   @default(0)                     // billing rate on recovered $
  createdAt     DateTime @default(now())
  cases         WcCase[]
}

model WcCase {
  id            String        @id @default(cuid())
  clientId      String
  client        WcClient      @relation(fields: [clientId], references: [id])
  source        WcCaseSource
  status        WcCaseStatus  @default(INGESTED)
  ownerType     WcOwnerType   @default(CUSTOMER)          // who works it (switch seam)
  assigneeId    String?                                   // specific user; null = unassigned

  // --- Anesthesia detail (drives entitlement; reader must be ruthless here) ---
  asaCptCode        String?
  baseUnits         Float?
  anesthesiaMinutes Int?
  timeUnits         Float?                                // minutes / MA minutes-per-unit
  physicalStatus    String?                               // P1..P6 modifier units
  qualifyingCircs   String[]                              // QC modifier units
  otherModifiers    String[]

  // --- Injury / claim metadata (drives clean-claim + submission) ---
  claimNumber   String?
  adjusterName  String?
  adjusterContact String?
  employerName  String?
  dateOfInjury  DateTime?
  bodyPart      String?
  authorization String?
  payerName     String?
  dateOfService DateTime?

  // --- Financials ---
  billedAmount     Float?
  entitledAmount   Float?                                 // computed by engine (§6) — the source of truth
  paidAmount       Float?                                 // from remittance (a reconciliation input, NOT the truth)
  gapAmount        Float?                                 // entitled - paid (the recoverable)

  // --- Reinvention fields (§ Design philosophy) ---
  confidenceScore  Float?                                 // engine's confidence; drives auto vs. human-exception routing
  nextAction       String?                                // self-advancing: the case's own computed next-best action
  autoStaged       Boolean  @default(false)               // appeal packet pre-built at ingestion, not on demand

  entitlementCalc  WcEntitlementCalc?
  remittances      WcRemittance[]
  documents        WcDocument[]
  workItems        WcWorkItem[]
  activity         WcActivityLog[]
  recoveryEvents   WcRecoveryEvent[]

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model WcEntitlementCalc {         // auditable snapshot of the entitlement computation
  id             String   @id @default(cuid())
  caseId         String   @unique
  case           WcCase   @relation(fields: [caseId], references: [id])
  conversionFactor Float                                  // MA WC anesthesia CF used
  minutesPerUnit   Float                                  // MA time-unit rule used
  totalUnits       Float                                  // base + time + modifier units
  entitledAmount   Float
  method           String                                 // "MA_COLD_START" | "MA_CALIBRATED"
  inputsJson       Json                                   // full inputs for audit
  createdAt        DateTime @default(now())
}

model WcRemittance {              // an EOB / 835 line — the "received" side
  id           String   @id @default(cuid())
  caseId       String
  case         WcCase   @relation(fields: [caseId], references: [id])
  paidAmount   Float
  adjustments  Json?                                      // CARC/RARC reason codes
  receivedDate DateTime?
  source       WcCaseSource
  createdAt    DateTime @default(now())
}

model WcRecoveryEvent {           // THE LEDGER — each recovered $ as an auditable event = billing basis
  id           String   @id @default(cuid())
  caseId       String
  case         WcCase   @relation(fields: [caseId], references: [id])
  amount       Float                                      // dollars recovered on this event
  recognizedAt DateTime @default(now())                   // when RECEIVED (not expected)
  basis        String                                     // "SECOND_REVIEW_PAID" | "APPEAL_PAID" | ...
  invoiced     Boolean  @default(false)
  createdAt    DateTime @default(now())
}

model WcWorkItem {                // assignable work — assignee can be CUSTOMER or SNAP_OPERATOR later
  id         String            @id @default(cuid())
  caseId     String
  case       WcCase            @relation(fields: [caseId], references: [id])
  type       WcWorkItemType
  status     WcWorkItemStatus  @default(OPEN)
  ownerType  WcOwnerType       @default(CUSTOMER)
  assigneeId String?
  dueAt      DateTime?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model WcDocument {                // generated packets — generation and sending are separate steps
  id         String     @id @default(cuid())
  caseId     String
  case       WcCase     @relation(fields: [caseId], references: [id])
  type       WcDocType
  status     WcDocStatus @default(DRAFT)
  storageKey String?                                      // S3 key of rendered PDF
  generatedAt DateTime?
  sentAt     DateTime?                                    // set by a *separate* action from generate
  sentBy     String?
  createdAt  DateTime @default(now())
}

model WcActivityLog {             // per-case who/what/when — powers ledger audit + future services
  id        String   @id @default(cuid())
  caseId    String
  case      WcCase   @relation(fields: [caseId], references: [id])
  actorId   String?
  actorType WcOwnerType
  action    String
  metaJson  Json?
  createdAt DateTime @default(now())
}
```

---

## 6. The entitlement algorithm (the core) — cold-start + calibrated

This is the intellectual heart. It runs in **two modes**, and the cold-start mode must work on day one with **zero** batch data.

### 6a. Cold-start (MA fee-schedule estimate) — runs before batch data exists

The MA WC schedule constants are **already pulled from the primary regulation and pre-filled** in `backend/src/wc/maFeeSchedule.js` (source: **114.3 CMR 40.05(2)**, effective 2009-04-01). The engine's `computeWcEntitlement()` lives there. Per case:

```
timeUnits       = round(anesthesiaMinutes / 15, 1)     // MA WC time unit = 15 minutes (NOT per-minute)
modifierUnits   = physicalStatusUnits + qualifyingCircUnits
totalUnits      = baseUnits + timeUnits + modifierUnits // base units from 40.06(2) table
entitledAmount  = totalUnits * 39.00                    // $39.00 rate per unit (WC)
gapAmount       = entitledAmount - paidAmount           // the recoverable dollars
```

**Confirmed MA WC values (in the config module):**

- **Rate per unit (WC conversion factor): `$39.00`** — 114.3 CMR 40.05(2).
- **Time unit = `15 minutes`**, partial rounded to 1 decimal — 114.3 CMR 40.05(2).
- **Physical-status units:** P3 = 1, P4 = 2, P5 = 3 (P1/P2/P6 = 0) — 40.07(1) App. A.
- **Qualifying-circumstance units:** 99100 = 1, 99116 = 5, 99135 = 5, 99140 = 2 — 40.05(2)(f).
- **Base units:** from the 40.06(2) base-unit table (tracks the ASA RVG). `BASE_UNITS_BY_CPT` is the one lookup still to be bulk-populated from the reg table — the engine refuses to estimate a case whose base units are unknown rather than inventing them.

**Critical MA nuance — the core underpayment pattern:** WC and commercial use *different* math. WC is a single `$39.00`/unit rate on (base + 15-min-time + modifier) units; the commercial schedule (101 CMR 316.04, `$19.90`/base + `$1.33`/**minute**) has no added modifier units and pays roughly **half**. Example: 6 base / 60 min pays **$390 under WC** but **$199.20 if repriced to commercial** — a **$190.80 short on one routine case**. So "payer repriced WC to commercial/Medicare" is a first-class detection pattern; the config ships `commercialRepriceAmount()` to label it on the demand.

Every calc records `SCHEDULE_VERSION` + `method = "MA_COLD_START"` in `WcEntitlementCalc.inputsJson`, which is what makes a demand letter defensible: *"114.3 CMR 40.05(2) entitled 13 units × $39.00 = $507; you paid the equivalent of the commercial schedule — here is the citation."*

> ⚠️ 114.3 CMR 40.00 is the 2009 WC schedule and is still the operative WC regulation as published, but confirm no post-2009 amendment changed the `$39.00` rate or 15-min unit before go-live, and bump `SCHEDULE_VERSION` if so.

### 6b. Calibrated mode — after the 3–6 month batch

The retrospective batch teaches per-payer/adjuster behavior: which payers underpay, by how much, on which modifiers, and what actually gets recovered on appeal. Use the **same learned-baseline pattern as StaffIQ** (per-entity EMA + network benchmark + outcome feedback) to refine the *estimate* and *prioritize* the highest-probability recoveries. `method` flips to `"MA_CALIBRATED"`. Cold-start remains the floor/citation; calibration adjusts expected-recovery probability and ordering — it never removes the regulatory citation.

**Key rule:** the reader (§7) must be ruthless about the anesthesia math fields. `entitledAmount` is only as good as `baseUnits`, `anesthesiaMinutes`, and the modifiers. If those are missing or soft, flag the case for human confirmation rather than emitting a weak number.

---

## 7. Ingestion / reader engine (adapters → one normalized case)

Build the **reader** and the `WcCase` model once; the sources are just adapters. Reuse the AI-extraction approach already proven in CV Reader / IMA.

- **Adapter A — Billing-company export** (CSV / 837 claim file): map columns/segments → `WcCase` fields. Highest-fidelity source; prefer it when present.
- **Adapter B — EMR export**: anesthesia record detail (times, ASA code, modifiers). Fills the clinical/anesthesia-math fields billing exports sometimes lack.
- **Adapter C — EOB / 835 remittance** (structured 835 or scanned PDF): populates `WcRemittance` (paid amount, adjustment reason codes). Text via pinned `pdfjs-dist@3.11.174`; scanned images fall back to the vision path.
- **Adapter D — Manual** entry for gaps.

All adapters normalize into the same `WcCase` + `WcRemittance`. The engine should **merge** across adapters (billing export + EMR + EOB may all describe one case) keyed on claim number + date of service + patient identifiers. When sources conflict on an anesthesia-math field, prefer the EMR/anesthesia record and log the conflict to `WcActivityLog`.

Onboarding principle: **SNAP bends to CAPA's data, CAPA does not change their workflow.** Whatever they can hand us, the reader consumes.

---

## 8. Document generation (audit / demand / second-review / appeal)

One normalized case renders every artifact. Three hard rules:

1. **Packets are auto-staged, not requested** (the "born appeal-ready" flip). The moment a case is ingested and the entitlement is computed, its audit + demand + second-review packet is generated and attached in `DRAFT`/`GENERATED` — before any human looks at it, before the EOB even arrives. There is no "generate packet" chore; the packet already exists. If payment lands short, the case is already armed.
2. **Generation and sending are separate steps** (`WcDocument.status`: `DRAFT → GENERATED → SENT`, and `generatedAt` vs `sentAt`/`sentBy` are set by different actions). The software *generates automatically*; a human only *approves the send*. This is what makes "who sends" swappable later (CAPA staff now, SNAP operator after the switch) without touching generation.
3. **Every dollar claimed cites the MA schedule** — the audit shows entitled-units vs paid-units, and the demand/second-review packet quotes the citation and the gap. Follow the existing document-voice principle (one footer provenance statement, no per-item branding).

Packet types map to the actual MA recovery ladder (§8A): `AUDIT` (internal proof), `CORRECTED_CLAIM` + `DEMAND_LETTER` (first-line resubmission citing 114.3 CMR 40.05(2) — where most recovery happens), `PROHIBITED_PRACTICE_COMPLAINT` (452 CMR 7.00 below-schedule violation), `DIA_CLAIM` (formal Dept. of Industrial Accidents filing), and `CLEAN_CLAIM` (forward origination from day 15). Render to PDF, store in S3, attach to the case.

---

## 8A. The Massachusetts recovery ladder (what the packets are FOR)

**Important: Massachusetts is not California.** MA has **no** statutory "second review → independent bill review (IBR)" ladder. Do not build a CA-style SBR/IBR flow. The MA remedy for a provider underpaid below the WC fee schedule is a three-rung ladder grounded in **M.G.L. c. 152 § 13** and **452 CMR 7.00**. The engine escalates a case up the ladder only as far as it needs to go — and the vast majority of dollars are recovered on rung 1.

**Legal footing (why the demand has teeth):**
- **§ 13** — WC rates are set by EOHHS (114.3 CMR 40.00). An insurer is capped *at* the schedule, and a *lower* rate is valid **only** if negotiated by the insurer, employer, **and** provider together. Absent that tri-party agreement, paying below 114.3 CMR 40.05(2) is not allowed.
- **§ 13** — **no employee is liable** for compensable services. The provider's only payer is the insurer, so there is no balance-billing escape valve — recovery must come from the carrier.
- **452 CMR 7.00 (Practices by Insurers)** — paying a provider **below the established rate** (absent a § 13 negotiated rate) is an **enumerated prohibited practice**. This is the enforcement lever behind the demand.

**Rung 1 — Corrected claim + demand (automated, high-volume, low-legal-risk).** Resubmit the claim to the carrier/bill-review vendor with the `AUDIT` (entitled units × $39.00 vs. what was paid) and a `DEMAND_LETTER` citing 114.3 CMR 40.05(2) and, where applicable, labeling the "repriced to commercial/Medicare" pattern (§6). This is the informal MA analog to a "second review," and it is where most recovery lands. **SNAP fully automates rung 1** — generate at ingestion, human approves the send.

**Rung 2 — DIA remedy (packet prepared by software, filed by a human).** If the carrier holds firm: (a) a **`PROHIBITED_PRACTICE_COMPLAINT`** under 452 CMR 7.00 for below-schedule payment, and/or (b) a formal **`DIA_CLAIM`** into the Department of Industrial Accidents adjudication (conciliation → conference → hearing before an Administrative Judge). **SNAP generates the complete, evidence-backed packet; a human (CAPA's biller today, or WC counsel) files it.** This is exactly the generate/send decoupling (§8) — and it's the rung where the future services desk adds the most value.

**Rung 3 — Superior Court appeal.** § 13 gives aggrieved parties a right of appeal to Superior Court on excessive-charge determinations. Out of scope for the software to originate; the case's assembled record supports counsel if it ever goes here.

**Product posture (ties to the software-not-services decision):** SNAP **automates rung 1 end-to-end** and **prepares rung-2 packets for human filing**. It does not auto-file DIA claims or practice law. This keeps SNAP squarely in software, captures the high-volume recovery, and leaves the adversarial/legal steps to humans — until (and only until) the services switch is flipped.

> ⚠️ **Confirm with MA WC counsel before building rung-2 filings:** provider standing to file a DIA claim, the exact current forms/deadlines for a 452 CMR 7.00 complaint vs. a § 10A claim, and whether the provider files independently or joins the employee's claim. Rung 1 (corrected claim + demand) carries no such dependency and should be built first.

---

## 9. Recovery ledger & billing basis (pricing)

Pricing is a **contingency % of documented, received recovery** — priced and invoiced separately from the rest of SNAP.

- Each recovered dollar is a `WcRecoveryEvent`, recognized **when received** (tie to `WcRemittance`, not to expected/entitled). This is the guardrail: we invoice on money that actually landed, not on estimates.
- The group-facing "**SNAP recovered $X for you**" counter is a sum over `WcRecoveryEvent.amount` — the same table is the marketing headline *and* the invoice ledger.
- Invoice run: sum un-invoiced `WcRecoveryEvent`s per client × `WcClient.contingencyPct`, mark `invoiced = true`. SNAP sends an invoice; **SNAP never holds the money.**
- Because SNAP is outside the money flow, remittance data (EOB/835) **must flow back to us** to recognize received recovery — this is a hard onboarding requirement, not optional.

Baseline for "incremental": the 3–6 month batch establishes the pre-SNAP collection baseline; the entitlement-gap per case is the defensible per-invoice number; collection-rate lift and denial-rate are **dashboard/marketing** metrics, not the invoice basis.

---

## 10. State machine & work management

`WcCase.status` advances: `INGESTED → ENTITLEMENT_COMPUTED → UNDERPAYMENT_FLAGGED → PACKET_GENERATED → SUBMITTED → RESOLVED_RECOVERED | RESOLVED_NO_RECOVERY → CLOSED`. Whoever works the case (CAPA today, SNAP operator later) advances it through the *same* states — the only difference is a permission.

Work is tracked as `WcWorkItem`s with an `assigneeId` and `ownerType`. The worklist UI is the operator's home base.

---

## 11. Flip-the-services-switch seams (build now, service later)

Pure software now — but these four seams cost almost nothing today and are brutal to retrofit. **All four are in the data model above; enforce them in code:**

1. **Assignable owner on every work item** (`WcWorkItem.assigneeId` + `ownerType`). Never hardcode "the customer does this." Today assignee is always a CAPA user; later it can be a SNAP operator.
2. **Claim status state machine** (`WcCaseStatus`) — driver-agnostic.
3. **Full per-case activity log** (`WcActivityLog`) — who/what/when. Needed anyway for ledger auditability; doubles as the provenance a services desk requires.
4. **Generation/sending decoupled** (`WcDocument` two-step) — "who sends" becomes a permission, not a rewrite.

Do NOT build now: cross-tenant operator console, SLA engine, capacity routing. Those come only if revenue proves out.

---

## 12. API surface (initial)

Mounted at `/api/wc/*`, `facilityAuth`, tenant-scoped by group:

- `POST /api/wc/ingest` — upload a source file; run the right adapter → create/merge `WcCase`(s).
- `POST /api/wc/cases/:id/compute` — run entitlement engine (§6) → `WcEntitlementCalc`, set `entitledAmount`/`gapAmount`, advance status.
- `GET  /api/wc/cases` — worklist (filter by status/assignee/gap).
- `GET  /api/wc/cases/:id` — full case detail + calc + remittances + docs + activity.
- `POST /api/wc/cases/:id/documents` — generate a packet (type param) → `WcDocument` (status `GENERATED`).
- `POST /api/wc/documents/:id/mark-sent` — the *separate* send-confirmation step (status `SENT`).
- `POST /api/wc/remittances` — record received payment → recompute gap → emit `WcRecoveryEvent` when recovery lands.
- `GET  /api/wc/ledger` — recovery events + the "$X recovered" total.
- `POST /api/wc/invoice-run` — sum un-invoiced events × contingency %, mark invoiced.
- `GET/POST /api/wc/workitems` — assignable work management.

---

## 13. Frontend tab

New tab in `web/src/App.jsx` (hand-rolled `useState` routing, gated by the group's `wcEnabled` / `snapMode`). Contain in `web/src/pages/wc/WcApp.jsx`:

- **Dashboard** — the big "SNAP recovered $X" counter, open recoverable gap, worklist summary.
- **Cases** — table of cases with entitled vs paid vs gap, status, assignee; drill-in to case detail (calc breakdown, remittances, packets, activity).
- **Ingest** — upload billing export / EMR export / EOB; show what the reader extracted, confirm anesthesia-math fields.
- **Packets** — generate + review; explicit separate "Mark as sent" action.
- **Ledger / Billing** — recovery events feeding the invoice.

Match existing SNAP styling (Nunito, Snappy brand system).

---

## 14. Suggested build sequence

1. **Schema + config** — Prisma models (§5) + `maFeeSchedule.js` populated from the authoritative MA schedule.
2. **Entitlement engine (cold-start)** — §6a, unit-tested against a handful of worked MA cases. This works with zero batch data.
3. **Ingestion reader** — start with the billing-export adapter (highest fidelity) + EOB remittance; EMR + vision-PDF next.
4. **Case worklist + detail UI** — visualize entitled vs paid vs gap.
5. **Document generation** — rung-1 packets first (audit + corrected-claim + demand citing 114.3 CMR 40.05(2)), with the generate/send split (§8, §8A). Rung-2 DIA packets after counsel confirms forms/standing.
6. **Recovery ledger + invoice run** — the "$X recovered" counter and billing basis.
7. **Calibrated mode** — feed the 3–6 month batch into the StaffIQ-style learned refinement.
8. **Forward origination (clean-claim)** — day-15 capability.

---

## 15. Open items / must-source before coding

- ✅ **MA WC anesthesia fee-schedule constants** — DONE. Pulled from 114.3 CMR 40.05(2) (eff. 2009-04-01) and pre-filled in `backend/src/wc/maFeeSchedule.js`: $39.00 rate/unit, 15-min time unit, PS units (P3=1/P4=2/P5=3), QC units (99100=1/99116=5/99135=5/99140=2), plus commercial schedules for reprice detection. Remaining: (a) bulk-populate `BASE_UNITS_BY_CPT` from the 40.06(2) base-unit table; (b) confirm no post-2009 amendment changed the $39.00 rate before go-live.
- ✅ **MA recovery/appeal path** — DONE, documented in §8A. MA has no CA-style IBR; the ladder is corrected-claim/demand (114.3 CMR 40.05(2)) → DIA prohibited-practice complaint (452 CMR 7.00) / DIA claim → Superior Court (§ 13). Build rung 1 first (no legal-standing dependency). Remaining: confirm with MA WC counsel the exact rung-2 forms, deadlines, and provider standing before generating DIA filings.
- **CAPA's actual data shapes** — sample billing export + EMR export + a real EOB, to build the first adapters against.
- **Contingency %** and invoicing cadence (business decision).
- Confirm the remittance-return requirement is contractually part of CAPA onboarding (needed to recognize received recovery — §9).
