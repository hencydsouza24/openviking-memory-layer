// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * Deterministic test utilities for framework smoke tests.
 *
 * TypeScript port of `openviking/integrations/langchain/testing.py`.
 *
 * Method names are kept snake_case to match the protocol method strings used by
 * `callOpenviking` (e.g. `create_session`, `add_message`). Option objects use
 * camelCase keys (e.g. `targetUri`, `scoreThreshold`), matching the call sites.
 */

import { estimateTextTokens, normalizePeerId } from './client.js';
import type { OpenVikingMessage, OpenVikingPart } from './client.js';

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}${counter.toString(16).padStart(8, '0')}`;
}

function messageText(message: OpenVikingMessage): string {
  const chunks: string[] = [];
  for (const part of message.parts ?? []) {
    if (part.type === 'text' && part.text) chunks.push(String(part.text));
    else if (part.type === 'context' && part.abstract) chunks.push(String(part.abstract));
    else if (part.type === 'tool' && part.tool_output) chunks.push(String(part.tool_output));
  }
  return chunks.join('\n');
}

export interface FindArgs {
  query: string;
  targetUri?: string | string[];
  limit?: number;
  scoreThreshold?: number | null;
  filter?: Record<string, unknown> | null;
}

export interface SearchArgs extends FindArgs {
  sessionId?: string | null;
}

/**
 * Small OpenViking-compatible client for examples and CI smoke tests.
 *
 * It implements only the OpenViking methods used by the LangChain/LangGraph
 * adapters. It is not a replacement for OpenViking.
 */
export class InMemoryOpenVikingClient {
  records: Record<string, string>;
  sessions: Record<string, OpenVikingMessage[]> = {};
  archives: Record<string, any[]> = {};
  pendingTokens: Record<string, number> = {};
  findCalls: any[] = [];
  searchCalls: any[] = [];
  _initialized = false;

  constructor(records: Record<string, string> = {}) {
    this.records = { ...records };
  }

  initialize(): void {
    this._initialized = true;
  }

  close(): void {
    this._initialized = false;
  }

  find(args: FindArgs): any {
    const { query, targetUri = '', limit = 10, scoreThreshold = null } = args;
    this.findCalls.push({ ...args });
    return this._search(query, targetUri, limit, scoreThreshold);
  }

  search(args: SearchArgs): any {
    const { query, targetUri = '', sessionId = null, limit = 10, scoreThreshold = null } = args;
    this.searchCalls.push({ ...args });
    const sessionText = (this.sessions[sessionId ?? ''] ?? [])
      .map((message) => messageText(message))
      .join(' ');
    return this._search(`${query} ${sessionText}`, targetUri, limit, scoreThreshold);
  }

  private _search(
    query: string,
    targetUri: string | string[],
    limit: number,
    scoreThreshold: number | null,
  ): any {
    const rawTargets = typeof targetUri === 'string' ? [targetUri] : [...targetUri];
    const targets = rawTargets.filter(Boolean).map((t) => t.replace(/\/+$/, ''));
    const tokens = new Set(
      (query.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((t) => t.length > 1),
    );
    const scored: Array<[number, string, string]> = [];
    for (const [uri, content] of Object.entries(this.records)) {
      if (targets.length && !targets.some((target) => uri.startsWith(target))) continue;
      const haystack = `${uri}\n${content}`.toLowerCase();
      let score = 0;
      for (const token of tokens) if (haystack.includes(token)) score += 1;
      if (score === 0 && tokens.size) continue;
      const normalized = score || 1;
      if (scoreThreshold != null && normalized < scoreThreshold) continue;
      scored.push([normalized, uri, content]);
    }
    scored.sort((a, b) => (b[0] - a[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    const result: any = { memories: [], resources: [], skills: [], total: 0 };
    for (const [score, uri, content] of scored.slice(0, limit)) {
      const item = {
        uri,
        level: 2,
        abstract: content.slice(0, 240),
        overview: content,
        score,
        match_reason: 'deterministic token match',
      };
      if (uri.includes('/skills/')) result.skills.push(item);
      else if (uri.includes('/memories/')) result.memories.push(item);
      else result.resources.push(item);
    }
    result.total = result.memories.length + result.resources.length + result.skills.length;
    return result;
  }

  read(args: { uri: string; offset?: number; limit?: number }): string {
    const { uri, offset = 0, limit = -1 } = args;
    if (!(uri in this.records)) throw new FileNotFoundError(uri);
    if (offset || limit >= 0) {
      const lines = this.records[uri].split('\n');
      const end = limit < 0 ? undefined : offset + limit;
      return lines.slice(offset, end).join('\n');
    }
    return this.records[uri];
  }

  abstract(args: { uri: string }): string {
    return this.read({ uri: args.uri }).slice(0, 240);
  }

  overview(args: { uri: string }): string {
    return this.read({ uri: args.uri });
  }

  write(args: {
    uri: string;
    content: string;
    mode?: string;
    wait?: boolean;
    timeout?: number | null;
  }): any {
    const { uri, content, mode = 'replace' } = args;
    if (mode === 'create' && uri in this.records) throw new FileExistsError(uri);
    if (mode === 'replace' && !(uri in this.records)) throw new FileNotFoundError(uri);
    if (mode === 'append') this.records[uri] = (this.records[uri] ?? '') + content;
    else this.records[uri] = content;
    return { uri, mode, content_updated: true };
  }

  mkdir(_args: { uri: string; description?: string | null }): null {
    return null;
  }

  rm(args: { uri: string; recursive?: boolean }): void {
    const { uri, recursive = false } = args;
    if (recursive) {
      const prefix = uri.replace(/\/+$/, '') + '/';
      for (const key of Object.keys(this.records)) {
        if (key === uri || key.startsWith(prefix)) delete this.records[key];
      }
      return;
    }
    delete this.records[uri];
  }

  ls(args: { uri: string; simple?: boolean; recursive?: boolean }): any[] {
    const { uri, simple = false, recursive = false } = args;
    const prefix = uri.replace(/\/+$/, '') + '/';
    const seen = new Set<string>();
    const values: any[] = [];
    for (const key of Object.keys(this.records).sort()) {
      if (!key.startsWith(prefix)) continue;
      let rel = key.slice(prefix.length);
      if (!recursive && rel.includes('/')) rel = rel.split('/', 1)[0];
      const childUri = prefix + rel;
      if (seen.has(childUri)) continue;
      seen.add(childUri);
      values.push(simple ? childUri : { uri: childUri, rel_path: rel });
    }
    return values;
  }

  glob(args: { pattern: string; uri?: string }): any {
    const { pattern, uri = 'viking://' } = args;
    const prefix = uri.replace(/\/+$/, '') + '/';
    const regex = globToRegExp(pattern);
    const matches: string[] = [];
    for (const key of Object.keys(this.records).sort()) {
      if (!key.startsWith(prefix)) continue;
      const rel = key.slice(prefix.length);
      if (regex.test(rel)) matches.push(key);
    }
    return { matches, count: matches.length };
  }

  grep(args: {
    uri: string;
    pattern: string;
    caseInsensitive?: boolean;
    nodeLimit?: number | null;
  }): any {
    const { uri, pattern, caseInsensitive = false, nodeLimit = null } = args;
    const regex = new RegExp(pattern, caseInsensitive ? 'i' : '');
    const prefix = uri.replace(/\/+$/, '') + '/';
    const matches: any[] = [];
    for (const [key, content] of Object.entries(this.records).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (key !== uri && !key.startsWith(prefix)) continue;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({ uri: key, line_number: i + 1, line: lines[i] });
          if (nodeLimit && matches.length >= nodeLimit) return { matches, count: matches.length };
        }
      }
    }
    return { matches, count: matches.length };
  }

  create_session(args: { sessionId?: string | null } = {}): any {
    const sessionId = args.sessionId || uid('session-');
    if (!(sessionId in this.sessions)) this.sessions[sessionId] = [];
    return { session_id: sessionId, uri: InMemoryOpenVikingClient.sessionUri(sessionId) };
  }

  static sessionUri(sessionId: string): string {
    return `viking://user/default/sessions/${sessionId}`;
  }

  add_message(args: {
    sessionId: string;
    role: string;
    content?: string | null;
    parts?: OpenVikingPart[] | null;
    createdAt?: string | null;
    peerId?: string | null;
  }): any {
    const { sessionId, role, content = null, parts = null, createdAt = null, peerId = null } = args;
    const messageParts: OpenVikingPart[] = parts
      ? [...parts]
      : [{ type: 'text', text: content ?? '' }];
    const normalizedPeerId = normalizePeerId(peerId);
    const message: OpenVikingMessage = {
      id: uid('msg_'),
      role,
      parts: messageParts,
      created_at: createdAt ?? new Date(0).toISOString(),
    };
    if (normalizedPeerId != null) message.peer_id = normalizedPeerId;
    (this.sessions[sessionId] ??= []).push(message);
    this.pendingTokens[sessionId] =
      (this.pendingTokens[sessionId] ?? 0) + Math.max(1, estimateTextTokens(messageText(message)));
    return { session_id: sessionId, role, message_count: this.sessions[sessionId].length };
  }

  batch_add_messages(args: { sessionId: string; messages: any[] }): any {
    const { sessionId, messages } = args;
    let added = 0;
    for (const message of messages) {
      this.add_message({
        sessionId,
        role: message.role,
        content: message.content,
        parts: message.parts,
        createdAt: message.created_at,
        peerId: message.peer_id,
      });
      added += 1;
    }
    return { session_id: sessionId, message_count: (this.sessions[sessionId] ?? []).length, added };
  }

  get_session(args: { sessionId: string; autoCreate?: boolean }): any {
    const { sessionId, autoCreate = false } = args;
    if (autoCreate) this.create_session({ sessionId });
    return {
      session_id: sessionId,
      uri: InMemoryOpenVikingClient.sessionUri(sessionId),
      message_count: (this.sessions[sessionId] ?? []).length,
      pending_tokens: this.pendingTokens[sessionId] ?? 0,
    };
  }

  get_session_context(args: { sessionId: string; tokenBudget?: number }): any {
    const { sessionId } = args;
    const archiveList = this.archives[sessionId] ?? [];
    const latest = archiveList.length ? archiveList[archiveList.length - 1] : {};
    const messages = [...(this.sessions[sessionId] ?? [])];
    const activeTokens = messages.reduce(
      (sum, message) => sum + Math.max(1, estimateTextTokens(messageText(message))),
      0,
    );
    const archiveTokens = Math.max(0, estimateTextTokens(String(latest.overview ?? '')));
    return {
      latest_archive_overview: latest.overview ?? '',
      pre_archive_abstracts: archiveList.slice(0, -1).map((archive) => ({
        archive_id: archive.archive_id,
        abstract: archive.abstract,
      })),
      messages,
      estimatedTokens: activeTokens + archiveTokens,
      stats: {
        totalArchives: archiveList.length,
        includedArchives: Object.keys(latest).length ? 1 : 0,
        droppedArchives: 0,
        failedArchives: 0,
        activeTokens,
        archiveTokens,
      },
    };
  }

  get_session_archive(args: { sessionId: string; archiveId: string }): any {
    const { sessionId, archiveId } = args;
    for (const archive of this.archives[sessionId] ?? []) {
      if (archive.archive_id === archiveId) return { ...archive };
    }
    throw new FileNotFoundError(archiveId);
  }

  commit_session(args: { sessionId: string }): any {
    const { sessionId } = args;
    const messages = [...(this.sessions[sessionId] ?? [])];
    this.archives[sessionId] ??= [];
    const archiveId = `archive_${String(this.archives[sessionId].length + 1).padStart(3, '0')}`;
    const overview = messages.map((message) => messageText(message)).join('\n');
    if (messages.length) {
      const archiveUri = `${InMemoryOpenVikingClient.sessionUri(sessionId)}/history/${archiveId}`;
      this.archives[sessionId].push({
        archive_id: archiveId,
        abstract: overview.slice(0, 240),
        overview,
        messages,
      });
      this.records[`${archiveUri}/messages.jsonl`] =
        messages.map((message) => messageText(message)).join('\n') + '\n';
      this.records[`${archiveUri}/.abstract.md`] = overview.slice(0, 240);
      this.records[`${archiveUri}/.overview.md`] = overview;
      this.records[`${archiveUri}/.done`] = '{}';
    }
    this.sessions[sessionId] = [];
    this.pendingTokens[sessionId] = 0;
    return {
      session_id: sessionId,
      status: 'completed',
      archive_id: messages.length ? archiveId : null,
      archived: messages.length > 0,
    };
  }

  delete_session(args: { sessionId: string }): void {
    const { sessionId } = args;
    delete this.sessions[sessionId];
    delete this.archives[sessionId];
    delete this.pendingTokens[sessionId];
    const sessionUri = InMemoryOpenVikingClient.sessionUri(sessionId);
    for (const uri of Object.keys(this.records)) {
      if (uri === sessionUri || uri.startsWith(`${sessionUri}/`)) delete this.records[uri];
    }
  }

  add_resource(args: { path: string; to?: string | null }): any {
    const { path, to = null } = args;
    const uri = to || `viking://resources/${path.replace(/\/+$/, '').split('/').pop()}`;
    if (!(uri in this.records)) this.records[uri] = `Resource imported from ${path}`;
    return { status: 'completed', root_uri: uri };
  }

  add_skill(args: { data: any }): any {
    const { data } = args;
    const name = data && typeof data === 'object' ? data.name ?? 'skill' : 'skill';
    const uri = `viking://user/skills/${name}.md`;
    this.records[uri] = String(typeof data === 'object' ? JSON.stringify(data) : data);
    return { status: 'completed', uri, name };
  }

  get_status(): any {
    return { healthy: true, backend: 'in-memory' };
  }

  is_healthy(): boolean {
    return true;
  }
}

export class FileNotFoundError extends Error {
  code = 'NOT_FOUND';
}
export class FileExistsError extends Error {
  code = 'ALREADY_EXISTS';
}

function globToRegExp(pattern: string): RegExp {
  // fnmatch semantics: * matches within a path segment boundary loosely, ? one char.
  let out = '^';
  for (const ch of pattern) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  out += '$';
  return new RegExp(out);
}
