// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * Deterministic LangGraph app using OpenViking context middleware.
 *
 * TypeScript port of
 * `examples/langchain-langgraph/langgraph/middleware/quick_app.py`.
 */

import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph, messagesStateReducer } from '@langchain/langgraph';

import {
  InMemoryOpenVikingClient,
  OpenVikingContextMiddleware,
  extractMessageText,
} from '../../../src/index.js';
import type { ModelRequestLike } from '../../../src/index.js';

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

type State = typeof AgentState.State;

export function buildApp(client?: InMemoryOpenVikingClient) {
  const ovClient =
    client ??
    new InMemoryOpenVikingClient({
      'viking://user/memories/profile.md':
        'OpenViking middleware examples should answer with azure.',
    });
  const sessionId = 'langgraph-middleware-demo';
  const middleware = new OpenVikingContextMiddleware({
    client: ovClient,
    targetUri: 'viking://user/memories',
    sessionIdResolver: () => sessionId,
    includeActiveMessages: true,
  });

  const runtime = { config: { configurable: { thread_id: sessionId } } };

  async function modelNode(state: State): Promise<Partial<State>> {
    const currentMessages = [...state.messages];

    const makeRequest = (
      messages: BaseMessage[],
      systemMessage: BaseMessage | null,
    ): ModelRequestLike => ({
      state: {},
      runtime,
      messages,
      systemMessage,
      override(overrides) {
        return makeRequest(
          overrides.messages ?? this.messages,
          overrides.systemMessage ?? this.systemMessage ?? null,
        );
      },
    });

    const handler = (request: ModelRequestLike): BaseMessage => {
      const context = request.systemMessage
        ? extractMessageText(request.systemMessage.content)
        : '';
      if (context.toLowerCase().includes('azure')) {
        return new AIMessage('OpenViking middleware context says azure.');
      }
      return new AIMessage('OpenViking middleware context was missing.');
    };

    const response = await middleware.wrapModelCall(makeRequest(currentMessages, null), handler);
    await middleware.afterAgent({ messages: [...currentMessages, response] }, runtime);
    return { messages: [response] };
  }

  return new StateGraph(AgentState)
    .addNode('model', modelNode)
    .addEdge(START, 'model')
    .addEdge('model', END)
    .compile();
}

export async function main(): Promise<string> {
  const app = buildApp();
  const result = await app.invoke({
    messages: [new HumanMessage('What should this middleware example use?')],
  });
  const answer = String(result.messages[result.messages.length - 1].content);
  console.log(answer);
  return answer;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
