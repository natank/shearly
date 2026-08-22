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
| QCF-005 | M3-T09 step 2 | Must | Saving a customer address threw an uncaught `TypeError: Cannot read properties of null (reading 'reset')` in `addresses.tsx:39`, though the address still saved and appeared after a manual reload | Fixed | Root cause: `AddressBook`'s `onSave` read `event.currentTarget` a second time *after* an `await fetch(...)` — by then the SyntheticEvent's `currentTarget` is already null, since the event has finished dispatching. Fixed on `fix/m3-t09-address-form-reset-crash` by capturing the form element into a local variable before the `await`. Added `apps/web-e2e/src/addresses-smoke.spec.ts` (register → save address → assert no `pageerror` and the row appears); confirmed it fails on the pre-fix code and passes on the fix. |
| QCF-006 | M3-T09 (`GET /catalog/public/<random/malformed id>`) | Must | `GET /catalog/public/234243423243` returned `500 Internal Server Error` instead of the spec'd `404` for an unlisted/random/malformed provider id | Fixed | Root cause: every `:providerId`/`:serviceId`/`:docId` route param in `catalog-routes.ts` was passed straight into a `uuid`-typed SQL `WHERE` clause; a non-UUID string throws a raw Postgres cast error that the global handler only maps to a generic `500` (it only special-cases `AppError` subclasses). Affected 7 routes: public provider profile, service slots, portfolio doc, and all three admin vetting routes. Fixed on `fix/m3-t09-catalog-uuid-param-500` by adding a `requireUuidParam` helper that validates the param shape up front and throws `NotFoundError` (→ 404) on a bad shape, applied at every affected call site. Added regression tests in `catalog-public.spec.ts` and `catalog.spec.ts` covering malformed ids on all 7 routes. |
| QCF-007 | M3-T13 | Should | M3-T13's WAIVE justification ("covered by unit tests") is only half true: `defaultDistanceThenRating`'s sort logic is unit-tested (`libs/domain/ranking/src/ranking.spec.ts:99`), but the `try/catch` in `apps/api/src/discovery.ts` that actually triggers the fallback on a ranker throw or `rankingTimeoutMs` timeout has zero test coverage — no spec references `composeDiscovery`, the `Promise.race` timeout, or the catch branch | Open | Not a functional bug — code review of `discovery.ts`'s try/catch shows it's correctly wired (catches both a thrown error and the timeout race, falls back to the tested sort). WAIVED for M3 per the doc's own allowance; logged here so the missing integration test isn't lost. Would need injecting a throwing/timing-out `ProviderRanker` into `composeDiscovery` in a real test to close. |

---

## Triage

| Status | Meaning |
|---|---|
| **Open** | Confirmed real, not yet scheduled |
| **Fixed** | Shipped; branch/PR linked in Notes |
| **Backlog** | Converted into a tracked backlog item (link it in Notes); remove from Open review but keep the row for history |
| **Accepted** | Deliberately not fixing — named hole, documented where (plan doc, README, etc.) |
