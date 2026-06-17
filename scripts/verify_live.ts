/**
 * Live verification against a running OpenViking server.
 * Run: OPENVIKING_URL=... OPENVIKING_API_KEY=... npx tsx scripts/verify_live.ts
 * Throwaway — not part of the package.
 */
import { SyncHTTPClient, OpenVikingStore } from '../src/index.js';

const url = process.env.OPENVIKING_URL || 'http://127.0.0.1:1933';
const apiKey = process.env.OPENVIKING_API_KEY || 'openviking-dev-key';
const account = 'verify-acct';
const userId = 'diner-verify-1';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  cond ? pass++ : fail++;
};
const step = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (e) {
    ok(name, false, (e as Error).message);
  }
};

async function main() {
  const client = new SyncHTTPClient({ url, apiKey, account, userId });
  await client.initialize();

  await step('get_status', async () => {
    const s = await client.get_status();
    ok('get_status', s != null, JSON.stringify(s).slice(0, 80));
  });

  const fileUri = 'viking://user/memories/verify/hello.txt';
  await step('write', async () => {
    await client.rm({ uri: fileUri, recursive: false }).catch(() => {});
    await client.write({ uri: fileUri, content: 'hello viking azure', mode: 'create', wait: true });
    ok('write (create)', true);
  });
  await step('read', async () => {
    const c = await client.read({ uri: fileUri });
    ok('read returns written content', String(c).includes('hello viking azure'), String(c).slice(0, 60));
  });
  await step('glob', async () => {
    const g = await client.glob({ pattern: '*.txt', uri: 'viking://user/memories/verify' });
    ok('glob', g != null, JSON.stringify(g).slice(0, 100));
  });
  await step('ls', async () => {
    const l = await client.ls({ uri: 'viking://user/memories/verify' });
    ok('ls', l != null, JSON.stringify(l).slice(0, 100));
  });
  await step('rm', async () => {
    await client.rm({ uri: fileUri, recursive: false });
    ok('rm', true);
  });

  // ---- OpenVikingStore round trip ----
  const store = new OpenVikingStore({ url, apiKey, account, userId });
  await step('store.put', async () => {
    await store.put(['verify', 'user'], 'deployment', { color: 'azure', framework: 'langgraph' });
    ok('store.put', true);
  });
  await step('store.get (deterministic)', async () => {
    const item = await store.get(['verify', 'user'], 'deployment');
    ok('store.get round-trips put', item?.value?.color === 'azure', JSON.stringify(item?.value));
  });
  await step('store.search', async () => {
    const res = await store.search(['verify'], { query: 'azure', limit: 5 });
    ok('store.search (non-fatal)', true, `${res.length} hit(s)`);
  });

  // ---- per-user isolation ----
  await step('isolation: other user cannot read', async () => {
    const other = new OpenVikingStore({ url, apiKey, account, userId: 'diner-verify-2' });
    const item = await other.get(['verify', 'user'], 'deployment');
    ok('isolation: diner-verify-2 sees null', item === null, JSON.stringify(item?.value));
  });

  await step('cleanup store.delete', async () => {
    await store.delete(['verify', 'user'], 'deployment');
    ok('store.delete', true);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
