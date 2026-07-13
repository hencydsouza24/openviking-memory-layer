---
title: OpenVikingRetriever
description: LangChain BaseRetriever over OpenViking find/search, with a client-side scope re-filter.
tags:
  - wiki
  - module
---
## Purpose

Turn OpenViking retrieval hits into LangChain `Document`s.

## Responsibilities

- `_getRelevantDocuments`: calls `find` or `search` (per `searchMode`) via `callOpenviking`, then for each hit resolves content per `contentMode` (`abstract` < `overview` < `read`) and builds an `openviking_*`-prefixed metadata bag.
- **Security-relevant:** `resolveAllowedScopePrefixes()` + `isUnderAllowedPrefix()` independently re-verify each result's URI prefix against either the caller's explicit `targetUri` or a reconstructed default scope (`viking://user/{userId}`, `viking://resources`) — dropping any hit outside it. This exists because server-side `PathScope` enforcement has been observed to leak cross-user results at the compiled native index-engine layer even though every Python layer above it builds the correct restriction. Skipped only when no `userId`/`user` is set (nothing to enforce against).
- `clone(update)`: shallow copy for scoping a retriever to a session/searchMode without re-touching the original (mirrors pydantic's `model_copy`).

## Public API / entry points

`class OpenVikingRetriever`, `type ContentMode`, `type SearchMode`.

## Key files

[src/retrievers.ts](../../src/retrievers.ts)

## Dependencies

`@langchain/core` (`BaseRetriever`, `Document`); [client.ts](client.md).

## Flows it participates in

[Context injection and history](../flows/context-injection-and-history.md)

Related concepts: [Identity and scoping](../concepts/identity-and-scoping.md), [Content mode](../concepts/content-mode.md), [Find vs search](../concepts/find-vs-search.md)
