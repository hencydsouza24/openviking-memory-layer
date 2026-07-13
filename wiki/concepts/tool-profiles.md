---
title: Tool profiles
description: The retrieval / agent / admin presets for createOpenvikingTools.
tags:
  - wiki
  - concept
---
## Definition

`createOpenvikingTools({ profile })` selects which `viking_*` tools are returned, from three presets:

| Profile | Tools |
|---|---|
| `retrieval` | read-only: `viking_find`, `viking_search`, `viking_browse`, `viking_read`, `viking_grep`, `viking_archive_search`, `viking_archive_expand`, `viking_health` |
| `agent` (default) | retrieval + `viking_store`, `viking_add_resource`, `viking_add_skill` |
| `admin` | agent + `viking_forget` (destructive delete) |

`allowForget: true` adds `viking_forget` to any profile; an explicit `toolNames` list overrides `profile` entirely.

## Why it matters

Separates read-only agents (safe to expose broadly) from write-capable and destructive-capable ones, without hand-picking tool lists in most cases.

## Where it lives in code

`profileToolNames()` and `OPENVIKING_PROFILES` in [tools.ts](../../src/tools.ts).

## Related

[tools module](../modules/tools.md), [Full agent with store and tools flow](../flows/full-agent-with-store-and-tools.md)
