# HANDOFF — @grubgenie/openviking-memory-layer

## Goal
Standalone, published npm package: a faithful **TypeScript port** of the Python
`openviking.integrations.langchain` adapters, so LangChain.js / LangGraph.js apps
can use OpenViking as a memory backend (retriever, store, agent tools, chat
history, context middleware). Detached into its own GitHub repo.

## Knowledge base
A full codebase wiki now exists at `wiki/OVERVIEW.md` (OpenKnowledge, profile
`internal/exhaustive`, stamped `source_commit: 86b96cb8c456de05da794ce36b59c95afed4db7d`).
Covers architecture, one page per `src/*.ts` module, key flows (incl. failure modes),
concepts, and guides. To refresh after further `src/` changes, re-invoke the `wiki`
OK workflow — it diffs against the stamped commit and touches only affected pages,
not a full regen.

A provisional research note also exists comparing this package's identity model
(`account`/`userId`/`actorPeerId`) against upstream OpenViking v0.4.1's new User/Peer
model (the deployed server is on v0.3.24): `research/openviking-0.4-user-peer-model-vs-current-implementation.md`.
**Decision: migration deliberately deferred** — 0.3.x stays fully supported, no forcing
function, and there are small existing bugs in this repo to patch first. Read that note
before re-litigating whether to upgrade; don't re-derive the comparison from scratch.

## Status: v0.2.1 published + live-verified; v0.2.2 (README) tagged, publish PENDING (OTP)
- **npm**: latest PUBLISHED = `@grubgenie/openviking-memory-layer@0.2.1` (public, live, fully verified).
  **v0.2.2 is tagged + pushed but NOT yet published** — README-only change (expanded usage docs,
  identical code to 0.2.1). To finish: run interactively `npm publish --otp=<6-digit-code>`
  (npm user `hencydsouza24`; publish always needs 2FA OTP). 0.2.2 just refreshes the npm README page.
  → grubgenie should install **`@0.2.1`** (or `@0.2.2` once published). Avoid 0.2.0 (broken `get_status`).
  https://www.npmjs.com/package/@grubgenie/openviking-memory-layer
- **GitHub**: https://github.com/hencydsouza24/openviking-memory-layer — `main` @ `ffb1832`.
  Tags: `v0.2.0`, `v0.2.1`, `v0.2.2`. Key commits: `1a141f4` (feature), `c2aba29` (get_status fix +
  v0.2.1), `fbe5624` (live verify suite), `fbf6aa1` (README expansion), `ffb1832` (v0.2.2 bump).
- **Repo root**: `~/Desktop/cloned_repos/openviking-memory-layer` (standalone, own git).
- `.graymatter/` is gitignored (tool artifact, not committed).
- **Live verification**: `scripts/verify_live.ts` (committed dev tool, not packed) exercises
  EVERY export against a running server — **38/38 pass**. Run:
  `OPENVIKING_URL=http://127.0.0.1:1933 OPENVIKING_API_KEY=openviking-dev-key npx tsx scripts/verify_live.ts`
  (grubgenie's dev server runs in OrbStack on `:1933`, key `openviking-dev-key`).
  Found + fixed ONE real bug: `get_status` path was `/api/v1/status` → corrected to
  `/api/v1/observer/system` (locked by a contract test). Verified live: store put→get
  deterministic, per-user isolation (other userId → null), retriever (4 docs), assembler
  (1517-char block, 5 recall), history round-trip, middleware, all 12 tools. Semantic
  recall works live (earlier 0-hit was embedding latency). `add_skill` needs a doc with
  YAML frontmatter (server rule, not a client bug).

## This session (the 0.2.x changes)
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
- All gates green: `npm run build`, `npm run typecheck`, `npm test` (13/13), `npm pack` (12 files).
- Full-export LIVE verification via `scripts/verify_live.ts` (38/38) — the definitive proof
  every export works against a real server; re-run it after any `src/` change.

## What didn't work / gotchas
- Export probe from `/tmp` failed (node couldn't resolve deps) — must run inside the package dir.
- `OpenVikingConnection.timeout` had to widen to `number | null` (store passed null) for typecheck.
- `getLatestUserText` first draft was tangled — simplified using `message._getType()`.
- `withOpenvikingContext`: JS `RunnableWithMessageHistory` always needs `configurable.sessionId`
  (no Python zero-arg-factory detection) → wrapper injects the fixed sessionId into config so
  `app.invoke([...])` works with no config.

## Known follow-ups (NOT done)
1. **LICENSE file missing.** package.json declares `AGPL-3.0` (derivative of AGPL OpenViking;
   must stay AGPL). Add full AGPL-3.0 `LICENSE` text. `curl`/`wget` blocked — paste or
   `ctx_fetch_and_index`.
2. No CI. Optional: GitHub Actions publish-on-tag (`npm publish`, needs `NPM_TOKEN` secret —
   would also sidestep the manual OTP).
3. `OpenVikingStore` canonicalized-URI fallback parser is a documented no-op (fine for in-memory
   + HTTP literal URIs).
4. **grubgenie wiring is NOT done** (read-only this session, by design). To adopt the published
   `@0.2.1` in `agents.diner.ts`: replace the in-repo store/tools with this package —
   `new OpenVikingStore({ url, apiKey, account: <CONSTANT diner account>, userId: dinerId })`
   and `createOpenvikingTools({ ... })`. For global-per-diner memory across restaurants, use a
   SINGLE constant `account` (NOT `ctx.accountId`) + `userId = dinerId`. The in-repo
   `injectBranchContext`/`uploadSkill` use `extractSession` (swap to `commit_session`) +
   `addSkill` (now in the package). NOTE `add_skill` payloads need YAML frontmatter.
5. Semantic `search`/recall depends on the server's async embedding pipeline — the KV path
   (get/put/delete) is exact/immediate; query recall may lag right after a write.

## Next steps (for a fresh agent)
- **Publish the pending v0.2.2**: `npm publish --otp=<code>` (README refresh; optional, code unchanged).
- `cd ~/Desktop/cloned_repos/openviking-memory-layer && npm install`
- Gates: `npm run build && npm run typecheck && npm test` (13 tests).
- Live re-verify (needs a running server): `npx tsx scripts/verify_live.ts` (38 checks).
- README now has full per-export usage + a full `createAgent` + store + tools example.
- Remaining value-add: follow-ups 1–2 (LICENSE, CI) and the grubgenie wiring (#3).

## Source of truth for parity
Python originals live in the OpenViking clone:
`~/Desktop/cloned_repos/OpenViking/openviking/integrations/langchain/*.py`
and `~/Desktop/cloned_repos/OpenViking/examples/langchain-langgraph/`.
