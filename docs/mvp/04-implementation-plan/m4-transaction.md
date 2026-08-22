# M4 — Transaction

**Milestone ID:** `M4`
**Master:** [04-implementation-plan.md](./04-implementation-plan.md) — §4 M4, §5 CUS-001 (mid-flow remainder) / CUS-006 / BOK-001…008 / PAY-001…004 / RAT-001
**Design:** `docs/mvp/03-design.md` §6.7 (mid-flow auth / guest drafts), §6.8 (address disclosure, NFR-SEC-005), §7 (booking state machine), §8 (payments and money)
**Requirements:** CUS-001 (remainder), CUS-006 (`P1`), BOK-001…008, PAY-001…004, RAT-001. NFRs: SEC-005, SEC-001 (already constrained by design), CI-004, PERF-003, OBS-001.
**Depends on:** M3 complete
**Unlocks:** M5 (notifications, poller, admin exception desk, full-demo polish)
**Status:** Not started

---

## 1. Traceability

This file may not add, drop, or move stories. The master map is the source of truth.

| Master claim | This plan |
|---|---|
| Goal: the loop that is the demo — book, fund, accept, complete, cancel, decline; money and occupancy correct under concurrency | §2 |
| Builds: `booking` + `payments`; §7.4 machine as a locked test fixture; GiST occupancy; §8.4 saga; mid-flow auth restoring the guest draft; address snapshot + provider DTO gate; customer history; review submit; provider accept/decline/complete/no-show; both cancel windows; earnings view. Capture, refund, split, ledger | PRs `M4-P1`…`M4-P9` |
| Stories: CUS-001 (remainder), CUS-006, BOK-001…008, PAY-001…004, RAT-001 | §1 table below |
| NFRs: SEC-005, SEC-001, CI-004, PERF-003, OBS-001 | Woven into the PRs that implement the mechanism they gate |
| Exit: concurrent slot race; both cancel windows; provider cancel refund; complete captures + splits; `PENDING` DTO has no street; both-locale E2E | §6 |
| Not in M4: email delivery, expiry job runner (frozen-clock test only), admin exception desk | §7 |

| ID | Pri | Coverage in M4 | Notes |
|---|---|---|---|
| CUS-001 | P0 | mid-flow auth: guest selects slot + address, authenticates, returns to the same state | Browse-without-account half shipped M3 |
| CUS-006 | P1 | booking history — upcoming/past, per-booking detail, review prompt on unreviewed `COMPLETED` | Read-only; no new write surface |
| BOK-001 | P0 | `POST /bookings` creates `PENDING` with snapshotted price; auth-or-setup per §8.1 window; slot held | The saga (§8.4) is this story's mechanism |
| BOK-002 | P0 | GiST exclusion constraint; concurrent-load test; "just taken" + alternatives | Design §7.3. Automated test required, not manual |
| BOK-003 | P0 | provider accept → `CONFIRMED`, capture scheduled; decline → `DECLINED`, full release; address reveal gated on state | NFR-SEC-005 DTO gate lives here |
| BOK-004 | P0 | response deadline = `min(response_window, slot_start)`; test via frozen clock, not a live poller | Poller itself is M5 |
| BOK-005 | P0 | customer cancel: `PENDING` full release; `CONFIRMED` >12h full refund; `CONFIRMED` ≤12h 50% capture/refund | `[D-3]` boundary tested at the exact hour, not around it |
| BOK-006 | P0 | provider cancel → full refund regardless of timing; standing event recorded; alternatives offered | No fee ever charged to provider here |
| BOK-007 | P0 | complete → capture + split; blocked before `slot_start`; auto-complete via `transition()` called with a frozen clock (no live poller in M4) | |
| BOK-008 | P1 | customer no-show → full capture + split; provider no-show → full refund + standing event | Dispute path is copy-only; OPS-003 admin reversal is M5 |
| PAY-001 | P0 | authorize/setup at create per `auth_horizon`; failure blocks booking creation; Stripe Elements only | Card data never touches Shearly (NFR-SEC-001) |
| PAY-002 | P0 | capture + 80/20 split on `COMPLETED`; gross/commission/net as separate persisted rows; idempotent retry | §8.3 ledger |
| PAY-003 | P0 | full/partial refund per table above; notified with amount; idempotent against retry | Escalation to ops (OPS-002) is M5's exceptions view; M4 just fails loud, not silent |
| PAY-004 | P0 | provider earnings view: per-booking gross/commission/net, pending vs paid-out balance | Payout trigger itself (OPS-005) is M5 |
| RAT-001 | P0 | review submit gated on `COMPLETED` + unreviewed; one review per booking; ties to `catalog.reviews.booking_id` | M3 had reviews without a `booking_id`; M4 closes that hole |
| NFR-SEC-005 | P0 | provider `PENDING` DTO has no street/access-notes; architecture test enforces it | Design §6.8 |
| NFR-SEC-001 | P0 | zero PCI surface; Stripe Elements + PaymentIntents/SetupIntents only | Design §8.1 |
| NFR-CI-004 | P0 | automated tests: BOK-002 concurrency, every terminal transition, both cancel windows, refund idempotency | Oracle is the §7.4 transition table |
| NFR-PERF-003 | P0 | booking submission completes or fails clearly within 5s p95 including authorization | Budget on `POST /bookings` |
| NFR-OBS-001 | P0 | every state transition and every payment operation emits a structured event | `booking.state_transitions` + `payments.operations` already are that log; OBS-001 is satisfied by writing them, not a separate pipe |

`booking` and `payments` remain the schema-isolated write-owners design §2.1/§8.4 requires. No shared transaction across them — consistency is the saga, not a superuser DB role.

---

## 2. Goal and demo

**Goal.** The loop that is the demo: book, fund, accept, complete, cancel, decline. Money and occupancy are correct under concurrency.

**Demo at exit.** In Hebrew, an anonymous visitor picks a slot on the F-LIVE provider from M3, is prompted to authenticate only at that point, registers, and lands back on the same slot and address — not the start. They confirm; a `PENDING` booking exists with a Stripe authorization and the slot is held. Two browser tabs submit overlapping-but-different-start slots simultaneously: exactly one wins, the other sees "just taken" with alternatives. The provider accepts; the booking becomes `CONFIRMED` and the provider now sees the customer's full address (never before). The provider marks it complete after the slot start; the booking becomes `COMPLETED`, the payment captures, and gross/commission/net post as three separate rows. Provider earnings show the ₪160 net on a ₪200 booking. A customer cancels a different `CONFIRMED` booking more than 12h out and is refunded in full; a second cancels one inside 12h and is charged 50%. A provider cancels a third booking and the customer is refunded in full with no fee to the provider. The customer rates the completed booking once; a second attempt is rejected. English repeats the same happy path in Playwright.

---

## 3. PR sequence

Branch per PR: `m4/{slug}` off `main`. Merge only when gates 1–8 are green. Occupancy and saga tests are **required** to merge any M4 booking-create PR (master §6).

```
M4-P1 booking schema + state machine + occupancy
    │
    ▼
M4-P2 payments schema + Stripe wiring (auth/setup, capture, refund)
    │
    ▼
M4-P3 booking↔payments saga: POST /bookings
    │
    ▼
M4-P4 provider actions: accept / decline / complete / no-show
    │
    ▼
M4-P5 customer actions: cancel + address disclosure gate
    │
    ▼
M4-P6 mid-flow auth + guest draft restore
    │
    ▼
M4-P7 booking history + review submit
    │
    ▼
M4-P8 provider earnings view
    │
    ▼
M4-P9 E2E both locales
```

Nothing is parallel. M0–M3 smokes must stay green throughout.

### Delivery (fill in as shipped)

| Plan ID | PR | Title | Merged |
|---|---|---|---|
| M4-P1 | | | |
| M4-P2 | | | |
| M4-P3 | | | |
| M4-P4 | | | |
| M4-P5 | | | |
| M4-P6 | | | |
| M4-P7 | | | |
| M4-P8 | | | |
| M4-P9 | | | |

### M4-P1 — Booking schema, state machine, occupancy

**Does**
- `booking` migration `001_booking.sql`: `booking.bookings` (`id`, `customer_id`, `provider_id`, `service_id`, `state`, price snapshot fields, `slot_start`, `slot_end`, full address snapshot + `access_notes` + `geography(Point)`, `response_deadline`, `auto_complete_at`, timestamps), `booking.state_transitions` (`booking_id`, `from_state`, `to_state`, `event`, `actor`, `reason`, `created_at`), `booking.reminders` (structure only — dispatch is M5).
- Occupancy column (`tstzrange`) + `EXCLUDE USING gist (provider_id WITH =, occupancy WITH &&) WHERE (state IN ('PENDING','CONFIRMED'))` exactly as design §7.3.
- Replace the `booking-state-machine` stub in `libs/domain/booking-state-machine` with the real, pure `transition()` per design §7.1, implementing the full §7.4 table verbatim as data (not scattered conditionals) — this table **is** the test fixture and the NFR-CI-004 oracle. Injected clock; actor-authorization guards; terminal states reject every event.
- Architecture test: `booking-state-machine` has zero imports outside `type:domain`.

**Tests.** Every row of §7.4 as a table-driven unit test (from-state × event × guard → to-state + effects). Terminal states reject all events. Time guards tested at the exact boundary (`slot_start - now === 12h` on both sides). Occupancy: two inserts with different, overlapping starts — one succeeds, one raises the exclusion violation. Terminal transition frees the interval in the same transaction (subsequent insert into the freed range succeeds).

**Out.** HTTP routes. Payments. UI.

### M4-P2 — Payments schema and Stripe wiring

**Does**
- `payments` migration extending M2's `connect_accounts`: `payments.operations` (`key` unique, `kind`, `state`, `result`, timestamps — the idempotency ledger from design §8.2), `payments.authorizations` (`booking_id`, `status` `SETUP_ONLY|AUTHORIZED`, `stripe_payment_intent_id` / `stripe_setup_intent_id`, `authorize_after`, `reauthorize_by`), `payments.ledger` (append-only: `booking_id`, `kind` `gross|commission|net`, `amount_minor`, `created_at` — design §8.3, never a mutable balance column).
- Stripe SDK wiring behind `contracts/payments`: `authorizeOrSetup(bookingAttemptId, amountMinor, slotStart)` implementing the §8.1 `auth_horizon` branch (manual-capture PaymentIntent inside the horizon, SetupIntent beyond it), `capture(bookingId)`, `refund(bookingId, pct, reason)`, `cancelAuthorization(bookingId)`. Each call keyed per design §8.2's deterministic key scheme (`authorize:{id}`, `setup:{id}`, `cancel:{id}`, `capture:{id}`, `refund:{id}:{reason}`).
- Stripe test-mode keys via `.env`; Stripe CLI (already in Compose per M0) forwards webhooks to `apps/api`. Webhook handler is signature-verified, idempotent by `event.id`, and is the **only** source of truth for payment-succeeded/failed state — never a client callback.
- `payments.operations` unique-key insert before every Stripe call; a retry with an existing key short-circuits to the stored result instead of calling Stripe again.

**Tests.** Authorize inside horizon creates a manual-capture PI; beyond horizon creates a SetupIntent instead — same caller, no branch leak into `booking`. Retry with the same `Idempotency-Key` returns the original result, does not call Stripe twice (mock the SDK client, assert call count). Capture/refund/cancel each idempotent against retry. Webhook signature rejection on tampered payload.

**Out.** Booking creation. UI. Payout trigger (OPS-005 is M5).

### M4-P3 — Booking↔payments saga: `POST /bookings`

**Does**
- `POST /bookings` in `apps/api`, requiring client `Idempotency-Key` (the `bookingAttemptId`, design §8.2). Implements the design §8.4 saga exactly: authorize/setup → on Stripe success, insert booking + occupancy in one `booking`-schema transaction → on exclusion violation, cancel the PaymentIntent and return `ConflictError` (BOK-002's "just taken") → orphan reconciler (a callable function, invoked by test with a frozen clock in M4; wired to the M5 poller loop later) cancels authorizations older than a short grace with no matching booking.
- Response on success: booking id, state, provider, time, address (customer's own), total charged, `response_deadline` (BOK-001's confirmation-screen contract).
- Response on conflict: `ConflictError` **plus** alternatives from the M3 discovery composer constrained to the same service/window (BOK-002's "alternative slots").
- `NFR-PERF-003` budget: authorize-or-setup + booking insert complete (or fail clearly) within 5s p95 in the integration test environment.

**Tests.** Two concurrent `POST /bookings` with overlapping-but-different starts on the same provider: exactly one 201, one 409 with alternatives (integration test against real Postgres, not a mock — this is the NFR-CI-004 concurrency requirement). Stripe authorize failure → no booking row, actionable error, no orphan PI left pending (mock Stripe failure path). Kill the process (simulate) between PI-confirm and booking-insert → reconciler cancels the orphan on next run. Unauthenticated `POST /bookings` is rejected (CUS-001 gate: authentication happens before this call, see M4-P6).

**Out.** Provider actions. Cancel. Mid-flow auth UI (P6 wires the client-side draft restore; this PR only requires the route to reject anonymous calls).

### M4-P4 — Provider actions: accept / decline / complete / no-show

**Does**
- `PATCH /bookings/:id/accept`, `/decline`, `/complete`, `/no-show` (provider-reported) in `apps/api`, each calling `transition()` then executing the returned effects via `contracts/payments` and `contracts/notifications` (stub notify — real dispatch is M5, but the call site exists so M5 only swaps the implementation).
- Actor authorization enforced in the domain (design §7.2.3): a customer token cannot reach `/accept`; cross-tenant (provider B acting on provider A's booking) is 403.
- `auto_complete_at` computed at `CONFIRMED` time (`slot_end + auto_complete_window`, config). The M4 test invokes `transition('CONFIRMED', 'AutoCompleteElapsed', { clock: frozenPastAutoComplete })` directly — no live poller runs in M4 (master §7 "Not in M4").
- Decline optional reason persisted (`booking.state_transitions.reason`), never surfaced to the customer verbatim.

**Tests.** Accept → `CONFIRMED`, capture scheduled (not yet captured — capture happens at complete per §7.4), full address now included in the provider DTO for this booking only. Decline → `DECLINED`, `ReleaseAuth` called, occupancy row gone, slot re-offered by discovery. Complete before `slot_start` → rejected. Complete after `slot_start` → `COMPLETED`, `Capture(100%)` + `Split` called once (idempotent retry test: calling complete's effect executor twice does not double-capture). Customer-reported vs provider-reported no-show hit the correct §7.4 row with correct financial effect. Provider cannot action another provider's booking (403).

**Out.** Customer cancel. UI beyond what's needed to exercise routes in tests.

### M4-P5 — Customer actions: cancel + address disclosure gate

**Does**
- `PATCH /bookings/:id/cancel` (customer-initiated), routing through `transition()` with the current state as guard input (`PENDING` → full release; `CONFIRMED` >12h → full refund; `CONFIRMED` ≤12h → 50%). The 50/50 split on late cancel posts through the same §8.3 ledger as completion.
- Response to the cancel **request** (before confirmation) states the exact financial consequence — full refund vs 50% charge — per BOK-005's "never disclosed only afterward." This is a `GET` (or dry-run) that reads current time against `slot_start`, returned to the client before it calls the mutating cancel endpoint.
- **NFR-SEC-005 DTO gate**, implemented once and reused by every provider-facing read (accept/decline screens in P4, schedule view in P8-adjacent UI): a shared `toProviderDTO(booking)` in `contracts/booking` returns `{ approxArea }` for `PENDING` and `{ fullAddress, accessNotes, point }` for `CONFIRMED`-or-later. **Architecture test:** a provider `PENDING` payload containing a street, postcode, or `access_notes` key fails CI (design §6.8, master exit criterion verbatim).
- List/search/discovery/availability/notification payload review: confirm none of M3's existing discovery or availability responses leak street-level fields now that `booking` has real addresses to leak.

**Tests.** Cancel dry-run at 12h+1min shows "full refund"; at 11h59m shows "50% charge" — boundary tested at the exact second via injected clock, not sleep. Actual cancel matches the dry-run's disclosed amount. `PENDING` cancel never charges regardless of how close to `slot_start`. Provider DTO test: fetch a `PENDING` booking as the assigned provider, assert response JSON has no `fullAddress`/`accessNotes`/street substring; fetch the same booking as `CONFIRMED`, assert it does. Cross-tenant: customer B cannot cancel customer A's booking (403).

**Out.** Mid-flow auth. Booking history UI.

### M4-P6 — Mid-flow auth and guest draft restore

**Does**
- Closes CUS-001's remainder. Guest draft (slot + address selection) persisted in the signed short-TTL cookie / `identity.guest_drafts` row already written by M1 (M1 exit note: "guest-draft cookie written, not yet consumed"). `apps/web` booking flow: anonymous visitor selects a slot and address on the M3 profile page, clicks confirm, is redirected to sign-in/register with the draft reference attached, and on successful auth is returned to a pre-filled confirm screen — not the discovery start.
- `POST /bookings` (M4-P3) is called only after authentication; the draft's slot/address are what gets submitted, read from the restored draft rather than re-entered.
- `libs/ui/feature-booking` gains the confirm screen, slot-taken/alternatives screen, and the cancel dry-run/confirm screens from P5.

**Tests.** Playwright: anonymous → pick slot → forced to auth → register → land on confirm screen with the same slot and address visible, not the discovery homepage. Draft expires after its TTL (test with a shortened TTL config) and the visitor is told to reselect, not silently dropped into a stale booking.

**Out.** Provider-side UI beyond what P4/P8 already need.

### M4-P7 — Booking history and review submit

**Does**
- `GET /account/me/bookings` (customer, own account only): upcoming (soonest-first) and past, separated, per CUS-006. Each entry: provider, service, price paid, address, time, state.
- `POST /bookings/:id/review` (RAT-001): allowed only when the booking is `COMPLETED` and has no existing review; inserts into `catalog.reviews` **with `booking_id`** (closing the M3 hole — see M3 §9 M3-Q5) via `contracts/provider-catalog`, and updates the stored `rating_sum`/`rating_count` aggregate in the same call `booking` already makes to catalog. Second review attempt on the same booking is rejected.
- `libs/ui/feature-account`: bookings list (upcoming/past), booking detail, review prompt surfaced once (dismissibly) on an unreviewed `COMPLETED` booking — no popup loop on every visit.

**Tests.** Upcoming/past split correct; sort order. Review on non-`COMPLETED` booking rejected. Duplicate review on same booking rejected. Review increments `rating_count`/`rating_sum` exactly once. Cross-tenant: customer B cannot see or review customer A's booking.

**Out.** Provider earnings. E2E.

### M4-P8 — Provider earnings view

**Does**
- `GET /provider/me/earnings` (PAY-004): per-booking gross/commission/net from the §8.3 ledger (never derived by summing at read time from raw booking rows — read the ledger). Pending balance (net entries not yet paid out) vs paid-out balance, clearly distinct. Commission rate stated explicitly (config value rendered, not implied).
- `libs/ui/feature-provider`: earnings screen. No payout-trigger button yet — manual payout (OPS-005) is M5; this PR is read-only.

**Tests.** Gross/commission/net sum correctly per booking (200/40/160 at the default 20% rate). Pending vs paid-out partition correct with zero payouts recorded (all pending). Provider A cannot read provider B's earnings.

**Out.** Payout trigger. Admin exceptions view (OPS-002 is M5).

### M4-P9 — E2E both locales

**Does**
- Playwright, both locales, API + web:
  1. Seed (API): F-LIVE provider from M3's pattern, approved + listed, Cut ₪200/60min.
  2. `/he`, anonymous: find provider, pick a slot, attempt confirm → forced to register → confirm screen retains the slot/address → confirm → `PENDING` with Stripe test-mode authorization.
  3. Two API-level concurrent `POST /bookings` on overlapping starts → assert one 201 / one 409-with-alternatives (this is the automated concurrency proof NFR-CI-004 requires; it does not need to run through the UI).
  4. Provider (API or admin/provider UI) accepts → `CONFIRMED`; assert full address now visible to provider, was not before.
  5. Advance clock past `slot_start` (frozen-clock helper, not real time) → provider completes → `COMPLETED`; assert capture + ledger rows; assert earnings screen shows the net.
  6. Customer reviews the completed booking; second review attempt rejected.
  7. `/en`: repeat the cancel-inside-12h and cancel-outside-12h flows against two fresh `CONFIRMED` bookings, assert the disclosed amount matches the charged/refunded amount.
- Keep M0 locale smoke, M1 auth smoke, M2 supply smoke, M3 demand smoke green.

**Out.** Nothing new — this is the closing E2E for the milestone, per master's "first *full* SC-1 E2E" note.

---

## 4. Layout at M4 exit

```
libs/domain/booking-state-machine/src/   # real transition() + §7.4 table as fixtures
libs/services/booking/migrations/001_booking.sql
libs/services/payments/migrations/002_payments_operations.sql
libs/contracts/booking/src/              # provider DTO gate (toProviderDTO), booking contract
libs/contracts/payments/src/             # authorizeOrSetup / capture / refund / cancelAuthorization
apps/api/src/booking-routes.ts           # POST /bookings, accept/decline/complete/no-show/cancel
apps/api/src/booking-saga.ts             # §8.4 saga orchestration
apps/api/src/webhooks-routes.ts          # Stripe webhook handler
libs/ui/feature-booking/src/             # confirm, slot-taken, cancel dry-run, provider actions
libs/ui/feature-account/src/             # booking history, review prompt
libs/ui/feature-provider/src/            # earnings screen
libs/ui/i18n/src/messages/{en,he}/booking.json
```

---

## 5. Local at M4 exit

```bash
pnpm install
cp -n .env.example .env
docker compose up -d      # Postgres+PostGIS, Mailhog, Stripe CLI, geocoder stub (all from M0/M3)
pnpm nx run api:migrate
stripe listen --forward-to localhost:3333/webhooks/stripe   # Stripe CLI, test-mode keys in .env
pnpm nx run-many -t serve -p web,api,admin
```

- web: `/he/providers/:id` → pick slot → confirm → forced auth → confirmed booking; `/en/account` bookings + review
- Stripe test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0341` (decline) via Stripe Elements test mode
- provider UI: accept/decline/complete under whatever surface P4/P8 land on (`apps/web` provider surface from M1, or `apps/admin` if provider actions are exposed there — confirm against current provider-surface routing before P4)

New env (defaults in schema):

```
AUTH_HORIZON_DAYS=6
BOOKING_RESPONSE_WINDOW_HOURS=2
AUTO_COMPLETE_WINDOW_HOURS=2
CANCEL_FULL_REFUND_HOURS=12
COMMISSION_RATE=0.20
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## 6. Exit checklist

- [ ] `POST /bookings` creates `PENDING` with snapshotted price; authorize-or-setup per `auth_horizon`; failure creates no booking (BOK-001, PAY-001)
- [ ] Two concurrent overlapping-start requests on the same provider: exactly one `PENDING`, one "just taken" with alternatives — proven by an automated concurrency test, not manual verification (BOK-002, NFR-CI-004)
- [ ] Terminal transition frees the occupancy interval immediately (BOK-002)
- [ ] Provider accept → `CONFIRMED`; decline → `DECLINED` with full release; slot re-offered (BOK-003)
- [ ] Provider `PENDING` payload has no street, postcode, or access-note key — architecture test enforces it (NFR-SEC-005)
- [ ] `CONFIRMED`-or-later provider payload includes full address and access notes (BOK-003, NFR-SEC-005)
- [ ] Response deadline is `min(response_window, slot_start)`; expiry tested via frozen clock (BOK-004)
- [ ] Customer cancel: `PENDING` always free; `CONFIRMED` >12h full refund; `CONFIRMED` ≤12h 50% — boundary tested at the exact hour; consequence disclosed before confirmation (BOK-005, `[D-3]`)
- [ ] Provider cancel always refunds 100% with no fee; standing event recorded (BOK-006)
- [ ] Complete blocked before `slot_start`; complete or auto-complete captures 100% and splits gross/commission/net as separate rows (BOK-007, PAY-002)
- [ ] Customer no-show captures full; provider no-show refunds full with a standing event (BOK-008)
- [ ] Card data never reaches Shearly servers/logs — Stripe Elements + PaymentIntents/SetupIntents only (PAY-001, NFR-SEC-001)
- [ ] Every payment operation (authorize, capture, refund, cancel) is idempotent against retry via the `payments.operations` ledger (PAY-002, PAY-003)
- [ ] Provider earnings view shows gross/commission/net per booking and separates pending vs paid-out balance (PAY-004)
- [ ] Review allowed only on `COMPLETED`, once per booking, tied to `booking_id` (RAT-001)
- [ ] Anonymous visitor can select a slot and address, is prompted to authenticate only at confirm, and returns to the same state afterward (CUS-001 remainder)
- [ ] Booking history separates upcoming/past; review prompt appears once on unreviewed completions (CUS-006)
- [ ] Hebrew and English each complete the full booking happy path in Playwright — the first *full* SC-1 E2E (NFR-CI-003, NFR-CI-004)
- [ ] Booking submission completes or fails clearly within 5s p95 (NFR-PERF-003)
- [ ] CI 1–8 green on every M4 PR

Master demo: "Visitor books, authenticates mid-flow, pays; provider accepts; money authorized then captured on complete."

---

## 7. Explicitly not M4

| Item | Belongs |
|---|---|
| Email delivery (real dispatch) — in-app state + logs are enough to see transitions | M5 |
| Live expiry/auto-complete poller — M4 calls `transition()` with a frozen clock in tests; the due-work poller loop is M5 (design §6.6) | M5 |
| Reminders (NOT-002) | M5 |
| Admin exception desk / OPS-002 dedicated failed-capture-and-refund view | M5 |
| Admin manual refund / no-show reversal (OPS-003) | M5 |
| Manual payout trigger (OPS-005) — earnings are visible, disbursement is not yet actionable | M5 |
| Provider standing thresholds crossing → flag for review (OPS-004) | M5 |
| Booking funnel observability dashboard (OPS-006) | M5 |
| RAT-003 provider review replies | M5 if slack |
| PAY-006 automated payout scheduling | M5 if slack |

Do not add a payout button or a live poller "just because" the ledger exists.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Saga leaves an orphan PaymentIntent if the process dies between steps 2 and 4 (design §8.4) | Reconciler function written and unit-tested with a frozen clock in M4; wired into the live poller loop in M5 — the mechanism, not the schedule, is the M4 deliverable |
| GiST exclusion constraint interacting badly with variable service duration + before/after buffer | Test explicitly with different, overlapping starts — not only identical `slot_start` (design §7.3 warns this is the case naive unique indexes miss) |
| `auth_horizon` off-session authorize (beyond-horizon path) is the least-exercised Stripe flow | Cover with an integration test using Stripe test-mode SetupIntent + a simulated off-session confirm; document as a named hole if Stripe test-mode cannot simulate the deferred leg locally |
| NFR-SEC-005 DTO leak via a payload nobody thought to check (e.g. notification templates, admin list view) | P5's review pass explicitly re-audits every existing M0–M3 response shape, not only new M4 ones; architecture test is the backstop, not the only check |
| Idempotency ledger unique-constraint race under retry storms | Integration test issuing the same `Idempotency-Key` concurrently, assert single Stripe call |
| Coverage gate on `booking-state-machine` (highest-coverage requirement in the codebase per NFR-CI-002) | Pure domain lib, no I/O; table-driven tests over the full §7.4 grid make near-100% coverage mechanical, not effortful |

---

## 9. Open on M4

| # | Question | Default if unanswered |
|---|---|---|
| **M4-Q1** | Where do provider accept/decline/complete actions live in the UI — `apps/web` provider surface or `apps/admin`? | `apps/web` provider surface (established since M1); `apps/admin` stays ops-only per design §2.1 |
| **M4-Q2** | Does the cancel dry-run need its own endpoint, or is it computed client-side from `slot_start` and a public policy constant? | Server-side dry-run endpoint — keeps the disclosed amount and the charged amount governed by the same clock and the same code path, so they cannot drift |
| **M4-Q3** | Auto-complete window and cancel-boundary hours — confirmed as requirements defaults? | Yes: `CANCEL_FULL_REFUND_HOURS=12` (`[D-3]`), `AUTO_COMPLETE_WINDOW_HOURS` and `BOOKING_RESPONSE_WINDOW_HOURS=2` (Q-1) as configuration, not literals |
| **M4-Q4** | Does M4 need a real off-session Stripe confirm for the beyond-`auth_horizon` path, or is a stubbed/mocked confirm acceptable given the 30-day discovery window makes this path rare in a demo? | Mocked in tests; document as a named hole for the deferred-authorize leg specifically (design §8.1's own fallback: shrink `auth_horizon` if this proves unreliable) |
| **M4-Q5** | Reviews without a `booking_id` inserted in M3 for display/testing (M3-Q5) — migrate or leave? | Leave M3's rows as-is (they predate the booking system); M4's `RAT-001` write path always sets `booking_id` going forward |

None changes the master cuts. Auto-accepted with these defaults.

---

## 10. Next

Accept this plan, then write `docs/mvp/QC/std-m4-transaction.md` before any `m4/*` code starts (QC/README.md §4; master §6). Implement `M4-P1`…`M4-P9` to exit. Run the STD on merged `main` and record PASS/FAIL before writing `m5-operate-and-bar.md` (master §6). Do not write M5 yet.
