import { readFile } from 'node:fs/promises';
import { DEFAULT_COMPLETION_MODEL, FIXED_DEMO_QUERY } from './config.js';
import { chatCompletion, listModels } from './qvac-client.js';
import { retrieveChunks } from './retrieval.js';
import { buildMessages } from './prompt-builder.js';
import { paths } from './paths.js';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const [snapshot, onchainSnapshot, index, systemPrompt] = await Promise.all([
    readJson(paths.snapshot),
    readJson(paths.onchainSnapshot),
    readJson(paths.knowledgeIndex),
    readFile(paths.systemPrompt, 'utf8')
  ]);

  const models = await listModels();
  console.log('QVAC models endpoint responded.');
  console.log(JSON.stringify(models, null, 2));

  const chunks = retrieveChunks(FIXED_DEMO_QUERY, index, { limit: 8 });
  const messages = buildMessages({ query: FIXED_DEMO_QUERY, snapshot, onchainSnapshot, chunks, systemPrompt });
  const result = await chatCompletion({ messages, model: process.env.QVAC_MODEL || DEFAULT_COMPLETION_MODEL });

  console.log('\nModel used:', result.model);
  console.log('Latency ms:', result.latencyMs);
  console.log('\nAnswer:\n');
  console.log(result.answer);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
