// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * LangChain chat history backed by OpenViking sessions.
 *
 * TypeScript port of `openviking/integrations/langchain/history.py`.
 */

import { BaseListChatMessageHistory } from '@langchain/core/chat_history';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

import {
  applyCommitPolicy,
  callOpenviking,
  ensureClient,
  extractMessageText,
} from './client.js';
import type {
  OpenVikingClientLike,
  OpenVikingCommitPolicy,
  OpenVikingConnection,
  OpenVikingMessage,
  OpenVikingPart,
} from './client.js';

export interface OpenVikingChatMessageHistoryParams extends OpenVikingConnection {
  sessionId: string;
  tokenBudget?: number;
  persistSystemMessages?: boolean;
  commitPolicy?: OpenVikingCommitPolicy | null;
  contextPartsProvider?: (sessionId: string) => OpenVikingPart[];
  peerId?: string | null;
  peerIdProvider?: (sessionId: string) => string | null;
}

export class OpenVikingChatMessageHistory extends BaseListChatMessageHistory {
  lc_namespace = ['openviking', 'integrations', 'langchain'];

  sessionId: string;
  peerId: string | null;
  peerIdProvider?: (sessionId: string) => string | null;
  tokenBudget: number;
  // System messages are runtime policy, not conversation memory; never persisted.
  persistSystemMessages = false;
  commitPolicy: OpenVikingCommitPolicy | null;
  contextPartsProvider?: (sessionId: string) => OpenVikingPart[];

  private connection: OpenVikingConnection;
  private clientCache: OpenVikingClientLike | null = null;

  constructor(params: OpenVikingChatMessageHistoryParams) {
    super();
    this.sessionId = params.sessionId;
    this.peerId = params.peerId ?? null;
    this.peerIdProvider = params.peerIdProvider;
    this.tokenBudget = params.tokenBudget ?? 128_000;
    this.commitPolicy = params.commitPolicy ?? null;
    this.contextPartsProvider = params.contextPartsProvider;
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
  }

  async getMessages(): Promise<BaseMessage[]> {
    const client = await this.getClient();
    let context: any;
    try {
      context = await callOpenviking(client, 'get_session_context', {
        sessionId: this.sessionId,
        tokenBudget: this.tokenBudget,
      });
    } catch {
      await this.ensureSession(client);
      return [];
    }
    return restoreOpenvikingMessages(context.messages ?? []);
  }

  async addMessage(message: BaseMessage): Promise<void> {
    await this.addMessages([message]);
  }

  async addMessages(messages: BaseMessage[]): Promise<void> {
    const client = await this.getClient();
    let pendingContextParts: OpenVikingPart[] = this.contextPartsProvider
      ? [...this.contextPartsProvider(this.sessionId)]
      : [];
    const batch: any[] = [];
    const effectivePeerId = this.effectivePeerId();
    for (const message of messages) {
      for (const payload of langchainMessageToOpenviking(message, this.persistSystemMessages)) {
        if (pendingContextParts.length && payload.role === 'assistant') {
          payload.parts.push(...pendingContextParts);
          pendingContextParts = [];
        }
        if (effectivePeerId != null) payload.peer_id = effectivePeerId;
        batch.push(payload);
      }
    }
    if (batch.length) {
      await callOpenviking(client, 'batch_add_messages', {
        sessionId: this.sessionId,
        messages: batch,
      });
      await applyCommitPolicy(client, this.sessionId, this.commitPolicy);
    }
  }

  async clear(): Promise<void> {
    const client = await this.getClient();
    await callOpenviking(client, 'delete_session', { sessionId: this.sessionId });
    await this.ensureSession(client);
  }

  private async getClient(): Promise<OpenVikingClientLike> {
    if (this.clientCache == null) this.clientCache = await ensureClient(this.connection);
    return this.clientCache;
  }

  private async ensureSession(client: OpenVikingClientLike): Promise<void> {
    try {
      await callOpenviking(client, 'create_session', { sessionId: this.sessionId });
    } catch {
      // ignore
    }
  }

  private effectivePeerId(): string | null {
    const value = this.peerIdProvider ? this.peerIdProvider(this.sessionId) : this.peerId;
    if (value == null) return null;
    const text = String(value).trim();
    return text || null;
  }
}

export interface OpenVikingPayload {
  role: string;
  parts: OpenVikingPart[];
  peer_id?: string;
}

/** Convert a LangChain message into one or more OpenViking add_message payloads. */
export function langchainMessageToOpenviking(
  message: BaseMessage,
  _persistSystemMessages = false,
): OpenVikingPayload[] {
  if (message instanceof HumanMessage) {
    const parts = textParts(message.content);
    return [{ role: 'user', parts: parts.length ? parts : [{ type: 'text', text: '' }] }];
  }

  if (message instanceof AIMessage) {
    const parts = textParts(message.content);
    for (const toolCall of (message as AIMessage).tool_calls ?? []) {
      parts.push({
        type: 'tool',
        tool_id: String(toolCall.id ?? ''),
        tool_name: String(toolCall.name ?? ''),
        tool_input: toolArgs(toolCall.args),
        tool_status: 'pending',
      });
    }
    return [{ role: 'assistant', parts: parts.length ? parts : [{ type: 'text', text: '' }] }];
  }

  if (message instanceof ToolMessage) {
    return [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool',
            tool_id: String((message as ToolMessage).tool_call_id ?? ''),
            tool_name: String((message as ToolMessage).name ?? ''),
            tool_output: extractMessageText(message.content),
            tool_status: toolStatus(message as ToolMessage),
          },
        ],
      },
    ];
  }

  if (message instanceof SystemMessage) {
    return [];
  }

  const text = extractMessageText((message as BaseMessage).content ?? '');
  if (!text) return [];
  const role = message._getType() === 'human' ? 'user' : 'assistant';
  return [{ role, parts: [{ type: 'text', text }] }];
}

/** Convert one OpenViking session message into LangChain messages. */
export function openvikingMessageToLangchain(message: OpenVikingMessage): BaseMessage[] {
  const role = String(message.role ?? '');
  const parts = [...(message.parts ?? [])];
  const text = partsText(parts);
  if (role === 'user') return [new HumanMessage(text)];

  const toolCalls: any[] = [];
  const toolMessages: BaseMessage[] = [];
  for (const part of parts) {
    if (part.type !== 'tool') continue;
    const toolId = String(part.tool_id ?? '');
    const toolName = String(part.tool_name ?? '');
    const status = String(part.tool_status ?? '');
    const hasOutput = part.tool_output != null;
    const isCompletedResult = hasOutput || status === 'completed' || status === 'error';
    if (isCompletedResult) {
      toolMessages.push(
        new ToolMessage({
          content: String(part.tool_output ?? ''),
          tool_call_id: toolId || 'openviking-tool',
          name: toolName || undefined,
          status: status === 'error' ? 'error' : 'success',
        }),
      );
    } else {
      toolCalls.push({ id: toolId, name: toolName, args: toolArgs(part.tool_input) });
    }
  }

  const messages: BaseMessage[] = [];
  if (text || toolCalls.length || !toolMessages.length) {
    messages.push(
      toolCalls.length
        ? new AIMessage({ content: text, tool_calls: toolCalls })
        : new AIMessage(text),
    );
  }
  messages.push(...toolMessages);
  return messages;
}

function restoreOpenvikingMessages(messages: OpenVikingMessage[]): BaseMessage[] {
  const restored: BaseMessage[] = [];
  const activeToolCallIds = new Set<string>();
  for (const message of messages) {
    for (const lcMessage of openvikingMessageToLangchain(message)) {
      if (lcMessage instanceof AIMessage) {
        restored.push(lcMessage);
        for (const toolCall of (lcMessage as AIMessage).tool_calls ?? []) {
          const id = String(toolCall.id ?? '');
          if (id) activeToolCallIds.add(id);
        }
      } else if (lcMessage instanceof ToolMessage) {
        const id = String((lcMessage as ToolMessage).tool_call_id ?? '');
        if (id && activeToolCallIds.has(id)) {
          restored.push(lcMessage);
          activeToolCallIds.delete(id);
        }
      } else {
        restored.push(lcMessage);
      }
    }
  }
  return restored;
}

/** Build OpenViking ContextPart dictionaries from LangChain Documents. */
export function contextPartsFromDocuments(documents: any[]): OpenVikingPart[] {
  const parts: OpenVikingPart[] = [];
  for (const doc of documents) {
    const metadata = doc?.metadata ?? {};
    const uri = metadata.openviking_uri || metadata.source || '';
    if (!uri) continue;
    parts.push({
      type: 'context',
      uri,
      context_type: metadata.openviking_context_type || 'resource',
      abstract: metadata.openviking_abstract || String(doc?.pageContent ?? '').slice(0, 500),
    });
  }
  return parts;
}

function textParts(content: unknown): OpenVikingPart[] {
  const text = extractMessageText(content);
  return text ? [{ type: 'text', text }] : [];
}

function partsText(parts: OpenVikingPart[]): string {
  const chunks: string[] = [];
  for (const part of parts) {
    if (part.type === 'text' && part.text) {
      chunks.push(String(part.text));
    } else if (part.type === 'context' && part.abstract) {
      const uri = part.uri || 'context';
      chunks.push(`[context:${uri}] ${part.abstract}`);
    }
  }
  return chunks.join('\n');
}

function toolArgs(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

function toolStatus(message: ToolMessage): string {
  return (message as any).status === 'error' ? 'error' : 'completed';
}
