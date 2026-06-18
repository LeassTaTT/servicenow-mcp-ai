# TODO — status as of 2026-06-17

> **No active/actionable dev work remains.** Everything completed has been moved to
> [DONE.md](DONE.md) — the morning review (22/22), Phase 6, Phase 7 core, the three full-review
> passes (2026-06-13 and 2026-06-16/17), the QA backlog, the `servicenow-mcp-ai` rename and the
> release process. What is left below is **not pending dev work**: a trigger-gated deferred backlog
> and one owner action.
>
> Marker key — ⏳ **deferred** (activates only when its trigger fires) · 👤 **owner action**
> (needs Ivan, not a dev task).
>
> Not-yet-started feature work lives in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)
> (Phase 7 multi-instance follow-ups, Phase 8 flow testing + code analysis, "Optional");
> the work chronology is in [WORKLOG.md](WORKLOG.md).

## Full review (2026-06-16 → 17) — architect → dev → qa

> Fresh `/full-review` pass over the whole tree on top of the 1.0.0 release, then a follow-up that
> closed **every** remaining finding. **All fixed and moved to [DONE.md](DONE.md):** ARCH-3
> (`fetchAll` truncation made visible in snapshot/compare), DEV-5 (stale cache comment),
> QA-18/QA-19 (tests locking the `truncated` contract), ARCH-4 (unified `result`-envelope unwrap
> across every API module), ARCH-5 (the Batch API now obeys the package axis — a batch can no longer
> reach a denied plugin API or write to a read-only package), and the two former "won't-fix"
> security decisions, now hardened: SEC-7 (`.env` written `0600`) and SEC-8 (a host must be
> `*.service-now.com` unless `SN_ALLOWED_HOSTS` is set). No deferred review items remain.

## Owner action

- 👤 **R-2 · Publish 1.0.0 (first release).** The remote is connected
  (`github.com/LeassTaTT/servicenow-mcp`); `main` is **6 commits ahead of origin** and the
  2026-06-16/17 full-review + hardening work is **still uncommitted**. _Needs Ivan, in order:_
  (1) commit the uncommitted work; (2) decide the version — re-point the unpushed `v1.0.0` tag onto
  the new HEAD (never published, so reusing 1.0.0 is fine) or bump to 1.1.0, and move the CHANGELOG
  `[Unreleased]` block under it; (3) make the GitHub repo **public** (required for `npm publish
--provenance`) and add the **`NPM_TOKEN`** repo secret; (4) `git push origin main`, confirm the
  first CI run is green (drop the Windows `continue-on-error` once it is), then push the tag to fire
  `publish.yml`.

## Deferred backlog (trigger-gated — not active work)

- ⏳ **A2-2 · ConfigStore covers only credentials.** _trigger: MI-1 follow-up (Phase 7)._
  Policy/settings read env per call — deliberate (see A-2); the profile store will unify them;
  until then new settings go through `settings.ts` only.
- ⏳ **A2-3 · Global singletons.** _trigger: "when it hurts" — not earlier._ The token/schema/plugin
  caches and telemetry have `clear*` hooks instead of injection. Fine for one process; if multiple
  servers ever share a process (tests do!), state is shared. _Solution:_ a container object created
  at bootstrap — when it hurts, not before.
- ⏳ **A2-4 · Bootstrap will fork at X-8.** _trigger: an X-8 request_ (HTTP transport) — extract the
  choice into `mcp/transport.ts` when X-8 is requested; not pre-emptively.
- ⏳ **A2-5 · Resource errors are JSON content.** _trigger: MCP protocol evolution_ (the protocol has
  no `isError` for resources) — a client cannot tell an error from data. Known; documented in
  ARCHITECTURE.
