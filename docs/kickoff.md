# Project Kickoff: Shearly — On-Demand Home Beauty Services Platform

**Purpose of this document:** This is the handoff brief for Claude Code. It defines the idea, constraints, and decisions already made, and lays out a 4-phase documentation process that must be completed — in order, with my review and approval at each gate — before any implementation code is written. Do not skip ahead to scaffolding or coding until Phase 4 is approved.

---

## 0. Working Method

- I am a solo founder. You (Claude Code) are my only engineering team. Documents should be written for a single-developer-plus-AI-agent workflow, not a multi-person org.
- Work happens in a GitHub repo. Every unit of work — including documentation — is a branch + PR with a description, reviewed (by me) and merged. Treat each of the 4 phases below as one or more PRs.
- Ask clarifying questions before writing a document if a decision below is ambiguous or missing. Do not silently assume.
- Each phase ends with a concrete deliverable file in `/docs`. I will review and explicitly approve before you proceed to the next phase.
- Keep documents concrete and decision-oriented, not generic boilerplate. Where you must make a judgment call, state the assumption explicitly so I can correct it.

---

## 1. The Idea

**Product name:** Shearly

**Concept:** An on-demand marketplace for home beauty services. Customers book a vetted professional who comes to their home, hotel, or office; professionals get a steady stream of clients without needing to rent a salon/chair. The name captures the core insight: barbers don't need a chair, the same way Uber drivers don't need a taxi stand.

The product is not tied to a specific country or market. Launch market selection is a go-to-market question, not a product-architecture one — the platform must be built so that adding a market is configuration (locale, currency, payout region), not a rewrite.

**MVP vertical:** Barbers / hairstylists only. (Other beauty verticals — nails, makeup — are explicitly future phases, not MVP scope.)

**Core MVP user flows:**
1. Customer opens the web app, sees available barbers/stylists nearby, compares profiles/ratings/prices, books a specific time slot, and pays in-app.
2. Provider (barber/stylist) manages their availability, receives and accepts/declines bookings, and gets paid out.
3. Platform takes a commission on each transaction (Uber-for-X model).

**Explicit submission bar (from the original brief this idea came from):** a working web app — you can open it, see providers, and book one to come to your home — that works smoothly and looks clean, clear, and polished. This is the bar for "MVP done," not a full production business.

---

## 2. Decisions Already Made (do not re-litigate these without flagging why)

| Area | Decision |
|---|---|
| MVP vertical | Barbers/hairstylists only |
| Market | Not country-specific. No single launch market is assumed; market-specific concerns (locale, currency, payout region, regulatory) must be configuration, not hardcoded assumptions. |
| Locale | Multi-locale from day one using i18next (or equivalent). At least two locales in MVP, at least one of them RTL. RTL is a first-class citizen, not an afterthought. Which specific languages ship in MVP is a Phase 1/2 decision, not fixed here. |
| Team | Solo founder + Claude Code. No multi-person org assumptions. |
| Payments | Real payment processing in MVP scope (e.g. Stripe). Not a phase-2 deferral. |
| Agentic AI | Not yet scoped. The Vision doc (Phase 1) must propose 2–3 concrete candidate uses of agentic AI in this product (e.g. AI-assisted provider matching, a conversational booking assistant, agentic ops for scheduling/pricing) with a recommendation on which fits MVP vs. later. |
| RAG | Explicitly OUT of MVP scope. May appear in a post-MVP phase (e.g. provider knowledge base or support assistant) — note as future scope only, do not design for MVP. |
| Repo/process | GitHub repo, branch + PR per unit of work (including docs), PR descriptions required, merge after review. |
| CI/CD | Required: pipeline includes automated testing and code quality metrics (lint, coverage, etc.), targeting deployment to AWS. |
| Monorepo | Nx monorepo, microservices-oriented architecture. This is a fixed constraint for the Preliminary Design doc — not open for alternative proposals (e.g. don't propose a monolith instead). |
| Frontend bar | "Modern GUI" — this is a design/UX requirement, not just functional completeness. Preliminary design doc should name a specific design system/component approach. |

---

## 3. The 4-Phase Documentation Process

Produce these as four separate markdown files under `/docs`, in this order. Each is its own PR.

### Phase 1 — Vision Document (`docs/01-vision.md`)
- Problem statement and target users (customer side + provider side)
- Value proposition, and why now
- Market context (brief — this is a vision doc, not a market research report). Include a recommendation on which market(s)/locales the MVP demo should present, with reasoning — this is an open decision, not a given.
- Product principles (e.g. what "modern, clean, trustworthy" means for this product)
- Candidate agentic AI use cases (2–3, with a recommendation on MVP fit — see table above)
- Explicit non-goals for MVP (verticals not covered, RAG, features intentionally deferred)
- High-level success criteria for MVP (what does "the demo works" mean concretely)

### Phase 2 — Requirements Document (`docs/02-requirements.md`)
- Epic/story structure (Epics → User Stories, each with acceptance criteria)
- Cover the full lifecycle, not just "happy path" features: onboarding (customer + provider), discovery/search, booking, payment, provider availability management, ratings/reviews, notifications, cancellations, admin/ops needs, and basic trust & safety (provider vetting status, dispute basics)
- Explicitly tag each story as MVP or Post-MVP
- Non-functional requirements: performance, security/privacy (payment data, PII), accessibility, i18n/RTL, observability
- Traceability: each story should be identifiable enough to reference later from design and implementation docs (e.g. story IDs)

### Phase 3 — Preliminary Design Document (`docs/03-design.md`)
- System architecture: microservices breakdown (what are the services — e.g. identity, provider-catalog, booking, payments, notifications — and why split there)
- Nx monorepo structure: apps/libs layout
- Frontend architecture: framework choice, component/design system approach, state management, i18next integration and RTL strategy
- Backend architecture: API style (REST/GraphQL/etc.), inter-service communication, data storage per service
- Where the Phase 1 agentic AI feature(s) fit architecturally, if selected for MVP
- Dev environment: local dev setup, how services run together locally, environment/config management
- CI/CD pipeline design: stages, testing strategy (unit/integration/e2e), quality gates (lint, coverage thresholds, etc.), AWS deployment target (e.g. ECS/EKS/Amplify — propose and justify)
- Security & payments: how Stripe (or chosen provider) integrates safely, secrets management basics

### Phase 4 — Implementation Plan Document (`docs/04-implementation-plan.md`)
- MVP scope defined as a concrete slice of the Phase 2 stories (which epics/stories are in vs. out)
- Build sequencing/milestones for MVP (what gets built in what order, and why — e.g. skeleton monorepo + CI first, then core booking flow, then payments, then polish)
- Repo/branching workflow specifics (branch naming, PR template expectations, merge criteria tied to the CI/CD gates from Phase 3)
- Roadmap beyond MVP: next verticals, RAG introduction point, other agentic features deferred from Phase 1
- Definition of Done for MVP, matching the submission bar in Section 1

---

## 4. Phase Gate Instructions for Claude Code

- Do not proceed to Phase 2 until I approve Phase 1, and so on for each subsequent phase.
- At the end of each phase, summarize the key decisions/assumptions you made and flag anything you're uncertain about.
- If something in an earlier-approved doc needs to change because of a later-phase discovery, flag it explicitly rather than silently editing the earlier doc.
- Once Phase 4 is approved, stop and wait for explicit go-ahead before starting any repo scaffolding or implementation work — that is a separate kickoff.