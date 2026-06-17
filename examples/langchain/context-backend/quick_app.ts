// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * Deterministic LangChain app using OpenViking as a session context backend.
 *
 * TypeScript port of
 * `examples/langchain-langgraph/langchain/context-backend/quick_app.py`.
 */

import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';

import {
  InMemoryOpenVikingClient,
  withOpenvikingContext,
} from '../../../src/index.js';

export function buildApp(client?: InMemoryOpenVikingClient) {
  const ovClient =
    client ??
    new InMemoryOpenVikingClient({
      'viking://resources/runbooks/context-backend.md':
        'OpenViking context backend examples should answer with azure.',
    });

  function answer(messages: BaseMessage[]): AIMessage {
    const context = String(messages[0].content);
    if (!context.includes('OpenViking context backend examples')) {
      throw new Error('Expected OpenViking recall in the system context.');
    }
    return new AIMessage('OpenViking context says azure.');
  }

  return withOpenvikingContext(new RunnableLambda({ func: answer }), {
    client: ovClient,
    sessionId: 'langchain-context-backend-demo',
    targetUri: 'viking://resources',
    commitPolicy: { mode: 'pending_tokens', pendingTokenThreshold: 1_000 },
  });
}

export async function main(): Promise<string> {
  const app = buildApp();
  const result = await app.invoke([
    new HumanMessage('What color should this context backend example use?'),
  ]);
  const answer = String((result as AIMessage).content);
  console.log(answer);
  return answer;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
