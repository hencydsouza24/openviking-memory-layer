---
title: Testing without a server
description: Running examples and tests against InMemoryOpenVikingClient instead of a live OpenViking server.
tags:
  - wiki
  - guide
---
## Goal

Run and test any adapter with no OpenViking server and no API key.

## Steps

1. Construct an [`InMemoryOpenVikingClient`](../modules/testing.md), optionally seeded with `{ uri: content }` records: `new InMemoryOpenVikingClient({ 'viking://user/memories/profile.md': '...' })`.
2. Pass it as `client` to any adapter constructor (`OpenVikingStore`, `createOpenvikingTools`, `OpenVikingContextMiddleware`, …) exactly as you would a `SyncHTTPClient`.
3. Run `npm test` (vitest) — it runs every example under `examples/` end-to-end against this client. Run a single example directly with its `npm run example:*` script (see the README's "Run the examples" section).
4. For a real server, run `OPENVIKING_URL=... OPENVIKING_API_KEY=... npx tsx scripts/verify_live.ts` — exercises every export end-to-end against a live server (client methods, store round-trip + isolation, retriever, history, middleware, assembler, every tool) and reports pass/fail per feature. It's a throwaway dev tool, not packed into the published package.

## Gotchas

- Semantic-search assertions against a live server should check shape, not hit count — `scripts/verify_live.ts` does this deliberately, since real embedding search is eventually consistent (see [Session commit and archival](../flows/session-commit-and-archival.md)).
- `InMemoryOpenVikingClient`'s retrieval scoring is deterministic token overlap, not semantic — don't expect it to rank the way a real embedding-based `find`/`search` would.
