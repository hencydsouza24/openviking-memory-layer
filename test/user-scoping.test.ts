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
