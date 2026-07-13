---
title: Client Kernel
description: Shared connection, protocol-dispatch, and message-parsing helpers used by every adapter.
tags:
  - wiki
  - module
---
## Purpose

Foundation module — connection settings, client resolution, protocol dispatch, and LangChain message/text helpers shared by every other module in the package.

## Responsibilities

- Define `OpenVikingConnection` — the connection-settings shape every adapter constructor accepts.
- Resolve a usable client via `ensureClient()`: reuse an explicit `client`, or lazily build a `SyncHTTPClient` from `url`/`apiKey`/etc via `createClientFromConnection()`.
- Dispatch protocol calls uniformly via `callOpenviking()`: looks up `client[methodName]`, strips `undefined` option fields (the JS analog of Python's None-kwarg filtering), awaits sync-or-async results.
- Define commit-policy semantics: `commitPolicy()` normalizes a policy object, `applyCommitPolicy()` executes it (`never` / `always` / `pending_tokens` threshold check via `get_session`).
- Message/text helpers: `extractMessageText`, `messageType`, `getLatestUserText`, `estimateTextTokens`, `normalizePeerId`.
- Normalize retrieval results: `resultGroups()` / `iterResultItems()` / `itemValue()` group `find`/`search` results into memory/resource/skill buckets.

## Public API / entry points

- Types: `OpenVikingConnection`, `OpenVikingClientLike`, `OpenVikingCommitPolicy`, `OpenVikingMessage`, `OpenVikingPart`, `OpenVikingResultItem`, `OpenVikingFindResult`
- Functions: `ensureClient`, `callOpenviking`, `commitPolicy`, `applyCommitPolicy`, `extractMessageText`, `getLatestUserText`

## Key files

[src/client.ts](../../src/client.ts)

## Dependencies

None within the package (leaf module); dynamically imports [http_client.ts](../../src/http_client.ts) only inside `createClientFromConnection` to avoid a static import cycle.

## Flows it participates in

- [Full agent with store and tools](../flows/full-agent-with-store-and-tools.md)
- [Session commit and archival](../flows/session-commit-and-archival.md)
- [Context injection and history](../flows/context-injection-and-history.md)

Related concepts: [Connection settings](../concepts/connection.md), [Commit policy](../concepts/commit-policy.md)
