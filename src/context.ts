// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * High-level OpenViking context lifecycle helpers for LangChain.
 *
 * TypeScript port of `openviking/integrations/langchain/context.py`.
 */

import { SystemMessage } from '@langchain/core/messages';
import { RunnableLambda, RunnableWithMessageHistory } from '@langchain/core/runnables';
import type { Runnable, RunnableConfig } from '@langchain/core/runnables';

import {
  callOpenviking,
  ensureClient,
  extractMessageText,
  getLatestUserText,
} from './client.js';
import type {
  OpenVikingClientLike,
  OpenVikingCommitPolicy,
  OpenVikingConnection,
  OpenVikingPart,
} from './client.js';
import { OpenVikingChatMessageHistory, contextPartsFromDocuments } from './history.js';
import { OpenVikingRetriever } from './retrievers.js';

export const OPENVIKING_CONTEXT_MARKER = '<openviking_context>';

export interface OpenVikingAssembledContext {
  block: string;
  contextParts: OpenVikingPart[];
  sessionContext: Record<string, any>;
  recallDocuments: any[];
}

export interface AssemblerParams extends OpenVikingConnection {
  retriever?: OpenVikingRetriever | null;
  targetUri?: string | string[];
  limit?: number;
  scoreThreshold?: number | null;
  tokenBudget?: number;
  includeSessionContext?: boolean;
  includeActiveMessages?: boolean;
  includeRecall?: boolean;
  recallHeader?: string;
}

/** Assemble session working memory, archive context, and recall results. */
export class OpenVikingSessionContextAssembler {
  private connection: OpenVikingConnection;
  retriever: OpenVikingRetriever;
  tokenBudget: number;
  includeSessionContext: boolean;
  includeActiveMessages: boolean;
  includeRecall: boolean;
  recallHeader: string;
  private clientCache: OpenVikingClientLike | null = null;

  constructor(params: AssemblerParams = {}) {
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
        targetUri: params.targetUri ?? '',
        limit: params.limit ?? 5,
        scoreThreshold: params.scoreThreshold ?? null,
        searchMode: 'search',
      });
    this.tokenBudget = params.tokenBudget ?? 128_000;
    this.includeSessionContext = params.includeSessionContext ?? true;
    this.includeActiveMessages = params.includeActiveMessages ?? true;
    this.includeRecall = params.includeRecall ?? true;
    this.recallHeader = params.recallHeader ?? 'Relevant OpenViking context:';
  }

  async assemble(opts: { sessionId: string; query?: string }): Promise<OpenVikingAssembledContext> {
    const { sessionId, query = '' } = opts;
    const client = await this.getClient();
    await this.ensureSession(client, sessionId);
    const sessionContext = await this.getSessionContext(client, sessionId);
    const recallDocuments = await this.getRecallDocuments(sessionId, query);
    const block = this.formatContextBlock(sessionContext, recallDocuments);
    return {
      block,
      contextParts: contextPartsFromDocuments(recallDocuments),
      sessionContext,
      recallDocuments,
    };
  }

  private async getClient(): Promise<OpenVikingClientLike> {
    if (this.clientCache == null) this.clientCache = await ensureClient(this.connection);
    return this.clientCache;
  }

  private async ensureSession(client: OpenVikingClientLike, sessionId: string): Promise<void> {
    try {
      await callOpenviking(client, 'create_session', { sessionId });
    } catch {
      // ignore
    }
  }

  private async getSessionContext(
    client: OpenVikingClientLike,
    sessionId: string,
  ): Promise<Record<string, any>> {
    if (!this.includeSessionContext) return {};
    try {
      return await callOpenviking(client, 'get_session_context', {
        sessionId,
        tokenBudget: this.tokenBudget,
      });
    } catch {
      return {};
    }
  }

  private async getRecallDocuments(sessionId: string, query: string): Promise<any[]> {
    if (!this.includeRecall || !query) return [];
    try {
      const scoped = retrieverForSession(this.retriever, sessionId);
      return [...(await scoped.invoke(query))];
    } catch {
      return [];
    }
  }

  private formatContextBlock(
    sessionContext: Record<string, any>,
    recallDocuments: any[],
  ): string {
    const sections: string[] = [];
    const latestArchive = String(sessionContext.latest_archive_overview ?? '').trim();
    if (latestArchive) sections.push('Session archive overview:\n' + latestArchive);

    const abstracts: string[] = [];
    for (const archive of sessionContext.pre_archive_abstracts ?? []) {
      const archiveId = archive.archive_id || 'archive';
      const abstract = String(archive.abstract ?? '').trim();
      if (abstract) abstracts.push(`[${archiveId}] ${abstract}`);
    }
    if (abstracts.length) sections.push('Older archive abstracts:\n' + abstracts.join('\n'));

    if (this.includeActiveMessages) {
      const activeMessages = (sessionContext.messages ?? [])
        .map((message: any) => formatSessionMessage(message))
        .filter(Boolean);
      if (activeMessages.length) {
        sections.push('Active session messages:\n' + activeMessages.join('\n'));
      }
    }

    if (recallDocuments.length) {
      const recallLines: string[] = [];
      recallDocuments.forEach((doc, index) => {
        const metadata = doc?.metadata ?? {};
        const uri = metadata.openviking_uri || metadata.source || '';
        recallLines.push(`[${index + 1}] ${uri}\n${doc.pageContent}`.trim());
      });
      sections.push(this.recallHeader + '\n\n' + recallLines.join('\n\n'));
    }

    if (!sections.length) return '';
    return `${OPENVIKING_CONTEXT_MARKER}\n` + sections.join('\n\n') + '\n</openviking_context>';
  }
}

export interface WithOpenVikingContextParams extends OpenVikingConnection {
  sessionId?: string | null;
  peerId?: string | null;
  targetUri?: string | string[];
  limit?: number;
  scoreThreshold?: number | null;
  tokenBudget?: number;
  inputMessagesKey?: string;
  outputMessagesKey?: string;
  historyMessagesKey?: string;
  commitPolicy?: OpenVikingCommitPolicy | null;
  sessionIdConfigKey?: string;
  peerIdConfigKey?: string;
  injectContext?: boolean;
}

/** Wrap a LangChain runnable with OpenViking context and message history. */
export function withOpenvikingContext(
  runnable: Runnable,
  params: WithOpenVikingContextParams = {},
): Runnable {
  const {
    sessionId = null,
    peerId = null,
    targetUri = '',
    limit = 5,
    scoreThreshold = null,
    tokenBudget = 128_000,
    inputMessagesKey,
    outputMessagesKey,
    historyMessagesKey,
    commitPolicy = null,
    sessionIdConfigKey = 'sessionId',
    peerIdConfigKey = 'peerId',
    injectContext = true,
  } = params;

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

  const assembler = new OpenVikingSessionContextAssembler({
    ...connection,
    targetUri,
    limit,
    scoreThreshold,
    tokenBudget,
    includeActiveMessages: false,
    includeRecall: injectContext,
  });

  const pendingContextParts = new Map<string, OpenVikingPart[]>();
  const activePeerIds = new Map<string, string | null>();

  const makeHistory = (activeSessionId: string): OpenVikingChatMessageHistory =>
    new OpenVikingChatMessageHistory({
      ...connection,
      sessionId: activeSessionId,
      peerId,
      peerIdProvider: (currentSessionId) => activePeerIds.get(currentSessionId) ?? peerId,
      tokenBudget,
      commitPolicy,
      contextPartsProvider: (currentSessionId) => {
        const key = pendingKey(currentSessionId, activePeerIds.get(currentSessionId) ?? peerId);
        const parts = pendingContextParts.get(key) ?? [];
        pendingContextParts.delete(key);
        return parts;
      },
    });

  const inject = async (inputValue: any, config?: RunnableConfig): Promise<any> => {
    const resolvedSessionId =
      sessionId ?? sessionIdFromConfig(config, sessionIdConfigKey);
    const resolvedPeerId = peerIdFromConfig(config, peerIdConfigKey, peerId);
    activePeerIds.set(resolvedSessionId, resolvedPeerId);
    if (!injectContext) return inputValue;
    const key = pendingKey(resolvedSessionId, resolvedPeerId);
    pendingContextParts.delete(key);
    const query = latestUserTextFromInput(inputValue, inputMessagesKey);
    const assembled = await assembler.assemble({ sessionId: resolvedSessionId, query });
    if (!assembled.block) return inputValue;
    if (assembled.contextParts.length) pendingContextParts.set(key, assembled.contextParts);
    return injectSystemContext(inputValue, assembled.block, inputMessagesKey);
  };

  const bound = new RunnableLambda({ func: inject }).pipe(runnable);

  const rwmh = new RunnableWithMessageHistory({
    runnable: bound as Runnable,
    getMessageHistory: (resolvedSessionId: string) =>
      makeHistory(validateSessionId(sessionId ?? resolvedSessionId, sessionIdConfigKey)),
    inputMessagesKey,
    outputMessagesKey,
    historyMessagesKey,
  });

  // When the session id is fixed, inject it into config so callers can invoke
  // without supplying `configurable.sessionId` (matches the Python zero-arg
  // history factory behavior).
  return new RunnableLambda({
    func: async (input: any, config?: RunnableConfig) => {
      const merged: RunnableConfig = { ...(config ?? {}) };
      const configurable = { ...(merged.configurable ?? {}) } as Record<string, unknown>;
      if (sessionId != null && configurable[sessionIdConfigKey] == null) {
        configurable[sessionIdConfigKey] = sessionId;
      }
      // RunnableWithMessageHistory (JS) keys history on `sessionId`.
      if (configurable.sessionId == null && configurable[sessionIdConfigKey] != null) {
        configurable.sessionId = configurable[sessionIdConfigKey];
      }
      merged.configurable = configurable;
      return rwmh.invoke(input, merged);
    },
  }) as unknown as Runnable;
}

function sessionIdFromConfig(config: RunnableConfig | undefined, key: string): string {
  const configurable = (config?.configurable ?? {}) as Record<string, unknown>;
  return validateSessionId(configurable[key] ?? configurable.sessionId, key);
}

function peerIdFromConfig(
  config: RunnableConfig | undefined,
  key: string,
  fallback: string | null,
): string | null {
  const configurable = (config?.configurable ?? {}) as Record<string, unknown>;
  const value = configurable[key] ?? fallback;
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function validateSessionId(value: unknown, key: string): string {
  const sessionId = String(value ?? '').trim();
  if (!sessionId) {
    throw new Error(
      `OpenViking dynamic sessions require config={ configurable: { ${key}: '<session-id>' } }. ` +
        "Pass sessionId='...' to withOpenvikingContext for no-config usage.",
    );
  }
  return sessionId;
}

function retrieverForSession(retriever: OpenVikingRetriever, sessionId: string): OpenVikingRetriever {
  if (typeof retriever.clone === 'function') {
    return retriever.clone({ sessionId, searchMode: 'search' });
  }
  return retriever;
}

function pendingKey(sessionId: string, peerId: string | null): string {
  return `${sessionId} ${peerId ?? ''}`;
}

function latestUserTextFromInput(inputValue: any, inputMessagesKey?: string): string {
  const messages = inputMessages(inputValue, inputMessagesKey);
  if (messages.length) return getLatestUserText(messages);
  if (typeof inputValue === 'string') return inputValue;
  if (inputValue && typeof inputValue === 'object') {
    for (const value of Object.values(inputValue)) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return '';
}

function inputMessages(inputValue: any, inputMessagesKey?: string): any[] {
  if (Array.isArray(inputValue)) return [...inputValue];
  if (inputValue && typeof inputValue === 'object') {
    const key = inputMessagesKey || 'messages';
    const value = inputValue[key];
    if (Array.isArray(value)) return [...value];
  }
  return [];
}

function injectSystemContext(inputValue: any, contextBlock: string, inputMessagesKey?: string): any {
  if (Array.isArray(inputValue)) return mergeSystemMessage(inputValue, contextBlock);
  if (inputValue && typeof inputValue === 'object') {
    const key = inputMessagesKey || 'messages';
    if (Array.isArray(inputValue[key])) {
      return { ...inputValue, [key]: mergeSystemMessage(inputValue[key], contextBlock) };
    }
    return { ...inputValue, openviking_context: contextBlock };
  }
  return inputValue;
}

function mergeSystemMessage(messages: any[], contextBlock: string): any[] {
  const updated = [...messages];
  for (let index = 0; index < updated.length; index++) {
    if (updated[index] instanceof SystemMessage) {
      const content = extractMessageText(updated[index].content);
      updated[index] = new SystemMessage(`${content}\n\n${contextBlock}`.trim());
      return updated;
    }
  }
  return [new SystemMessage(contextBlock), ...updated];
}

function formatSessionMessage(message: any): string {
  const role = String(message.role ?? 'assistant');
  const parts = message.parts ?? [];
  const chunks: string[] = [];
  for (const part of parts) {
    if (part.type === 'text' && part.text) {
      chunks.push(String(part.text));
    } else if (part.type === 'context' && part.abstract) {
      chunks.push(`[context] ${part.abstract}`);
    } else if (part.type === 'tool') {
      const toolName = part.tool_name || 'tool';
      const status = part.tool_status || 'completed';
      const output = part.tool_output || '';
      chunks.push(`[tool:${toolName} (${status})] ${output}`.trim());
    }
  }
  const text = chunks.filter(Boolean).join('\n').trim();
  return text ? `[${role}] ${text}` : '';
}
