# @grubgenie/openviking-memory-layer

OpenViking memory adapters for [LangChain.js](https://js.langchain.com) and
[LangGraph.js](https://langchain-ai.github.io/langgraphjs/). A faithful
TypeScript port of the Python `openviking.integrations.langchain` package:
retriever, store, agent tools, chat history, and context middleware over an
OpenViking backend.

## Install

```bash
npm install @grubgenie/openviking-memory-layer @langchain/core zod
```

`@langchain/core` and `zod` are **peer dependencies** — you provide them.
`@langchain/langgraph` is an **optional peer** — required only if you use
`OpenVikingStore` (it extends LangGraph's `BaseStore`) or the LangGraph
examples. Add `@langchain/openai` for the live LLM app.

## Exports

| Export | What it is |
|--------|-----------|
| `InMemoryOpenVikingClient` | Deterministic in-memory client for tests/examples |
| `SyncHTTPClient` | REST client for a running OpenViking server (full protocol: sessions, search, content/fs `write`/`glob`/`ls`/`rm`/`grep`, skills) |
| `OpenVikingRetriever` | LangChain `BaseRetriever` over OpenViking recall |
| `OpenVikingStore` | LangGraph `BaseStore` — durable long-term memory for `createAgent({ store })` |
| `createOpenvikingTools` | `viking_*` agent tools (zod schemas), by profile |
| `OpenVikingChatMessageHistory` | Chat history persisted in an OpenViking session |
| `withOpenvikingContext` | Wrap any runnable with context injection + history |
| `OpenVikingContextMiddleware` | Recall-before / capture-after for LangGraph nodes |
| `OpenVikingSessionContextAssembler` | Lower-level context block assembler |
| helpers | `extractMessageText`, `getLatestUserText`, `callOpenviking`, `ensureClient` |

Ships dual **ESM + CJS** with type declarations.

## Quick start

```ts
import {
  SyncHTTPClient,
  OpenVikingRetriever,
} from '@grubgenie/openviking-memory-layer';

const client = new SyncHTTPClient({ url: 'http://127.0.0.1:1933', apiKey: '...' });
await client.initialize();

const retriever = new OpenVikingRetriever({
  client,
  targetUri: 'viking://user/memories',
  limit: 4,
});

const docs = await retriever.invoke('user deployment color preference');
```

Swap `SyncHTTPClient` for `InMemoryOpenVikingClient` to run with no server (the
examples and tests do this).

### Agent tools

```ts
import { createOpenvikingTools } from '@grubgenie/openviking-memory-layer';

const tools = createOpenvikingTools({ client, profile: 'retrieval' });
// → viking_find, viking_search, viking_browse, viking_read, viking_grep,
//   viking_archive_search, viking_archive_expand, viking_health
```

Profiles: `retrieval` (read-only), `agent` (default, adds store/resource/skill),
`admin` (adds forget).

### LangGraph long-term store

`OpenVikingStore` is a real LangGraph `BaseStore`, so you can hand it to
`createAgent` as the durable cross-thread memory backend. It stores each entry
as a JSON record under `<rootUri>/data/<namespace>/<key>.json` (deterministic
`put` → `get`) plus a markdown projection under `<rootUri>/index/...` for
query-based semantic `search`. Pass connection settings and the store lazily
builds a `SyncHTTPClient`:

```ts
import { OpenVikingStore } from '@grubgenie/openviking-memory-layer';
import { createAgent } from 'langchain';

const store = new OpenVikingStore({
  url: 'http://127.0.0.1:1933',
  apiKey: '...',
  account: 'my-account',
  userId: 'user-123',
});

const agent = createAgent({ model, tools, store });
```

#### Per-user memory isolation

OpenViking keys the user space by **`user_id` only** — `viking://user/…` is a
server-side shorthand that expands to `viking://user/{user_id}/…` per request
identity. So the store's default `rootUri` (`viking://user/memories/langgraph_store`)
resolves to a **separate space per `userId`** with no extra wiring. Identity is
sent via the `X-OpenViking-Account` / `X-OpenViking-User` /
`X-OpenViking-Actor-Peer` headers (`actorPeerId`), and requires the server to run
in trusted mode.

To make memory **follow one subject everywhere** (e.g. a diner whose
preferences should persist across every restaurant/account), key it by that
subject and keep the account constant:

```ts
const store = new OpenVikingStore({
  url, apiKey,
  account: DINER_MEMORY_ACCOUNT,        // one constant account for all subjects
  userId:  dinerId,                     // stable, global per subject
  // carry restaurant/branch as `actorPeerId` or value metadata — NOT `account`
});
```

Because the user space is `user_id`-keyed, the same `userId` resolves to the
same memories regardless of which restaurant is serving the request. Use a
**single constant `account`** rather than a per-restaurant one: identity is
asserted as `(account, user)` and the vector layer applies tenant isolation, so
a constant account guarantees sharing is purely subject-keyed. Conversely, to
silo memory per subject **and** context, encode the context into `rootUri`
(e.g. `viking://user/memories/branches/${branchId}`).

### LangGraph context middleware

```ts
import { OpenVikingContextMiddleware } from '@grubgenie/openviking-memory-layer';

const middleware = new OpenVikingContextMiddleware({
  client,
  targetUri: 'viking://user/memories',
  includeActiveMessages: true,
});
// inside a graph node:
const response = await middleware.wrapModelCall(request, handler);
await middleware.afterAgent({ messages: [...current, response] }, runtime);
```

## Develop

```bash
npm install
npm run build       # tsup → dist/ (ESM + CJS + d.ts)
npm test            # vitest, runs every example end-to-end
npm run typecheck   # tsc --noEmit
```

### Run the examples (no server, no API key)

```bash
npm run example:langgraph-agent
npm run example:langgraph-middleware
npm run example:langchain-rag
npm run example:langchain-context-backend
npm run example:langchain-message-history
```

`examples/langgraph/agent/live_app.ts` (`npm run example:langgraph-agent-live`)
is the one example needing a running OpenViking server and an OpenAI-compatible
endpoint (`ARK_API_KEY`, optional `ARK_BASE_URL` / `ARK_MODEL`,
`OPENVIKING_URL`, `OPENVIKING_API_KEY`).

## Publish

```bash
npm publish --access public   # runs prepublishOnly → clean + build
```

Only `dist/` and `README.md` are packed (see `files`). The `@grubgenie` scope
requires that the npm org exists and you have publish rights.

## Parity notes

- Client methods keep snake_case protocol names (`create_session`,
  `add_message`, …) so `callOpenviking` maps 1:1 to the Python adapters; option
  objects use camelCase (`targetUri`, `scoreThreshold`). Message "parts" keep
  snake_case keys (`tool_id`, `tool_output`, …).
- The Python HTTP client's one-shot async recovery wrapper is collapsed: the JS
  `SyncHTTPClient` is request-scoped (`fetch`).
- `OpenVikingStore`'s canonicalized-URI fallback parser is a documented no-op —
  retrieval returns the literal URIs written, which always carry the root
  prefix.
