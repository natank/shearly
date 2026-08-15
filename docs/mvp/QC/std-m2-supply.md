# STD-M2 — Supply

**Document ID:** `STD-M2`  
**Milestone:** M2 Supply  
**Plan:** [m2-supply.md](../04-implementation-plan/m2-supply.md)  
**Lab:** [lab.md](./lab.md)  
**Depends on:** STD-M0 and STD-M1 Must procedures still PASS  
**Applies to:** `main` at or after [#30](https://github.com/natank/shearly/pull/30) (UI polish #32–#34 allowed)  
**Est. time:** 70 minutes

---

## 1. Purpose

A vetted provider with a menu and a calendar exists. Go-live names missing prerequisites. Public discovery is **not** in this STD (that is STD-M3).

Master demo: “Founder vets a provider; provider sets services + hours; go-live checklist visible.”

---

## 2. Traceability

| Procedure | Pri | Stories / NFRs |
|---|---|---|
| M2-T01 | Must | PRV-002 incomplete packet |
| M2-T02 | Must | PRV-002 complete submit → `pending_review` |
| M2-T03 | Must | OPS-001, PRV-003 queue oldest-first + interview |
| M2-T04 | Must | NFR-SEC-002 ID GET + access log |
| M2-T05 | Must | PRV-003 approve only after interview |
| M2-T06 | Must | PRV-004 profile, radius cap, 60-min Cut ₪200, net ₪160 |
| M2-T07 | Must | AVL-001 weekly pattern |
| M2-T08 | Must | AVL-002 block a day |
| M2-T09 | Must | PAY-005, PRV-005 go-live names `connect` then succeeds after stub |
| M2-T10 | Must | PRV-005 unlist / missing `services` |
| M2-T11 | Must | NFR-SEC-008 provider A ≠ B |
| M2-T12 | Should | AVL-002 block vs occupancy fixture (API) |
| M2-T13 | Should | AVL-004 schedule surface |
| M2-T14 | Should | Hebrew provider chrome |
| M2-T15 | Should | Reject path |

---

## 3. Fixtures

### Accounts

| ID | Role | Email | Password | Profile |
|---|---|---|---|---|
| F-P1 | provider under test | `qc-m2-a-<date>@example.com` | `long-enough-password` | C |
| F-P2 | second provider | `qc-m2-b-<date>@example.com` | `long-enough-password` | extra window |
| F-ADM | admin | `admin@shearly.local` | `change-me-admin-10` | D |

### Files (any small bytes)

Use five distinct PNG/JPEG files plus one PDF or PNG for the credential. Generated is fine:

```bash
mkdir -p /tmp/qc-m2
printf 'id' > /tmp/qc-m2/id.png
printf 'cred' > /tmp/qc-m2/cred.png
for i in 0 1 2 3 4; do printf "p$i" > /tmp/qc-m2/p$i.jpg; done
```

| File | Kind in UI |
|---|---|
| `id.png` | Government ID |
| `cred.png` | Professional credential |
| `p0.jpg`…`p4.jpg` | Portfolio photo (all five) |

### Profile values (F-P1)

| Field | Value |
|---|---|
| Display name | `QC Cut Tel Aviv` |
| Bio | `qc-m2` |
| Latitude | `32.0853` |
| Longitude | `34.7818` |
| Radius | `10` (must reject `16`) |
| Service name | `Cut` |
| Duration | `60` |
| Price | `200` (ILS, not agorot) |
| Weekly | Monday 09:00–17:00 |
| Day off | a date next week |

### Occupancy fixture (T12 only)

JSON body, not a booking row:

```json
{
  "date": "2026-08-24",
  "kind": "block",
  "occupancy": [
    {
      "id": "fix-1",
      "start": "2026-08-24T09:00:00.000Z",
      "end": "2026-08-24T10:00:00.000Z"
    }
  ]
}
```

---

## 4. Reset

1. R2 if a previous QC left listed providers or a dirty queue (then recreate F-P1/F-P2).
2. `rm -rf var/private-docs/*` after R2 if uploads exist.
3. Mailpit: delete messages if you will watch submit/decision mail.
4. Profiles C and D only. Do not use the visitor profile for M2 except to confirm discovery is **not** required.

---

## 5. Procedures

### M2-T01 — Incomplete submit lists missing items

**Pri:** Must  
**Profiles:** C as F-P1 (register provider if needed; land on Provider home)

| Step | Action | Expected |
|---|---|---|
| 1 | Application section: choose Government ID, attach **no** files, submit | Status stays draft-like. Missing names **government_id** / credential / portfolio (or the translated **Still needed** list) |
| 2 | Upload only the ID, submit | Missing still includes credential and portfolio |
| 3 | Optional API: `POST /api/catalog/me/submit` | 400 with `catalog.missing:government_id,credential,portfolio` (or remaining keys) |

---

### M2-T02 — Complete packet submits

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Upload ID, credential, and all five portfolio files (correct kind each time) | Files accepted |
| 2 | Submit for review | Status **pending_review** (or the string `pending_review`) |
| 3 | Mailpit | Mail to the provider and/or admin that a packet was submitted (SMTP helper; do not require SES) |

If UI multi-upload is flaky, drive T02 via API (`POST /api/catalog/me/documents` + `POST /api/catalog/me/submit`) and assert the **status** on the dashboard after refresh. That is an allowed M2-P7 deviation.

---

### M2-T03 — Admin queue, oldest first, interview

**Pri:** Must  
**Profiles:** D

| Step | Action | Expected |
|---|---|---|
| 1 | http://localhost:4300/en sign in F-ADM | **Vetting queue** link |
| 2 | Open `/en/vetting` | F-P1 appears. Copy **Waiting for interview**. If another pending row exists, older `created_at` is above newer |
| 3 | Click **Schedule interview** | Row remains. Copy **Interview scheduled — approve when the call is done**. **Approve** is now the primary action (not interview) |
| 4 | Refresh | Application did **not** vanish (interview_scheduled stays in the queue) |

---

### M2-T04 — Opening an ID writes the access log

**Pri:** Must

The queue UI on current `main` has no “Open document” button. Use the admin session.

| Step | Action | Expected |
|---|---|---|
| 1 | As admin, `GET /api/admin/vetting` | JSON `queue[]` with F-P1 `id` |
| 2 | `GET /api/admin/vetting/:providerId` | Documents metadata. **No** disk paths, **no** raw bytes in JSON |
| 3 | Note a document id with `kind = government_id` | — |
| 4 | `GET /api/admin/vetting/:providerId/documents/:docId` (credentials include) | Image/PDF bytes. Browser may download/inline |
| 5 | SQL `SELECT count(*) FROM catalog.document_access_log WHERE document_id = '…'` | Count increased by 1. Row has `actor_account_id` = admin |
| 6 | Repeat GET as **F-P2** or logged-out | 401/403. Count does **not** increase |

---

### M2-T05 — Interview then approve (not skip)

**Pri:** Must  
**Profiles:** D then C

| Step | Action | Expected |
|---|---|---|
| 1 | On a **pending_review** row, try Approve if the button is visible | On current UI Approve is hidden until interview. If you force `POST …/decision { "action":"approve" }` on pending_review | 400 `catalog.invalidDecision` |
| 2 | After interview, **Approve** | Row leaves the queue. Provider status `approved` |
| 3 | F-P1 dashboard | Status `approved`. Go-live still names other missing items |

---

### M2-T06 — Profile, radius, priced service, net

**Pri:** Must  
**Profiles:** C as F-P1

| Step | Action | Expected |
|---|---|---|
| 1 | Display name `QC Cut Tel Aviv`, bio `qc-m2`, lat `32.0853`, lng `34.7818`, radius `16`, save | Rejected (`catalog.radiusCap` / no save) |
| 2 | Radius `10`, save | Persists after reload |
| 3 | Service `Cut`, duration `60`, price `200`, add | List shows Cut · 60 · 200. **Your net after 20% commission: 160** |
| 4 | Reload the page | Service and profile still there (persist) |

---

### M2-T07 — Weekly hours

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Weekday Monday, start 09:00, end 17:00, save weekly hours | List shows **Monday · 09:00–17:00** (not raw minutes 540–1020) |
| 2 | Reload | Hours still shown |

---

### M2-T08 — Block a day

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Day off = a date next week, **Block this day** | Request succeeds (200) |
| 2 | `GET /api/availability/me/schedule` | `exceptions` includes that date, `kind: block` |

---

### M2-T09 — Go-live gated on Connect stub

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Read the Go live section **before** stub Connect | **Not ready yet**. Missing includes **connect** (copy: **Payouts are not marked complete.**). **Go live** is disabled |
| 2 | Click **Mark payouts complete (local)** | Connect no longer listed as missing |
| 3 | If vetting, services, and hours are done, **Go live** | Enabled. After click, listed / **Leave discovery** |
| 4 | `GET /api/catalog/me/go-live` | `{ ready: true, listed: true, missing: [] }` |

If interview/approve was skipped, missing **vetting** is correct — finish T05 first.

---

### M2-T10 — Removing services turns go-live off

**Pri:** Must

There is no delete-service control on current `main`. Use SQL, then read go-live (GET reconciles `listed`):

```sql
DELETE FROM catalog.services WHERE provider_id = '<F-P1 provider uuid>';
```

| Step | Action | Expected |
|---|---|---|
| 1 | Run the DELETE above | Row count ≥ 1 |
| 2 | As F-P1, `GET /api/catalog/me/go-live` | `listed` is false. `missing` contains `services` |

Re-add Cut ₪200 / 60 before leaving the lab if M3 QC will reuse F-P1. Prefer **new** F-P1 for M3 (see STD-M3 fixtures).

---

### M2-T11 — Provider A cannot read provider B

**Pri:** Must  
**Profiles:** F-P2 registered as provider

| Step | Action | Expected |
|---|---|---|
| 1 | As F-P2, `GET /api/catalog/me/application` | F-P2 draft only |
| 2 | As F-P2, `GET /api/catalog/me/services` | Not F-P1’s Cut |
| 3 | As F-P2, `GET /api/availability/me/schedule` | Not F-P1’s Monday rule |
| 4 | As F-P2, `GET /api/admin/vetting` | 403 |

---

### M2-T12 — Block overlapping occupancy fixture

**Pri:** Should  
**How.** API only (no booking table).

Signed in as F-P1:

```bash
curl -s -X POST http://localhost:3000/api/availability/me/exceptions \
  -H 'content-type: application/json' \
  -b 'shearly_session=…' \
  -d '{
    "date":"2026-08-24",
    "kind":"block",
    "occupancy":[{"id":"fix-1","start":"2026-08-24T09:00:00.000Z","end":"2026-08-24T10:00:00.000Z"}]
  }'
```

**Expected.** 400. Translation/key contains `availability.conflicts:fix-1`.

Then POST the same date **without** `occupancy` → 200 (UI block path).

---

### M2-T13 — Schedule surface

**Pri:** Should

`GET /api/availability/me/schedule`

**Expected.** JSON has `weekly`, `exceptions`, `occupancy` (array; empty or fixtures — **no** real booking rows).

---

### M2-T14 — Hebrew provider chrome

**Pri:** Should

| Step | Action | Expected |
|---|---|---|
| 1 | `/he/provider` as F-P1 | Section titles in Hebrew (בקשה, פרופיל, שירותים, זמינות, עלייה לאוויר) |
| 2 | `dir=rtl` | Holds |

---

### M2-T15 — Reject

**Pri:** Should  
Register a throwaway provider, submit a full packet, as admin **Reject**.

**Expected.** Leaves queue (or returns to draft). Cannot go-live. F-P1 is unaffected.

---

## 6. Explicitly out of M2 QC

| Item | STD |
|---|---|
| Public `/` discovery results | M3 |
| Address book | M3 |
| `POST /bookings` | none yet (M4) |
| Live Stripe hosted onboarding | optional; stub is the Must |

---

## 7. Run log

| Field | Value |
|---|---|
| Date | |
| Commit | |
| Tester | |
| F-P1 email / provider UUID | |
| Reset | |

| ID | Pri | Verdict | Notes |
|---|---|---|---|
| M2-T01 | Must | | |
| M2-T02 | Must | | |
| M2-T03 | Must | | |
| M2-T04 | Must | | |
| M2-T05 | Must | | |
| M2-T06 | Must | | |
| M2-T07 | Must | | |
| M2-T08 | Must | | |
| M2-T09 | Must | | |
| M2-T10 | Must | | |
| M2-T11 | Must | | |
| M2-T12 | Should | | |
| M2-T13 | Should | | |
| M2-T14 | Should | | |
| M2-T15 | Should | | |

**Milestone QC:** PASS / FAIL
