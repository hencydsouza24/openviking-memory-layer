---
title: Identity and scoping
description: How account/user/actorPeerId map to headers, and why the SDK re-checks scope client-side.
tags:
  - wiki
  - concept
---
## Definition

Three identity fields on every connection map to three headers on `SyncHTTPClient`: `account` → `X-OpenViking-Account`, `user`/`userId` → `X-OpenViking-User`, `actorPeerId` → `X-OpenViking-Actor-Peer` (per-agent scope tag). Identity headers require the server to run in **trusted mode**.

## Why it matters

Two isolation models are supported:

- **Per-user (default).** `viking://user/memories` is a literal alias token the server exact-matches and rewrites to `viking://user/{user_id}/memories` per request identity — a different `userId` reading the same namespace returns `null`, with no extra wiring.
- **Cross-account subject-keyed sharing.** To make memory follow one subject everywhere (e.g. a diner across restaurants), keep `account` constant and key by the subject via `userId`; encode any extra context (branch, restaurant) into the `namespace` array passed to `get`/`put`/`search`, not into `rootUri`.

**Defense in depth:** [OpenVikingRetriever](../modules/retrievers.md) additionally re-verifies every result's URI prefix client-side (`resolveAllowedScopePrefixes` / `isUnderAllowedPrefix`) before turning it into a `Document`, because server-side `PathScope` enforcement has been observed to leak cross-user results at the compiled native index-engine layer even though every Python layer above it builds the correct restriction. This is a backstop, not the primary control — don't rely on it in place of correct server-side scoping.

## Where it lives in code

`headers()` in [http_client.ts](../../src/http_client.ts); `resolveAllowedScopePrefixes()` in [retrievers.ts](../../src/retrievers.ts); the `rootUri` alias-token gotcha documented on the [store module page](../modules/store.md).

## Related

[Connection settings](connection.md), [OpenVikingRetriever module](../modules/retrievers.md), [OpenVikingStore module](../modules/store.md)

**Upstream watch:** OpenViking v0.4.x (this deployment runs v0.3.24) introduces a User/Peer model that reassigns roughly what `userId` vs `actorPeerId` mean here — see the provisional research note [OpenViking 0.4.x User/Peer model vs. this repo's current identity model](../../research/openviking-0.4-user-peer-model-vs-current-implementation.md). Not scheduled; tracked for whenever the server version changes.
