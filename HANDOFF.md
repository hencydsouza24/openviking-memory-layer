# HANDOFF — @grubgenie/openviking-memory-layer

## Goal
Standalone, published npm package: a faithful **TypeScript port** of the Python
`openviking.integrations.langchain` adapters, so LangChain.js / LangGraph.js apps
can use OpenViking as a memory backend (retriever, store, agent tools, chat
history, context middleware). Detached into its own GitHub repo.

## Status: DONE and shipped
- **npm**: `@grubgenie/openviking-memory-layer@0.1.0` — published, public.
  https://www.npmjs.com/package/@grubgenie/openviking-memory-layer
- **GitHub**: https://github.com/hencydsouza24/openviking-memory-layer (public, `main`)
- **Repo root**: `~/Desktop/cloned_repos/openviking-memory-layer` (standalone, own git, 1 commit)
- Removed from the OpenViking parent repo (`packages/langchain-js` deleted; was never committed there).
- Goldfish session memory: `~/Goldfish/work/openviking-memory-layer/goldfish/` (small/medium/large/inbox).

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
- Peer deps kept lean: only `@langchain/core` + `zod` (langgraph/openai are example-only devDeps).
- All gates green: `npm run build`, `npm run typecheck`, `npm test` (5/5), `npm pack --dry-run` (12 files).

## What didn't work / gotchas
- Export probe from `/tmp` failed (node couldn't resolve deps) — must run inside the package dir.
- `OpenVikingConnection.timeout` had to widen to `number | null` (store passed null) for typecheck.
- `getLatestUserText` first draft was tangled — simplified using `message._getType()`.
- `withOpenvikingContext`: JS `RunnableWithMessageHistory` always needs `configurable.sessionId`
  (no Python zero-arg-factory detection) → wrapper injects the fixed sessionId into config so
  `app.invoke([...])` works with no config.

## Known follow-ups (NOT done)
1. **LICENSE file missing.** package.json declares `AGPL-3.0` (inherited — this is a derivative
   of AGPL OpenViking code, so it must stay AGPL unless you have relicense rights). Add full
   AGPL-3.0 `LICENSE` text for compliance. `curl`/`wget` are blocked in this env — fetch via
   `ctx_fetch_and_index` or paste the text.
2. **npm 0.1.0 lacks `repository` field** (added to package.json AFTER publish). Next
   `npm version patch && npm publish` attaches repo link on npm.
3. No CI. Optional: GitHub Actions publish-on-tag workflow (`npm publish --access public`,
   needs `NPM_TOKEN` secret).
4. `OpenVikingStore` canonicalized-URI fallback parser is a documented no-op (fine for in-memory
   + HTTP literal URIs; revisit only if a backend returns non-prefixed URIs).
5. `live_app.ts` unverified — needs running OpenViking server + `ARK_API_KEY` (Python suite also skips it).

## Next steps (for a fresh agent)
- `cd ~/Desktop/cloned_repos/openviking-memory-layer && npm install`
- Verify: `npm run build && npm run typecheck && npm test`
- If continuing: tackle follow-ups 1–3 above (LICENSE, version bump+republish, CI).

## Source of truth for parity
Python originals live in the OpenViking clone:
`~/Desktop/cloned_repos/OpenViking/openviking/integrations/langchain/*.py`
and `~/Desktop/cloned_repos/OpenViking/examples/langchain-langgraph/`.
