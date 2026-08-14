# M0 — Foundation

**Milestone ID:** `M0`  
**Master:** [04-implementation-plan.md](./04-implementation-plan.md) — §4 M0, §5 row “no story”, §7 DoD (SC-7 first claim)  
**Design:** `docs/mvp/03-design.md` §3 (Nx + tags), §5.2/§5.4/§5.5 (tokens, i18n, RTL), §6.5 (error taxonomy stub), §9 (local + config), §10.1 (CI gates)  
**Requirements:** no functional stories. NFRs below.  
**Depends on:** nothing (first milestone)  
**Unlocks:** M1–M5  
**Status:** Complete  
**Implementation:** shipped on `main` 2026-08-14 (`6b123c5`, merge of [#14](https://github.com/natank/shearly/pull/14))

---

## 1. Traceability

This file may not add, drop, or move stories. The master map is the source of truth. If M0 needs a story the master did not assign, change the master first.

| Master claim | This plan |
|---|---|
| Goal: repo matches design §3; CI rejects boundary violations | §3–§5 |
| Builds: Nx, split app tags, three app shells, Compose, typed config, shadcn tokens, i18n + logical-CSS lint, GHA 1–8, preview deploy | PRs `M0-P1`…`M0-P7` |
| Stories: none | §2 |
| NFRs: CI-001 skeleton, SEC-006, UX-001 tokens, I18N-001/002 wiring, CI-003 *harness* | §2 |
| Exit: one-command local; web→service import fails CI; `/he` and `/en` render; merge blocked on lint/type/test/build | §6 |
| Not in M0: feature screens, Stripe live keys, real SES | §7 |

| ID | Pri | Coverage in M0 | Notes |
|---|---|---|---|
| — | — | no functional stories | Master §5 |
| NFR-CI-001 | P0 | skeleton | Pipeline exists; every later PR inherits the gate |
| NFR-CI-002 | P0 | thresholds wired | 90% domain + payments / 80% else — almost no code yet; config present so M1 cannot “forget” |
| NFR-CI-003 | P0 | harness only | Trivial HE + EN smoke. Booking path is M4/M5 |
| NFR-CI-005 | P1 | secret scan + dep audit | Gate 8 |
| NFR-SEC-006 | P0 | `.env` ignored; `.env.example` complete; scan fails on secrets | No AWS secrets yet |
| NFR-UX-001 | P0 | tokens + shadcn in `libs/ui/design-system` | No feature screens |
| NFR-I18N-001 | P0 | i18n wired; CI fails on hardcoded JSX text | Two strings: app name, locale switcher |
| NFR-I18N-002 | P0 | `dir` from locale; ESLint bans physical CSS | RTL proven on the shell, not a product flow |
| NFR-I18N-004 | P1/P0 | locale in the URL | Persistence on the user record is M1 |
| SC-7 | — | first claim | Empty tree is green |
| SC-4 | — | harness | Product proof is M3+ |
| SC-5 | — | tokens only | Bar is M5 |

---

## 2. Goal and demo

**Goal.** The shape of the repo is the shape in design §3, and CI will not accept a boundary violation.

**Demo at exit.** Clone, one command cluster, open `/he` and `/en`. The shell uses the design-system tokens, Hebrew is RTL, English is LTR. GitHub Actions on the PR is green. A deliberately illegal import is shown (in a test, not on `main`) to fail `enforce-module-boundaries`.

There is no product. That is the point.

---

## 3. PR sequence

Branch per PR: `m0/{slug}` off `main`. One concern per PR. Each cites `M0-P#` and the NFR IDs it touches. Merge = design §10.1 gates 1–8 (gates that have no work yet — e.g. E2E before `M0-P6` — must still run and pass as empty/skip-zero, not be omitted).

```
M0-P1 workspace + tags + stubs
    │
    ▼
M0-P2 app shells (web, admin, api)
    │
    ├──────────────┐
    ▼              ▼
M0-P3 Compose   M0-P4 design system + i18n/RTL
    │              │
    └──────┬───────┘
           ▼
        M0-P5 typed config + error taxonomy
           │
           ▼
        M0-P6 CI gates 1–8 + locale smoke E2E
           │
           ▼
        M0-P7 container + preview deploy workflow
```

`M0-P3` and `M0-P4` may proceed in parallel after `M0-P2`. Nothing else is parallel.

### Delivery (as shipped)

| Plan ID | PR | Title | Merged |
|---|---|---|---|
| M0-P1 | [#7](https://github.com/natank/shearly/pull/7) | Nx workspace, tags, and lib stubs | 2026-08-14 |
| M0-P2 | [#8](https://github.com/natank/shearly/pull/8) | App shells (web, admin, api) | 2026-08-14 |
| M0-P3 | [#9](https://github.com/natank/shearly/pull/9) | Local Compose and geocoder stub | 2026-08-14 |
| M0-P4 | [#10](https://github.com/natank/shearly/pull/10) | Design system, i18n, and RTL | 2026-08-14 |
| M0-P5 | [#11](https://github.com/natank/shearly/pull/11) | Config and error taxonomy | 2026-08-14 |
| M0-P6 | [#12](https://github.com/natank/shearly/pull/12) | CI and locale smoke E2E | 2026-08-14 |
| — | [#13](https://github.com/natank/shearly/pull/13) | Compose images for Apple Silicon | 2026-08-14 |
| M0-P7 | [#14](https://github.com/natank/shearly/pull/14) | Container image and preview-ready deploy workflow | 2026-08-14 |

CI on the #14 merge to `main`: workflow **CI** (gates 1–8) success; workflow **Image** (build + `/health` smoke) success.

### M0-P1 — Workspace, tags, empty graph

**Why first.** Boundary rules added late are boundary rules already violated (design §14).

**Does**
- pnpm + Nx workspace at repo root
- TypeScript project references
- `.gitignore`, `.nvmrc` / engines, Prettier, ESLint with `@nx/enforce-module-boundaries`
- Tags exactly as design §3.3 — including the split `type:app-api` vs `type:app-web`. No `type:app`
- **Empty stubs** for every library in design §3.1 so the graph exists before anyone writes a feature:

| Project | Tag |
|---|---|
| `libs/services/{identity,provider-catalog,availability,booking,payments,notifications}` | `type:service` |
| `libs/contracts/{same six}` | `type:contract` |
| `libs/domain/{booking-state-machine,pricing,slot-computation,ranking}` | `type:domain` |
| `libs/shared/{config,events,observability,errors,testing}` | `type:shared` |
| `libs/ui/design-system`, `libs/ui/i18n` | `type:ui` |
| `libs/ui/feature-{discovery,booking,provider,account}` | `type:feature` |

Stubs export a single named constant (e.g. `SERVICE_NAME`) so they are valid TS. No I/O, no HTTP, no schema.

**Files.** `nx.json`, `tsconfig.base.json`, `eslint.config.*`, `package.json`, `pnpm-workspace.yaml`, `libs/**/project.json`, `libs/**/src/index.ts`, `README.md` (local commands from design §9.1, even if Compose arrives in P3).

**Tests**
- Architecture: a fixture file under `tools/` or `libs/shared/testing` that *would* import `libs/services/booking` from a `type:app-web` path is asserted to violate the ESLint rule (lint the fixture with the rule enabled, expect failure). Do not put that import on `main` in `apps/web`.
- `type:domain` project graph has no dep on `type:shared` or `type:service`.

**Out.** No Next.js app yet (P2). No Docker (P3).

### M0-P2 — App shells

**Does**
- `apps/api` — Node HTTP (or the thin framework we will keep) with `GET /health`. Tagged `type:app-api`. Constructs nothing yet; empty composition root comment pointing at design §2.4.
- `apps/web` — Next.js App Router. Tagged `type:app-web`. One page: “Shearly” via i18n key once P4 lands; until then a single externalized placeholder is acceptable if P4 is immediate, otherwise a key `common.appName` with a temporary English fallback that P4 deletes.
- `apps/admin` — Next.js App Router, same tag as web. One page: “Shearly Admin”.
- Neither web nor admin imports any `type:service`.

**Files.** `apps/{web,admin,api}/**`, Next config, `apps/api` listen on a documented port.

**Tests.** Unit or API test: `/health` returns 200. Typecheck proves web/admin cannot see service internals.

**Out.** Locale prefixes (P4). Compose (P3).

**OQ-10 (design):** use a known-good App Router i18n adapter (`next-intl` or equivalent). Do not block on `next-i18next` if it fights the App Router. Resource format stays i18next-shaped JSON in `libs/ui/i18n`.

### M0-P3 — Compose (external dependencies only)

**Does**
- `docker-compose.yml`: Postgres **PostGIS** image, Mailhog, Stripe CLI listener (no live key), geocoder stub (`tools/geocoder-stub` — returns fixtures for seed addresses, no paid API).
- Documented ports. Volume for Postgres.
- `apps/api` can optionally wait-for Postgres; no migrations yet (no schemas).

**Files.** `docker-compose.yml`, `tools/geocoder-stub/**`, README update.

**Tests.** Compose config validates. Stub responds to one fixture GET.

**Out.** RDS, real Stripe, SES, S3. Schema-per-service migrations are M1+.

### M0-P4 — Design system + i18n + RTL

**Does**
- shadcn/ui copied into `libs/ui/design-system` (not a runtime package import). Tokens as CSS custom properties: color, space, type. No component outside this lib defines those.
- Tailwind **logical** properties. ESLint (or stylelint) **bans** `margin-left`, `margin-right`, `padding-left`, `padding-right`, `left`, `right` in component styles.
- Locale-prefixed routes `/he/...`, `/en/...`. `dir="rtl"` on `<html>` from the locale (design §5.5). Locale switcher on the shell.
- Every user-facing string in `libs/ui/i18n` namespaces. CI script fails the build on hardcoded JSX text (string literals in `apps/web`, `apps/admin`, `libs/ui/feature-*`).
- Default locale from the URL, not the browser, so `/he` is shareable.

**Files.** `libs/ui/design-system/**`, `libs/ui/i18n/{he,en}/*.json`, Next middleware / `[locale]` segment, lint rule, `scripts/check-hardcoded-strings` (or ESLint plugin).

**Tests.** Unit: `dir` is `rtl` for `he`, `ltr` for `en`. Lint: a fixture with `margin-left` fails. The two shell pages render the translated app name.

**Out.** Feature screens. Notification email RTL (M5). User-record locale (M1).

### M0-P5 — Typed config + error taxonomy

**Does**
- `libs/shared/config` parses `process.env` with Zod at boot. Missing/malformed config fails fast.
- ESLint: no `process.env` outside that lib.
- `.env.example` complete for local (DB URL, stub geocoder URL, Mailhog, empty Stripe test placeholders). `.env` git-ignored.
- `libs/shared/errors`: `ValidationError`, `NotFoundError`, `ConflictError`, `AuthorizationError`, `PaymentError`, `ExternalServiceError` — HTTP mapping + `translationKey`. No English strings in API error bodies.

**Files.** `libs/shared/config/**`, `libs/shared/errors/**`, `.env.example`, ESLint restriction.

**Tests.** Boot with a missing required var exits non-zero. `process.env` in `apps/api` is a lint failure (fixture). Error JSON contains `translationKey`, not a raw sentence.

**Out.** Market literals as config values can be placeholders (`ILS`, `15` km, `0.20` commission) — they are unused until later milestones.

### M0-P6 — CI + locale smoke E2E

**Does**
- GitHub Actions, `nx affected`, stages 1–8 from design §10.1:

| Stage | M0 expectation |
|---|---|
| 1 Setup | pnpm + Nx cache |
| 2 Lint & format | includes module boundaries + physical-CSS ban + hardcoded-string check |
| 3 Typecheck | `tsc --noEmit` affected |
| 4 Unit | Vitest; coverage thresholds **configured** (90% `libs/domain/*` + `libs/services/payments`, 80% else) |
| 5 Integration | service container Postgres; a smoke “can connect” test so the job is real, not skipped |
| 6 Build | Next web + admin + api |
| 7 E2E | Playwright: open `/en` and `/he`; assert `dir`, assert app name string, assert no untranslated-key pattern |
| 8 Security | secret scan, dependency audit |

- `apps/web-e2e` tagged `type:app-e2e`. `apps/api-e2e` can wait until M1 if `/health` is already covered as a unit/integration test; if created now it only hits `/health`.
- Merge is blocked on 1–8.

**Files.** `.github/workflows/ci.yml`, `apps/web-e2e/**`, coverage config, gitleaks or equivalent.

**Tests.** The workflow file is the test. First E2E is both locales (design §14).

**Out.** Full booking E2E (M4). Accessibility axe on checkout (M5).

### M0-P7 — Container + preview workflow

**Does**
- Dockerfile for the Fargate shape in design §10.3: one image, two processes (Next standalone + `apps/api` on localhost) **or** a documented compose-of-two-processes in one task. Health checks on web and `/api/health`.
- Workflow: build image, push to ECR on `main` and on PRs if AWS credentials exist.
- Preview deploy (DQ-2): per-PR URL if the AWS account is provisioned; if secrets are absent, the job **skips with an explicit “no AWS creds”** and does not fail the PR. Production named URL is **not** an M0 exit (master PQ-3: named URL by end of M3).
- No Route 53 / custom domain required here (DQ-1).

**Files.** `Dockerfile`, `.dockerignore`, `.github/workflows/deploy.yml`, short `docs` note in README on required GitHub secrets.

**Tests.** Image builds in CI. `/health` from the API process inside the image (smoke).

**Out.** RDS, Secrets Manager wiring for Stripe, SES, S3 buckets, CloudWatch alarms. Those are M2–M5 infra.

---

## 4. Layout at M0 exit

Matches design §3.1. Apps are shells. Libs are stubs except `design-system`, `i18n`, `config`, `errors`.

```
shearly/
├── apps/web, web-e2e, admin, api    # (+ api-e2e if created)
├── libs/services/*                  # stubs
├── libs/contracts/*                 # stubs
├── libs/domain/*                    # stubs
├── libs/shared/{config,errors}      # real; others stub
├── libs/ui/{design-system,i18n}     # real; feature-* stub
├── tools/geocoder-stub
├── docker-compose.yml
├── Dockerfile
└── .github/workflows/{ci,deploy}.yml
```

---

## 5. Local at M0 exit

```bash
pnpm install
docker compose up -d
pnpm nx run-many -t serve -p web,api,admin
```

- web: `/en`, `/he`
- admin: `/en` (or `/en/admin` — pick one in P2 and keep it; design OQ-8 is `/admin` or `admin.` host, same task)
- api: `/health`

No migrate step yet. Add it in M1 with the `identity` schema.

---

## 6. Exit checklist

Copy of the master M0 exit, made testable. Validated 2026-08-15 against `main` @ `6b123c5`.

- [x] `pnpm install && docker compose up -d && pnpm nx run-many -t serve -p web,api,admin` works on a clean clone from `.env.example` — documented in README; Compose + serve targets exist
- [x] `/he` renders RTL (`dir="rtl"`); `/en` renders LTR — Playwright `apps/web-e2e/src/locale-smoke.spec.ts`; `getTextDirection` unit tests
- [x] Both pages use tokenized type/color — no ad-hoc hex in `apps/web`
- [x] ESLint `enforce-module-boundaries`: `type:app-web` → `type:service` is an error; `type:service` → `type:service` is an error; `type:domain` → anything but `type:domain` is an error
- [x] Architecture fixture proves the web→booking-service violation is caught — `tools/architecture` + `tools/architecture-fixtures`
- [x] `process.env` outside `libs/shared/config` is a lint error (exempt: config lib, integration, Playwright, Vitest/Tailwind configs)
- [x] Hardcoded JSX display text is a CI failure — `pnpm check:i18n`
- [x] Physical direction properties are a lint error — `pnpm check:rtl`
- [x] CI stages 1–8 run on the PR
- [ ] Merge is **blocked** on those stages — residual: `main` has branch protection (`strict`, no force-push, enforce admins) but **no required status checks**. Workflows ran and were green; GitHub will still allow merge if they are red. Wire `gates 1–8` and `build and smoke` as required checks.
- [x] Playwright smoke passes in Hebrew and English — green on #14 and on `main`
- [x] Secret scan is in CI (gitleaks + GitGuardian); `.env` is not in git
- [x] Coverage thresholds are configured (90% domain + payments, 80% else)
- [x] Docker image builds — Image workflow green on `main`
- [x] Deploy workflow exists; skips cleanly without AWS secrets

Master demo: “Empty app in HE + EN, CI green, one-command local.”

### Accepted deviations from the written sequence

None change the master cuts. Recorded so M1 does not “fix” them by accident.

| Plan said | Shipped | Why |
|---|---|---|
| Compose Postgres **PostGIS** | Local: `postgres:16`. CI: `postgis/postgis:16-3.5` | Multi-arch / Podman Hub TLS. No geo queries until M3; add PostGIS locally with DIS-001 |
| Mailhog | Mailpit on the same ports (1025 / 8025) | Mailhog is amd64-only |
| Stripe CLI always up | `docker compose --profile stripe` | No live key in M0 |
| Admin URL pick in P2 | `apps/admin` on `:4300` | M0-Q1 default |
| Fastify or Hono | Hono | M0-Q2 default |
| `apps/api-e2e` optional | not created; `/health` is a unit test | Allowed by P6 |
| ECR / preview | workflow skips with “No AWS creds” | M0-Q3 / DQ-2 |

---

## 7. Explicitly not M0

| Item | Belongs |
|---|---|
| Feature screens, discovery, booking, admin queue | M1–M5 |
| Identity schema, sessions, cookies | M1 |
| Stripe **live** keys, PaymentIntents, Connect | M4 / M2 (PAY-005) |
| SES | M5 (Mailhog is enough locally) |
| S3 / KMS / vetting docs | M2 |
| Real geocoder API key | M3 (stub is enough) |
| Booking state machine implementation | M4 (stub lib only) |
| Ranking implementation + substitutability test | M3 (first ranking commit) |
| Named production URL | M3 (PQ-3) |
| Domain libs with real logic | their milestone |

Do not “just add” identity tables in M0 because Compose is up. That is M1.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Nx + Next App Router + i18n adapter costs a week | OQ-10: pick `next-intl` (or proven App Router i18next) in P2/P4; do not fight `next-i18next` |
| Full ECS preview is larger than a foundation | P7 may skip deploy without secrets; image build is the hard gate |
| Empty stubs rot | Stubs are tagged and typechecked; M1+ replace the export, they do not create a second project |
| Coverage thresholds fail on empty domain | Thresholds apply to files that exist; stubs are trivial and 100% covered by the constant export |

---

## 9. Open on M0

| # | Question | Resolution |
|---|---|---|
| **M0-Q1** | Admin URL: path `/admin` on the same Next app, or `apps/admin` as its own origin? | **Shipped:** `apps/admin` on `:4300`. Later ALB `/admin` or `admin.` (OQ-8) |
| **M0-Q2** | API framework inside `apps/api`? | **Shipped:** Hono. Keep it. |
| **M0-Q3** | Ship P7 (ECS preview) before AWS account exists? | **Shipped:** Dockerfile + Image workflow; ECR push skips without secrets |

None changes the master cuts.

---

## 10. Next

M0 is complete. M1 plan is accepted — implement [`m1-accounts.md`](./m1-accounts.md). Do not write M2–M5 plans yet (master §6). Optional hygiene: add required status checks `gates 1–8` and `build and smoke` on `main` (exit residual in §6).
