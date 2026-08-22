# QC Findings Log

Running record of QC FAILs that are real product gaps, kept here until each is triaged into a milestone plan or a tracked backlog item. Not a substitute for [README.md](./README.md) run logs — this file is for findings that outlive a single run and need a decision (fix now, defer, or accept as a named hole).

**Do not** log BLOCKED (lab/env issues) or tester mistakes here — only FAILs that are confirmed real, per [README.md](./README.md) §2 verdicts.

---

## How to add a finding

1. Append a row to the table below. Use the next `QCF-###` id.
2. Link the procedure id (e.g. `M2-T03`) and the milestone STD it came from.
3. Keep **Summary** to one line; put root cause / repro detail in **Notes**.
4. Status starts `Open`. Update to `Fixed` (link the PR), `Backlog` (link the issue/plan item), or `Accepted` (named hole, say where it's documented) once triaged.

| ID | Procedure | Severity | Summary | Status | Notes |
|---|---|---|---|---|---|
| QCF-001 | M1-T05 step 9 | Must | Re-submitting a used/expired/unknown reset token showed the generic "Email or password is incorrect" instead of a reset-specific message | Fixed | Root cause: `ResetConfirmForm` discarded the response body and ignored `translationKey`. Backend token single-use enforcement was already correct. Fixed on `fix/m1-reset-invalid-token-message`; added missing `resetInvalid` i18n string (en/he). |
| QCF-002 | M2-T02 step 3 | Must | Submitting a vetting packet for review showed `pending_review` in the UI but sent no Mailpit mail | Fixed | Root cause: `CatalogService.submit()`/`.decide()` never called a mailer — M1's SMTP helper was wired into `IdentityService` only. Fixed on `fix/m2-t02-submit-decision-mail`; added service-level and HTTP-level regression tests. |
| QCF-003 | M2-T03 | Should | Admin vetting queue cards show only a generic status string ("Waiting for interview") — no provider name, email, or id. With 2+ pending providers, rows are indistinguishable | Open | M2-P6 plan spec required "queue **+ detail** + document open... + decision form"; shipped UI has none of the detail/document-open parts. QC doc (`std-m2-supply.md` M2-T04) already separately flags the missing "Open document" button as a known gap — this is the same shortfall extended to provider identity on the queue card itself. |
| QCF-004 | CI gates 1–8, "E2E both locales" | Must | `demand-smoke.spec.ts` ("hebrew visitor finds an in-radius provider and slots") intermittently failed on unrelated PRs with the wrong provider id in the URL assertion | Fixed | Not found via manual QC — surfaced as CI red while merging an unrelated PR. Root cause: the test clicked the page-wide first "open profile" link instead of the link inside its own seeded provider's card; each CI retry (`retries: 2`) re-seeds a new listed provider without cleaning up the prior attempt's row, so once 2+ listed providers coexist in radius, `.first()` grabs the wrong one. Fixed on `fix/e2e-demand-smoke-profile-link-scope` by scoping the click to the list item containing the seeded provider's unique name. Verified locally by reproducing the pollution (4 coexisting listed providers) and re-running clean. |

---

## Triage

| Status | Meaning |
|---|---|
| **Open** | Confirmed real, not yet scheduled |
| **Fixed** | Shipped; branch/PR linked in Notes |
| **Backlog** | Converted into a tracked backlog item (link it in Notes); remove from Open review but keep the row for history |
| **Accepted** | Deliberately not fixing — named hole, documented where (plan doc, README, etc.) |
