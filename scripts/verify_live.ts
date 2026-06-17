/**
 * Comprehensive live verification of EVERY package export against a running
 * OpenViking server.
 *
 *   OPENVIKING_URL=http://127.0.0.1:1933 OPENVIKING_API_KEY=openviking-dev-key \
 *     npx tsx scripts/verify_live.ts
 *
 * Throwaway dev tool — not packed into the published package.
 *
 * Semantic retrieval (find/search) depends on the server's async embedding
 * pipeline, so query-based checks assert "runs + correct shape", not hit counts.
 * KV / session / content paths are asserted exactly.
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';

import {
  InMemoryOpenVikingClient,
  OpenVikingChatMessageHistory,
  OpenVikingContextMiddleware,
  OpenVikingRetriever,
  OpenVikingSessionContextAssembler,
  OpenVikingStore,
  SyncHTTPClient,
  applyCommitPolicy,
  callOpenviking,
  commitPolicy,
  contextPartsFromDocuments,
  ensureClient,
  extractMessageText,
  getLatestUserText,
  langchainMessageToOpenviking,
  openvikingMessageToLangchain,
  withOpenvikingContext,
  createOpenvikingTools,
} from '../src/index.js';

const url = process.env.OPENVIKING_URL || 'http://127.0.0.1:1933';
const apiKey = process.env.OPENVIKING_API_KEY || 'openviking-dev-key';
const account = 'verify-acct';
const userId = 'diner-verify-1';
const stamp = Date.now();

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  cond ? pass++ : fail++;
};
const section = (t: string) => console.log(`\n── ${t} ──`);
const step = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (e) {
    ok(name, false, (e as Error).message);
  }
};

const conn = { url, apiKey, account, userId };

async function main() {
  // ───────────────────────── helpers (pure) ─────────────────────────
  section('helpers (pure)');
  ok('extractMessageText string', extractMessageText('hi') === 'hi');
  ok(
    'extractMessageText blocks',
    extractMessageText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]) === 'a\nb',
  );
  ok(
    'getLatestUserText',
    getLatestUserText([new AIMessage('x'), new HumanMessage('latest q')]) === 'latest q',
  );
  ok('commitPolicy defaults', commitPolicy().mode === 'never');
  ok('commitPolicy override', commitPolicy({ mode: 'always' }).mode === 'always');
  await step('callOpenviking dispatch (in-memory)', async () => {
    const mem = new InMemoryOpenVikingClient({ 'viking://user/memories/p.md': 'hello' });
    const res = await callOpenviking(mem, 'find', { query: 'hello', limit: 3 });
    ok('callOpenviking → find', res != null);
  });
  await step('ensureClient builds SyncHTTPClient', async () => {
    const c = await ensureClient({ ...conn });
    ok('ensureClient', c instanceof SyncHTTPClient && c._initialized === true);
  });

  // ───────────────────── message converters (pure) ──────────────────
  section('message converters (pure)');
  ok(
    'langchainMessageToOpenviking',
    langchainMessageToOpenviking(new HumanMessage('hey'))[0].role === 'user',
  );
  await step('openvikingMessageToLangchain', async () => {
    const back = openvikingMessageToLangchain({ role: 'user', parts: [{ type: 'text', text: 'yo' }] });
    ok('openvikingMessageToLangchain', back.length === 1 && extractMessageText(back[0].content) === 'yo');
  });
  ok(
    'contextPartsFromDocuments',
    contextPartsFromDocuments([{ pageContent: 'doc', metadata: { openviking_uri: 'viking://x' } }]).length >= 1,
  );

  // ───────────────────────── SyncHTTPClient ─────────────────────────
  section('SyncHTTPClient (live)');
  const client = new SyncHTTPClient(conn);
  await client.initialize();
  await step('get_status', async () => {
    const s = await client.get_status();
    ok('get_status', s != null && (s.is_healthy === true || s.is_healthy === false));
  });
  await step('is_healthy', async () => ok('is_healthy', (await client.is_healthy()) === true));
  const fileUri = `viking://user/memories/verify/note-${stamp}.txt`;
  await step('write+read+glob+ls+rm', async () => {
    await client.write({ uri: fileUri, content: 'hello viking azure', mode: 'create', wait: true });
    const read = await client.read({ uri: fileUri });
    ok('write→read', String(read).includes('hello viking azure'));
    const g = await client.glob({ pattern: `note-${stamp}.txt`, uri: 'viking://user/memories/verify' });
    ok('glob finds file', JSON.stringify(g).includes(`note-${stamp}`));
    const l = await client.ls({ uri: 'viking://user/memories/verify' });
    ok('ls', l != null);
    await client.rm({ uri: fileUri, recursive: false });
    ok('rm', true);
  });
  await step('create_session+add_message+commit_session', async () => {
    const s = await client.create_session({});
    const sid = s.session_id ?? s;
    await client.add_message({ sessionId: sid, role: 'user', content: 'remember azure' });
    await client.add_message({ sessionId: sid, role: 'assistant', content: 'noted azure' });
    const committed = await client.commit_session({ sessionId: sid });
    ok('session lifecycle', committed != null, JSON.stringify(committed).slice(0, 60));
    await client.delete_session(sid).catch(() => {});
  });

  // ───────────────────────── OpenVikingStore ────────────────────────
  section('OpenVikingStore (live, BaseStore)');
  const store = new OpenVikingStore(conn);
  await step('put→get deterministic', async () => {
    await store.put(['verify', 'user'], 'deployment', { color: 'azure', framework: 'lg' });
    const item = await store.get(['verify', 'user'], 'deployment');
    ok('store put→get', item?.value?.color === 'azure', JSON.stringify(item?.value));
  });
  await step('batch (put+get)', async () => {
    const [putRes, got] = await store.batch([
      { namespace: ['verify', 'user'], key: 'deployment', value: { color: 'teal' } },
      { namespace: ['verify', 'user'], key: 'deployment' },
    ]);
    ok('store.batch', putRes === undefined && (got as any)?.value?.color === 'teal');
  });
  await step('listNamespaces', async () => {
    const ns = await store.listNamespaces({ prefix: ['verify'] });
    ok('listNamespaces', Array.isArray(ns), `${ns.length} ns`);
  });
  await step('search (shape)', async () => {
    const res = await store.search(['verify'], { query: 'azure', limit: 5 });
    ok('store.search returns array', Array.isArray(res), `${res.length} hit(s)`);
  });
  await step('isolation: other user → null', async () => {
    const other = new OpenVikingStore({ ...conn, userId: `diner-verify-2-${stamp}` });
    ok('isolation', (await other.get(['verify', 'user'], 'deployment')) === null);
  });
  await store.delete(['verify', 'user'], 'deployment').catch(() => {});

  // ──────────────────── ChatMessageHistory (live) ───────────────────
  section('OpenVikingChatMessageHistory (live)');
  await step('addMessages → getMessages round-trip', async () => {
    const sessionId = `verify-hist-${stamp}`;
    const history = new OpenVikingChatMessageHistory({ ...conn, sessionId });
    await history.addMessages([new HumanMessage('what color?'), new AIMessage('azure')]);
    const msgs = await history.getMessages();
    ok('history round-trip', msgs.length >= 1, `${msgs.length} msg(s)`);
  });

  // ─────────────────────── Retriever (live) ─────────────────────────
  section('OpenVikingRetriever (live, semantic = shape only)');
  await step('retriever.invoke', async () => {
    const retriever = new OpenVikingRetriever({ ...conn, targetUri: 'viking://user/memories', limit: 4 });
    const docs = await retriever.invoke('deployment color preference');
    ok('retriever returns Document[]', Array.isArray(docs), `${docs.length} doc(s)`);
  });

  // ────────────── SessionContextAssembler (live) ────────────────────
  section('OpenVikingSessionContextAssembler (live)');
  await step('assemble', async () => {
    const assembler = new OpenVikingSessionContextAssembler({ ...conn, targetUri: 'viking://user/memories' });
    const ctx = await assembler.assemble({ sessionId: `verify-asm-${stamp}`, query: 'azure' });
    ok(
      'assemble returns context',
      ctx != null && typeof ctx.block === 'string' && Array.isArray(ctx.recallDocuments),
      `block ${ctx.block?.length ?? 0} chars, ${ctx.recallDocuments?.length ?? 0} recall`,
    );
  });

  // ──────────────────── withOpenvikingContext (live) ────────────────
  section('withOpenvikingContext (live)');
  await step('wrap + invoke', async () => {
    const base = RunnableLambda.from(async (msgs: any) => new AIMessage('echoed azure'));
    const sessionId = `verify-woc-${stamp}`;
    const app = withOpenvikingContext(base, { ...conn, sessionId, targetUri: 'viking://user/memories' });
    const out: any = await app.invoke([new HumanMessage('hello')]);
    ok('withOpenvikingContext invoke', out != null && extractMessageText(out.content ?? out).includes('azure'));
  });

  // ──────────────────── ContextMiddleware (live) ────────────────────
  section('OpenVikingContextMiddleware (live)');
  await step('wrapModelCall + afterAgent', async () => {
    const sessionId = `verify-mw-${stamp}`;
    const mw = new OpenVikingContextMiddleware({
      ...conn,
      targetUri: 'viking://user/memories',
      sessionIdResolver: () => sessionId,
      includeActiveMessages: true,
    });
    const runtime = { config: { configurable: { thread_id: sessionId } } };
    const make = (messages: any[], systemMessage: any): any => ({
      state: {},
      runtime,
      messages,
      systemMessage,
      override(o: any) {
        return make(o.messages ?? this.messages, o.systemMessage ?? this.systemMessage ?? null);
      },
    });
    const handler = (req: any) => new AIMessage(req.systemMessage ? 'with-context' : 'no-context');
    const resp: any = await mw.wrapModelCall(make([new HumanMessage('q')], null), handler);
    ok('middleware.wrapModelCall', resp != null && typeof extractMessageText(resp.content) === 'string');
    await mw.afterAgent({ messages: [new HumanMessage('q'), resp] }, runtime);
    ok('middleware.afterAgent', true);
  });

  // ───────────────────── createOpenvikingTools (live) ───────────────
  section('createOpenvikingTools (live)');
  const tools = createOpenvikingTools({ ...conn, profile: 'admin' });
  ok('admin profile tool count', tools.length >= 8, `${tools.length} tools: ${tools.map((t) => t.name).join(',')}`);
  const tool = (name: string) => tools.find((t) => t.name === name)!;
  const toolFileUri = `viking://user/memories/verify/tool-${stamp}.txt`;
  await step('viking_health', async () => {
    const r = await tool('viking_health').invoke({});
    ok('viking_health', String(r).toLowerCase().includes('openviking'));
  });
  await step('viking_store', async () => {
    const r = await tool('viking_store').invoke({ messages: 'remember: the deployment color is azure', commit: false });
    ok('viking_store', String(r).includes('session_id'));
  });
  await step('viking_find (shape)', async () => {
    const r = await tool('viking_find').invoke({ query: 'azure', limit: 4 });
    ok('viking_find runs', typeof r === 'string');
  });
  await step('viking_search (shape)', async () => {
    const r = await tool('viking_search').invoke({ query: 'azure', limit: 4 });
    ok('viking_search runs', typeof r === 'string');
  });
  await step('viking_browse', async () => {
    const r = await tool('viking_browse').invoke({ uri: 'viking://user/memories' });
    ok('viking_browse', typeof r === 'string');
  });
  await step('viking_read + viking_grep', async () => {
    await client.write({ uri: toolFileUri, content: 'tool read azure content', mode: 'create', wait: true });
    const r = await tool('viking_read').invoke({ uris: toolFileUri });
    ok('viking_read', String(r).includes('tool read azure'));
    const g = await tool('viking_grep').invoke({ uri: toolFileUri, pattern: 'azure' });
    ok('viking_grep', typeof g === 'string');
  });
  await step('viking_forget', async () => {
    const r = await tool('viking_forget').invoke({ uri: toolFileUri });
    ok('viking_forget', String(r).includes('removed') || String(r).includes(toolFileUri));
  });
  await step('viking_add_skill', async () => {
    const skillDoc = `---\nname: verify-skill-${stamp}\ndescription: live verification skill\n---\n\nReturn the deployment color when asked.`;
    const r = await tool('viking_add_skill').invoke({ data: skillDoc, wait: false });
    ok('viking_add_skill', typeof r === 'string' && !String(r).includes('INVALID_ARGUMENT'), String(r).slice(0, 60));
  });

  console.log(`\n${'═'.repeat(40)}\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
