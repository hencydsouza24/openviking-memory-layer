// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * Deterministic LangChain app using OpenViking-backed chat history.
 *
 * TypeScript port of
 * `examples/langchain-langgraph/langchain/message-history/quick_app.py`.
 */

import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { RunnableLambda, RunnableWithMessageHistory } from '@langchain/core/runnables';

import {
  InMemoryOpenVikingClient,
  OpenVikingChatMessageHistory,
  extractMessageText,
} from '../../../src/index.js';

export function buildApp(client?: InMemoryOpenVikingClient) {
  const ovClient = client ?? new InMemoryOpenVikingClient();

  function answer(messages: BaseMessage[]): AIMessage {
    const text = messages.map((message) => extractMessageText(message.content)).join('\n');
    if (text.toLowerCase().includes('azure')) {
      return new AIMessage('OpenViking history remembers azure.');
    }
    return new AIMessage('OpenViking history is waiting for a preference.');
  }

  return new RunnableWithMessageHistory({
    runnable: new RunnableLambda({ func: answer }),
    getMessageHistory: (sessionId: string) =>
      new OpenVikingChatMessageHistory({ sessionId, client: ovClient }),
  });
}

export async function main(): Promise<string> {
  const app = buildApp();
  const config = { configurable: { sessionId: 'langchain-history-demo' } };

  await app.invoke([new HumanMessage('Remember that the deployment color is azure.')], config);
  const result = await app.invoke(
    [new HumanMessage('Which deployment color did I ask you to remember?')],
    config,
  );
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
