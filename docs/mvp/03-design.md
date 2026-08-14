# Shearly MVP — Preliminary Design

**Stage:** 3 of 4 (Preliminary Design)
**Scope:** MVP architecture. Post-MVP concerns appear only where MVP must not foreclose them.
**Status:** Draft, revised after design review — pending founder review
**Source:** `docs/kickoff.md`, `docs/mvp/mvp-kickoff.md`, `docs/01-vision.md`, `docs/mvp/02-requirements.md`

---

## 1. Design Goals and Constraints

### Fixed constraints (from kickoff, not re-litigated here)

| Constraint | Consequence for this design |
|---|---|
| Nx monorepo | One repo, Nx project graph, enforced module boundaries |
| Microservices-oriented | Service boundaries are real and enforced — see §2 for how this is honored at MVP scale |
| Real payments (Stripe) | Money moves; PCI surface must be zero |
| Hebrew + English, RTL first-class | Logical CSS properties throughout; RTL is not a stylesheet patch |
| CI/CD with testing + quality gates, AWS | ECS Fargate; merge blocked on gates |
| Modern GUI | A single named design system, chosen in §5 |
| Solo founder + Claude Code | Operational burden is a first-order design input, not an afterthought |

### The governing tension

The kickoff fixes *microservices-oriented*. The vision fixes *polish over breadth* (§5.7) and a solo operator. Six independently deployed services would satisfy the first constraint by directly damaging the second: six deploy pipelines, six log streams, and cross-service debugging — for one developer whose success criterion is a polished demo. One process does **not** erase the booking↔payments consistency problem; that saga is specified in §8.4.

**This design resolves the tension structurally rather than by picking a side.** Service boundaries are real, enforced by tooling, and drawn where a distributed system would draw them. The *deployment topology* starts as a single unit. The boundaries are the architecture; the deployment count is a runtime decision that §11 makes reversible.

---

## 2. System Architecture

### 2.1 Service boundaries

Six bounded contexts. Each owns its data, exposes a typed contract, and never reaches into another's storage.

| Service | Owns | Why this boundary |
|---|---|---|
| **identity** | Accounts, sessions, roles, password lifecycle, customer address book, guest drafts | Authentication is a distinct security perimeter; it changes for security reasons, not product reasons. Saved addresses are profile data, not booking data (§6.8) |
| **provider-catalog** | Provider profiles, services, pricing, vetting state, portfolio, reviews | Read-heavy, cache-friendly, and the only public-facing read surface. Its scaling profile is opposite to booking's. Review *submission* is gated by `booking` (§2.4) |
| **availability** | Availability rules, exceptions, slot computation, travel buffer | The most computationally distinct concern in the system; slot generation is an algorithm, not CRUD |
| **booking** | Bookings, the state machine, slot holds, occupancy intervals, address snapshots | The transactional core. Owns the invariant that a provider's occupancy does not overlap |
| **payments** | Stripe integration, authorizations, captures, refunds, commission ledger | Money. Isolated for auditability and because it is the highest-consequence failure domain |
| **notifications** | Templates, dispatch, delivery state, retry | Purely reactive, entirely async, no synchronous callers. Trivially separable |

**Deliberately not separate services at MVP:**

- **Reviews** live inside `provider-catalog`. A review has no lifecycle independent of the provider aggregate it rates, and splitting it would create a synchronous read dependency for every profile view.
- **Admin/ops** is a frontend application over existing service contracts, not a service. It owns no data.
- **Search/ranking** is not a service. The algorithm lives in `libs/domain/ranking` (§4). The single call site is the discovery composer in `apps/api` (§2.4). At MVP volume it has no independent scaling need.

### 2.2 Dependency direction

Dependencies point inward toward `identity` and outward toward `notifications`. No cycles.

```
                    ┌──────────────┐
                    │   identity   │  ← depended on by all, depends on none
                    └──────▲───────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────┴────────┐  ┌──────┴───────┐  ┌───────┴───────┐
│provider-catalog│◄─┤ availability │◄─┤    booking    │
└───────┬────────┘  └──────────────┘  └───────┬───────┘
        │                                     │
        │                              ┌──────▼───────┐
        │                              │   payments   │
        │                              └──────┬───────┘
        │                                     │
        └──────────────┬──────────────────────┘
                       ▼
                ┌──────────────┐
                │notifications │  ← depends on none; consumes events only
                └──────────────┘
```

Write-side orchestration stays in `booking` (create, transitions, payments saga). **Read composition does not.** Discovery, go-live, and provider schedule assemble data from more than one context; that work lives in `apps/api`, not inside `provider-catalog` or `availability`. See §2.4.

Services still do not import each other. Runtime calls go through `libs/contracts/*`. The diagram is the *write-ownership* graph, not the HTTP call graph.

### 2.3 Deployment topology at MVP

All six services deploy as **one containerized application** on ECS Fargate — a modular monolith in deployment, a service-oriented system in code.

**What makes this honest rather than a monolith with extra steps:**

1. **Boundaries are compiler-enforced.** Nx module boundary rules (§3.3) fail the build on any cross-service import that does not go through a published contract. This is not convention; it is CI.
2. **No shared database access.** Each service owns its schema and accesses only its own tables (§6.2). Cross-service reads go through contracts, even in-process.
3. **Async communication is already async.** Events go through a real queue (§6.4), not in-process function calls. Notification dispatch and settlement are already decoupled in the way they would be if distributed.
4. **Contracts are already network-shaped.** Service interfaces are defined as typed request/response contracts with no shared mutable state, so the in-process call can become an HTTP call without changing callers.

**What this buys the solo founder:** one deploy, one log stream, one set of environment variables, and local dev that starts with one command. It does **not** buy a shared transaction across `booking` and `payments` — schema grants forbid that. Those two contexts stay consistent via the saga in §8.4, whether they share a process or not.

**When to split** (§11 covers the mechanics): when a service needs independent scaling, an independent release cadence, or a different runtime. At MVP, none does.

> **Assumption flagged.** This is the design's most consequential interpretation of a fixed constraint. The kickoff says "microservices-oriented architecture" — I read *oriented* as describing the code's structure, and have made deployment topology the reversible variable. If the intent was independently deployed services from day one, this section is what to reject, and §11 describes what changes.

### 2.4 Composition root (`apps/api`)

`apps/api` is the only process that constructs service implementations. It is also the **read composer** for flows that span contexts. Services remain write-owners of their data.

| Flow | Composer does | Services still own |
|---|---|---|
| Discovery (DIS-001…005) | Load in-radius `APPROVED` providers from catalog; ask availability for next slots / occupancy; run `ProviderRanker` on the merged candidate set | Catalog: profiles, prices, ratings. Availability: rules, exceptions, slot computation |
| Go-live gate (PRV-005) | AND of catalog (`APPROVED` + ≥1 service), payments (Connect onboarded), availability (≥1 bookable window) | Each prerequisite stays in its schema |
| Review submit (RAT-001) | `booking` verifies the booking is `COMPLETED` and unreviewed, then calls `contracts/provider-catalog` to persist the review | Catalog stores the review and updates the stored aggregate |
| Alternatives (BOK-003/004/006) | Same discovery composer, constrained to the original slot / service type | — |

Ranking still has a **single call site** (§4.3). That site is the discovery composer in `apps/api`, not a catalog-internal query. The architecture test asserts no other module imports a concrete ranker.

If synchronous fan-out on discovery becomes a latency problem, the same composer reads a catalog search projection fed by `AvailabilityChanged`, `PayoutAccountReady`, and `BookingCompleted`. That is an optimization behind the same contract, not a new service.

---

## 3. Nx Monorepo Structure

### 3.1 Layout

```
shearly/
├── apps/
│   ├── web/                      # Customer + provider SPA (Next.js)
│   ├── web-e2e/                  # Playwright E2E
│   ├── admin/                    # Ops surface (OPS-001…006)
│   ├── api/                      # Backend host — composes all services
│   └── api-e2e/                  # API integration tests
│
├── libs/
│   ├── services/                 # ── Bounded contexts (backend) ──
│   │   ├── identity/
│   │   ├── provider-catalog/
│   │   ├── availability/
│   │   ├── booking/
│   │   ├── payments/
│   │   └── notifications/
│   │
│   ├── contracts/                # ── Cross-service API surface ──
│   │   ├── identity/             # Types + Zod schemas only.
│   │   ├── provider-catalog/     # No implementation, no dependencies
│   │   ├── availability/         # on service internals.
│   │   ├── booking/
│   │   ├── payments/
│   │   └── notifications/
│   │
│   ├── domain/                   # ── Pure domain logic, no I/O ──
│   │   ├── booking-state-machine/   # §7 — the state machine itself
│   │   ├── pricing/                 # Commission split, refund math [D-1][D-3]
│   │   ├── slot-computation/        # Availability algorithm, AVL-003
│   │   └── ranking/                 # §4 — the seam
│   │
│   ├── shared/                   # ── Cross-cutting infrastructure ──
│   │   ├── config/               # Typed env access, §9.2
│   │   ├── events/               # Event bus abstraction, §6.4
│   │   ├── observability/        # Structured logging, tracing
│   │   ├── errors/               # Error taxonomy, §6.5
│   │   └── testing/              # Test factories, fixtures
│   │
│   └── ui/                       # ── Frontend ──
│       ├── design-system/        # shadcn/ui components + tokens
│       ├── i18n/                 # i18next config, locale resources
│       ├── feature-discovery/    # DIS-001…005
│       ├── feature-booking/      # BOK-001…008 (customer side)
│       ├── feature-provider/     # PRV, AVL (provider side)
│       └── feature-account/      # CUS
│
└── tools/                        # Nx generators, scripts
```

### 3.2 Why `contracts` is separate from `services`

The single most important structural decision here. A service's contract library contains **only types and validation schemas** — no implementation, no imports from the service it describes.

This means `booking` can depend on `contracts/payments` without depending on `libs/services/payments`. The dependency graph stays acyclic, and when a service extracts to its own deployment (§11), its consumers already depend only on a contract that is trivially satisfiable over HTTP.

### 3.3 Enforced module boundaries

Nx tags with ESLint `enforce-module-boundaries`. Violations fail CI, not review.

| Tag | Projects | May depend on |
|---|---|---|
| `type:app-web` | `apps/web`, `apps/admin` | `type:feature`, `type:contract`, `type:ui`, `type:shared` |
| `type:app-api` | `apps/api` | `type:service`, `type:contract`, `type:domain`, `type:shared` |
| `type:app-e2e` | `apps/web-e2e`, `apps/api-e2e` | `type:contract`, `type:shared` |
| `type:service` | `libs/services/*` | `type:contract`, `type:domain`, `type:shared` |
| `type:contract` | `libs/contracts/*` | `type:contract`, `type:shared` |
| `type:domain` | `libs/domain/*` | `type:domain` only — **no I/O, no infrastructure** |
| `type:feature` | `libs/ui/feature-*` | `type:ui`, `type:contract`, `type:shared` |
| `type:ui` | `libs/ui/design-system`, `libs/ui/i18n` | `type:ui`, `type:shared` |
| `type:shared` | `libs/shared/*` | `type:shared` |

**The critical rule:** `type:service` may **not** depend on `type:service`. Cross-service communication goes through `type:contract` exclusively. This is the rule that makes §2.3's claim structurally true rather than aspirational.

**The composition rule:** only `type:app-api` may depend on `type:service`. That is the only place implementations are constructed. `apps/web` and `apps/admin` talk to the API over HTTP using contract types — they never import a service library.

A single `type:app` tag is forbidden: it cannot both host the Next.js UI and bind service implementations without either hiding the composition root from CI or letting the browser bundle import `libs/services/*`.

`type:domain` having no I/O dependency is what makes the state machine (§7) and pricing logic exhaustively unit-testable without any test double.

---

## 4. The Ranking Seam

Requirements DIS-002 and vision §6 both commit to this. It is the design's single deliberate hedge, so it is specified precisely.

### 4.1 The interface

Lives in `libs/domain/ranking`. Pure, no I/O.

```typescript
export interface ProviderRanker {
  rank(input: RankingInput): Promise<RankedProvider[]>;
}

export interface RankingInput {
  candidates: RankableProvider[];   // pre-filtered: in-radius, APPROVED, available
  customerLocation: GeoPoint;
  requestedService?: ServiceType;
  requestedWindow?: TimeWindow;
}

export interface RankedProvider {
  providerId: string;
  score: number;
  reasons: RankingReason[];   // present from day one — Phase 2 explainability
}
```

### 4.2 MVP implementation

`DeterministicRanker` — a weighted linear score over four signals, with **weights loaded from configuration, never literals** (DIS-002 acceptance criterion):

| Signal | Direction |
|---|---|
| Travel distance | Nearer ranks higher |
| Availability proximity | Sooner next slot ranks higher |
| Rating | Higher ranks higher, confidence-weighted by review count |
| Completion count | More completions rank higher, with diminishing returns |

Providers below the review-count threshold receive a neutral prior rather than a penalty, so RAT-002's "new provider" case is not structurally disadvantaged.

### 4.3 What makes the seam real

Four properties, each with a CI-enforced test:

1. **Single call site.** The discovery composer in `apps/api` (§2.4) resolves a `ProviderRanker` from configuration. An architecture test asserts no other module imports a concrete ranker implementation.
2. **Determinism.** Identical input yields identical output ordering. Property-based test.
3. **Substitutability.** A test injects a `StubRanker` returning reversed order and asserts the discovery endpoint reflects it with no caller change. **This is the acceptance criterion from DIS-002 that makes "substitution not rewrite" verifiable.**
4. **Graceful degradation.** Ranker throwing or exceeding its timeout falls back to a stable default sort (distance, then rating). Discovery never fails because ranking failed.

### 4.4 Phase 2 substitution path

An `AgenticRanker` implementing the same interface, selected by configuration. Because `RankingInput` carries no infrastructure types and `reasons` already exists, the agentic implementation needs no interface change. Config flag flip, not a rewrite.

---

## 5. Frontend Architecture

### 5.1 Framework: Next.js (App Router), React, TypeScript

**Justification.** Discovery (DIS-001…005) is the SEO-relevant, first-impression surface and benefits materially from server rendering; the booking flow is stateful and benefits from client interactivity. Next.js serves both in one application. It has first-class Vercel and AWS deployment paths, and the App Router's server components reduce client bundle size on exactly the pages where §5's polish bar and NFR-PERF-001 (2s p95 on 4G) are hardest to hit.

### 5.2 Design system: shadcn/ui + Tailwind CSS

**Justification** against NFR-UX-001 ("a single named design system, no mixed component vocabularies") and the kickoff's "modern GUI" bar:

- Components are **copied into the repo**, not imported as a dependency — full control over RTL behavior, which matters because third-party component RTL support is the usual failure point (NFR-I18N-002).
- Built on Radix primitives, which are accessible by construction — directly serves NFR-A11Y-001…003 rather than requiring retrofit.
- Tailwind's **logical properties** (`ms-*`, `me-*`, `ps-*`, `pe-*`) make RTL mirroring automatic rather than a parallel stylesheet. This is the mechanism behind §5.5.

Design tokens live in `libs/ui/design-system` as CSS custom properties. No component outside that library defines its own colors, spacing, or typography — the rule that keeps NFR-UX-001 true over time.

### 5.3 State management

Three distinct kinds of state, three mechanisms — deliberately not one global store:

| Kind | Mechanism | Rationale |
|---|---|---|
| Server state | TanStack Query | Caching, revalidation, optimistic updates. Most app state is server state |
| URL state | Next.js router params | Filters and search must be shareable and reload-survivable (DIS-003) |
| Local UI state | React state / context | Modals, form drafts. Never global |

No Redux. At this scope it would add ceremony without solving a problem TanStack Query does not already solve.

### 5.4 i18next integration

- `next-i18next` with locale-prefixed routes (`/he/...`, `/en/...`) — locale is addressable and shareable.
- **Every user-facing string externalized** (NFR-I18N-001). CI check fails the build on hardcoded display text in JSX.
- Namespaces per feature library, mirroring the `libs/ui/feature-*` split, so translation files stay reviewable.
- Locale persists on the user record (NFR-I18N-004) and is the source of truth for notification language (NOT-001).
- Dates, numbers, currency via `Intl` with the active locale (NFR-I18N-003) — never hand-formatted.

### 5.5 RTL strategy

RTL is a first-class citizen (vision §5.4), so the mechanism is structural rather than corrective:

1. `dir="rtl"` set on `<html>` from the route locale — one place, not per-component.
2. **Logical CSS properties everywhere.** `margin-inline-start`, never `margin-left`. Enforced by an ESLint rule banning physical direction properties in component styles. This is what makes RTL automatic instead of a second stylesheet.
3. **Directional icons mirror**; non-directional icons do not. A `<DirectionalIcon>` wrapper makes the distinction explicit rather than leaving it to per-usage judgment.
4. **Bidirectional text isolation** (`unicode-bidi: isolate`) on every field mixing scripts — Hebrew names with Latin service names, phone numbers, prices.
5. **Both locales in E2E.** NFR-I18N-005 and NFR-CI-003 require the full booking path to pass in Hebrew and English. A flow passing only in English fails its acceptance criteria.

---

## 6. Backend Architecture

### 6.1 API style: REST over HTTP, typed end to end

**Justification.** The client's data needs are known and stable — this is not a many-clients, unpredictable-query situation where GraphQL earns its complexity. REST keeps HTTP caching available for discovery (the read-heavy path where NFR-PERF-001 bites), keeps Stripe webhook handling conventional, and is materially simpler to secure and debug solo.

Contracts are Zod schemas in `libs/contracts/*`, shared by server and client. One definition produces runtime validation at the boundary and compile-time types in the browser — no drift, no generated-client build step.

### 6.2 Data storage

**PostgreSQL (AWS RDS), one instance, schema-per-service.**

| Service | Schema | Notable |
|---|---|---|
| identity | `identity` | Accounts, sessions, reset tokens, saved addresses (`geography(Point)`), guest drafts, auth rate-limit counters |
| provider-catalog | `catalog` | Providers, services, reviews, aggregates, vetting docs metadata, `document_access_log` |
| availability | `availability` | Rules, exceptions, computed slot cache |
| booking | `booking` | Bookings, address snapshots, state transition log, occupancy ranges |
| payments | `payments` | Payment records, commission ledger, Stripe refs |
| notifications | `notifications` | Templates, dispatch log, delivery state |

**Each service's DB user has grants only on its own schema.** This is the mechanism that makes "no shared database access" (§2.3) enforced by Postgres rather than by discipline — a service physically cannot read another's tables, which is precisely the guarantee separate databases would give.

One instance rather than six: at MVP volume, six RDS instances is cost and operational burden with no benefit. Schema separation plus grant isolation preserves the boundary that matters. Extraction (§11) is a `pg_dump` of one schema.

**Rejected: a document store.** This domain is relational — bookings reference providers, services, addresses, payments — and the invariants (§7) are exactly what a relational engine enforces well.

### 6.3 Inter-service communication

**Synchronous** — direct typed calls through contract interfaces. In-process at MVP; the call signature is already network-shaped (§2.3), so extraction changes the transport, not the caller.

**Asynchronous** — domain events over the event bus (§6.4). Used wherever the caller must not block on the consumer: notification dispatch, review aggregate updates, observability events.

**The rule:** if a failure in the callee must fail the caller, it is synchronous. Otherwise it is an event. Notification failure must never reverse a booking transition (NOT-001) — therefore events.

### 6.4 Event bus

`libs/shared/events` — publish/subscribe with a typed event catalog.

MVP transport: **PostgreSQL-backed outbox with a polling dispatcher.** Events are written in the same transaction as the state change they describe, then dispatched asynchronously.

**Why outbox rather than SQS at MVP:** it gives transactional guarantees the naive alternative does not — an event cannot be published for a transaction that rolled back, and a committed transaction cannot lose its event. That is the correctness property NOT-001 needs. Swapping the dispatcher to SQS/EventBridge later is a transport change behind the same interface.

Core events: `BookingStateChanged`, `PaymentCaptured`, `PaymentRefunded`, `PayoutInitiated`, `ReviewSubmitted`, `ProviderApproved`, `AvailabilityChanged`, `PayoutAccountReady`, `BookingCompleted`.

### 6.5 Error taxonomy

`libs/shared/errors` defines the categories every service uses: `ValidationError`, `NotFoundError`, `ConflictError` (BOK-002 slot contention), `AuthorizationError`, `PaymentError`, `ExternalServiceError`. Each maps to an HTTP status and a client-facing shape carrying a translation key rather than an English string — NFR-UX-002 requires every failure to have an actionable, localized state.

### 6.6 Time-triggered work

Expiry (BOK-004), auto-complete (BOK-007), reminders (NOT-002), deferred authorization (§8.1), and payout cadence (PAY-006 / OPS-005) are not request/response. The outbox dispatcher only delivers events that have already been written.

**MVP runner:** an in-process poller inside `apps/api` (same deploy as §2.3). It claims due rows with `FOR UPDATE SKIP LOCKED` and runs them through `transition()` or the payments saga. One lock row per due item; failed runs increment attempts and surface on OPS-002. Poll interval is configuration; it must stay inside NOT-001's one-minute bound.

Due work is data, not cron expressions in code:

| Table | Claimed when |
|---|---|
| `booking.bookings` | `PENDING` and `response_deadline <= now`; `CONFIRMED` and `auto_complete_at <= now` |
| `booking.reminders` | `CONFIRMED` and `remind_at <= now` and not yet sent |
| `payments.authorizations` | `SETUP_ONLY` and `authorize_after <= now`; or `AUTHORIZED` and `reauthorize_by <= now` |
| `payments.payouts` | positive pending balance and schedule due (or admin trigger) |

Extraction-time equivalent is EventBridge Scheduler behind the same “claim due work” interface. No separate worker service at MVP.

### 6.7 Identity, sessions, and guest drafts

NFR-SEC-007 requires secure, httpOnly, sameSite cookies. CUS-003 requires server-side logout. CUS-004 requires invalidating every session on password reset. A stateless JWT with no denylist cannot satisfy those.

| Concern | Mechanism |
|---|---|
| Session | Row in `identity.sessions`; cookie is an opaque id. Flags: `Secure`, `HttpOnly`, `SameSite=Lax`. Logout deletes the row. Reset deletes all rows for the account |
| Roles | Exactly one of `customer` \| `provider` \| `admin` per account (PRV-001). Admin uses the same identity service on `apps/admin` (`/admin` or `admin.` host) |
| Rate limit (NFR-SEC-003) | In-module counter in `identity` on register, sign-in, and reset. Sufficient while ECS `desiredCount = 1`. Named as a hole if that count rises — WAF or Redis then, not now |
| Enumeration (NFR-SEC-004) | Register / sign-in / reset return the same client shape whether the email exists or not. Divergence is a test failure |
| Mid-flow auth (CUS-001) | Guest slot + address live in a signed, short-TTL cookie (or `identity.guest_drafts`). After CUS-002/003 the composer restores the draft onto the booking request. Not left in `localStorage` alone — that fails the “selections intact” criterion on a different device/tab only if we also keep the cookie |

Password policy is configuration, validated before submit on the client and again in `identity`.

### 6.8 Address ownership and disclosure (NFR-SEC-005)

Requirements §16 flagged this as crossing service boundaries. It is not a UI condition.

- **Address book** lives in `identity` (label, point, access notes). The customer reuses it (CUS-005).
- **Booking snapshot** lives in `booking` at create time: full street address, access notes, and `geography(Point)`. Later edits to the address book do not mutate confirmed bookings.
- **Provider-facing contract** (`contracts/booking` provider DTO):
  - `PENDING` → `{ approxArea }` only (city / neighbourhood, not street or notes). AVL-004 / BOK-003.
  - `CONFIRMED` and later non-declined states → `{ fullAddress, accessNotes, point }`.
- **Customer-facing and admin contracts** see the full snapshot in every state.
- **List, search, discovery, availability, ranking, and notification payloads** never receive street-level fields. Decline / expiry / cancel emails use service type + time + approx area. Templates are reviewed against this list.
- **Architecture test:** a provider `PENDING` payload that contains a street, postcode, or access-note key fails CI.

`availability` computes travel against the snapshot **point** (or a coarse cell) after confirm; it never stores the street string.

### 6.9 Geo and distance

Radius filter (DIS-001, D-5), out-of-area (CUS-005), ranking distance, and AVL-003 buffers all need a point, not a string.

- Provider base location and customer addresses persist as `geography(Point)` (PostGIS on the single RDS instance).
- Radius is a SQL `ST_DWithin` against the 15 km cap `[D-5]`, not a post-filter in the app.
- Geocoding is a configured provider (Google or Mapbox — one key in Secrets Manager). Compose includes a stub that returns fixed points for seed addresses so local dev has no paid dependency.
- AVL-003 stays **approximate at MVP** (requirements Assumption 5): a coarse distance-banded buffer on top of the configured flat buffer, not live routing. Absence of buffering is a bug; live maps are not required.

### 6.10 Vetting-document storage (NFR-SEC-002)

Portfolio images and identity documents are not the same bucket.

| Asset | Store | Access |
|---|---|---|
| Portfolio (after approval) | Public S3 prefix + CloudFront | World-readable; uploaded only from `APPROVED` or during vetting as unpublished |
| Government ID, credentials | Private S3 prefix, SSE-KMS, no public ACL, no CloudFront | Admin-only short-lived pre-signed GET. Every GET writes `catalog.document_access_log` (actor, document, time) — OPS-001 |

Document bytes never enter `apps/web`, email templates, or logs. Metadata (filename, content type, checksum) lives in `catalog`.

---

## 7. The Booking State Machine

Flagged by requirements §16 as needing explicit design. It is the system's correctness core.

### 7.1 Explicit machine, not status mutations

`libs/domain/booking-state-machine` — pure, no I/O, exhaustively testable.

```typescript
export type BookingState =
  | 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'EXPIRED'
  | 'COMPLETED' | 'CANCELLED_BY_CUSTOMER' | 'CANCELLED_BY_PROVIDER'
  | 'NO_SHOW_CUSTOMER' | 'NO_SHOW_PROVIDER';

export interface TransitionResult {
  nextState: BookingState;
  effects: TransitionEffect[];   // declarative — refund, release hold, notify
}

export function transition(
  current: BookingState,
  event: BookingEvent,
  context: TransitionContext,   // clock, slot time, actor
): Result<TransitionResult, TransitionError>;
```

**Transitions return declarative effects rather than performing them.** The machine decides *what must happen*; the booking service executes it. This is what makes every transition — including its financial consequence — unit-testable with no test double, and it is the property NFR-CI-004 depends on.

### 7.2 Invariants enforced

1. **Terminal states are terminal.** No transition out of `COMPLETED`, `DECLINED`, `EXPIRED`, `CANCELLED_*`, `NO_SHOW_*`. Only OPS-003 admin action can adjust financial outcome, and it does so as a compensating record — never by mutating state backwards.
2. **Time-dependent transitions take an injected clock.** `[D-3]`'s 12-hour boundary and BOK-004's expiry are tested at exact boundaries, not by sleeping.
3. **Actor authorization is part of the transition.** A customer cannot trigger `DECLINED`; a provider cannot trigger `CANCELLED_BY_CUSTOMER`. Enforced in the domain, not only at the API edge.
4. **Every transition is logged** to `booking.state_transitions` with actor, timestamp, and reason — the audit trail OPS-002 requires and OPS-007 (Phase 3 agentic ops) is explicitly gated on.

### 7.3 Concurrency (BOK-002)

Occupancy uniqueness is enforced by the **database, not application logic**. A unique index on `(provider_id, slot_start)` is **not** sufficient: services have variable duration (PRV-004) and travel buffer applies before *and* after (AVL-003). Two creates with different starts that overlap in time would both pass that index.

Persisted occupancy for every holding booking (`PENDING` or `CONFIRMED`):

```
occupancy = tstzrange(
  slot_start - buffer_before,
  slot_end   + buffer_after,   -- slot_end = slot_start + service.duration
  '[)'
)
```

Storage invariant:

```sql
EXCLUDE USING gist (
  provider_id WITH =,
  occupancy   WITH &&
) WHERE (state IN ('PENDING', 'CONFIRMED'))
```

- Booking creation inserts the booking and this range in one `booking` transaction. The loser of a race receives an exclusion-violation, mapped to `ConflictError` → BOK-002's "just taken" response with alternatives from the discovery composer.
- Terminal transitions change `state` in the same transaction, which drops the row from the partial exclusion and frees the interval immediately.
- Slot computation still refuses overlaps when *offering* times. The constraint is what survives concurrent submit.

Application-level checking alone cannot satisfy BOK-002's concurrent-load test. The exclusion constraint can. The integration test must use overlapping different starts, not only identical `slot_start`.

### 7.4 Transition table

Oracle for NFR-CI-004. The machine rejects every pair not listed. Effects are declarative; `booking` executes them via contracts (payments, notifications) and its own writes (hold, standing event).

`BookingEvent` values: `ProviderAccepts`, `ProviderDeclines`, `ResponseDeadlinePassed`, `CustomerCancels`, `ProviderCancels`, `ProviderCompletes`, `AutoCompleteElapsed`, `ProviderReportsCustomerNoShow`, `CustomerReportsProviderNoShow`.

Create (`CustomerBooks`) is not a transition. It is the saga in §8.4 and lands in `PENDING`.

| From | Event | Guard | To | Effects |
|---|---|---|---|---|
| `PENDING` | `ProviderAccepts` | actor = provider | `CONFIRMED` | `Notify(customer, provider)`, address becomes revealable |
| `PENDING` | `ProviderDeclines` | actor = provider | `DECLINED` | `ReleaseAuth`, `ReleaseHold`, `Notify(customer)` + alternatives |
| `PENDING` | `ResponseDeadlinePassed` | system; `now >= min(response_window, slot_start)` | `EXPIRED` | `ReleaseAuth`, `ReleaseHold`, `Notify(customer, provider)`, `RecordStanding(response_miss)` |
| `PENDING` | `CustomerCancels` | actor = customer | `CANCELLED_BY_CUSTOMER` | `ReleaseAuth`, `ReleaseHold`, `Notify(provider)` |
| `CONFIRMED` | `CustomerCancels` | actor = customer; `slot_start - now > 12h` | `CANCELLED_BY_CUSTOMER` | `Refund(100%)` or `ReleaseAuth` if still uncaptured, `ReleaseHold`, `Notify(provider)` |
| `CONFIRMED` | `CustomerCancels` | actor = customer; `slot_start - now <= 12h` | `CANCELLED_BY_CUSTOMER` | `Capture(50%)` then `Split` (or `Refund(50%)` if already captured), `ReleaseHold`, `Notify(provider)` |
| `CONFIRMED` | `ProviderCancels` | actor = provider | `CANCELLED_BY_PROVIDER` | `Refund(100%)` or `ReleaseAuth`, `ReleaseHold`, `RecordStanding(provider_cancel)`, `Notify(customer)` + alternatives |
| `CONFIRMED` | `ProviderCompletes` | actor = provider; `now >= slot_start` | `COMPLETED` | `Capture(100%)`, `Split`, `Notify(customer, provider)`, review prompt |
| `CONFIRMED` | `AutoCompleteElapsed` | system; `now >= slot_end + auto_complete_window` | `COMPLETED` | same as `ProviderCompletes` |
| `CONFIRMED` | `ProviderReportsCustomerNoShow` | actor = provider; `now >= slot_start` | `NO_SHOW_CUSTOMER` | `Capture(100%)`, `Split`, `Notify(customer)` + dispute path |
| `CONFIRMED` | `CustomerReportsProviderNoShow` | actor = customer; `now >= slot_start` | `NO_SHOW_PROVIDER` | `Refund(100%)` or `ReleaseAuth`, `RecordStanding(provider_no_show)`, `Notify(provider)` |

OPS-003 admin refunds and no-show reversals **do not appear in this table**. They write compensating payment rows and an audit record; they never move a terminal state backwards (§7.2.1).

`ReleaseHold` is the state change that drops the exclusion row. `Split` is the §8.3 ledger write (gross / commission / net) plus Stripe `application_fee_amount`.

---

## 8. Payments and Money

### 8.1 Stripe integration and PCI posture

**NFR-SEC-001 is non-negotiable: zero PCI surface.**

- **Stripe Elements** collects card data in a Stripe-hosted iframe. Card details never touch Shearly servers, logs, or storage.
- **Payment Intents** with `capture_method: manual` when an authorization is taken — capture at completion or per the late-cancel / no-show rows in §7.4 (PAY-001, PAY-002). **Uncaptured PaymentIntents expire after 7 days** (Stripe default). The adopted 30-day discovery window (Q-4) is longer than that hold. Authorize-at-create is therefore **not** a single PaymentIntent for every booking; see the window rule below.
- **Stripe Connect (Express)** for provider payouts. Providers onboard through Stripe-hosted flows (PAY-005); Shearly never handles bank credentials.
- **Commission via `application_fee_amount`** — the 20% split `[D-1]` is executed by Stripe at capture, not by Shearly moving money.

**Webhooks** are the source of truth for payment state. Signature-verified, idempotent by `event.id`, processed asynchronously. Shearly never infers payment success from a client-side callback.

**Authorization window (PAY-001, Q-4).** Card data is collected once, via Stripe Elements, at booking confirm. What happens next depends on how far away the slot is. Let `auth_horizon` be configuration defaulting to 6 days (one day inside Stripe's 7-day uncaptured-PI cancellation).

| Slot start | At BOK-001 | Later |
|---|---|---|
| `slot_start - now <= auth_horizon` | Create and confirm a manual-capture PaymentIntent. If that authorization fails, **no booking is created** (PAY-001). | Capture / release / refund per §7.4 |
| `slot_start - now > auth_horizon` | Confirm a SetupIntent (card on file). If setup fails, **no booking is created**. Persist `payments.authorizations` as `SETUP_ONLY` with `authorize_after = slot_start - auth_horizon`. | §6.6 worker creates the manual-capture PaymentIntent off-session. Success → `AUTHORIZED`. Failure → customer + ops notified; booking is **not** silently left unfunded. Completion / late-cancel / no-show cannot capture what was never authorized — those paths wait on a successful PI or OPS-003 |

This keeps the 30-day book window, keeps PCI at zero, and meets PAY-001's “never silently expired.” It is a deliberate reading of “authorized when I confirm” for far-future slots: the card is bound at confirm; the hold is placed when Stripe can still honor it. Shrinking Q-4 to `auth_horizon` is the fallback if off-session authorize proves unreliable in the launch market.

### 8.4 Booking ↔ payments saga

One process does not give these two schemas a shared transaction. Grant isolation is the point of §6.2. Consistency is a saga. `bookingAttemptId` (client `Idempotency-Key` on `POST /bookings`) is the saga id.

**Create (inside `auth_horizon`):**

1. Persist `payments.operations` as `authorize:{bookingAttemptId}` (`pending`) — unique key, so retries short-circuit.
2. Create + confirm the PaymentIntent with Stripe idempotency key `authorize:{bookingAttemptId}`.
3. If Stripe fails: mark the operation `failed`, return `PaymentError`. No booking row.
4. If Stripe succeeds: in the **booking** transaction, insert booking + occupancy range. On exclusion-violation: cancel the PaymentIntent (`cancel:{bookingAttemptId}`), return `ConflictError`.
5. If the process dies after step 2 and before step 4: the PI exists with no booking. The webhook / reconciler cancels orphan authorizations older than a short grace that have no matching booking. The customer can retry with the same key.

**Create (beyond `auth_horizon`):** steps 1–3 use a SetupIntent (`setup:{bookingAttemptId}`) instead of a PI. Step 4 inserts the booking with `SETUP_ONLY`. No orphan hold to cancel; an orphan setup is harmless.

**Later effects** (`Capture`, `Refund`, `ReleaseAuth`, `Split`) are executed by `booking` after `transition()` returns them, each with its own operations-ledger key. Failure of a payment effect does **not** roll back the booking state already committed — PAY-002: the booking stays `COMPLETED` (or the terminal it reached), the failure lands on OPS-002, retry is idempotent.

There is no superuser DB role that writes both schemas “to avoid the saga.” If that temptation appears during implementation, the boundary was abandoned.

### 8.2 Idempotency

Flagged by requirements §16. Three layers:

1. **Stripe idempotency keys** on every mutating API call, derived deterministically from the operation: `authorize:{bookingAttemptId}`, `setup:{bookingAttemptId}`, `cancel:{bookingAttemptId}`, `capture:{bookingId}`, `refund:{bookingId}:{reason}`. A retry with the same key returns the original result rather than acting twice. `POST /bookings` requires a client `Idempotency-Key` (the attempt id).
2. **Local operation ledger.** `payments.operations` records every attempted operation with its key, state, and result, under a unique constraint on the key. A duplicate attempt short-circuits.
3. **Effects are idempotent by construction.** The commission ledger is append-only; balance is derived by summation, never by incrementing a mutable field. A replayed event cannot double-credit.

This is what makes PAY-002, PAY-003, and OPS-005's idempotency acceptance criteria enforceable rather than aspirational.

### 8.3 The commission ledger

Append-only, double-entry-shaped. Each completed booking writes gross, commission, and net as **separate persisted rows** — PAY-002 requires these be independently auditable, not derived at read time. Provider balance is the sum of net entries minus payouts. Reconstructable from history at any point.

---

## 9. Development Environment

### 9.1 Local setup

```bash
pnpm install
docker compose up -d      # Postgres+PostGIS, Mailhog, Stripe CLI, geocoder stub
pnpm nx run api:migrate
pnpm nx run-many -t serve -p web,api,admin
```

One command per surface, no service orchestration to reason about — the concrete payoff of §2.3's topology decision. Docker Compose covers only true external dependencies: Postgres (PostGIS image), Mailhog (email capture), the Stripe CLI forwarding webhooks to localhost, and a geocoder stub. The §6.6 poller runs inside `api`.

Seed data provisions approved providers with availability, so discovery and booking are exercisable immediately without manual setup.

### 9.2 Configuration

- **Typed access only.** `libs/shared/config` parses `process.env` through a Zod schema at startup. Missing or malformed configuration fails fast at boot, never at first request.
- **No direct `process.env` access** outside that library. ESLint-enforced.
- `.env.example` committed and complete; `.env` git-ignored.
- **Secrets never in the repo** (NFR-SEC-006). Local uses `.env`; deployed uses AWS Secrets Manager injected as ECS task secrets. CI runs secret scanning and fails on detection.
- Market-dependent values — currency, radius cap `[D-5]`, locale set, commission rate `[D-1]` — are configuration, never literals. This is the vision's "market is configuration" commitment made concrete.

---

## 10. CI/CD and Testing

### 10.1 Pipeline

GitHub Actions, using `nx affected` so only impacted projects run.

| Stage | Gate |
|---|---|
| 1. Setup | Install, restore Nx cache |
| 2. Lint & format | ESLint (incl. module boundaries §3.3), Prettier |
| 3. Type check | `tsc --noEmit` across affected |
| 4. Unit tests | Vitest, coverage thresholds enforced |
| 5. Integration tests | Real Postgres in a service container |
| 6. Build | Next.js + API bundles |
| 7. E2E | Playwright against built app, **both locales** |
| 8. Security | Secret scan, dependency audit |
| 9. Deploy | Image to ECR, ECS service update — main only |

**Merge is blocked on 1–8** (NFR-CI-001). Not advisory.

### 10.2 Testing strategy

**This section incorporates the master integration test plan**, per the decision to fold it into design rather than draft it against undecided boundaries.

**Unit** — pure domain logic, no doubles required because `type:domain` has no I/O:
- Booking state machine: every transition, every rejection, boundary times via injected clock
- Pricing: commission `[D-1]`, both refund windows `[D-3]`, rounding
- Slot computation: buffers (AVL-003), overlaps, timezone edges
- Ranking: determinism, degradation (§4.3)

**Integration** — real Postgres, Stripe in test mode, per service boundary:

| Area | Must cover |
|---|---|
| Booking concurrency | Parallel overlapping occupancy (same start *and* different starts that overlap duration/buffer) → exactly one succeeds (BOK-002) |
| Payment lifecycle | Authorize → capture → split; authorize → release; capture → refund |
| Idempotency | Every operation in §8.2 replayed; asserts single effect |
| Webhooks | Replayed and out-of-order Stripe events |
| Outbox | Event published iff transaction committed |
| Authorization | Cross-tenant access denied (NFR-SEC-008); provider `PENDING` DTO has no street/notes (NFR-SEC-005 architecture test) |
| State transitions | Every terminal state reached through the API with correct financial effect (NFR-CI-004) |

**E2E (Playwright)** — the demo paths, both locales (NFR-CI-003):
1. Anonymous browse → book → authenticate mid-flow → pay → confirmation `[SC-1]`
2. Provider accepts → completes → earning visible `[SC-2]`
3. Cancellation inside and outside the 12h window, asserting the stated amounts `[D-3]`
4. Decline and expiry paths `[SC-6]`
5. Accessibility assertions on the booking flow (NFR-A11Y-004)

**Coverage thresholds** (NFR-CI-002): 90% for `libs/domain/*` and `libs/services/payments` — the code where a defect costs money or breaks the core invariant. 80% elsewhere. Justified by consequence rather than applied uniformly.

### 10.3 AWS deployment target: ECS Fargate

**Justified against alternatives, per the kickoff's requirement to propose and justify:**

| Option | Verdict |
|---|---|
| **ECS Fargate** | **Chosen.** Container-based with no cluster to manage. Scales to a small always-on footprint at MVP cost. Critically: when a service extracts (§11), it becomes an additional ECS service — the deployment model does not change, only the service count |
| EKS | Rejected. Kubernetes' flexibility is real and its operational burden is also real. For one developer whose success criterion is a polished demo, it is the wrong place to spend attention |
| Amplify / App Runner | Rejected. Fastest to stand up, but opinionated in ways that would fight a multi-service backend later. Choosing it would trade a week now for a migration later |
| Lambda | Rejected. Cold starts jeopardize NFR-PERF-001/003, and the always-warm workload does not suit per-invocation pricing |

**Topology:** ALB → one ECS Fargate task running two processes (Next.js standalone + `apps/api` on localhost) → RDS Postgres + PostGIS (Multi-AZ off at MVP). ALB rules: `/` → web, `/api` → API, `/admin` → admin (or `admin.` host; same task). SSR talks to the API over loopback.

**Also on the diagram:** public S3 + CloudFront (portfolio), private S3 + KMS (vetting docs), SES (prod email; Mailhog locally), Secrets Manager (Stripe, geocoder, session signing key), CloudWatch logs + alarms, Sentry per DQ-3.

**Named alarms (NFR-OBS-004):** payment capture failure, refund failure, booking expiry spike, orphan-authorization reconciler action, SES bounce rate.

**Deployment:** rolling update with health checks. Migrations run as a pre-deploy ECS task, forward-only and backward-compatible so a rollback never strands the schema. `desiredCount = 1` at MVP; that is the condition under which the in-module auth rate limiter is sufficient (§6.7).

---

## 11. Extraction Path

The design's central claim is that service boundaries are real and the deployment count is reversible. This is what makes it verifiable rather than rhetorical.

To extract a service (e.g. `payments`) into an independent deployment:

1. **No caller changes.** Consumers already depend on `libs/contracts/payments`, never on the implementation (§3.2, enforced §3.3).
2. **Swap the transport.** Replace the in-process contract implementation with an HTTP client satisfying the same interface. One binding changes.
3. **Move the schema.** `pg_dump` the `payments` schema to its own instance. No other service reads those tables — enforced by grants (§6.2), so nothing else breaks.
4. **Point the events at a broker.** The outbox dispatcher targets SQS instead of in-process handlers. Publishers and subscribers are unchanged (§6.4).
5. **Add an ECS service.** Same deployment model, one more service (§10.3).

**No step requires rewriting business logic.** If a step in this list turns out to be false when attempted, the boundary was not real — which is why §3.3's boundary rules are CI-enforced rather than documented conventions.

---

## 12. Agentic AI Placement

Vision §6 concluded **no agentic AI ships in MVP**; the sole architectural commitment is the ranking seam.

| Candidate | Placement | Architectural provision made now |
|---|---|---|
| A — Conversational booking | Phase 2 | Booking and availability contracts (§3.2) are already tool-callable shapes: typed, side-effect-explicit, independently invocable |
| B — Agentic ranking | Phase 2 | **The seam (§4).** Config-selected implementation, `reasons` already in the return type |
| C — Agentic ops | Phase 3 | The state transition log (§7.2) and payment operation ledger (§8.2) are the audit trail this requires. Explicitly gated on them |

**No LLM dependency, provider SDK, or inference infrastructure is introduced at MVP.** The provisions above are ordinary good design that happens to be what these features will need.

---

## 13. Design Decisions Summary

| # | Decision | Alternative rejected |
|---|---|---|
| 1 | Six bounded contexts, one deployment | Six independent services — 6× ops burden for a solo founder at zero MVP benefit |
| 2 | Nx module boundaries CI-enforced; `type:app-api` vs `type:app-web` | A single `type:app` tag — either hides the composition root or lets the UI import services |
| 3 | Contracts separate from implementations | Direct service imports — creates cycles, blocks extraction |
| 4 | One Postgres, schema-per-service + grants | Six instances (cost); shared schema (destroys the boundary) |
| 5 | REST + Zod contracts | GraphQL — complexity without a many-clients problem |
| 6 | Next.js App Router | SPA + separate API — loses SSR where NFR-PERF-001 is hardest |
| 7 | shadcn/ui + Tailwind logical properties | Component library dependency — RTL control is the usual failure point |
| 8 | Explicit state machine returning effects | Status field mutations — untestable, unenforceable |
| 9 | GiST exclusion on occupancy range (service + buffer) | Unique index on `slot_start` — misses overlapping durations |
| 10 | Stripe Elements + Connect + application fees | Custom payment handling — unacceptable PCI surface |
| 11 | Three-layer idempotency including authorize/setup keys | Trusting retry safety — silently double-charges |
| 12 | Transactional outbox | Direct publish — loses events on rollback |
| 13 | ECS Fargate | EKS (burden), Amplify (later migration), Lambda (cold starts) |
| 14 | Consequence-weighted coverage thresholds | Uniform threshold — spends effort where defects are cheap |
| 15 | SetupIntent now + deferred PI outside `auth_horizon` | Always-manual-capture at book (silently dies at 7 days) or shrink Q-4 |
| 16 | Booking↔payments saga; no cross-schema transaction | Superuser unit-of-work — abandons grant isolation |
| 17 | `apps/api` is the read composer | Catalog calling availability / payments synchronously as if it owned them |
| 18 | Server-side sessions + httpOnly cookies | Stateless JWT — cannot satisfy CUS-003/004 or NFR-SEC-007 |
| 19 | Addresses in identity; snapshot + DTO gate in booking | UI-only hide of the street while `PENDING` |
| 20 | In-process due-work poller in `api` | No scheduler — expiry, auto-complete, reminders, and deferred auth never fire |

---

## 14. Assumptions and Open Questions

### Assumptions

1. **"Microservices-oriented" describes code structure; deployment count is the reversible variable** (§2.3). The design's most consequential interpretation of a fixed constraint. §11 is the escape hatch, and it is testable. It does **not** mean booking and payments share a transaction.
2. **One Postgres instance with schema isolation is a real boundary.** Grant-level isolation gives the guarantee that matters; separate instances would add cost and operational surface without adding safety at MVP.
3. **Reviews belong to `provider-catalog`.** No independent lifecycle; separating them would add a synchronous dependency to every profile view. Submission is still gated by `booking` (§2.4).
4. **The outbox dispatcher is adequate at MVP volume.** Polling latency is well inside NOT-001's one-minute target. Revisit if event volume grows materially.
5. **Stripe Connect Express is the payout mechanism.** Assumes providers accept Stripe onboarding. If a local payout rail becomes necessary, §8's boundary contains the change.
6. **Q-1…Q-5 defaults from requirements §16 are adopted** — response window 2h, weekly payouts, 2h lead, 30-day window, standing thresholds. All are configuration (§9.2). The 30-day window is implemented with §8.1's `auth_horizon`, not with a 30-day uncaptured PaymentIntent.
7. **`desiredCount = 1` at MVP.** The in-module auth rate limiter and the in-process poller both assume that. Scaling out is an extraction-time change, not a silent replica of those two.

### Open questions for founder decision

| # | Question | Impact | Default if unanswered |
|---|---|---|---|
| **DQ-1** | Custom domain and hosted zone in Route 53 at MVP? | Deployment config, TLS setup | Yes — required for a credible demo |
| **DQ-2** | Staging environment, or preview deploys only? | Pipeline cost and complexity | Preview per PR + production only; no persistent staging |
| **DQ-3** | Error tracking — Sentry or CloudWatch alone? | NFR-OBS-002 fidelity | Sentry; CloudWatch alone makes solo debugging materially harder |
| **DQ-4** | Portfolio image moderation before public display? | PRV-004 flow, admin load | Admin reviews images during vetting (OPS-001); no separate queue |
| **DQ-5** | Far-future bookings: SetupIntent + deferred authorize, or cap Q-4 at `auth_horizon`? | PAY-001 shape, demo book-ahead | SetupIntent + deferred PI (§8.1). Cap Q-4 only if off-session authorize fails in the launch market |

DQ-1…DQ-4 remain configuration/tooling. **DQ-5 is the only new founder call**; the default is already written into §8.1 so planning is not blocked.

Parked implementation defaults (not founder questions — the plan may use these without further design):

| # | Topic | Default |
|---|---|---|
| **OQ-1** | Who composes discovery / reviews / go-live? | `apps/api` (§2.4) |
| **OQ-2** | Job runner | In-process poller + `FOR UPDATE SKIP LOCKED` (§6.6) |
| **OQ-3** | Session mechanism | Server-side sessions, httpOnly Secure SameSite=Lax (§6.7) |
| **OQ-4** | Guest booking draft | Signed short-TTL cookie / `identity.guest_drafts` (§6.7) |
| **OQ-5** | Geocoding | Configured provider + PostGIS points + Compose stub (§6.9) |
| **OQ-6** | ID-document store | Private S3 + KMS + `document_access_log` (§6.10) |
| **OQ-7** | Auth rate limit | In-module limiter while `desiredCount = 1` (§6.7) |
| **OQ-8** | Admin deploy + auth | Same task, `/admin` or `admin.` host, `role=admin` |
| **OQ-9** | Email + alarms | SES + the named CloudWatch alarms in §10.3 |
| **OQ-10** | App Router i18n library | Keep i18next resource format; use a known-good App Router adapter (`next-intl` or equivalent). Do not block on `next-i18next` if it fights the App Router |
| **OQ-11** | State-machine fixture | §7.4 is the oracle; lock it as a test fixture in the first booking milestone |

### Flagged for the Implementation Plan (stage 4)

- **Build order should follow the write-ownership graph** (§2.2): `identity` → `provider-catalog` → `availability` → `booking` → `payments` → `notifications`. The discovery composer in `apps/api` is wired once those contracts exist; it is not a seventh service.
- **The skeleton must come first** — Nx workspace, the **split** app tags in §3.3 (`type:app-api` vs `type:app-web`), and the CI pipeline before feature work. Boundary rules added late are boundary rules already violated.
- **The seam's substitutability test (§4.3.3) should exist from the first ranking commit**, not be retrofitted. It is the only thing that keeps §4 honest.
- **Both-locale E2E should be established with the first E2E test**, not added at the end. Retrofitting RTL coverage is how RTL becomes second-class in practice.
- **The occupancy exclusion and the §8.4 saga belong in the first booking/payments milestones**, not as polish. They are the money path.
- **The §7.4 table is the NFR-CI-004 fixture.** Implement tests from it; do not re-derive transitions from the stories in the service layer.

---

## 15. Design-review addendum

This section records what the post-review revision changed and what it deliberately did **not** reopen.

**Stack choices that still hold:** Nx monorepo; six bounded contexts in one Fargate deployment; REST + Zod contracts; Next.js App Router; shadcn/ui + Tailwind logical properties; PostgreSQL schema-per-service + grants; Stripe Elements + Connect Express + `application_fee_amount`; transactional outbox; ranking seam; merge-blocking CI; no LLM in MVP.

**Corrected (were wrong or unsafe as written):**

| Was | Now |
|---|---|
| Unique index on `(provider_id, slot_start)` | GiST exclusion on occupancy range including buffer (§7.3) |
| One process ⇒ no booking/payments distributed transaction | Saga with orphan-PI reconciler; grants stay (§8.4) |
| Manual-capture PI at book for a 30-day window | SetupIntent + deferred PI outside `auth_horizon` (§8.1) |
| NFR-SEC-005 as an integration-test bullet | Ownership, snapshot, provider DTO gate, architecture test (§6.8) |
| `type:app` may not depend on `type:service` | `type:app-api` may; `type:app-web` may not (§3.3) |
| `booking` is the only orchestrator | `booking` orchestrates writes; `apps/api` composes reads (§2.4) |
| “Five” independently deployed services | Six |

**Added so P0 mechanisms are not invented in the plan:** identity/sessions/guest draft (§6.7), due-work poller (§6.6), geo/PostGIS (§6.9), private vetting-doc store (§6.10), transition table (§7.4), process graph and SES/alarms (§10.3).

**Still a founder question:** DQ-5 (keep 30-day window with deferred authorize, or cap book-ahead). Default is written.

Requirements §16 Phase-3 flags after this revision: ranking seam specified; payment idempotency specified (including authorize/setup keys); state machine specified (shape + table); NFR-SEC-005 specified.

---

## 16. Next Step

On approval, proceed to **MVP Implementation Plan** (`docs/mvp/04-implementation-plan.md`): the concrete story slice for MVP, build sequencing and milestones, branch/PR workflow tied to the §10.1 gates, post-MVP roadmap, and a Definition of Done matching the submission bar. The plan should take this document — including §15 — as decided architecture, not re-open it.
