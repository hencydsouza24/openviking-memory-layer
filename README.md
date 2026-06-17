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
import { SyncHTTPClient, OpenVikingRetriever } from '@grubgenie/openviking-memory-layer';

const client = new SyncHTTPClient({ url: 'http://127.0.0.1:1933', apiKey: '...' });
await client.initialize();

const retriever = new OpenVikingRetriever({ client, targetUri: 'viking://user/memories', limit: 4 });
const docs = await retriever.invoke('user deployment color preference');
```

Swap `SyncHTTPClient` for `InMemoryOpenVikingClient` to run with no server (the
examples and tests do this).

## Connecting

Every adapter (`OpenVikingStore`, `OpenVikingRetriever`, `createOpenvikingTools`,
`OpenVikingChatMessageHistory`, `OpenVikingContextMiddleware`,
`OpenVikingSessionContextAssembler`, `withOpenvikingContext`) accepts the **same
connection settings**. Pass either a ready `client` or the settings to build one
lazily:

```ts
interface OpenVikingConnection {
  client?: OpenVikingClientLike;   // a SyncHTTPClient / InMemoryOpenVikingClient — wins if set
  url?: string;                    // else build a SyncHTTPClient from these:
  apiKey?: string;
  account?: string;                // → X-OpenViking-Account
  user?: string;                   // → X-OpenViking-User (alias of userId)
  userId?: string;                 // → X-OpenViking-User
  actorPeerId?: string;            // → X-OpenViking-Actor-Peer (per-agent scope)
  timeout?: number;                // seconds (default 60)
  extraHeaders?: Record<string, string>;
}
```

Identity headers require the server to run in **trusted mode**. Reuse one
`SyncHTTPClient` across adapters (pass `client`) to avoid spinning up several.

## Usage

### SyncHTTPClient — direct REST

Implements the full protocol the adapters use. Methods are snake_case (protocol
names); options are camelCased objects.

```ts
const client = new SyncHTTPClient({ url, apiKey, account: 'acct', userId: 'user-123' });
await client.initialize();

// content / filesystem
await client.write({ uri: 'viking://user/memories/notes/a.txt', content: 'azure', mode: 'create', wait: true });
const text   = await client.read({ uri: 'viking://user/memories/notes/a.txt' });
const hits   = await client.glob({ pattern: '*.txt', uri: 'viking://user/memories/notes' });
const dir    = await client.ls({ uri: 'viking://user/memories/notes' });
const greps  = await client.grep({ uri: 'viking://user/memories/notes/a.txt', pattern: 'azure', caseInsensitive: true });
await client.rm({ uri: 'viking://user/memories/notes/a.txt' });

// sessions (the memory-extraction pipeline)
const { session_id } = await client.create_session({});
await client.add_message({ sessionId: session_id, role: 'user', content: 'I love azure deployments' });
await client.add_message({ sessionId: session_id, role: 'assistant', content: 'Noted: azure.' });
const commit = await client.commit_session({ sessionId: session_id }); // extracts memories async
const task   = await client.get_task({ taskId: commit.task_id });      // poll extraction

// retrieval
const found  = await client.find({ query: 'deployment color', targetUri: 'viking://user/memories', limit: 5 });
const ctx    = await client.get_session_context({ sessionId: session_id, tokenBudget: 8000 });

// content depth: abstract < overview < read
const brief  = await client.abstract({ uri: 'viking://user/memories/notes/a.txt' });

const ok     = await client.is_healthy(); // get_status → /api/v1/observer/system
```

### OpenVikingRetriever

A LangChain `BaseRetriever`. `searchMode: 'find'` (stateless) or `'search'`
(session-aware); `contentMode` picks how much of each hit to materialize.

```ts
const retriever = new OpenVikingRetriever({
  client,
  targetUri: 'viking://user/memories',   // string or string[]
  searchMode: 'find',                     // 'find' | 'search'
  limit: 4,
  scoreThreshold: 0.1,
  contentMode: 'abstract',                // 'abstract' | 'overview' | 'read'
  filter: { category: 'preference' },     // optional metadata filter
});

const docs = await retriever.invoke('what deployment color does the user prefer?');
// docs: Document[] — pageContent = content at contentMode, metadata.openviking_uri = source URI
```

### createOpenvikingTools

Returns LangChain `DynamicStructuredTool[]` (zod schemas) for an agent. Tools are
selected by **profile** or an explicit `toolNames` list.

```ts
const tools = createOpenvikingTools({
  client,
  profile: 'agent',          // 'retrieval' | 'agent' | 'admin'
  // toolNames: ['viking_find', 'viking_store'],  // explicit override
  // allowForget: true,                            // add viking_forget to any profile
  // peerId: 'agent-1',                            // tag stored messages
});
```

All 12 tools: `viking_find`, `viking_search`, `viking_browse`, `viking_read`,
`viking_grep`, `viking_archive_search`, `viking_archive_expand`, `viking_store`,
`viking_add_resource`, `viking_add_skill`, `viking_health`, `viking_forget`.

| Profile | Tools |
|---------|-------|
| `retrieval` | read-only: find, search, browse, read, grep, archive_*, health |
| `agent` (default) | retrieval + `viking_store`, `viking_add_resource`, `viking_add_skill` |
| `admin` | agent + `viking_forget` |

Invoke a tool directly (the model normally does this):

```ts
const find = tools.find((t) => t.name === 'viking_find')!;
const result = await find.invoke({ query: 'azure', limit: 4 });
```

> `viking_add_skill` expects a skill document **with YAML frontmatter**
> (`---\nname: ...\n---\n...`), not plain text.

### OpenVikingStore — LangGraph long-term store

A real LangGraph `BaseStore`, so you can hand it to `createAgent` as the durable
cross-thread memory backend. Each entry is a JSON record at
`<rootUri>/data/<namespace>/<key>.json` (deterministic `put` → `get`) plus a
markdown projection at `<rootUri>/index/...` for query-based semantic `search`.

```ts
import { OpenVikingStore } from '@grubgenie/openviking-memory-layer';

const store = new OpenVikingStore({
  url, apiKey, account: 'my-account', userId: 'user-123',
  // rootUri: 'viking://user/memories/langgraph_store',  // default
  // index: ['preferences', 'summary'],                  // fields to project for search
});

await store.put(['preferences', 'user-123'], 'deployment', { color: 'azure', framework: 'langgraph' });
const item = await store.get(['preferences', 'user-123'], 'deployment');
// item.value === { color: 'azure', framework: 'langgraph' }   (exact, immediate)

const ranked = await store.search(['preferences'], { query: 'deployment color', limit: 5 });
const filtered = await store.search(['preferences'], { filter: { color: 'azure' }, limit: 10 });
const namespaces = await store.listNamespaces({ prefix: ['preferences'] });
await store.delete(['preferences', 'user-123'], 'deployment');
```

Plug it into an agent:

```ts
import { createAgent } from 'langchain';
const agent = createAgent({ model, tools, store });
```

> Semantic `search` depends on the server's async embedding pipeline — a `query`
> may lag right after a `put`. The KV path (`get`/`put`/`delete`) is exact and
> immediate.

#### Per-user memory isolation

OpenViking keys the user space by **`user_id` only** — `viking://user/…` is a
server-side shorthand that expands to `viking://user/{user_id}/…` per request
identity. So the default `rootUri` resolves to a **separate space per `userId`**
with no extra wiring (verified: a different `userId` reading the same namespace
returns `null`).

To make memory **follow one subject everywhere** (e.g. a diner whose preferences
persist across every restaurant/account), keep the account constant and key by
the subject:

```ts
const store = new OpenVikingStore({
  url, apiKey,
  account: DINER_MEMORY_ACCOUNT,   // ONE constant account for all subjects
  userId:  dinerId,                // stable, global per subject
  // carry restaurant/branch as actorPeerId or value metadata — NOT account
});
```

Identity is asserted as `(account, user)` and the vector layer applies tenant
isolation, so a **single constant `account`** guarantees sharing is purely
subject-keyed. To silo per subject **and** context instead, encode the context
into `rootUri` (e.g. `viking://user/memories/branches/${branchId}`).

### OpenVikingChatMessageHistory

A `BaseListChatMessageHistory` persisted in an OpenViking session — drop-in for
`RunnableWithMessageHistory`.

```ts
import { OpenVikingChatMessageHistory } from '@grubgenie/openviking-memory-layer';

const history = new OpenVikingChatMessageHistory({
  url, apiKey, userId: 'user-123',
  sessionId: 'thread-42',          // required
  // commitPolicy: { mode: 'pending_tokens', pendingTokenThreshold: 8000 },
});

await history.addMessages([new HumanMessage('what color?'), new AIMessage('azure')]);
const messages = await history.getMessages();   // BaseMessage[] restored from the session
await history.clear();
```

### withOpenvikingContext

Wrap **any** runnable so each turn (a) injects recalled OpenViking context as a
system message and (b) persists the exchange to a session — history + recall in
one call. Works config-less (it injects the fixed `sessionId` into config).

```ts
import { withOpenvikingContext } from '@grubgenie/openviking-memory-layer';

const app = withOpenvikingContext(model, {
  url, apiKey, userId: 'user-123',
  sessionId: 'thread-42',
  targetUri: 'viking://user/memories',
  limit: 4,
  injectContext: true,
  commitPolicy: { mode: 'always' },
});

const reply = await app.invoke([new HumanMessage('what deployment color do I like?')]);
```

### OpenVikingContextMiddleware

Recall-before / capture-after for a LangGraph model node — inject context before
the model call, persist (and optionally commit) after.

```ts
import { OpenVikingContextMiddleware } from '@grubgenie/openviking-memory-layer';

const middleware = new OpenVikingContextMiddleware({
  client,
  targetUri: 'viking://user/memories',
  sessionIdResolver: (_state, runtime) => runtime.config.configurable.thread_id,
  includeActiveMessages: true,
  tokenBudget: 8000,
});

// inside a model node:
const response = await middleware.wrapModelCall(request, handler); // request.systemMessage now carries context
await middleware.afterAgent({ messages: [...current, response] }, runtime);
```

### OpenVikingSessionContextAssembler

The lower-level building block behind the middleware/wrapper — assemble a context
block from recall + active session messages without wiring a graph.

```ts
import { OpenVikingSessionContextAssembler } from '@grubgenie/openviking-memory-layer';

const assembler = new OpenVikingSessionContextAssembler({
  client, targetUri: 'viking://user/memories', includeActiveMessages: true,
});

const { block, contextParts, recallDocuments, sessionContext } =
  await assembler.assemble({ sessionId: 'thread-42', query: 'deployment color' });
// `block` is a ready-to-prepend system string; `recallDocuments` are the raw hits.
```

### Helpers

```ts
import {
  extractMessageText, getLatestUserText, callOpenviking, ensureClient, commitPolicy,
} from '@grubgenie/openviking-memory-layer';

extractMessageText(msg.content);                 // string from string | content-block[]
getLatestUserText(messages);                     // text of the last human message
const client = await ensureClient({ url, apiKey, userId }); // build/normalize a client
await callOpenviking(client, 'find', { query: 'azure', limit: 3 }); // dispatch, drops undefined opts
commitPolicy({ mode: 'pending_tokens' });        // normalize a commit policy
```

### Full agent example (store + tools)

A complete agent with durable per-user memory (`store`) and memory tools the
model can call (`createOpenvikingTools`), sharing one client:

```ts
import { ChatOpenAI } from '@langchain/openai';
import { createAgent } from 'langchain';
import {
  SyncHTTPClient, OpenVikingStore, createOpenvikingTools,
} from '@grubgenie/openviking-memory-layer';

async function buildAgent(userId: string) {
  const client = new SyncHTTPClient({
    url: process.env.OPENVIKING_URL,
    apiKey: process.env.OPENVIKING_API_KEY,
    account: 'my-memory-account',   // constant → memory follows the user everywhere
    userId,                         // per-user isolation
  });
  await client.initialize();

  const store = new OpenVikingStore({ client });        // long-term BaseStore
  const tools = createOpenvikingTools({ client, profile: 'agent' }); // model-callable memory ops

  return createAgent({
    model: new ChatOpenAI({ model: 'gpt-4o-mini' }),
    tools,
    store,
  });
}

const agent = await buildAgent('user-123');
const out = await agent.invoke({ messages: [{ role: 'user', content: 'recommend something I like' }] });
```

The agent reads/writes long-term memory through `store` (cross-thread) and can
explicitly recall/store via the `viking_*` tools — both scoped to `user-123`.

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

### Verify every export against a live server

```bash
OPENVIKING_URL=http://127.0.0.1:1933 OPENVIKING_API_KEY=... \
  npx tsx scripts/verify_live.ts
```

Exercises all exports end-to-end against a running OpenViking (client methods,
store round-trip + isolation, retriever, history, middleware, assembler, every
tool) and reports pass/fail per feature.

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
