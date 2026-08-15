# STD-M1 — Accounts

**Document ID:** `STD-M1`  
**Milestone:** M1 Accounts  
**Plan:** [m1-accounts.md](../04-implementation-plan/m1-accounts.md)  
**Lab:** [lab.md](./lab.md)  
**Depends on:** STD-M0 Must procedures still PASS  
**Applies to:** `main` at or after [#21](https://github.com/natank/shearly/pull/21)  
**Est. time:** 45 minutes

---

## 1. Purpose

Identity is a real perimeter: sessions (not JWTs), one role per account, enumeration-safe auth, reset that kills every session.

Master demo: “Register, sign in/out, reset; customer vs provider land on different surfaces.”

---

## 2. Traceability

| Procedure | Pri | Stories / NFRs |
|---|---|---|
| M1-T01 | Must | CUS-002, NFR-I18N-004 |
| M1-T02 | Must | CUS-003 |
| M1-T03 | Must | PRV-001 |
| M1-T04 | Must | PRV-001 (cannot be both) |
| M1-T05 | Must | CUS-004 |
| M1-T06 | Must | NFR-SEC-004 |
| M1-T07 | Must | NFR-SEC-007 |
| M1-T08 | Must | NFR-SEC-008 |
| M1-T09 | Should | NFR-SEC-003 |
| M1-T10 | Should | guest-draft write |
| M1-T11 | Should | CUS-002 short password |

---

## 3. Fixtures

Create **during** the run (do not pre-insert). Use profile B/C from [lab.md](./lab.md) §5.

| ID | Role | Email pattern | Password |
|---|---|---|---|
| F-C1 | customer | `qc-m1-cust-<date>@example.com` | `long-enough-password` |
| F-P1 | provider | `qc-m1-prov-<date>@example.com` | `long-enough-password` |
| F-ADM | admin | `admin@shearly.local` | `change-me-admin-10` (seed) |

**Mail.** Mailpit http://localhost:8025 — empty the inbox at the start of M1-T05.

---

## 4. Reset

1. R0 (sign out everywhere).
2. If leftover QC accounts confuse you, R2 then re-run migrate (admin returns).
3. R1 before M1-T09 if you already tripped the limiter.

Bring-up: [lab.md](./lab.md) §2 including `pnpm nx run api:migrate`.

---

## 5. Procedures

### M1-T01 — Register customer in Hebrew

**Pri:** Must  
**Profiles:** B

| Step | Action | Expected |
|---|---|---|
| 1 | Open http://localhost:3000/he/register | Form in Hebrew. Password hint present |
| 2 | Email F-C1, password `long-enough-password`, role **לקוח/ה** (default), submit | Lands on customer home. Heading **החשבון שלך**. Email shown |
| 3 | SQL: `SELECT role, locale FROM identity.accounts WHERE email = '…'` | `role = customer`, `locale = he` |

**Fail if** you land on the provider dashboard, or locale is not `he`.

---

### M1-T02 — Sign out and sign in

**Pri:** Must  
**Profiles:** B (continue F-C1)

| Step | Action | Expected |
|---|---|---|
| 1 | Click sign-out | Session ends. `/he` (or sign-in) with no account email in the chrome |
| 2 | Open `/he/sign-in`, enter F-C1 + password | Back on customer home |
| 3 | Open a private window, `/he/account` with no cookie | Redirected to sign-in |

---

### M1-T03 — Register provider on a second email

**Pri:** Must  
**Profiles:** C

| Step | Action | Expected |
|---|---|---|
| 1 | Open http://localhost:3000/en/register | English register |
| 2 | Email F-P1, same password, role **Provider**, submit | Lands on **Provider home**, not customer home |
| 3 | SQL `role` | `provider` |

On current `main` the provider page includes the M2 dashboard. That is allowed.

---

### M1-T04 — One role per account

**Pri:** Must  
**Profiles:** B

| Step | Action | Expected |
|---|---|---|
| 1 | While signed in as F-C1, try to “also become a provider” if any UI offers it | No control that adds `provider` to the same account |
| 2 | Sign out. Register F-C1 again as provider | Public response does **not** say “email exists” as an oracle (see T06). No second account with both roles |
| 3 | SQL: `SELECT count(*), role FROM identity.accounts WHERE email = 'F-C1' GROUP BY role` | One row, `customer` |

---

### M1-T05 — Password reset kills sessions

**Pri:** Must  
**Profiles:** B + Mailpit

| Step | Action | Expected |
|---|---|---|
| 1 | Sign in as F-C1. Leave this tab open on `/he/account` | Authenticated |
| 2 | In another tab, open `/he/reset-password`. Submit F-C1 | Same confirmation whether or not you believe the email exists: **אם האימייל רשום, קישור לאיפוס בדרך.** / EN: **If that email is registered, a reset link is on its way.** |
| 3 | Open http://localhost:8025 | One message **Shearly password reset** to F-C1. Body contains `http://localhost:3000/he/reset-password?token=` |
| 4 | Repeat request for a **never-used** email | Identical page copy. Mailpit: **no** mail, or no extra user-visible difference on the web |
| 5 | Open the token link. Set password `new-enough-password` | Success. You are **not** auto-signed-in (M1-Q2) |
| 6 | Reload the still-open account tab from step 1 | Session dead — redirect to sign-in |
| 7 | Sign in with the **old** password | Generic failure (T06) |
| 8 | Sign in with `new-enough-password` | Customer home |
| 9 | Open the **same** reset link again | Rejected / told to request a new link |

---

### M1-T06 — Enumeration-safe failures

**Pri:** Must  
**Profiles:** B, logged out

| Step | Action | Expected |
|---|---|---|
| 1 | `/en/sign-in` with F-C1 + wrong password | **Email or password is incorrect.** |
| 2 | `/en/sign-in` with `nobody-qc@example.com` + any password | **The same sentence.** No “does not exist” |
| 3 | Optional: DevTools network on both POSTs | Same JSON shape (`ok: false`, `translationKey: auth.invalidCredentials`) |

---

### M1-T07 — Session cookie flags

**Pri:** Must  
**Profiles:** B, signed in

| Step | Action | Expected |
|---|---|---|
| 1 | DevTools → Application → Cookies → `http://localhost:3000` | Cookie `shearly_session` |
| 2 | Inspect flags | **HttpOnly** yes. **SameSite** Lax. **Secure** may be off on http localhost (required in production) |
| 3 | Cookie value | Opaque (not a JWT with three `.` segments of base64 payload) |

---

### M1-T08 — `/me` is the caller only

**Pri:** Must  
**Profiles:** B and C signed in

| Step | Action | Expected |
|---|---|---|
| 1 | As F-C1, `GET http://localhost:3000/api/me` (browser or copy cookie into curl) | JSON account is F-C1, role customer |
| 2 | As F-P1, same | F-P1, role provider |
| 3 | No cookie | 401 |

There is no `GET /accounts/:otherId` in M1. Do not invent one.

---

### M1-T09 — Auth rate limit

**Pri:** Should  
**Reset:** R1 first

| Step | Action | Expected |
|---|---|---|
| 1 | POST `/api/auth/sign-in` 11 times quickly with a bad password (curl or UI) | After the threshold, HTTP **429** and `errors.rateLimited` (or equivalent) |
| 2 | R1, retry once | Sign-in endpoint accepts the request again (still fails auth if password is wrong) |

Default threshold is 10 / 60 s.

---

### M1-T10 — Guest draft cookie (write only)

**Pri:** Should

```bash
curl -s -D - -o /tmp/gd.json \
  -H 'content-type: application/json' \
  -X POST http://localhost:4000/auth/guest-draft \
  -d '{"slotId":"qc-slot","providerId":"qc-prov"}'
```

**Expected.** `Set-Cookie: shearly_guest_draft=…`. `GET /auth/guest-draft` with that cookie returns the payload. **No** booking is created.

---

### M1-T11 — Password policy

**Pri:** Should

| Step | Action | Expected |
|---|---|---|
| 1 | Register with password `short` | Rejected before or at submit. Hint: at least 10 characters |

---

### M1-T12 — Admin seed (admin surface)

**Pri:** Should  
**Profiles:** D

| Step | Action | Expected |
|---|---|---|
| 1 | http://localhost:4300/en | Sign-in, not the web register form as the only path |
| 2 | F-ADM credentials | Signed in as admin. Link **Vetting queue** (queue itself is M2) |
| 3 | F-C1 on admin sign-in | Not treated as admin (`auth.adminOnly` / rejected) |

---

## 6. Explicitly out of M1 QC

Address book, vetting documents, discovery listing, bookings.

---

## 7. Run log

| Field | Value |
|---|---|
| Date | |
| Commit | |
| Tester | |
| F-C1 / F-P1 emails used | |
| Reset | |

| ID | Pri | Verdict | Notes |
|---|---|---|---|
| M1-T01 | Must | | |
| M1-T02 | Must | | |
| M1-T03 | Must | | |
| M1-T04 | Must | | |
| M1-T05 | Must | | |
| M1-T06 | Must | | |
| M1-T07 | Must | | |
| M1-T08 | Must | | |
| M1-T09 | Should | | |
| M1-T10 | Should | | |
| M1-T11 | Should | | |
| M1-T12 | Should | | |

**Milestone QC:** PASS / FAIL
