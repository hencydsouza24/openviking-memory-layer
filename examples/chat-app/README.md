# Memory-backed chat app

A chat UI where **the library runs entirely in the browser** — there is no
server-side agent logic. A plain client-side tool loop drives the package
exports directly against a live OpenViking server and any OpenAI-compatible LLM.

Vite serves the Preact app and proxies two prefixes so the browser dodges CORS:
`/ov` → OpenViking, `/llm` → the LLM. That's the only thing running server-side.

## What it uses (all in the browser)

| Package export | Role |
|---|---|
| `SyncHTTPClient` | connection to OpenViking (`baseUrl = '/ov'`) |
| `createOpenvikingTools` | the `viking_*` tools the model calls — invoked directly with `tool.invoke(args)` |
| `OpenVikingContextMiddleware` | `wrapModelCall` recalls memory before each model call, `afterAgent` captures the turn (pulls in `OpenVikingRetriever`, the context assembler, `OpenVikingChatMessageHistory`, and the message converters) |
| `extractMessageText` | rendering replies |

`src/agent.ts` is the whole agent: a 6-iteration tool loop, no LangGraph, no
sockets. `src/app.tsx` is the Preact UI. The library is imported straight from
local source (`@ovlib` → `../../src`), so you test exactly what's in this repo.

> `OpenVikingStore` is the one export not used here — it extends LangGraph's
> `BaseStore`, which isn't browser-friendly. It's covered by the unit tests.

## Run

```bash
cp examples/chat-app/.env.example examples/chat-app/.env
# edit .env: OPENVIKING_URL, OPENAI_BASE_URL (proxy targets) +
#            VITE_OPENAI_API_KEY, VITE_OPENVIKING_API_KEY, VITE_OPENVIKING_USER_ID
npm run example:chat-app
```

Open <http://localhost:8788> (set `PORT` in `.env`; avoid 6660–6669 — Chrome
blocks them as `ERR_UNSAFE_PORT`). Vite hot-reloads on every edit, including the
library source under `src/`.

## Features

- **Model picker** — fetched live from the gateway's `/models` (via `/llm`
  proxy). `VITE_OPENAI_MODELS` optionally restricts/orders it. Only list models
  your gateway has credentials for — others 422/404.
- **Live memory activity** — right-hand timeline logs every `viking_*` tool call
  and result as the loop recalls and stores memory.
- **Human-in-the-loop** — write tools (`viking_store`, `viking_add_skill`,
  `viking_add_resource`, `viking_forget`) pause the loop on a JS Promise until
  you click Approve / Deny. Try: *"Remember I'm vegetarian and allergic to peanuts."*
- **Memory browser** — navigate the real OpenViking space for this user
  (`viking://user/{userId}/memories`, via `client.ls` / `client.read`): folders
  drill in, files open. Refreshes after each reply so stored memories appear.

## Security note

Keys are `VITE_`-prefixed and shipped to the browser, and the LLM/OpenViking
endpoints are reachable through the dev proxy. This is fine for a local example
but is **not** a production pattern — there, keep keys and the agent loop on a
server.
