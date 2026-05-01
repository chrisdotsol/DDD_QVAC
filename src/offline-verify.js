import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_COMPLETION_MODEL, FIXED_DEMO_QUERY } from './config.js';
import { chatCompletion, listModels } from './qvac-client.js';
import { retrieveChunks } from './retrieval.js';
import { buildMessages, checkVoiceRules } from './prompt-builder.js';
import { findUnexpectedNumbers, validateAnswerSchema } from './answer-guardrails.js';
import { normalizeModelFourSectionAnswer, sanitizeLocalModelReply } from './conversation-handles.js';
import { paths, intelligenceRoot } from './paths.js';

const attemptedUrls = [];

async function localOnlyFetch(url, options) {
  const href = String(url);
  attemptedUrls.push(href);
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(href)) {
    throw new Error(`Non-localhost request attempted: ${href}`);
  }
  return fetch(url, options);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function scanForHostedKeys(dir) {
  const hits = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        await walk(full);
        continue;
      }
      if (!/\.(js|json|md|html|txt)$/.test(entry.name)) continue;
      const text = await readFile(full, 'utf8');
      const hostedPatterns = [
        ['OPENAI', 'API', 'KEY'].join('_'),
        ['ANTHROPIC', 'API', 'KEY'].join('_'),
        ['GEMINI', 'API', 'KEY'].join('_'),
        ['api', 'openai', 'com'].join('.'),
        ['api', 'anthropic', 'com'].join('.'),
        ['generativelanguage', 'googleapis', 'com'].join('.')
      ];
      if (hostedPatterns.some((pattern) => text.toLowerCase().includes(pattern.toLowerCase()))) {
        hits.push(full);
      }
    }
  }
  await walk(dir);
  return hits;
}

async function main() {
  const startedAt = Date.now();
  const [snapshot, onchainSnapshot, index, systemPrompt] = await Promise.all([
    readJson(paths.snapshot),
    readJson(paths.onchainSnapshot),
    readJson(paths.knowledgeIndex),
    readFile(paths.systemPrompt, 'utf8')
  ]);

  const keyHits = await scanForHostedKeys(intelligenceRoot);
  const models = await listModels({ fetchImpl: localOnlyFetch });
  const chunks = retrieveChunks(FIXED_DEMO_QUERY, index, { limit: 8 });
  const messages = buildMessages({ query: FIXED_DEMO_QUERY, snapshot, onchainSnapshot, chunks, systemPrompt });
  const completion = await chatCompletion({
    messages,
    model: process.env.QVAC_MODEL || DEFAULT_COMPLETION_MODEL,
    fetchImpl: localOnlyFetch
  });

  const nonLocalAttempts = attemptedUrls.filter((url) => !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url));
  const normalizedAnswer = normalizeModelFourSectionAnswer(sanitizeLocalModelReply((completion.answer || '').trim()), {
    snapshot,
    chunks
  });
  const voiceViolations = checkVoiceRules(normalizedAnswer);
  const schema = validateAnswerSchema(normalizedAnswer);
  const unexpectedNumbers = findUnexpectedNumbers(normalizedAnswer, snapshot);
  const pass = nonLocalAttempts.length === 0 && keyHits.length === 0;

  console.log('DDD Intelligence offline verification');
  console.log('Model used:', completion.model);
  console.log('Models endpoint:', JSON.stringify(models, null, 2));
  console.log('Local data files loaded:', snapshot.source_files.join(', '), 'plus intelligence knowledge index');
  console.log('Dataset status:', snapshot.dataset_status);
  console.log('Dataset timestamp:', snapshot.last_updated);
  console.log('Solana oracle reference:', onchainSnapshot.solana_program_id || 'not available');
  console.log('Solana oracle read status:', onchainSnapshot.read_status || 'not available');
  console.log('Retrieved chunks:', chunks.map((chunk) => `${chunk.id} (${chunk.source_file})`).join(', ') || 'none');
  console.log('Non-localhost network attempts:', nonLocalAttempts.length ? nonLocalAttempts.join(', ') : 'none');
  console.log('Hosted AI key/API hits:', keyHits.length ? keyHits.join(', ') : 'none');
  console.log('Answer schema:', schema.ok ? 'clean' : `missing ${schema.missingSections.join(', ')}`);
  console.log('Unexpected numbers:', unexpectedNumbers.length ? unexpectedNumbers.join(', ') : 'none');
  console.log('QVAC latency ms:', completion.latencyMs);
  console.log('End-to-end latency ms:', Date.now() - startedAt);
  console.log('\nFinal answer (after optional normalisation for schema checks):\n');
  console.log(normalizedAnswer);
  console.log('\nPass/fail:', pass ? 'PASS' : 'FAIL');

  if (!pass) {
    process.exit(1);
  }
  if (!schema.ok) {
    console.warn(`Warning (non-blocking): answer schema missing sections: ${schema.missingSections.join(', ')}`);
  }
  if (unexpectedNumbers.length) {
    console.warn(`Warning (non-blocking): unexpected numeric values: ${unexpectedNumbers.join(', ')}`);
  }
  if (voiceViolations.length) {
    console.warn(`Warning (non-blocking): voice rule violations: ${voiceViolations.join(', ')}`);
  }
}

main().catch((error) => {
  console.error('Offline verification failed:', error.message || error);
  process.exit(1);
});
