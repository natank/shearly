# M2 — Supply

**Milestone ID:** `M2`  
**Master:** [04-implementation-plan.md](./04-implementation-plan.md) — §4 M2, §5 PRV-002…005 / PAY-005 / AVL-001…004 / OPS-001  
**Design:** `docs/mvp/03-design.md` §2.2–§2.4 (catalog / availability / composer), §6.2, §6.9–§6.10, §8.1 Connect  
**Requirements:** PRV-002, PRV-003, PRV-004, PRV-005, PAY-005, AVL-001, AVL-002, AVL-003, AVL-004, OPS-001. NFR-SEC-002.  
**Depends on:** M1 complete  
**Unlocks:** M3 honest discovery  
**Status:** Complete  
**Implementation:** shipped on `main` 2026-08-15 (merge of [#30](https://github.com/natank/shearly/pull/30))

---

## 1. Traceability

This file may not add, drop, or move stories. The master map is the source of truth.

| Master claim | This plan |
|---|---|
| Goal: vetted provider with a menu and a calendar | §2 |
| Builds: catalog + availability; vetting + private docs; admin queue; services + radius; rules/exceptions/buffer; Connect; go-live checklist | PRs `M2-P1`…`M2-P7` |
| Stories: PRV-002…005, PAY-005, AVL-001…004, OPS-001 | §1 table |
| NFR-SEC-002 | private store + access log |
| Exit: founder approves after seeing ID; 60-min service + weekly pattern + day off; go-live names missing prereqs | §6 |
| Not in M2: public discovery, ranking, customer profile | §7 |

| ID | Pri | Coverage in M2 | Notes |
|---|---|---|---|
| PRV-002 | P0 | application packet + submit → `PENDING_REVIEW` | 1 ID, 1 credential, ≥5 portfolio photos. Incomplete submit lists missing items |
| PRV-003 | P0 | admin: `INTERVIEW_SCHEDULED` / `APPROVED` / `REJECTED` | Call is out of band; we store actor, time, rationale |
| PRV-004 | P0 | bio, base lat/lng, radius ≤ cap, services | Price UI states travel-included + 20% commission; net shown before save |
| PRV-005 | P0 | go-live checklist in `apps/api` | Discoverable flag is written; **public listing is M3** |
| PAY-005 | P0 | Connect Express hosted link **or** local stub | No live keys required. Incomplete blocks go-live |
| AVL-001 | P0 | weekly windows per weekday | Slot gen across `DISCOVERY_WINDOW_DAYS` (default 30) |
| AVL-002 | P0 | block day / extra windows | Blocking a day with fixture `CONFIRMED` occupancy is rejected with those ids |
| AVL-003 | P0 | buffer both sides + coarse distance band | Domain `slot-computation`. No live routing. Confirmed occupancy is a **fixture** (no booking rows) |
| AVL-004 | P0 | provider schedule surface | Real `PENDING`/`CONFIRMED` bookings do not exist; UI lists fixture occupancy + live pending-none; tests inject fixtures |
| OPS-001 | P0 | admin queue oldest-first | Decisions attributed. Doc GET writes `document_access_log` |
| NFR-SEC-002 | P0 | private store; admin-only GET; log | Local filesystem backend. S3 if AWS env later. Bytes never in logs or JSON |
| NFR-SEC-008 | P1 | provider A cannot read B's catalog/availability | Integration tests |

Vetting **state** lives in `catalog.providers`. Identity's `provider_vetting_status` stays a register default; M2 transitions write catalog only. `apps/api` creates a catalog draft row when a provider registers (services must not call each other).

Local Postgres stays vanilla `postgres:16` (M0 deviation). Base location is `lat`/`lng` doubles. `ST_DWithin` waits for M3 (DIS-001). CI PostGIS is unused until then.

---

## 2. Goal and demo

**Goal.** A vetted provider with a menu and a calendar exists. Discovery can be honest later.

**Demo at exit.** Register a provider. Upload ID + credential + five photos, submit. On admin, open the queue, open the ID (access logged), schedule interview, record approve. Provider sets a 60-minute “Cut” at ₪200 (sees net ₪160), a weekday pattern, and a day off. Go-live checklist is all green except it stays off until Connect is marked ready; after stub Connect, go-live succeeds. Removing all services turns go-live off and names `services`. Hebrew and English provider/admin shells still work.

---

## 3. PR sequence

Branch per PR: `m2/{slug}` off `main`. Merge only when gates 1–8 are green.

```
M2-P1 catalog + availability schemas
    │
    ▼
M2-P2 vetting + private docs + admin queue
    │
    ▼
M2-P3 profile + services + net price
    │
    ▼
M2-P4 slot-computation + rules/exceptions
    │
    ▼
M2-P5 Connect stub + go-live composer
    │
    ▼
M2-P6 provider + admin UI
    │
    ▼
M2-P7 E2E both locales
```

Nothing is parallel. M0/M1 smokes must stay green.

### Delivery (as shipped)

| Plan ID | PR | Title | Merged |
|---|---|---|---|
| M2-P1 | [#24](https://github.com/natank/shearly/pull/24) | Catalog, availability, and payments schemas | 2026-08-15 |
| M2-P2 | [#25](https://github.com/natank/shearly/pull/25) | Vetting packet, private docs, admin queue | 2026-08-15 |
| M2-P3 | [#26](https://github.com/natank/shearly/pull/26) | Profile, services, and net price | 2026-08-15 |
| M2-P4 | [#27](https://github.com/natank/shearly/pull/27) | Slot computation and availability | 2026-08-15 |
| M2-P5 | [#28](https://github.com/natank/shearly/pull/28) | Connect stub and go-live | 2026-08-15 |
| M2-P6 | [#29](https://github.com/natank/shearly/pull/29) | Provider dashboard and admin vetting UI | 2026-08-15 |
| M2-P7 | [#30](https://github.com/natank/shearly/pull/30) | Supply loop test and locale smoke | 2026-08-15 |

### M2-P1 — Schemas and migrate

**Does**
- `catalog` schema: `providers`, `services`, `vetting_documents`, `document_access_log`, `schema_migrations`
- `availability` schema: `weekly_rules`, `exceptions`, `schema_migrations`
- `payments` schema (minimal): `connect_accounts` (`account_id`, `status`, `stripe_account_id` nullable)
- `pnpm nx run api:migrate` applies identity **then** catalog **then** availability **then** payments (same runner style as M1; each service owns its SQL; **do not** re-export migrate from service barrels)
- Provider register in `apps/api` upserts `catalog.providers` (`status = draft`, `account_id` unique)

**Providers columns (min):** `id`, `account_id` unique, `status` (`draft` \| `pending_review` \| `interview_scheduled` \| `approved` \| `rejected`), `bio`, `base_lat`, `base_lng`, `radius_km`, `listed` bool default false, `decision_rationale`, `decided_by`, `decided_at`, timestamps.

**Tests.** Migrate idempotent; three new schemas exist; register-as-provider creates a catalog row.

**Out.** HTTP beyond the register hook. UI.

### M2-P2 — Vetting packet, private docs, admin queue

**Does**
- `DocumentStore` interface in `libs/services/provider-catalog`: `put`, `get`, `exists`. Local impl writes under `var/private-docs/` (gitignored). Filename on disk is a uuid; original name stays in metadata only.
- Provider (own account only):
  - `POST /catalog/me/documents` multipart: `kind` = `government_id` \| `credential` \| `portfolio`
  - `GET /catalog/me/application` — status + missing items
  - `POST /catalog/me/submit` — requires 1 ID, 1 credential, ≥5 portfolio; else `ValidationError` listing keys
- Admin:
  - `GET /admin/vetting` — `pending_review` oldest-first
  - `GET /admin/vetting/:providerId`
  - `GET /admin/vetting/:providerId/documents/:docId` — raw bytes; writes `document_access_log`
  - `POST /admin/vetting/:providerId/decision` `{ action: interview|approve|reject|request_more, rationale? }`
- Submit → `pending_review`. Mail provider + admin via existing SMTP helper (not `notifications` service).
- Reject / request_more may return to `draft`. Approve only from `interview_scheduled` (or from `pending_review` if interview is recorded in the same decision payload — default: two-step).
- Document JSON never includes bytes or disk paths.

**Tests.** Incomplete submit lists missing; complete submit flips status; non-admin 403 on queue; second provider cannot GET first's docs; admin GET increments access log; customer role 403.

**Out.** Public portfolio CDN. Real S3.

### M2-P3 — Profile and services

**Does**
- Approved (or draft, for bio/radius pre-approval) provider:
  - `PATCH /catalog/me/profile` `{ bio, baseLat, baseLng, radiusKm }` — `radiusKm` ≤ `RADIUS_CAP_KM`
  - `POST/PATCH/DELETE /catalog/me/services` — name, description, durationMinutes, priceMinor (ILS agorot)
- `GET /catalog/me/services/:id/quote` — `{ gross, commission, net, commissionRate, travelIncluded: true }` using `libs/domain/pricing`
- Implement pricing: `splitPrice(grossMinor, rate)` → integers that sum to gross (no leftover agora)

**Tests.** Radius 16 rejected; quote 20000 @ 0.2 → net 16000; provider B cannot PATCH provider A.

**Out.** Public profile (M3). Booking price snapshot (M4).

### M2-P4 — Availability and slot computation

**Does**
- Replace `slot-computation` stub with a pure function:

```
computeSlots({
  weekly: { weekday: 0-6, startMinute, endMinute }[],
  exceptions: { date: 'YYYY-MM-DD', kind: 'block' | 'extra', startMinute?, endMinute? }[],
  durationMinutes,
  bufferMinutes,
  occupancy: { start: Date, end: Date, lat?, lng? }[],
  origin?: { lat, lng },
  from: Date,
  to: Date,
  now: Date,
}): { start: Date, end: Date }[]
```

- Buffer applied **before and after** each occupancy. Extra minutes from a coarse distance band if both points present (0–5 km: +0, 5–10: +15, 10–15: +30). No routing API.
- `availability` service persists weekly rules + exceptions. `GET /availability/me/slots?duration=&from=&to=` computes live (no cache required in M2).
- Save of a `block` that overlaps fixture occupancy **fails** with those fixture ids (AVL-002). Pass occupancy in the request for M2 (`occupancy` test header or body) so we do not invent booking rows.
- `GET /availability/me/schedule` returns computed occupancy fixtures + rules (AVL-004 shape without real bookings).

**Tests.** 90% coverage on `slot-computation`. Weekly Mon 09:00–17:00 + 60 min + 15 buffer → expected starts. Block day removes slots. Occupancy + buffer removes the following slot. Distance band adds time.

**Out.** Booking occupancy table (M4). Public slot display (M3 uses this API from the composer).

### M2-P5 — Connect stub and go-live

**Does**
- `payments` service: `getConnectStatus(accountId)`, `startOnboarding(accountId)` (returns Stripe Account Link if `STRIPE_SECRET_KEY` set, else `{ url: null, stub: true }`), `completeStub(accountId)` for local demo.
- `POST /payments/me/connect/start`, `POST /payments/me/connect/stub-complete`, `GET /payments/me/connect`
- Go-live composer in `apps/api` only (§2.4):

```
GET /catalog/me/go-live → { ready, missing: ('vetting'|'connect'|'services'|'availability')[], listed }
POST /catalog/me/go-live { listed: true|false }
```

`listed=true` allowed only if all four hold. `listed=false` always allowed (PRV-005 toggle). If services or availability later drop to zero, a read of go-live reports `listed` forced false (writer in composer on GET or explicit reconcile).

**Tests.** Missing each prereq is named. All four → listed. Cross-tenant 403.

**Out.** Real Connect webhook handling beyond storing `status`. Public discovery (M3).

### M2-P6 — Provider and admin UI

**Does**
- `libs/ui/feature-provider`: application upload, status, profile, services (price + net), weekly grid, exceptions, go-live checklist, Connect button (stub complete in non-prod).
- `libs/ui/feature-account` unchanged except provider home links into these routes.
- `apps/web` `/{locale}/provider/*` (application, profile, services, availability, go-live).
- `apps/admin` `/en/vetting` queue + detail + document open (blob URL from admin GET) + decision form.
- All strings in `libs/ui/i18n` (`provider`, `vetting` namespaces). No hex, no physical CSS, no hardcoded JSX.

**Tests.** i18n/RTL scripts. Typecheck. No `type:app-web` → `type:service`.

**Out.** Customer-facing profile. Map picker (lat/lng number inputs are enough).

### M2-P7 — E2E

**Does**
- Playwright, both locales, API + web (+ admin if needed):
  1. Provider in `he`: submit packet (use API for file bytes if UI upload is flaky; assert status `pending_review`).
  2. Admin: queue → interview → approve (API or UI).
  3. Provider in `en`: add 60-min service, weekly pattern, one blocked day; go-live missing `connect`; stub-complete; go-live ready.
- Keep M0 locale smoke and M1 auth smoke.

**Out.** Discovery E2E (M3). Booking E2E (M4).

---

## 4. Layout at M2 exit

```
libs/services/provider-catalog/src/     # real
libs/services/provider-catalog/migrations/
libs/services/availability/src/         # real
libs/services/availability/migrations/
libs/services/payments/src/             # connect only
libs/services/payments/migrations/
libs/domain/slot-computation/src/       # real
libs/domain/pricing/src/                # splitPrice
libs/ui/feature-provider/src/           # real
libs/ui/i18n/src/messages/{en,he}/{provider,vetting}.json
var/private-docs/                       # gitignored
```

---

## 5. Local at M2 exit

```bash
pnpm install
cp -n .env.example .env
docker compose up -d
pnpm nx run api:migrate
pnpm nx run-many -t serve -p web,api,admin
```

- web: `/he/provider/application`, `/en/provider/services`, `/en/provider/availability`, `/en/provider/go-live`
- admin: `/en/vetting`
- Mailpit: submit / decision mail

---

## 6. Exit checklist

- [x] Provider can submit ID + credential + ≥5 photos; incomplete lists missing items (PRV-002)
- [x] Admin queue oldest-first; interview then approve/reject with rationale (PRV-003, OPS-001)
- [x] Opening an ID writes `document_access_log`; non-admin cannot (NFR-SEC-002)
- [x] Approved provider sets bio, point, radius ≤ 15 km, 60-minute priced service; net shown (PRV-004)
- [x] Weekly pattern + one blocked day; slots honor duration and travel buffer (AVL-001…003)
- [x] Block that overlaps fixture occupancy is rejected with those ids (AVL-002)
- [x] Schedule surface exists (AVL-004) even if bookings are fixtures
- [x] Connect stub (or hosted link) gates go-live; missing prereqs named (PAY-005, PRV-005)
- [x] Provider A cannot read/write provider B (NFR-SEC-008) — own-account routes only
- [x] `/he` and `/en` provider/admin strings; M0/M1 smokes still pass
- [x] CI 1–8 green on P5–P7; P3/P4 schema-race fixed by serializing migrate tests
- [x] No booking rows; no public discovery

Master demo: “Founder vets a provider; provider sets services + hours; go-live checklist visible.”

---

## 7. Explicitly not M2

| Item | Belongs |
|---|---|
| Public discovery, ranking, customer profile | M3 |
| Address book, out-of-area | M3 |
| `POST /bookings`, occupancy table, money | M4 |
| Notifications service / SES / outbox | M5 (SMTP from catalog is enough) |
| Real S3 + KMS | named hole; filesystem backend locally |
| PostGIS `ST_DWithin` | M3 |
| Dedicated per-schema DB users | still a named hole |

Do not add discovery “just because” `listed` exists.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Stripe keys missing | Stub complete path; go-live still testable |
| File upload in E2E flaky | P7 may drive submit via API and assert UI status |
| Slot tests need “confirmed” bookings | Fixtures only; no `booking` schema |
| Identity vs catalog vetting status | Catalog is source of truth; register only inserts `draft` |

---

## 9. Open on M2

| # | Question | Default if unanswered |
|---|---|---|
| **M2-Q1** | Approve directly from `pending_review`? | No. Interview step is required (PRV-003). |
| **M2-Q2** | Local Connect without Stripe keys? | `POST /payments/me/connect/stub-complete` |
| **M2-Q3** | Portfolio public CDN in M2? | No. Portfolio stays private until M3 profile. |

None changes the master cuts.

---

## 10. Next

M2 is complete. Write [`m3-demand.md`](./m3-demand.md). Do not write M4–M5 plans yet (master §6).
