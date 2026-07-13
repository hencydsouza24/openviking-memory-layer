---
type: source
title: OpenViking 0.3.x to 0.4.0 Upgrade Guide
description: Official migration doc for the User/Peer model, from the OpenViking v0.4.1 tag.
source_url: https://raw.githubusercontent.com/volcengine/OpenViking/refs/tags/v0.4.1/docs/en/migration/01-user-peer-model.md
date_fetched: 2026-07-14
preservation: text-extracted
tags:
  - source
  - immutable
  - layer-ingest
  - text
  - openviking
---
## Source

https://raw.githubusercontent.com/volcengine/OpenViking/refs/tags/v0.4.1/docs/en/migration/01-user-peer-model.md

## Highlights

**Scope:** "This guide is for users already running OpenViking 0.3.x. It explains what to do before and after upgrading to 0.4.0, which legacy usage remains compatible, how to migrate data, and how to move application code to the new model."

**Upgrade decision:** staying on 0.3.x leaves existing `agent_id`, `viking://agent/...`, and `viking://session/...` behavior unchanged — but the 0.4.0 model and tools are unavailable.

**New concept vocabulary:**

```text
User = natural person or business user
Peer = interaction identity under a User
Session = conversation state under a User
Skill = executable skill under a User
```

**New namespace layout:**

```text
/local/<account>/user/<user>/peers
/local/<account>/user/<user>/sessions
/local/<account>/user/<user>/skills
```

**Legacy data → new location mapping:**

| Legacy data | New location |
|---|---|
| `viking://agent/<agent_id>/memories/...` | `viking://user/<user_id>/peers/<agent_id>/memories/...` |
| `viking://agent/<agent_id>/resources/...` | `viking://user/<user_id>/peers/<agent_id>/resources/...` |
| `viking://agent/<agent_id>/skills/<skill>/...` | `viking://user/<user_id>/skills/<skill>/...` |
| `viking://session/<session_id>/...` | `viking://user/<user_id>/sessions/<session_id>/...` |

Example old vs new paths:

```text
viking://agent/code-agent/memories/profile.md
viking://session/sess-001/messages.jsonl
```
→

```text
viking://user/alice/peers/code-agent/memories/profile.md
viking://user/alice/sessions/sess-001/messages.jsonl
```

**Legacy-usage → 0.4.0-behavior compatibility table (verbatim):**

| Legacy usage | 0.4.0 behavior |
|---|---|
| Client config `agent_id` | Supported. It maps to request-level `actor_peer_id` and marks the request as legacy agent mode. |
| `ov ls viking://agent` | Supported for reads. If `agent_id` / `actor_peer_id` is set, only the current actor peer's legacy agent is shown. |
| Read `viking://agent/<agent_id>/...` | Supported for old data. |
| Write `viking://agent/...` | Not supported. New writes should go to `viking://user/<user_id>/peers/<peer_id>/...`. |
| `ov ls viking://session` | Supported for reads. It merges new and old sessions. |
| Read `viking://session/<session_id>/...` | Supported. New path first, legacy path as fallback. |
| Write `viking://session/...` | Not supported. New sessions are written to `viking://user/<user_id>/sessions/...`. |
| `find` / `search` with `agent_id` | Supported. It searches both new peer data and old agent data. |
| `find` / `search` body `peer_id` | Not supported. Use `actor_peer_id` or `X-OpenViking-Actor-Peer` for the new peer view. |
| Configure both `actor_peer_id` and `agent_id` | Not supported. The client/request fails. |
| Explicit message `peer_id` while using legacy `agent_id` client | Not supported. The request fails. |
| `role_id` memory isolation | Not supported. It is ignored after upgrade. |

**Migration procedure (outline):**

```text
Back up
  -> Upgrade server / CLI / SDK
  -> Verify old data is still readable
  -> Run data migration
  -> Verify new paths
  -> Gradually update application usage
  -> Optionally run cleanup
```

Upgrade command shown:

```bash
pip install openviking==0.4.0 --upgrade --force-reinstall
openviking-server --config ov.conf
```

Data migration commands shown:

```bash
ov --sudo admin migrate --output json
```

```http
POST /api/v1/admin/migrate
X-API-Key: <root-key>
```

Key regeneration command also shown: `ov --sudo admin regenerate-key <account_id> <user_id>`.

Legacy client config example shown as `{ "agent_id": "legacy-agent" }` mapping to `{ "actor_peer_id": "legacy-agent" }` (and combined example `{ "actor_peer_id": "customer-a", "agent_id": "legacy-agent" }` appears in one snippet, illustrating the per-request shape during transition — note this contradicts the "don't configure both" rule elsewhere in the same doc for the *client config* case specifically; the exact scope of that restriction (client-level config vs. one-off request field) wasn't fully disambiguated by this fetch).

Read-scope note: `viking://agent/<agent_id>/instructions` appears as a legacy read path example.

## My notes

Fetched via context-mode's fetch-and-index (raw.githubusercontent.com host), 117 indexed sections, 12.3KB total. This is the primary source for the compatibility guarantees and path-mapping claims used in the research note.
