---
title: SyncHTTPClient
description: REST client implementing the full OpenViking protocol over fetch.
tags:
  - wiki
  - module
---
## Purpose

The production `OpenVikingClientLike` implementation — talks to a real OpenViking server over HTTP.

## Responsibilities

- Build identity headers per request: `X-API-Key`, `X-OpenViking-Account`, `X-OpenViking-User`, `X-OpenViking-Actor-Peer` (`headers()`).
- Implement every protocol method the adapters dispatch through `callOpenviking`: search/find, content read/abstract/overview, sessions (create / add_message / batch_add_messages / get / get_context / get_archive / commit / get_task / delete), resources, filesystem ops (`write` / `glob` / `ls` / `rm` / `grep`) that `OpenVikingStore` needs, skills, health.
- Unwrap the `{status, result, error}` REST envelope and raise on HTTP error or `status === 'error'` (`request()`).
- Apply a per-request `AbortController` timeout (default 60s).

## Public API / entry points

`class SyncHTTPClient` — constructor reads `OPENVIKING_URL` / `OPENVIKING_API_KEY` / `OPENVIKING_USER_ID` env vars as fallbacks when not passed explicitly.

## Key files

[src/http_client.ts](../../src/http_client.ts)

## Dependencies

[client.ts](client.md) — only the `OpenVikingPart` type.

## Flows it participates in

- [Full agent with store and tools](../flows/full-agent-with-store-and-tools.md)
- [Session commit and archival](../flows/session-commit-and-archival.md)

Related concepts: [Connection settings](../concepts/connection.md), [Identity and scoping](../concepts/identity-and-scoping.md)
