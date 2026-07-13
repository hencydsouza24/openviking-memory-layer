---
title: find vs search
description: Stateless semantic retrieval versus session-aware retrieval.
tags:
  - wiki
  - concept
---
## Definition

`find` is stateless semantic retrieval — just the query against a target scope. `search` is session-aware: it additionally folds session context into the match (in [InMemoryOpenVikingClient](../modules/testing.md), `search()` appends the session's own message text to the query before scoring).

## Why it matters

`OpenVikingRetriever`'s `searchMode` picks between them (`'find'` default, `'search'` when session-scoped recall is wanted). The [context assembler](../modules/context.md) always uses a `search`-mode retriever clone, since it's inherently session-scoped.

## Where it lives in code

`type SearchMode` in [retrievers.ts](../../src/retrievers.ts); `find`/`search` methods on [SyncHTTPClient](../../src/http_client.ts) and [InMemoryOpenVikingClient](../../src/testing.ts).

## Related

[OpenVikingRetriever module](../modules/retrievers.md), [Session commit and archival flow](../flows/session-commit-and-archival.md)
