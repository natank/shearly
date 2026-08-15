# STD-M0 — Foundation

**Document ID:** `STD-M0`  
**Milestone:** M0 Foundation  
**Plan:** [m0-foundation.md](../04-implementation-plan/m0-foundation.md)  
**Lab:** [lab.md](./lab.md)  
**Applies to:** `main` at or after merge of [#14](https://github.com/natank/shearly/pull/14)  
**Tester:** human, one session  
**Est. time:** 25 minutes

---

## 1. Purpose

Confirm the empty product shell is operable locally, both locales render with the correct text direction, and the production-line gates exist. There is **no** marketplace behavior to accept in M0.

Master demo: “Empty app in HE + EN, CI green, one-command local.”

---

## 2. Traceability

| Procedure | Pri | Stories / NFRs | Plan exit |
|---|---|---|---|
| M0-T01 | Must | NFR-CI-001, SC-7 | one-command local |
| M0-T02 | Must | NFR-I18N-001/002/004, SC-4 harness | `/he` RTL, `/en` LTR |
| M0-T03 | Must | NFR-UX-001 | tokenized shell, no hex |
| M0-T04 | Must | NFR-CI-001 | API health |
| M0-T05 | Must | NFR-CI-001 | admin shell |
| M0-T06 | Must | NFR-SEC-006 | `.env` not in git |
| M0-T07 | Should | NFR-CI-003 | locale smoke command |
| M0-T08 | Should | NFR-CI-001 | architecture boundary fixture |
| M0-T09 | Should | NFR-CI-005 | secret scan present in CI file |

---

## 3. Fixtures

None. M0 has no accounts, no catalog, no mail.

**Tools:** browser, terminal, this repo.

---

## 4. Reset

1. Stop any leftover `serve` processes.
2. [lab.md](./lab.md) §2 bring-up. Use **R3** only if Compose will not start.
3. Do not run product migrations as a *requirement* of M0; on current `main`, `api:migrate` is allowed and recommended so later STDs can follow immediately.

---

## 5. Procedures

### M0-T01 — Lab starts from a clean clone recipe

**Pri:** Must  
**Objective.** The README cluster comes up.

| Step | Action | Expected |
|---|---|---|
| 1 | From repo root run the bring-up in [lab.md](./lab.md) §2 | Commands exit 0. No secret prompted |
| 2 | `curl -s http://localhost:4000/health` | JSON `{"ok":true}` |
| 3 | Open http://localhost:3000/en | Page loads. Heading **Shearly** |
| 4 | Open http://localhost:4300/en | Page loads. Heading **Shearly Admin** |

**Fail if** a surface is down, or health is not ok.

---

### M0-T02 — Locale shell and direction

**Pri:** Must  
**Objective.** URL locale drives `lang` / `dir` and translated chrome.

| Step | Action | Expected |
|---|---|---|
| 1 | Open http://localhost:3000/en | `<html lang="en" dir="ltr">`. H1 **Shearly**. Locale control offers Hebrew |
| 2 | Click the control that switches to Hebrew (label **עברית**) | URL becomes `/he`. `<html lang="he" dir="rtl">`. H1 **שירלי** |
| 3 | Switch back to English | `/en`, LTR, **Shearly** |
| 4 | View page source / inspector on both | No raw i18n keys like `common.appName` visible |

**Fail if** Hebrew is LTR, English is RTL, or untranslated keys show.

---

### M0-T03 — Design tokens, not mixed chrome

**Pri:** Must  
**Objective.** The shell uses the design system, not ad-hoc hex.

| Step | Action | Expected |
|---|---|---|
| 1 | Inspect the H1 and links on `/en` | Colors/spacing come from utility classes (`text-*`, `p-4`, `gap-*`), not inline `#rrggbb` |
| 2 | Repeat on admin `/en` | Same |

**Fail if** feature screens appear that M0 forbade (booking, discovery forms were added in later milestones — on current `main` discovery **is** on `/en`. For a **historical M0-only tag**, skip the discovery card and only judge the chrome: H1, locale switcher, sign-in/register links). On current `main` this procedure judges **chrome only**.

---

### M0-T04 — API process is independent

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | `curl -sI http://localhost:4000/health` | HTTP 200 |
| 2 | `curl -s http://localhost:4000/no-such-route` | Not an HTML Next 404 from `:3000`. API error JSON or 404 from Hono |

---

### M0-T05 — Admin is a separate surface

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | Open http://localhost:4300/en | **Shearly Admin**, not the customer H1 alone |
| 2 | Confirm port 4300 ≠ 3000 | Two apps |

On current `main` a sign-in form is present (M1+). That does not fail M0.

---

### M0-T06 — Secrets stay out of git

**Pri:** Must

| Step | Action | Expected |
|---|---|---|
| 1 | `git check-ignore -v .env` | `.env` is ignored |
| 2 | `git ls-files .env` | Empty |
| 3 | Open `.env.example` | Contains `DATABASE_URL`, `GEOCODER_URL`, `SMTP_URL`, empty Stripe placeholders — no live secret values |

---

### M0-T07 — Locale smoke (automated harness)

**Pri:** Should  
**Objective.** The M0 Playwright harness still runs.

```bash
pnpm exec nx e2e web-e2e -- --grep "shell is"
```

Or run the full `pnpm e2e` if preferred.

**Expected.** English LTR + **Shearly**; Hebrew RTL + **שירלי**. Single H1 on `/en` and `/he` for the app name (discovery title must not be a second H1 — current `main` uses H2 for “Find a stylist”).

---

### M0-T08 — Boundary fixture exists

**Pri:** Should

| Step | Action | Expected |
|---|---|---|
| 1 | List `tools/architecture` and `tools/architecture-fixtures` | Fixture that would import a service from a web app exists |
| 2 | Optional: `pnpm exec nx lint architecture` | Passes on `main` (the illegal import is in a fixture project that is *expected* to fail when pointed at, or is asserted by the architecture test — do not merge a real `apps/web` → `libs/services/*` import) |

---

### M0-T09 — CI file lists gates 1–8

**Pri:** Should

| Step | Action | Expected |
|---|---|---|
| 1 | Open `.github/workflows/ci.yml` | Jobs/steps named for setup, lint/format, typecheck, unit, integration, build, e2e, secret scan |
| 2 | Open GitHub Actions for `main` | Latest `CI` / `gates 1–8` is green |

**Note.** Required-check wiring on branch protection is a named M0 residual. A green run that is not required is **not** a FAIL of this procedure; record it as residual in the log.

---

## 6. Explicitly out of M0 QC

Feature register, vetting, discovery results, bookings, payments.

---

## 7. Run log

| Field | Value |
|---|---|
| Date | |
| Commit / `main` SHA | |
| Tester | |
| Lab reset used | R0 / R3 / none |

| ID | Pri | Verdict | Notes |
|---|---|---|---|
| M0-T01 | Must | | |
| M0-T02 | Must | | |
| M0-T03 | Must | | |
| M0-T04 | Must | | |
| M0-T05 | Must | | |
| M0-T06 | Must | | |
| M0-T07 | Should | | |
| M0-T08 | Should | | |
| M0-T09 | Should | | |

**Milestone QC:** PASS / FAIL  
**Residual:** branch protection required checks (M0 plan §6)
