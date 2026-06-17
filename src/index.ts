// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * LangChain and LangGraph integrations for OpenViking (TypeScript port).
 *
 * Mirrors `openviking/integrations/langchain/__init__.py`.
 */

export {
  type OpenVikingCommitPolicy,
  type OpenVikingConnection,
  type OpenVikingClientLike,
  type OpenVikingMessage,
  type OpenVikingPart,
  type OpenVikingResultItem,
  type OpenVikingFindResult,
  extractMessageText,
  getLatestUserText,
  callOpenviking,
  ensureClient,
  applyCommitPolicy,
  commitPolicy,
} from './client.js';

export { InMemoryOpenVikingClient } from './testing.js';
export { SyncHTTPClient } from './http_client.js';
export { OpenVikingRetriever } from './retrievers.js';
export { OpenVikingStore, Item, SearchItem } from './store.js';
export { createOpenvikingTools } from './tools.js';
export {
  OpenVikingChatMessageHistory,
  langchainMessageToOpenviking,
  openvikingMessageToLangchain,
  contextPartsFromDocuments,
} from './history.js';
export {
  OpenVikingSessionContextAssembler,
  withOpenvikingContext,
  OPENVIKING_CONTEXT_MARKER,
} from './context.js';
export { OpenVikingContextMiddleware } from './middleware.js';
export type { ModelRequestLike } from './middleware.js';
