# M5 — Operate & bar

**Milestone ID:** `M5`
**Master:** [04-implementation-plan.md](./04-implementation-plan.md) — §4 M5, §5 NOT-001…003 / OPS-002…006. Stretch: PAY-006, RAT-003
**Design:** `docs/mvp/03-design.md` §6.3 (async inter-service comms), §6.4 (event bus / outbox), §6.6 (due-work poller), §10.2 (E2E list), §10.3 (SES, named alarms)
**Requirements:** NOT-001 (`P0`), NOT-002 (`P1`), NOT-003 (`P0`), OPS-002 (`P0`), OPS-003 (`P0`), OPS-004 (`P1`), OPS-005 (`P0`), OPS-006 (`P1`). NFRs: I18N-005/006, A11Y-001…004, UX-002…005, OBS-002…004, CI-003. Stretch: PAY-006, RAT-003.
**Depends on:** M4 complete (STD PASS on merged `main`, recorded)
**Unlocks:** Nothing — M5 is the last milestone. MVP Definition of Done (master §7).
**Status:** Not started

---

## 1. Traceability

This file may not add, drop, or move stories. The master map is the source of truth.

| Master claim | This plan |
|---|---|
| Goal: founder can run the marketplace, time does the right thing without a request, a reviewer finishes the demo unaided in both locales | §2 |
| Builds: `notifications` + outbox consumers; SES (Mailhog locally); due-work poller (expiry, auto-complete, reminders, deferred authorize); OPS-002/003/005; standing (OPS-004); funnel from events (OPS-006); WCAG on the booking flow; empty/error/loading inventory; production alarms; stretch if slack | PRs `M5-P1`…`M5-P10` |
| Stories: NOT-001…003, OPS-002…006 | §1 table below |
| Stretch: PAY-006, RAT-003 | §3 M5-P10, only if slack after P1–P9 |
| NFRs: I18N-005/006, A11Y-001…004, UX-002…005, OBS-002…004, CI-003 | Woven into the PRs that implement the mechanism they gate; A11Y/UX get a dedicated pass (M5-P8) |
| Exit: unanswered `PENDING` → `EXPIRED` unattended, both parties emailed; admin retries a failed refund idempotently; a stranger completes SC-1 in Hebrew on a phone-width viewport unaided; CI 1–8 green | §6 |
| Not in M5: nothing — this is the last milestone. Whatever isn't shipped is either P1-cut (recorded, master §7) or stretch-cut | §7 |

| ID | Pri | Coverage in M5 | Notes |
|---|---|---|---|
| NOT-001 | P0 | Email on every one of the 9 state-transition/notification pairs the requirement enumerates; dispatched within 1 minute; locale-correct; failure never blocks or reverses the transition | The outbox (§6.4) + poller (§6.6) are the mechanism — this is the story that makes them real, not just plumbing |
| NOT-002 | P1 | Reminder before the `[D-3]` free-cancellation boundary for `CONFIRMED` bookings; a cancelled-before-window booking sends no reminder | `booking.reminders` table already exists (M4-P1) — this PR is the first thing that ever claims it |
| NOT-003 | P0 | Email is the MVP channel; both-locale templates with correct RTL; channel abstracted so SMS/push can be added without touching callers | The abstraction is the `Notify` effect's caller contract, already fixed by M4's `executeEffects()` call site |
| OPS-002 | P0 | Search bookings by customer/provider/state/date; full state history + linked payment records; failed capture/refund surfaced in a dedicated exceptions view; retry is idempotent | Ties directly to PAY-002/003's existing idempotency ledger — this is a read + retry-trigger UI over data that already exists |
| OPS-003 | P0 | Full/partial refund outside automatic rules, mandatory reason; reverse a disputed no-show outcome; every manual financial action attributed/timestamped/immutable | New `payments.manual_actions`-style audit trail; refund path reuses `AuthorizationService.refund()` |
| OPS-004 | P1 | Standing view: cancellation/no-show/expiry/response-rate/completion-rate counts; threshold crossing flags for review; admin can suspend/delist (removes from discovery, preserves existing confirmed bookings) | `booking.standing_events` already exists and is written (M4) — this is the first thing that ever reads it |
| OPS-005 | P0 | Manual payout trigger for positive pending balance, reflected in `PAY-004` earnings view, idempotent against repeat | `payments.payouts` table already exists (M4 migration) unused — this PR is the first writer |
| OPS-006 | P1 | Funnel counts discovery → profile view → slot selected → booking created → confirmed → completed; drop-off attributable per stage; payment failures/expiries/declines each separately visible | Needs new lightweight funnel-stage events beyond §6.4's core-events list (see §9 M5-Q3) |
| NFR-I18N-005 | P0 | Every flow required by SC-1…SC-3 verified in both locales | Existing Playwright suite extended, not rearchitected |
| NFR-I18N-006 | P1 | Notification/email templates render correctly in both locales | Part of NOT-003's own PR |
| NFR-A11Y-001…004 | P1/P1/P1/P2 | WCAG 2.1 AA on the core booking flow; full keyboard operability; semantic markup for screen readers; automated a11y checks in CI | Dedicated pass, M5-P8 |
| NFR-UX-002…005 | P0 each | Loading/error states with no dead ends; empty states with no blank regions; responsive 360px+; no placeholder/lorem/untranslated text reachable | Same pass as A11Y, M5-P8 — both are "make every screen actually finished" |
| NFR-OBS-002 | P0 | Errors captured with enough context to diagnose without reproducing | Structured logging on every thrown `AppError`, already partially true from M1–M4's error shapes |
| NFR-OBS-003 | P1 | OPS-006's funnel derivable from emitted events | Same event stream OPS-006 reads |
| NFR-OBS-004 | P1 | Payment failures/booking expiries/refund failures raise operator-visible alerts | Named alarms per design §10.3: capture failure, refund failure, expiry spike, orphan-auth reconciler action, SES bounce rate |
| NFR-CI-003 | P0 | E2E covers the full booking happy path in both locales | Already satisfied by M4-P9's `transaction-e2e.spec.ts` — M5 extends it to cover decline/expiry/cancel in both locales, per master's own note |
| PAY-006 | Stretch (P2) | Automated payout scheduling | Only if slack after P1–P9; cut clause already accepted: "payouts are triggered manually by admin (OPS-005)... only the disbursement cadence is manual" |
| RAT-003 | Stretch (P2) | Provider replies publicly to reviews | Only if slack; cut clause already accepted: "reviews remain one-directional" |

`notifications` becomes the last schema-isolated write-owner the design's build-order graph names (design §16 "flagged for implementation plan": notifications ships after payments). No new cross-schema transaction — the outbox is the mechanism, same as M4's saga was for booking↔payments.

---

## 2. Goal and demo

**Goal.** The founder can run the marketplace without a developer in the loop, time does the right thing without anyone clicking a button, and a stranger can complete the whole booking loop unaided in Hebrew on a phone.

**Demo at exit.** A `PENDING` booking's response deadline passes with no admin, no cron job triggered by hand, no page open — within a minute it is `EXPIRED`, the authorization is released, and both the customer and provider have an email in Mailhog (SES in prod) in their own locale. A `CONFIRMED` booking's reminder window arrives; both parties get a reminder email; a booking cancelled before that window never sends one. The founder opens `/admin/exceptions`, sees a booking whose refund failed, and retries it — the retry succeeds and is idempotent if clicked twice. The founder opens `/admin/bookings/:id`, sees the full state history and linked payment operations for a specific booking found by searching a customer's email. A provider who has cancelled three bookings in a week crosses a standing threshold and shows up flagged in `/admin/providers`; the founder suspends them and confirms they vanish from discovery while their one still-`CONFIRMED` booking stays untouched. The founder triggers a manual payout for a provider with a positive pending balance from `/admin/payouts`; the balance moves to paid-out and the provider's earnings view reflects it. The founder opens `/admin/funnel` and sees where visitors are dropping off between discovery and a completed booking, this week versus last. A screen reader can complete a booking end to end; every interactive control is reachable and operable by keyboard alone; automated axe-core checks pass in CI on the core flow. Every screen in both `apps/web` and `apps/admin` has a real loading state, a real empty state, and a real error state — nothing renders blank or shows an untranslated key. English and Hebrew both complete the full SC-1 path, including decline/expiry/cancel, unaided, on a 360px viewport.

---

## 3. PR sequence

Branch per PR: `m5/{slug}` off `main`. Merge only when gates 1–8 are green.

```
M5-P1 outbox schema + event bus (libs/shared/events, transactional outbox table)
    │
    ▼
M5-P2 due-work poller (claims booking/reminders/authorizations/payouts due rows)
    │
    ▼
M5-P3 notifications service: email channel (SES/Mailhog), both-locale templates
    │
    ▼
M5-P4 NOT-001 wired: every transition emits an event; poller-claimed expiry/auto-complete fire for real
    │
    ▼
M5-P5 NOT-002 reminders: booking.reminders claimed and sent
    │
    ▼
M5-P6 OPS-002 backend: search/detail/exceptions API + idempotent retry endpoint
    │
    ▼
M5-P6b OPS-002 apps/admin UI over the M5-P6 API (split out at P6 write time — see that section)
    │
    ▼
M5-P7 OPS-003 manual refund/no-show reversal + OPS-005 manual payout trigger
    │
    ▼
M5-P8 OPS-004 standing view + suspend/delist; OPS-006 funnel view
    │
    ▼
M5-P9 A11Y/UX pass + both-locale E2E extension (decline/expiry/cancel) + named alarms (OBS-004)
    │
    ▼
M5-P10 stretch: PAY-006 automated payouts, RAT-003 review replies (only if slack)
```

Nothing is parallel. M0–M4 smokes must stay green throughout.

### Delivery (fill in as shipped)

| Plan ID | PR | Title | Merged |
|---|---|---|---|
| M5-P1 | [#71](https://github.com/natank/shearly/pull/71) | Outbox schema + event bus | 2026-08-23 |
| M5-P2 | | | |
| M5-P3 | | | |
| M5-P4 | | | |
| M5-P5 | | | |
| M5-P6 | | | |
| M5-P6b | | | |
| M5-P7 | | | |
| M5-P8 | | | |
| M5-P9 | | | |
| M5-P10 | | | |

### M5-P1 — Outbox schema + event bus

**Does**
- `libs/shared/events` (currently a placeholder name export) gets a real typed event catalog matching design §6.4's core list: `BookingStateChanged`, `PaymentCaptured`, `PaymentRefunded`, `PayoutInitiated`, `ReviewSubmitted`, `ProviderApproved`, `AvailabilityChanged`, `PayoutAccountReady`, `BookingCompleted`.
- A new outbox table (schema TBD at write time — likely its own `events` schema, or colocated per-domain per design §6.2's isolation stance; do not decide here, decide when writing this PR against §6.2's existing pattern) with `id`, `type`, `payload`, `created_at`, `dispatched_at`, `attempts`.
- Events are written in the **same transaction** as the state change they describe (design §6.4) — this touches every write path that should emit one: booking transitions, payment captures/refunds, reviews, provider approval, availability changes, connect-ready.
- A polling dispatcher (in-process, same pattern as the poller M5-P2 builds) claims undispatched rows and calls registered handlers.

**Tests.** Writing a booking transition and a domain event happens atomically — a forced rollback after the state write leaves no orphan event row. Dispatcher claims once under concurrent pollers (`FOR UPDATE SKIP LOCKED`, same guarantee as booking's own occupancy work in M4). A handler throwing does not lose the event — retried on next poll, `attempts` increments.

**Out.** Any real event *consumer* (notifications, funnel). This PR is the write+dispatch mechanism only.

### M5-P2 — Due-work poller

**Does**
- The in-process poller design §6.6 describes and M4 left entirely unbuilt: claims `booking.bookings` (`PENDING` + `response_deadline <= now`; `CONFIRMED` + `auto_complete_at <= now`), `booking.reminders` (`CONFIRMED` + `remind_at <= now` + unsent — claimed only, sending is M5-P5), `payments.authorizations` (`SETUP_ONLY` + `authorize_after <= now`; `AUTHORIZED` + `reauthorize_by <= now`).
- **`payments.payouts` claiming deferred to M5-P7, decided at P2 write time:** the plan's original scope named it here, but no writer for `payments.payouts` exists yet (OPS-005/M5-P7 is that writer), there is no due-date column, and no automated payout cadence has been decided anywhere in the design or this plan — there is nothing to claim. M5-P7 adds the column, the writer, and the real claim logic together, once "due" has an actual definition.
- Also fixed at P2 write time: neither `auto_complete_at` (booking) nor `reauthorize_by` (authorization) was ever written by any existing code path — both columns existed since M4's migrations but nothing populated them. `auto_complete_at` is now set on the `ProviderAccepts` transition (`slot_end + AUTO_COMPLETE_WINDOW_HOURS`), the same pattern `response_deadline` already uses at booking-creation time. `reauthorize_by` stays unset — the deferred-authorize leg beyond `auth_horizon` is confirmed to stay a named hole per M4-Q4's own fallback (nothing produces a `SETUP_ONLY` row with a real `reauthorize_by` to claim in this environment); the poller still queries for it so M5+ Stripe test-mode work can wire it in later without touching the poller itself.
- One lock row per due item, `FOR UPDATE SKIP LOCKED` (same pattern as the outbox dispatcher — a shared "claim due work" helper, not two copies of the same locking code).
- Poll interval is configuration (`POLL_INTERVAL_MS` or similar); must stay inside NOT-001's one-minute bound.
- Runs claimed booking rows through `transition()` (`ResponseDeadlinePassed`, `AutoCompleteElapsed` — both already implemented and unit-tested in the state machine since M4, per M4's "no live poller in M4, frozen-clock tests only" note) and claimed authorization rows through the payments saga's deferred-authorize leg (design §8.1's beyond-`auth_horizon` path, mocked in M4 per M4-Q4 — confirmed above to stay a named hole in this PR).
- Failed runs increment attempts and surface on OPS-002 (M5-P6) — this PR only needs the failure to be visible in a queryable shape, not the admin UI itself yet.

**Tests.** A `PENDING` booking whose `response_deadline` has passed is claimed and transitions to `EXPIRED` with authorization released, without any request hitting the API. Two concurrent poller ticks racing the same due row: exactly one claims it (integration test against real Postgres, same rigor as M4's BOK-002 concurrency test). A poller tick that throws mid-transition leaves the booking in its pre-attempt state, not half-transitioned, and increments an attempt counter rather than silently dropping the row.

**Out.** Any notification dispatch (M5-P3/P4). Real off-session Stripe confirm beyond what M4-Q4 already scoped as a named hole. `payments.payouts` claiming (moved to M5-P7, see above).

### M5-P3 — Notifications service: email channel

**Does**
- `libs/services/notifications` (currently a placeholder) gets a real `EmailNotificationService` behind a channel-agnostic interface (design NOT-003: "abstracted so SMS or push can be added without changing callers").
- SES in prod, Mailhog locally — both speak SMTP, so this reuses the existing `SMTP_URL` config surface (design §10.3, confirmed no separate SES SDK config exists or is needed at MVP scope) rather than introducing a new provider-specific integration.
- Both-locale email templates (en/he, correct RTL per NFR-I18N-006) for every NOT-001 transition pair.
- Subscribes to the M5-P1 event bus — this is the event bus's first real consumer.

**Tests.** A registered handler for `BookingStateChanged` sends the correct template for the correct locale. RTL renders correctly in the Hebrew template (visual/structural assertion, not just that the string is Hebrew). Channel abstraction: swapping the transport (a fake channel in tests) requires no caller-side change — same contract test shape as M4-P2's Stripe-stub-mode pattern.

**Out.** Wiring every real transition to actually call this (M5-P4). Reminders specifically (M5-P5, different trigger shape).

### M5-P4 — NOT-001 wired: every transition notifies

**Does**
- `executeEffects()`'s `Notify` case (`apps/api/src/booking-effects.ts`, currently an explicit no-op with a comment pointing at this exact PR) gets its real implementation: publish the domain event, let M5-P3's notification service pick it up.
- Covers the full NOT-001 acceptance matrix: all 9 state-transition/notification pairs the requirement enumerates (booking created, accepted, declined, expired, cancelled by either party, completed, no-shown by either party — the exact list lives in requirements NOT-001, not restated here per this plan's no-reopening rule).
- Notification failure never blocks or reverses the state transition (design §6.3) — the event is already committed in the same transaction as the state change (M5-P1); a notification-send failure downstream is purely a delivery problem, never a data problem.

**Tests.** Every state machine transition that should notify does, checked against Mailhog in an integration test (real SMTP, not mocked, matching the rigor of M4's real-Stripe verification). A forced notification-send failure does not roll back or retry-block the already-committed state transition. Dispatched within the 1-minute bound under normal test conditions (sanity timing check, not a load test — same framing as M4-T18).

**Out.** Reminders (separate trigger shape, M5-P5).

### M5-P5 — NOT-002 reminders

**Does**
- The poller (M5-P2) claiming `booking.reminders` rows now actually sends something, via M5-P3's email service.
- Reminder timing respects the `[D-3]` free-cancellation boundary (requirements NOT-002) — arrives before that window closes where scheduling permits.
- A booking cancelled before its reminder window sends nothing — the claim query's own `sent_at IS NULL` guard plus a check that a cancelled booking's pending reminder rows are invalidated (not just skipped by timing luck).

**Tests.** A `CONFIRMED` booking's reminder fires once, at the right time, in the right locale, via the same frozen-clock-in-tests pattern M4 used for expiry/auto-complete (no live poller wait in CI). Cancelling before the reminder window results in zero reminder emails, confirmed against Mailhog.

**Out.** SMS/push channels (NOT-003 only requires the abstraction exists, not that non-email channels ship).

### M5-P6 — OPS-002 backend: search/detail/exceptions API + retry

**Split from the plan's original single P6, decided at write time:** OPS-002 bundles a search API, a detail API, an exceptions API, a retry endpoint, *and* three `apps/admin` screens over them — large enough that shipping it as one PR would make the diff hard to review and the failure surface hard to isolate. Every other M5 PR so far has shipped a complete, independently-testable backend slice; P6 keeps that shape by shipping the API + tests here and the UI as M5-P6b immediately after, rather than mixing both concerns in one review.

**Does**
- `GET /admin/bookings` — search by customer email, provider id, state, and date range (reuses `booking`'s existing tables, no new booking-side schema).
- `GET /admin/bookings/:id` — detail: full `booking.state_transitions` history + linked `payments.operations`/`payments.ledger` rows for that booking.
- `GET /admin/exceptions` — any `payments.operations` row in `failed` state (capture/refund failures specifically — the exact failure-surfacing OPS-002 requires).
- `POST /admin/exceptions/:key/retry` — retry a failed operation. Reuses the existing idempotent operation keys (PAY-002/003's `payments.operations` ledger, already built in M4) by re-invoking `AuthorizationService.capture()`/`refund()` with the same booking/amount/reason the failed row recorded — not a new payments mechanism, a retry-trigger over data that already exists correctly.

**Tests.** Searching by customer email/provider/state/date returns the right bookings. A booking detail view's API response matches state history and payment rows in the DB directly. A failed capture appears in the exceptions list; retrying it once succeeds; retrying the same failed operation twice is idempotent (no double-capture) — same idempotency guarantee class as M4's own capture/refund tests, exercised through the new admin-triggered path instead of the original saga path.

**Out.** The `apps/admin` UI itself (M5-P6b). Refund/no-show-reversal actions themselves (M5-P7 — this PR surfaces the exception, P7 gives the admin the tool to fix it).

### M5-P6b — OPS-002 apps/admin UI

**Does**
- Three `apps/admin` screens over M5-P6's API: a booking search view, a booking detail view (state history + payment rows), and an exceptions view with a retry button per failed operation — same `account?.role === 'admin'` gate and client-fetch-over-rewrite-proxy pattern the existing `/vetting` screen already establishes.

**Tests.** Same acceptance criteria as M5-P6's own test list, exercised through the UI rather than the API directly (Playwright): search returns matching results; opening a booking shows its history; a failed operation's retry button succeeds and the row updates.

**Out.** Nothing further — this closes out OPS-002.

### M5-P7 — OPS-003 manual refund/reversal + OPS-005 manual payout

**Does**
- Manual full/partial refund outside the automatic cancel-window rules, with a mandatory recorded reason — reuses `AuthorizationService.refund()` (built in M4, QCF-011 already fixed its status-tracking gap) rather than a new payment mechanism.
- Reverse a disputed no-show outcome (BOK-008) and adjust the financial result accordingly.
- Every manual financial action attributed to the acting admin, timestamped, immutable — a new audit table (`payments.manual_actions` or similar; exact shape decided at write time, following the same append-only pattern as `payments.ledger`).
- Manual payout trigger for a provider with a positive pending balance (`payments.payouts`, table already exists from M4, unused until this PR) — idempotent against a repeat trigger, reflected immediately in the M4-P8 earnings view's `paidOutMinor`. Also picks up the poller-claiming piece deferred here from M5-P2 (see that section): adds whatever due-date column and cadence this PR decides on, and wires it into the shared claim-due-work helper the poller already has.

**Tests.** A manual refund without a reason is rejected. A manual refund with a reason succeeds, is attributed/timestamped, and shows up in the booking's OPS-002 detail view. Reversing a no-show outcome correctly re-nets the financial result (money moves the opposite direction from the original no-show capture/refund). A manual payout moves the correct amount, is idempotent against a double-click, and the earnings view reflects `paidOutMinor` increasing by exactly that amount — direct extension of M4-P8's own `pendingMinor`/`paidOutMinor` split test.

**Out.** Automated payout scheduling (PAY-006, stretch, M5-P10 only if slack).

### M5-P8 — OPS-004 standing + OPS-006 funnel

**Does**
- Standing view (`apps/admin`): per-provider cancellation count, no-show count, expiry/response rate, completion rate — reads `booking.standing_events` (written since M4, never read until now) plus computed rates from `booking.bookings`/`booking.state_transitions`.
- Threshold-crossing flags a provider for review (config-driven thresholds, not hardcoded).
- Admin suspend/delist action: removes the provider from discovery (reuses catalog's existing `listed`/`status` fields, same mechanism M2's go-live/vetting already uses) while explicitly preserving any still-`CONFIRMED` booking for separate resolution (not silently cancelling in-flight commitments).
- Funnel view (`apps/admin`): discovery → profile view → slot selected → booking created → confirmed → completed, with per-stage drop-off and payment failures/expiries/declines each visible separately. Needs new lightweight funnel-stage events (page-view/UI-driven, not booking-state-driven — design §6.4's core-events list doesn't enumerate these; see §9 M5-Q3 for exactly what's new here) emitted into the same M5-P1 outbox mechanism.

**Tests.** A provider crossing the configured cancellation threshold is flagged; one below it is not. Suspending a provider removes them from a discovery search that previously found them, while their existing `CONFIRMED` booking is unaffected and still actionable via OPS-002. Funnel counts match a scripted sequence of discovery→booking events exactly (deterministic integration test, not a dashboard eyeball check).

**Out.** Automated (non-manual) delisting triggers — OPS-004 requirement is admin-actioned, not a bot.

### M5-P9 — A11Y/UX pass + both-locale E2E extension + alarms

**Does**
- WCAG 2.1 AA pass on the core booking flow (discovery, profile, slot selection, checkout, confirmation) — semantic markup, full keyboard operability, visible focus, accessible names.
- Automated a11y checks added to CI (axe-core or equivalent) against the core flow (NFR-A11Y-004).
- Loading/error/empty-state inventory across `apps/web` and `apps/admin` — every screen gets a real state for each, no dead ends, no blank regions (NFR-UX-002/003).
- Responsive check at 360px+ (NFR-UX-004); a sweep for placeholder/lorem/untranslated text in any reachable state (NFR-UX-005) — likely a scripted grep akin to the existing `check-hardcoded-strings.mjs`/`check-physical-styles.mjs`, extended or reused.
- Both-locale E2E extended beyond M4-P9's happy path to cover decline/expiry/cancel in both locales (master's explicit M5 note: "full path already started in M4; M5 adds decline/expiry/cancel in both locales").
- Named alarms wired (design §10.3, NFR-OBS-004): payment capture failure, refund failure, booking expiry spike, orphan-authorization reconciler action, SES bounce rate. Extraction-time equivalent is real CloudWatch/SNS or similar; MVP-local equivalent TBD at write time (likely log-based, consistent with "no paid dependency" pattern M2/M3 used for the geocoder).

**Tests.** Automated a11y check passes in CI on the core flow and fails the build if a violation is introduced (regression-proof, not just a one-time manual pass). Keyboard-only Playwright walkthrough completes a booking with no mouse events. Every screen inventoried has an automated test asserting its loading/error/empty state renders something real, not blank. Decline/expiry/cancel E2E passes in both `/en` and `/he`.

**Out.** A11Y-004's "P2" ceiling means this doesn't need to be exhaustive WCAG coverage of every admin screen — core booking flow is the bar, per the requirement's own scope.

### M5-P10 — Stretch: PAY-006 + RAT-003 (only if slack)

**Does**
- Only attempted if M5-P1…P9 land with time remaining. Cut order is already fixed (master, requirements §16): RAT-003 cuts before PAY-006, both cut before touching any P1 that's actually started.
- PAY-006: automated payout scheduling on top of M5-P7's manual trigger (same underlying mechanism, cron-like schedule via the M5-P2 poller's `payments.payouts` claim rule, already specified in design §6.6's due-work table).
- RAT-003: provider replies publicly to a review — extends `catalog.reviews` (M3/M4) with a reply field and a provider-facing UI affordance.

**Tests.** Same rigor as the rest of M5 if attempted — no reduced bar for stretch work that actually ships. If cut, no test debt: the cut is a scope decision, not an unfinished PR.

**Out (if cut).** Explicitly recorded as cut in the master's Definition of Done (master §7: "Stretch is either shipped or recorded as cut"), not silently dropped.

---

## 4. Layout at M5 exit

```
libs/shared/events/src/                  # real event catalog + outbox client (was a placeholder)
libs/services/notifications/src/         # EmailNotificationService, template rendering
libs/contracts/notifications/src/        # notification contract types
apps/api/src/poller.ts                   # due-work poller entrypoint (new)
apps/api/src/outbox-dispatcher.ts        # event dispatch loop (new)
apps/api/src/booking-effects.ts          # Notify case: real implementation (was a no-op)
apps/admin/app/[locale]/exceptions/      # OPS-002
apps/admin/app/[locale]/bookings/[id]/   # OPS-002 detail
apps/admin/app/[locale]/refunds/         # OPS-003 (or folded into bookings detail — decide at write time)
apps/admin/app/[locale]/payouts/         # OPS-005
apps/admin/app/[locale]/providers/       # OPS-004 standing + suspend
apps/admin/app/[locale]/funnel/          # OPS-006
libs/ui/i18n/src/messages/{en,he}/notifications.json
libs/ui/i18n/src/messages/{en,he}/admin.json  # or extend existing per-feature namespaces
```

---

## 5. Local at M5 exit

```bash
pnpm install
cp -n .env.example .env
docker compose up -d      # Postgres+PostGIS, Mailhog, Stripe CLI, geocoder stub (all from M0/M3/M4)
pnpm nx run api:migrate
stripe listen --forward-to localhost:3333/webhooks/stripe
pnpm nx run-many -t serve -p web,api,admin
```

- web: full booking loop in both locales, including expiry (wait for the poller or use whatever frozen-clock QC mechanism M5-P2 exposes — same pattern as M4's `m4-std-fixtures.md` documented for manual clock control)
- admin: `/admin/exceptions`, `/admin/bookings/:id`, `/admin/payouts`, `/admin/providers`, `/admin/funnel` — all gated the same way `/vetting` already is (`account?.role === 'admin'`)
- Mailhog at `localhost:8025` — every notification should land here in dev

New env (defaults in schema, exact names decided at write time):

```
POLL_INTERVAL_MS=<TBD, must stay well inside NOT-001's 60s bound>
REMINDER_WINDOW_HOURS=<TBD, must respect [D-3]>
STANDING_CANCEL_THRESHOLD=<TBD>
```

---

## 6. Exit checklist

- [ ] An unanswered `PENDING` booking becomes `EXPIRED` without any request — poller-driven, authorization released, both parties emailed (NOT-001, BOK-004)
- [ ] A `CONFIRMED` booking's reminder fires before the `[D-3]` boundary; a booking cancelled first sends none (NOT-002)
- [ ] Every NOT-001 transition pair notifies, in the recipient's locale, within 1 minute, without ever blocking or reversing the transition
- [ ] Admin can search bookings by customer/provider/state/date and see full state + payment history (OPS-002)
- [ ] A failed capture/refund is visible in a dedicated exceptions view and idempotently retryable (OPS-002)
- [ ] Admin can issue a manual full/partial refund with a mandatory reason, attributed and immutable (OPS-003)
- [ ] Admin can reverse a disputed no-show outcome with the financial result correctly re-netted (OPS-003)
- [ ] Admin can trigger a manual payout for a positive pending balance, idempotently, reflected in the earnings view (OPS-005)
- [ ] Standing view shows cancellation/no-show/expiry/completion rates per provider; threshold crossing flags for review; suspend/delist removes from discovery without touching existing `CONFIRMED` bookings (OPS-004)
- [ ] Funnel view shows discovery→completed drop-off per stage, with payment failures/expiries/declines each separately visible (OPS-006)
- [ ] Core booking flow passes WCAG 2.1 AA, is fully keyboard-operable, and passes automated a11y checks in CI (A11Y-001…004)
- [ ] No screen in `apps/web` or `apps/admin` has a dead-end loading state, a blank empty state, or reachable placeholder/lorem/untranslated text (UX-002…005)
- [ ] Responsive at 360px+ (UX-004)
- [ ] English and Hebrew both complete SC-1 including decline/expiry/cancel, unaided (I18N-005, CI-003)
- [ ] Named alarms fire on payment capture failure, refund failure, expiry spike, orphan-auth reconciler action, SES bounce rate (OBS-004)
- [ ] CI 1–8 green on every M5 PR
- [ ] Stretch (PAY-006, RAT-003) shipped or explicitly recorded as cut, not silently dropped

Master demo: "Notifications fire correctly, admin retries a refund, the whole thing looks and works finished in both languages."

---

## 7. Explicitly not M5

Nothing — M5 is the last milestone in the master plan. What isn't shipped by exit is either:

| Item | Disposition |
|---|---|
| PAY-006 (automated payouts) | Stretch — shipped if slack, else recorded cut per master's accepted cut clause (manual trigger via OPS-005 remains the real path) |
| RAT-003 (review replies) | Stretch — shipped if slack, else recorded cut per master's accepted cut clause (reviews stay one-directional) |
| Any P1 story with no PR started when time runs out | Cut in reverse epic priority per master's stated order: OPS-006, then OPS-004, then NOT-002 — never P0, never silently |
| Everything tagged `POST-MVP` anywhere in requirements | Out of scope for the entire MVP plan, not just M5 |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Outbox + poller are both genuinely new infrastructure (M4 built the tables but never a runner) — this is the largest net-new mechanism since M1's session/auth work | Sequence M5-P1/P2 first, before any consumer depends on them, so the plumbing is proven with its own tests before NOT-001/002 build on top |
| SES/Mailhog interface parity — design assumes the same SMTP surface works in both, unverified by any code yet | Confirm early in M5-P3 with a real Mailhog round-trip before assuming the abstraction holds for prod SES too |
| Deferred off-session Stripe authorize (design §8.1's beyond-`auth_horizon` leg) was mocked in M4 per M4-Q4's named hole | M5-P2 is the first place this could become real; if Stripe test-mode still can't simulate it locally, keep it a named hole rather than blocking the poller PR on an unrelated Stripe limitation |
| OPS-006 funnel needs event types the design's core-events list doesn't name (page-view-driven, not state-driven) | Flagged explicitly at M5-P1/P8 — extend the same outbox mechanism with new event types rather than inventing a second event system |
| A11Y/UX pass (M5-P9) touches every existing screen across three apps — largest-surface-area PR in the whole plan | Keep it last, after all new M5 screens exist, so it audits the final surface once instead of auditing twice |
| Manual financial actions (OPS-003) are the first place an admin can move money outside the automated saga/state-machine paths — a new class of write that must not bypass the same idempotency guarantees M4 built | Reuse `AuthorizationService.refund()`/`capture()` verbatim rather than a parallel "admin does it differently" code path; the audit table records the action, it does not replace the payment mechanism |

---

## 9. Open on M5

| # | Question | Default if unanswered |
|---|---|---|
| **M5-Q1** | ~~Outbox table location — its own `events` schema, or colocated per-domain?~~ **Resolved at M5-P1 write time, correcting this plan's own initial default:** per-domain (`booking.outbox`, `payments.outbox`, `catalog.outbox`, `availability.outbox`), one per schema that emits events. Design §6.2 is unconditional — "each service owns its schema and accesses only its own tables," enforced by Postgres grants, no exceptions anywhere in the existing schema (every M0–M4 table lives in its owning service's schema, zero shared tables). §6.4's "written in the same transaction as the state change" is only satisfiable if the outbox row lives in the same schema as the row it describes — a shared `events` schema would need a cross-schema write inside one transaction, which grant isolation forbids by construction. The dispatcher still reads from all outbox tables (a `UNION`-shaped poll, or one dispatcher instance per schema) — "one bus" describes the consumer-facing typed catalog (`libs/shared/events`), not a single physical table. | (superseded, see resolution) |
| **M5-Q2** | Exact SES integration shape in prod (SMTP relay vs SES API/SDK)? | SMTP relay, since design explicitly says "SES (Mailhog locally)" implying the same SMTP client works against both — revisit only if SES's SMTP interface proves insufficient for template/attachment needs |
| **M5-Q3** | OPS-006's funnel-stage events (page view, profile view, slot selected) — new event types on the existing outbox, or a separate lightweight analytics pipe? | Extend the existing outbox with new event types — one event system, not two, matching design's stated preference for one mechanism over parallel ones |
| **M5-Q4** | Standing thresholds (OPS-004) and reminder window (NOT-002) — exact numeric defaults? | Configuration, not literals, same pattern as M4's `CANCEL_FULL_REFUND_HOURS` — pick reasonable defaults at write time (e.g. 3 cancellations/week for standing, reminder at `[D-3]` boundary minus a buffer), document them in this file's §5 once decided |
| **M5-Q5** | Named alarms (design §10.3) — real CloudWatch/SNS at MVP, or log-based/local-only given "no paid dependency" precedent from M2/M3's geocoder stub? | Log-based/structured-log alarms locally, matching M2/M3's stub pattern; real CloudWatch/SNS is an extraction-time concern per design's own "not now" framing for anything beyond `desiredCount = 1` |

None changes the master cuts. Auto-accepted with these defaults; revisit only if a default proves wrong during implementation.

---

## 10. Next

Accept this plan, then write `docs/mvp/QC/std-m5-operate-and-bar.md` before any `m5/*` code starts (QC/README.md §4; master §6). Implement `M5-P1`…`M5-P10` to exit (P10 only if slack). Run the STD on merged `main` and record PASS/FAIL before declaring the MVP plan done (master §7 Definition of Done). This is the last milestone — there is no `m6` to write next.
