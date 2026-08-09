# Shearly — Vision Document

**Phase:** 1 of 4 (Vision)
**Status:** Draft, pending founder review
**Source:** `docs/kickoff.md`, `docs/mvp/mvp-kickoff.md`

---

## 1. Problem Statement

Home beauty services today are coordinated over WhatsApp, Instagram DMs, and phone calls. That works, which is exactly why it persists — and it's also why it doesn't scale for either side of the transaction.

### Customer side

A customer who wants a haircut at home faces a discovery problem with no good solution:

- **No trustworthy discovery.** Finding a mobile barber means asking friends or scrolling Instagram. There is no way to compare several professionals on price, availability, and verified quality in one place.
- **No real-time availability.** Booking is a negotiation: message, wait, propose times, wait again. A booking that should take 40 seconds takes half a day.
- **No trust signal.** You are inviting a stranger into your home. Instagram follower counts are not vetting, and a portfolio of photos says nothing about reliability, punctuality, or safety.
- **Awkward payment.** Cash or a payment app, settled in person, with no receipt, no refund path, and no recourse if the service isn't as described.

The customers who feel this most acutely are the ones for whom *travel to a salon* is the binding constraint: parents with young children, people with limited mobility, professionals whose schedules don't fit salon hours, hotel guests and business travelers, and anyone preparing for an event at home.

### Provider side

For an independent barber or stylist, the economics of a chair are brutal:

- **Chair rent is a fixed cost against variable income.** A salon chair costs money whether or not anyone sits in it. New and part-time professionals are priced out entirely.
- **Client acquisition is unpaid labor.** Time spent building an Instagram following, answering DMs, and chasing no-shows is time not spent cutting hair — and it is not billable.
- **Scheduling is manual and lossy.** Double-bookings, forgotten appointments, and no-shows come directly out of income. There is no calendar that both sides can see.
- **Income is unpredictable.** Without a steady inbound stream, a good week and a bad week differ by a factor of three.

The insight the product name encodes: **barbers don't need a chair, the same way Uber drivers don't need a taxi stand.** The chair is not the value — the skill is. The chair is overhead that the market has mistaken for a prerequisite.

---

## 2. Target Users

### Primary: the at-home customer

| Segment | Why they book | What they need most |
|---|---|---|
| Parents of young children | Leaving the house for a haircut is a logistics operation | Reliable time slots, trust/vetting |
| Time-constrained professionals | Salon hours conflict with work | Evening/early availability, fast booking |
| Limited-mobility customers | Travel is difficult or impossible | Provider vetting, clear accessibility info |
| Event preparation | Wedding, holiday, photoshoot at home | Availability at specific dates, portfolio quality |
| Hotel guests / travelers | Unfamiliar city, no local salon relationship | Discovery, English-language support, card payment |

### Primary: the mobile provider

| Segment | Why they join | What they need most |
|---|---|---|
| Independent barbers without a chair | Avoid rent; start earning immediately | Inbound bookings, reliable payout |
| Salon employees moonlighting | Fill evenings/weekends with owned clients | Availability control, no exclusivity |
| Returning professionals | Rebuilding a client base after a career break | Discovery, ratings that compound |
| Part-time / student stylists | Flexible income around other commitments | Low fixed cost, granular availability |

### Secondary: platform operations

A small ops function (initially: the founder) that vets providers, resolves disputes, and monitors the health of the marketplace. Not a user segment to sell to, but a real set of surfaces the product must have.

---

## 3. Value Proposition

**For customers:** Book a vetted professional to your door in under a minute, with a real price, a real time slot, and card payment — instead of a WhatsApp negotiation with someone a friend recommended.

**For providers:** A stream of paying clients without renting a chair, with the scheduling and payment handled, so the only unbilled work is travel.

**For the platform:** A commission on each completed transaction. The platform earns when both sides transact, which aligns it with liquidity and completion rather than with listings or subscriptions.

### Why now

- **Behavioral precedent is established.** A decade of Uber, Airbnb, and food delivery has made "a vetted stranger comes to my home at a scheduled time, paid by card in-app" an ordinary transaction rather than a leap of faith. This was the hard part, and it is already done.
- **The pandemic normalized at-home services.** At-home beauty went from a luxury niche to a demonstrated mainstream preference, and the habit persisted afterward.
- **Independent professional supply is at a high.** The broader shift toward independent and flexible work means more skilled professionals are looking for client flow without fixed overhead.
- **The infrastructure is commodity.** Payments, identity verification, mapping, and notifications are all API calls now. A two-sided marketplace that would have taken a team two years is a tractable solo build.
- **Incumbents are geographically narrow.** Glamsquad and its peers demonstrated the model works but concentrated on a handful of large Western metros, leaving most urban markets served only by WhatsApp.

---

## 4. Market Context

*Brief by intent — this is a vision document, not market research.*

The at-home beauty category has a proven reference model (Glamsquad, Priv, and regional equivalents) that validated three things: customers will pay a premium for at-home service, professionals will accept commission in exchange for client flow, and the unit economics work when travel time is bounded by urban density. The category's known failure mode is equally clear — expanding beyond dense urban cores destroys margin, because travel time is unbillable and does not compress.

The competitive landscape splits into three groups. **Direct at-home marketplaces** are the reference model, and are geographically concentrated. **Salon booking platforms** (Booksy, Fresha, and similar) own the discovery and scheduling relationship but assume the customer travels to a fixed location; they are adjacent, well-capitalized, and the most plausible source of eventual competition. **Informal channels** — WhatsApp, Instagram, word of mouth — are the actual incumbent and hold the overwhelming majority of at-home transactions today. Shearly's real competition is not another app; it is a barber's existing WhatsApp thread.

That framing sets the bar. Beating WhatsApp requires being faster to book than sending a message, and it requires giving the provider something WhatsApp cannot: inbound clients they did not already have.

### Recommended launch market: Israel — Hebrew + English

Per the kickoff, this is an open decision and Phase 1 owes a recommendation. **Recommend Israel, with Hebrew and English as the two MVP locales.**

Reasoning:

- **RTL is a first-class requirement, and this makes it real.** The kickoff fixes at least one RTL locale in MVP. Hebrew forces genuine RTL correctness — layout mirroring, bidirectional text, date and currency formatting — rather than a checkbox. Building RTL against a real primary market is substantially harder to get wrong than building it against a hypothetical one.
- **Density fits the model's known constraint.** The Tel Aviv metropolitan area has the urban density that at-home services require for travel time to stay bounded. The category's failure mode is sprawl; this market does not have it in the launch corridor.
- **English is a genuine second locale, not a translation exercise.** A large English-speaking population plus substantial business and tourist traffic means the second locale serves real users — hotel guests and travelers are a named customer segment — rather than existing only to prove the i18n framework works.
- **Payment rails are standard.** Card penetration is high and Stripe operates in-market, so real payment processing in MVP is not blocked on local rails.
- **Founder proximity.** Provider vetting in MVP is manual and high-touch. Recruiting and vetting the first cohort is materially easier in a market the founder can reach directly.

**This recommendation is reversible and does not bind the architecture.** Market-specific concerns — locale, currency, payout region, regulatory — remain configuration per the kickoff's fixed decisions. Choosing Israel selects the first market and the RTL locale; it does not make the product Israel-specific. Any market with an RTL language and a dense urban core would satisfy the same constraints; the UAE (Arabic/English) is the closest alternative if the founder-proximity argument does not hold.

---

## 5. Product Principles

What "modern, clean, trustworthy" means concretely for this product. These are the tie-breakers when a design or scope decision is otherwise balanced.

### 1. Booking is the product. Everything else is in service of it.
A customer should get from opening the app to a confirmed booking in under a minute, without an account wall in front of browsing. Any feature that adds a step to that path must justify itself against the WhatsApp baseline. When in doubt, remove a step.

### 2. Trust is designed, not claimed.
"Vetted" is a badge with a defined meaning behind it, surfaced everywhere a provider appears — not marketing copy on a landing page. Ratings, verification status, cancellation history, and clear pricing are trust infrastructure. A customer is inviting a stranger home; the interface carries the weight of that.

### 3. Both sides are first-class.
The provider's experience is a product, not an admin panel. Availability management, booking response, and payout visibility get the same design attention as customer booking. A marketplace with a neglected supply side has no supply.

### 4. RTL and LTR are equals.
Hebrew is not a translation layer over an English product. Layout, typography, iconography, and date/currency formatting are correct in both directions from the first commit. Retrofitted RTL is visibly retrofitted, and this market would see it immediately.

### 5. Prices are honest and complete.
The price shown at browse time is the price charged, including travel and platform fee. No surprise line items at checkout. Surprise pricing is the fastest way to lose a two-sided marketplace's trust in both directions at once.

### 6. Polish is a requirement, not a phase.
The submission bar is explicitly "clean, clear, and polished," not "functionally complete." A working flow that looks unfinished does not clear the bar. Polish is scoped in, not deferred to a cleanup milestone that never comes.

### 7. Fewer features, finished.
Solo founder plus AI agent. A narrow product that works end to end beats a broad one with rough edges everywhere. Scope cuts are the default response to schedule pressure — quality is not the variable.

---

## 6. Candidate Agentic AI Use Cases

The kickoff requires 2–3 concrete candidates with an MVP-fit recommendation. RAG is explicitly out of MVP scope and is not proposed here.

### Candidate A — Conversational booking assistant

**What it does.** A chat entry point where the customer states intent in natural language ("I need a fade tomorrow evening, somewhere near me, under ₪150") and the assistant resolves it to a filtered set of real availability, then completes the booking through tool calls against the booking service.

**Why it fits the product.** It is the most direct attack on the WhatsApp baseline — it beats messaging a barber at messaging's own game, because it answers instantly and can actually complete the transaction.

**Cost.** Requires the booking, catalog, and availability services to be stable and tool-callable first. It is a layer over a working booking flow, and it is only as good as the flow underneath it.

**Risk.** A conversational path that fails in front of a reviewer is worse than no conversational path. It also competes for attention with the polish bar on the primary UI.

**Recommendation: Post-MVP, first agentic feature after launch.** High strategic value, but it presupposes exactly the services MVP is building. Building it concurrently risks both.

### Candidate B — AI-assisted provider matching and ranking

**What it does.** Ranks providers for a given customer and request using structured signals — travel time, availability fit, service-type match, rating, price band, historical completion and punctuality — rather than a fixed sort. The agentic element is a scoring policy that adapts to observed outcomes.

**Why it fits the product.** Discovery quality is the core marketplace problem, and ranking is where a marketplace's intelligence actually lives. It improves the primary flow rather than adding a parallel one.

**Cost.** Genuinely useful ranking requires outcome data — completions, cancellations, repeat bookings — that a pre-launch marketplace does not have. At launch, a heuristic sort over travel time, availability, and rating is nearly as good and far more predictable.

**Risk.** Low. It degrades gracefully to a deterministic sort, and it is invisible when it fails.

**Recommendation: Heuristic ranking in MVP, agentic ranking in Phase 2.** Build the ranking seam in MVP with a deterministic implementation behind it, so the agentic version is a substitution rather than a rewrite. This is the cheapest architectural hedge available.

### Candidate C — Agentic ops for scheduling exceptions

**What it does.** Handles the failure modes that make marketplaces expensive to run: provider cancels three hours out, customer no-show, provider running late, gap-filling in a partially booked day. The agent proposes and executes remediation — rebook with a comparable provider, offer the slot to a waitlist, notify and re-price — inside defined authority limits.

**Why it fits the product.** These exceptions are the real operational cost of a marketplace and they land entirely on the founder. It is the highest-leverage automation for a solo operator.

**Cost.** Requires notification, booking-modification, and refund infrastructure to be reliable and reversible first. Authority limits and audit trails are a prerequisite, not a follow-up.

**Risk.** Highest of the three. An agent with authority over bookings and refunds can cause real customer and financial harm. Requires an audit trail and a human-approval boundary from the start.

**Recommendation: Phase 3, and only behind explicit authority limits.** Real value, but it acts on money and commitments. It should follow a period of manual operation that reveals what the actual exception patterns are — automating an unmeasured process automates guesses.

### Summary

| Candidate | MVP fit | Recommendation |
|---|---|---|
| A — Conversational booking assistant | No | Phase 2 — first agentic feature post-launch |
| B — AI-assisted matching/ranking | Seam only | **Heuristic in MVP; agentic in Phase 2** |
| C — Agentic ops for scheduling exceptions | No | Phase 3, behind authority limits and audit trail |

**Net position for MVP:** no agentic AI ships in MVP. MVP builds one architectural seam — a pluggable ranking interface — so Candidate B is a substitution rather than a rewrite. This is a deliberate call: the submission bar rewards a polished booking flow, and an agentic feature layered over an unstable flow endangers both. Flagging this explicitly as the assumption most worth challenging, since the kickoff leaves agentic scope open.

---

## 7. MVP Scope

### In scope

The complete transaction loop, both sides, with real money moving.

**Customer:** browse providers without an account wall; view profile, services, price, ratings, vetting status; see real availability; book a specific slot at a specific address; pay by card in-app; receive confirmation; view and cancel upcoming bookings; rate a completed booking.

**Provider:** onboard and submit vetting information; manage a service menu with prices; set and edit availability; receive booking requests and accept or decline; view an upcoming schedule; see earnings and payout status.

**Platform:** commission on each completed transaction; manual provider vetting and approval; basic dispute and refund handling; observability into the booking funnel.

**Cross-cutting:** two locales (Hebrew, English) with correct RTL; responsive web across mobile and desktop; transactional notifications for booking lifecycle events; secure handling of payment data and PII; the polish bar treated as a requirement.

### Out of scope for MVP

| Excluded | Rationale |
|---|---|
| Nails, makeup, other verticals | Fixed decision — barbers/hairstylists only |
| RAG in any form | Fixed decision — explicitly out; revisit Phase 3 |
| Agentic AI features | See §6 — seam only, no shipped agentic feature |
| Native mobile apps | Responsive web clears the submission bar |
| Real-time provider tracking | Uber-style live tracking is high cost, low MVP value |
| In-app customer/provider chat | Notification-based coordination suffices; chat is a moderation and support burden |
| Subscriptions, packages, loyalty | Single-transaction commission only |
| Multi-provider group bookings | Meaningful scheduling complexity for a narrow case |
| Provider-side analytics dashboards | Earnings visibility yes; analytics no |
| Automated background checks | Manual vetting at MVP volume; automate when volume demands |
| Multi-market / multi-currency | One market, one currency; architecture stays configurable |

### MVP success criteria

The submission bar is "you can open it, see providers, and book one to come to your home — smoothly and polished." Concretely:

1. **The demo completes.** A reviewer, with no prior context, opens the app and completes a booking with a card payment without assistance or explanation.
2. **Both sides are real.** The provider receives the booking, accepts it, and sees the earning. The loop closes in the product, not in a slide.
3. **Money actually moves.** A real payment is processed and a commission split is recorded. Not a mocked checkout.
4. **Hebrew is not degraded.** The full booking flow in Hebrew/RTL is visually and functionally equal to English. A Hebrew-first reviewer sees a finished product.
5. **It looks finished.** Consistent design system, no placeholder assets, no broken states, responsive on a phone.
6. **It holds under inspection.** Cancellation, a declined booking, and an unavailable slot behave correctly — the reviewer who pokes at edges does not find rough ones.
7. **CI gates are green.** Automated tests, lint, and coverage thresholds pass on the deployed commit, per the fixed CI/CD decision.

---

## 8. Phase Breakdown

Phases are sequenced by dependency and scoped by goal, not dated. Each has an entry condition — the state that must hold before it starts.

### MVP — Prove the loop

**Goal.** A polished, working, single-market transaction loop that clears the submission bar.

**Scope.** As specified in §7.

**Entry condition.** Phases 2–4 of the documentation process approved; scaffolding kickoff given.

**Exit criteria.** All seven MVP success criteria met.

**Deliberate debt.** Manual vetting, manual dispute handling, heuristic ranking, single market, no agentic features. All are known and priced in.

---

### Phase 2 — Make it intelligent and defensible

**Goal.** Move from a working marketplace to a differentiated one. This is where the AI thesis becomes real.

**Scope.**
- **Conversational booking assistant** (Candidate A) — the flagship post-MVP feature, replacing the WhatsApp interaction rather than merely competing with it.
- **Agentic matching and ranking** (Candidate B) — substituted into the MVP ranking seam, now with real outcome data behind it.
- Provider-side improvements: earnings analytics, availability templates, repeat-client tooling.
- Customer retention: rebooking a previous provider in one step, favorites, booking history as a first-class surface.
- Review depth: structured review dimensions rather than a single star rating.

**Entry condition.** MVP live with enough completed bookings that ranking has signal and the conversational assistant has a stable booking API to call.

**Exit criteria.** A measurable share of bookings originate from the conversational path; ranking demonstrably outperforms the heuristic baseline on completion rate.

---

### Phase 3 — Broaden the catalog and automate operations

**Goal.** Grow transaction volume per customer, and stop operations from scaling linearly with bookings.

**Scope.**
- **Additional verticals** — nails and makeup, the explicitly deferred verticals from the kickoff. This is a catalog and taxonomy change plus vertical-specific vetting, not a new product.
- **Agentic ops** (Candidate C) — cancellation recovery, gap-filling, no-show handling, behind defined authority limits and a full audit trail.
- **RAG introduction point.** The kickoff names this as a post-MVP possibility, and this is the phase where it earns its place: a provider knowledge base and a customer support assistant grounded in real policy, booking history, and provider documentation. Nothing before this phase should be designed around it.
- Automated vetting: background-check integration, credential verification, replacing manual review as volume demands.
- Trust and safety maturity: structured dispute workflow, provider standing, refund policy automation.

**Entry condition.** Booking volume high enough that manual ops is the binding constraint; barber vertical demonstrably healthy before a second is added.

**Exit criteria.** Ops cost per booking declining; second vertical reaching the completion and rating quality of the first.

---

### Phase 4 — Scale beyond one market

**Goal.** Exercise the configurability the architecture has carried since MVP.

**Scope.**
- **Second market launch** — new locale, currency, payout region, and regulatory profile, added as configuration. This phase is the test of whether the "market is configuration" decision held.
- Multi-currency pricing and payouts; region-specific payment methods.
- Additional locales beyond Hebrew and English.
- Market-level operational tooling: per-market supply health, pricing, and commission control.
- Native mobile applications, if web engagement data justifies the cost.
- Infrastructure maturity: regional deployment, per-market observability, scaled cost controls.

**Entry condition.** First market at healthy liquidity — supply and demand both sustaining without founder intervention.

**Exit criteria.** Second market operating without market-specific code forks.

### Phase summary

| Phase | Goal | Key additions | Gated on |
|---|---|---|---|
| **MVP** | Prove the loop | Booking, payments, both sides, 2 locales | Docs Phase 4 approved |
| **Phase 2** | Intelligent & defensible | Conversational booking, agentic ranking | MVP live with outcome data |
| **Phase 3** | Broaden & automate | New verticals, agentic ops, RAG, auto-vetting | Manual ops is the constraint |
| **Phase 4** | Scale beyond one market | Second market, multi-currency, native apps | First market liquid |

---

## 9. Assumptions and Open Questions

Per the kickoff's requirement to state judgment calls explicitly.

### Assumptions made in this document

1. **No agentic AI ships in MVP** (§6). The strongest call here, and the one most worth challenging — the kickoff left agentic scope open rather than excluding it. Rationale: the submission bar rewards a polished booking flow, and every agentic candidate depends on services MVP is still building. MVP builds the ranking seam so Phase 2 is substitution, not rewrite.
2. **Israel / Hebrew + English as launch market** (§4). Recommended, not fixed. Reversible without architectural consequence.
3. **Browsing does not require an account.** Treated as a principle (§5.1) because an account wall in front of discovery is the most common way marketplaces lose first-time customers.
4. **Commission is the only MVP revenue mechanism.** No subscriptions, listing fees, or promoted placement.
5. **Manual vetting is acceptable at MVP volume.** Trust is a principle, but automation of it is Phase 3.
6. **Responsive web only.** Native apps deferred to Phase 4, contingent on data.
7. **Five commercial and policy defaults are set below** (D-1 through D-5), covering commission, travel, cancellation, vetting, and radius. The kickoff specified none of them; they are resolved here so Phase 2 is not blocked, and each carries its reasoning and a revisit trigger.

### Working defaults (founder to override)

The kickoff does not specify these, and each blocks specific Phase 2 stories. Rather than leave Phase 2 waiting, each is resolved below with a defensible default and its reasoning. **These are bets, not settled policy** — every one is a founder decision, and overriding any of them changes requirements but not architecture.

#### D-1. Commission: 20% of service price, taken from the provider

The platform charges the provider 20% of the service price on each completed booking. The customer sees one price; the provider sees the gross, the fee, and the net.

*Reasoning.* Twenty percent sits at the established midpoint for at-home service marketplaces — enough to fund payment processing, acquisition, and ops, low enough that it beats chair rent for the target provider. That comparison is the pitch: chair rent is a fixed weekly cost paid whether or not anyone sits down, while commission is charged only on money actually earned. A provider doing light volume is strictly better off; a provider at high volume is trading margin for zero downside risk and zero acquisition work.

Charging the provider rather than the customer keeps the customer-facing price clean, which the honest-pricing principle (§5.5) requires.

*Revisit when:* provider acquisition stalls at onboarding, or provider churn concentrates among high-volume providers — both signal the rate is wrong for the supply side.

#### D-2. Travel: included in the price, bounded by radius

No travel line item. The provider sets service prices that account for travel, and the platform enforces a service radius (D-5) so travel stays bounded and roughly uniform. The price shown at browse time is the price charged.

*Reasoning.* A distance-based travel fee is the honest-pricing principle's (§5.5) worst enemy — it makes browse-time prices provisional, and prices that change at checkout are the fastest way to lose trust in a marketplace. Bounding the radius makes travel cost roughly constant, which makes bundling it into the price accurate rather than a subsidy.

This pushes a real cost onto providers, which is why it only works with the radius cap. Without D-5, providers absorb unbounded travel and the arrangement collapses.

*Revisit when:* providers systematically decline distant bookings inside the radius — that is the signal the bundled price no longer covers travel at the edge.

#### D-3. Cancellation: free until 12 hours out, then charged

| Event | Customer outcome | Provider outcome |
|---|---|---|
| Customer cancels >12h before | Full refund | No earning, slot released |
| Customer cancels <12h before | 50% charged | 50% of normal earning |
| Customer no-show | Full price charged | Full earning |
| Provider cancels, any time | Full refund + rebooking assistance | Counted against provider standing |
| Provider no-show | Full refund | Counted against standing; repeat = removal |

*Reasoning.* Twelve hours is long enough for a provider to refill an evening slot and short enough that same-day booking — a core use case — is not discouraged. The asymmetry is deliberate: a customer cancellation costs the provider a slot, while a provider cancellation costs the customer a plan they had already built their day around, and it damages platform trust rather than one person's schedule. Provider-side failures are handled through standing rather than fees because charging a provider is a poor lever early on, when supply is the scarce side.

*Revisit when:* late cancellations exceed roughly one in ten bookings, or provider standing penalties are visibly driving supply away.

#### D-4. Vetting: identity, credential, portfolio, interview

Four requirements, all before a provider is listed:

1. **Government ID** — verified against the payout account name.
2. **Professional credential** — a barbering or hairdressing certification, or documented equivalent experience where local licensing does not apply.
3. **Portfolio** — a minimum of five work photos, reviewed for plausibility and quality.
4. **Video interview** — a short live call with the founder covering professionalism, home-service conduct, and expectations.

A listed provider displays a "Verified" badge with these criteria stated plainly. Insurance is recommended and surfaced on the profile when present, but is not a listing requirement at MVP.

*Reasoning.* §5.2 treats trust as designed rather than claimed, which requires "Verified" to mean something specific and legible. The interview is the highest-signal and least scalable component — appropriate precisely because MVP volume is low and the founder is doing this personally. It is also the step Phase 3 automation will most want to remove, so it should be doing real work now.

Insurance stays optional because requiring it would meaningfully thin the initial supply pool for a risk that is low at MVP volume.

*Revisit when:* vetting throughput becomes the constraint on supply growth — that is the Phase 3 automation trigger.

#### D-5. Service radius: 15 km, provider-configurable downward

Platform maximum of 15 km between provider base and customer address. Providers may set a smaller personal radius; none may exceed the platform cap. Customers outside every nearby provider's radius see an explicit "not yet in your area" state rather than an empty result list.

*Reasoning.* Fifteen kilometers covers the Tel Aviv metropolitan corridor — the density argument that motivated the market recommendation in §4 — while keeping travel to roughly 20–30 minutes each way in normal traffic. That is the boundary where D-2's bundled-travel pricing stays honest. Beyond it, travel time stops being an acceptable share of a two-hour billable block, and the category's known failure mode is exactly this: expansion into sprawl destroying margin because travel time does not compress.

Provider-configurable downward matters because a provider who only wants a 5 km radius is a better provider inside it.

*Revisit when:* a second market with different density launches (Phase 4) — this number is market-specific and belongs in market configuration, not in code.

### How these interact

D-2 and D-5 are a single decision in two parts: bundled travel pricing is only honest because the radius is capped, and the cap is only tolerable because providers aren't separately charged for travel. Changing either one requires revisiting the other.

D-1 and D-4 form the provider pitch together: a 20% commission is defensible in exchange for genuine vetting that makes the badge worth carrying. Weakening vetting weakens what the commission buys.

### Flagged for later phases

- The ranking seam (§6, Candidate B) is an architectural commitment made in Phase 1 that Phase 3 (Design) must honor explicitly.
- The "market is configuration" decision is untested until Phase 4 of the product roadmap. Phase 3 (Design) should avoid single-market shortcuts that would be expensive to unwind, without over-engineering for a market that may be years away.

---

## 10. Next Step

On approval, proceed to **Phase 2 — Requirements** (`docs/02-requirements.md`): epics and user stories with acceptance criteria and story IDs, covering the full lifecycle in §7, each tagged MVP or Post-MVP, plus non-functional requirements.

The five working defaults in §9 (D-1 through D-5) are resolved with stated reasoning and unblock Phase 2. They are bets rather than settled policy — each should be confirmed or overridden during Phase 2 review, where they turn into concrete acceptance criteria for pricing, cancellation, vetting, and discovery stories.
