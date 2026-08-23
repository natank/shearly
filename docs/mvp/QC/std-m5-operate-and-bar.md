# STD-M5 — Operate & bar

**Document ID:** `STD-M5`
**Milestone:** M5 Operate & bar
**Plan:** [m5-operate-and-bar.md](../04-implementation-plan/m5-operate-and-bar.md)
**Lab:** [lab.md](./lab.md)
**Depends on:** STD-M0, STD-M1, STD-M2, STD-M3, STD-M4 demo procedures still PASS
**Applies to:** `main` at or after the M5-P9 merge (P10 is stretch — see plan §3; fill in PR link when known)
**Est. time:** 150 minutes (time-triggered work needs frozen-clock waits; admin surfaces are all new)

---

## 1. Purpose

Time does the right thing without anyone clicking a button: an unanswered booking expires on its own, a reminder fires on its own, both parties get an email either way. A founder without a developer can search for a booking, retry a failed refund, reverse a disputed no-show, pay out a provider, see who's causing trouble, and see where visitors are dropping off — all from `apps/admin`. The whole loop is accessible and finished-looking in both locales, not just functionally correct.

Master demo: "Notifications fire correctly, admin retries a refund, the whole thing looks and works finished in both languages."

---

## 2. Traceability

| Procedure | Pri | Stories / NFRs |
|---|---|---|
| M5-T01 | Must | NOT-001 — booking-created notification fires |
| M5-T02 | Must | NOT-001, BOK-004 — unanswered `PENDING` expires unattended, both parties notified |
| M5-T03 | Must | NOT-001, BOK-007 — `CONFIRMED` auto-completes unattended, both parties notified |
| M5-T04 | Must | NOT-001 — decline/cancel/no-show each notify the correct party |
| M5-T05 | Must | NOT-002, `[D-3]` — reminder fires before the free-cancellation boundary; a pre-window cancel sends none |
| M5-T06 | Must | NOT-003, NFR-I18N-006 — both-locale templates, correct RTL, channel abstraction holds |
| M5-T07 | Must | OPS-002 — admin searches bookings, sees full state + payment history |
| M5-T08 | Must | OPS-002 — failed capture/refund surfaced in exceptions view, idempotent retry |
| M5-T09 | Must | OPS-003 — manual refund requires a reason, attributed, immutable |
| M5-T10 | Must | OPS-003 — reverse a disputed no-show, financial result re-nets correctly |
| M5-T11 | Must | OPS-005 — manual payout trigger, idempotent, reflected in earnings |
| M5-T12 | Should | OPS-004 — standing view, threshold flag, suspend/delist preserves in-flight bookings |
| M5-T13 | Should | OPS-006 — funnel view, per-stage drop-off, payment-failure visibility |
| M5-T14 | Must | NFR-A11Y-001…003 — WCAG AA, keyboard-only completion, screen-reader-legible core flow |
| M5-T15 | Must | NFR-A11Y-004 — automated a11y check gates CI |
| M5-T16 | Must | NFR-UX-002…005 — no dead-end loading/error/empty states, no reachable placeholder text, 360px+ |
| M5-T17 | Must | NFR-I18N-005, NFR-CI-003 — both-locale E2E now covers decline/expiry/cancel, not just the happy path |
| M5-T18 | Should | NFR-OBS-004 — named alarms fire on capture failure, refund failure, expiry spike, orphan-auth action, SES bounce |
| M5-T19 | Should | PAY-006 — automated payout scheduling (stretch; WAIVE if cut) |
| M5-T20 | Should | RAT-003 — provider review replies (stretch; WAIVE if cut) |

---

## 3. Fixtures

Reuse [lab.md](./lab.md) for surfaces, bring-up, seed admin, and reset ladder. Reuse F-LIVE-style listed providers from prior STDs where a procedure just needs "a real booking to act on" — seed fresh via the API, same pattern M4's `m4-std-fixtures.md` used, rather than redefining provider setup here.

### F-CUST-M5 / F-PROV-M5

Fresh customer/provider pairs per procedure, `qc-m5-<role>-<date>@example.com`. Don't reuse a M4 fixture whose booking is already in a terminal state — several M5 procedures need bookings mid-lifecycle at the moment you seed them.

### Mailhog

All notification procedures (T01–T06) check `http://localhost:8025` (Mailpit UI) instead of a live inbox — same convention `lab.md` already establishes. Clear Mailpit's own state between procedures if volume makes matching hard (Mailpit UI has a delete-all action), or filter by recipient email since every fixture account is unique.

### Clock control for time-triggered work

M5 is the first milestone where the poller (design §6.6) is actually live — unlike M4, where every "past slot_start" scenario needed a manual SQL push because no poller existed. Two options depending on what M5-P2 actually ships:

- **If a QC-only manual trigger endpoint exists** (check M5-P2's delivery notes before running T02/T03/T05): call it directly, same spirit as M4's frozen-clock unit tests but exercised over HTTP.
- **If not**: push the relevant column into the past via SQL (`response_deadline`, `auto_complete_at`, `remind_at` — same `UPDATE ... SET column = now() - interval '1 hour'` pattern M4 used throughout), then **wait for the real poller's next tick** (`POLL_INTERVAL_MS`, check `.env` for the actual configured value) rather than triggering it by hand. This is the only STD in the whole plan where "wait for a background process" is the correct QC action — confirms the poller is actually running unattended, which is the entire point of M5.

### Admin routes

All OPS procedures assume `apps/admin` at `localhost:4300`, signed in as `admin@shearly.local` (from `lab.md` §3). Exact route paths are placeholders pending M5-P6…P8's actual delivery — update this section with real paths once those PRs land, before running T07–T13.

---

## 4. Reset

1. Confirm Mailhog is empty or you know which messages are pre-existing before starting T01–T06 (avoids false-matching a stale email from a prior run).
2. Confirm the poller is actually running (`pnpm nx run-many -t serve -p web,api,admin` includes it if M5-P2 wires it into `apps/api`'s own process, per design §6.6's "in-process" decision — no separate service to start).
3. Between T02/T03 (expiry vs auto-complete) use **different** bookings — don't reuse one booking id across both, same rule M4's reset ladder used for its own cancel-window pair.
4. OPS procedures (T07–T13) need at least one booking in a failed-payment-operation state (T08) and one provider with multiple cancellations (T12) — seed these deliberately; they don't occur naturally in a fresh DB.

---

## 5. Procedures

### M5-T01 — Booking-created notification

**Pri:** Must
**Demo procedure.**

| Step | Action | Expected |
|---|---|---|
| 1 | Complete a normal booking (M4's happy path) | Booking `PENDING` |
| 2 | Check Mailpit | Both customer and provider have a booking-created email, in their own registered locale |
| 3 | Open the email | No untranslated keys, no broken template variables, renders sensibly |

**Fail if** no email arrives within NOT-001's 1-minute bound, or content is in the wrong locale.

---

### M5-T02 — Unanswered `PENDING` expires unattended

**Pri:** Must
**Demo procedure.**

| Step | Action | Expected |
|---|---|---|
| 1 | Seed a `PENDING` booking; push `response_deadline` into the past (§3 clock control) | — |
| 2 | Do **not** call any expire endpoint by hand — wait for the poller's next tick | Within one poll interval, state becomes `EXPIRED` |
| 3 | Check the authorization | Released (Stripe test dashboard, or `payments.authorizations` if in stub mode per M4's own stub-mode substitution) |
| 4 | Check Mailpit | Both parties notified of the expiry |

**Fail if** the booking never transitions without a manual API call, or the authorization is still held.

---

### M5-T03 — `CONFIRMED` auto-completes unattended

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Seed a `CONFIRMED` booking; push `auto_complete_at` into the past | — |
| 2 | Wait for the poller's next tick, no manual call | State becomes `COMPLETED`; capture + ledger split happen (same PAY-002 shape M4 already proved, now poller-triggered instead of provider-triggered) |
| 3 | Check Mailpit | Both parties notified of completion |

---

### M5-T04 — Decline/cancel/no-show each notify correctly

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Provider declines a `PENDING` booking | Customer notified of the decline |
| 2 | Customer cancels a `CONFIRMED` booking | Provider notified of the cancellation |
| 3 | Provider reports a customer no-show | Customer notified |
| 4 | Customer reports a provider no-show | Provider notified |

**Fail if** any of the four sends nothing, or notifies the wrong party.

---

### M5-T05 — Reminder timing respects `[D-3]`

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Seed a `CONFIRMED` booking; push its `booking.reminders` row's `remind_at` into the past | — |
| 2 | Wait for the poller's next tick | Both parties receive a reminder email |
| 3 | Seed a second `CONFIRMED` booking, cancel it **before** its reminder window arrives | — |
| 4 | Wait past when the reminder would have fired | No reminder email for this booking — `sent_at` stays null and the row is not claimed for a cancelled booking |

**Fail if** step 4's cancelled booking still gets a reminder.

---

### M5-T06 — Both-locale templates, RTL, channel abstraction

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Trigger any notification (e.g. T01) for a Hebrew-locale account | Email renders RTL correctly — not just Hebrew text in an LTR-laid-out template |
| 2 | Same for an English-locale account | Renders LTR, no leftover RTL styling artifacts |
| 3 | Check the code path (not a UI step): confirm the notification service's caller contract doesn't hardcode "email" | `libs/services/notifications`' public interface reads as channel-agnostic — code review, not a runtime check |

---

### M5-T07 — Admin searches bookings, sees full history

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | As admin, search by a known customer's email | Returns that customer's bookings, not others' |
| 2 | Search by provider, by state, by date range | Each filter narrows correctly |
| 3 | Open one booking's detail | Full `state_transitions` history shown, plus linked `payments.operations`/`payments.ledger` rows, matching the DB directly |

---

### M5-T08 — Failed capture/refund in exceptions view, idempotent retry

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Force a capture or refund failure (mock/misconfigure the payment call for one booking, or use whatever QC-only failure-injection surface M5-P6 exposes) | `payments.operations` row lands `failed` |
| 2 | Open the admin exceptions view | The failed operation appears, not buried in a generic list |
| 3 | Retry once | Succeeds |
| 4 | Retry again | Idempotent — no double-capture, no double-refund, second call returns the original success result |

**Fail if** step 4 charges or refunds twice.

---

### M5-T09 — Manual refund requires a reason, attributed, immutable

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Attempt a manual refund from admin with no reason | Rejected |
| 2 | Attempt again with a reason | Succeeds |
| 3 | Check the audit trail | Records which admin, when, and the reason — and the record itself cannot be edited/deleted afterward (check for an UPDATE/DELETE path if the UI seems to allow it; there should not be one) |
| 4 | Check the booking's OPS-002 detail view | The manual refund appears alongside the automated payment history, not as a separate invisible ledger |

---

### M5-T10 — Reverse a disputed no-show

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Seed a `NO_SHOW_CUSTOMER` booking (full capture already happened, per M4-T10) | — |
| 2 | Admin reverses the no-show outcome | Financial result re-nets: the captured amount is refunded (or the equivalent correct direction — confirm against BOK-008's original capture direction, don't assume) |
| 3 | Check the ledger | New rows reflect the reversal; original capture rows are not deleted (append-only, same §8.3 discipline M4 established) |

---

### M5-T11 — Manual payout trigger

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Find a provider with a positive pending balance (M4-P8's earnings view) | Note `pendingMinor` |
| 2 | Admin triggers a manual payout | `payments.payouts` gets a new row; provider's earnings view `paidOutMinor` increases by exactly the paid amount, `pendingMinor` decreases by the same |
| 3 | Trigger again immediately | Idempotent — does not pay out twice for the same pending balance |

---

### M5-T12 — Standing view, threshold flag, suspend preserves in-flight bookings

**Pri:** Should

| Step | Action | Expected |
|---|---|---|
| 1 | Seed a provider with enough cancellations/no-shows to cross the configured standing threshold | Standing view shows correct counts (cancellation, no-show, expiry/response rate, completion rate) |
| 2 | Confirm the provider is flagged for review | Visible distinctly from providers below threshold |
| 3 | Admin suspends/delists the provider | Provider disappears from a discovery search that previously found them |
| 4 | Check the provider's existing `CONFIRMED` booking (seed one before suspending) | Still there, still actionable via OPS-002 — not silently cancelled |

If M5-P8 lands but suspend/delist isn't wired to discovery yet, WAIVE step 3 with that reason and confirm the read-only standing view (steps 1-2) still passes.

---

### M5-T13 — Funnel view

**Pri:** Should

| Step | Action | Expected |
|---|---|---|
| 1 | Drive a scripted sequence: discover a provider → view profile → select a slot → create a booking → confirm it → complete it, for a known count of test sessions | Funnel view's per-stage counts match the scripted sequence exactly |
| 2 | Deliberately fail one booking's payment (bad payment method) instead of completing it | Payment failure shows up as its own distinct funnel signal, not lumped into a generic drop-off number |

If M5-P8's funnel events aren't fully wired for pre-booking stages (discovery/profile-view/slot-selected — flagged as new work in the plan's §9 M5-Q3), WAIVE the pre-booking half and confirm the booking-state-driven half (create→confirm→complete, which reuses M5-P1's existing event types) still passes.

---

### M5-T14 — WCAG AA, keyboard-only, screen-reader-legible core flow

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Complete a full booking (discovery → profile → slot → confirm) using only the keyboard, no mouse | Every interactive control reachable, visible focus at each step, no keyboard trap |
| 2 | Run a screen reader (VoiceOver on macOS, or equivalent) through the same flow | Every control has an accessible name; the flow makes sense read aloud, not just visually |
| 3 | Spot-check color contrast on the confirm/pay screen and the account/provider dashboards | Meets WCAG AA contrast ratios |

---

### M5-T15 — Automated a11y check gates CI

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Confirm an automated a11y check (axe-core or equivalent) runs in CI against the core booking flow | Present in the CI config, not just a local script nobody runs |
| 2 | Deliberately introduce an a11y violation (e.g. remove an aria-label) on a throwaway branch | The check fails the build |
| 3 | Revert | Check passes again |

This is the one procedure in this STD that's really a CI-config check, not a runtime QC pass — verify by reading the CI workflow file and running it once against a deliberately broken commit, not by manual page inspection alone.

---

### M5-T16 — No dead-end loading/error/empty states, no reachable placeholder text, responsive 360px+

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Walk every screen in `apps/web` and `apps/admin` reachable from a fresh account (both roles) | Each has a real loading state (not a blank flash), a real error state (not a silent failure), a real empty state (not blank space) where applicable |
| 2 | Grep-check (or run the existing `check-hardcoded-strings.mjs`-style script if M5-P9 extended it) | No lorem ipsum, no untranslated `namespace.key` leaks, no literal "TODO"/"placeholder" text reachable in the UI |
| 3 | Resize the browser to 360px width and repeat the core booking flow | No horizontal scroll, no clipped/unreachable controls |

---

### M5-T17 — Both-locale E2E now covers decline/expiry/cancel

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Confirm the Playwright suite has both-locale coverage beyond the M4-P9 happy path — specifically decline, expiry, and cancel, each in both `/en` and `/he` | Present and green in CI |
| 2 | Run it locally once | Passes |

---

### M5-T18 — Named alarms fire

**Pri:** Should

| Step | Action | Expected |
|---|---|---|
| 1 | Force a payment capture failure | Alarm signal fires (log-based locally per plan §9 M5-Q5's default, or real CloudWatch/SNS if M5-P9 shipped that instead — check delivery notes) |
| 2 | Force a refund failure | Same |
| 3 | Force an expiry spike (multiple bookings expiring in a short window, or however the alarm's threshold is defined) | Same |
| 4 | Confirm the orphan-authorization reconciler's action (from M4's saga design) is itself alarm-visible when it fires | Same |
| 5 | SES bounce rate | If no real SES integration exists yet (Mailhog-only locally), WAIVE this specific sub-check with that reason — confirm the alarm *mechanism* exists and the other four fire correctly |

---

### M5-T19 — PAY-006 automated payouts (stretch)

**Pri:** Should

If M5-P10 shipped PAY-006: confirm a scheduled payout fires without a manual trigger, respecting whatever cadence config exists, and remains idempotent against the poller claiming the same due row twice.

If cut (per the plan's accepted stretch-cut clause): **WAIVE**, confirm `docs/mvp/04-implementation-plan/m5-operate-and-bar.md` §7 (or the master's Definition of Done) records it as an explicit cut, not silently dropped.

---

### M5-T20 — RAT-003 review replies (stretch)

**Pri:** Should

If M5-P10 shipped RAT-003: provider can reply publicly to a review; the reply is visible on the public profile.

If cut: **WAIVE**, same recording requirement as T19.

---

## 6. Explicitly out of M5 QC

| Item | Belongs |
|---|---|
| Anything tagged `POST-MVP` anywhere in requirements | Out of the entire MVP plan |
| SMS/push notification channels | NOT-003 only requires the abstraction exists — no channel beyond email ships in M5 |
| Real production CloudWatch/SNS alarm wiring, if M5-P9 chose the log-based local default (plan §9 M5-Q5) | Extraction-time concern, named hole if so — confirm which was chosen before failing T18 on this basis |
| Exhaustive WCAG coverage of every admin screen | A11Y-004's own P2 ceiling scopes this to the *core booking flow*, not the whole product |

---

## 7. Run log

| Field | Value |
|---|---|
| Date | |
| Commit | |
| Tester | |
| Poll interval config value | |
| Reminder window config value | |
| Standing threshold config value | |
| Reset | |

| ID | Pri | Verdict | Notes |
|---|---|---|---|
| M5-T01 | Must | | |
| M5-T02 | Must | | |
| M5-T03 | Must | | |
| M5-T04 | Must | | |
| M5-T05 | Must | | |
| M5-T06 | Must | | |
| M5-T07 | Must | | |
| M5-T08 | Must | | |
| M5-T09 | Must | | |
| M5-T10 | Must | | |
| M5-T11 | Must | | |
| M5-T12 | Should | | |
| M5-T13 | Should | | |
| M5-T14 | Must | | |
| M5-T15 | Must | | |
| M5-T16 | Must | | |
| M5-T17 | Must | | |
| M5-T18 | Should | | |
| M5-T19 | Should | | |
| M5-T20 | Should | | |

**Milestone QC:** PASS / FAIL
