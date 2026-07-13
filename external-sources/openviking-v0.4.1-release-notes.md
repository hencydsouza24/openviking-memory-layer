---
type: source
title: OpenViking v0.4.1 Release Notes
description: GitHub release notes for OpenViking v0.4.1 — "Context Enters the User / Peer Era", full diff v0.3.24...v0.4.1.
source_url: https://github.com/volcengine/OpenViking/releases/tag/v0.4.1
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

https://github.com/volcengine/OpenViking/releases/tag/v0.4.1

Full compare: https://github.com/volcengine/OpenViking/compare/v0.3.24...v0.4.1

## Highlights

Title: "OpenViking v0.4.1 Release Notes: Context Enters the User / Peer Era"

**Breaking changes (verbatim, translated from the release's Chinese section):**

- v0.4.1 keeps legacy *read* compatibility, but new writes and new application code should move to the new `user` namespace.
- `viking://agent/...` can still be read for old data, but is no longer a target for new writes.
- New memory / resource / session / skill data should go into `viking://user/...`.
- `agent_id` is only a legacy transition config; it maps to the request-level `actor_peer_id`.
- Do not configure both `agent_id` and `actor_peer_id` at once — the server rejects that combination.
- Under a legacy `agent_id` client, do not explicitly pass a message-level `peer_id`.
- Old `role_id` memory isolation is no longer supported; use the User / Peer model to express isolation boundaries after upgrading.

**English-section example ("User / Peer: Separate Data Ownership From Interaction"):**

`support-bot` is the OpenViking data owner (the **user**). Alice and Bob are the people it serves (**peers**). The platform only manages the `support-bot` API key; each customer's long-term context is isolated by a stable `peer_id`.

```python
import openviking as ov

client = ov.SyncHTTPClient(
    url="http://localhost:1933",
    api_key="<support-bot-user-key>",
)
client.initialize()

session = client.create_session(
    memory_policy={
        "se...  # (truncated in source capture)
    }
)
```

Points to the migration/blog post for full background: https://blog.openviking.ai/post/openviking-user-peer-model/

## My notes

GitHub's rendered release page partially failed to load on direct fetch (returned an "Uh oh" error banner in one preview window), but the indexed page content did contain the substantive release-notes sections quoted above, retrieved via full-text search over the fetched page. Bilingual release notes (Chinese primary, English section titled "User / Peer: Separate Data Ownership From Interaction"). No PDF/binary asset was involved, so this was captured as a text clip rather than via a binary `ingest`.
