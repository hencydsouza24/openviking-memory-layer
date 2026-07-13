---
title: OpenVikingChatMessageHistory
description: LangChain BaseListChatMessageHistory persisted in an OpenViking session.
tags:
  - wiki
  - module
---
## Purpose

Drop-in history backend for `RunnableWithMessageHistory`.

## Responsibilities

- `getMessages()`: reads `get_session_context`, restores `BaseMessage[]` via `restoreOpenvikingMessages` (pairs `AIMessage.tool_calls` with matching `ToolMessage`s by `tool_id`, dropping orphaned in-flight tool calls).
- `addMessages()`: converts each LangChain message via `langchainMessageToOpenviking`, injects any pending context parts (from `contextPartsProvider`) onto the next assistant message, batches via `batch_add_messages`, then applies the configured `commitPolicy`.
- System messages are never persisted (`persistSystemMessages = false` — runtime policy, not conversation memory).
- `clear()`: deletes and recreates the session.

## Public API / entry points

`class OpenVikingChatMessageHistory`, `langchainMessageToOpenviking`, `openvikingMessageToLangchain`, `contextPartsFromDocuments`.

## Key files

[src/history.ts](../../src/history.ts)

## Dependencies

`@langchain/core` messages/chat_history; [client.ts](client.md).

## Flows it participates in

[Context injection and history](../flows/context-injection-and-history.md)

Related concepts: [Commit policy](../concepts/commit-policy.md)
