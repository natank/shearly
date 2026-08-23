# Shearly MVP — Quality Control

**Role.** Manual system test descriptions (STDs) for a human tester.  
**Scope.** MVP milestones that have shipped on `main`.  
**Does not replace.** CI gates 1–8, Playwright smokes, or unit tests. Those are the production line. These documents are **incoming inspection** after a milestone is declared complete, and **regression QC** before the next milestone starts.

| ID | STD | Milestone | Plan |
|---|---|---|---|
| QC-M0 | [std-m0-foundation.md](./std-m0-foundation.md) | M0 Foundation | [m0-foundation.md](../04-implementation-plan/m0-foundation.md) |
| QC-M1 | [std-m1-accounts.md](./std-m1-accounts.md) | M1 Accounts | [m1-accounts.md](../04-implementation-plan/m1-accounts.md) |
| QC-M2 | [std-m2-supply.md](./std-m2-supply.md) | M2 Supply | [m2-supply.md](../04-implementation-plan/m2-supply.md) |
| QC-M3 | [std-m3-demand.md](./std-m3-demand.md) | M3 Demand | [m3-demand.md](../04-implementation-plan/m3-demand.md) |
| QC-M4 | [std-m4-transaction.md](./std-m4-transaction.md) | M4 Transaction | [m4-transaction.md](../04-implementation-plan/m4-transaction.md) |
| QC-M5 | [std-m5-operate-and-bar.md](./std-m5-operate-and-bar.md) | M5 Operate & bar | [m5-operate-and-bar.md](../04-implementation-plan/m5-operate-and-bar.md) |

Shared lab, credentials, and wipe/reset: [lab.md](./lab.md).

Running log of confirmed FAILs pending triage into the backlog: [findings.md](./findings.md).

---

## 1. When to run

| Trigger | What to run |
|---|---|
| Milestone marked complete on `main` | That milestone’s STD, end to end |
| Starting `m{N+1}` implementation | Previous STD as a regression gate (at least the **demo** procedures) |
| Hotfix on a shipped milestone | Affected procedures + the demo |
| Release candidate / founder review | M0 demo + M1 demo + M2 demo + M3 demo in order |

A later STD assumes earlier milestones still hold. Do not skip M0/M1 smoke when QC’ing M3.

---

## 2. How to record a run

Copy the **Run log** table at the bottom of the STD into the PR, issue, or a dated note under this folder (`runs/YYYY-MM-DD-mN.md` is optional).

Verdicts:

| Verdict | Means |
|---|---|
| **PASS** | Observed result matches **Expected** |
| **FAIL** | Observed result contradicts **Expected**. Log it in [findings.md](./findings.md) with the procedure ID |
| **BLOCKED** | Could not execute (lab down, missing fixture). Not a product fail |
| **WAIVED** | Procedure skipped with a written reason (out of env, named hole) |

The milestone QC **passes** only if every **Must** procedure is PASS or an explicit WAIVE with owner + reason. **Should** procedures may FAIL without blocking the next milestone, but they must be listed.

---

## 3. Rules for testers

1. Follow **steps in order**. Do not invent product behavior.
2. Use only fixtures in the STD or [lab.md](./lab.md). No live Stripe, no paid geocoder.
3. Record **actual text** you saw when a check fails (locale, URL, HTTP status).
4. One role per browser profile. Customer, provider, and admin must not share cookies.
5. After a **hard reset**, re-seed from that STD’s fixture section before continuing.
6. Do not treat Playwright green as a substitute for a Must procedure. CI does not click Mailpit or judge “looks finished.”

---

## 4. Writing the next STD (M4+)

When `mN-*.md` is accepted:

1. Add `docs/mvp/QC/std-mN-….md` with the same sections as M1–M3.
2. Trace every **Must** procedure to a story or NFR in that plan’s §1 table.
3. Put new fixtures and reset extras in [lab.md](./lab.md) if they are reused; otherwise keep them in the STD.
4. Link the file from this README and from the master plan document map.
