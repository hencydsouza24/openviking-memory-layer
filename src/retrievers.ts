// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * LangChain retriever backed by OpenViking retrieval.
 *
 * TypeScript port of `openviking/integrations/langchain/retrievers.py`.
 */

import { BaseRetriever } from '@langchain/core/retrievers';
import type { BaseRetrieverInput } from '@langchain/core/retrievers';
import { Document } from '@langchain/core/documents';

import {
  callOpenviking,
  ensureClient,
  itemValue,
  iterResultItems,
  stringify,
} from './client.js';
import type { OpenVikingClientLike, OpenVikingConnection } from './client.js';

export type ContentMode = 'auto' | 'abstract' | 'overview' | 'read';
export type SearchMode = 'find' | 'search';

export interface OpenVikingRetrieverParams extends OpenVikingConnection {
  retriever?: never;
  targetUri?: string | string[];
  searchMode?: SearchMode;
  sessionId?: string | null;
  limit?: number;
  scoreThreshold?: number | null;
  filter?: Record<string, unknown> | null;
  contextTypes?: string[];
  contentMode?: ContentMode;
  maxContentChars?: number;
  metadataPrefix?: string;
}

export class OpenVikingRetriever extends BaseRetriever {
  lc_namespace = ['openviking', 'integrations', 'langchain'];

  private connection: OpenVikingConnection;
  targetUri: string | string[];
  searchMode: SearchMode;
  sessionId: string | null;
  limit: number;
  scoreThreshold: number | null;
  filter: Record<string, unknown> | null;
  contextTypes: string[];
  contentMode: ContentMode;
  maxContentChars: number;
  metadataPrefix: string;

  private clientCache: OpenVikingClientLike | null = null;

  constructor(params: OpenVikingRetrieverParams = {}, retrieverInput: BaseRetrieverInput = {}) {
    super(retrieverInput);
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
    this.targetUri = params.targetUri ?? '';
    this.searchMode = params.searchMode ?? 'find';
    this.sessionId = params.sessionId ?? null;
    this.limit = params.limit ?? 10;
    this.scoreThreshold = params.scoreThreshold ?? null;
    this.filter = params.filter ?? null;
    this.contextTypes = params.contextTypes ?? ['memory', 'resource', 'skill'];
    this.contentMode = params.contentMode ?? 'auto';
    this.maxContentChars = params.maxContentChars ?? 12_000;
    this.metadataPrefix = params.metadataPrefix ?? 'openviking';
  }

  /** Mirror pydantic's `model_copy(update=...)`: shallow clone with overrides. */
  clone(update: Partial<OpenVikingRetrieverParams> = {}): OpenVikingRetriever {
    const copy = new OpenVikingRetriever({
      ...this.connection,
      targetUri: this.targetUri,
      searchMode: this.searchMode,
      sessionId: this.sessionId,
      limit: this.limit,
      scoreThreshold: this.scoreThreshold,
      filter: this.filter,
      contextTypes: this.contextTypes,
      contentMode: this.contentMode,
      maxContentChars: this.maxContentChars,
      metadataPrefix: this.metadataPrefix,
      ...update,
    });
    // Preserve a shared client cache so a copy reuses the same in-memory client.
    copy.clientCache = this.clientCache;
    return copy;
  }

  private async getClient(): Promise<OpenVikingClientLike> {
    if (this.clientCache == null) {
      this.clientCache = await ensureClient(this.connection);
    }
    return this.clientCache;
  }

  /**
   * Client-side scope re-check for `find`/`search` results.
   *
   * The OpenViking server is supposed to enforce per-user scoping itself
   * (via `PathScope` filters threaded down to its native vector index), but
   * that enforcement has been observed to fail at the compiled index-engine
   * layer — results from other users' `viking://user/{their-id}/...` roots
   * can come back even though every Python layer up to the native engine
   * builds the correct restriction. We don't ship or control that server, so
   * this SDK re-verifies each result's URI itself before turning it into a
   * `Document`, rather than trusting the server's filter was actually applied.
   *
   * Returns the URI prefixes this retriever is allowed to surface, or `null`
   * if we can't determine an owner (no `userId`/`user` set) — in that case
   * filtering is skipped so callers with no identity aren't broken.
   */
  private resolveAllowedScopePrefixes(): string[] | null {
    // Caller explicitly scoped the search — trust what they asked for.
    if (this.targetUri) {
      return Array.isArray(this.targetUri) ? this.targetUri.filter(Boolean) : [this.targetUri];
    }
    // Empty targetUri: mirrors the server's own default-scope fallback
    // (default_target_directories -> [canonical_user_root(ctx), "viking://resources"]),
    // reconstructed client-side from what we already know about this connection.
    const userId = this.connection.userId ?? this.connection.user;
    if (!userId) return null; // nothing to enforce against — skip filtering
    return [`viking://user/${userId}`, 'viking://resources'];
  }

  private static isUnderAllowedPrefix(uri: string, prefixes: string[]): boolean {
    const normalizedUri = uri.replace(/\/+$/, '');
    return prefixes.some((prefix) => {
      const normalizedPrefix = prefix.replace(/\/+$/, '');
      return normalizedUri === normalizedPrefix || normalizedUri.startsWith(`${normalizedPrefix}/`);
    });
  }

  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const client = await this.getClient();
    const method = this.searchMode === 'search' ? 'search' : 'find';
    const result = await callOpenviking(client, method, {
      query,
      targetUri: this.targetUri,
      sessionId: this.sessionId,
      limit: this.limit,
      scoreThreshold: this.scoreThreshold,
      filter: this.filter,
    });

    const allowedPrefixes = this.resolveAllowedScopePrefixes();

    const documents: Document[] = [];
    for (const [contextType, item] of iterResultItems(result, this.contextTypes)) {
      const uri = itemValue(item, 'uri', '');
      if (allowedPrefixes && uri && !OpenVikingRetriever.isUnderAllowedPrefix(uri, allowedPrefixes)) {
        continue; // server returned a result outside our own scope — drop it, don't trust it
      }
      const content = await this.contentForItem(client, item);
      const p = this.metadataPrefix;
      const metadata: Record<string, unknown> = {
        source: uri,
        [`${p}_uri`]: uri,
        [`${p}_context_type`]: contextType,
        [`${p}_level`]: itemValue(item, 'level'),
        [`${p}_category`]: itemValue(item, 'category'),
        [`${p}_score`]: itemValue(item, 'score'),
        [`${p}_match_reason`]: itemValue(item, 'match_reason'),
        [`${p}_abstract`]: itemValue(item, 'abstract'),
        [`${p}_overview`]: itemValue(item, 'overview'),
      };
      documents.push(new Document({ pageContent: content, metadata }));
    }
    return documents;
  }

  private async contentForItem(client: OpenVikingClientLike, item: any): Promise<string> {
    const uri = itemValue(item, 'uri', '');
    const abstract = itemValue(item, 'abstract', '');
    const overview = itemValue(item, 'overview', '');
    const level = itemValue(item, 'level');

    if (this.contentMode === 'abstract') {
      return stringify(abstract || overview, this.maxContentChars);
    }
    if (this.contentMode === 'overview') {
      return stringify(overview || abstract, this.maxContentChars);
    }
    if (this.contentMode === 'read') {
      return this.readOrFallback(client, uri, overview || abstract);
    }
    if (level === 2 && uri) {
      return this.readOrFallback(client, uri, overview || abstract);
    }
    return stringify(overview || abstract, this.maxContentChars);
  }

  private async readOrFallback(
    client: OpenVikingClientLike,
    uri: string,
    fallback: unknown,
  ): Promise<string> {
    if (uri) {
      try {
        const content = await callOpenviking(client, 'read', { uri });
        return stringify(content, this.maxContentChars);
      } catch {
        // fall through to fallback
      }
    }
    return stringify(fallback, this.maxContentChars);
  }
}
