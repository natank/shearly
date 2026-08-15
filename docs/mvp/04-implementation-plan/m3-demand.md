# M3 — Demand

**Milestone ID:** `M3`  
**Master:** [04-implementation-plan.md](./04-implementation-plan.md) — §4 M3, §5 CUS-001 browse / CUS-005 / DIS-001…005 / RAT-002  
**Design:** `docs/mvp/03-design.md` §2.4 (discovery composer), §4 (ranking seam), §5.1–§5.2 (SSR + shadcn), §6.8 (addresses), §6.9 (geo / `ST_DWithin`), §6.10 (portfolio after approval)  
**Requirements:** CUS-001 (browse + profile + slots only), CUS-005, DIS-001, DIS-002, DIS-003 (`P1`), DIS-004, DIS-005, RAT-002. NFR-PERF-001/002 as budgets.  
**Depends on:** M2 complete  
**Unlocks:** M4 booking (honest slots exist)  
**Status:** Accepted  
**Implementation:** not started — this file is the go-ahead (master §6)

---

## 1. Traceability

This file may not add, drop, or move stories. The master map is the source of truth.

| Master claim | This plan |
|---|---|
| Goal: visitor-facing product without taking money | §2 |
| Builds: discovery composer; geocoding + `ST_DWithin`; `DeterministicRanker` + stub swap; profile; slots; addresses + out-of-area; URL filters; rating display | PRs `M3-P1`…`M3-P6` |
| Stories: CUS-001 browse, CUS-005, DIS-001…005, RAT-002 | §1 table |
| NFR-PERF-001/002 | budgets on discovery + public slots; no load-test harness in M3 |
| Exit: Hebrew, no account, in-radius listed provider, real slots; out-of-area is explicit; StubRanker reverses order | §6 |
| Not in M3: `POST /bookings`, mid-flow auth, payment | §7 |

| ID | Pri | Coverage in M3 | Notes |
|---|---|---|---|
| CUS-001 | P0 | browse + profile + slots, no login wall | Mid-flow auth + draft restore stay M4 |
| CUS-005 | P0 | address book on signed-in customer; out-of-area on discovery | Access notes stored; provider never sees them in M3 (no booking). Waitlist email is copy only |
| DIS-001 | P0 | listed + `approved` + `ST_DWithin(provider.radius_km)` | Results without a location are not shown. Card: name, photo, headline price, rating, vetting badge, next slot |
| DIS-002 | P0 | `ProviderRanker` in `libs/domain/ranking` | Weights from config. Single call site in the composer. Stub swap test. Timeout/throw → distance then rating |
| DIS-003 | P1 | service name, price range, min rating, date | Filters live in the URL; empty-filter state names the active keys |
| DIS-004 | P0 | public profile | Bio, portfolio images, menu (travel included), aggregate + reviews, vetting badge meaning, inline next slots |
| DIS-005 | P0 | `GET` public slots via availability | Same `computeSlots` as M2. Occupancy fixtures only (no booking rows). Locale calendar in the UI |
| RAT-002 | P0 | stored aggregate + reviews list | Below `NEW_PROVIDER_REVIEW_THRESHOLD` → “new provider”, not a sparse average |
| NFR-PERF-001 | P0 | discovery composer is the only fan-out | Budget: results JSON is assembled in-process; no extra hop. No k6 in M3 |
| NFR-PERF-002 | P0 | public slots call `availability.slots` once | Same 500ms budget; no cache required |
| NFR-SEC-008 | P1 | public routes expose listed providers only | Unlisted / non-approved 404. Address book is own-account |

`listed` from M2 is the public-listing flag. Discovery reads `listed = true AND status = approved`. Do not invent a second flag.

Local Compose **gains PostGIS** in M3-P1 (M0/M2 deviation ends). Recreate the volume. CI already uses `postgis/postgis:16-3.5`.

---

## 2. Goal and demo

**Goal.** The visitor-facing product exists without taking money. Ranking seam is real from the first ranking commit.

**Demo at exit.** In Hebrew, with no account, enter the stub address `tel aviv`. See the listed, approved, in-radius provider first (ranked). Open the profile: bio, portfolio photo, 60-minute Cut at ₪200 (travel included), vetting badge, reviews or “new provider”, and real next slots. Enter `jerusalem` and see an explicit out-of-area state, not an empty list. English home still works. A test injects `StubRanker` and the same query reverses order with no caller change.

---

## 3. PR sequence

Branch per PR: `m3/{slug}` off `main`. Merge only when gates 1–8 are green.

```
M3-P1 PostGIS + listed in-radius query
    │
    ▼
M3-P2 ranking + geocode + discovery composer
    │
    ▼
M3-P3 public profile + slots + ratings
    │
    ▼
M3-P4 customer address book
    │
    ▼
M3-P5 discovery + profile UI
    │
    ▼
M3-P6 E2E both locales
```

Nothing is parallel. M0/M1/M2 smokes must stay green.

### M3-P1 — PostGIS and listed in-radius query

**Does**
- Local Compose: switch `postgres` to a **multi-arch PostGIS 16** image (`imresamu/postgis:16-3.5` — official `postgis/postgis` is amd64-only). Document `docker compose down -v` because the vanilla volume cannot load the extension.
- `catalog` migration `002_catalog_discovery.sql`:
  - `CREATE EXTENSION IF NOT EXISTS postgis`
  - `display_name text`
  - `rating_sum int not null default 0`, `rating_count int not null default 0`, `completion_count int not null default 0`
  - `location geography(Point, 4326)` backfilled from `base_lng` / `base_lat`; GiST index
  - `catalog.reviews` (`id`, `provider_id`, `rating` 1–5, `body`, `created_at`) — no `booking_id` until M4
- `PATCH /catalog/me/profile` also accepts `displayName`; writing lat/lng keeps `location` in sync
- Catalog write-owner method `listInRadius({ lat, lng })`:
  - `listed = true AND status = 'approved' AND location IS NOT NULL`
  - `ST_DWithin(location, query_point, radius_km * 1000)`
  - returns `distanceKm` via `ST_Distance` / 1000
- Unlisted or unapproved providers never appear

**Tests.** Migrate idempotent with PostGIS present. In-radius listed+approved is returned. Same point outside `radius_km` is not. Unlisted approved is not. Provider without a point is not.

**Out.** HTTP discovery. Ranking. UI.

### M3-P2 — Ranking seam and discovery composer

**Does**
- Replace the `ranking` stub with the design §4 interface in `libs/domain/ranking` (pure, no I/O):

```
ProviderRanker.rank({
  candidates: { providerId, distanceKm, nextSlotAt, ratingAvg, reviewCount, completionCount }[],
  customerLocation,
  requestedService?,
  requestedWindow?,
}): { providerId, score, reasons }[]
```

- `DeterministicRanker`: weighted linear score. Weights from config, **never literals**:
  - `RANK_WEIGHT_DISTANCE` (nearer higher)
  - `RANK_WEIGHT_AVAILABILITY` (sooner next slot higher)
  - `RANK_WEIGHT_RATING` (higher, confidence-weighted by review count)
  - `RANK_WEIGHT_COMPLETIONS` (diminishing returns)
  - `NEW_PROVIDER_REVIEW_THRESHOLD` (default 3) → neutral prior, not a penalty
  - Identical input → identical order (tie-break `providerId`)
- `StubRanker`: reverses the incoming candidate order (DIS-002 substitution test)
- Geocode client in `apps/api` only: `GET ${GEOCODER_URL}/geocode?q=`. Stub fixtures `tel-aviv` / `jerusalem` already exist. Unknown query → validation error, not empty results.
- Discovery composer in `apps/api` only (`discovery.ts` + routes). **Single call site** for a concrete ranker. Architecture test: no other module imports `DeterministicRanker` / `StubRanker`.
- `GET /discovery?q=` **or** `lat`+`lng`, optional filters:
  - `service` (case-insensitive name contains)
  - `minPrice` / `maxPrice` (ILS major units in the query string; compare `price_minor`)
  - `minRating`
  - `date` (`YYYY-MM-DD` has ≥1 computed slot)
- Response:

```
{ state: 'need_location' }
{ state: 'out_of_area', query, point }
{ state: 'no_matches', filters }
{ state: 'ok', providers: [{ id, displayName, photoUrl, headlinePriceMinor, rating, reviewCount, newProvider, nextSlot, distanceKm, reasons }] }
```

- Composer: geocode if needed → `listInRadius` → load services + next slot per candidate (availability, occupancy `[]`) → apply filters → rank. Ranker throw/timeout → sort by `distanceKm` then rating, still `state: 'ok'`.
- `RANKING_IMPL=deterministic|stub` (default deterministic) so the swap test does not rewrite callers.

**Tests.** 90% coverage on `libs/domain/ranking`. Determinism. Stub reverses order through `GET /discovery`. Ranking throw still returns providers. No `q`/`lat` → `need_location`. `jerusalem` with only a Tel Aviv listed provider → `out_of_area`. Filters that exclude all → `no_matches` naming keys. Unlisted never appears.

**Out.** Public profile page. Address book. UI.

### M3-P3 — Public profile, slots, ratings

**Does**
- `GET /catalog/public/:providerId` — 404 unless `listed && approved`. Body: display name, bio, vetting badge facts (ID + credential + portfolio + interview — no bytes, no disk paths), services (price is customer gross, travel included), stored aggregate, reviews (rating, text, relative-date source `created_at`), `newProvider`, next slots for the first service.
- `GET /catalog/public/:providerId/services/:serviceId/slots?from=&to=` — same slot function as M2; occupancy fixtures empty unless a test header injects them.
- `GET /catalog/public/:providerId/portfolio/:docId` — raw bytes **only** if the provider is listed+approved and `kind = portfolio`. Government ID and credentials stay private (NFR-SEC-002).
- `CatalogService.addReview(providerId, { rating, body })` for tests and M4 later; updates stored `rating_sum` / `rating_count` in the same write.
- Completion count stays 0 until M4; ranking still consumes the column.

**Tests.** Unlisted 404. Listed profile omits street/base exact? Base lat/lng may appear as the service area, not a home street — do **not** expose vetting file paths. Portfolio GET 200 for listed; ID GET 404. New provider when `rating_count < threshold`. Slots match weekly rules. PERF-002: unit/integration only (no load runner).

**Out.** Booking create. UI.

### M3-P4 — Customer address book

**Does**
- `identity` migration `002_addresses.sql`: `identity.addresses` (`id`, `account_id`, `label`, `line`, `lat`, `lng`, `access_notes`, timestamps). Lat/lng doubles (point is enough; `ST_DWithin` lives in catalog).
- Customer (own account only):
  - `GET /account/me/addresses`
  - `POST /account/me/addresses` `{ label, line, accessNotes? }` — geocode `line` via the same geocoder helper; persist point
  - `DELETE /account/me/addresses/:id`
- Provider/admin 403. Customer A cannot read B.
- Discovery does **not** require a saved address. Saved addresses are an input the UI can send as `lat`/`lng` (or `q`) so booking-later reuse is already stored.

**Tests.** Geocode `tel aviv` stores the stub point. Cross-tenant 403. Provider role 403. Unknown line → validation error.

**Out.** Booking snapshot. Provider-facing address DTO (NFR-SEC-005 is M4).

### M3-P5 — Discovery and profile UI

**Does**
- `libs/ui/feature-discovery`: location form, result cards, out-of-area, no-matches, need-location, profile, slot list, address book on customer account.
- `apps/web`:
  - `/{locale}` is discovery (no login wall). Filters in the query string (`q`, `service`, `minPrice`, `maxPrice`, `minRating`, `date`).
  - `/{locale}/providers/[id]` public profile.
  - Customer `/{locale}/account` lists saved addresses + add form.
- Scan `feature-discovery` from web Tailwind `content`.
- All strings in `libs/ui/i18n` (`discovery` namespace + address keys on `account`). No hex, no physical CSS, no hardcoded JSX.
- Card photo uses the public portfolio GET. Headline price is the cheapest active service (customer gross). Vetting badge copy states ID, credential, portfolio, interview.
- Slot times rendered with `Intl` in the active locale. No “Book” submit that posts a booking — a disabled or copy-only control is fine; do not add `POST /bookings`.

**Tests.** i18n/RTL scripts. Typecheck. No `type:app-web` → `type:service`.

**Out.** Map picker. Booking CTA that creates a row.

### M3-P6 — E2E both locales

**Does**
- Playwright, both locales, API + web:
  1. Seed (API): provider packet → interview → approve → profile at Tel Aviv + 60-min Cut ₪200 + weekly hours + Connect stub + go-live.
  2. `/he` with no session: enter Tel Aviv (or `?q=tel-aviv`), see the provider card, open profile, assert price and at least one slot.
  3. `/en?q=jerusalem`: explicit out-of-area copy (not an empty list).
- Keep M0 locale smoke, M1 auth smoke, M2 supply smoke.

**Out.** Booking E2E (M4).

---

## 4. Layout at M3 exit

```
libs/domain/ranking/src/                # real ProviderRanker + DeterministicRanker + StubRanker
libs/services/provider-catalog/migrations/002_catalog_discovery.sql
libs/services/identity/migrations/002_addresses.sql
apps/api/src/discovery.ts               # composer
apps/api/src/discovery-routes.ts
apps/api/src/geocode.ts
libs/ui/feature-discovery/src/          # real
libs/ui/i18n/src/messages/{en,he}/discovery.json
```

---

## 5. Local at M3 exit

```bash
pnpm install
cp -n .env.example .env
docker compose down -v    # once: vanilla PG volume cannot load PostGIS
docker compose up -d
pnpm nx run api:migrate
pnpm nx run-many -t serve -p web,api,admin
```

- web: `/he`, `/en?q=tel-aviv`, `/he/providers/:id`, `/en/account`
- geocoder stub: `http://localhost:3001/geocode?q=tel-aviv`
- admin + provider shells unchanged

New env (defaults in schema):

```
RANK_WEIGHT_DISTANCE=0.4
RANK_WEIGHT_AVAILABILITY=0.3
RANK_WEIGHT_RATING=0.2
RANK_WEIGHT_COMPLETIONS=0.1
NEW_PROVIDER_REVIEW_THRESHOLD=3
RANKING_IMPL=deterministic
DISCOVERY_WINDOW_DAYS=30
```

---

## 6. Exit checklist

- [ ] No login wall on `/he` or `/en` discovery (CUS-001 browse)
- [ ] Results require a location; missing location is an explicit prompt, not a global list (DIS-001)
- [ ] Only `listed` + `approved` providers whose radius covers the point appear (`ST_DWithin`) (DIS-001)
- [ ] Out-of-area is an explicit state, not an empty list (DIS-001, CUS-005)
- [ ] Cards show name, photo, headline price, rating or “new provider”, vetting badge, next slot (DIS-001, RAT-002)
- [ ] Ranking is only behind `ProviderRanker`; weights from config; StubRanker reverses `GET /discovery` (DIS-002)
- [ ] Ranker failure falls back to distance then rating (DIS-002)
- [ ] Filters (service, price, rating, date) live in the URL and name themselves when they match nothing (DIS-003)
- [ ] Public profile: bio, portfolio, menu with travel-included prices, badge meaning, reviews, inline slots (DIS-004, DIS-005, RAT-002)
- [ ] Shown slots come from `slot-computation` (duration + rules + buffer); occupancy fixtures only (DIS-005)
- [ ] Signed-in customer can save a labeled address with optional access notes (CUS-005)
- [ ] Provider A cannot read B’s addresses; unlisted providers 404 on public GET (NFR-SEC-008)
- [ ] ID/credential bytes stay private; listed portfolio is readable (NFR-SEC-002 still holds)
- [ ] `/he` and `/en` discovery strings; M0/M1/M2 smokes still pass
- [ ] CI 1–8 green on every M3 PR
- [ ] No `POST /bookings`; no payment; no mid-flow auth restore

Master demo: “Anonymous visitor, in Hebrew, finds an in-radius approved provider and sees real slots.”

---

## 7. Explicitly not M3

| Item | Belongs |
|---|---|
| `POST /bookings`, occupancy table, money, mid-flow auth | M4 |
| Guest-draft restore onto a booking | M4 |
| Provider `PENDING` address DTO (approx area vs street) | M4 (NFR-SEC-005) |
| Increment `completion_count` / bind reviews to bookings | M4 (RAT-001) |
| Notifications / waitlist mail for out-of-area | M5 |
| Real geocoder API key (Google/Mapbox) | named hole; stub is enough |
| Public S3 + CloudFront for portfolio | named hole; API GET is enough locally |
| Map view | DIS-006 POST-MVP |
| Agentic ranker | Phase 2; seam only |

Do not add checkout “just because” slots exist.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Local vanilla PG volume vs PostGIS | `down -v` once; CI already PostGIS |
| Official PostGIS image amd64-only | Multi-arch `imresamu/postgis:16-3.5` locally |
| Discovery fan-out latency | In-process composer; no extra services; listed set is small at MVP |
| Ranking coverage gate 90% | Domain lib is pure; property + unit tests in P2 |
| E2E needs a listed provider | P6 seeds via API (same as M2-P7), not the UI packet |
| Schema-race on migrate tests | Keep M2 serialization; new migrate specs stay idempotent |

---

## 9. Open on M3

| # | Question | Default if unanswered |
|---|---|---|
| **M3-Q1** | Persist out-of-area waitlist emails? | No. Copy only. Mail is M5. |
| **M3-Q2** | Local PostGIS image? | `imresamu/postgis:16-3.5` |
| **M3-Q3** | Provider display name source? | `display_name` on `catalog.providers`, editable on profile |
| **M3-Q4** | Public portfolio CDN? | No. Listed-only GET of portfolio bytes |
| **M3-Q5** | Reviews without bookings? | Insert via catalog for tests/display; M4 attaches `booking_id` |

None changes the master cuts. Auto-accepted with these defaults.

---

## 10. Next

Implement `M3-P1`…`M3-P6` in order. Merge each only with gates 1–8 green. After M3 exit, write [`m4-transaction.md`](./m4-transaction.md). Do not write M5 yet (master §6).
