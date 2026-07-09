// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * Regression test for a cross-user memory leak in `OpenVikingStore`'s default
 * `rootUri`.
 *
 * Root cause: the OpenViking server treats `viking://user` and
 * `viking://user/{memories|resources|skills}` as literal alias tokens it
 * *exact*-matches and rewrites to the caller's real per-user path
 * (`viking://user/{user_id}/...`) — see the server's
 * `_is_default_user_content_root` in `openviking/core/retrieval_targets.py`:
 *
 *   def _is_default_user_content_root(target_uri, ctx, segment) -> bool:
 *       normalized = VikingURI.normalize(target_uri).rstrip("/")
 *       return normalized in {
 *           f"viking://user/{segment}",
 *           f"{canonical_user_root(ctx).rstrip('/')}/{segment}",
 *       }
 *
 * A previous SDK default of `viking://user/memories/langgraph_store` had one
 * path segment too many to satisfy that exact match, so the server never
 * recognized it as needing per-user aliasing and fell through to a single,
 * static, unscoped literal path shared by every caller — two different users
 * writing the same `namespace` + `key` slug collided.
 *
 * `isDefaultUserContentRoot` below is a direct TypeScript port of the exact
 * matcher quoted above (not a broader guess at server behavior we haven't
 * verified from this repo) — it's applied to the SDK's own produced
 * `rootUri` to prove the fixed default satisfies the server's documented
 * alias contract, and the old buggy default did not.
 */

import { describe, expect, it } from 'vitest';

import { OpenVikingRetriever } from '../src/retrievers.js';
import { OpenVikingStore } from '../src/store.js';

const ALIAS_SEGMENTS = ['memories', 'resources', 'skills'] as const;

/** Direct port of `_is_default_user_content_root` (see file header). */
function isDefaultUserContentRoot(uri: string): boolean {
  const normalized = uri.replace(/\/+$/, '');
  return ALIAS_SEGMENTS.some((segment) => normalized === `viking://user/${segment}`);
}

describe('OpenVikingStore default rootUri vs. the server exact-match alias', () => {
  it('the fixed default satisfies the server exact-match alias', () => {
    const store = new OpenVikingStore({ url: 'http://ov.test' });
    expect(store.rootUri).toBe('viking://user/memories');
    expect(isDefaultUserContentRoot(store.rootUri)).toBe(true);
  });

  it('the old buggy default (extra /langgraph_store segment) did not', () => {
    expect(isDefaultUserContentRoot('viking://user/memories/langgraph_store')).toBe(false);
  });

  it('a caller-supplied rootUri is respected as-is (no forced aliasing)', () => {
    const store = new OpenVikingStore({ url: 'http://ov.test', rootUri: 'viking://custom/root' });
    expect(store.rootUri).toBe('viking://custom/root');
  });
});

/**
 * Regression test for a second, independent cross-user leak: OpenViking's
 * server-side `find`/`search` scope enforcement can fail at the native
 * vector-index layer and return other users' documents even though every
 * Python layer up to that point builds the correct `PathScope` restriction
 * (traced end-to-end; see the leak report). We don't ship or control that
 * server, so `OpenVikingRetriever._getRelevantDocuments()` now re-verifies
 * each result's URI client-side and drops anything outside the caller's own
 * scope before it becomes a `Document` — this is the fix under test here.
 */
describe('OpenVikingRetriever client-side scope re-filter', () => {
  /** Minimal OpenVikingClientLike whose `find` returns results spanning multiple users. */
  function fakeClientReturning(memories: Array<{ uri: string; abstract?: string }>) {
    return {
      _initialized: true,
      async find() {
        return { memories, resources: [], skills: [] };
      },
    };
  }

  it('drops results outside the caller userId root and viking://resources', async () => {
    const client = fakeClientReturning([
      { uri: 'viking://user/diner-A/memories/preferences/user/diner_preferences.md', abstract: 'A likes vegetarian' },
      // leaked cross-user result — a different diner's own correctly-scoped file
      { uri: 'viking://user/diner-B/memories/events/2026/07/02/dining_session_summary.md', abstract: 'B ordered salmon' },
      { uri: 'viking://resources/shared/menu.md', abstract: 'shared menu resource' },
      // outside both allowed prefixes — should also be dropped
      { uri: 'viking://agent/default/memories/identity.md', abstract: 'template identity' },
    ]);

    const retriever = new OpenVikingRetriever({ client, userId: 'diner-A', contextTypes: ['memory'], contentMode: 'abstract' });
    const docs = await retriever._getRelevantDocuments('taste preferences');

    const uris = docs.map((d) => d.metadata.openviking_uri as string);
    expect(uris).toEqual([
      'viking://user/diner-A/memories/preferences/user/diner_preferences.md',
      'viking://resources/shared/menu.md',
    ]);
    expect(uris).not.toContain('viking://user/diner-B/memories/events/2026/07/02/dining_session_summary.md');
  });

  it('does not false-positive on a prefix-sharing user id (diner-A vs diner-AA)', async () => {
    const client = fakeClientReturning([
      { uri: 'viking://user/diner-A/memories/notes.md', abstract: 'mine' },
      { uri: 'viking://user/diner-AA/memories/notes.md', abstract: 'not mine, just shares a string prefix' },
    ]);

    const retriever = new OpenVikingRetriever({ client, userId: 'diner-A', contextTypes: ['memory'], contentMode: 'abstract' });
    const docs = await retriever._getRelevantDocuments('notes');

    expect(docs.map((d) => d.metadata.openviking_uri)).toEqual(['viking://user/diner-A/memories/notes.md']);
  });

  it('an explicit targetUri is trusted as the allowed scope', async () => {
    const client = fakeClientReturning([
      { uri: 'viking://user/diner-A/memories/scoped/x.md', abstract: 'in scope' },
      { uri: 'viking://resources/shared/menu.md', abstract: 'outside the explicit scope' },
    ]);

    const retriever = new OpenVikingRetriever({
      client,
      userId: 'diner-A',
      targetUri: 'viking://user/diner-A/memories/scoped',
      contextTypes: ['memory'],
      contentMode: 'abstract',
    });
    const docs = await retriever._getRelevantDocuments('x');

    expect(docs.map((d) => d.metadata.openviking_uri)).toEqual(['viking://user/diner-A/memories/scoped/x.md']);
  });

  it('skips filtering entirely when no userId/user is set (cannot determine scope)', async () => {
    const client = fakeClientReturning([
      { uri: 'viking://user/diner-A/memories/notes.md', abstract: 'a' },
      { uri: 'viking://user/diner-B/memories/notes.md', abstract: 'b' },
    ]);

    const retriever = new OpenVikingRetriever({ client, contextTypes: ['memory'], contentMode: 'abstract' });
    const docs = await retriever._getRelevantDocuments('notes');

    expect(docs).toHaveLength(2);
  });
});
