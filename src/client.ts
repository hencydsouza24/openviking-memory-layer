// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * Shared helpers for the LangChain/LangGraph integration adapters.
 *
 * TypeScript port of `openviking/integrations/langchain/client.py`.
 *
 * Differences from Python that are intentional and documented:
 *   - OpenViking client methods take a single options object instead of
 *     positional + keyword args. `callOpenviking` strips `undefined` fields
 *     (the JS analog of Python's "drop None kwargs / filter unsupported") and
 *     forwards the object to `client[method]`.
 *   - The one-shot recovery wrapper (`OpenVikingClientHandle`) guarded HTTP
 *     event-loop / transient transport errors in the async Python client. The
 *     JS HTTP client is request-scoped (fetch), so `ensureClient` returns the
 *     client directly. The retryable-method table is preserved for reference.
 */

export type OpenVikingRecord = string;

/** A single OpenViking message "part" (protocol payload, snake_case keys). */
export interface OpenVikingPart {
  type: string;
  text?: string;
  uri?: string;
  context_type?: string;
  abstract?: string;
  tool_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: string;
  tool_status?: string;
  [key: string]: unknown;
}

export interface OpenVikingMessage {
  id?: string;
  role: string;
  parts: OpenVikingPart[];
  created_at?: string;
  peer_id?: string;
  [key: string]: unknown;
}

export interface OpenVikingResultItem {
  uri?: string;
  level?: number | null;
  abstract?: string;
  overview?: string;
  category?: string | null;
  score?: number | null;
  match_reason?: string;
  [key: string]: unknown;
}

export interface OpenVikingFindResult {
  memories?: OpenVikingResultItem[];
  resources?: OpenVikingResultItem[];
  skills?: OpenVikingResultItem[];
  total?: number;
}

/**
 * Minimal structural type implemented by both the in-memory and HTTP clients.
 * Every method takes an options object; methods may be sync or async.
 */
export interface OpenVikingClientLike {
  _initialized?: boolean;
  initialize?(): void | Promise<void>;
  close?(): void | Promise<void>;
  [method: string]: any;
}

// Methods that are safe to retry once after a recoverable transport error.
export const RETRYABLE_READ_METHODS = new Set<string>([
  'abstract',
  'archive_expand',
  'archive_search',
  'find',
  'get_session',
  'get_session_archive',
  'get_session_context',
  'get_status',
  'glob',
  'health',
  'is_healthy',
  'ls',
  'overview',
  'read',
  'relations',
  'search',
  'session_exists',
  'stat',
]);

export class OptionalDependencyError extends Error {}

export function missingDependency(extra: string, pkg?: string): OptionalDependencyError {
  const name = pkg ?? extra;
  return new OptionalDependencyError(
    `${name} is required for this OpenViking integration. ` +
      `Install it with \`npm install ${name}\`.`,
  );
}

/** Connection settings for lazily creating an OpenViking client. */
export interface OpenVikingConnection {
  client?: OpenVikingClientLike | null;
  url?: string | null;
  apiKey?: string | null;
  account?: string | null;
  user?: string | null;
  userId?: string | null;
  actorPeerId?: string | null;
  path?: string | null;
  timeout?: number | null;
  extraHeaders?: Record<string, string> | null;
  autoInitialize?: boolean;
}

export type CommitMode = 'never' | 'always' | 'pending_tokens';

/** Commit behavior for OpenViking-backed agent sessions. */
export interface OpenVikingCommitPolicy {
  mode?: CommitMode;
  pendingTokenThreshold?: number;
}

export function commitPolicy(
  policy: OpenVikingCommitPolicy = {},
): Required<OpenVikingCommitPolicy> {
  return {
    mode: policy.mode ?? 'never',
    pendingTokenThreshold: policy.pendingTokenThreshold ?? 8_000,
  };
}

/**
 * Resolve a usable OpenViking client from explicit or connection settings.
 * The async recovery handle from Python is collapsed: examples pass an explicit
 * in-memory client, and the HTTP client (when used) is request-scoped.
 */
export async function ensureClient(
  connection: OpenVikingConnection,
): Promise<OpenVikingClientLike> {
  let client = connection.client ?? null;
  if (client == null) {
    client = await createClientFromConnection(connection);
  } else if (connection.autoInitialize !== false && typeof client.initialize === 'function') {
    if (!client._initialized) {
      await client.initialize();
    }
  }
  return client;
}

async function createClientFromConnection(
  connection: OpenVikingConnection,
): Promise<OpenVikingClientLike> {
  // Only the HTTP client is portable to JS; there is no embedded variant.
  const { SyncHTTPClient } = await import('./http_client.js');
  const client = new SyncHTTPClient({
    url: connection.url ?? undefined,
    apiKey: connection.apiKey ?? undefined,
    account: connection.account ?? undefined,
    user: connection.user ?? undefined,
    userId: connection.userId ?? undefined,
    actorPeerId: connection.actorPeerId ?? undefined,
    timeout: connection.timeout ?? undefined,
    extraHeaders: connection.extraHeaders ?? undefined,
  });
  if (connection.autoInitialize !== false && !client._initialized) {
    await client.initialize();
  }
  return client;
}

/** Apply the configured session commit policy. Returns the commit result or null. */
export async function applyCommitPolicy(
  client: OpenVikingClientLike,
  sessionId: string,
  policy: OpenVikingCommitPolicy | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (policy == null) return null;
  const resolved = commitPolicy(policy);
  if (resolved.mode === 'never') return null;
  if (resolved.mode === 'always') {
    return callOpenviking(client, 'commit_session', { sessionId });
  }
  if (resolved.mode !== 'pending_tokens') {
    throw new Error(`Unsupported OpenViking commit policy: ${resolved.mode}`);
  }

  let session: any;
  try {
    session = await callOpenviking(client, 'get_session', { sessionId, autoCreate: false });
  } catch {
    // Skip the pending-token commit when session lookup fails.
    return null;
  }
  const pendingTokens = Number(itemValue(session, 'pending_tokens', 0) ?? 0);
  if (pendingTokens < resolved.pendingTokenThreshold) return null;
  return callOpenviking(client, 'commit_session', { sessionId });
}

/**
 * Call a client method by name, dropping `undefined` option fields (the JS
 * analog of Python's None-kwarg filtering). Awaits sync or async results.
 */
export async function callOpenviking(
  client: OpenVikingClientLike,
  methodName: string,
  args: Record<string, unknown> = {},
): Promise<any> {
  const method = client[methodName];
  if (typeof method !== 'function') {
    throw new TypeError(`OpenViking client has no method "${methodName}"`);
  }
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) filtered[key] = value;
  }
  return method.call(client, filtered);
}

/** Normalize OpenViking retrieval results into named context groups. */
export function resultGroups(result: any): Array<[string, any[]]> {
  if (result == null) return [];
  return [
    ['memory', [...(result.memories ?? [])]],
    ['resource', [...(result.resources ?? [])]],
    ['skill', [...(result.skills ?? [])]],
  ];
}

export function itemValue(item: any, key: string, fallback: any = null): any {
  if (item == null) return fallback;
  const value = item[key];
  return value === undefined ? fallback : value;
}

export function* iterResultItems(
  result: any,
  contextTypes: Iterable<string> = ['memory', 'resource', 'skill'],
): Generator<[string, any]> {
  const allowed = new Set(contextTypes);
  for (const [contextType, items] of resultGroups(result)) {
    if (!allowed.has(contextType)) continue;
    for (const item of items) {
      yield [contextType, item];
    }
  }
}

export function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

export function stringify(value: unknown, maxChars = 12_000): string {
  let text: string;
  if (value == null) {
    text = '';
  } else if (typeof value === 'string') {
    text = value;
  } else {
    text = JSON.stringify(value, null, 2);
  }
  if (maxChars > 0 && text.length > maxChars) {
    return text.slice(0, maxChars) + '\n...[truncated]';
  }
  return text;
}

/** Extract text from LangChain/OpenAI-style message content. */
export function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const chunks: string[] = [];
    for (const block of content) {
      if (typeof block === 'string') {
        chunks.push(block);
      } else if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          chunks.push(b.text);
        } else if (typeof b.content === 'string') {
          chunks.push(b.content);
        }
      }
    }
    return chunks.filter(Boolean).join('\n');
  }
  if (content == null) return '';
  return String(content);
}

/** Return the role of a LangChain message object or message dict. */
export function messageType(message: any): string {
  if (message == null) return '';
  if (typeof message._getType === 'function') return message._getType();
  if (typeof message === 'object') {
    return String((message as any).type ?? (message as any).role ?? '');
  }
  return '';
}

/** Return the text of the most recent human/user message in a list. */
export function getLatestUserText(messages: Iterable<any>): string {
  const list = [...messages];
  for (let i = list.length - 1; i >= 0; i--) {
    const message = list[i];
    const role = messageType(message);
    const content = message?.content ?? '';
    if (role === 'human' || role === 'user') {
      const text = extractMessageText(content).trim();
      if (text) return text;
    }
  }
  return '';
}

/** Lightweight token estimate (~4 chars/token), mirroring the heuristic used by the in-memory client. */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Trim a peer id, returning null when empty. */
export function normalizePeerId(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}
