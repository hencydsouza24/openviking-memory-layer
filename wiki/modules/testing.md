---
title: InMemoryOpenVikingClient
description: Deterministic in-memory OpenViking-compatible client for examples and CI.
tags:
  - wiki
  - module
---
## Purpose

A same-process stand-in for a real OpenViking server so every example and test runs with no network dependency.

## Responsibilities

- Store `records` (URI → text), `sessions` (id → message list), `archives`, `pendingTokens` in plain objects.
- Implement deterministic token-match retrieval (`_search`): tokenizes the query, scores each record by overlapping tokens, buckets hits into memories/resources/skills by URI shape (`/skills/`, `/memories/`, else resource).
- Implement filesystem-shaped ops matching `SyncHTTPClient`'s surface: `read` / `abstract` / `overview` / `write` / `rm` / `ls` / `glob` / `grep` (glob via a hand-rolled fnmatch-to-regex translator, `globToRegExp`).
- Implement the session lifecycle: `create_session` → `add_message` / `batch_add_messages` (accumulates `pendingTokens` via `estimateTextTokens`) → `commit_session` (moves session messages into an archive, clears pending state, writes `.abstract.md` / `.overview.md` / `.done` marker records) → `get_session_context` / `get_session_archive`.

## Public API / entry points

`class InMemoryOpenVikingClient`, `FileNotFoundError`, `FileExistsError`.

## Key files

[src/testing.ts](../../src/testing.ts)

## Dependencies

[client.ts](client.md) — `estimateTextTokens`, `normalizePeerId`.

## Flows it participates in

[Session commit and archival](../flows/session-commit-and-archival.md); backs every example under `examples/` and every test under `test/`.

Related guide: [Testing without a server](../guides/testing-without-a-server.md)
