---
title: OpenVikingSessionContextAssembler / withOpenvikingContext
description: Assemble session + recall context into one system-message block, and a one-call LangChain wrapper around it.
tags:
  - wiki
  - module
---
## Purpose

The building block behind both the middleware and the standalone LangChain wrapper.

## Responsibilities

- `OpenVikingSessionContextAssembler.assemble()`: ensures the session exists, reads `get_session_context` (archive overview + pre-archive abstracts + active messages), runs a session-scoped `search` via an internal `OpenVikingRetriever` clone, and formats everything into one `<openviking_context>...</openviking_context>` block (`formatContextBlock`).
- `withOpenvikingContext()`: wraps any `Runnable` — injects the assembled block as/into a `SystemMessage` before each call (`inject`), and wires `RunnableWithMessageHistory` with an `OpenVikingChatMessageHistory` per session so history persists automatically. Recall-derived context parts are queued (`pendingContextParts`) and attached to the next assistant message via the history's `contextPartsProvider`.
- Resolves `sessionId`/`peerId` from explicit params or `config.configurable` (`sessionIdFromConfig` / `peerIdFromConfig`), and injects a fixed `sessionId` into config automatically so callers can invoke with no config when the session is static.

## Public API / entry points

`class OpenVikingSessionContextAssembler`, `withOpenvikingContext`, `OPENVIKING_CONTEXT_MARKER`.

## Key files

[src/context.ts](../../src/context.ts)

## Dependencies

[retrievers.ts](retrievers.md), [history.ts](history.md), [client.ts](client.md); `@langchain/core` runnables/messages.

## Flows it participates in

[Context injection and history](../flows/context-injection-and-history.md)

[middleware.ts](middleware.md) reuses this assembler for the LangGraph-node variant.
