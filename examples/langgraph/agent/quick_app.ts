// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * Deterministic LangGraph smoke app using OpenViking tools and store.
 *
 * TypeScript port of
 * `examples/langchain-langgraph/langgraph/agent/quick_app.py`.
 */

import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { Annotation, END, START, StateGraph, messagesStateReducer } from '@langchain/langgraph';

import {
  InMemoryOpenVikingClient,
  OpenVikingStore,
  createOpenvikingTools,
} from '../../../src/index.js';

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  openviking_context: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => '',
  }),
});

type State = typeof AgentState.State;

export async function buildApp(client?: InMemoryOpenVikingClient) {
  const ovClient =
    client ??
    new InMemoryOpenVikingClient({
      'viking://user/memories/profile.md':
        'The user wants LangGraph agents to use OpenViking for durable context.',
      'viking://resources/runbooks/langgraph.md':
        'LangGraph workflows can call OpenViking tools before model nodes.',
    });

  const store = new OpenVikingStore({ client: ovClient });
  await store.put(['demo', 'user'], 'deployment', { color: 'azure', framework: 'langgraph' });

  const findTool = createOpenvikingTools({ client: ovClient, profile: 'retrieval' }).find(
    (t) => t.name === 'viking_find',
  )!;

  const model = new FakeListChatModel({
    responses: [
      'The LangGraph workflow should use OpenViking context and azure deployment color.',
    ],
  });

  async function recall(state: State): Promise<Partial<State>> {
    const latest = String(state.messages[state.messages.length - 1].content);
    let context = await findTool.invoke({ query: latest, limit: 4 });
    const stored = await store.search(['demo'], { query: 'azure', limit: 1 });
    if (stored.length) {
      context += `\n\nStore: ${JSON.stringify(stored[0].value)}`;
    }
    return { openviking_context: context };
  }

  async function answer(state: State): Promise<Partial<State>> {
    const latest = String(state.messages[state.messages.length - 1].content);
    const response = await model.invoke([
      new HumanMessage(
        `OpenViking context:\n${state.openviking_context ?? ''}\n\nQuestion: ${latest}`,
      ),
    ]);
    return { messages: [new AIMessage(String(response.content))] };
  }

  return new StateGraph(AgentState)
    .addNode('recall', recall)
    .addNode('answer', answer)
    .addEdge(START, 'recall')
    .addEdge('recall', 'answer')
    .addEdge('answer', END)
    .compile();
}

export async function main(): Promise<string> {
  const app = await buildApp();
  const result = await app.invoke({
    messages: [new HumanMessage('How should LangGraph use OpenViking?')],
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
