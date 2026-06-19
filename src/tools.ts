// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * LangChain tool factory for OpenViking primitives.
 *
 * TypeScript port of `openviking/integrations/langchain/tools.py`.
 *
 * Tool names use the `viking_*` prefix so models see the same conceptual
 * operations OpenViking users know from plugins and MCP. Tool *schema* fields
 * are camelCased (`targetUri`, `minScore`) per JS convention; the underlying
 * client calls still use the protocol method names.
 *
 * `viking_add_resource` keeps a lighter local-path resolver than the Python
 * version (no filesystem existence probing). The examples never exercise it.
 */

import { tool } from '@langchain/core/tools';
import type { ClientTool } from '@langchain/core/tools';
import { z } from 'zod';

import {
  callOpenviking,
  compactJson,
  ensureClient,
  itemValue,
  iterResultItems,
  stringify,
} from './client.js';
import type { OpenVikingClientLike, OpenVikingConnection } from './client.js';

export interface CreateOpenVikingToolsParams extends OpenVikingConnection {
  profile?: string;
  peerId?: string | null;
  toolNames?: string[] | null;
  allowForget?: boolean;
}

export function createOpenvikingTools(
  params: CreateOpenVikingToolsParams = {},
): ClientTool[] {
  const { profile = 'agent', peerId = null, toolNames = null, allowForget = false } = params;
  const connection: OpenVikingConnection = {
    client: params.client ?? null,
    url: params.url ?? null,
    apiKey: params.apiKey ?? null,
    account: params.account ?? null,
    user: params.user ?? null,
    userId: params.userId ?? null,
    actorPeerId: params.actorPeerId ?? null,
    path: params.path ?? null,
    timeout: params.timeout,
    extraHeaders: params.extraHeaders ?? null,
    autoInitialize: params.autoInitialize ?? true,
  };

  let cachedClient: OpenVikingClientLike | null = null;
  const getClient = async (): Promise<OpenVikingClientLike> => {
    if (cachedClient == null) cachedClient = await ensureClient(connection);
    return cachedClient;
  };

  const vikingFind = tool(
    async ({ query, targetUri = '', limit = 8, minScore = undefined }) => {
      const result = await callOpenviking(await getClient(), 'find', {
        query,
        targetUri,
        limit,
        scoreThreshold: minScore,
      });
      return formatRetrievalResult(result);
    },
    {
      name: 'viking_find',
      description: 'Run stateless semantic retrieval over OpenViking targets.',
      schema: z.object({
        query: z.string().describe('Natural-language query to match semantically.'),
        targetUri: z.string().optional().describe('Optional OpenViking URI scope to search within.'),
        limit: z.number().optional().describe('Maximum number of matches to return.'),
        minScore: z.number().nullable().optional().describe('Optional backend relevance threshold.'),
      }),
    },
  );

  const vikingSearch = tool(
    async ({ query, targetUri = '', sessionId = undefined, limit = 8, minScore = undefined }) => {
      const result = await callOpenviking(await getClient(), 'search', {
        query,
        targetUri,
        sessionId,
        limit,
        scoreThreshold: minScore,
      });
      return formatRetrievalResult(result);
    },
    {
      name: 'viking_search',
      description: 'Run session-aware semantic retrieval over OpenViking targets.',
      schema: z.object({
        query: z.string().describe('Natural-language query to match semantically.'),
        targetUri: z.string().optional().describe('Optional OpenViking URI scope to search within.'),
        sessionId: z.string().nullable().optional().describe('Optional OpenViking session id.'),
        limit: z.number().optional().describe('Maximum number of matches to return.'),
        minScore: z.number().nullable().optional().describe('Optional backend relevance threshold.'),
      }),
    },
  );

  const vikingBrowse = tool(
    async ({ uri = 'viking://', recursive = false, pattern = undefined }) => {
      const client = await getClient();
      const result = pattern
        ? await callOpenviking(client, 'glob', { pattern, uri })
        : await callOpenviking(client, 'ls', { uri, recursive });
      return stringify(result, 12_000);
    },
    {
      name: 'viking_browse',
      description:
        'List child entries under an OpenViking namespace or directory URI. With a ' +
        'pattern, returns glob matches instead of a direct listing.',
      schema: z.object({
        uri: z.string().optional().describe('OpenViking namespace or directory URI to list.'),
        recursive: z.boolean().optional().describe('Include nested descendants in the listing.'),
        pattern: z.string().nullable().optional().describe('Optional glob pattern.'),
      }),
    },
  );

  const vikingRead = tool(
    async ({ uris, maxChars = 12_000, contentMode = 'read' }) => {
      const client = await getClient();
      const uriList = typeof uris === 'string' ? [uris] : uris;
      const mode = String(contentMode || 'read').toLowerCase().trim();
      const payload: any[] = [];
      for (const uri of uriList) {
        try {
          const content = await callOpenviking(client, mode, { uri });
          payload.push({ uri, content_mode: mode, content: stringify(content, maxChars) });
        } catch (exc) {
          if (!isDirectoryReadError(exc)) throw exc;
          payload.push({
            uri,
            content_mode: mode,
            error: 'directory_uri_not_readable',
            message:
              'This URI is a directory. Use viking_browse on this URI to list children, then ' +
              'call viking_read on file/document URIs.',
          });
        }
      }
      return stringify(payload, maxChars * Math.max(1, uriList.length));
    },
    {
      name: 'viking_read',
      description:
        'Read file/document OpenViking URIs. Directory URIs are not readable; use ' +
        'viking_browse to list children first.',
      schema: z.object({
        uris: z.union([z.string(), z.array(z.string())]).describe('One or more URIs to read.'),
        maxChars: z.number().optional().describe('Maximum characters per URI result.'),
        contentMode: z
          .enum(['abstract', 'overview', 'read'])
          .optional()
          .describe('Content depth: abstract < overview < read.'),
      }),
    },
  );

  const vikingGrep = tool(
    async ({ uri, pattern, caseInsensitive = false, nodeLimit = 20 }) => {
      const result = await callOpenviking(await getClient(), 'grep', {
        uri,
        pattern,
        caseInsensitive,
        nodeLimit,
      });
      return stringify(result, 12_000);
    },
    {
      name: 'viking_grep',
      description: 'Search OpenViking file content with a grep-style pattern.',
      schema: z.object({
        uri: z.string().describe('File/document URI whose content should be searched.'),
        pattern: z.string().describe('Grep-style text or regex pattern to search for.'),
        caseInsensitive: z.boolean().optional().describe('Match without case sensitivity.'),
        nodeLimit: z.number().optional().describe('Maximum matching content nodes to return.'),
      }),
    },
  );

  const vikingStore = tool(
    async ({ messages, sessionId = undefined, commit = true }) => {
      const client = await getClient();
      let activeSession = sessionId;
      if (!activeSession) {
        const created = await callOpenviking(client, 'create_session', {});
        activeSession =
          created && typeof created === 'object' ? created.session_id : String(created);
      }
      const normalized = normalizeMessages(messages);
      for (const message of normalized) {
        await callOpenviking(client, 'add_message', {
          sessionId: activeSession,
          role: message.role,
          content: message.content,
          parts: message.parts,
          peerId,
        });
      }
      const result: Record<string, any> = {
        session_id: activeSession,
        messages_added: normalized.length,
      };
      if (commit) {
        result.commit = await callOpenviking(client, 'commit_session', { sessionId: activeSession });
      }
      return compactJson(result);
    },
    {
      name: 'viking_store',
      description:
        'Append explicit durable memories or conversation messages to an OpenViking session. ' +
        'A write operation for confirmed "remember/save this" workflows.',
      schema: z.object({
        messages: z
          .union([z.string(), z.array(z.record(z.string(), z.any()))])
          .describe('Message text or role/content message objects to append.'),
        sessionId: z.string().nullable().optional().describe('Session id; created when omitted.'),
        commit: z.boolean().optional().describe('Commit the appended messages immediately.'),
      }),
    },
  );

  const vikingArchiveSearch = tool(
    async ({ sessionId, query, archiveId = undefined, tokenBudget = 128_000, maxMatches = 8 }) => {
      const client = await getClient();
      let matches: any;
      if (archiveId) {
        const archive = await callOpenviking(client, 'get_session_archive', { sessionId, archiveId });
        matches = searchArchivePayload(archive, query, maxMatches);
      } else {
        matches = await grepSessionHistory(client, sessionId, query, maxMatches);
        if (matchCount(matches) > 0) return stringify(matches, 12_000);
        const context = await callOpenviking(client, 'get_session_context', { sessionId, tokenBudget });
        matches = searchArchivePayload(context, query, maxMatches);
      }
      return stringify(matches || { matches: [], count: 0 }, 12_000);
    },
    {
      name: 'viking_archive_search',
      description: 'Search committed OpenViking session archive context.',
      schema: z.object({
        sessionId: z.string().describe('Session id whose committed archive context to search.'),
        query: z.string().describe('Natural-language query against committed session context.'),
        archiveId: z.string().nullable().optional().describe('Optional specific archive id.'),
        tokenBudget: z.number().optional().describe('Maximum session context token budget.'),
        maxMatches: z.number().optional().describe('Maximum number of archive matches to return.'),
      }),
    },
  );

  const vikingArchiveExpand = tool(
    async ({ sessionId, archiveId, maxChars = 20_000 }) => {
      const archive = await callOpenviking(await getClient(), 'get_session_archive', {
        sessionId,
        archiveId,
      });
      return stringify(archive, maxChars);
    },
    {
      name: 'viking_archive_expand',
      description: 'Expand one OpenViking session archive by archive id.',
      schema: z.object({
        sessionId: z.string().describe('Session id that owns the archive.'),
        archiveId: z.string().describe('Committed archive id to expand.'),
        maxChars: z.number().optional().describe('Maximum characters in the expanded result.'),
      }),
    },
  );

  const vikingAddResource = tool(
    async ({ path, to = undefined, parent = undefined, reason = '', instruction = '', wait = false, timeout = undefined }) => {
      const result = await callOpenviking(await getClient(), 'add_resource', {
        path,
        to,
        parent,
        reason,
        instruction,
        wait,
        timeout,
      });
      return stringify(result, 8_000);
    },
    {
      name: 'viking_add_resource',
      description: 'Import an explicit resource (URL, repository, file, or local path) into OpenViking.',
      schema: z.object({
        path: z.string().describe('Resource source to import.'),
        to: z.string().nullable().optional().describe('Optional destination OpenViking URI.'),
        parent: z.string().nullable().optional().describe('Optional parent OpenViking URI.'),
        reason: z.string().optional().describe('Short reason for importing this resource.'),
        instruction: z.string().optional().describe('Optional indexing/extraction instruction.'),
        wait: z.boolean().optional().describe('Wait for ingestion to finish before returning.'),
        timeout: z.number().nullable().optional().describe('Optional wait timeout in seconds.'),
      }),
    },
  );

  const vikingAddSkill = tool(
    async ({ data, wait = false, timeout = undefined }) => {
      const result = await callOpenviking(await getClient(), 'add_skill', { data, wait, timeout });
      return stringify(result, 8_000);
    },
    {
      name: 'viking_add_skill',
      description: 'Register a reusable OpenViking skill for trusted admin workflows.',
      schema: z.object({
        data: z.union([z.record(z.string(), z.any()), z.string()]).describe('Skill definition or document.'),
        wait: z.boolean().optional().describe('Wait for skill registration to finish.'),
        timeout: z.number().nullable().optional().describe('Optional wait timeout in seconds.'),
      }),
    },
  );

  const vikingHealth = tool(
    async () => {
      const client = await getClient();
      if (typeof client.get_status === 'function') {
        const status = await callOpenviking(client, 'get_status', {});
        return stringify(formatOpenvikingHealth(status), 8_000);
      }
      if (typeof client.is_healthy === 'function') {
        const healthy = await callOpenviking(client, 'is_healthy', {});
        return compactJson(formatOpenvikingHealth({ healthy }));
      }
      return compactJson(formatOpenvikingHealth({ healthy: true }));
    },
    {
      name: 'viking_health',
      description: 'Check OpenViking health/status for diagnostics.',
      schema: z.object({}),
    },
  );

  const vikingForget = tool(
    async ({ uri, recursive = false }) => {
      await callOpenviking(await getClient(), 'rm', { uri, recursive });
      return compactJson({ removed: uri, recursive });
    },
    {
      name: 'viking_forget',
      description: 'Remove a URI from OpenViking. Only expose this to trusted agents.',
      schema: z.object({
        uri: z.string().describe('OpenViking URI to remove.'),
        recursive: z.boolean().optional().describe('Remove descendants recursively.'),
      }),
    },
  );

  const allTools = {
    viking_find: vikingFind,
    viking_search: vikingSearch,
    viking_browse: vikingBrowse,
    viking_read: vikingRead,
    viking_grep: vikingGrep,
    viking_archive_search: vikingArchiveSearch,
    viking_archive_expand: vikingArchiveExpand,
    viking_store: vikingStore,
    viking_add_resource: vikingAddResource,
    viking_add_skill: vikingAddSkill,
    viking_health: vikingHealth,
    viking_forget: vikingForget,
  };

  const selected = toolNames ?? profileToolNames(profile, allowForget);
  return selected
    .filter((name): name is keyof typeof allTools => name in allTools)
    .map((name) => allTools[name] as ClientTool);
}

function profileToolNames(profile: string, allowForget: boolean): string[] {
  const retrieval = [
    'viking_find',
    'viking_search',
    'viking_browse',
    'viking_read',
    'viking_grep',
    'viking_archive_search',
    'viking_archive_expand',
  ];
  let names: string[];
  if (profile === 'retrieval') {
    names = [...retrieval, 'viking_health'];
  } else if (profile === 'admin') {
    names = [
      ...retrieval,
      'viking_store',
      'viking_add_resource',
      'viking_add_skill',
      'viking_health',
      'viking_forget',
    ];
  } else {
    names = [...retrieval, 'viking_store', 'viking_add_resource', 'viking_add_skill', 'viking_health'];
  }
  if (allowForget && !names.includes('viking_forget')) names.push('viking_forget');
  return names;
}

function isDirectoryReadError(exc: any): boolean {
  const details = exc?.details ?? {};
  return exc?.code === 'INVALID_ARGUMENT' && details.expected === 'file' && details.actual === 'directory';
}

function normalizeMessages(messages: string | Array<Record<string, any>>): any[] {
  if (typeof messages === 'string') {
    return [{ role: 'user', parts: [{ type: 'text', text: messages }] }];
  }
  const normalized: any[] = [];
  for (const message of messages) {
    let role = String(message.role ?? 'user');
    if (!['user', 'assistant', 'system', 'tool'].includes(role)) role = 'user';
    if (message.parts != null) {
      normalized.push({
        role: role === 'system' || role === 'tool' ? 'assistant' : role,
        parts: [...(message.parts ?? [])],
      });
      continue;
    }
    const content = String(message.content ?? '');
    if (role === 'tool') {
      normalized.push({
        role: 'assistant',
        parts: [
          {
            type: 'tool',
            tool_id: String(message.tool_call_id ?? message.id ?? ''),
            tool_name: String(message.name ?? ''),
            tool_output: content,
            tool_status: 'completed',
          },
        ],
      });
    } else if (role === 'system') {
      normalized.push({ role: 'assistant', parts: [{ type: 'text', text: content }] });
    } else {
      normalized.push({ role, parts: [{ type: 'text', text: content }] });
    }
  }
  return normalized;
}

function formatRetrievalResult(result: any): string {
  const lines: string[] = [];
  let index = 0;
  for (const [contextType, item] of iterResultItems(result)) {
    index += 1;
    const uri = itemValue(item, 'uri', '');
    const score = itemValue(item, 'score');
    const abstract = itemValue(item, 'abstract') || itemValue(item, 'overview') || '';
    const scoreText = score == null ? '' : ` score=${score}`;
    lines.push(`[${index}] ${contextType}${scoreText} ${uri}\n${abstract}`.trim());
  }
  if (!lines.length) return 'No OpenViking contexts matched.';
  return lines.join('\n\n');
}

function searchArchivePayload(payload: any, query: string, maxMatches: number): any {
  const tokens = (query.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((t) => t.length > 1);
  const sections = archiveSections(payload);
  const matches: any[] = [];
  for (const [label, text] of sections) {
    const haystack = text.toLowerCase();
    if (tokens.length && !tokens.every((token) => haystack.includes(token))) continue;
    matches.push({ section: label, snippet: snippet(text, tokens) });
    if (matches.length >= maxMatches) break;
  }
  return { matches, count: matches.length };
}

async function grepSessionHistory(
  client: OpenVikingClientLike,
  sessionId: string,
  query: string,
  maxMatches: number,
): Promise<any> {
  const session = await callOpenviking(client, 'get_session', { sessionId, autoCreate: false });
  const sessionUri = itemValue(session, 'uri', `viking://user/sessions/${sessionId}`);
  const historyUri = `${String(sessionUri).replace(/\/+$/, '')}/history`;
  const tokens = archiveQueryTokens(query);
  let result: any;
  try {
    result = await callOpenviking(client, 'grep', {
      uri: historyUri,
      pattern: archiveGrepPattern(query),
      caseInsensitive: true,
      nodeLimit: null,
    });
  } catch {
    return { matches: [], count: 0, source: historyUri };
  }
  return filterGrepResult(result, tokens, maxMatches, historyUri);
}

function matchCount(result: any): number {
  if (!result) return 0;
  for (const key of ['count', 'match_count']) {
    const value = result[key];
    if (value != null) return Number(value || 0);
  }
  const matches = result.matches;
  return Array.isArray(matches) ? matches.length : 0;
}

function archiveGrepPattern(query: string): string {
  const tokens = archiveQueryTokens(query);
  if (!tokens.length) return escapeRegExp(query) || '.*';
  return escapeRegExp(tokens[0]);
}

function archiveQueryTokens(query: string): string[] {
  return (query.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((t) => t.length > 1);
}

function filterGrepResult(result: any, tokens: string[], maxMatches: number, source: string): any {
  const rawMatches = result && typeof result === 'object' ? result.matches ?? [] : result;
  const matches: any[] = [];
  for (const match of Array.isArray(rawMatches) ? rawMatches : []) {
    const text = grepMatchText(match).toLowerCase();
    if (tokens.length && !tokens.every((token) => text.includes(token))) continue;
    matches.push(match);
    if (matches.length >= maxMatches) break;
  }
  const filtered: Record<string, any> = { source };
  if (result && typeof result === 'object') {
    for (const [key, value] of Object.entries(result)) if (key !== 'matches') filtered[key] = value;
  }
  filtered.matches = matches;
  filtered.count = matches.length;
  filtered.match_count = matches.length;
  return filtered;
}

function grepMatchText(match: any): string {
  if (match && typeof match === 'object') {
    return String(match.content || match.line || match.text || match.snippet || '');
  }
  return String(match);
}

function archiveSections(payload: any): Array<[string, string]> {
  const sections: Array<[string, string]> = [];
  if (payload?.overview) {
    sections.push([`archive:${payload.archive_id ?? 'archive'}:overview`, payload.overview]);
  }
  if (payload?.abstract) {
    sections.push([`archive:${payload.archive_id ?? 'archive'}:abstract`, payload.abstract]);
  }
  if (payload?.latest_archive_overview) {
    sections.push(['latest_archive_overview', payload.latest_archive_overview]);
  }
  for (const archive of payload?.pre_archive_abstracts ?? []) {
    sections.push([`archive:${archive.archive_id ?? 'archive'}:abstract`, String(archive.abstract ?? '')]);
  }
  let index = 0;
  for (const message of payload?.messages ?? []) {
    index += 1;
    const textParts: string[] = [];
    for (const part of message.parts ?? []) {
      for (const key of ['text', 'abstract', 'tool_output']) {
        if (part[key]) textParts.push(String(part[key]));
      }
    }
    if (textParts.length) sections.push([`message:${index}:${message.role ?? ''}`, textParts.join('\n')]);
  }
  return sections;
}

function snippet(text: string, tokens: string[], radius = 240): string {
  if (!text) return '';
  const lower = text.toLowerCase();
  const positions = tokens
    .map((token) => lower.indexOf(token))
    .filter((pos) => pos >= 0);
  const start = positions.length ? Math.max(0, Math.min(...positions) - radius) : 0;
  const end = Math.min(text.length, start + radius * 2);
  const prefix = start ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return prefix + text.slice(start, end) + suffix;
}

function formatOpenvikingHealth(status: any): Record<string, any> {
  const state = inferHealthState(status);
  return {
    backend: 'OpenViking',
    healthy: state === 'healthy',
    state,
    note: 'OpenViking is the context memory backend; VikingDB is internal vector/index storage.',
    summary: safeStatusSummary(status),
  };
}

function inferHealthState(status: any): string {
  if (status && typeof status === 'object') {
    for (const key of ['healthy', 'ok']) {
      const value = status[key];
      if (typeof value === 'boolean') return value ? 'healthy' : 'unhealthy';
    }
    const state = String(status.status ?? status.state ?? '').toLowerCase();
    if (['ok', 'healthy', 'ready', 'running'].includes(state)) return 'healthy';
    if (['error', 'failed', 'unhealthy'].includes(state)) return 'unhealthy';
    if (['degraded', 'initializing', 'starting', 'pending'].includes(state)) return state;
  }
  return 'unknown';
}

function safeStatusSummary(status: any): Record<string, any> {
  if (!status || typeof status !== 'object') return { type: typeof status };
  const summary: Record<string, any> = {};
  for (const key of ['healthy', 'ok', 'status', 'state', 'state_detail']) {
    if (key in status) {
      const value = safeStatusValue(status[key]);
      if (value != null) summary[key] = value;
    }
  }
  const components = status.components ?? status.services;
  if (components && (Array.isArray(components) || typeof components === 'object')) {
    summary.component_count = Array.isArray(components)
      ? components.length
      : Object.keys(components).length;
  }
  return Object.keys(summary).length ? summary : { type: 'dict' };
}

function safeStatusValue(value: any): any {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (lowered.includes('://') || lowered.includes('@')) return null;
    return value.length <= 64 ? value : `${value.slice(0, 61)}...`;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
