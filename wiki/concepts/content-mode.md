---
title: Content mode
description: The abstract < overview < read tiering for retrieval result content.
tags:
  - wiki
  - concept
---
## Definition

`ContentMode` (`'auto' | 'abstract' | 'overview' | 'read'`) controls how much of a retrieval hit's content gets materialized: `abstract` (shortest), `overview` (fuller summary), or `read` (full content, fetched via a follow-up `read` call).

## Why it matters

Lets callers trade token cost against completeness per hit. `'auto'` (the [OpenVikingRetriever](../modules/retrievers.md) default) only fetches full content for `level === 2` items, falling back to overview/abstract otherwise — avoiding a full `read` round-trip for lower-relevance hits.

## Where it lives in code

`type ContentMode` and `contentForItem()`/`readOrFallback()` in [retrievers.ts](../../src/retrievers.ts); the `viking_read` tool's `contentMode` parameter in [tools.ts](../../src/tools.ts) exposes the same tiering directly to a model.

## Related

[OpenVikingRetriever module](../modules/retrievers.md), [tools module](../modules/tools.md)
