// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * Live LangGraph app using OpenViking middleware and an OpenAI-compatible LLM.
 *
 * TypeScript port of
 * `examples/langchain-langgraph/langgraph/agent/live_app.py`.
 *
 * Required:
 *   ARK_API_KEY
 * Optional:
 *   ARK_BASE_URL, ARK_MODEL
 *   OPENVIKING_URL, OPENVIKING_API_KEY, OPENVIKING_LIVE_COMMIT_TIMEOUT
 *
 * Unlike the deterministic examples, this one needs a running OpenViking server
 * and an OpenAI-compatible endpoint, so it is not part of the smoke test suite.
 */

import { randomUUID } from 'node:crypto';

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph, messagesStateReducer } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';

import {
  OpenVikingContextMiddleware,
  SyncHTTPClient,
  extractMessageText,
} from '../../../src/index.js';
import type { ModelRequestLike } from '../../../src/index.js';

const LiveState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

type State = typeof LiveState.State;

async function buildContextClient(): Promise<SyncHTTPClient> {
  const client = new SyncHTTPClient({
    url: process.env.OPENVIKING_URL || undefined,
    apiKey: process.env.OPENVIKING_API_KEY,
    userId: process.env.OPENVIKING_USER_ID,
  });
  await client.initialize();
  return client;
}

async function seedContext(client: SyncHTTPClient, sessionId: string, code: string): Promise<void> {
  await client.create_session({ sessionId });
  await client.add_message({
    sessionId,
    role: 'user',
    parts: [
      {
        type: 'text',
        text:
          `Remember this OpenViking LangGraph live e2e exact code: ${code}. ` +
          'This is durable session context for the next agent turn.',
      },
    ],
  });
  await client.add_message({
    sessionId,
    role: 'assistant',
    parts: [
      { type: 'text', text: `Stored the OpenViking LangGraph live e2e exact code: ${code}.` },
    ],
  });
}

function buildApp(client: SyncHTTPClient, sessionId: string) {
  const middleware = new OpenVikingContextMiddleware({
    client,
    tokenBudget: 8_000,
    commitOnAfterAgent: false,
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

    const handler = async (request: ModelRequestLike): Promise<BaseMessage> => {
      const messages: BaseMessage[] = [];
      if (request.systemMessage != null) messages.push(request.systemMessage);
      messages.push(...request.messages);
      const answer = await callLlm(messages);
      return new AIMessage(answer);
    };

    const response = await middleware.wrapModelCall(makeRequest(currentMessages, null), handler);
    await middleware.afterAgent({ messages: [...currentMessages, response] }, runtime);
    return { messages: [response] };
  }

  return new StateGraph(LiveState)
    .addNode('model', modelNode)
    .addEdge(START, 'model')
    .addEdge('model', END)
    .compile();
}

async function callLlm(messages: BaseMessage[]): Promise<string> {
  const llm = new ChatOpenAI({
    apiKey: process.env.ARK_API_KEY,
    model: process.env.ARK_MODEL ?? 'doubao-seed-2-0-code-preview-260215',
    configuration: {
      baseURL: process.env.ARK_BASE_URL ?? 'https://ark-cn-beijing.bytedance.net/api/v3',
    },
  });

  const prompt: BaseMessage[] = [
    new SystemMessage(
      'You are validating OpenViking as LangGraph middleware. Return only the exact lg_live_* ' +
        'code if one appears in the context or conversation.',
    ),
    ...messages.map((message) => {
      const content = extractMessageText(message.content);
      if (message instanceof SystemMessage) return new SystemMessage(content);
      if (message instanceof AIMessage) return new AIMessage(content);
      return new HumanMessage(content);
    }),
  ];

  const completion = await llm.invoke(prompt);
  return String(completion.content ?? '');
}

async function waitForCommitTask(client: SyncHTTPClient, commit: Record<string, any>): Promise<void> {
  if (commit.archived !== true || !commit.task_id) {
    throw new Error(`OpenViking commit did not start extraction: ${JSON.stringify(commit)}`);
  }
  const timeout = Number(process.env.OPENVIKING_LIVE_COMMIT_TIMEOUT ?? '180') * 1000;
  const deadline = Date.now() + timeout;
  let lastTask: any = null;
  while (Date.now() < deadline) {
    const task = await client.get_task(String(commit.task_id));
    lastTask = task;
    if (task && task.status === 'completed') return;
    if (task && task.status === 'failed') {
      throw new Error(`OpenViking commit task failed: ${JSON.stringify(task)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `OpenViking commit task did not complete: ${commit.task_id}; last_task=${JSON.stringify(lastTask)}`,
  );
}

export async function main(): Promise<string> {
  if (!process.env.ARK_API_KEY) {
    throw new Error('ARK_API_KEY is required for the live app.');
  }

  const client = await buildContextClient();
  const sessionId = `langgraph-live-demo-${randomUUID().replace(/-/g, '')}`;
  const code = `lg_live_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  await seedContext(client, sessionId, code);
  try {
    const app = buildApp(client, sessionId);
    const result = await app.invoke({
      messages: [
        new HumanMessage(
          'What is the OpenViking LangGraph live e2e exact code? Answer only the exact code.',
        ),
      ],
    });
    const answer = String(result.messages[result.messages.length - 1].content);
    console.log(answer);
    if (!answer.toLowerCase().includes(code)) {
      throw new Error(`Expected ${JSON.stringify(code)} in live answer: ${JSON.stringify(answer)}`);
    }
    const commit = await client.commit_session({ sessionId });
    await waitForCommitTask(client, commit);
    return answer;
  } finally {
    try {
      await client.delete_session({ sessionId });
    } catch {
      // ignore cleanup failures
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
