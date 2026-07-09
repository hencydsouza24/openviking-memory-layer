# Changelog

## 0.4.0

**Security fix — closes a cross-user data leak in `OpenVikingRetriever`.**

`OpenVikingRetriever.find()`/`.search()` could return another user's documents
even when scoped by `userId`, despite the OpenViking server correctly building
its scope-restriction filter at every traced layer. The failure was isolated
to the server's native vector-index engine (a third-party dependency this
package doesn't ship or control), so the fix is client-side: the retriever now
re-verifies each result's URI itself and drops anything outside the caller's
own scope (`viking://user/{userId}` or `viking://resources`, or the caller's
explicit `targetUri` if set) before turning it into a `Document`.

- `OpenVikingRetriever._getRelevantDocuments()` now filters results through
  `resolveAllowedScopePrefixes()` / `isUnderAllowedPrefix()`.
- Retrievers constructed without a `userId`/`user` skip filtering (unchanged
  behavior — there's no scope to enforce against).
- Regression tests in `test/user-scoping.test.ts` mock multi-user `find`
  results and assert only in-scope documents survive.

**Upgrade recommended for every consumer of this package**, especially
anyone passing `userId` to `OpenVikingRetriever` for per-user retrieval.

## 0.3.0

**Security fix — closes a cross-user data leak in `OpenVikingStore`.**

`OpenVikingStore`'s default `rootUri` (`viking://user/memories/langgraph_store`)
had one path segment too many to match the OpenViking server's exact-match
per-user URI alias (`viking://user/memories`), so writes fell through to a
single, static, unscoped literal path shared by every caller regardless of
`userId` — two different users writing the same `namespace` + `key` collided.

- Default `rootUri` changed to the bare `viking://user/memories`, matching the
  server's documented alias contract. Callers should put app-specific
  distinctions in the `namespace` array instead of the URI.
- Added `test/user-scoping.test.ts` with a regression test for the fixed
  default.

## Earlier versions

See git history (`git log`) for prior releases.
