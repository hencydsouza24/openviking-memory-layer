---
title: OpenVikingContextMiddleware
description: LangGraph agent middleware — recall before the model call, capture after the agent.
tags:
  - wiki
  - module
---
## Purpose

The LangGraph-node analog of `withOpenvikingContext`, driven explicitly from inside a graph node rather than wrapping a `Runnable`.

## Responsibilities

- `wrapModelCall(request, handler)`: assembles context for the latest user turn via an internal `OpenVikingSessionContextAssembler`, merges it into `request.systemMessage`, calls `handler`. Queues recall-derived context parts keyed by `(sessionId, peerId)` for the next capture pass.
- `afterAgent(state, runtime)`: diffs the current message-signature list against the previously captured one (`messageSignature` / `signaturesEqual`) to persist only genuinely new messages — skips messages that already contain the `<openviking_context>` marker (never re-persists injected context as if it were a user turn) — then applies the commit policy if anything was added.
- `resolveSessionId` / `resolvePeerId`: check an explicit resolver first, then `state.thread_id` / `state.session_id` / `runtime.context` / `runtime.config.configurable`; throws `SESSION_ID_ERROR` if nothing resolves.

## Public API / entry points

`class OpenVikingContextMiddleware`, `type ModelRequestLike`.

## Key files

[src/middleware.ts](../../src/middleware.ts)

## Dependencies

[context.ts](context.md) (`OpenVikingSessionContextAssembler`, `OPENVIKING_CONTEXT_MARKER`), [history.ts](history.md) (`langchainMessageToOpenviking`), [retrievers.ts](retrievers.md), [client.ts](client.md).

## Flows it participates in

[Context injection and history](../flows/context-injection-and-history.md)

Related guide: [Wiring a LangGraph agent](../guides/wiring-a-langgraph-agent.md)
