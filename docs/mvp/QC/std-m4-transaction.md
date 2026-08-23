# STD-M4 — Transaction

**Document ID:** `STD-M4`
**Milestone:** M4 Transaction
**Plan:** [m4-transaction.md](../04-implementation-plan/m4-transaction.md)
**Lab:** [lab.md](./lab.md)
**Depends on:** STD-M0, STD-M1, STD-M2, STD-M3 demo procedures still PASS
**Applies to:** `main` at or after the M4-P9 merge (fill in PR link when known)
**Est. time:** 120 minutes (money + concurrency procedures take longer than prior milestones)

---

## 1. Purpose

A visitor books a real slot, authenticates mid-flow, and pays. The provider accepts and later completes it; money is authorized then captured and split. Both cancel windows charge what they promise, and a concurrent double-booking attempt does not succeed. No email is checked here — that is M5's channel.

Master demo: "Visitor books, authenticates mid-flow, pays; provider accepts; money authorized then captured on complete."

---

## 2. Traceability

| Procedure | Pri | Stories / NFRs |
|---|---|---|
| M4-T01 | Must | CUS-001 — mid-flow auth, draft restore |
| M4-T02 | Must | BOK-001, PAY-001 — booking created `PENDING`, authorized not captured |
| M4-T03 | Must | BOK-002, NFR-CI-004 — concurrent overlapping slots, exactly one wins |
| M4-T04 | Must | BOK-003, NFR-SEC-005 — accept reveals full address; `PENDING` never did |
| M4-T05 | Must | BOK-003 — decline releases authorization, frees slot |
| M4-T06 | Must | BOK-005, `[D-3]` — customer cancel, full-refund window (>12h) |
| M4-T07 | Must | BOK-005, `[D-3]` — customer cancel, 50%-charge window (≤12h) |
| M4-T08 | Must | BOK-006 — provider cancel, always full refund, no fee |
| M4-T09 | Must | BOK-007, PAY-002 — complete captures and splits gross/commission/net |
| M4-T10 | Must | BOK-008 — customer no-show (full capture) and provider no-show (full refund) |
| M4-T11 | Must | PAY-004 — provider earnings view |
| M4-T12 | Must | RAT-001 — review once on `COMPLETED`, rejected twice |
| M4-T13 | Must | CUS-006 — booking history upcoming/past split |
| M4-T14 | Must | NFR-SEC-001 — no card data reaches Shearly servers or logs |
| M4-T15 | Must | PAY-003 — refund idempotency against retry |
| M4-T16 | Should | BOK-004 — response deadline expiry via frozen clock (no live poller in M4) |
| M4-T17 | Should | English chrome on the booking flow |
| M4-T18 | Should | NFR-PERF-003 — booking submission budget |

---

## 3. Fixtures

Reuse F-LIVE from STD-M3 (listed, approved Tel Aviv provider, Cut 60min ₪200, weekday 09:00–17:00). You need Stripe **test mode** keys configured locally (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) and `stripe listen` forwarding to the API per the M4 plan §5.

### F-LIVE2 — second listed provider (for T03 concurrency)

Not required if F-LIVE alone has two distinct bookable slots that can be raced against each other with different, overlapping starts (e.g. a 60-min service booked at `09:00` and `09:30`, whose occupancy ranges overlap once travel buffer is applied). Prefer racing the same provider — that is the actual invariant BOK-002 protects.

### F-CUST2 — second customer

`qc-m4-cust2-<date>@example.com` — used for cross-tenant checks and so T06/T07/T08/T10 do not collide on the same customer's booking list.

### Stripe test cards

| Card | Meaning |
|---|---|
| `4242 4242 4242 4242` | Authorizes and captures successfully |
| `4000 0000 0000 0341` | Attaches but fails on confirm — use for the "authorization fails, no booking created" path if you choose to test it manually (covered by automated tests per M4-P3; manual run is optional) |

### Clock control

M4 has no live expiry/auto-complete poller (design §6.6 poller ships in M5). T09's completion and T16's expiry must be exercised either:
- against a slot whose `slot_start`/`response_deadline` has already passed by the time you seed it (seed a booking in the past via API/SQL), or
- via whatever frozen-clock test harness endpoint the implementation exposes for QC (check M4-P4/P9 delivery notes for the exact mechanism before running T09/T16).

If neither exists, **WAIVE** T09/T16's manual run with reason "covered by automated frozen-clock unit/integration tests, no manual clock-control surface" and confirm the automated coverage exists in CI.

---

## 4. Reset

1. Confirm Stripe CLI is forwarding webhooks: `stripe listen --forward-to localhost:3333/webhooks/stripe` running, and the terminal shows events landing when you complete a booking.
2. Profile A (customer) must have no Shearly cookies at the start of T01.
3. If a prior run left `PENDING` bookings holding slots, cancel or let them age out via SQL before re-running T02/T03 against the same window.
4. Between T06 and T07 use **different** `CONFIRMED` bookings (one seeded >12h out, one ≤12h out) — do not reuse the same booking id.

---

## 5. Procedures

### M4-T01 — Mid-flow auth preserves the draft

**Pri:** Must
**Profiles:** A, cookies cleared
**Demo procedure.**

| Step | Action | Expected |
|---|---|---|
| 1 | `/he/providers/<F-LIVE-id>`, pick a slot and enter an address, click confirm | Redirected to sign-in/register, **not** an error |
| 2 | Register a new account | Landed back on a confirm screen showing the **same** slot and address — not the discovery homepage, not a blank booking form |
| 3 | Confirm | `PENDING` booking created (see T02) |

**Fail if** the slot or address must be re-entered after auth.

---

### M4-T02 — Booking created `PENDING`, authorized not captured

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Continue from T01, confirm with card `4242 4242 4242 4242` | 201 / success screen: state `PENDING`, provider, time, address, total charged, response deadline |
| 2 | Check Stripe test dashboard (or `stripe listen` log) | A PaymentIntent (or SetupIntent if the slot is beyond `auth_horizon`) exists in `requires_capture` (or `succeeded` setup) state — **not** captured |
| 3 | `GET` the booking (own account) | `state: PENDING`, price matches what was charged/authorized |

**Fail if** funds are captured immediately, or no authorization exists at all.

---

### M4-T03 — Concurrent booking safety

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | From two terminals/tabs, fire `POST /bookings` for the same provider at overlapping-but-different starts (e.g. `09:00` and `09:30` on a 60-min service) as close to simultaneously as you can | Exactly one 201, one 409 |
| 2 | Inspect the 409 response | Includes alternative slots, not a bare error |
| 3 | `GET` availability for that provider/day immediately after | The winning slot's occupancy is reflected; the losing request's slot is not double-held |

**Fail if** both succeed, or if the test only used identical `slot_start` values (that is not the invariant BOK-002 protects — overlapping *different* starts is).

---

### M4-T04 — Accept reveals address; `PENDING` never did

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | As the assigned provider, `GET` the `PENDING` booking from T02 | Response has **no** street, postcode, or access-notes field — approximate area only |
| 2 | Provider accepts | Booking becomes `CONFIRMED` |
| 3 | `GET` the same booking again as the provider | Now includes full street address and access notes |
| 4 | Repeat step 1's request shape against a fresh `PENDING` booking with a text search for the literal street string | Absent |

**Fail if** the street ever appears while `PENDING`, or never appears once `CONFIRMED`.

---

### M4-T05 — Decline releases and frees the slot

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Seed a fresh `PENDING` booking, provider declines | Booking becomes `DECLINED` |
| 2 | Check Stripe | Authorization released in full |
| 3 | `GET` availability for that slot | Slot is bookable again |

---

### M4-T06 — Customer cancel, full-refund window

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Seed a `CONFIRMED` booking with `slot_start` more than 12h out | — |
| 2 | Customer requests cancel (dry-run/consequence screen if present) | Disclosed consequence: **full refund** |
| 3 | Confirm cancel | State `CANCELLED_BY_CUSTOMER`; Stripe shows release or full refund; provider notified (state only — no email in M4) |

---

### M4-T07 — Customer cancel, 50%-charge window

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Seed a **different** `CONFIRMED` booking with `slot_start` ≤12h out (e.g. 6h) | — |
| 2 | Customer requests cancel | Disclosed consequence: **50% charge**, stated **before** confirmation |
| 3 | Confirm cancel | State `CANCELLED_BY_CUSTOMER`; Stripe/ledger shows 50% captured or refunded to match; disclosed amount equals charged amount exactly |

**Fail if** the disclosed amount and the actual charge differ, or if the boundary is off by more than the test's own tolerance around exactly 12h.

---

### M4-T08 — Provider cancel, always full refund

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Seed a `CONFIRMED` booking, any timing relative to `slot_start` | — |
| 2 | Provider cancels | State `CANCELLED_BY_PROVIDER`; customer refunded in full regardless of timing; **no fee** charged to provider |
| 3 | Check for a standing consequence record (even if no UI surfaces it yet) | Recorded — full OPS-004 surfacing is M5, but the record must exist |

---

### M4-T09 — Complete captures and splits

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Seed a `CONFIRMED` booking whose `slot_start` is already in the past (or use the frozen-clock QC mechanism — see §3) | — |
| 2 | Attempt to mark it complete **before** allowing `slot_start` to pass (if testable) | Rejected |
| 3 | Provider marks it complete once `slot_start` has passed | State `COMPLETED`; Stripe shows capture; ledger shows three rows: gross ₪200, commission ₪40, net ₪160 (at 20% default) |
| 4 | Repeat the complete action (idempotency) | No duplicate capture, no duplicate ledger rows |

If clock control is unavailable, **WAIVE** with the reason in §3 and confirm the equivalent automated test exists.

---

### M4-T10 — No-show handling

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Seed a `CONFIRMED` booking past `slot_start` | — |
| 2 | Provider reports customer no-show | State `NO_SHOW_CUSTOMER`; customer charged in full; provider earns in full |
| 3 | Seed a second `CONFIRMED` booking past `slot_start` | — |
| 4 | Customer reports provider no-show | State `NO_SHOW_PROVIDER`; customer refunded in full; standing record created for the provider |

---

### M4-T11 — Provider earnings view

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | As the provider from T09, open earnings | Per-booking gross ₪200 / commission ₪40 / net ₪160 listed |
| 2 | Check balance labels | Pending balance and paid-out balance shown distinctly (paid-out is ₪0 — no payout mechanism exists until M5) |
| 3 | As a second provider with no completed bookings | Balances show ₪0, not an error or blank crash |

---

### M4-T12 — Review once on completed

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | As the customer from T09, review the `COMPLETED` booking, rating 5, text `qc-m4` | Saved; provider's aggregate rating/review count updates |
| 2 | Attempt to review the same booking again | Rejected |
| 3 | Attempt to review a non-`COMPLETED` booking (e.g. the `CANCELLED_BY_CUSTOMER` one from T06) | Rejected |

---

### M4-T13 — Booking history

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | As the customer with multiple bookings from T02/T06/T07/T09, open booking history | Upcoming and past clearly separated; upcoming sorted soonest-first |
| 2 | Open the `COMPLETED` booking's detail | Provider, service, price paid, address, time, state all shown |
| 3 | As a second customer (F-CUST2) with no bookings | Empty state shown, not a crash or the first customer's data |

---

### M4-T14 — No card data reaches Shearly

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | During T02's confirm step, inspect network requests from the browser | Card entry posts directly to Stripe's hosted iframe/API, never to a Shearly-controlled endpoint |
| 2 | Grep API request logs (if accessible) for the test card number `4242424242424242` | Not present anywhere in logs |

---

### M4-T15 — Refund idempotency

**Pri:** Must

If a retry surface is exposed (even a test-only endpoint), fire the same refund operation twice with the same idempotency key.

**Expected.** Single refund recorded; second call returns the original result rather than issuing a second refund. If no manual retry surface exists, **WAIVE** — covered by the automated retry test in M4-P2/P5.

---

### M4-T16 — Response deadline expiry

**Pri:** Should

Using the frozen-clock QC mechanism (§3) or a `PENDING` booking seeded with a `response_deadline` already in the past, invoke whatever manually-triggerable path exists for `ResponseDeadlinePassed`.

**Expected.** State becomes `EXPIRED`; authorization released; slot freed. If no manual trigger exists (expected — the live poller is M5), **WAIVE** — covered by frozen-clock unit tests on `transition()`.

---

### M4-T17 — English booking chrome

**Pri:** Should

Repeat T01–T02's happy path on `/en`. Confirm screen, slot-taken screen, and cancel-consequence copy all render in English with `dir=ltr`.

---

### M4-T18 — Booking submission budget

**Pri:** Should

Time the confirm-to-response-screen interval in T02.

**Expected.** Completes (success or clear failure) well within 5s under normal local conditions. This is a sanity check, not a load test — NFR-PERF-003's p95 claim is validated by CI/automated timing, not this manual run.

---

## 6. Explicitly out of M4 QC

| Item | Belongs |
|---|---|
| Email delivery for any transition | M5 |
| Live expiry/auto-complete poller running unattended | M5 |
| Booking reminders | M5 |
| Admin exceptions view, manual refund/no-show reversal (OPS-002, OPS-003) | M5 |
| Manual or automated payout trigger (OPS-005, PAY-006) | M5 |
| Provider standing dashboard / delisting (OPS-004) | M5 |
| Booking funnel dashboard (OPS-006) | M5 |
| Real off-session authorize beyond `auth_horizon` in a live manual test | named hole — mocked in automated tests per M4 plan §9 M4-Q4 |

---

## 7. Run log

| Field | Value |
|---|---|
| Date | 2026-08-23 |
| Commit | `docs/m4-std-run` branch, on top of `main` @ `4d992cc` (M4-P9 + M4-P2 webhook fix), plus uncommitted-until-now Stripe Elements fix |
| Tester | natan.kamusher@gmail.com (assisted) |
| F-LIVE provider UUID | `609b16aa-437e-4280-85bf-2f0fec3b66c3` |
| Stripe mode | test (real, switched from stub mid-run — see `m4-std-fixtures.md` for detail) |
| Reset | `docker compose down -v` → `up -d` → migrated from scratch before this run started |

| ID | Pri | Verdict | Notes |
|---|---|---|---|
| M4-T01 | Must | PASS | First attempt landed on `/account` instead of the confirm screen post-register; retried and passed. Treated as a one-off client flake, not reproduced on retry — see fixtures doc findings log. |
| M4-T02 | Must | PASS | Found and fixed two real defects mid-run: (1) `POST /webhooks/stripe` was never mounted — fixed, merged as PR #64. (2) confirm screen hardcoded a fake `paymentMethodId`, rejected once real Stripe keys were wired in — fixed with real Stripe Elements (`payment-fields.tsx`), verified via curl-level card-collection flow (`stripe.createPaymentMethod` equivalent through direct Stripe API test-token calls), not yet through an actual browser click-through with a live `CardElement`. |
| M4-T03 | Must | PASS | Concurrent race on F-LIVE (16:00 vs 16:30, overlapping-different starts): exactly one 201, one 409 with populated `alternatives`. Winning slot's occupancy reflected in the public slots endpoint; losing slot remained free, no double-hold. Verified against the DB `booking.bookings` table directly. |
| M4-T04 | Must | PASS | No provider-facing UI exists (confirmed deliberate M4-P4 scope cut) — run via direct API calls. `PENDING` provider-view has no address fields; accept → `CONFIRMED`; `CONFIRMED` provider-view now includes `fullAddress`/`accessNotes`; a fresh `PENDING` booking's response full-text-searched for its street string — absent. |
| M4-T05 | Must | PASS | Original stub-mode fixture booking correctly rejected by real Stripe on decline (expected friction, not a bug) — retried against a freshly seeded real-Stripe booking. Decline → `DECLINED`; Stripe PI confirmed `canceled` directly against the Stripe API (though `payments.authorizations.status` locally stayed stale at `AUTHORIZED` — logged as a separate finding, not blocking). Slot bookable again. |
| M4-T06 | Must | PASS | Fresh real-Stripe `CONFIRMED` booking, slot ~34h out. Dry-run `no_charge`; confirmed cancel → `CANCELLED_BY_CUSTOMER`; Stripe PI confirmed `canceled`. |
| M4-T07 | Must | PASS | Fresh real-Stripe `CONFIRMED` booking, `slot_start` pushed to +6h via SQL. Dry-run `partial_charge`/50%, disclosed before confirmation; confirmed cancel → `CANCELLED_BY_CUSTOMER`; ledger (gross ₪100/commission ₪20/net ₪80) and the real Stripe PI's `amount_received: 10000` both match the disclosed 50% exactly. |
| M4-T08 | Must | **BLOCKED — real P0 defect found** | No route exists for provider-initiated cancel at all. `ProviderCancels` exists in the state machine but was never wired into `apps/api/src/booking-provider-routes.ts` (only accept/decline/complete/no-show/provider-view/earnings are mounted). BOK-006 is P0/Must, named explicitly in the master demo script and M4's own exit checklist — this is a real gap, not a QC environment issue. Cannot be manually exercised until a route exists. **This blocks M4 exit as currently scoped** — see `m4-std-fixtures.md` findings log for full detail. |
| M4-T09 | Must | PASS | Fresh real-Stripe `CONFIRMED` booking. Complete before `slot_start` → `409` (rejected). `slot_start` pushed to the past via SQL; complete → `COMPLETED`; ledger gross ₪200/commission ₪40/net ₪160 (exact default-20%-rate expected values); real Stripe PI confirmed `amount_received: 20000`. Repeat complete → `409` terminal-state guard (state machine itself blocks it, stronger than "double-execution is harmless" — no duplicate ledger rows, still exactly 3). |
| M4-T10 | Must | **PARTIAL — steps 1-2 PASS, steps 3-4 BLOCKED (same class of defect as T08)** | Steps 1-2 (customer no-show): fresh real-Stripe `CONFIRMED` booking (`7cd4b659-347b-4f27-9b04-455c39da7890`), `slot_start` pushed past; provider reports no-show → `NO_SHOW_CUSTOMER`; full capture confirmed (ledger + real Stripe `amount_received: 20000`). Steps 3-4 (provider no-show) **cannot be run**: `CustomerReportsProviderNoShow` exists in the state machine but, like `ProviderCancels` (T08), has no HTTP route anywhere in `apps/api/src/booking-routes.ts` — confirmed via grep, zero non-test matches. Half of BOK-008 is unreachable from the API. |
| M4-T11 | Must | | |
| M4-T12 | Must | | |
| M4-T13 | Must | | |
| M4-T14 | Must | | |
| M4-T15 | Must | | |
| M4-T16 | Should | | |
| M4-T17 | Should | | |
| M4-T18 | Should | | |

**Milestone QC:** FAIL (blocked on M4-T08 / BOK-006 — no provider-cancel route exists; run in progress otherwise)
