// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * Minimal HTTP OpenViking client for the live example.
 *
 * TypeScript analog of `openviking.client.SyncHTTPClient` for the subset of
 * methods the LangChain/LangGraph adapters call. It talks to the OpenViking
 * REST API and unwraps the `{ status, result, error }` envelope. Methods are
 * named snake_case to match the protocol strings used by `callOpenviking`, and
 * accept camelCase option objects.
 *
 * This client is exercised only by `langgraph/agent/live_app.ts`, which needs a
 * running OpenViking server. Endpoint paths follow the documented OpenViking
 * HTTP routes; adjust them here if your deployment differs.
 */

import type { OpenVikingPart } from './client.js';

export interface SyncHTTPClientOptions {
  url?: string;
  apiKey?: string;
  account?: string;
  user?: string;
  userId?: string;
  actorPeerId?: string;
  timeout?: number;
  extraHeaders?: Record<string, string>;
}

interface Envelope<T> {
  status: string;
  result: T;
  error?: { code?: string; message?: string };
}

export class SyncHTTPClient {
  baseUrl: string;
  private apiKey?: string;
  private account?: string;
  private user?: string;
  private userId?: string;
  private timeoutMs: number;
  private extraHeaders: Record<string, string>;
  _initialized = false;

  constructor(opts: SyncHTTPClientOptions = {}) {
    this.baseUrl = (opts.url ?? process.env.OPENVIKING_URL ?? 'http://127.0.0.1:1933').replace(/\/+$/, '');
    this.apiKey = opts.apiKey ?? process.env.OPENVIKING_API_KEY;
    this.account = opts.account ?? undefined;
    this.user = opts.user ?? undefined;
    this.userId = opts.userId ?? process.env.OPENVIKING_USER_ID ?? undefined;
    this.timeoutMs = (opts.timeout ?? 60) * 1000;
    this.extraHeaders = opts.extraHeaders ?? {};
  }

  async initialize(): Promise<void> {
    this._initialized = true;
  }

  close(): void {
    this._initialized = false;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    if (this.account) headers['X-OpenViking-Account'] = this.account;
    if (this.user ?? this.userId) headers['X-OpenViking-User'] = (this.user ?? this.userId)!;
    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, string | undefined> } = {},
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (opts.query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined) params.set(key, value);
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.headers(),
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let payload: Envelope<T> | undefined;
    try {
      payload = text ? (JSON.parse(text) as Envelope<T>) : undefined;
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      const message = payload?.error?.message ?? text ?? response.statusText;
      const code = payload?.error?.code ? ` [${payload.error.code}]` : '';
      throw new Error(`OpenViking ${response.status}${code}: ${message}`);
    }
    if (payload && payload.status === 'error') {
      throw new Error(`OpenViking: ${payload.error?.message ?? 'Unknown error'}`);
    }
    return (payload ? payload.result : (undefined as unknown)) as T;
  }

  find(args: { query: string; targetUri?: string | string[]; limit?: number; scoreThreshold?: number | null }): Promise<any> {
    return this.request('POST', '/api/v1/search/find', {
      body: {
        query: args.query,
        target_uri: args.targetUri ?? '',
        limit: args.limit ?? 10,
        score_threshold: args.scoreThreshold ?? 0,
      },
    });
  }

  search(args: { query: string; targetUri?: string | string[]; sessionId?: string | null; limit?: number; scoreThreshold?: number | null }): Promise<any> {
    return this.request('POST', '/api/v1/search/search', {
      body: {
        query: args.query,
        session_id: args.sessionId ?? undefined,
        target_uri: args.targetUri ?? '',
        limit: args.limit ?? 10,
      },
    });
  }

  read(args: { uri: string }): Promise<string> {
    return this.request('GET', '/api/v1/content/read', { query: { uri: args.uri } });
  }

  abstract(args: { uri: string }): Promise<string> {
    return this.request('GET', '/api/v1/content/abstract', { query: { uri: args.uri } });
  }

  overview(args: { uri: string }): Promise<string> {
    return this.request('GET', '/api/v1/content/overview', { query: { uri: args.uri } });
  }

  create_session(args: { sessionId?: string | null } = {}): Promise<any> {
    return this.request('POST', '/api/v1/sessions', {
      body: args.sessionId ? { session_id: args.sessionId } : {},
    });
  }

  add_message(args: { sessionId: string; role: string; content?: string | null; parts?: OpenVikingPart[] | null; peerId?: string | null }): Promise<any> {
    const body: Record<string, unknown> = { role: args.role };
    if (args.parts) body.parts = args.parts;
    else body.content = args.content ?? '';
    if (args.peerId) body.peer_id = args.peerId;
    return this.request('POST', `/api/v1/sessions/${encodeURIComponent(args.sessionId)}/messages`, { body });
  }

  batch_add_messages(args: { sessionId: string; messages: any[] }): Promise<any> {
    return this.request('POST', `/api/v1/sessions/${encodeURIComponent(args.sessionId)}/messages/batch`, {
      body: { messages: args.messages },
    });
  }

  get_session(args: { sessionId: string; autoCreate?: boolean }): Promise<any> {
    return this.request('GET', `/api/v1/sessions/${encodeURIComponent(args.sessionId)}`, {
      query: { auto_create: args.autoCreate ? 'true' : undefined },
    });
  }

  get_session_context(args: { sessionId: string; tokenBudget?: number }): Promise<any> {
    return this.request('GET', `/api/v1/sessions/${encodeURIComponent(args.sessionId)}/context`, {
      query: { token_budget: args.tokenBudget != null ? String(args.tokenBudget) : undefined },
    });
  }

  get_session_archive(args: { sessionId: string; archiveId: string }): Promise<any> {
    return this.request(
      'GET',
      `/api/v1/sessions/${encodeURIComponent(args.sessionId)}/archives/${encodeURIComponent(args.archiveId)}`,
    );
  }

  commit_session(args: { sessionId: string }): Promise<any> {
    return this.request('POST', `/api/v1/sessions/${encodeURIComponent(args.sessionId)}/commit`, { body: {} });
  }

  get_task(args: { taskId: string } | string): Promise<any> {
    const taskId = typeof args === 'string' ? args : args.taskId;
    return this.request('GET', `/api/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  delete_session(args: { sessionId: string } | string): Promise<any> {
    const sessionId = typeof args === 'string' ? args : args.sessionId;
    return this.request('DELETE', `/api/v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  add_resource(args: { path: string; to?: string | null }): Promise<any> {
    return this.request('POST', '/api/v1/resources', {
      body: { path: args.path, target: args.to ?? undefined },
    });
  }

  get_status(): Promise<any> {
    return this.request('GET', '/api/v1/status');
  }

  is_healthy(): Promise<boolean> {
    return this.get_status().then(
      () => true,
      () => false,
    );
  }
}
