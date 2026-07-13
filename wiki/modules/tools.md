---
title: createOpenvikingTools
description: LangChain tool factory exposing viking_* primitives by profile.
tags:
  - wiki
  - module
---
## Purpose

Give a model callable `viking_*` tools over the same connection every other adapter uses.

## Responsibilities

- `buildAllTools()`: one module-level factory building all 12 tools (`viking_find`, `viking_search`, `viking_browse`, `viking_read`, `viking_grep`, `viking_store`, `viking_archive_search`, `viking_archive_expand`, `viking_add_resource`, `viking_add_skill`, `viking_health`, `viking_forget`) — the `OpenvikingToolName` union type is derived from this object's keys, so adding a tool here is the only change needed.
- `createOpenvikingTools()`: selects tools by `profile` (`retrieval` / `agent` default / `admin`) or an explicit `toolNames` override; optional `toolNamePrefix` renames tools without touching schema/logic; caches one lazily-built client shared across all returned tools.
- `viking_archive_search` layers two strategies: grep the session's own history first (`grepSessionHistory`), and only if that finds nothing, fall back to a token-filtered scan of `get_session_context` (`searchArchivePayload`).

## Public API / entry points

`createOpenvikingTools`, `type OpenvikingToolName`, `OPENVIKING_PROFILES`, `type OpenvikingProfile`.

## Key files

[src/tools.ts](../../src/tools.ts)

## Dependencies

`@langchain/core/tools`, `zod`; [client.ts](client.md).

## Flows it participates in

[Full agent with store and tools](../flows/full-agent-with-store-and-tools.md)

Related concepts: [Tool profiles](../concepts/tool-profiles.md)
Related guide: [Adding a new viking_* tool](../guides/adding-a-viking-tool.md)
