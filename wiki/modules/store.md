---
title: OpenVikingStore
description: A real LangGraph BaseStore backed by dual data+index writes into OpenViking.
tags:
  - wiki
  - module
---
## Purpose

Durable long-term memory for `createAgent({ store })` — extends LangGraph's `BaseStore`.

## Responsibilities

- `put` / `get` / `delete`: JSON record at `<rootUri>/data/<namespace>/<key>.json`, exact and immediate.
- Optional markdown projection at `<rootUri>/index/<namespace>/<key>.md` for semantic `search` (skipped when `index: false`, and any stale projection is removed).
- `search`: with a `query`, dispatches semantic `find` scoped to the index prefix then re-reads each hit's data record (`semanticSearch`); without a query, lists+filters+sorts all items under the namespace prefix by `updatedAt` (`listItems`).
- `listNamespaces`: derives the distinct namespace set from data URIs under a prefix.
- `batch`: the single entry point LangGraph actually calls — dispatches each `Operation` to the typed method above (this is what makes the class usable as a real `BaseStore`).

## Public API / entry points

`class OpenVikingStore`, `class Item`, `class SearchItem`.

## Key files

[src/store.ts](../../src/store.ts)

## Dependencies

`@langchain/langgraph`'s `BaseStore`; [client.ts](client.md) (`callOpenviking`, `ensureClient`, `itemValue`, `iterResultItems`).

## Gotcha

`rootUri` must stay bare (`viking://user/memories`) — the server treats that exact literal as a per-user alias token it rewrites to `viking://user/{user_id}/memories`; any extra path segment breaks the exact-match and falls through to one unscoped path shared by every caller. Put app-specific distinctions in the `namespace` array instead.

## Flows it participates in

- [Store put/get/search](../flows/store-put-get-search.md)
- [Full agent with store and tools](../flows/full-agent-with-store-and-tools.md)

Related concepts: [Identity and scoping](../concepts/identity-and-scoping.md)
