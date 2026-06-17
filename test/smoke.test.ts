// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * Smoke tests for the OpenViking LangChain/LangGraph TypeScript examples.
 *
 * Mirrors `tests/integration/langchain_langgraph/test_smoke.py`: each example's
 * `main()` runs end-to-end and its answer is asserted against the same
 * substrings as the Python suite. The live app is excluded (needs a server).
 */

import { describe, expect, it } from 'vitest';

import { main as ragMain } from '../examples/langchain/rag/quick_app.js';
import { main as contextBackendMain } from '../examples/langchain/context-backend/quick_app.js';
import { main as messageHistoryMain } from '../examples/langchain/message-history/quick_app.js';
import { main as langgraphAgentMain } from '../examples/langgraph/agent/quick_app.js';
import { main as langgraphMiddlewareMain } from '../examples/langgraph/middleware/quick_app.js';

describe('OpenViking LangChain/LangGraph examples', () => {
  it('langchain rag quick app runs', async () => {
    const answer = await ragMain();
    expect(answer.toLowerCase()).toContain('azure');
  });

  it('langchain context-backend quick app runs', async () => {
    const answer = await contextBackendMain();
    expect(answer.toLowerCase()).toContain('openviking');
    expect(answer.toLowerCase()).toContain('azure');
  });

  it('langchain message-history quick app runs', async () => {
    const answer = await messageHistoryMain();
    expect(answer.toLowerCase()).toContain('history');
    expect(answer.toLowerCase()).toContain('azure');
  });

  it('langgraph agent quick app runs', async () => {
    const answer = await langgraphAgentMain();
    expect(answer.toLowerCase()).toContain('openviking');
    expect(answer.toLowerCase()).toContain('azure');
  });

  it('langgraph middleware quick app runs', async () => {
    const answer = await langgraphMiddlewareMain();
    expect(answer.toLowerCase()).toContain('middleware');
    expect(answer.toLowerCase()).toContain('azure');
  });
});
