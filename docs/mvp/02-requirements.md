# Shearly MVP — Requirements

**Phase:** 2 of 4 (Requirements)
**Scope:** MVP only. Post-MVP stories are tagged and included for traceability, not for build.
**Status:** Draft, pending founder review
**Source:** `docs/kickoff.md`, `docs/mvp/mvp-kickoff.md`, `docs/01-vision.md`

---

## 1. How to Read This Document

### Story IDs

Every story carries a stable ID: `<EPIC>-<NNN>`. IDs are permanent — a story that is cut keeps its ID and is marked `CUT` rather than being renumbered. Later documents (design, implementation plan, PR descriptions, tests) reference these IDs.

| Prefix | Epic |
|---|---|
| `CUS` | Customer account & onboarding |
| `DIS` | Discovery & provider browsing |
| `BOK` | Booking lifecycle |
| `PAY` | Payments, commission & payouts |
| `PRV` | Provider onboarding & vetting |
| `AVL` | Provider availability & schedule |
| `RAT` | Ratings & reviews |
| `NOT` | Notifications |
| `OPS` | Admin & operations |
| `NFR` | Non-functional requirements |

### Tags

- **`MVP`** — required for the submission bar. Must ship.
- **`MVP-STRETCH`** — in MVP scope if time allows; cutting it does not break the demo. Explicitly the first thing sacrificed under schedule pressure, per vision §5.7.
- **`POST-MVP`** — deliberately deferred. Listed so the boundary is explicit and so later phases inherit a written story rather than a memory.

### Priority within MVP

`P0` = the demo fails without it. `P1` = the demo works but has a visible hole. `P2` = polish or edge-case completeness.

### Traceability to the vision

Stories reference vision decisions where they implement one: `[D-1]`…`[D-5]` are the commercial defaults (vision §9), `[SC-1]`…`[SC-7]` are the MVP success criteria (vision §7). Every `SC` should be satisfied by at least one `P0` story — see §13 for the coverage check.

---

## 2. Actors

| Actor | Description | Authentication |
|---|---|---|
| **Visitor** | Unauthenticated user browsing the app | None |
| **Customer** | Authenticated user who books services | Account required at booking, not at browse `[D-browse]` |
| **Provider** | Vetted professional delivering services | Account + approved vetting |
| **Admin** | Platform operator (the founder at MVP) | Elevated role, separate surface |
| **System** | Scheduled jobs, webhooks, automated transitions | Service credentials |

---

## 3. Domain Model (Requirements-Level)

Named here so stories can reference entities consistently. Not a data model — that is Phase 3.

| Entity | Key attributes | Notes |
|---|---|---|
| **Customer** | identity, contact, saved addresses, locale | |
| **Provider** | identity, bio, portfolio, vetting status, base location, service radius, locale | Radius ≤ 15 km `[D-5]` |
| **Service** | provider-owned; name, description, duration, price | Price includes travel `[D-2]` |
| **Availability** | provider-owned; recurring rules + one-off exceptions | Source of truth for bookable slots |
| **Booking** | customer, provider, service, address, slot, state, price snapshot | Price is snapshotted at booking time |
| **Payment** | booking-linked; authorization, capture, refund, commission split | Commission 20% `[D-1]` |
| **Review** | booking-linked; rating, optional text | One per completed booking |
| **Notification** | recipient, channel, event, delivery state | |

### Booking state machine

The single most important shared vocabulary in this document. All `BOK` stories reference these states.

```
                    ┌──────────────┐
                    │   PENDING    │  customer booked, awaiting provider
                    └──────┬───────┘
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
      ┌──────────┐   ┌──────────┐   ┌──────────────┐
      │ CONFIRMED│   │ DECLINED │   │EXPIRED       │  provider silent past
      └────┬─────┘   └──────────┘   └──────────────┘  response deadline
           │
     ┌─────┼───────────────┬──────────────────┐
     ▼     ▼               ▼                  ▼
┌─────────┐ ┌────────────────────┐ ┌────────────────────┐
│COMPLETED│ │CANCELLED_BY_CUSTOMER│ │CANCELLED_BY_PROVIDER│
└─────────┘ └────────────────────┘ └────────────────────┘
                                    │
                              ┌─────▼──────┐
                              │  NO_SHOW   │  (customer or provider)
                              └────────────┘
```

Terminal states: `COMPLETED`, `DECLINED`, `EXPIRED`, `CANCELLED_BY_*`, `NO_SHOW_*`. Each terminal state has defined payment and standing consequences — see `PAY` and `BOK` stories.

---

## 4. Epic: Customer Account & Onboarding (`CUS`)

**Goal.** Get a customer from arrival to bookable with the least friction the transaction allows. Browsing never requires an account (vision §5.1).

### CUS-001 — Browse without an account `MVP` `P0` `[SC-1]`

**As a** visitor, **I want** to browse providers and see prices and availability without signing up, **so that** I can evaluate the service before committing anything.

**Acceptance criteria**
- Given I arrive with no session, when I open the app, then I see the provider discovery surface with no login wall, modal, or interstitial.
- Given I am browsing anonymously, when I view a provider profile, then I see services, prices, ratings, vetting status, and real availability.
- Given I am browsing anonymously, when I select a slot and proceed to book, then and only then am I prompted to authenticate.
- Given I authenticate mid-booking, when authentication completes, then my slot selection and address entry are preserved — I am not returned to the start.

### CUS-002 — Register with email and password `MVP` `P0`

**As a** visitor, **I want** to create an account, **so that** I can book and manage appointments.

**Acceptance criteria**
- Given valid email and a password meeting policy, when I submit, then an account is created and I am authenticated.
- Given an email already registered, when I submit, then I am told the account exists and offered sign-in — the response must not confirm or deny registration status to an unauthenticated party beyond this flow (see NFR-SEC-004).
- Given a password below policy, when I submit, then I see the specific unmet requirement before submission completes.
- Given registration succeeds, when the account is created, then my locale is captured from the active UI language.

### CUS-003 — Sign in and sign out `MVP` `P0`

**As a** customer, **I want** to sign in and out, **so that** I can access my bookings securely.

**Acceptance criteria**
- Given correct credentials, when I sign in, then I am authenticated and returned to my prior context where one exists.
- Given incorrect credentials, when I sign in, then I see a generic failure message that does not reveal whether the email exists.
- Given repeated failed attempts, when the threshold is exceeded, then further attempts are rate-limited (see NFR-SEC-003).
- Given I am signed in, when I sign out, then my session is terminated server-side, not only cleared client-side.

### CUS-004 — Password reset `MVP` `P1`

**As a** customer, **I want** to reset a forgotten password, **so that** I am not locked out of my bookings.

**Acceptance criteria**
- Given any submitted email, when I request a reset, then I see an identical confirmation regardless of whether the account exists.
- Given a valid reset token, when I set a new password, then the token is single-use and all existing sessions are invalidated.
- Given an expired or already-used token, when I attempt reset, then I am told to request a new link.

### CUS-005 — Manage service addresses `MVP` `P0` `[SC-1]`

**As a** customer, **I want** to save and reuse addresses, **so that** booking again is fast and the provider reaches the right place.

**Acceptance criteria**
- Given I am booking, when I enter an address, then I can optionally save it with a label ("Home", "Office").
- Given saved addresses exist, when I book again, then I can select one without retyping.
- Given an address, when I enter it, then I can add access notes (floor, entry code, parking) that the provider sees only after the booking is `CONFIRMED`.
- Given an address outside every provider's service radius, when I enter it, then I see an explicit "not yet in your area" state, not an empty result list `[D-5]`.

### CUS-006 — View booking history `MVP` `P1`

**As a** customer, **I want** to see my past and upcoming bookings, **so that** I can track what I have scheduled and what I have spent.

**Acceptance criteria**
- Given I have bookings, when I open my bookings, then upcoming and past are separated, upcoming sorted soonest-first.
- Given a booking in any state, when I view it, then I see provider, service, price paid, address, time, and current state.
- Given a `COMPLETED` booking not yet reviewed, when I view it, then I am prompted to review it (see RAT-001).

### CUS-007 — Social sign-in `POST-MVP`

Deferred. Email/password clears the bar; OAuth adds provider configuration and account-linking edge cases for convenience gain only.

---

## 5. Epic: Discovery & Provider Browsing (`DIS`)

**Goal.** A visitor finds a suitable, available, in-radius provider quickly. This epic contains the ranking seam that vision §6 commits to.

### DIS-001 — Discover providers by location `MVP` `P0` `[SC-1]` `[D-5]`

**As a** visitor, **I want** to see providers who serve my address, **so that** I only consider ones who can actually come to me.

**Acceptance criteria**
- Given I supply an address or grant location, when discovery loads, then I see only providers whose service radius covers that location and whose vetting status is `APPROVED`.
- Given no provider covers my location, when discovery loads, then I see an explicit out-of-area state offering notification-on-launch, not an empty list.
- Given providers are returned, when the list renders, then each card shows name, photo, headline service price, rating with review count, vetting badge, and next available slot.
- Given I have not supplied a location, when discovery loads, then I am prompted for one before results are shown — results without a location are meaningless under `[D-5]`.

### DIS-002 — Ranked provider results via a pluggable ranking interface `MVP` `P0` `[D-5]`

**As a** visitor, **I want** the most suitable providers first, **so that** I do not have to evaluate every option.

This story implements the **ranking seam** committed in vision §6 (Candidate B). The MVP implementation is deterministic; the interface is the deliverable.

**Acceptance criteria**
- Given a location and optional filters, when results are ranked, then ranking is produced behind a named interface with a single deterministic implementation — no ranking logic inline in the query or the UI.
- Given the MVP implementation, when it ranks, then it uses only: travel distance, availability proximity, rating, and completion count. Weights are configuration, not literals.
- Given identical inputs, when ranking runs twice, then the order is identical — ranking is deterministic and testable.
- Given the interface, when a future implementation is substituted, then no caller changes. Verified by a test that swaps in a stub ranker.
- Given ranking fails or times out, when results are returned, then they fall back to a stable default sort rather than erroring.

### DIS-003 — Filter and sort results `MVP` `P1`

**As a** visitor, **I want** to narrow results, **so that** I can find a provider matching my constraints.

**Acceptance criteria**
- Given results, when I filter by service type, price range, minimum rating, or date availability, then results update and the active filters are visible.
- Given active filters, when I clear them, then I return to the ranked default.
- Given filters that exclude everything, when applied, then I see a "no matches — adjust filters" state naming which filters are active.
- Given I apply filters, when the URL updates, then the filtered view is shareable and survives reload.

### DIS-004 — View provider profile `MVP` `P0` `[SC-1]`

**As a** visitor, **I want** to see a provider's full profile, **so that** I can decide whether to let them into my home.

**Acceptance criteria**
- Given a provider, when I open their profile, then I see bio, portfolio images, full service menu with prices and durations, aggregate rating, individual reviews, and vetting badge.
- Given the vetting badge, when I view or tap it, then I see plainly what was verified — ID, credential, portfolio, interview `[D-4]`.
- Given a service price, when displayed, then it is the total the customer pays, with travel included and no additional line items disclosed later `[D-2]`.
- Given the profile, when it loads, then next available slots are shown inline so booking can start without a separate step.

### DIS-005 — View real availability before booking `MVP` `P0` `[SC-1]`

**As a** visitor, **I want** to see genuinely bookable times, **so that** I am not negotiating like on WhatsApp.

**Acceptance criteria**
- Given a provider and service, when I view availability, then I see only slots that satisfy the service duration, the provider's availability rules, existing bookings, and travel buffer.
- Given a slot shown as available, when I attempt to book it, then it is bookable — except under genuine concurrency, which is handled by BOK-002.
- Given availability, when displayed, then it is rendered in the customer's timezone and locale calendar `[NFR-I18N]`.
- Given a provider with no availability in the visible window, when I view it, then I see the next available date rather than an empty calendar.

### DIS-006 — Map view of providers `POST-MVP`

Deferred. List discovery with radius filtering satisfies the flow; a map is presentation polish with real cost.

---

## 6. Epic: Booking Lifecycle (`BOK`)

**Goal.** The core transaction. This epic carries the demo. Every state transition in §3 is specified here.

### BOK-001 — Book a slot `MVP` `P0` `[SC-1]` `[SC-2]`

**As a** customer, **I want** to book a specific provider, service, time, and address, **so that** someone comes to cut my hair.

**Acceptance criteria**
- Given a selected provider, service, slot, and address, when I confirm, then a `PENDING` booking is created with the price snapshotted at that moment.
- Given the booking is created, when it is persisted, then payment is authorized but not captured (see PAY-001).
- Given the booking is created, when persistence succeeds, then the provider is notified within the NOT-001 latency target and the slot is held against other bookings.
- Given I am not authenticated, when I confirm, then I authenticate first and return to the same state with selections intact (see CUS-001).
- Given the booking succeeds, when I land on confirmation, then I see state, provider, time, address, total charged, and the provider's response deadline.

### BOK-002 — Concurrent booking safety `MVP` `P0`

**As a** platform, **I want** a slot to be bookable exactly once, **so that** two customers are never sent the same provider at the same time.

**Acceptance criteria**
- Given two customers submit the same slot simultaneously, when both are processed, then exactly one `PENDING` booking is created and the other receives a clear "just taken" message with alternative slots.
- Given a `PENDING` booking, when another customer views availability, then that slot is not offered.
- Given a booking reaches `DECLINED`, `EXPIRED`, or `CANCELLED_BY_*`, when the transition completes, then the slot returns to availability immediately.
- Given the hold mechanism, when tested under concurrent load, then no double-booking occurs. This must be covered by an automated test, not manual verification.

### BOK-003 — Provider accepts or declines `MVP` `P0` `[SC-2]` `[SC-6]`

**As a** provider, **I want** to accept or decline requests, **so that** I control my own schedule.

**Acceptance criteria**
- Given a `PENDING` booking, when I accept, then it becomes `CONFIRMED`, payment capture is scheduled per PAY-002, and the customer is notified.
- Given a `PENDING` booking, when I decline, then it becomes `DECLINED`, the payment authorization is released in full, the slot is freed, and the customer is notified with alternative providers.
- Given a `CONFIRMED` booking, when I view it, then I see the customer's full address and access notes — which were withheld while `PENDING` (see CUS-005).
- Given I decline, when prompted, then I may give an optional reason, retained for ops visibility but not shown to the customer verbatim.

### BOK-004 — Provider response deadline and expiry `MVP` `P0` `[SC-6]`

**As a** customer, **I want** an unanswered request to resolve itself, **so that** I am not left waiting indefinitely.

**Acceptance criteria**
- Given a `PENDING` booking, when the provider has not responded within the response window, then it transitions to `EXPIRED` automatically.
- Given the response window, when configured, then it is the lesser of a fixed duration and the time until the slot itself — a booking never expires after its own start time has passed.
- Given a booking becomes `EXPIRED`, when the transition occurs, then the authorization is released in full, the slot is freed, and the customer is notified with alternatives.
- Given expiry occurs, when recorded, then it counts against the provider's response-rate metric (see OPS-004).

### BOK-005 — Customer cancels `MVP` `P0` `[D-3]` `[SC-6]`

**As a** customer, **I want** to cancel a booking, **so that** plans can change.

**Acceptance criteria**
- Given a `CONFIRMED` booking more than 12 hours before its start, when I cancel, then it becomes `CANCELLED_BY_CUSTOMER` and I am refunded in full `[D-3]`.
- Given a `CONFIRMED` booking 12 hours or less before its start, when I cancel, then I am charged 50% and the provider earns 50% of their normal net `[D-3]`.
- Given either case, when I initiate cancellation, then the exact financial consequence is stated before I confirm — never disclosed only afterward.
- Given a `PENDING` booking, when I cancel, then the authorization is released in full with no charge regardless of timing.
- Given cancellation completes, when the transition is recorded, then the slot is freed and the provider is notified.

### BOK-006 — Provider cancels `MVP` `P0` `[D-3]`

**As a** customer, **I want** protection when a provider cancels, **so that** the platform is more reliable than an individual's WhatsApp.

**Acceptance criteria**
- Given a `CONFIRMED` booking, when the provider cancels at any time, then the customer is refunded in full regardless of timing `[D-3]`.
- Given a provider cancellation, when it is recorded, then it counts against provider standing (see OPS-004) — no fee is charged `[D-3]`.
- Given a provider cancellation, when the customer is notified, then the notification includes alternative available providers for the same slot where any exist.
- Given a provider cancels, when the transition occurs, then the slot is freed and the provider must confirm they understand the standing consequence.

### BOK-007 — Mark completion `MVP` `P0` `[SC-2]` `[SC-3]`

**As a** provider, **I want** to mark a booking complete, **so that** payment settles and the loop closes.

**Acceptance criteria**
- Given a `CONFIRMED` booking whose start time has passed, when I mark it complete, then it becomes `COMPLETED` and settlement proceeds per PAY-002.
- Given a `CONFIRMED` booking, when I attempt to mark it complete before its start time, then I am prevented.
- Given a `COMPLETED` booking, when the transition occurs, then the customer is notified and prompted to review (see RAT-001).
- Given a `CONFIRMED` booking that neither party actions within the auto-complete window after its end time, when the window elapses, then it auto-completes and both parties are notified.

### BOK-008 — No-show handling `MVP` `P1` `[D-3]` `[SC-6]`

**As a** provider, **I want** to report a customer no-show, **so that** I am not unpaid for a reserved and travelled-to slot.

**Acceptance criteria**
- Given a `CONFIRMED` booking whose start time has passed, when I report a customer no-show, then it becomes `NO_SHOW_CUSTOMER`, the customer is charged in full, and I earn in full `[D-3]`.
- Given a customer no-show is reported, when recorded, then the customer is notified with a dispute path (see OPS-003).
- Given a `CONFIRMED` booking, when the customer reports a provider no-show, then it becomes `NO_SHOW_PROVIDER`, the customer is refunded in full, and it counts against provider standing `[D-3]`.
- Given repeated provider no-shows, when the threshold is crossed, then the provider is flagged for admin review and may be delisted `[D-3]`.

### BOK-009 — Reschedule an existing booking `POST-MVP`

Deferred. Cancel-and-rebook covers the need; in-place rescheduling is a second negotiation state machine with its own payment implications.

### BOK-010 — Recurring bookings `POST-MVP`

Deferred. Single-transaction commission only (vision §7).

---

## 7. Epic: Payments, Commission & Payouts (`PAY`)

**Goal.** Real money moves, the split is recorded, and the provider gets paid. `[SC-3]` lives here.

### PAY-001 — Authorize at booking `MVP` `P0` `[SC-3]`

**As a** platform, **I want** to authorize payment when a booking is made, **so that** a confirmed booking is guaranteed funded.

**Acceptance criteria**
- Given I confirm a booking, when it is created, then the full amount is authorized against my card and not captured.
- Given authorization fails, when the attempt completes, then no booking is created and I see an actionable reason.
- Given authorization succeeds, when recorded, then the payment record links to the booking with the snapshotted amount.
- Given card data, when collected, then it is captured by the payment provider's hosted elements and never transits or is stored by Shearly systems `[NFR-SEC-001]`.
- Given an authorization approaching its expiry window without capture, when the window nears, then it is handled explicitly — reauthorized or released — never silently expired.

### PAY-002 — Capture and split on completion `MVP` `P0` `[SC-3]` `[D-1]`

**As a** platform, **I want** to capture funds and record the commission split, **so that** the business model is real.

**Acceptance criteria**
- Given a booking becomes `COMPLETED`, when settlement runs, then the authorized amount is captured.
- Given capture succeeds, when the split is recorded, then 20% is retained as platform commission and 80% is credited to the provider's payout balance `[D-1]`.
- Given the split, when recorded, then gross, commission, and net are individually persisted and independently auditable — not derived at read time.
- Given capture fails, when the failure is recorded, then the booking remains `COMPLETED`, the failure is surfaced to ops (see OPS-002), and retry is possible without duplicate capture.
- Given any settlement operation, when it is retried, then it is idempotent — no double capture, no double credit.

### PAY-003 — Refunds `MVP` `P0` `[D-3]`

**As a** customer, **I want** refunds to actually arrive, **so that** cancellation protection is real rather than stated.

**Acceptance criteria**
- Given a full-refund condition (BOK-003 decline, BOK-004 expiry, BOK-005 early cancel, BOK-006 provider cancel, BOK-008 provider no-show), when it occurs, then the authorization is released or the capture refunded in full.
- Given a partial-refund condition (BOK-005 late cancel), when it occurs, then 50% is refunded and the remainder is split per `[D-1]`.
- Given a refund is issued, when it completes, then the customer is notified with the amount and expected arrival time.
- Given a refund fails, when the failure occurs, then it is escalated to ops and the customer is informed rather than left silent.
- Given any refund, when processed, then it is idempotent against retry.

### PAY-004 — Provider payout visibility `MVP` `P0` `[SC-2]`

**As a** provider, **I want** to see what I have earned and when I will be paid, **so that** I trust the platform with my income.

**Acceptance criteria**
- Given completed bookings, when I open earnings, then I see per-booking gross, commission deducted, and net.
- Given earnings, when displayed, then pending balance and paid-out balance are distinct and clearly labelled.
- Given a payout occurs, when it completes, then I see the amount, date, and the bookings it covers.
- Given the commission rate, when shown, then it is stated explicitly rather than implied by arithmetic `[D-1]`.

### PAY-005 — Provider payout account onboarding `MVP` `P0`

**As a** provider, **I want** to connect my bank details, **so that** money can actually reach me.

**Acceptance criteria**
- Given I am onboarding, when I reach payout setup, then I complete it through the payment provider's hosted onboarding — Shearly never handles raw bank credentials `[NFR-SEC-001]`.
- Given payout onboarding is incomplete, when I attempt to go live, then I cannot be listed (see PRV-005).
- Given the payment provider requires identity verification, when it is pending, then I see current status and what remains outstanding.

### PAY-006 — Automated payout scheduling `MVP-STRETCH` `P2`

**As a** provider, **I want** automatic payouts on a schedule, **so that** I do not chase my money.

**Acceptance criteria**
- Given a positive pending balance, when the payout schedule runs, then a payout is initiated to my connected account.
- Given a payout is initiated, when it succeeds or fails, then the state is reflected in PAY-004 and I am notified.

**If cut:** payouts are triggered manually by admin (OPS-005). The demo still shows real money splitting; only the disbursement cadence is manual. This is why it is `MVP-STRETCH` rather than `P0`.

### PAY-007 — Multi-currency `POST-MVP`

Deferred. One market, one currency (vision §7). Currency remains configuration, not a literal.

---

## 8. Epic: Provider Onboarding & Vetting (`PRV`)

**Goal.** "Verified" means something specific and legible `[D-4]`, and supply exists at all.

### PRV-001 — Provider registration `MVP` `P0`

**As a** professional, **I want** to apply to the platform, **so that** I can receive clients without renting a chair.

**Acceptance criteria**
- Given I am a visitor, when I choose to join as a provider, then I register with email and password and my account is created with vetting status `DRAFT`.
- Given I am registered as a provider, when I sign in, then I land on the provider surface, not the customer one.
- Given an account, when created, then it holds exactly one role for MVP — an account is a customer or a provider, not both.

### PRV-002 — Submit vetting documentation `MVP` `P0` `[D-4]` `[SC-2]`

**As a** professional, **I want** to submit my credentials, **so that** I can be verified and listed.

**Acceptance criteria**
- Given I am in `DRAFT`, when I complete my application, then I must supply: government ID, professional credential (or documented equivalent experience), and a minimum of five portfolio photographs `[D-4]`.
- Given all required items are supplied, when I submit, then my status becomes `PENDING_REVIEW` and admin is notified.
- Given an incomplete application, when I attempt to submit, then I see precisely which items remain.
- Given uploaded identity documents, when stored, then they are access-restricted to admin, encrypted at rest, and never exposed on any public surface `[NFR-SEC-002]`.
- Given I have submitted, when I check status, then I see current state and what happens next.

### PRV-003 — Founder video interview step `MVP` `P0` `[D-4]`

**As a** platform, **I want** a live interview before listing, **so that** the vetting badge reflects a human judgment.

**Acceptance criteria**
- Given a `PENDING_REVIEW` provider whose documents pass initial check, when admin advances them, then status becomes `INTERVIEW_SCHEDULED` and the provider is notified to book a call.
- Given the interview occurs, when admin records the outcome, then status becomes `APPROVED` or `REJECTED` with a recorded rationale.
- Given the interview is a manual step, when it is performed, then the system records only that it occurred, by whom, and the outcome — the call itself is out of band at MVP.
- Given a `REJECTED` provider, when notified, then they are told the outcome without necessarily receiving the full internal rationale.

### PRV-004 — Provider profile and service menu `MVP` `P0` `[D-2]`

**As a** provider, **I want** to present myself and price my work, **so that** customers can choose me.

**Acceptance criteria**
- Given I am approved, when I edit my profile, then I can set bio, portfolio images, base location, and service radius.
- Given service radius, when I set it, then I may choose any value up to the 15 km platform maximum and not above it `[D-5]`.
- Given I define a service, when I set it, then it carries name, description, duration, and price.
- Given I set a price, when I am prompted, then the interface states explicitly that the price must include travel and that 20% commission will be deducted `[D-1]` `[D-2]`.
- Given I set a price, when it is saved, then I see the resulting net earning for that service before confirming.
- Given I edit prices, when existing bookings reference the old price, then those bookings retain their snapshotted price (see BOK-001).

### PRV-005 — Go-live gate `MVP` `P0` `[D-4]`

**As a** platform, **I want** providers listed only when genuinely ready, **so that** the vetting badge and the customer experience both hold.

**Acceptance criteria**
- Given a provider, when all of — `APPROVED` vetting, completed payout onboarding, at least one service defined, and some availability set — hold, then they become discoverable.
- Given any of those is missing, when I attempt to go live, then I see exactly which prerequisite is unmet.
- Given a live provider, when they remove all availability or all services, then they cease to appear in discovery without losing approved status.
- Given a live provider, when I toggle myself off, then I stop appearing while retaining approval and existing confirmed bookings.

### PRV-006 — Automated background checks `POST-MVP`

Deferred to Phase 3 per vision §8 and `[D-4]`. Manual interview is the MVP mechanism.

### PRV-007 — Insurance verification `POST-MVP`

Optional at MVP per `[D-4]` — surfaced on the profile when voluntarily supplied, not a listing requirement.

---

## 9. Epic: Availability & Schedule (`AVL`)

**Goal.** Providers control their time, and availability is accurate enough that DIS-005 is honest.

### AVL-001 — Set recurring weekly availability `MVP` `P0` `[SC-2]`

**As a** provider, **I want** to define my normal working hours, **so that** I do not manage every day by hand.

**Acceptance criteria**
- Given I open availability, when I set a weekly pattern, then I can define working windows per day of week.
- Given a weekly pattern, when saved, then it generates bookable slots forward across the discovery window.
- Given a pattern, when I edit it, then existing `CONFIRMED` bookings are never invalidated — they persist regardless.
- Given a pattern change reducing availability, when confirmed bookings fall outside the new pattern, then I am shown those conflicts explicitly and must resolve them via BOK-006 rather than silently.

### AVL-002 — One-off exceptions and time off `MVP` `P0`

**As a** provider, **I want** to block specific dates and add extra hours, **so that** real life fits.

**Acceptance criteria**
- Given a date, when I block it, then no new bookings can be made for it and it disappears from discovery availability.
- Given a date outside my normal pattern, when I add availability, then those slots become bookable.
- Given I block a date carrying confirmed bookings, when I attempt it, then I am shown the affected bookings and must handle them explicitly.

### AVL-003 — Travel buffer between bookings `MVP` `P0` `[D-2]` `[D-5]`

**As a** provider, **I want** travel time reserved between appointments, **so that** I am not booked into an impossible schedule.

**Acceptance criteria**
- Given a confirmed booking, when subsequent slots are computed, then a configurable travel buffer is reserved after it before the next bookable slot.
- Given the buffer, when applied, then it is applied both before and after the booking, not only after.
- Given two bookings at distant addresses within the radius, when the buffer is insufficient for the actual travel, then the later slot is not offered. Distance-aware buffering may be approximate at MVP but must not be absent.

### AVL-004 — Provider schedule view `MVP` `P0` `[SC-2]`

**As a** provider, **I want** to see my upcoming bookings, **so that** I know my day.

**Acceptance criteria**
- Given confirmed bookings, when I open my schedule, then I see them chronologically with customer name, service, time, and address.
- Given a `PENDING` booking awaiting my response, when I open my schedule, then it is visually distinct and shows the response deadline.
- Given a booking, when I open it, then I can action it per the BOK stories appropriate to its state.
- Given a booking is `CONFIRMED`, when I view it, then I see full address and access notes; while `PENDING`, I see only approximate area (see BOK-003).

### AVL-005 — Calendar sync (iCal/Google) `POST-MVP`

Deferred. Real value for providers, meaningful integration cost, not required by the submission bar.

---

## 10. Epic: Ratings & Reviews (`RAT`)

**Goal.** Trust compounds and ranking has a quality signal.

### RAT-001 — Rate a completed booking `MVP` `P0` `[SC-1]`

**As a** customer, **I want** to rate my experience, **so that** other customers can choose well.

**Acceptance criteria**
- Given a `COMPLETED` booking, when I open it, then I can leave a 1–5 star rating with optional text.
- Given I have not reviewed a completed booking, when I next open the app, then I am prompted once, dismissibly.
- Given I submit a review, when saved, then it is linked to that specific booking and I may not review the same booking twice.
- Given only completed bookings, when review eligibility is evaluated, then no other state permits a review — reviews cannot exist without a transaction.

### RAT-002 — Display ratings on profiles `MVP` `P0` `[SC-1]`

**As a** visitor, **I want** to see a provider's rating and reviews, **so that** I can judge quality.

**Acceptance criteria**
- Given a provider with reviews, when I view their profile or card, then I see the aggregate rating and total review count.
- Given individual reviews, when displayed, then each shows rating, text where present, and relative date.
- Given a provider with fewer reviews than the display threshold, when shown, then they display a "new provider" indicator rather than a misleadingly sparse average.
- Given aggregate rating, when computed, then it is a stored aggregate rather than computed across all reviews at read time.

### RAT-003 — Provider response to reviews `MVP-STRETCH` `P2`

**As a** provider, **I want** to reply publicly to a review, **so that** I can give context.

**If cut:** no functional loss to the demo; reviews remain one-directional.

### RAT-004 — Structured multi-dimension reviews `POST-MVP`

Deferred to product Phase 2 (vision §8) — punctuality, cleanliness, result quality as separate dimensions.

---

## 11. Epic: Notifications (`NOT`)

**Goal.** Both sides know what is happening without opening the app. Notification-based coordination is what stands in for chat, which is out of scope (vision §7).

### NOT-001 — Transactional booking notifications `MVP` `P0` `[SC-2]` `[SC-6]`

**As a** user, **I want** to be told when my booking changes state, **so that** I can act.

**Acceptance criteria**
- Given any booking state transition, when it occurs, then the affected party is notified. Minimum matrix:

| Event | Customer | Provider |
|---|---|---|
| Booking created (`PENDING`) | Confirmation of request | New request + deadline |
| `CONFIRMED` | Confirmed with details | Confirmation recorded |
| `DECLINED` | Declined + alternatives | — |
| `EXPIRED` | Expired + alternatives | Missed-request notice |
| `CANCELLED_BY_CUSTOMER` | Cancellation + refund detail | Cancellation notice |
| `CANCELLED_BY_PROVIDER` | Cancellation + refund + alternatives | Standing consequence |
| `COMPLETED` | Receipt + review prompt | Earning recorded |
| `NO_SHOW_*` | Outcome + dispute path | Outcome |
| Refund issued | Amount + arrival window | — |

- Given a notification, when sent, then it is delivered in the recipient's locale `[NFR-I18N]`.
- Given a state transition, when it occurs, then the notification is dispatched within one minute.
- Given notification delivery fails, when it fails, then the failure is logged and retried, and never blocks or reverses the state transition itself.

### NOT-002 — Booking reminders `MVP` `P1`

**As a** customer, **I want** a reminder before my appointment, **so that** I am home when the provider arrives.

**Acceptance criteria**
- Given a `CONFIRMED` booking, when the reminder window before start is reached, then both parties are reminded.
- Given a reminder, when sent to the customer, then it arrives before the free-cancellation boundary passes where scheduling permits `[D-3]`.
- Given a booking is cancelled before its reminder window, when the window arrives, then no reminder is sent.

### NOT-003 — Email as the MVP channel `MVP` `P0`

**As a** platform, **I want** one reliable channel, **so that** notification scope stays contained.

**Acceptance criteria**
- Given any notification, when dispatched, then email is the delivery channel at MVP.
- Given email templates, when rendered, then they exist in both locales with correct RTL for Hebrew `[NFR-I18N]`.
- Given the notification dispatcher, when implemented, then the channel is abstracted so SMS or push can be added without changing callers.

### NOT-004 — SMS and push channels `POST-MVP`

Deferred. Email clears the bar; the NOT-003 abstraction is the hook.

### NOT-005 — Notification preferences `POST-MVP`

Deferred. All MVP notifications are transactional, which users cannot reasonably opt out of.

---

## 12. Epic: Admin & Operations (`OPS`)

**Goal.** The founder can run the marketplace. Manual by design at MVP `[D-4]`.

### OPS-001 — Vetting review queue `MVP` `P0` `[D-4]`

**As an** admin, **I want** to review provider applications, **so that** vetting actually happens.

**Acceptance criteria**
- Given providers in `PENDING_REVIEW`, when I open the queue, then I see them oldest-first with submitted documents accessible.
- Given an application, when I review it, then I can advance to `INTERVIEW_SCHEDULED`, reject with a recorded reason, or request more information.
- Given any decision, when recorded, then it is attributed and timestamped for audit.
- Given identity documents, when I access them, then the access is logged `[NFR-SEC-002]`.

### OPS-002 — Booking and payment operations view `MVP` `P0` `[SC-3]`

**As an** admin, **I want** to see bookings and payment states, **so that** I can intervene when something breaks.

**Acceptance criteria**
- Given bookings, when I search, then I can find them by customer, provider, state, or date range.
- Given a booking, when I open it, then I see its full state history with timestamps and its linked payment records.
- Given a failed capture or refund, when it occurs, then it appears in a dedicated exceptions view rather than requiring me to search for it.
- Given a payment exception, when I act on it, then I can retry the operation and the retry is idempotent (see PAY-002, PAY-003).

### OPS-003 — Manual refund and dispute resolution `MVP` `P0` `[SC-6]`

**As an** admin, **I want** to resolve disputes, **so that** trust survives things going wrong.

**Acceptance criteria**
- Given any booking, when I judge it warranted, then I can issue a full or partial refund outside the automatic rules, with a mandatory recorded reason.
- Given a disputed no-show (BOK-008), when I review it, then I can reverse the outcome and adjust the financial result accordingly.
- Given any manual financial action, when taken, then it is attributed, timestamped, and immutable in the audit record.

### OPS-004 — Provider standing `MVP` `P1` `[D-3]`

**As an** admin, **I want** to see provider reliability, **so that** `[D-3]`'s standing-based penalties are real rather than notional.

**Acceptance criteria**
- Given a provider, when I view standing, then I see cancellation count, no-show count, expiry/response rate, and completion rate.
- Given standing metrics crossing a defined threshold, when crossed, then the provider is flagged for review.
- Given a flagged provider, when I decide, then I can suspend or delist them, which removes them from discovery while preserving existing confirmed bookings for explicit resolution.

### OPS-005 — Manual payout trigger `MVP` `P0`

**As an** admin, **I want** to trigger payouts manually, **so that** providers get paid even if PAY-006 is cut.

**Acceptance criteria**
- Given a provider with a positive pending balance, when I trigger a payout, then it is initiated and reflected in PAY-004.
- Given a payout, when initiated, then it is idempotent against accidental repeat.

### OPS-006 — Booking funnel observability `MVP` `P1` `[SC-1]`

**As an** admin, **I want** to see where bookings fail, **so that** I know whether the product works.

**Acceptance criteria**
- Given the booking funnel, when I view it, then I see counts for discovery → profile view → slot selected → booking created → confirmed → completed.
- Given drop-off, when it occurs at a stage, then it is attributable to that stage rather than aggregated.
- Given payment failures, expiries, and declines, when they occur, then each is separately visible.

### OPS-007 — Agentic ops automation `POST-MVP`

Deferred to product Phase 3 per vision §6 Candidate C. Explicitly requires the audit trail established by OPS-002 and OPS-003 as its prerequisite.

---

## 13. Non-Functional Requirements (`NFR`)

### Performance

| ID | Requirement |
|---|---|
| **NFR-PERF-001** `MVP` | Discovery results render within 2s at p95 on a mid-range mobile device over 4G. |
| **NFR-PERF-002** `MVP` | Availability lookup for a provider returns within 500ms at p95. |
| **NFR-PERF-003** `MVP` | Booking submission completes — or fails clearly — within 5s at p95, including payment authorization. |
| **NFR-PERF-004** `MVP` | The app is usable on a 3-year-old mid-range Android device. This is the target device, not desktop Chrome. |

### Security & privacy

| ID | Requirement |
|---|---|
| **NFR-SEC-001** `MVP` `P0` | Card and bank details are handled exclusively by the payment provider's hosted components. Shearly systems never receive, log, or store raw payment credentials. This constrains design (Phase 3) and is non-negotiable. |
| **NFR-SEC-002** `MVP` `P0` | Identity documents and PII are encrypted at rest, access-restricted to admin roles, and every access is logged. |
| **NFR-SEC-003** `MVP` `P0` | Authentication endpoints are rate-limited. Credential-stuffing resistance is required, not optional. |
| **NFR-SEC-004** `MVP` `P0` | User enumeration is prevented on registration, sign-in, and password reset — responses do not reveal account existence. |
| **NFR-SEC-005** `MVP` `P0` | A customer's precise address and access notes are disclosed to a provider only once a booking is `CONFIRMED`, never while `PENDING`. |
| **NFR-SEC-006** `MVP` `P0` | Secrets are never committed. All credentials come from managed configuration. CI fails on detected secrets. |
| **NFR-SEC-007** `MVP` `P1` | All traffic over TLS; secure, httpOnly, sameSite session cookies. |
| **NFR-SEC-008** `MVP` `P1` | Authorization is enforced server-side on every request. A customer cannot read another customer's bookings by ID manipulation; a provider cannot read another provider's schedule. |

### Internationalization & RTL

| ID | Requirement |
|---|---|
| **NFR-I18N-001** `MVP` `P0` `[SC-4]` | Hebrew and English ship at MVP. Every user-facing string is externalized — no hardcoded display text. |
| **NFR-I18N-002** `MVP` `P0` `[SC-4]` | Hebrew renders with correct RTL layout: mirrored layout, correct bidirectional text handling, correctly positioned iconography. RTL is not a stylesheet afterthought (vision §5.4). |
| **NFR-I18N-003** `MVP` `P0` `[SC-4]` | Dates, times, numbers, and currency format per locale convention. |
| **NFR-I18N-004** `MVP` `P0` | Locale is selectable and persists across sessions for authenticated users. |
| **NFR-I18N-005** `MVP` `P0` `[SC-4]` | Every flow required by `[SC-1]` through `[SC-3]` is verified in both locales. A flow that works only in English does not meet its acceptance criteria. |
| **NFR-I18N-006** `MVP` `P1` | Notification and email templates exist and render correctly in both locales. |

### Accessibility

| ID | Requirement |
|---|---|
| **NFR-A11Y-001** `MVP` `P1` | WCAG 2.1 AA for the core booking flow: discovery, profile, slot selection, checkout, confirmation. |
| **NFR-A11Y-002** `MVP` `P1` | Full keyboard operability of the booking flow with visible focus indication. |
| **NFR-A11Y-003** `MVP` `P1` | Semantic markup and accessible names such that a screen reader can complete a booking. |
| **NFR-A11Y-004** `MVP` `P2` | Automated accessibility checks run in CI against the core flow. |

### Observability

| ID | Requirement |
|---|---|
| **NFR-OBS-001** `MVP` `P0` | Every booking state transition and every payment operation emits a structured, queryable event. |
| **NFR-OBS-002** `MVP` `P0` | Errors are captured with enough context to diagnose without reproduction. |
| **NFR-OBS-003** `MVP` `P1` | The funnel in OPS-006 is derivable from emitted events rather than separately instrumented. |
| **NFR-OBS-004** `MVP` `P1` | Payment failures, booking expiries, and refund failures raise operator-visible alerts. |

### Quality gates

| ID | Requirement |
|---|---|
| **NFR-CI-001** `MVP` `P0` `[SC-7]` | CI runs lint, type-check, unit and integration tests on every PR. Merge is blocked on failure. |
| **NFR-CI-002** `MVP` `P0` `[SC-7]` | Coverage threshold enforced; the specific figure is set in Phase 3. Payment and booking state-machine logic require the highest coverage in the codebase. |
| **NFR-CI-003** `MVP` `P0` `[SC-1]` | End-to-end tests cover the full booking happy path in both locales. |
| **NFR-CI-004** `MVP` `P0` `[SC-6]` | Automated tests cover: concurrent booking (BOK-002), each terminal state transition, both cancellation windows `[D-3]`, and refund idempotency. |
| **NFR-CI-005** `MVP` `P1` | Secret scanning and dependency vulnerability scanning run in CI. |

### Polish

| ID | Requirement |
|---|---|
| **NFR-UX-001** `MVP` `P0` `[SC-5]` | A single named design system is used throughout. No mixed component vocabularies. |
| **NFR-UX-002** `MVP` `P0` `[SC-5]` | Every asynchronous operation has a defined loading state; every failure has a defined, actionable error state. No dead ends. |
| **NFR-UX-003** `MVP` `P0` `[SC-5]` | Every list and collection has a designed empty state. No blank regions. |
| **NFR-UX-004** `MVP` `P0` `[SC-5]` | Responsive from 360px width upward. Mobile is the primary target. |
| **NFR-UX-005** `MVP` `P0` `[SC-5]` | No placeholder assets, lorem ipsum, or untranslated keys in any reachable state. |

---

## 14. Coverage Check: Success Criteria → Stories

Every MVP success criterion from vision §7 must be satisfied by at least one `P0` story.

| Criterion | Satisfied by |
|---|---|
| **SC-1** Demo completes unaided | CUS-001, CUS-005, DIS-001, DIS-004, DIS-005, BOK-001, PAY-001, NFR-UX-001…005, NFR-CI-003 |
| **SC-2** Both sides are real | BOK-001, BOK-003, BOK-007, PRV-002, AVL-001, AVL-004, PAY-004, NOT-001 |
| **SC-3** Money actually moves | PAY-001, PAY-002, PAY-003, OPS-002 |
| **SC-4** Hebrew not degraded | NFR-I18N-001…006 |
| **SC-5** It looks finished | NFR-UX-001…005 |
| **SC-6** Holds under inspection | BOK-002, BOK-004, BOK-005, BOK-006, BOK-008, OPS-003, NFR-CI-004 |
| **SC-7** CI gates green | NFR-CI-001…005 |

No criterion is unsatisfied.

---

## 15. MVP Story Count

| Epic | MVP `P0` | MVP `P1` | `MVP-STRETCH` | `POST-MVP` |
|---|---|---|---|---|
| CUS | 4 | 2 | 0 | 1 |
| DIS | 4 | 1 | 0 | 1 |
| BOK | 7 | 1 | 0 | 2 |
| PAY | 5 | 0 | 1 | 1 |
| PRV | 5 | 0 | 0 | 2 |
| AVL | 4 | 0 | 0 | 1 |
| RAT | 2 | 0 | 1 | 1 |
| NOT | 2 | 1 | 0 | 2 |
| OPS | 4 | 2 | 0 | 1 |
| **Total** | **37** | **7** | **2** | **12** |

46 functional stories in MVP scope, plus 36 non-functional requirements.

**Cut order under schedule pressure**, per vision §5.7 (fewer features, finished): `MVP-STRETCH` first (PAY-006, RAT-003), then `P2`, then `P1` in reverse epic priority. `P0` stories are not cut — if `P0` cannot be delivered, the MVP boundary itself is wrong and should be re-scoped explicitly rather than degraded silently.

---

## 16. Assumptions & Open Questions

### Assumptions made in this document

1. **One role per account.** A person cannot be both customer and provider on the same account (PRV-001). Simplifies authorization and navigation; a provider wanting to book uses a separate account. Reversible later.
2. **Provider response window and auto-complete window are configuration, not fixed values.** The stories specify behavior; the actual durations are a Phase 3 decision. BOK-004 constrains the response window to never exceed the slot start.
3. **Email is the only notification channel at MVP** (NOT-003), with the dispatcher abstracted for later channels. SMS would materially improve provider responsiveness, but adds cost and a delivery-provider dependency.
4. **Reviews require a completed booking** (RAT-001). No unsolicited reviews, which removes an entire moderation surface from MVP.
5. **Travel buffer may be approximate at MVP** (AVL-003) — a flat or coarse distance-banded buffer rather than live routing. Absence of buffering would be a correctness bug; approximation is acceptable.
6. **Aggregate ratings are stored, not computed at read time** (RAT-002). A performance decision surfaced at requirements level because it affects the acceptance criteria.

### Open questions for founder decision

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| **Q-1** | Provider response window — how long before a `PENDING` booking expires? | BOK-004 | 2 hours, capped at slot start |
| **Q-2** | Payout cadence — weekly, on-demand, or per-booking? | PAY-006 | Weekly, if PAY-006 ships at all |
| **Q-3** | Minimum booking lead time — can a customer book 20 minutes out? | DIS-005, BOK-001 | 2 hours minimum lead |
| **Q-4** | Discovery window — how far ahead can customers book? | AVL-001, DIS-005 | 30 days |
| **Q-5** | Provider standing thresholds — how many cancellations before review? | OPS-004 | 3 cancellations or 2 no-shows in 30 days |

These are narrower than the vision's `D-1`…`D-5` and each has a defensible default above. **They do not block Phase 3** — I will proceed on the defaults unless overridden, and each default is stated in the story it affects.

### Flagged for Phase 3 (Design)

- **The ranking seam (DIS-002)** is the one architectural commitment this document makes. Phase 3 must honor it explicitly — it is the entire hedge behind vision §6's "substitution rather than rewrite" claim.
- **Idempotency across PAY-002, PAY-003, OPS-005** is stated as an acceptance criterion but is genuinely a design concern. Phase 3 owes a concrete mechanism.
- **The booking state machine (§3)** should be implemented as an explicit, testable state machine rather than scattered status field mutations. NFR-CI-004 depends on this being enforceable.
- **NFR-SEC-005** (address disclosure gated on `CONFIRMED`) crosses service boundaries and needs deliberate design attention rather than being left to a UI condition.

---

## 17. Next Step

On approval, proceed to **MVP Preliminary Design** (`docs/mvp/03-design.md`): microservices breakdown, Nx monorepo layout, frontend and backend architecture, i18next/RTL strategy, CI/CD pipeline design with the AWS deployment target, and Stripe integration approach — implementing the stories in this document and honoring the four Phase 3 flags in §16.
