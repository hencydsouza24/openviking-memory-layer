// Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: AGPL-3.0
/**
 * Deterministic LangChain RAG smoke app using OpenViking as retriever.
 *
 * TypeScript port of
 * `examples/langchain-langgraph/langchain/rag/quick_app.py`.
 */

import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableLambda, RunnablePassthrough, RunnableSequence } from '@langchain/core/runnables';
import { FakeListChatModel } from '@langchain/core/utils/testing';

import {
  InMemoryOpenVikingClient,
  OpenVikingRetriever,
} from '../../../src/index.js';

function formatDocs(docs: any[]): string {
  return docs.map((doc) => `${doc.metadata.openviking_uri}\n${doc.pageContent}`).join('\n\n');
}

export function buildApp(client?: InMemoryOpenVikingClient) {
  const ovClient =
    client ??
    new InMemoryOpenVikingClient({
      'viking://user/memories/preferences/deploy_color.md':
        'The user prefers azure as the deployment color for LangChain examples.',
      'viking://resources/runbooks/langchain.md':
        'LangChain RAG apps should pass OpenViking recall into the prompt context.',
    });

  const retriever = new OpenVikingRetriever({
    client: ovClient,
    targetUri: ['viking://user/memories', 'viking://resources'],
    limit: 4,
    contentMode: 'auto',
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', 'Answer from the supplied OpenViking context.\n\n{context}'],
    ['human', '{question}'],
  ]);

  const model = new FakeListChatModel({
    responses: ['OpenViking recall says the deployment color is azure.'],
  });

  return RunnableSequence.from([
    {
      context: retriever.pipe(new RunnableLambda({ func: formatDocs })),
      question: new RunnablePassthrough(),
    },
    prompt,
    model,
    new StringOutputParser(),
  ]);
}

export async function main(): Promise<string> {
  const app = buildApp();
  const answer = await app.invoke('Which deployment color should the LangChain example use?');
  console.log(answer);
  return answer;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
