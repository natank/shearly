# M4 STD — Test Environment & Fixtures

Prepared for running [`std-m4-transaction.md`](./std-m4-transaction.md) against a freshly reset local stack.

**Prepared:** 2026-08-23
**Stripe mode:** **real test mode**, switched over mid-run at your request. `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are set in `.env` against your Stripe test account (`acct_1U4Ti2Io9Lm5593Y`), and `stripe listen --forward-to localhost:4000/webhooks/stripe` is running in the background (started 2026-08-23 09:31, PID may have changed if you restarted it). Real `pi_...`/`evt_...` IDs now, not `pi_stub_*`. §6 (below) is stale as of this switch — its "known deviations" no longer apply except where noted.
**Bookings created before the switch** (the T04–T10b fixtures in §3, all seeded before 09:31) are still stub-mode (`pi_stub_*` authorizations) — that's fine, they don't need real Stripe objects to exercise their specific STD procedures (accept/decline/cancel/complete/no-show all operate on `payments.authorizations`/`payments.ledger` rows regardless of stub-vs-real). Only bookings created **after** the switch get real Stripe PaymentIntents and trigger real webhook events.
**Mid-run fix #1:** T02 surfaced that `POST /webhooks/stripe` 404'd — the route was built (`handleStripeWebhook`, signature-verified, idempotent) but never mounted in `apps/api/src/app.ts`. Fixed in [PR #64](https://github.com/natank/shearly/pull/64) (branch `fix/m4-p2-stripe-webhook-route`), verified live (events now land `200` and appear in `payments.webhook_events`).
**Mid-run fix #2:** every booking confirm then failed `402 authorizationFailed` — `confirm.tsx` hardcoded `paymentMethodId: 'pm_card_default'`, not a real Stripe object; invisible in stub mode, rejected by real Stripe. Fixed on branch `fix/stripe-elements-booking-confirm` (rebased on top of the webhook fix, not yet a PR — still being verified live): a real `<CardElement>` (Stripe Elements) now mounts on the confirm screen once authenticated, `stripe.createPaymentMethod()` turns real card input into a real `pm_...` id, and `STRIPE_PUBLISHABLE_KEY`/`GET /payments/config` were added so the client can load Stripe.js. Falls back to a stub id when no publishable key is configured, so plain stub-mode dev still works.
**API and web were both rebuilt and restarted with these two fixes.** The running processes (`:4000` API, `:3000` web production build, `stripe listen` in the background) now reflect both. Next booking attempt through the UI should show a **real card-number input field** on the confirm screen (once authenticated) instead of the old address-only form silently sending a fake payment method — enter a Stripe test card (`4242 4242 4242 4242`, any future expiry, any CVC, any postal code) there.
**Password for every seeded account below:** `long-enough-password`

---

## 1. Environment status

| Component | State |
|---|---|
| Postgres (`shearly_postgres_1`) | Fresh (`docker compose down -v` then `up -d`), migrated from scratch |
| Mailhog | Up (`localhost:8025`) |
| Geocoder stub | Up (`localhost:3001`) |
| API | Running: `pnpm exec tsx apps/api/src/main.ts` → `http://localhost:4000` |
| Web | Running as a **production** build (`next build && next start`) → `http://localhost:3000`. Not `next dev` — dev/HMR mode showed unrelated flakiness during earlier E2E work; production mode matches what CI actually runs. |
| Admin | **Not started.** If you need it for T04/T08's standing-record check or general admin access, run `pnpm exec nx run admin:serve` (port 4300) yourself. |

To restart API/web later if they die:
```bash
cd /Users/nati-home/Projects/shearly
set -a; source .env; set +a
pnpm exec tsx apps/api/src/main.ts &         # from apps/api, or use nx run api:serve
cd apps/web && env -u NODE_ENV pnpm exec next start --port 3000 &
```
(`env -u NODE_ENV` matters — `.env` sets `NODE_ENV=development`, which breaks a production `next build`/`next start` if it leaks into the process env.)

---

## 2. Fixtures created

All fixtures were created via direct API calls (registration → document upload → submit → admin approve → profile/service/availability/connect-stub/go-live), the same path STD-M2/M3 use. Seed script: kept at `/private/tmp/claude-502/-Users-nati-home-Projects-shearly/fbd121d0-479a-4105-8b61-087aaaf49bf0/scratchpad/seed-m4-std.mjs` if you need to re-run it after another reset (`node seed-m4-std.mjs`, requires API up and migrated).

### F-LIVE — primary provider

| Field | Value |
|---|---|
| Email | `qc-m4-live-2026-08-23@example.com` |
| Provider ID | `609b16aa-437e-4280-85bf-2f0fec3b66c3` |
| Account ID | `7a0e4aae-5f26-4ab4-8be7-e41396ef2270` |
| Service ID (Cut, 60min, ₪200) | `8f054f26-7dfa-4e87-a653-0cc23439b78f` |
| Display name | QC Cut Tel Aviv M4 |
| Point | 32.0853, 34.7818 (Tel Aviv) |
| Status | approved, listed, connect stub-complete |

### F-LIVE2 — second provider (T10's provider no-show, kept off F-LIVE's slot grid)

| Field | Value |
|---|---|
| Email | `qc-m4-live2-2026-08-23@example.com` |
| Provider ID | `700431ad-b55e-4c53-9382-824751ec9a2a` |
| Service ID | `d4db42f7-1d13-437f-9846-655be5ceaf47` |

### F-CUST1 — primary customer (owns T04–T10's bookings)

| Field | Value |
|---|---|
| Email | `qc-m4-cust1-2026-08-23@example.com` |
| Locale | he |

### F-CUST2 — second customer (cross-tenant checks, T11/T13)

| Field | Value |
|---|---|
| Email | `qc-m4-cust2-2026-08-23@example.com` |
| Locale | en |

### Admin

| Field | Value |
|---|---|
| Email | `admin@shearly.local` |
| Password | `change-me-admin-10` |

---

## 3. Seeded bookings

All bookings are F-CUST1 → F-LIVE (except T10b, which is F-CUST1 → F-LIVE2), slot 2 days out, 60 min, ₪200. Addresses are distinct per booking so you can visually confirm which one you're looking at in any list/detail view.

| For | Booking ID | State now | `slot_start` (UTC) | Address | Notes |
|---|---|---|---|---|---|
| **T04** (accept reveals address) | `c58cd5ae-dbab-4c55-ba06-0d276ed9799b` | `PENDING` | 2026-08-25 09:00 | QC T04 Street 1, Tel Aviv | Left `PENDING` on purpose — T04 step 1 needs to see the pre-accept DTO gate |
| **T05** (decline frees slot) | `990b9490-5321-44da-b200-c4df119c3e02` | `PENDING` | 2026-08-25 10:00 | QC T05 Street 2, Tel Aviv | Left `PENDING` — you decline it live |
| **T06** (cancel, full refund, >12h) | `5d2337d0-aee8-4d73-a60c-f342006a2752` | `CONFIRMED` | 2026-08-25 11:00 | QC T06 Street 3, Tel Aviv | Already >12h out — no SQL needed, cancel it as-is |
| **T07** (cancel, 50% charge, ≤12h) | `d89fdb51-9d00-431e-ac74-18691e33a1b5` | `CONFIRMED` | 2026-08-25 12:00 | QC T07 Street 4, Tel Aviv | **Needs the SQL in §4 before testing** — push `slot_start` to ~6h out |
| **T08** (provider cancel, always full refund) | `f220124e-810a-4040-8bba-191f33ecfe2f` | `CONFIRMED` | 2026-08-25 13:00 | QC T08 Street 5, Tel Aviv | Any timing works per the STD — no SQL needed |
| **T09** (complete → capture + split) | `529b59dd-0c2d-4f95-8c80-a902ea9dac42` | `CONFIRMED` | 2026-08-25 14:00 | QC T09 Street 6, Tel Aviv | Step 2 ("complete before slot_start passes → rejected") works right now since it's still 2 days out. **Run the SQL in §4 before step 3.** |
| **T10a** (customer no-show) | `8b2c6514-7d81-4fb4-b14e-9910a825edee` | `CONFIRMED` | 2026-08-25 15:00 | QC T10a Street 7, Tel Aviv | **Needs the SQL in §4** to push `slot_start` into the past first |
| **T10b** (provider no-show, on F-LIVE2) | `e0864212-a8d4-4742-b53b-fa91b72517c7` | `CONFIRMED` | 2026-08-25 09:00 | QC T10b Street 8, Tel Aviv | **Needs the SQL in §4** to push `slot_start` into the past first |

**Not pre-seeded:**
- **T01/T02/T17** — these are the mid-flow-auth demo procedures themselves; run them live starting from a clean-cookie browser profile against F-LIVE, don't reuse a pre-made booking.
- **T03** (concurrency) — fire the two overlapping `POST /bookings` yourself against F-LIVE at runtime (any two fresh, un-taken slots, e.g. `2026-08-25T16:00:00Z` and `2026-08-25T16:30:00Z`), so the race is real.
- **T11/T12/T13** reuse T09's booking once it's `COMPLETED` — no separate seed needed.
- **T15/T16/T18** — no dedicated fixture; T15/T16 are likely WAIVE per the STD's own guidance (no manual retry/clock-trigger surface exists), T18 is just a stopwatch on T02.

---

## 4. SQL you'll run yourself at test time

Clock control (§3 of the STD): no live poller in M4, so `slot_start` must be pushed by hand immediately before the step that depends on it. Run via:

```bash
docker exec shearly_postgres_1 psql -U shearly -d shearly -c "<query>"
```

**Before T07** (50%-charge window — needs `slot_start` ≤12h out):
```sql
UPDATE booking.bookings SET slot_start = now() + interval '6 hours' WHERE id = 'd89fdb51-9d00-431e-ac74-18691e33a1b5';
```

**Before T09 step 3** (complete — needs `slot_start` in the past):
```sql
UPDATE booking.bookings SET slot_start = now() - interval '1 hour' WHERE id = '529b59dd-0c2d-4f95-8c80-a902ea9dac42';
```

**Before T10 step 2** (customer no-show — needs `slot_start` in the past):
```sql
UPDATE booking.bookings SET slot_start = now() - interval '1 hour' WHERE id = '8b2c6514-7d81-4fb4-b14e-9910a825edee';
```

**Before T10 step 4** (provider no-show — needs `slot_start` in the past):
```sql
UPDATE booking.bookings SET slot_start = now() - interval '1 hour' WHERE id = 'e0864212-a8d4-4742-b53b-fa91b72517c7';
```

Verify current booking states any time:
```sql
SELECT id, state, slot_start, address_line FROM booking.bookings ORDER BY created_at;
```

Verify ledger rows after a capture/split (T09, T10a):
```sql
SELECT booking_id, kind, amount_minor FROM payments.ledger ORDER BY created_at;
```

Verify standing-event records (T08, T10 step 4):
```sql
SELECT * FROM booking.standing_events ORDER BY created_at;
```

---

## 5. Signing in as each fixture account in the browser

The seed script only captured session cookies for API calls — for browser-driven steps (T01, T04 provider view via UI if you use one, T11 earnings screen, T12 review, T13 history), sign in normally at `http://localhost:3000/{he|en}/sign-in`:

| Role | Email | Password |
|---|---|---|
| F-LIVE provider | `qc-m4-live-2026-08-23@example.com` | `long-enough-password` |
| F-LIVE2 provider | `qc-m4-live2-2026-08-23@example.com` | `long-enough-password` |
| F-CUST1 | `qc-m4-cust1-2026-08-23@example.com` | `long-enough-password` |
| F-CUST2 | `qc-m4-cust2-2026-08-23@example.com` | `long-enough-password` |
| Admin | `admin@shearly.local` | `change-me-admin-10` |

For **T01**, use a private/incognito window (or `Clear site data` for `localhost:3000`/`localhost:4000`) so Profile A genuinely starts with no Shearly cookies, per the STD's reset checklist.

---

## 6. Known deviations from the STD as written

**Superseded — Stripe is now in real test mode (see banner at top).** Kept below for the record, since T02 was actually run once in stub mode before the switch.

- ~~Stripe stub mode~~ — no longer applies to anything booked from 2026-08-23 09:31 onward. For **T02 step 2** now: check the real Stripe test-mode dashboard (dashboard.stripe.com, test mode, account `acct_1U4Ti2Io9Lm5593Y`) for a PaymentIntent in `requires_capture`, or equivalently `SELECT * FROM payments.authorizations WHERE booking_id = '<id>'` — `stripe_payment_intent_id` should now start `pi_` (no `_stub_`). For **T14 step 1**: the booking form still posts a `paymentMethodId` string (this build doesn't wire a live Stripe Elements card-input iframe), so there's still no literal card-number field to watch post to Stripe's own domain — but the PaymentIntent created behind that call is now a real Stripe object, and `stripe listen`'s own log is a legitimate way to observe "Shearly's server talked to Stripe, not the browser directly." T14 step 2 (grep API logs for `4242424242424242`) still fully applies either way.
- **T03 needs slots you pick at test time.** I didn't pre-fire the concurrent request pair, since the point of T03 is racing two live requests yourself (or via a small script) — freezing a "result" in advance would defeat the test. Suggested pair: `2026-08-25T16:00:00Z` and `2026-08-25T16:30:00Z` against F-LIVE (`609b16aa-437e-4280-85bf-2f0fec3b66c3`) / service `8f054f26-7dfa-4e87-a653-0cc23439b78f`, both as F-CUST2 (so they don't collide with F-CUST1's other bookings).

---

## 7. Mid-run findings log

| When | What | Disposition |
|---|---|---|
| T01, first attempt | Landed on `/account` instead of the confirm screen after registering | Retried, passed on retry. Traced source/build/API — all correct. Treated as a one-off client-side flake per your call; watch for recurrence, especially on T17's English repeat. |
| T02 step 2 | `stripe listen` showed every forwarded webhook 404ing — `POST /webhooks/stripe` was never mounted despite `handleStripeWebhook()` being fully built and unit-tested | Real defect against M4-P2. Fixed in [PR #64](https://github.com/natank/shearly/pull/64), verified live (events now `200`, land in `payments.webhook_events`). API restarted with the fix. |
| T01/T02, post-auth confirm screen | After landing back on the confirm screen authenticated, the guest-draft address (`tel aviv`) is restored into component state (`choice.addressLine`). Initial concern: no visible affordance when the address book is empty (first-ever booking) — the "Add a new address" form shows blank, reading as though re-entry is required. **Resolved/downgraded on later observation:** once a saved address exists (e.g. after saving "Home — Tel Aviv" once), it renders correctly as a pre-checked radio option on return visits. So the gap is narrower than first thought — only the very first, no-saved-address-yet pass lacks a visible "your restored address is already selected" cue. | **UI-only bug, logged, not fixed yet.** `libs/ui/feature-booking/src/confirm.tsx`. Not blocking for M4 exit (CUS-001's literal requirement — slot/address not lost, no re-entry required — is technically satisfied; this is a first-run discoverability gap only). File as a follow-up fix after this QC run. |
| Product note (not a defect) | You raised whether the address should move out of the confirm screen entirely and into the sign-in/register step, so there's one address prompt instead of two (draft capture → later formalize into a saved address). Reasonable UX simplification, but a bigger change: touches CUS-001's mid-flow-auth design and the CUS-005 address-book contract (would sign-in/register need an address field even for repeat customers just browsing? auto-save first booking's address under what label?). | Logged as a product/design suggestion for a future milestone, not implemented now — needs proper scoping, not an improvised mid-QC change. |
| T02, after switching to real Stripe keys | Every booking attempt failed: `402 {"error":"PAYMENT","translationKey":"errors.payments.authorizationFailed"}`, UI showed "We could not complete this booking. Try again." Root cause: `libs/ui/feature-booking/src/confirm.tsx:152` hardcoded `paymentMethodId: 'pm_card_default'` — not a real Stripe object. Invisible in stub mode (no real Stripe call ever validated it); Stripe test mode correctly rejected it. | **Real defect against PAY-001/NFR-SEC-001** — design §8.1/§13 decision #10 requires real Stripe Elements card collection; it was never built. **Fixed** on `fix/stripe-elements-booking-confirm` (rebased on the webhook fix): `GET /payments/config` exposes the publishable key, `payment-fields.tsx` mounts a real `<CardElement>` and turns entered card data into a real `pm_...` id via `stripe.createPaymentMethod()`, sent as the same `paymentMethodId` field the server already accepted — no server contract changes needed. Falls back to a stub id when no publishable key is configured. Verified: `pnpm exec vitest run` (api + feature-booking) green, `next build` clean, `payments/config` reachable through both the bare API and the `/api` proxy. **Not yet verified through an actual browser click-through with a real test card — that's the next step, back to you.** |
| T04 | No provider-facing UI exists to view/accept/decline/complete a booking. Confirmed this is a deliberate M4-P4 scope cut ("UI beyond what's needed to exercise routes in tests"), not a bug — `apps/web`'s provider surface only has application/profile/services/availability/go-live/earnings. | **Known gap, not a defect for M4 exit.** T04 (and every subsequent provider-action procedure: T05, T08–T10) run against the API directly (`curl` + session cookie) instead of clicking through a UI. Worth a product note for M5 (or later) if a real provider-facing "my bookings" queue is wanted. |
| T05 step 1, first attempt | Declining T05's original fixture booking (`990b9490...`, seeded in stub mode before the Stripe switch) failed `402 cancelFailed` — its `payments.authorizations` row holds a fake `pi_stub_authorize:...` id, which real Stripe correctly rejects on cancel. | Not a new bug — expected mode-mismatch friction from fixtures seeded before the stub→real switch (already flagged in the banner at the top of this doc). Worked around by minting a fresh real Stripe payment method (`POST /v1/payment_methods` with `card[token]=tok_visa`) and creating a brand-new `PENDING` booking (`d920487a-5818-40e3-8aad-74ce712af8e7`) to decline instead. Retried and passed (`200 DECLINED`). |
| T05 step 2 | Real Stripe confirms the PaymentIntent (`pi_3U7YERIo9Lm5593Y28KvSPFa`) is `canceled` after decline — money-correct. But `payments.authorizations.status` in our own DB **still reads `AUTHORIZED`**, not updated to reflect the cancel. **Audited the sibling methods**: `capture()` (`authorization-service.ts:235-264`) and `refund()` (`:268-292`) have the identical pattern — each calls the real Stripe operation and records success in `payments.operations` (the idempotency ledger), but **none of `cancelAuthorization`/`capture`/`refund` ever `UPDATE`s `payments.authorizations.status`**. It's set once at `authorize`/`setup` time and never touched again. | **Real defect, systemic across all three effect methods, data-integrity only — not a financial-correctness issue** (the actual Stripe-side operations are correct in all cases, confirmed directly against the Stripe API for cancel). Logged, not fixed inline per your call. Impact: `payments.authorizations.status` is misleading for any booking past its first payment operation — always shows `AUTHORIZED` regardless of whether it was later captured, refunded, or cancelled. A future reader (e.g. an M5 admin exceptions view, or anyone debugging via this table) needs `payments.operations`/`payments.ledger` to get the real picture instead. Worth a follow-up fix: have `cancelAuthorization`, `capture`, and `refund` each update the local `status` column alongside their respective Stripe call. |
| T06 | Ran clean against a fresh real-Stripe `CONFIRMED` booking (`4d4b2d36-a2f8-43ee-8686-27eab061b8b8`, slot ~34h out). Dry-run `no_charge`, confirmed cancel → `CANCELLED_BY_CUSTOMER`, Stripe PI `pi_3U7YR8Io9Lm5593Y3YWb5GZU` confirmed `canceled`. | **PASS, all 3 steps, no findings.** |
| T07 | Ran clean against a fresh real-Stripe `CONFIRMED` booking (`fa99dbfa-0679-4e53-ad96-309bb0515c5d`), `slot_start` pushed to +6h via SQL. Dry-run `partial_charge`/50%, confirmed cancel → `CANCELLED_BY_CUSTOMER`. Ledger shows gross ₪100/commission ₪20/net ₪80 (50% of the ₪200 total); real Stripe PI `pi_3U7YSOIo9Lm5593Y0KFN5PnH` confirms `amount_received: 10000` (₪100) — disclosed amount matches the actual charge exactly. | **PASS, all 3 steps, no findings.** |
| T08, step 1 | No route exists for provider-initiated cancel at all. `ProviderCancels` is a real event in the state machine (`libs/domain/booking-state-machine/src/index.ts`), but `apps/api/src/booking-provider-routes.ts` only wires `accept`/`decline`/`complete`/`no-show`/`provider-view`/`earnings` — no `PATCH /bookings/:id/cancel` (provider-initiated) or equivalent. Confirmed via `grep -rn "ProviderCancels" apps/api/src/*.ts` — zero non-test matches. | **Real, significant defect — BOK-006 is P0/Must, explicitly named in the master demo script** ("A provider cancels a third booking and the customer is refunded in full with no fee to the provider") **and in M4's own exit checklist**, yet the whole capability was silently never wired to HTTP. Logged per your call to skip-and-continue rather than fix inline. **T08 is BLOCKED, not run** — there is no way to exercise it manually until a route exists. File as a P0 follow-up fix before M4 can be considered actually exited (this isn't a nice-to-have polish item — it's a stated Must in both the plan and the demo script). |
| T09 | Ran clean end-to-end against a fresh real-Stripe `CONFIRMED` booking (`8a342082-1e63-490f-acdb-36afe84f17ec`). Complete-before-`slot_start` correctly `409`s; after pushing the clock, complete succeeds with a full real Stripe capture (`amount_received: 20000`) and exact ledger split (gross ₪200/commission ₪40/net ₪160); a second complete attempt is rejected by the state machine's own terminal-state guard before the effect executor can even run, so idempotency is structurally guaranteed here, not just tested for. | **PASS, all 4 steps, no findings.** |
| T10, steps 1-2 (customer no-show) | Ran clean against a fresh real-Stripe `CONFIRMED` booking (`7cd4b659-347b-4f27-9b04-455c39da7890`) on F-LIVE. `no-show` → `NO_SHOW_CUSTOMER`; full capture confirmed at both the ledger and real Stripe (`amount_received: 20000`). | **PASS, no findings.** |
| T10, steps 3-4 (provider no-show) | Same class of gap as T08: `CustomerReportsProviderNoShow` exists in the state machine (`libs/domain/booking-state-machine/src/index.ts`), but `apps/api/src/booking-routes.ts` (the customer-facing route file) has no route calling it — full route list checked (`POST /bookings`, `GET /bookings/:id`, `GET .../cancel-consequence`, `PATCH .../cancel`, `GET /account/me/bookings`, `POST .../review`), none of them wire this event. Confirmed via `grep -rn "CustomerReportsProviderNoShow" apps/api/src/*.ts` — zero non-test matches. | **Real defect — half of BOK-008 (Must) is unreachable from the API.** Seeded a `CONFIRMED` booking on F-LIVE2 (`cfa54ffc-1574-45c4-bbc1-9479451c23c2`) with `slot_start` pushed to the past, ready for whenever a route exists. **Steps 3-4 BLOCKED, not run.** Same disposition as T08 — file as a P0 follow-up alongside the provider-cancel gap, likely worth fixing together since both are "the customer/provider-initiated counterpart route was never added" instances of the same oversight. |
