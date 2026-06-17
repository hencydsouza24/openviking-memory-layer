// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * LangGraph agent middleware for OpenViking recall and capture.
 *
 * TypeScript port of `openviking/integrations/langchain/middleware.py`.
 *
 * Python extended `langchain.agents.middleware.AgentMiddleware`. The JS examples
 * drive the extension points (`wrapModelCall`, `afterAgent`) directly inside a
 * graph node, so this is a plain class exposing those methods. The lifecycle is
 * identical: recall before the model call, optional capture after the agent.
 */

import { AIMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

import {
  applyCommitPolicy,
  callOpenviking,
  commitPolicy as resolveCommitPolicy,
  ensureClient,
  extractMessageText,
  getLatestUserText,
  messageType,
} from './client.js';
import type {
  OpenVikingClientLike,
  OpenVikingCommitPolicy,
  OpenVikingConnection,
  OpenVikingPart,
} from './client.js';
import {
  OPENVIKING_CONTEXT_MARKER,
  OpenVikingSessionContextAssembler,
} from './context.js';
import { langchainMessageToOpenviking } from './history.js';
import { OpenVikingRetriever } from './retrievers.js';

const SESSION_ID_ERROR =
  'OpenVikingContextMiddleware requires a LangGraph session id. Pass ' +
  "config={ configurable: { thread_id: '...' } }, set state.session_id, " +
  'or provide sessionIdResolver.';

export interface ModelRequestLike {
  state?: Record<string, any>;
  runtime?: any;
  messages: BaseMessage[];
  systemMessage?: BaseMessage | null;
  override(overrides: { messages?: BaseMessage[]; systemMessage?: BaseMessage | null }): ModelRequestLike;
}

export interface OpenVikingContextMiddlewareParams extends OpenVikingConnection {
  retriever?: OpenVikingRetriever | null;
  targetUri?: string | string[];
  limit?: number;
  peerId?: string | null;
  scoreThreshold?: number | null;
  tokenBudget?: number;
  sessionIdResolver?: (state: Record<string, any>, runtime: any) => string;
  peerIdResolver?: (state: Record<string, any>, runtime: any) => string | null;
  captureOnAfterAgent?: boolean;
  commitOnAfterAgent?: boolean;
  commitPolicy?: OpenVikingCommitPolicy | null;
  recallHeader?: string;
  includeActiveMessages?: boolean;
}

export class OpenVikingContextMiddleware {
  private connection: OpenVikingConnection;
  retriever: OpenVikingRetriever;
  assembler: OpenVikingSessionContextAssembler;
  sessionIdResolver?: (state: Record<string, any>, runtime: any) => string;
  peerId: string | null;
  peerIdResolver?: (state: Record<string, any>, runtime: any) => string | null;
  captureOnAfterAgent: boolean;
  commitPolicy: OpenVikingCommitPolicy | null;
  recallHeader: string;

  private capturedSignatures = new Map<string, string[]>();
  private pendingContextParts = new Map<string, OpenVikingPart[]>();

  constructor(params: OpenVikingContextMiddlewareParams = {}) {
    const {
      targetUri = '',
      limit = 5,
      peerId = null,
      scoreThreshold = null,
      tokenBudget = 128_000,
      captureOnAfterAgent = true,
      commitOnAfterAgent = false,
      recallHeader = 'Relevant OpenViking context:',
      includeActiveMessages = false,
    } = params;

    this.connection = {
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
    this.retriever =
      params.retriever ??
      new OpenVikingRetriever({
        ...this.connection,
        targetUri,
        limit,
        scoreThreshold,
        searchMode: 'search',
      });
    this.assembler = new OpenVikingSessionContextAssembler({
      ...this.connection,
      retriever: this.retriever,
      targetUri,
      limit,
      scoreThreshold,
      tokenBudget,
      includeSessionContext: true,
      includeActiveMessages,
      includeRecall: true,
      recallHeader,
    });
    this.sessionIdResolver = params.sessionIdResolver;
    this.peerId = peerId;
    this.peerIdResolver = params.peerIdResolver;
    this.captureOnAfterAgent = captureOnAfterAgent;
    this.commitPolicy = params.commitPolicy ?? null;
    if (commitOnAfterAgent && this.commitPolicy == null) {
      this.commitPolicy = { mode: 'always' };
    }
    this.recallHeader = recallHeader;
  }

  async wrapModelCall(
    request: ModelRequestLike,
    handler: (request: ModelRequestLike) => BaseMessage | Promise<BaseMessage>,
  ): Promise<BaseMessage> {
    const query = getLatestUserText(request.messages);
    if (!query) return handler(request);
    const sessionId = this.resolveSessionId(request.state ?? {}, request.runtime);
    const peerId = this.resolvePeerId(request.state ?? {}, request.runtime);
    const pendingKey = captureKey(sessionId, peerId);
    this.pendingContextParts.delete(pendingKey);
    const assembled = await this.assembler.assemble({ sessionId, query });
    const contextBlock = assembled.block;
    if (!contextBlock) return handler(request);
    if (assembled.contextParts.length) {
      this.pendingContextParts.set(pendingKey, assembled.contextParts);
    }

    const systemMessage = request.systemMessage;
    let updatedSystem: SystemMessage;
    if (systemMessage == null) {
      updatedSystem = new SystemMessage(contextBlock);
    } else {
      const content = extractMessageText(systemMessage.content);
      updatedSystem = new SystemMessage(`${content}\n\n${contextBlock}`.trim());
    }
    try {
      return await handler(request.override({ systemMessage: updatedSystem }));
    } catch (error) {
      this.pendingContextParts.delete(pendingKey);
      throw error;
    }
  }

  async afterAgent(state: Record<string, any>, runtime: any): Promise<null> {
    if (!this.captureOnAfterAgent) return null;
    const messages = [...(state.messages ?? [])];
    if (!messages.length) return null;
    const sessionId = this.resolveSessionId(state, runtime);
    const peerId = this.resolvePeerId(state, runtime);
    const key = captureKey(sessionId, peerId);
    const previousSignatures = this.capturedSignatures.get(key) ?? [];
    const currentSignatures = messages.map((message) => messageSignature(message));

    if (signaturesEqual(currentSignatures, previousSignatures)) {
      this.pendingContextParts.delete(key);
      return null;
    }
    let start = 0;
    if (
      previousSignatures.length &&
      currentSignatures.length > previousSignatures.length &&
      signaturesEqual(currentSignatures.slice(0, previousSignatures.length), previousSignatures)
    ) {
      start = previousSignatures.length;
    }

    const client = await ensureClient(this.connection);
    let added = 0;
    let pendingContextParts = [...(this.pendingContextParts.get(key) ?? [])];
    this.pendingContextParts.delete(key);
    for (const message of messages.slice(start)) {
      if (messageContent(message).includes(OPENVIKING_CONTEXT_MARKER)) continue;
      for (const payload of langchainMessageToOpenviking(message)) {
        if (pendingContextParts.length && payload.role === 'assistant') {
          payload.parts.push(...pendingContextParts);
          pendingContextParts = [];
        }
        await callOpenviking(client, 'add_message', {
          sessionId,
          role: payload.role,
          parts: payload.parts,
          peerId,
        });
        added += 1;
      }
    }
    this.capturedSignatures.set(key, currentSignatures);
    if (added) await applyCommitPolicy(client, sessionId, this.commitPolicy);
    return null;
  }

  private resolveSessionId(state: Record<string, any>, runtime: any): string {
    if (this.sessionIdResolver) {
      const resolved = normalizeSessionId(this.sessionIdResolver(state, runtime));
      if (resolved) return resolved;
      throw new Error(SESSION_ID_ERROR);
    }
    const candidates = [
      state.thread_id,
      state.session_id,
      nestedGet(runtime?.context, 'thread_id'),
      nestedGet(runtime?.config, 'configurable', 'thread_id'),
      nestedGet(runtime?.config, 'configurable', 'session_id'),
    ];
    for (const candidate of candidates) {
      const resolved = normalizeSessionId(candidate);
      if (resolved) return resolved;
    }
    throw new Error(SESSION_ID_ERROR);
  }

  private resolvePeerId(state: Record<string, any>, runtime: any): string | null {
    if (this.peerIdResolver) return normalizePeerIdLocal(this.peerIdResolver(state, runtime));
    const candidates = [
      state.peer_id,
      state.peerId,
      nestedGet(runtime?.context, 'peer_id'),
      nestedGet(runtime?.context, 'peerId'),
      nestedGet(runtime?.config, 'configurable', 'peer_id'),
      nestedGet(runtime?.config, 'configurable', 'peerId'),
      this.peerId,
    ];
    for (const candidate of candidates) {
      const resolved = normalizePeerIdLocal(candidate);
      if (resolved) return resolved;
    }
    return null;
  }
}

function nestedGet(value: any, ...keys: string[]): any {
  let current = value;
  for (const key of keys) {
    if (current == null) return null;
    current = current[key];
  }
  return current ?? null;
}

function normalizeSessionId(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizePeerIdLocal(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function captureKey(sessionId: string, peerId: string | null): string {
  return `${sessionId} ${peerId ?? ''}`;
}

function messageRole(message: any): string {
  const type = messageType(message);
  if (type === 'human') return 'user';
  if (type === 'ai') return 'assistant';
  if (type) return type;
  if (message && typeof message === 'object') {
    const role = String(message.role ?? message.type ?? '');
    return ({ human: 'user', ai: 'assistant' } as Record<string, string>)[role] ?? role;
  }
  return '';
}

function messageContent(message: any): string {
  if (message && typeof message === 'object' && !message._getType) {
    return extractMessageText(message.content);
  }
  return extractMessageText(message?.content ?? '');
}

function messageStableId(message: any): string | null {
  const value = message?.id;
  return value ? String(value) : null;
}

function messageToolCalls(message: any): any {
  if (message instanceof AIMessage) {
    let calls = (message as AIMessage).tool_calls ?? [];
    if (!calls.length) {
      calls = ((message as any).additional_kwargs ?? {}).tool_calls ?? [];
    }
    return calls;
  }
  return message?.tool_calls ?? [];
}

function messageToolResult(message: any): Record<string, any> {
  const type = messageType(message);
  if (type === 'tool') {
    return {
      tool_call_id: message?.tool_call_id ?? null,
      name: message?.name ?? null,
      status: message?.status ?? null,
    };
  }
  return {
    tool_call_id: message?.tool_call_id ?? null,
    name: message?.name ?? null,
    status: message?.status ?? null,
  };
}

function messageSignature(message: any): string {
  return stableJson({
    id: messageStableId(message),
    role: messageRole(message),
    content: messageContent(message),
    tool_calls: messageToolCalls(message),
    tool_result: messageToolResult(message),
  });
}

function signaturesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function stableJson(value: any): string {
  return JSON.stringify(value, Object.keys(flatten(value)).sort());
}

function flatten(value: any, out: Record<string, true> = {}): Record<string, true> {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      out[key] = true;
      flatten(value[key], out);
    }
  }
  return out;
}

// Silence unused warnings for the commit-policy resolver kept for parity.
void resolveCommitPolicy;
