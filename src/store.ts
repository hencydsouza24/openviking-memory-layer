// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * LangGraph Store implementation backed by OpenViking.
 *
 * TypeScript port of `openviking/integrations/langchain/store.py`.
 *
 * Values are stored as JSON records under `<root_uri>/data`. A markdown
 * projection under `<root_uri>/index` gives OpenViking semantic retrieval a
 * compact document to index for query-based `search` calls.
 *
 * Note: the canonicalized-URI fallback parser (Python `_parse_canonicalized_
 * record_uri`, which used `openviking.core.namespace.classify_uri`) is a no-op
 * here. In-memory and HTTP retrieval return the literal URIs written, which
 * always start with the configured root prefix, so the direct prefix parser
 * covers every case the adapters exercise.
 */

import { BaseStore } from '@langchain/langgraph';
import type { Operation, OperationResults } from '@langchain/langgraph';

import { callOpenviking, ensureClient, itemValue, iterResultItems } from './client.js';
import type { OpenVikingClientLike, OpenVikingConnection } from './client.js';

export type Namespace = string[];

export class Item {
  constructor(
    public namespace: Namespace,
    public key: string,
    public value: Record<string, any>,
    public createdAt: Date,
    public updatedAt: Date,
  ) {}
}

export class SearchItem extends Item {
  constructor(
    namespace: Namespace,
    key: string,
    value: Record<string, any>,
    createdAt: Date,
    updatedAt: Date,
    public score: number,
  ) {
    super(namespace, key, value, createdAt, updatedAt);
  }
}

export interface OpenVikingStoreParams extends OpenVikingConnection {
  rootUri?: string;
  index?: boolean | string[] | null;
  wait?: boolean;
  timeout?: number | null;
  searchFetchLimit?: number;
}

export class OpenVikingStore extends BaseStore {
  private connection: OpenVikingConnection;
  rootUri: string;
  index: boolean | string[] | null;
  wait: boolean;
  timeout: number | null;
  searchFetchLimit: number;
  private clientCache: OpenVikingClientLike | null = null;

  constructor(params: OpenVikingStoreParams = {}) {
    super();
    this.connection = {
      client: params.client ?? null,
      url: params.url ?? null,
      apiKey: params.apiKey ?? null,
      account: params.account ?? null,
      user: params.user ?? null,
      userId: params.userId ?? null,
      actorPeerId: params.actorPeerId ?? null,
      path: params.path ?? null,
      autoInitialize: params.autoInitialize ?? true,
    };
    this.rootUri = (params.rootUri ?? 'viking://user/memories/langgraph_store').replace(/\/+$/, '');
    this.index = params.index ?? null;
    this.wait = params.wait ?? true;
    this.timeout = params.timeout ?? null;
    this.searchFetchLimit = params.searchFetchLimit ?? 50;
  }

  async get(namespace: Namespace, key: string): Promise<Item | null> {
    let record: any;
    try {
      record = await this.readRecord(this.dataUri(namespace, key));
    } catch {
      return null;
    }
    return new Item(
      [...record.namespace],
      record.key,
      record.value,
      parseDate(record.created_at),
      parseDate(record.updated_at),
    );
  }

  async put(
    namespace: Namespace,
    key: string,
    value: Record<string, any>,
    index: boolean | string[] | null = null,
  ): Promise<void> {
    const now = new Date();
    const dataUri = this.dataUri(namespace, key);
    const record = await this.writeRecord(dataUri, namespace, key, value, now);

    const effectiveIndex = index === null ? this.index : index;
    const indexUri = this.indexUri(namespace, key);
    if (effectiveIndex === false) {
      await this.remove(indexUri);
      return;
    }
    await this.write(indexUri, this.indexDocument(record, effectiveIndex));
  }

  async delete(namespace: Namespace, key: string): Promise<void> {
    await this.remove(this.dataUri(namespace, key));
    await this.remove(this.indexUri(namespace, key));
  }

  async search(
    namespacePrefix: Namespace,
    opts: {
      query?: string | null;
      filter?: Record<string, any> | null;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<SearchItem[]> {
    const { query = null, filter = null, limit = 10, offset = 0 } = opts;
    if (query) return this.semanticSearch(namespacePrefix, query, filter, limit, offset);
    const items: SearchItem[] = [];
    for (const item of await this.listItems(namespacePrefix)) {
      if (matchesFilter(item.value, filter)) items.push(this.toSearchItem(item, null));
    }
    items.sort((a, b) => {
      if (a.updatedAt.getTime() !== b.updatedAt.getTime()) {
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      }
      const na = a.namespace.join('/');
      const nb = b.namespace.join('/');
      if (na !== nb) return na < nb ? 1 : -1;
      return a.key < b.key ? 1 : -1;
    });
    return items.slice(offset, offset + limit);
  }

  async listNamespaces(opts: {
    prefix?: Namespace | null;
    suffix?: Namespace | null;
    maxDepth?: number | null;
    limit?: number;
    offset?: number;
  } = {}): Promise<Namespace[]> {
    const { prefix = null, suffix = null, maxDepth = null, limit = 100, offset = 0 } = opts;
    const namespaces = new Set<string>();
    for (const uri of await this.allDataUris(prefix ?? [])) {
      const parsed = this.parseDataUri(uri);
      if (parsed == null) continue;
      let [namespace] = parsed;
      if (prefix && !tupleMatchesPrefix(namespace, prefix)) continue;
      if (suffix && !tupleMatchesSuffix(namespace, suffix)) continue;
      if (maxDepth != null && namespace.length > maxDepth) namespace = namespace.slice(0, maxDepth);
      namespaces.add(JSON.stringify(namespace));
    }
    const ordered = [...namespaces].sort().map((s) => JSON.parse(s) as Namespace);
    return ordered.slice(offset, offset + limit);
  }

  private async semanticSearch(
    namespacePrefix: Namespace,
    query: string,
    filter: Record<string, any> | null,
    limit: number,
    offset: number,
  ): Promise<SearchItem[]> {
    const result = await callOpenviking(await this.client(), 'find', {
      query,
      targetUri: this.indexPrefixUri(namespacePrefix),
      limit: Math.max(limit + offset, this.searchFetchLimit),
    });
    const items: SearchItem[] = [];
    for (const [, resultItem] of iterResultItems(result, ['memory', 'resource', 'skill'])) {
      const uri = itemValue(resultItem, 'uri', '');
      const parsed = this.parseIndexUri(uri);
      if (parsed == null) continue;
      const [namespace, key] = parsed;
      const item = await this.get(namespace, key);
      if (item == null || !matchesFilter(item.value, filter)) continue;
      items.push(this.toSearchItem(item, itemValue(resultItem, 'score')));
    }
    return items.slice(offset, offset + limit);
  }

  private async listItems(namespacePrefix: Namespace): Promise<Item[]> {
    const items: Item[] = [];
    for (const uri of await this.allDataUris(namespacePrefix)) {
      const parsed = this.parseDataUri(uri);
      if (parsed == null) continue;
      const [namespace, key] = parsed;
      const item = await this.get(namespace, key);
      if (item != null) items.push(item);
    }
    return items;
  }

  private async allDataUris(namespacePrefix: Namespace): Promise<string[]> {
    const baseUri = this.dataPrefixUri(namespacePrefix);
    const uris: string[] = [];
    const seen = new Set<string>();
    for (const pattern of ['*.json', '**/*.json']) {
      let result: any;
      try {
        result = await callOpenviking(await this.client(), 'glob', { pattern, uri: baseUri });
      } catch {
        continue;
      }
      for (const uri of extractUris(result)) {
        if (!seen.has(uri)) {
          seen.add(uri);
          uris.push(uri);
        }
      }
    }
    return uris;
  }

  private async client(): Promise<OpenVikingClientLike> {
    if (this.clientCache == null) this.clientCache = await ensureClient(this.connection);
    return this.clientCache;
  }

  private async readRecord(uri: string): Promise<any> {
    const content = await callOpenviking(await this.client(), 'read', { uri });
    return JSON.parse(String(content));
  }

  private async writeRecord(
    uri: string,
    namespace: Namespace,
    key: string,
    value: Record<string, any>,
    now: Date,
  ): Promise<any> {
    let record = storeRecord(namespace, key, value, now, now);
    const content = JSON.stringify(record, null, 2);
    try {
      await this.writeCreate(uri, content);
      return record;
    } catch (createExc) {
      let existing: any;
      try {
        existing = await this.readRecord(uri);
      } catch {
        throw createExc;
      }
      const createdAt = parseDate(existing.created_at);
      record = storeRecord(namespace, key, value, createdAt, now);
      await this.writeReplace(uri, JSON.stringify(record, null, 2));
      return record;
    }
  }

  private async write(uri: string, content: string): Promise<void> {
    try {
      await this.writeCreate(uri, content);
    } catch (createExc) {
      try {
        await this.writeReplace(uri, content);
      } catch {
        throw createExc;
      }
    }
  }

  private async writeCreate(uri: string, content: string): Promise<void> {
    await callOpenviking(await this.client(), 'write', {
      uri,
      content,
      mode: 'create',
      wait: this.wait,
      timeout: this.timeout,
    });
  }

  private async writeReplace(uri: string, content: string): Promise<void> {
    await callOpenviking(await this.client(), 'write', {
      uri,
      content,
      mode: 'replace',
      wait: this.wait,
      timeout: this.timeout,
    });
  }

  private async remove(uri: string): Promise<void> {
    try {
      await callOpenviking(await this.client(), 'rm', { uri, recursive: false });
    } catch {
      // ignore missing/unavailable URI
    }
  }

  private dataUri(namespace: Namespace, key: string): string {
    return `${this.dataPrefixUri(namespace)}/${segment(key)}.json`;
  }

  private indexUri(namespace: Namespace, key: string): string {
    return `${this.indexPrefixUri(namespace)}/${segment(key)}.md`;
  }

  private dataPrefixUri(namespace: Namespace): string {
    return joinUri(this.rootUri, 'data', ...namespace);
  }

  private indexPrefixUri(namespace: Namespace): string {
    return joinUri(this.rootUri, 'index', ...namespace);
  }

  private parseDataUri(uri: string): [Namespace, string] | null {
    return this.parseRecordUri(uri, 'data', '.json');
  }

  private parseIndexUri(uri: string): [Namespace, string] | null {
    return this.parseRecordUri(uri, 'index', '.md');
  }

  private parseRecordUri(uri: string, collection: string, suffix: string): [Namespace, string] | null {
    const prefix = joinUri(this.rootUri, collection) + '/';
    if (!uri.startsWith(prefix) || !uri.endsWith(suffix)) {
      return null; // canonicalized fallback intentionally unsupported (see file header)
    }
    return parseRecordParts(uri.slice(prefix.length, uri.length - suffix.length).split('/'));
  }

  private indexDocument(record: any, index: boolean | string[] | null): string {
    const projected = projectValue(record.value, index);
    return [
      `# ${record.key}`,
      '',
      `Namespace: ${record.namespace.join('/')}`,
      `Key: ${record.key}`,
      '',
      JSON.stringify(projected, null, 2),
    ].join('\n');
  }

  private toSearchItem(item: Item, score: number | null): SearchItem {
    return new SearchItem(
      item.namespace,
      item.key,
      item.value,
      item.createdAt,
      item.updatedAt,
      score ?? 0,
    );
  }

  /**
   * BaseStore contract: execute a batch of operations. LangGraph drives the
   * store exclusively through this method (its public get/put/search/delete
   * helpers delegate here), so implementing it makes OpenVikingStore usable as
   * `createAgent({ store })`. Each op is dispatched to the typed method above.
   */
  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: unknown[] = [];
    for (const op of operations) {
      if ('namespacePrefix' in op) {
        results.push(
          await this.search(op.namespacePrefix, {
            query: op.query ?? null,
            filter: op.filter ?? null,
            limit: op.limit ?? 10,
            offset: op.offset ?? 0,
          }),
        );
      } else if ('value' in op) {
        if (op.value === null) {
          await this.delete(op.namespace, op.key);
        } else {
          await this.put(op.namespace, op.key, op.value, op.index ?? null);
        }
        results.push(undefined);
      } else if ('key' in op) {
        results.push(await this.get(op.namespace, op.key));
      } else {
        const prefix = op.matchConditions?.find((c) => c.matchType === 'prefix')?.path;
        const suffix = op.matchConditions?.find((c) => c.matchType === 'suffix')?.path;
        results.push(
          await this.listNamespaces({
            prefix: prefix as string[] | undefined,
            suffix: suffix as string[] | undefined,
            maxDepth: op.maxDepth ?? null,
            limit: op.limit,
            offset: op.offset,
          }),
        );
      }
    }
    return results as OperationResults<Op>;
  }
}

function segment(value: string): string {
  return encodeURIComponent(String(value));
}

function joinUri(root: string, ...segments: string[]): string {
  const suffix = segments.filter(Boolean).map(segment).join('/');
  const base = root.replace(/\/+$/, '');
  return suffix ? `${base}/${suffix}` : base;
}

function parseRecordParts(parts: string[]): [Namespace, string] | null {
  if (!parts.length || !parts[parts.length - 1]) return null;
  const namespace = parts.slice(0, -1).map((part) => decodeURIComponent(part));
  const key = decodeURIComponent(parts[parts.length - 1]);
  return [namespace, key];
}

function parseDate(value: string): Date {
  return new Date(value);
}

function storeRecord(
  namespace: Namespace,
  key: string,
  value: Record<string, any>,
  createdAt: Date,
  updatedAt: Date,
): any {
  return {
    namespace: [...namespace],
    key,
    value,
    created_at: createdAt.toISOString(),
    updated_at: updatedAt.toISOString(),
  };
}

function extractUris(value: any): string[] {
  if (value == null) return [];
  if (typeof value === 'string') return value.startsWith('viking://') ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => extractUris(item));
  if (typeof value === 'object') {
    if (typeof value.uri === 'string') return [value.uri];
    const uris: string[] = [];
    for (const key of ['matches', 'result', 'files', 'items']) {
      uris.push(...extractUris(value[key]));
    }
    return uris;
  }
  return [];
}

function projectValue(value: Record<string, any>, index: boolean | string[] | null): Record<string, any> {
  if (Array.isArray(index)) {
    const out: Record<string, any> = {};
    for (const field of index) out[field] = nestedValue(value, field);
    return out;
  }
  return value;
}

function nestedValue(value: Record<string, any>, path: string): any {
  let current: any = value;
  for (const part of path.split('.')) {
    if (current == null || typeof current !== 'object') return null;
    current = current[part];
  }
  return current;
}

function matchesFilter(value: Record<string, any>, filter: Record<string, any> | null): boolean {
  if (!filter) return true;
  for (const [path, expected] of Object.entries(filter)) {
    const actual = nestedValue(value, path);
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      for (const [op, target] of Object.entries(expected)) {
        if (!compare(actual, op, target)) return false;
      }
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

function compare(actual: any, op: string, target: any): boolean {
  switch (op) {
    case '$eq':
    case 'eq':
      return actual === target;
    case '$ne':
    case 'ne':
      return actual !== target;
    case '$gt':
    case 'gt':
      return safeOrdered(actual, target, (l, r) => l > r);
    case '$gte':
    case 'gte':
      return safeOrdered(actual, target, (l, r) => l >= r);
    case '$lt':
    case 'lt':
      return safeOrdered(actual, target, (l, r) => l < r);
    case '$lte':
    case 'lte':
      return safeOrdered(actual, target, (l, r) => l <= r);
    case '$in':
    case 'in':
      try {
        return Array.isArray(target) ? target.includes(actual) : false;
      } catch {
        return false;
      }
    default:
      return actual === target;
  }
}

function safeOrdered(actual: any, target: any, cmp: (l: any, r: any) => boolean): boolean {
  if (actual == null) return false;
  try {
    return Boolean(cmp(actual, target));
  } catch {
    return false;
  }
}

function tupleMatchesPrefix(value: Namespace, prefix: Namespace): boolean {
  return value.length >= prefix.length && prefix.every((p, i) => value[i] === p);
}

function tupleMatchesSuffix(value: Namespace, suffix: Namespace): boolean {
  if (value.length < suffix.length) return false;
  const tail = value.slice(value.length - suffix.length);
  return suffix.every((s, i) => tail[i] === s);
}
