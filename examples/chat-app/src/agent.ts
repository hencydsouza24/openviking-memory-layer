// The whole "agent" is the library, used directly in the browser — no LangGraph,
// no server orchestration. We import the modules we need from local source
// (aliased as @ovlib) and drive them with a plain tool loop.
//
//   SyncHTTPClient ............. connection to OpenViking (via /ov proxy)
//   createOpenvikingTools ...... the viking_* tools the model calls
//   OpenVikingContextMiddleware  recall before each model call + capture after
//                                (pulls in the retriever, assembler, history,
//                                 and message converters under the hood)

import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';

import { extractMessageText } from '@ovlib/client';
import { SyncHTTPClient } from '@ovlib/http_client';
import { OpenVikingContextMiddleware } from '@ovlib/middleware';
import { createOpenvikingTools } from '@ovlib/tools';

const env = import.meta.env as Record<string, string>;
export const ACCOUNT = env.VITE_OPENVIKING_ACCOUNT || 'ov_example';
export const USER_ID = env.VITE_OPENVIKING_USER_ID || 'ov_demo';
export const MEMORY_ROOT = `viking://user/${USER_ID}/memories`;
export const WRITE_TOOLS = new Set(['viking_store', 'viking_add_skill', 'viking_add_resource', 'viking_forget']);

export const client = new SyncHTTPClient({
  url: '/ov',
  apiKey: env.VITE_OPENVIKING_API_KEY,
  account: ACCOUNT,
  userId: USER_ID,
});
const tools = createOpenvikingTools({ client, allowForget: true });
const toolsByName = new Map(tools.map((t) => [t.name, t]));
const middleware = new OpenVikingContextMiddleware({ client, tokenBudget: 8_000, includeActiveMessages: true });

const makeLlm = (model: string) =>
  new ChatOpenAI({
    apiKey: env.VITE_OPENAI_API_KEY,
    model,
    temperature: 0.3,
    configuration: { baseURL: '/llm', dangerouslyAllowBrowser: true },
  }).bindTools(tools);

export interface MemEvent {
  kind: 'call' | 'result';
  name: string;
  args?: unknown;
  write?: boolean;
  status?: string;
  preview?: string;
}

export interface RunTurn {
  sessionId: string;
  model: string;
  history: BaseMessage[];
  userText: string;
  onEvent: (e: MemEvent) => void;
  onApproval: (call: { name: string; args: unknown }) => Promise<boolean>;
}

// One conversational turn: recall → model → (tool calls, with HITL on writes) → loop → capture.
export async function runTurn({ sessionId, model, history, userText, onEvent, onApproval }: RunTurn): Promise<BaseMessage[]> {
  const messages: BaseMessage[] = [...history, new HumanMessage(userText)];
  const runtime = { config: { configurable: { thread_id: sessionId } } };
  const makeReq = (msgs: BaseMessage[], sys: BaseMessage | null): any => ({
    state: {},
    runtime,
    messages: msgs,
    systemMessage: sys,
    override(o: any) {
      return makeReq(o.messages ?? this.messages, o.systemMessage ?? this.systemMessage ?? null);
    },
  });
  const llm = makeLlm(model);
  const handler = async (req: any): Promise<BaseMessage> => {
    const m: BaseMessage[] = [];
    m.push(req.systemMessage ?? new SystemMessage(
      'You are a helpful assistant with long-term memory. Use the viking_* tools to recall and persist what matters.',
    ));
    m.push(...req.messages);
    return llm.invoke(m);
  };

  for (let i = 0; i < 6; i++) {
    const ai: any = await middleware.wrapModelCall(makeReq(messages, null), handler);
    messages.push(ai);
    const calls = ai.tool_calls ?? [];
    if (!calls.length) break;
    for (const call of calls) {
      onEvent({ kind: 'call', name: call.name, args: call.args, write: WRITE_TOOLS.has(call.name) });
      if (WRITE_TOOLS.has(call.name) && !(await onApproval(call))) {
        messages.push(new ToolMessage({ tool_call_id: call.id, name: call.name, content: `User denied ${call.name}.` }));
        onEvent({ kind: 'result', name: call.name, status: 'denied' });
        continue;
      }
      let out: string;
      try {
        out = String(await toolsByName.get(call.name)!.invoke(call.args));
      } catch (e: any) {
        out = 'error: ' + (e?.message ?? e);
      }
      messages.push(new ToolMessage({ tool_call_id: call.id, name: call.name, content: out }));
      onEvent({ kind: 'result', name: call.name, status: 'ok', preview: out.slice(0, 240) });
    }
  }

  await middleware.afterAgent({ messages }, runtime);
  return messages;
}

export const textOf = (m: BaseMessage) => extractMessageText(m.content);

// --- memory browser (SyncHTTPClient.ls / .read) ---
export async function lsMemory(uri?: string) {
  const r: any = await client.ls({ uri: uri || MEMORY_ROOT, recursive: false });
  const rows: any[] = Array.isArray(r) ? r : r?.entries ?? [];
  return rows.map((e) => ({
    uri: e.uri as string,
    name: (e.rel_path || String(e.uri).split('/').pop()) as string,
    isDir: !!e.isDir,
    abstract: (e.abstract || '').slice(0, 200) as string,
  }));
}
export const readMemory = (uri: string) => client.read({ uri }).then(String);

export async function listModels(): Promise<string[]> {
  const filter = (env.VITE_OPENAI_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const r: any = await (await fetch('/llm/models', {
      headers: { authorization: 'Bearer ' + (env.VITE_OPENAI_API_KEY || '') },
    })).json();
    const ids: string[] = (r.data ?? []).map((m: any) => m.id);
    return filter.length ? filter.filter((m) => ids.includes(m)) : ids.sort();
  } catch {
    return filter;
  }
}
