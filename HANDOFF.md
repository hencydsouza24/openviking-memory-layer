# HANDOFF — @grubgenie/openviking-memory-layer

## Goal
Standalone, published npm package: a faithful **TypeScript port** of the Python
`openviking.integrations.langchain` adapters, so LangChain.js / LangGraph.js apps
can use OpenViking as a memory backend (retriever, store, agent tools, chat
history, context middleware). Detached into its own GitHub repo.

## Status: v0.2.0 committed + pushed — NOT yet on npm (blocked on OTP)
- **npm**: latest published is still `@grubgenie/openviking-memory-layer@0.1.0`.
  **0.2.0 publish is pending** — `npm publish` keeps failing with `EOTP` (2FA).
  **To finish the release, run interactively:** `npm publish --otp=<6-digit-code>`
  (build/prepublish already pass; only the OTP is missing). npm user: `hencydsouza24`.
  https://www.npmjs.com/package/@grubgenie/openviking-memory-layer
- **GitHub**: https://github.com/hencydsouza24/openviking-memory-layer — `main` pushed
  through `v0.2.0` (commit `1a141f4` feature + `9a2b787` version bump; tag `v0.2.0` pushed).
- **Repo root**: `~/Desktop/cloned_repos/openviking-memory-layer` (standalone, own git).
- `.graymatter/` is gitignored (tool artifact, not committed).

## This session (the 0.2.0 changes)
Goal was to make the package consumable by `grubgenie_api_refactor`
(`src/modules/agents/agents.diner.ts` uses `OpenVikingStore` as `createAgent({ store })`
+ `createMemoryTools`). grubgenie was **read-only**; only this package changed.
- **Parity-verified** the TS port vs Python examples: 4/5 deterministic examples emit
  byte-identical output; middleware pair matches by source (Python middleware env lacked
  full `langchain` pkg). Found the real gaps below.
- **`SyncHTTPClient` was incomplete** — `OpenVikingStore` + half the tools dispatched
  `write`/`glob`/`ls`/`rm`/`grep`/`add_skill` which it never implemented, so the store/tools
  worked **only** against `InMemoryOpenVikingClient`. Added all 6 (canonical
  `openviking_cli/client/http.py` REST paths) + the `X-OpenViking-Actor-Peer` header.
- **`OpenVikingStore` was not a real LangGraph store** — standalone class, no `batch()`.
  `createAgent({ store })` drives a store only through `batch()`, so it would have thrown.
  Now `extends BaseStore` + implements `batch()`. `@langchain/langgraph` = optional peer dep.
- **Decided NOT to add** `extract_session` (non-canonical; grubgenie's server route only —
  canonical extraction is `commit_session`) and **dropped** legacy `agentId` (deprecated;
  modern scope is `actorPeerId` → `X-OpenViking-Actor-Peer`).
- **Diner memory model = global-per-diner** (memory follows the diner across
  restaurants/accounts). Verified server keys user space by `user_id` ONLY
  (`viking://user/{user_id}/...`, `namespace.py:162`, `user_id.py:54-59`); `viking://user/`
  is a per-request shorthand the server expands. README documents the wiring:
  **constant `account` for all diners + `userId = dinerId`** (do NOT pass the restaurant's
  `accountId` as `account` — auth + vector-layer tenant isolation could silo per restaurant).

## What's in the package
Port of all 9 Python modules in `openviking/integrations/langchain/`, flattened to `src/`:
- `client.ts` — types, `ensureClient`, `callOpenviking`, commit policy, `extractMessageText`, `getLatestUserText`
- `testing.ts` — `InMemoryOpenVikingClient` (deterministic, no server)
- `http_client.ts` — `SyncHTTPClient` (REST/fetch). Now implements every protocol
  method the adapters dispatch, incl. content/fs ops `write`/`glob`/`ls`/`rm`/`grep`
  + `add_skill`, so `OpenVikingStore`/tools run against a real server (not just
  in-memory). Tenant scope via `X-OpenViking-Account`/`-User`/`-Actor-Peer` headers
  (`actorPeerId` is the modern per-agent scope; grubgenie's per-branch id maps here,
  replacing its non-canonical `X-OpenViking-Agent`). Test: `test/http_client.test.ts`
  (contract + store put→get round-trip over stubbed fetch).
- `retrievers.ts` — `OpenVikingRetriever` (BaseRetriever)
- `store.ts` — `OpenVikingStore`. Now **extends LangGraph `BaseStore`** and implements
  `batch()` (dispatching to get/put/delete/search/listNamespaces), so it works as a
  long-term `createAgent({ store })` backend — not just manual get/put. Adds
  `@langchain/langgraph` as an **optional** peer dep (only needed when you use the store).
- `tools.ts` — `createOpenvikingTools` (12 `viking_*` tools, zod schemas, profiles)
- `history.ts` — `OpenVikingChatMessageHistory` + message converters
- `context.ts` — `OpenVikingSessionContextAssembler`, `withOpenvikingContext`
- `middleware.ts` — `OpenVikingContextMiddleware`
- `index.ts` — barrel

`examples/` — 6 runnable demos (5 deterministic + `langgraph/agent/live_app.ts`).
`test/smoke.test.ts` — mirrors Python `tests/integration/langchain_langgraph/test_smoke.py`.

## What worked
- Read all 9 Python modules + 6 examples + test contract first, then ported.
- **Convention**: client methods keep snake_case protocol names (`create_session`,
  `add_message`) so `callOpenviking(client, name, opts)` maps 1:1 to Python; option
  objects camelCased (`targetUri`, `scoreThreshold`); message "parts" keep snake_case keys.
- Probed langchain.js exports before coding (caught `StringOutputParser`, not `StrOutputParser`).
- Verified `RunnableWithMessageHistory` JS behavior with a probe before porting `context.ts`.
- Dual ESM+CJS via **tsup** (`external` for `@langchain/*` + `zod`); verified `dist`
  consumable from both `import` and `require`.
- Peer deps: `@langchain/core` + `zod` (required); `@langchain/langgraph` (optional, store only).
- All gates green: `npm run build`, `npm run typecheck`, `npm test` (12/12), `npm pack` (12 files).

## What didn't work / gotchas
- Export probe from `/tmp` failed (node couldn't resolve deps) — must run inside the package dir.
- `OpenVikingConnection.timeout` had to widen to `number | null` (store passed null) for typecheck.
- `getLatestUserText` first draft was tangled — simplified using `message._getType()`.
- `withOpenvikingContext`: JS `RunnableWithMessageHistory` always needs `configurable.sessionId`
  (no Python zero-arg-factory detection) → wrapper injects the fixed sessionId into config so
  `app.invoke([...])` works with no config.

## Known follow-ups (NOT done)
1. **FINISH THE 0.2.0 PUBLISH** — run `npm publish --otp=<code>` (only blocker is 2FA).
2. **LICENSE file missing.** package.json declares `AGPL-3.0` (derivative of AGPL OpenViking;
   must stay AGPL). Add full AGPL-3.0 `LICENSE` text. `curl`/`wget` blocked — paste or
   `ctx_fetch_and_index`.
3. No CI. Optional: GitHub Actions publish-on-tag (`npm publish`, needs `NPM_TOKEN` secret —
   would also sidestep the manual OTP).
4. `OpenVikingStore` canonicalized-URI fallback parser is a documented no-op (fine for in-memory
   + HTTP literal URIs).
5. `live_app.ts` + the new HTTP methods are **unverified against a live server** — only
   covered by stubbed-fetch unit tests. Smoke-test `OpenVikingStore` put/get/search against a
   real OpenViking before grubgenie relies on it.
6. **grubgenie wiring is NOT done** (read-only this session). To adopt: in
   `agents.diner.ts`, replace the in-repo store/tools with this package —
   `new OpenVikingStore({ url, apiKey, account: <CONSTANT diner account>, userId: dinerId })`
   and `createOpenvikingTools({ ... })`. The in-repo `injectBranchContext`/`uploadSkill`
   use `extractSession` (swap to `commit_session`) + `addSkill` (now in the package).

## Next steps (for a fresh agent)
- `cd ~/Desktop/cloned_repos/openviking-memory-layer && npm install`
- Verify: `npm run build && npm run typecheck && npm test` (12 tests).
- **Publish 0.2.0**: `npm publish --otp=<code>`.
- Then tackle follow-ups 2–3 (LICENSE, CI) and the grubgenie wiring (#6).

## Source of truth for parity
Python originals live in the OpenViking clone:
`~/Desktop/cloned_repos/OpenViking/openviking/integrations/langchain/*.py`
and `~/Desktop/cloned_repos/OpenViking/examples/langchain-langgraph/`.
