# FNB Integration Channel — API Requirements Audit (Phase 17A)

Documentation-only audit. No implementation code was written or modified in this
phase. This document is the authoritative record of what is CONFIRMED from FNB's own
official documentation, what is NOT CONFIRMED, and what VYRON must obtain from FNB
before `src/server/bank-connectivity/providers/fnb/fnb-client.ts`'s placeholder
endpoints can be corrected and trusted in production.

## Method

- The one official FNB page that has ever been successfully retrieved (in Phase 16,
  and confirmed still authoritative here) is FNB's public API catalogue entry for the
  Transaction History API:
  `https://www.fnb.co.za/integration-channel/catalogue/serviceCatalogue-ZA/services.html?catalogue=serviceCatalogue-ZA&service=Transaction-History&type=API`
- This phase made **9 further attempts** to independently re-verify that page and
  reach 6 other official FNB pages relevant to the 20 topics in the brief (Real Time
  Notifications, Account Information, general Integration Channel index/catalogue,
  accounting-integrations index, a Business Talk article on accounting integrations,
  and `online.fnb.co.za/api/`). **Every single attempt this phase was blocked** by
  Radware bot-verification interstitials (a "Verifying your browser before
  proceeding..." challenge page, no real content served) — including the exact URL
  that succeeded in Phase 16, fetched again with an identical incident ID, suggesting
  the block is presently being served consistently for this access pattern. One
  attempted URL (`online.fnb.co.za/api/index.html`) returned a plain 404.
- No new CONFIRMED facts could be added beyond what Phase 16 already recorded. This
  document does not fabricate anything to compensate for that — every gap below is
  reported honestly as still open.
- A small number of secondary (non-FNB, unofficial) sources surfaced during search are
  noted separately, clearly labeled as **not authoritative**, per the brief's "use the
  official FNB Integration Channel documentation only" instruction.

---

## CONFIRMED (directly supported by official FNB documentation)

Everything below is sourced from the one successfully-retrieved official page
(Transaction History API catalogue entry) and matches `FINDINGS.md §14` verbatim —
repeated here as the single source of truth this new document exists to organize.

| # | Topic | Confirmed fact |
|---|---|---|
| 1 | Transaction History API — customer segments | "business, commercial, corporate and investment customers in South Africa" |
| 1 | Transaction History API — data returned | Transaction list: transaction ID, value date, booking date, transaction details, reference, amount, currency, debit/credit indicator, balances. Also: account balances for a specified date range on chosen accounts. |
| 4 | OAuth 2.0 | Authorization-code flow, OAuth 2.0 standard. Two documented connection models: **direct connection** (client to API) and **third-party connection** (with explicit consent management) — VYRON is a third-party connection. |
| 9 | API credentials | JWT-signed tokens, authenticated using a client ID + client secret **issued at subscription time**. |
| 12/13 | Token lifetime/refresh | Access tokens are obtained via an OAuth 2.0 token endpoint using either an authorization code or a refresh token; tokens "have a defined lifespan" and "support refresh." **No specific duration in seconds/minutes/hours is published.** |
| 15/16 | Pagination / historical limits | Accepted parameters are a selectable account identifier and **a required date range** — this is the documented mechanism for bounding a query. No separate cursor/pagination-token mechanism, and no maximum lookback window, is documented. |
| 18 | Data retrieval / "versioning" proxy | "Our APIs use polling method, which allows you to query the API at regular intervals to check for new data." Described against an OpenAPI Specification (OAS) standard — implying a machine-readable spec exists, but it is not published on this page. |
| 6/15 | Protocol | REST over HTTP, JSON payloads. |
| 19 | Production onboarding | Requires either existing Online Banking Enterprise™ user status, or completing platform registration — either self-service ("unassisted", via the Integration Channel) or "assisted" (via a Digital Profile Manager / Transactional Portfolio Manager / Implementation Manager). |

---

## NOT CONFIRMED (FNB's public documentation does not currently expose this)

| # | Topic | Status |
|---|---|---|
| 1/3 | Exact endpoint paths for accounts/balances/transactions | **Not published.** Only the OpenAPI Specification, issued at onboarding, would confirm these. |
| 4 | Exact authorization/token endpoint URLs | **Not published.** |
| 4/11 | OAuth scope names/strings | **Not published.** The catalogue page never names a scope. |
| 6 | Third-party connection consent flow specifics (screens, consent scope granularity, per-account vs. blanket consent) | **Not published** beyond the phrase "explicit consent management." |
| 7 | Sandbox / UAT / test environment | **Not mentioned anywhere on the retrieved page.** Per the Phase 16 brief's own instruction, VYRON does not assume one exists. |
| 8 | Real Time Notifications API — any technical detail | **Could not be retrieved at all**, in either Phase 16 or this phase — every attempt hit the same bot-verification interstitial. Its existence is only known because it is listed by name in the Integration Channel catalogue (per the user's own brief); its delivery mechanism, payload, auth model, and triggers remain completely unknown. |
| 10 | Redirect URI requirements (format constraints, HTTPS-only, wildcard support, how many can be registered) | **Not published.** |
| 12 | Exact access-token lifetime (a number) | **Not published** — only "has a defined lifespan" is stated. |
| 13 | Exact refresh-token lifetime/rotation behavior (single-use vs. reusable, expiry) | **Not published.** |
| 14 | Rate limits / throttling (requests per minute/hour/day) | **Not published.** |
| 15 | Formal pagination mechanism (page tokens, cursors, `Link` headers, max page size) | **Not published** — only "a defined account and date range" is confirmed as the query-bounding mechanism. |
| 16 | Maximum historical transaction lookback (e.g. "up to 12 months") | **Not published.** |
| 17 | Error response format/schema (error codes, HTTP status conventions beyond generic REST, machine-readable error bodies) | **Not published.** |
| 18 | API versioning scheme (URL versioning, header versioning, deprecation policy) | **Not published.** |
| 20 | Commercial/pricing terms (whether the API itself carries a fee, volume tiers, contractual minimums) | **Not published** on the catalogue page; the "assisted" onboarding path implies a relationship-manager-led commercial conversation exists, but no terms are stated. |
| 5/6 | General "Business Banking" / "Third-party integrations" landing pages | **Inaccessible this phase** — every attempt to reach the Integration Channel index, the general services catalogue index, the accounting-integrations index, and a Business Talk article was blocked by the same bot-verification interstitial. |

### Secondary, non-authoritative context (explicitly NOT used as a confirmed source)

A third-party integration vendor's own support documentation (Splynx, an ISP/billing
platform, describing their own experience integrating FNB) surfaced during search and
describes an onboarding sequence: log into FNB Online Banking → Business Solutions →
Integration Channel → "Get Started" → accept terms → "View My Service Tasks" → change
the integration type from Host-to-Host to API → subscribe to the Transaction History
API. This is **not** FNB's own documentation and is not treated as confirmed anywhere
in this document or in `FINDINGS.md` — it is noted here only as a plausible real-world
corroboration of the "self-service registration via the Integration Channel" path
already confirmed above, not as a source for any technical detail (endpoint, scope,
etc.).

Several **unofficial, reverse-engineered** GitHub projects (e.g. scraping FNB's
consumer online-banking session rather than using the official Integration Channel
API) also surfaced during search. These are explicitly **not consulted, not linked
from our code, and not a legitimate basis for implementation** — using them would mean
scraping FNB online banking and bypassing FNB's own authentication, both explicitly
prohibited in the Phase 16 brief and unchanged by this phase.

---

## REQUIRED FROM FNB (must be obtained before implementation can be trusted)

1. Real client ID and client secret (issued at subscription/onboarding).
2. The exact OAuth 2.0 authorization endpoint URL and token endpoint URL.
3. The exact Transaction History API base URL and every real endpoint path (accounts,
   balances, transactions) — ideally the full OpenAPI Specification the catalogue page
   references as existing.
4. Confirmation of the exact JSON field names in every request/response body (the
   current `fnb-types.ts` shapes are best-effort placeholders built only from the
   documented DATA FIELDS, not the real wire schema).
5. Redirect URI registration process and any format constraints.
6. Real OAuth scope name(s) required for account/balance/transaction access.
7. Exact access-token and refresh-token lifetimes, and refresh-token rotation
   behavior.
8. Documented rate limits.
9. Documented pagination mechanism (if any exists beyond the date-range parameter).
10. Documented maximum historical transaction lookback.
11. Documented error response schema.
12. Confirmation of whether a sandbox/UAT environment exists, and if so, how to
    request access to it.
13. Full technical documentation for the Real Time Notifications API (existence is
    confirmed only by name; everything else about it is unknown).
14. Commercial terms/pricing, if any apply beyond standard business banking fees.
15. Confirmation of which onboarding path applies to VYRON specifically (self-service
    "unassisted" registration vs. an assisted, relationship-manager-led path) — this
    likely depends on VYRON's own registration status with FNB, not something
    determinable from documentation alone.

---

## Endpoint-by-endpoint status of `fnb-client.ts` (as it exists today, unchanged)

No endpoint below was modified in this phase. Every base URL is already read from
required environment configuration (never hard-coded) — the table below marks whether
the URL *value itself* and the *path/parameter shape* built on top of it are confirmed.

| Function | URL / path used | Status |
|---|---|---|
| `buildAuthorizationUrl` | `config.authorizationBaseUrl` (from `FNB_AUTHORIZATION_URL`) + query params `response_type`, `client_id`, `redirect_uri`, `state` | **UNCONFIRMED / PLACEHOLDER.** The base URL value is onboarding-dependent (never hard-coded). The four query parameter *names* are standard OAuth 2.0 (RFC 6749) authorization-request parameters, matching FNB's confirmed "OAuth 2.0 standard, authorization code flow" — reasonable to expect they apply, but FNB has not published this exact endpoint or confirmed no additional required parameters (e.g. a scope parameter, which FNB has not confirmed the name of and which this URL does not currently send at all). |
| `exchangeCodeForToken` | `config.tokenUrl` (from `FNB_TOKEN_URL`), body: `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `client_secret` | **UNCONFIRMED / PLACEHOLDER.** Token URL value is onboarding-dependent. Body parameter names are the standard OAuth 2.0 authorization-code grant (RFC 6749 §4.1.3) — a reasonable default, not FNB-confirmed. |
| `refreshToken` | Same `config.tokenUrl`, body: `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret` | **UNCONFIRMED / PLACEHOLDER.** Same reasoning — standard OAuth 2.0 refresh grant (RFC 6749 §6), not FNB-confirmed. |
| `fetchAccounts` | `GET {apiBaseUrl}/accounts` | **UNCONFIRMED / PLACEHOLDER.** Neither the base URL nor the `/accounts` path segment is published anywhere by FNB. |
| `fetchAccountBalance` | `GET {apiBaseUrl}/accounts/{id}/balance` | **UNCONFIRMED / PLACEHOLDER.** Same — conventional REST shape guessed from the documented *capability* ("account balance details … on chosen accounts"), not a confirmed path. |
| `fetchTransactions` | `GET {apiBaseUrl}/accounts/{id}/transactions?from=&to=` | **UNCONFIRMED / PLACEHOLDER.** Path is guessed the same way. The `from`/`to` query parameter *names* are also unconfirmed — FNB confirms only that "a defined account and date range" is accepted, never the literal parameter names. |

**Zero endpoints in this file are CONFIRMED.** This matches the Phase 16 report's own
disclosure and is the reason `fnb-client.ts` has not been touched in this phase.

---

## FINDINGS.md cross-reference

`src/server/bank-connectivity/FINDINGS.md` §14/§15 already state, correctly, that
exact endpoints/scopes/URLs are unconfirmed and defer to onboarding. A short pointer
to this document has been added there (see that file's own diff) so a future reader
lands on the fuller, structured audit here rather than only the summary in §14/§15.
No other change was made to `FINDINGS.md`.

---

## Answers to the brief's 8 closing questions

1. **Exact confirmed FNB capabilities**: Transaction History API for business/
   commercial/corporate/investment SA customers; returns transaction lists (ID, value
   date, booking date, details, reference, amount, currency, debit/credit indicator,
   balance) and account balances for a date range; OAuth 2.0 authorization-code flow
   with JWT-signed tokens (client ID + secret issued at subscription); direct and
   third-party (consent-managed) connection models; polling-only retrieval; REST/JSON
   over an OpenAPI-specified contract; onboarding via self-service or assisted
   registration.
2. **Exact unknowns**: every real endpoint path, the real request/response JSON
   schema, OAuth scope names, exact token lifetimes and refresh behavior, rate limits,
   a formal pagination mechanism, maximum historical lookback, error response schema,
   API versioning scheme, sandbox availability, and everything about the Real Time
   Notifications API.
3. **Exact information needed from FNB**: see the 15-item "REQUIRED FROM FNB" list
   above — in short, the real OpenAPI Specification, real credentials, and answers to
   every "NOT CONFIRMED" row.
4. **Every guessed endpoint currently in our code**: all 5 — the authorization URL
   call, the token exchange/refresh call (same URL, two grant types), `GET /accounts`,
   `GET /accounts/{id}/balance`, `GET /accounts/{id}/transactions`. All 5 marked
   UNCONFIRMED / PLACEHOLDER above; none were changed this phase.
5. **Publicly documented sandbox**: **No.** Not mentioned anywhere in the one
   official page retrieved (in either phase), and every other official page that
   might confirm or deny one was inaccessible this phase.
6. **Publicly documented real-time notifications**: **No, not with any technical
   detail.** The Real Time Notifications API's existence is known only because it's
   named in the brief itself (matching the general Integration Channel catalogue
   structure); its own documentation page has never been successfully retrieved.
7. **Can we safely proceed to implementation without FNB onboarding?** **No.** Every
   endpoint FNB-facing code would call is an unconfirmed placeholder; shipping against
   these would mean calling invented URLs against a real bank's infrastructure, which
   Phase 16's own brief and this one both explicitly prohibit ("we will NOT proceed
   using guessed financial API endpoints").
8. **Recommended next step**: Initiate FNB's own onboarding process (the "unassisted"
   self-service path via Online Banking → Business Solutions → Integration Channel, or
   the "assisted" path via a Digital Profile Manager/Transactional Portfolio
   Manager/Implementation Manager, both already confirmed above) specifically to
   obtain the real OpenAPI Specification and real credentials. Until that happens, no
   further FNB-facing implementation work should proceed beyond what Phase 16 already
   built as onboarding-ready scaffolding.
