---
type: research-note
title: OpenViking 0.4.x User/Peer model vs. this repo's current identity model
description: Provisional comparison of OpenViking v0.3.24 (current) vs v0.4.1's User/Peer model, and whether this package needs changes.
status: provisional
sources:
  - external-sources/openviking-v0.4.1-release-notes.md
  - external-sources/openviking-0.4.0-migration-guide.md
  - external-sources/openviking-user-peer-model-blog.md
created: 2026-07-14
tags:
  - research
  - provisional
  - openviking
  - migration
---
## Question

The OpenViking server this package's [SyncHTTPClient](../src/http_client.ts) talks to is currently on v0.3.24. Upstream has since shipped v0.4.1, which introduces a "User/Peer model." Does this package need changes if the server is upgraded, and is it worth doing now?

## Sources cited

- [OpenViking v0.4.1 Release Notes](../external-sources/openviking-v0.4.1-release-notes.md)
- [OpenViking 0.3.x to 0.4.0 Upgrade Guide](../external-sources/openviking-0.4.0-migration-guide.md)
- [OpenViking User / Peer blog post](../external-sources/openviking-user-peer-model-blog.md)
- This repo's own source: [client.ts](../src/client.ts), [store.ts](../src/store.ts), [retrievers.ts](../src/retrievers.ts), [README.md](../README.md)

## Findings

### What 0.4.0 actually changes (per the migration guide)

Upstream introduces four nested concepts (per the [migration guide](../external-sources/openviking-0.4.0-migration-guide.md)): **User** (natural person or business user), **Peer** (interaction identity under a User), **Session** (conversation state under a User), **Skill** (executable skill under a User). The URI layout moves from flat `viking://agent/<agent_id>/...` and `viking://session/<session_id>/...` to nested `viking://user/<user_id>/peers/<peer_id>/...` and `viking://user/<user_id>/sessions/<session_id>/...`.

Critically, **0.3.x behavior is preserved indefinitely if you don't upgrade** — the guide states existing `agent_id`, `viking://agent/...`, and `viking://session/...` usage is unaffected on 0.3.x. Even after upgrading to 0.4.0, legacy reads keep working (old `agent_id` config maps automatically to the new `actor_peer_id`; `viking://agent/...` and `viking://session/...` stay readable). Only *writes* to the old paths, message-level `peer_id`, and `role_id`-based isolation stop working post-upgrade — see the full compatibility table in the [migration guide](../external-sources/openviking-0.4.0-migration-guide.md).

### The rationale (per the blog post)

The [blog post](../external-sources/openviking-user-peer-model-blog.md) reframes "user" as a **service-layer data subject** — not necessarily whoever is currently talking. It can be a person, an agent, a bot service, a support desk, or a fixed integration instance. "Peers" are interaction objects living inside that user's data boundary. The release notes' worked example: `support-bot` is the **user** (one API key, one data owner); Alice and Bob (real customers) are **peers**, isolated by a stable `peer_id`.

### This repo's current model, compared

This package's [OpenVikingConnection](../src/client.ts) exposes `account`, `user`/`userId`, and `actorPeerId`. The [README](../README.md)'s documented pattern for "memory follows one subject everywhere" (e.g. a diner across restaurants) is:

- `account` — held constant, one tenant/app
- `userId` — **the actual customer/subject** (e.g. `dinerId`) — the primary isolation key
- `actorPeerId` — explicitly *not* the customer key; README says to carry branch/sub-agent context here instead, layered under `userId`

This is close to an **inversion** of the 0.4.x canonical shape:

| Role | This repo (0.3.x-era usage) | Upstream 0.4.x canonical pattern |
|---|---|---|
| The one stable data-owning identity (one API key) | `account` (+ `userId` as the real isolation key) | `user` (e.g. `support-bot`) |
| The per-customer/per-interaction identity | `userId` (e.g. `dinerId`) | `actor_peer_id` / `peer_id` (e.g. `alice`, `bob`) |
| Secondary tag (branch, sub-agent) | `actorPeerId` | not modeled explicitly in the sources reviewed |

Notably, this repo's `actorPeerId` → `X-OpenViking-Actor-Peer` header ([http_client.ts](../src/http_client.ts)) is already wire-identical in name to the new protocol's `actor_peer_id` field — but this repo currently uses it for a different purpose (a secondary context tag) than the role it plays in the upstream 0.4.x pattern (the primary per-customer key).

### An unresolved wrinkle in this repo's own server behavior

[OpenVikingStore](../src/store.ts)'s default `rootUri` is the literal string `viking://user/memories`, which its own code comment says the server exact-matches and rewrites to `viking://user/{user_id}/memories` per request identity. This is already a `viking://user/...`-shaped path, not the old public `viking://agent/...` scheme the migration guide describes for 0.3.x. That suggests the actual deployed server (whatever product/fork this account points at) may not be a verbatim match to the public OpenViking OSS repo's documented 0.3.x URI layout — flagged as an open question below rather than assumed.

### Would this package need code changes?

Minimal, and only if/when the server is actually upgraded:

- The SDK is a thin pass-through — `account`/`userId`/`actorPeerId` forward as opaque header values ([http_client.ts](../src/http_client.ts) `headers()`); nothing here hardcodes the old `viking://agent/...`/`viking://session/...` URI scheme except `OpenVikingStore`'s one `rootUri` default.
- That one default and its alias-rewrite assumption would need re-validation against whatever the upgraded server actually does with that literal string post-upgrade.
- The bigger question is conceptual, not mechanical: whether `userId` should keep meaning "customer" (current repo convention) or shift to meaning "peer" (upstream's new canonical shape) — a design decision, not a find-and-replace.

## Open questions

- Which exact server product/version is actually deployed behind this package's `SyncHTTPClient` — the public OSS OpenViking, or an internal/adapted variant? The `viking://user/memories` alias-rewrite behavior doesn't verbatim match either the old (`viking://agent/...`) or new (`viking://user/<uid>/peers/<pid>/...`) scheme described in the public docs.
- The migration guide shows one example client-config snippet with both `actor_peer_id` and `agent_id` set together (`{"actor_peer_id": "customer-a", "agent_id": "legacy-agent"}`), which appears to contradict its own stated rule that configuring both is rejected. Unclear whether that rule is scoped to client-level config only, vs. some other combination being legitimate — not fully disambiguated by the fetched content.
- The blog post's introductory framing was captured; its likely follow-on implementation patterns/examples (past the definitional section) were not retrieved in this pass.
- If/when the server upgrades, whether `userId` should conceptually become this repo's "peer" dimension is an open design call, not resolved here.

## Decision (as of 2026-07-14)

Server version is upgradable at will (no external blocker) but **deferred deliberately**: repo currently has known small bugs that take priority over a speculative model migration with no forcing function (0.3.x stays fully supported). Revisit only if/when the upgrade is actually scheduled, and treat the `userId`-vs-`actor_peer_id` role question as a design conversation before touching code.
