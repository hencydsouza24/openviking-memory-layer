// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * Contract tests for `SyncHTTPClient` against a stubbed OpenViking REST API.
 *
 * Verifies the content/filesystem methods the adapters dispatch (write, glob,
 * ls, rm, grep, add_skill) hit the canonical paths/verbs/bodies, that tenant
 * headers are sent, and that `OpenVikingStore` round-trips a value through the
 * HTTP client (proving the store works against a real server, not just the
 * in-memory client).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BaseStore } from '@langchain/langgraph';

import { SyncHTTPClient } from '../src/http_client.js';
import { OpenVikingStore } from '../src/store.js';

interface Captured {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: any;
}

/** Build a fetch stub that records the request and returns `{status:'ok', result}`. */
function stubFetch(result: unknown): { captured: Captured[]; fetch: typeof fetch } {
  const captured: Captured[] = [];
  const fetchImpl = (async (input: any, init: any) => {
    captured.push({
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      headers: { ...(init?.headers ?? {}) },
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify({ status: 'ok', result }), { status: 200 });
  }) as unknown as typeof fetch;
  return { captured, fetch: fetchImpl };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SyncHTTPClient content/filesystem methods', () => {
  const base = { url: 'http://ov.test', userId: 'diner-1', actorPeerId: 'acct_branch' };

  it('write posts to /api/v1/content/write with mode/wait', async () => {
    const { captured, fetch } = stubFetch({ ok: true });
    vi.stubGlobal('fetch', fetch);
    const client = new SyncHTTPClient(base);
    await client.write({ uri: 'viking://x/a.json', content: '{}', mode: 'create', wait: true });
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url.pathname).toBe('/api/v1/content/write');
    expect(captured[0].body).toEqual({ uri: 'viking://x/a.json', content: '{}', mode: 'create', wait: true });
    expect(captured[0].headers['X-OpenViking-Actor-Peer']).toBe('acct_branch');
    expect(captured[0].headers['X-OpenViking-User']).toBe('diner-1');
  });

  it('glob posts pattern + uri to /api/v1/search/glob', async () => {
    const { captured, fetch } = stubFetch({ matches: [] });
    vi.stubGlobal('fetch', fetch);
    await new SyncHTTPClient(base).glob({ pattern: '*.json', uri: 'viking://x' });
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url.pathname).toBe('/api/v1/search/glob');
    expect(captured[0].body).toEqual({ pattern: '*.json', uri: 'viking://x' });
  });

  it('ls gets /api/v1/fs/ls with uri + recursive query', async () => {
    const { captured, fetch } = stubFetch({});
    vi.stubGlobal('fetch', fetch);
    await new SyncHTTPClient(base).ls({ uri: 'viking://x', recursive: true });
    expect(captured[0].method).toBe('GET');
    expect(captured[0].url.pathname).toBe('/api/v1/fs/ls');
    expect(captured[0].url.searchParams.get('uri')).toBe('viking://x');
    expect(captured[0].url.searchParams.get('recursive')).toBe('true');
  });

  it('rm deletes /api/v1/fs with uri + recursive query', async () => {
    const { captured, fetch } = stubFetch(null);
    vi.stubGlobal('fetch', fetch);
    await new SyncHTTPClient(base).rm({ uri: 'viking://x/a.json', recursive: false });
    expect(captured[0].method).toBe('DELETE');
    expect(captured[0].url.pathname).toBe('/api/v1/fs');
    expect(captured[0].url.searchParams.get('uri')).toBe('viking://x/a.json');
    expect(captured[0].url.searchParams.get('recursive')).toBe('false');
  });

  it('grep posts to /api/v1/search/grep with case_insensitive', async () => {
    const { captured, fetch } = stubFetch({ matches: [] });
    vi.stubGlobal('fetch', fetch);
    await new SyncHTTPClient(base).grep({ uri: 'viking://x/a.md', pattern: 'foo', caseInsensitive: true, nodeLimit: 5 });
    expect(captured[0].url.pathname).toBe('/api/v1/search/grep');
    expect(captured[0].body).toEqual({ uri: 'viking://x/a.md', pattern: 'foo', case_insensitive: true, node_limit: 5 });
  });

  it('add_skill posts data to /api/v1/skills', async () => {
    const { captured, fetch } = stubFetch({ skill_id: 's1' });
    vi.stubGlobal('fetch', fetch);
    await new SyncHTTPClient(base).add_skill({ data: 'a skill', wait: true });
    expect(captured[0].url.pathname).toBe('/api/v1/skills');
    expect(captured[0].body).toEqual({ data: 'a skill', wait: true });
  });

  it('get_status hits /api/v1/observer/system', async () => {
    const { captured, fetch } = stubFetch({ is_healthy: true });
    vi.stubGlobal('fetch', fetch);
    await new SyncHTTPClient(base).get_status();
    expect(captured[0].method).toBe('GET');
    expect(captured[0].url.pathname).toBe('/api/v1/observer/system');
  });
});

describe('OpenVikingStore over SyncHTTPClient', () => {
  it('round-trips put -> get through the HTTP client', async () => {
    // Minimal in-process OpenViking REST server: a uri -> content map.
    const fs = new Map<string, string>();
    const fetchImpl = (async (input: any, init: any) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body) : undefined;
      const ok = (result: unknown) => new Response(JSON.stringify({ status: 'ok', result }), { status: 200 });

      if (url.pathname === '/api/v1/content/write') {
        if (body.mode === 'create' && fs.has(body.uri)) {
          return new Response(JSON.stringify({ status: 'error', error: { code: 'ALREADY_EXISTS', message: 'exists' } }), { status: 409 });
        }
        fs.set(body.uri, body.content);
        return ok({ uri: body.uri });
      }
      if (url.pathname === '/api/v1/content/read') {
        const uri = url.searchParams.get('uri')!;
        if (!fs.has(uri)) {
          return new Response(JSON.stringify({ status: 'error', error: { code: 'NOT_FOUND', message: 'missing' } }), { status: 404 });
        }
        return ok(fs.get(uri));
      }
      throw new Error(`unexpected ${method} ${url.pathname}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);

    const store = new OpenVikingStore({ url: 'http://ov.test', userId: 'u', actorPeerId: 'acct_branch' });
    // Must be a real LangGraph BaseStore so createAgent({ store }) accepts/drives it.
    expect(store instanceof BaseStore).toBe(true);

    await store.put(['demo', 'user'], 'deployment', { color: 'azure', framework: 'langgraph' });
    const item = await store.get(['demo', 'user'], 'deployment');

    expect(item).not.toBeNull();
    expect(item!.value).toEqual({ color: 'azure', framework: 'langgraph' });
    expect(item!.namespace).toEqual(['demo', 'user']);
    expect(item!.key).toBe('deployment');

    // Drive through batch() — the only path LangGraph uses internally.
    const [putResult, got] = await store.batch([
      { namespace: ['demo', 'user'], key: 'deployment', value: { color: 'teal' } },
      { namespace: ['demo', 'user'], key: 'deployment' },
    ]);
    expect(putResult).toBeUndefined();
    expect((got as { value: Record<string, unknown> }).value).toEqual({ color: 'teal' });

    vi.restoreAllMocks();
  });
});
