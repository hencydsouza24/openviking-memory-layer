---
type: source
title: "OpenViking User / Peer: Separating Data Owners From Interaction Objects"
description: OpenViking blog post explaining the rationale behind the User/Peer model.
source_url: https://blog.openviking.ai/post/openviking-user-peer-model/
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

https://blog.openviking.ai/post/openviking-user-peer-model/

## Highlights

Opening framing: "Long-term context systems first need to answer a simple ownership question: which OpenViking user owns this data space, and which object is merely interacting with it right now?"

"In single-user use, the answer feels obvious. Alice uses an assistant, so Alice is the data owner. Memories, resources, skills, and sessions all revolve around Alice."

"Real agent applications are less tidy. A support bot may serve many customers. A bot service may talk with many group members. An IDE plugin may represent one fixed tool instance while interacting with different people, projects, and runtime agents every day."

"That is why OpenViking should not treat every current speaker as an OpenViking user. In OpenViking, a user is a service-layer data subject. It may be a natural person, or it may be an agent, bot service, support desk, or fixed integration instance."

"The user owns the data space. Peers are interaction objects inside that user boundary." (Captioned figure: "User as the data subject, with memories, resources, sessions, and several peers around it.")

## My notes

Only the introductory framing section was captured in this fetch (13 indexed sections, 9.3KB) — the post likely continues with implementation patterns and examples past what was indexed/retrieved here. The core reusable claim from this source is the definitional one: **user = service-layer data subject** (not necessarily a human, not necessarily "whoever is talking"), **peer = interaction object inside that user's boundary**. This is the conceptual justification behind the release notes' `support-bot` (user) / Alice,Bob (peers) example.
