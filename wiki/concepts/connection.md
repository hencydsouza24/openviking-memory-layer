---
title: Connection settings
description: The shared OpenVikingConnection shape every adapter constructor accepts.
tags:
  - wiki
  - concept
---
## Definition

`OpenVikingConnection` is the shared settings object every adapter constructor accepts: `client`, `url`, `apiKey`, `account`, `user`/`userId`, `actorPeerId`, `path`, `timeout`, `extraHeaders`, `autoInitialize`.

## Why it matters

One shape means one `ensureClient()` resolution path for every adapter: pass a ready `client` and it's reused (initializing it once if needed), or pass settings and a `SyncHTTPClient` is built lazily. This is what lets an app share a single client across `OpenVikingStore`, `createOpenvikingTools`, `OpenVikingChatMessageHistory`, etc. without repeating connection logic per adapter.

## Where it lives in code

`interface OpenVikingConnection` and `ensureClient()` in [client.ts](../../src/client.ts); every adapter constructor (store, retrievers, tools, history, context, middleware) destructures the same fields into its own `connection` object.

## Related

[Identity and scoping](identity-and-scoping.md), [SyncHTTPClient module](../modules/http_client.md), [Client kernel module](../modules/client.md)
