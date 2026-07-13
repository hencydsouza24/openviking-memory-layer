---
title: Commit policy
description: Governs when a session's pending messages get committed into long-term memory.
tags:
  - wiki
  - concept
---
## Definition

`OpenVikingCommitPolicy` has a `mode` (`never` default / `always` / `pending_tokens`) and a `pendingTokenThreshold` (default 8000), normalized by `commitPolicy()` and executed by `applyCommitPolicy()`.

## Why it matters

Committing triggers the server's async memory-extraction pipeline — committing too eagerly wastes extraction work on incomplete turns; too rarely delays when new context becomes searchable. `pending_tokens` mode lets callers commit only once a session has accumulated enough content to be worth extracting, checked via `get_session`'s reported `pending_tokens`.

## Where it lives in code

`commitPolicy()` / `applyCommitPolicy()` in [client.ts](../../src/client.ts); consumed by [history.ts](../../src/history.ts) (`addMessages`), [context.ts](../../src/context.ts) (indirectly, via history), and [middleware.ts](../../src/middleware.ts) (`afterAgent`).

## Related

[Session commit and archival flow](../flows/session-commit-and-archival.md)
