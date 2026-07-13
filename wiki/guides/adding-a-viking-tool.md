---
title: Adding a new viking_* tool
description: Extending buildAllTools without touching the profile or type system by hand.
tags:
  - wiki
  - guide
---
## Goal

Add a new `viking_*` tool to [`createOpenvikingTools`](../modules/tools.md) with minimal ripple.

## Steps

1. Add a new `tool(...)` definition inside `buildAllTools()` in [tools.ts](../../src/tools.ts), following the existing pattern: a zod `schema`, a `name` (prefixed `viking_`), and a handler that calls `callOpenviking(await getClient(), '<protocol_method>', { ...args })`.
2. Add it to the object literal `buildAllTools` returns. `type OpenvikingToolName` is `keyof ReturnType<typeof buildAllTools>` — it updates automatically; no separate type edit needed.
3. Decide which profile(s) should include it by editing `profileToolNames()` — add it to `retrieval` if read-only, or to the `agent`/`admin` branches if it writes or is destructive.
4. If the tool is destructive, gate it the way `viking_forget` is: excluded from `agent` and `retrieval`, included only in `admin` or via explicit `allowForget`.

## Gotchas

- Tool *names* are `viking_*` snake_case by convention (matching OpenViking's own plugin/MCP surface); tool *schema fields* are camelCase per JS convention (`targetUri`, not `target_uri`) — keep that split consistent with the rest of the file.
- `toolNamePrefix` (on `createOpenvikingTools`) only renames the tool the model sees; it doesn't change dispatch, so a new tool automatically supports it for free as long as it goes through the shared `allTools` map.
