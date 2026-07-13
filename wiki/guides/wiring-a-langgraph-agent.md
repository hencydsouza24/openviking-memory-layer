---
title: Wiring a LangGraph agent
description: "Two patterns for giving a LangGraph agent OpenViking memory: store+tools, or the context middleware."
tags:
  - wiki
  - guide
---
## Goal

Give a LangGraph `StateGraph`/`createAgent` durable OpenViking-backed memory, using either pattern this package supports.

## Steps

**Pattern A — explicit recall node + store (see `examples/langgraph/agent/quick_app.ts`):**

1. Build a client (`InMemoryOpenVikingClient` for tests, `SyncHTTPClient` for real use).
2. `const store = new OpenVikingStore({ client })`; optionally `createOpenvikingTools({ client, profile: 'retrieval' })` for a `find` tool a graph node can call directly.
3. Add a `recall` node that calls the tool and/or `store.search(...)`, stashing the result in state (e.g. an `openviking_context` state field); wire it before your `answer`/model node.

**Pattern B — `OpenVikingContextMiddleware` (see `examples/langgraph/middleware/quick_app.ts`):**

1. `const middleware = new OpenVikingContextMiddleware({ client, targetUri, sessionIdResolver: () => sessionId, includeActiveMessages: true })`.
2. Inside your model node, build a `ModelRequestLike` (state, runtime, messages, systemMessage, `override()`), call `await middleware.wrapModelCall(request, handler)` where `handler` is your actual model invocation.
3. After the node runs, call `await middleware.afterAgent({ messages: [...priorMessages, response] }, runtime)` to persist the new turn and apply any commit policy.
4. Ensure `runtime.config.configurable.thread_id` (or your custom `sessionIdResolver`) resolves to a stable session id — required, or `wrapModelCall`/`afterAgent` throw `SESSION_ID_ERROR`.

## Gotchas

- Pattern A gives you full control over when/how recall happens (a separate graph node) but you own state threading (`openviking_context` field) yourself.
- Pattern B centralizes recall+capture in the middleware but requires every model node that uses it to build a `ModelRequestLike` and call both `wrapModelCall` and `afterAgent` — skipping `afterAgent` means turns are never captured.
- Both patterns can share the same underlying client with an `OpenVikingStore` for cross-thread long-term memory (see [Full agent with store and tools](../flows/full-agent-with-store-and-tools.md)) — the middleware/context pattern and the store are independent and composable.
