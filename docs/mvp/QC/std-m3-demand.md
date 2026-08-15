# STD-M3 — Demand

**Document ID:** `STD-M3`  
**Milestone:** M3 Demand  
**Plan:** [m3-demand.md](../04-implementation-plan/m3-demand.md)  
**Lab:** [lab.md](./lab.md)  
**Depends on:** STD-M0, STD-M1, and the M2 **demo** (T02–T09) still PASS  
**Applies to:** `main` at or after [#41](https://github.com/natank/shearly/pull/41)  
**Est. time:** 60 minutes

---

## 1. Purpose

An anonymous visitor, in Hebrew, finds an in-radius approved **listed** provider and sees real slots. Ranking is behind a seam. Out-of-area is explicit. No money moves.

Master demo: “Anonymous visitor, in Hebrew, finds an in-radius approved provider and sees real slots.”

---

## 2. Traceability

| Procedure | Pri | Stories / NFRs |
|---|---|---|
| M3-T01 | Must | CUS-001 browse — no login wall |
| M3-T02 | Must | DIS-001 need location |
| M3-T03 | Must | DIS-001, DIS-004, DIS-005, RAT-002 — Tel Aviv happy path |
| M3-T04 | Must | DIS-001, CUS-005 — out-of-area (Eilat / `0,0`) |
| M3-T05 | Must | DIS-001 — unlisted / draft never appears |
| M3-T06 | Must | DIS-003 filters in URL + no-matches |
| M3-T07 | Must | DIS-004 profile: travel included, badge, slots, new provider |
| M3-T08 | Must | NFR-SEC-002 — ID bytes stay private; portfolio public if listed |
| M3-T09 | Must | CUS-005 address book |
| M3-T10 | Must | NFR-SEC-008 — addresses own-account; unlisted 404 |
| M3-T11 | Must | no `POST /bookings` |
| M3-T12 | Should | DIS-002 StubRanker swap |
| M3-T13 | Should | DIS-002 ranker failure fallback (optional) |
| M3-T14 | Should | English chrome |
| M3-T15 | Should | PostGIS present |
| M3-T16 | Should | Unknown geocode query |

---

## 3. Fixtures

You need **one listed Tel Aviv provider**. Either reuse a clean F-P1 from STD-M2 (re-add service if T10 deleted it) or seed this pack.

### F-LIVE — listed provider (create if missing)

Follow STD-M2 T02→T09 with:

| Field | Value |
|---|---|
| Email | `qc-m3-live-<date>@example.com` |
| Display name | `QC Cut Tel Aviv` |
| Point | 32.0853, 34.7818 |
| Radius | 10 km |
| Service | Cut, 60 min, ₪200 |
| Hours | every weekday 09:00–17:00 (easiest for slots) |
| Connect | stub complete |
| Go-live | listed = true |

### F-HIDE — approved but **not** listed (optional; for T05)

Same city, display name `QC Hidden`, `listed = false` (skip go-live).

### F-CUST — customer

`qc-m3-cust-<date>@example.com` / `long-enough-password` — profile B.

### Geocoder

| Query | Meaning |
|---|---|
| `tel aviv` | In radius for F-LIVE |
| `eilat` | Out of area vs F-LIVE |
| `jerusalem` | Out of area vs a 10 km Tel Aviv radius |
| `no-such-place` | Unknown (not out-of-area) |

Coordinate escape hatches (no stub):

- In-radius: http://localhost:3000/he?lat=32.0853&lng=34.7818
- Out-of-area: http://localhost:3000/en?lat=0&lng=0

### Reviews

There is **no** public “write review” in M3. Default UI is **New provider**.

Optional SQL to prove the aggregate path (T07b):

```sql
-- replace :id
INSERT INTO catalog.reviews (provider_id, rating, body)
VALUES (':id', 5, 'qc-m3');
UPDATE catalog.providers
SET rating_sum = rating_sum + 5, rating_count = rating_count + 1
WHERE id = ':id';
```

Need `rating_count >= 3` (`NEW_PROVIDER_REVIEW_THRESHOLD`) before the numeric average replaces **New provider**.

---

## 4. Reset

1. Confirm PostGIS: [lab.md](./lab.md) §2. If `ST_DWithin` errors, **R3**.
2. If many leftover listed providers pollute ranking/order, R2 and recreate F-LIVE only.
3. Profile A must have **no** Shearly cookies for T01–T04.
4. After T12, set `RANKING_IMPL=deterministic` again and restart `api`.

---

## 5. Procedures

### M3-T01 — No login wall

**Pri:** Must  
**Profiles:** A, cookies cleared

| Step | Action | Expected |
|---|---|---|
| 1 | Open http://localhost:3000/he | H1 **שירלי**. Discovery block **חיפוש סטייליסט**. **התחברות** / **יצירת חשבון** links. **No** modal, interstitial, or redirect to sign-in |
| 2 | Open http://localhost:3000/en | Same with **Shearly** / **Find a stylist** / Sign in / Create account |

---

### M3-T02 — Location required

**Pri:** Must  
**Profiles:** A

| Step | Action | Expected |
|---|---|---|
| 1 | `/he` with no query | Copy **הזינו כתובת כדי לראות מי יכול להגיע אליכם.** (need location). **No** global provider list |
| 2 | `GET /api/discovery` | `{ "state": "need_location" }` |

---

### M3-T03 — Hebrew visitor finds F-LIVE and opens the profile

**Pri:** Must  
**Profiles:** A  
**Demo procedure.**

| Step | Action | Expected |
|---|---|---|
| 1 | On `/he`, enter `tel aviv`, Search — **or** open `/he?lat=32.0853&lng=34.7818` | State is results, not empty |
| 2 | Card for **QC Cut Tel Aviv** | Shows name, vetting sentence, headline **200** ₪, **כולל נסיעה**, **נותן שירות חדש** (unless you ran the review SQL), next opening if hours cover the window |
| 3 | Click **לפרופיל** | `/he/providers/<uuid>` |
| 4 | Profile | Bio `qc-m2`/`qc-m3`, menu Cut 60 דק׳ · 200 ₪ · כולל נסיעה, vetting badge sentence, **זמנים פנויים** with at least one time **or** the empty-window sentence |
| 5 | Book control | Visible, **disabled**, copy that booking is the next milestone. No charge |

**Fail if** F-LIVE is missing, login is required, or prices show agorot (`20000`) as the customer amount.

---

### M3-T04 — Out-of-area is explicit

**Pri:** Must  
**Profiles:** A

| Step | Action | Expected |
|---|---|---|
| 1 | `/en`, search `eilat` — or `/en?lat=0&lng=0` | **Not yet in your area. We will say so when we launch there — this is not an empty list.** |
| 2 | Confirm it is **not** a blank list and **not** “No matches. Adjust the filters…” | Those are different states |
| 3 | `GET /api/discovery?lat=0&lng=0` | `{ "state": "out_of_area", … }` |

---

### M3-T05 — Unlisted never appears

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | If F-HIDE exists, search Tel Aviv | F-HIDE name absent |
| 2 | `GET /api/catalog/public/<F-HIDE-id>` | 404 |
| 3 | Create a draft provider with the same point, do not list, search again | Draft absent |

---

### M3-T06 — Filters in the URL

**Pri:** Must  
**Profiles:** A

| Step | Action | Expected |
|---|---|---|
| 1 | Search Tel Aviv, set Service `Massage`, Search | URL contains `service=Massage`. Copy **No matches** (EN) / **אין התאמות** plus active filter names |
| 2 | `GET /api/discovery?lat=32.0853&lng=34.7818&service=Massage` | `{ "state": "no_matches", "filters": { "service": "Massage" } }` |
| 3 | Clear service, set min price `500` | Cut at ₪200 disappears (no-matches or not in the list) |
| 4 | Reload the filtered URL | Same filter state (shareable) |

---

### M3-T07 — Profile contract

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | `GET /api/catalog/public/<F-LIVE-id>` | 200. `services[].travelIncluded === true`. `services[].priceMinor === 20000`. `rating.newProvider === true` if no reviews. `vetting` flags for ID/credential/portfolio/interview. **No** `storage_key` / filesystem path |
| 2 | `GET /api/catalog/public/<F-LIVE-id>/services/<cutId>/slots` | `slots[]` with ISO start/end. Empty array is allowed only if weekly hours cannot produce a slot in the window — then fail T07 hours fixture, not this API |
| 3 | Optional T07b: apply review SQL three times, reload profile | **New provider** gone; average shown |

---

### M3-T08 — Portfolio public, ID private

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | From profile JSON, `GET` a `portfolio[].url` | 200 image bytes |
| 2 | `GET /api/catalog/public/<id>/portfolio/<government_id doc uuid>` | 404 |
| 3 | Logged-out `GET /api/admin/vetting/…/documents/…` | 401/403 |

---

### M3-T09 — Customer address book

**Pri:** Must  
**Profiles:** B as F-CUST

| Step | Action | Expected |
|---|---|---|
| 1 | Register customer, `/en/account` | **Saved addresses** |
| 2 | Label `Home`, address `tel aviv`, notes `gate 2`, save | Row appears Home · tel aviv |
| 3 | `GET /api/account/me/addresses` | `lat`≈32.0853, `lng`≈34.7818, `access_notes` present |
| 4 | Remove | Row gone |

---

### M3-T10 — Cross-tenant addresses and public 404

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Second customer GET `/api/account/me/addresses` | Does not include F-CUST Home |
| 2 | Provider session GET `/api/account/me/addresses` | 403 |
| 3 | `GET /api/catalog/public/<unlisted or random uuid>` | 404 |

---

### M3-T11 — No booking create

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | `POST /api/bookings` with any JSON | 404 (no route) or not 201 |
| 2 | Profile **Book** control | Disabled; does not POST |

---

### M3-T12 — StubRanker reverses order

**Pri:** Should  
Needs **two** listed in-radius providers (clone T03 seed as F-LIVE2, slightly different point e.g. lat `32.10`).

| Step | Action | Expected |
|---|---|---|
| 1 | `GET /api/discovery?lat=32.0853&lng=34.7818` with default config | Note order of the two ids |
| 2 | Stop `api`. Set `RANKING_IMPL=stub` in `.env`. Restart `api` | — |
| 3 | Same GET | The two ids appear in **reverse** order |
| 4 | Restore `RANKING_IMPL=deterministic` and restart | Order returns |

**Fail if** you must change `discovery.ts` or the UI to swap the ranker.

---

### M3-T13 — Ranker fallback

**Pri:** Should  
Optional. If you can inject a throwing ranker in a throwaway branch, discovery still returns `state: ok` sorted by distance then rating. Otherwise **WAIVE** (covered by unit tests).

---

### M3-T14 — English discovery chrome

**Pri:** Should

`/en` strings: Find a stylist, Search, New provider, Travel included, View profile. `dir=ltr`.

---

### M3-T15 — PostGIS

**Pri:** Should

```sql
SELECT PostGIS_Version();
```

**Expected.** A 3.x version. `listInRadius` / Tel Aviv search works (proves `ST_DWithin`).

---

### M3-T16 — Unknown address

**Pri:** Should

Search `no-such-place`.

**Expected.** Validation / **We could not find that address** — **not** `out_of_area` and **not** a silent empty list.

`GET /api/discovery?q=no-such-place` → 400 `discovery.unknownAddress`.

---

## 6. Explicitly out of M3 QC

| Item | Belongs |
|---|---|
| Pay / authorize | M4 |
| Mid-flow auth + guest-draft restore onto a booking | M4 |
| Map | POST-MVP |
| Waitlist email for out-of-area | M5 (copy only here) |
| Real Google/Mapbox key | named hole |

---

## 7. Run log

| Field | Value |
|---|---|
| Date | |
| Commit | |
| Tester | |
| F-LIVE provider UUID | |
| Reset | |

| ID | Pri | Verdict | Notes |
|---|---|---|---|
| M3-T01 | Must | | |
| M3-T02 | Must | | |
| M3-T03 | Must | | |
| M3-T04 | Must | | |
| M3-T05 | Must | | |
| M3-T06 | Must | | |
| M3-T07 | Must | | |
| M3-T08 | Must | | |
| M3-T09 | Must | | |
| M3-T10 | Must | | |
| M3-T11 | Must | | |
| M3-T12 | Should | | |
| M3-T13 | Should | | |
| M3-T14 | Should | | |
| M3-T15 | Should | | |
| M3-T16 | Should | | |

**Milestone QC:** PASS / FAIL
