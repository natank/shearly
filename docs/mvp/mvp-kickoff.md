# Shearly MVP Kickoff

**Status:** Kickoff — pre-documentation. No implementation code until Phase 4 is approved.
**Owner:** Solo founder. **Engineering:** Claude Code.
**Source:** Derived from `docs/kickoff.md`.

---

## 1. What We're Building

**Shearly** — an on-demand marketplace for home beauty services. Customers book a vetted professional who travels to their home, hotel, or office. Professionals get a steady stream of clients without renting a chair. The name captures the insight: barbers don't need a chair, the same way Uber drivers don't need a taxi stand.

The product is not tied to a specific country or market. Launch market is a go-to-market decision and remains open — Phase 1 recommends it. What is fixed is that market-specific concerns (locale, currency, payout region) are configuration, not baked-in assumptions.

**MVP vertical:** Barbers / hairstylists only.

**MVP done means:** a working web app you can open, browse providers, book one to come to your home, and pay — that works smoothly and looks clean, clear, and polished. This is a demo-quality bar, not a full production business.

---

## 2. MVP Scope

### In scope

| Flow | Description |
|---|---|
| Customer booking | Open web app → see nearby barbers/stylists → compare profiles, ratings, prices → book a specific time slot → pay in-app |
| Provider management | Manage availability, receive and accept/decline bookings, get paid out |
| Platform monetization | Commission on each transaction (Uber-for-X model) |

Supporting surfaces that must be covered in requirements (Phase 2), not just the happy path: customer and provider onboarding, discovery/search, payment, availability management, ratings/reviews, notifications, cancellations, admin/ops needs, and basic trust & safety (provider vetting status, dispute basics).

### Explicitly out of scope

- Other beauty verticals (nails, makeup) — future phases.
- RAG — out of MVP entirely. May return post-MVP (provider knowledge base, support assistant). Do not design MVP around it.
- Anything beyond the submission bar in Section 1.

---

## 3. Fixed Decisions

These are settled. Flag with a reason if you believe one must change — do not silently re-litigate.

| Area | Decision |
|---|---|
| MVP vertical | Barbers/hairstylists only |
| Market | Not country-specific. No launch market assumed; locale, currency, payout region, and regulatory concerns must be configuration, not hardcoded |
| Locale | Multi-locale from day one via i18next (or equivalent). At least two locales in MVP, at least one RTL. RTL is first-class, not an afterthought. Specific languages are a Phase 1/2 decision, not fixed here |
| Team | Solo founder + Claude Code; no multi-person org assumptions |
| Payments | Real payment processing in MVP (e.g. Stripe). Not deferred |
| Agentic AI | Not yet scoped. Phase 1 must propose 2–3 concrete candidates (e.g. AI-assisted provider matching, conversational booking assistant, agentic ops for scheduling/pricing) with an MVP-vs-later recommendation |
| RAG | Out of MVP scope; note as future only |
| Repo/process | GitHub repo; branch + PR per unit of work including docs; PR descriptions required; merge after review |
| CI/CD | Required: automated testing + code quality metrics (lint, coverage), targeting AWS deployment |
| Architecture | Nx monorepo, microservices-oriented. Fixed — do not propose a monolith alternative |
| Frontend bar | "Modern GUI" as a design/UX requirement. Design doc must name a specific design system/component approach |

---

## 4. Working Method

- Written for a single-developer-plus-AI-agent workflow.
- Every unit of work — documentation included — is a branch + PR with a description, reviewed by the founder and merged. Each phase below is one or more PRs.
- Ask clarifying questions before writing a document when a decision is ambiguous or missing. Do not silently assume.
- Each phase ends with a concrete deliverable file in `/docs`, reviewed and explicitly approved before the next phase starts.
- Documents are concrete and decision-oriented, not generic boilerplate. Where a judgment call is required, state the assumption explicitly so it can be corrected.

---

## 5. Documentation Phases

Four markdown files under `/docs`, produced in order, each its own PR.

### Phase 1 — Vision (`docs/01-vision.md`)
Problem statement and target users (customer + provider sides); value proposition and why now; brief market context including a reasoned recommendation on which market(s) and locales the MVP demo should present — an open decision, not a given; product principles (what "modern, clean, trustworthy" means here); 2–3 candidate agentic AI use cases with an MVP-fit recommendation; explicit MVP non-goals; high-level success criteria for "the demo works."

### Phase 2 — Requirements (`docs/02-requirements.md`)
Epics → user stories with acceptance criteria, covering the full lifecycle listed in Section 2. Each story tagged MVP or Post-MVP. Non-functional requirements: performance, security/privacy (payment data, PII), accessibility, i18n/RTL, observability. Story IDs for traceability from design and implementation docs.

### Phase 3 — Preliminary Design (`docs/03-design.md`)
Microservices breakdown and the reasoning behind the split (e.g. identity, provider-catalog, booking, payments, notifications); Nx apps/libs layout; frontend architecture (framework, design system, state management, i18next + RTL strategy); backend architecture (API style, inter-service communication, per-service data storage); where any MVP-selected agentic AI feature fits; local dev environment and config management; CI/CD pipeline design with stages, testing strategy (unit/integration/e2e), quality gates, and a justified AWS deployment target; Stripe integration safety and secrets management.

### Phase 4 — Implementation Plan (`docs/04-implementation-plan.md`)
MVP scope as a concrete slice of Phase 2 stories (in vs. out); build sequencing and milestones with rationale (e.g. skeleton monorepo + CI first, then core booking flow, then payments, then polish); branching workflow, PR template expectations, and merge criteria tied to the Phase 3 CI/CD gates; post-MVP roadmap (next verticals, RAG entry point, deferred agentic features); Definition of Done matching the submission bar.

---

## 6. Phase Gates

- Do not proceed to Phase 2 until Phase 1 is approved, and so on for each subsequent phase.
- At the end of each phase, summarize key decisions and assumptions, and flag anything uncertain.
- If a later-phase discovery invalidates something in an earlier approved doc, flag it explicitly rather than silently editing that doc.
- Once Phase 4 is approved, stop. Repo scaffolding and implementation begin only on explicit go-ahead — that is a separate kickoff.

---

## 7. Immediate Next Step

Open a branch for Phase 1, raise any clarifying questions about the vision scope, then draft `docs/01-vision.md` and submit it as a PR for review.
