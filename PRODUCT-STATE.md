# servicenow-mcp — Product State

Date: 2026-06-22 · clean build · clean ESLint (type-checked + layer boundaries) · **303/303 tests** (coverage 95.1% lines / 83.6% branches / 98.7% functions) · CI: Node 20/22/24 + macOS matrix, coverage (lines 94 / branches 82 / functions 97) + prod-audit gates · git history one-commit-per-task.
**Phase 6 is complete** (the optional X-8 HTTP transport shipped in v2.0 as DF-6): layered core/api/mcp/tools directories, a declarative tool manifest (a package is a plug-in), elicitation, MCP logging, outputSchema, the email package. **Phase 7 (multi-instance) is complete** (MI-1…MI-8: profiles, per-profile policy, per-call routing, snapshot, comparison, per-profile resources). **Phase 8 (flow testing + code checking) is complete** (FT-1…FT-7: the `flows`, `codecheck` and `atf` packages — deterministic table-event tracing, Flow Designer reading + run history, a local lint rule set + code-health report, ATF runs via the CI/CD API).
Related documents: [ARCHITECTURE.md](ARCHITECTURE.md) (how it is built), [DONE.md](DONE.md) (everything completed), [ROADMAP.md](ROADMAP.md) (forward plan), [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) (detailed specs), [WORKLOG.md](WORKLOG.md) (chronology), [CHANGELOG.md](CHANGELOG.md).

## 1. TL;DR — what works today

A full ServiceNow MCP server: **67 tools in 18 packages**, 7 MCP resources (package-gated), 3 prompts. Covers all core ServiceNow REST APIs (Table, Aggregate, Attachment, Import Set, Batch, CMDB/IRE) and the plugin APIs (Catalog, Change, Knowledge, Email) with capability detection. **v2.0 — trust + depth + reach:** plan-and-apply write safety (`SN_WRITE_MODE`, default plan) plus a local audit journal across all 13 write tools; a capability preflight (`check_capabilities` + degrade); an ACL security scan folded into `code_health`; a where-used / impact graph; client-side field redaction (PII); a token-guarded Streamable HTTP transport (`SN_TRANSPORT=http`); CSV export; and a `drift` CI gate. Reads and analyses the instance's script automation (business rules, script includes, client scripts…), traces what a table operation would run, lints scripts against a local rule set and runs ATF tests via the CI/CD API, generates Mermaid diagrams and maintains a local Markdown self-documentation store. Two-axis policy model (tables + packages), named connection profiles with per-call routing, **every ServiceNow auth method** (Basic, OAuth 2.1 Authorization Code + PKCE, client_credentials, refresh_token, JWT bearer, API key, bearer token, mutual TLS), retry/backoff, SSRF guard, structured errors.

```mermaid
pie title 67 tools by package
    "table (CRUD)" : 5
    "attachment" : 5
    "catalog" : 5
    "change" : 5
    "cmdb" : 5
    "admin" : 6
    "atf" : 5
    "scripts" : 5
    "flows" : 4
    "docs + diagrams" : 6
    "knowledge" : 3
    "codecheck" : 3
    "schema" : 2
    "importset" : 2
    "email" : 2
    "instance" : 2
    "aggregate" : 1
    "batch" : 1
```

## 2. ServiceNow API surface coverage

| ServiceNow API                      | Status | How                                                                                                                                       |
| ----------------------------------- | :----: | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Table API (CRUD + queries)          |   ✅   | `table` package; fetchAll pagination, X-Total-Count, display values                                                                       |
| Aggregate / Stats                   |   ✅   | `servicenow_aggregate`: count/avg/min/max/sum + group_by/having                                                                           |
| Attachment                          |   ✅   | list/meta/download/upload/delete; base64, size guard before download                                                                      |
| Import Set                          |   ✅   | staging insert + transform outcome                                                                                                        |
| Batch (`/api/now/v1/batch`)         |   ✅   | several REST calls in one request; policy per sub-request                                                                                 |
| CMDB Instance / Meta / IRE          |   ✅   | class-aware CRUD through Identification & Reconciliation                                                                                  |
| Service Catalog (`sn_sc`)           |   ✅   | browsing + variables + **order now**; plugin-aware                                                                                        |
| Change Management (`sn_chg_rest`)   |   ✅   | typed create (normal/standard/emergency), conflicts, update                                                                               |
| Knowledge (`sn_km_api`)             |   ✅   | relevance search, article, featured/most-viewed                                                                                           |
| Schema (`sys_db_object/dictionary`) |   ✅   | list/describe **with super_class inheritance chain**                                                                                      |
| Scripts (via the Table API)         |   ✅   | 9 artefact types: list/source/code search/`table_logic`                                                                                   |
| Diagrams / documentation            |   ✅   | Mermaid ER + table flow; local MD store + resources                                                                                       |
| Email API                           |   ✅   | `email` package: send (pluginCall + write policy) / get                                                                                   |
| Multi-instance work                 |   ✅   | profiles + per-profile policy + per-call routing (MI-1…MI-5); `snapshot_instance`, `compare_instances`, per-profile resources (MI-6…MI-8) |
| CI/CD + ATF                         |   ✅   | `atf` package: list/run tests + suites, poll results via the CI/CD API (FT-4; opt-in, non-default)                                        |
| Code Search (`sn_codesearch`)       |   ✅   | `search_code` uses it with `SN_CODESEARCH=true` (FT-7), LIKE fallback otherwise                                                           |
| Flow intelligence + code checking   |   ✅   | `flows` (trace/list/get/runs) + `codecheck` (lint + code-health) — Phase 8 FT-1/2/3/5/6                                                   |

## 3. How it is built (quality and infrastructure)

- **Language/runtime:** TypeScript strict + `noUncheckedIndexedAccess`, ESM, Node ≥ 20 (note: the default shell Node here is v12 — use nvm 22), MCP SDK 1.29.
- **Lint:** typescript-eslint type-checked + `no-floating-promises` + layer-boundary rules; Prettier (checked in CI).
- **Tests: 303 on 4 levels** (unit → api over mock fetch → in-memory MCP client → documentation guards, incl. property-based, perf and a manifest-integrity smoke that drives every tool), ~1 second, zero network. A contract snapshot protects the `core` tool list; sync tests protect the README tools table and the package description counts.
- **CI:** GitHub Actions (lint + format + build + test on Node 20/22/24 Linux + Node 22 macOS; coverage gate `--lines 94 --branches 82 --functions 97`; prod-dependency audit; Windows visibility job; Node 12 launcher probe). Locally the same chain is one command: `npm run check`.
- **Documentation as code:** the README tools table is generated (`npm run docs:readme`); the env reference + `.env.example` are maintained by working rule; WORKLOG/DONE/TODO discipline after every task.

## 4. History — how we got here

```mermaid
timeline
    title servicenow-mcp — major milestones
    section 2026-06-11
        Start : 7 tools over the Table API only
        Reviews : code review + architecture review : won't-fix decisions (.env mode, instance change)
        Phases 1-5 : harness (retry, policy, OAuth, packages) : full API coverage : script intelligence : docs + diagrams + prompts
        Plan : Phase 6 (harness 2.0) : Phase 7 (multi-instance) : Phase 8 (flow testing + code analysis)
    section 2026-06-12
        Deep review : 22 findings (senior / architect / QA) : 22 of 22 closed
        Phase 6 : layered dirs : declarative manifest : elicitation, logging, outputSchema, email
        Quality : 59 to 137 tests : type-checked lint : generated README : v1.0.0 cut
        Phase 7 core : named profiles : per-profile policy : per-call instance routing : rebrand to servicenow-mcp
```

The most important review fixes (full list in [DONE.md](DONE.md)): `describe_table` now sees inherited columns (critical for any extended table such as `incident`); batch can no longer bypass the table policy via stats/import/cmdb URLs; plugin APIs have a capability cache; credentials live in an atomic ConfigStore; a per-package policy axis covers the plugin APIs.

## 5. What is NOT done (roadmap)

Detailed specifications live in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) — written as a handoff spec:

| Phase                                | What                                                                       | Effort     | Key tasks                          |
| ------------------------------------ | -------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| ~~8 · Flow testing + code analysis~~ | **done (2026-06-19)** — `flows` + `codecheck` + `atf` packages (FT-1…FT-7) | —          | shipped                            |
| Optional                             | PDI e2e suite, XLSX export (needs a binary-writer dep), vitest migration   | on request | the "Optional" section in the plan |

## 6. Known limitations and deliberate decisions

- **Hardened defaults (2026-06-17):** `.env` is written owner-only (`0600`); a request host must be `*.service-now.com` unless `SN_ALLOWED_HOSTS` is set (the SSRF guard + X-2 elicitation still apply on top). These were the two former "won't-fix" single-user risks, flipped for the public release.
- **Table policy ≠ plugin policy:** denying a table does not stop the plugin APIs — that is what the package axis (`SN_PACKAGES_DENY`/`SN_PACKAGES_READONLY`) is for; documented in the README security section.
- **The README env table** is still manual (the tools table no longer is) — the remainder of M-5.
- **No code execution on the instance** (incl. background scripts) — ATF through the official CI/CD API is the planned path (Phase 8).

## 7. Document compass

| File                                               | Contents                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| [README.md](README.md)                             | setup, env reference, generated tools table, examples, security           |
| [ARCHITECTURE.md](ARCHITECTURE.md)                 | layers, diagrams, policy/auth/config models, ADR decisions                |
| [PRODUCT-STATE.md](PRODUCT-STATE.md)               | this file — what/how far/how                                              |
| [ROADMAP.md](ROADMAP.md)                           | forward plan: ship 1.0.0, Phase 8, Phase 9 differentiators, optional      |
| [COMPETITIVE-ANALYSIS.md](COMPETITIVE-ANALYSIS.md) | positioning vs the official MCP Server Console; Phase 9 boost plan; risks |
| [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)   | Phase 6–8 specifications + optional items                                 |
| [DONE.md](DONE.md)                                 | everything completed, with commit references                              |
| [TODO.md](TODO.md)                                 | backlog (triple analysis S2/A2/Q2), release checklist R-1…R-9, won't-fix  |
| [WORKLOG.md](WORKLOG.md)                           | detailed chronology: problem/solution/alternatives/verification           |
| [CHANGELOG.md](CHANGELOG.md)                       | user-facing change overview (Keep a Changelog)                            |
