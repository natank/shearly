# Shearly MVP — Implementation Plan

**Stage:** 4 of 4 (Implementation Plan)
**Scope:** MVP only. Product Phase 2+ appears as a roadmap, not as build work.
**Status:** M0–M3 complete on `main` (2026-08-15). M4 plan and QC STD written 2026-08-22, not yet implemented. M5 plan not written.
**Source:** `docs/mvp/mvp-kickoff.md`, `docs/01-vision.md`, `docs/mvp/02-requirements.md`, `docs/mvp/03-design.md`

This file is the **master plan**. Milestone plans live beside it and are the source of PR sequences. The master owns the cuts, the story map, and the MVP Definition of Done. A milestone plan may not add, drop, or move a story without updating §4–§5 here.

---

## 0. Document map

| ID | Document | Role | Status |
|---|---|---|---|
| **MASTER** | [04-implementation-plan.md](./04-implementation-plan.md) | Cuts, story map, DoD, delivery outline | Active — M0–M3 shipped |
| **M0** | [m0-foundation.md](./m0-foundation.md) | Foundation PR sequence | Complete |
| **M1** | [m1-accounts.md](./m1-accounts.md) | Accounts | Complete |
| **M2** | [m2-supply.md](./m2-supply.md) | Supply | Complete |
| **M3** | [m3-demand.md](./m3-demand.md) | Demand | Complete |
| **M4** | [m4-transaction.md](./m4-transaction.md) | Transaction | Written, not yet implemented |
| **M5** | `m5-operate-and-bar.md` | Operate & bar | Not written |
| **QC** | [QC/](../QC/README.md) | Manual STD written when the milestone plan is accepted, before its PRs are implemented (QC/README.md §4) | M0–M4 written |

### Implementation progress

| ID | Plan | Code on `main` | Evidence |
|---|---|---|---|
| **M0** | written | **Complete** — PRs [#7](https://github.com/natank/shearly/pull/7)–[#14](https://github.com/natank/shearly/pull/14) | CI gates 1–8 and Image smoke green on merge of #14 (`6b123c5`, 2026-08-14) |
| **M1** | [complete](./m1-accounts.md) | **Complete** — PRs [#16](https://github.com/natank/shearly/pull/16)–[#21](https://github.com/natank/shearly/pull/21) | CI green on each merge |
| **M2** | [complete](./m2-supply.md) | **Complete** — PRs [#24](https://github.com/natank/shearly/pull/24)–[#30](https://github.com/natank/shearly/pull/30) | CI green on P5–P7; P3/P4 schema-race fixed in follow-ups |
| **M3** | [complete](./m3-demand.md) | **Complete** — PRs [#36](https://github.com/natank/shearly/pull/36)–[#41](https://github.com/natank/shearly/pull/41) | CI green on each merge |
| **M4** | [written](./m4-transaction.md) | not started | — |
| **M5** | not written | not started | — |

Stable IDs: milestone `M0`…`M5`; PRs inside a milestone plan `M0-P1`, `M0-P2`, …. Implementation PRs cite both (`M0-P3`, `NFR-CI-001`).

---

## 1. How to Read This Document

This is the kickoff's Plan deliverable, split across this folder:

1. **Master (this file)** — in vs out, milestone cuts, story → milestone map.
2. **One file per milestone** — PR sequence, files, tests, exit checklist. Does not reopen architecture or the cuts.

**Cadence (M0 retrospective — keep for M1–M5):** write **one** milestone plan, accept it, implement that sequence to exit, *then* write the next plan. Do not pre-write M2–M5 while implementing M1. The master already owns the cuts; a later file only sequences PRs inside its assigned stories.

Architecture is decided in `03-design.md`. This folder does not reopen it.

### Words

| Word | Means here |
|---|---|
| **Phase** | Product roadmap slice (MVP, Phase 2, Phase 3, Phase 4) — vision §8 |
| **Stage** | Gated documentation (Vision → Requirements → Design → Plan) |
| **Milestone** | A build increment inside MVP implementation (`M0`…`M5`). These are the "implementation stages" to review below |

Each milestone is independently demoable. Later ones add onto a still-working earlier demo. A milestone is not a git branch lasting the whole increment — it is a sequence of small PRs listed in that milestone's plan.

---

## 2. In vs Out

### In (this plan)

Every `MVP` `P0` and `P1` story in `02-requirements.md`, plus the NFRs tagged `MVP`. That is the submission bar.

`MVP-STRETCH` (PAY-006 automated payouts, RAT-003 provider review replies) ships **only if M5 has slack**. Cutting them does not break the demo; OPS-005 remains the payout path.

### Out (explicit)

| Out | Why |
|---|---|
| All `POST-MVP` stories | Written in requirements; not built |
| Agentic features | Ranking *seam* only (DIS-002). No LLM |
| RAG | Kickoff exclusion |
| Other verticals, chat, map, calendar sync, OAuth, multi-currency | Vision §7 |
| Repo scaffolding beyond what M0 specifies | Implementation starts only after this Plan is approved **and** a separate go-ahead (kickoff §7) |

### Adopted defaults (not re-litigated)

Q-1…Q-5 and DQ-1…DQ-5 from requirements and design. DQ-5 default: 30-day window with SetupIntent + deferred authorize inside `auth_horizon`. Override DQ-5 before M4 if you want to cap book-ahead instead.

---

## 3. Why These Cuts

Design §14 already constrained sequencing:

- Skeleton and CI **before** feature work.
- Write-ownership order: `identity` → `provider-catalog` → `availability` → `booking` → `payments` → `notifications`.
- Occupancy exclusion and the booking↔payments saga belong in the **first** booking/payments work, not as polish.
- Ranking substitutability test from the first ranking commit.
- Both-locale E2E from the first E2E, not retrofitted.

Two extra rules for the cuts themselves:

1. **Do not ship an unfunded booking.** M3 can show slots. M4 is the first milestone that creates a `PENDING` row, and it does so through the §8.4 saga.
2. **Each milestone has a visible demo**, not only passing tests. That is how we know the bar is being approached rather than hoped for.

What was rejected:

| Alternative | Why not |
|---|---|
| One milestone per bounded context (6–8 plus polish) | Too many gates; catalog without availability is not demoable |
| "Thin book" then payments later | Violates PAY-001 and teaches a fake checkout |
| Vertical slices from day one (full loop in M1) | Fights the write-ownership graph and puts money on an unfinished skeleton |
| Polish as a separate last milestone after operate | RTL/E2E would be retrofitted; design forbids that. Polish is *inside* M0 (system) and M5 (bar), and both-locale tests start in M0 |

---

## 4. Milestone Breakdown (review this)

```
M0 Foundation
    │
    ▼
M1 Accounts ──────────────┐
    │                     │  sessions, roles
    ▼                     │
M2 Supply                 │
    │                     │
    ▼                     │
M3 Demand ◄───────────────┘  mid-flow auth uses M1
    │
    ▼
M4 Transaction   ←  first PENDING booking; saga + occupancy
    │
    ▼
M5 Operate & bar ←  notifications, poller, admin, polish, stretch
```

| ID | Name | Demo at exit | Unlocks |
|---|---|---|---|
| **M0** | Foundation ([plan](./m0-foundation.md)) | Empty app in HE + EN, CI green, one-command local | All code |
| **M1** | Accounts | Register, sign in/out, reset; customer vs provider land on different surfaces | Anything authenticated |
| **M2** | Supply | Founder vets a provider; provider sets services + hours; go-live checklist visible | Honest discovery |
| **M3** | Demand | Anonymous visitor, in Hebrew, finds an in-radius approved provider and sees real slots | Booking |
| **M4** | Transaction | Visitor books, authenticates mid-flow, pays; provider accepts; money authorized then captured on complete | SC-1, SC-2, SC-3, SC-6 |
| **M5** | Operate & bar | Email on every transition; expiry/reminders fire; admin retries a refund; full demo unaided in both locales | SC-4, SC-5, SC-6 inspection, SC-7 |

M0–M3 are sequential. M5 must not start until M4's money path is real. Do not parallelize M4 with M2/M3.

---

### M0 — Foundation

**Plan:** [m0-foundation.md](./m0-foundation.md)  
**Status:** Complete on `main` (2026-08-14). Residual: required status checks are not wired on branch protection — see M0 §6.

**Goal.** The shape of the repo is the shape in design §3, and CI will not accept a boundary violation.

**Builds:** Nx workspace; `type:app-api` / `type:app-web` / `type:service` / `type:contract` / `type:domain` tags; `apps/web`, `apps/admin`, `apps/api` shells; Compose (local Postgres 16 + Mailpit + geocoder stub; Stripe CLI profile; CI still uses PostGIS); typed config; shadcn tokens; i18n routing + logical-CSS lint; GitHub Actions stages 1–8; Fargate-shaped image + skip-safe ECR (DQ-2).

**Stories:** none. NFRs: CI-001 skeleton, SEC-006, UX-001 tokens, I18N-001/002 wiring, CI-003 *harness* (a trivial both-locale smoke, not the booking path).

**Exit.** `pnpm install && docker compose up -d && pnpm nx run-many -t serve` works. A PR that imports `libs/services/booking` from `apps/web` fails CI. `/he` and `/en` both render. Gates 1–8 run on every PR; required-check wiring on `main` is the residual in the M0 plan §6.

**Not in M0.** Feature screens, Stripe live keys, real SES.

---

### M1 — Accounts

**Plan:** [m1-accounts.md](./m1-accounts.md)  
**Status:** Complete on `main` (2026-08-15). PRs #16–#21.

**Goal.** Identity is a real security perimeter: sessions, not JWTs; cookies per NFR-SEC-007; one role per account.

**Builds:** `identity` service + contract; server-side sessions; register / sign-in / sign-out / reset; rate limit; anti-enumeration; guest-draft cookie (written, not yet consumed by booking); provider vs customer landing.

**Stories:** CUS-002, CUS-003, CUS-004 (`P1`), PRV-001. NFRs: SEC-003, SEC-004, SEC-007, SEC-008 (cross-tenant denied on whatever routes exist).

**Exit.** You can create a customer and a provider on two accounts, cannot be both, can reset a password and all sessions die, failed logins do not reveal whether the email exists.

**Not in M1.** Address book (M3), admin vetting queue (M2), booking draft restore (M4).

---

### M2 — Supply

**Plan:** [m2-supply.md](./m2-supply.md)  
**Status:** Complete on `main` (2026-08-15). PRs #24–#30.

**Goal.** A vetted provider with a menu and a calendar exists. Discovery can be honest later.

**Builds:** `provider-catalog` and `availability`; vetting states + private doc store; admin queue (OPS-001); services and radius cap; recurring rules, exceptions, travel buffer (slot computation as domain); Connect onboarding (PAY-005); go-live gate (PRV-005) as a checklist, not yet a public listing.

**Stories:** PRV-002, PRV-003, PRV-004, PRV-005, PAY-005, AVL-001, AVL-002, AVL-003, AVL-004, OPS-001. NFR-SEC-002.

**Exit.** Founder approves a seeded provider after seeing ID docs via a logged access. Provider sets a 60-minute service, a weekly pattern, and a day off. Go-live shows any missing prerequisite by name. Confirmed bookings do not exist yet, so AVL conflict-with-confirmed is tested with fixtures.

**Not in M2.** Public discovery, ranking, customer-facing profile.

---

### M3 — Demand

**Plan:** [m3-demand.md](./m3-demand.md)  
**Status:** Complete on `main` (2026-08-15). PRs #36–#41.

**Goal.** The visitor-facing product exists without taking money. Ranking seam is real from the first ranking commit.

**Builds:** Discovery composer in `apps/api`; geocoding + `ST_DWithin`; `DeterministicRanker` + stub-substitution test; provider profile; slot display (DIS-005) against availability; customer addresses + out-of-area (CUS-005); filters in the URL (DIS-003); rating display (RAT-002) including "new provider"; CUS-001 browse half (no login wall).

**Stories:** CUS-001 (browse + profile + slots only), CUS-005, DIS-001, DIS-002, DIS-003 (`P1`), DIS-004, DIS-005, RAT-002. NFR-PERF-001/002 as budgets on these endpoints.

**Exit.** In Hebrew, with no account, you enter an in-radius address, see ranked approved providers, open a profile, and see bookable times that match the provider's rules. An out-of-area address is an explicit state, not an empty list. Swapping in `StubRanker` reverses order with no caller change.

**Not in M3.** `POST /bookings`. Mid-flow auth. Payment.

---

### M4 — Transaction

**Plan:** [m4-transaction.md](./m4-transaction.md) — written, not yet implemented  
**QC:** [std-m4-transaction.md](../QC/std-m4-transaction.md) — written

**Goal.** The loop that is the demo: book, fund, accept, complete, cancel, decline. Money and occupancy are correct under concurrency.

**Builds:** `booking` + `payments`; §7.4 machine as a locked test fixture; GiST occupancy; §8.4 saga (authorize / SetupIntent / orphan reconciler); mid-flow auth restoring the guest draft; address snapshot + provider DTO gate (NFR-SEC-005); customer history (CUS-006); review submit (RAT-001); provider accept/decline/complete/no-show; both cancel windows; earnings view (PAY-004). Capture, refund, split, ledger.

**Stories:** CUS-001 (remainder), CUS-006 (`P1`), BOK-001…BOK-008, PAY-001…PAY-004, RAT-001. NFRs: SEC-005, SEC-001 (already constrained), CI-004, PERF-003, OBS-001 on transitions and payment ops.

**Exit.** Two parallel overlapping slot requests: one `PENDING`, one "just taken." A booking more than 12h out refunds 100% on customer cancel; inside 12h charges 50%. Provider cancel refunds 100%. Complete captures and writes gross/commission/net as separate rows. Provider `PENDING` payload has no street. Hebrew and English each complete the happy path in Playwright (this is the first *full* SC-1 E2E; the M0 harness was only locale smoke).

**Not in M4.** Email delivery (in-app + logs are enough to see transitions). Expiry job (can be invoked in tests by calling `transition` with a frozen clock; the poller is M5). Admin exception desk.

---

### M5 — Operate & bar

**Plan:** `m5-operate-and-bar.md` (not written)  
**QC:** `docs/mvp/QC/std-m5-operate-and-bar.md` — write alongside plan acceptance, before M5-P1 starts (QC/README.md §4)

**Goal.** The founder can run the marketplace, time does the right thing without a request, and a reviewer can finish the demo unaided in both locales.

**Builds:** `notifications` + outbox consumers; SES (Mailhog locally); due-work poller (expiry, auto-complete, reminders, deferred authorize); OPS-002/003/005; standing (OPS-004); funnel from events (OPS-006); WCAG on the booking flow; empty/error/loading inventory; production alarms; stretch if slack.

**Stories:** NOT-001, NOT-002 (`P1`), NOT-003, OPS-002, OPS-003, OPS-005, OPS-004 (`P1`), OPS-006 (`P1`). Stretch: PAY-006, RAT-003. Remaining NFR-I18N-005/006, A11Y-001…004, UX-002…005, OBS-002…004, CI-003 (full path already started in M4; M5 adds decline/expiry/cancel in both locales).

**Exit.** An unanswered `PENDING` becomes `EXPIRED` without anyone clicking, authorization released, both parties emailed. Admin retries a failed refund idempotently. A stranger completes SC-1 in Hebrew on a phone-width viewport with no explanation. CI 1–8 green on that commit.

**Cut first under pressure (already ordered):** RAT-003, PAY-006, then P1 in reverse epic priority (OPS-006, OPS-004, NOT-002, DIS-003 already shipped in M3 — do not rip it out; skip remaining P1 that is not started). Never silently cut P0.

---

## 5. Story → Milestone Map

| Story | Pri | Milestone |
|---|---|---|
| *(no story — repo/CI/i18n/design system)* | — | M0 |
| CUS-002, CUS-003, CUS-004, PRV-001 | P0 / P1 | M1 |
| PRV-002…005, PAY-005, AVL-001…004, OPS-001 | P0 | M2 |
| CUS-001 browse, CUS-005, DIS-001…005, RAT-002 | P0 / P1 | M3 |
| CUS-001 mid-flow, CUS-006, BOK-001…008, PAY-001…004, RAT-001 | P0 / P1 | M4 |
| NOT-001…003, OPS-002…006 | P0 / P1 | M5 |
| PAY-006, RAT-003 | stretch | M5 if slack |
| All `POST-MVP` | — | out |

SC coverage by first milestone that can claim it:

| SC | First real claim |
|---|---|
| SC-7 CI green | M0 (empty), re-proven every milestone |
| SC-4 Hebrew not degraded | M0 harness; proven on product in M3; proven on the loop in M4/M5 |
| SC-5 looks finished | Tokens in M0; bar in M5 |
| SC-1 demo completes | M4 |
| SC-2 both sides real | M4 (earning visible); M5 (email) |
| SC-3 money moves | M4 |
| SC-6 holds under inspection | M4 (cancel/decline/concurrency); M5 (expiry, admin refund) |

---

## 6. Delivery Outline

Shape is here; **PR lists live in the milestone files** (`M0-P1`, …).

- **One milestone at a time.** M0 showed that deriving the next milestone plan, then implementing it, is the working loop. Preserve it: `write mN plan → accept → write std-mN QC (QC/README.md §4) → implement mN PRs to exit → run std-mN on merged main, record PASS/FAIL (QC/README.md §1–§2) → write m{N+1}`. Do not batch-write remaining `mN-*.md` files, and do not start `m{N}/*` code before that plan exists. Do not start `m{N}/*` code before its QC STD exists either — the STD traces every Must procedure to a story/NFR in the just-accepted plan, so writing it after code invites the STD to describe what shipped instead of what was promised. Do not declare `mN` complete on CI green alone — every Must procedure needs a PASS or an explicit WAIVE (owner + reason) in the STD's run log before the milestone is done and before `m{N+1}` is written.
- **Branch:** `m{N}/{short-slug}` off `main`. One concern per PR, as kickoff requires.
- **Merge:** design §10.1 gates 1–8. Not advisory. Occupancy and saga tests are required to merge any M4 booking-create PR.
- **PR description:** milestone PR id (`M0-P3`), story IDs (`BOK-001`) when any, design section if it implements a named mechanism (`§8.4`), test evidence.
- **No long-lived milestone branch.** `M4` is a label on a sequence of PRs, not a branch that accumulates the whole transaction slice.
- **Traceability:** changing which milestone owns a story is a master-plan edit, not a silent move inside `mN-*.md`.

---

## 7. Definition of Done (MVP)

The Plan is not done until these are true on `main`. Individual milestones have their own exit in §4.

- [ ] SC-1…SC-7 hold on the deployed commit.
- [ ] Every `P0` story in §5 is implemented or the MVP boundary was explicitly re-scoped (not silently dropped).
- [ ] Stretch is either shipped or recorded as cut.
- [ ] Design mechanisms exist as tests, not comments: ranking stub swap, occupancy overlap race, saga retry, provider `PENDING` DTO has no street, both-locale booking E2E.
- [ ] Secrets are not in the repo. Card data never touched Shearly logs.

M0 used a separate go-ahead (kickoff §7). Remaining milestones reuse the same gate at a smaller grain: the accepted `mN-*.md` file *is* the go-ahead for that increment only.

---

## 8. Post-MVP Roadmap (not scheduled here)

From vision §8, unchanged:

| Phase | Starts when | First work |
|---|---|---|
| **2** Intelligent | MVP live with outcome data | Conversational booking (A); swap `AgenticRanker` into the seam (B) |
| **3** Broaden & automate | Manual ops is the constraint | Nails/makeup; agentic ops behind the audit trail; RAG; auto-vetting |
| **4** Second market | First market liquid | Locale/currency/payout as config — the test of "market is configuration" |

RAG has no hook in M0–M5 beyond "do not design around it."

---

## 9. Open on This Breakdown

| # | Question | Default if you say nothing |
|---|---|---|
| **PQ-1** | Is M4 too large (book + money together)? | Keep together. Splitting would create unfunded bookings |
| **PQ-2** | Split M5 into Operate vs Polish? | No. One milestone; stretch and leftover P1 cut first |
| **PQ-3** | First production URL? | Preview from M0; named production URL by end of M3 so discovery is shareable |

---

## 10. Next Step

M0–M3 are shipped. [`m4-transaction.md`](./m4-transaction.md) and its QC pair [`std-m4-transaction.md`](../QC/std-m4-transaction.md) are written — accept the plan, then implement `M4-P1`…`M4-P9` to exit. Run the STD on merged `main` and record PASS/FAIL before writing M5. Do not pre-write M5.
