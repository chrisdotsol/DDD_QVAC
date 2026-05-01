import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGuardrailFallbackAnswer,
  evaluateAnswerGuardrails,
  findUnexpectedNumbers,
  validateAnswerSchema
} from '../src/answer-guardrails.js';
import { checkVoiceRules, isSolanaChain, localResearchDataPack, snapshotSummary } from '../src/prompt-builder.js';
import { retrieveChunks, retrievalQueryTokens, tokenize } from '../src/retrieval.js';
import { assertLocalUrl, stripThinking } from '../src/qvac-client.js';

const snapshot = {
  generated_at: '2026-04-29T00:00:00.000Z',
  dataset_status: 'frozen_demo_snapshot',
  ddd_percent: 1.4019,
  stablecoin_market_cap_usd: 305000000000,
  us_m2_usd: 21750000000000,
  one_in_x: 71,
  last_updated: '2026-04-29T00:00:00.000Z',
  issuers: [
    { name: 'Tether', symbol: 'USDT', market_cap_usd: 175000000000, share_percent: 57.38 },
    { name: 'Circle', symbol: 'USDC', market_cap_usd: 95000000000, share_percent: 31.15 }
  ],
  chains: [
    { name: 'Ethereum', stablecoin_supply_usd: 180000000000, share_percent: 59.02, rank: 1 },
    { name: 'Tron', stablecoin_supply_usd: 75000000000, share_percent: 24.59, rank: 2 },
    { name: 'Solana', stablecoin_supply_usd: 12000000000, share_percent: 3.93, rank: 3 }
  ]
};

test('validateAnswerSchema: passes when all four sections present', () => {
  const answer = 'Answer\nBody.\n\nData Used\nx\n\nSources Used\ny\n\nMissing Data\nz';
  assert.deepEqual(validateAnswerSchema(answer), { ok: true, missingSections: [] });
});

test('validateAnswerSchema: passes with markdown-style section headers', () => {
  const answer = [
    '## Answer',
    'Body.',
    '',
    '**Data Used**',
    'x',
    '',
    'Sources Used: inline ok',
    '',
    'Missing Data',
    'z'
  ].join('\n');
  assert.deepEqual(validateAnswerSchema(answer), { ok: true, missingSections: [] });
});

test('validateAnswerSchema: flags missing sections', () => {
  const answer = 'Answer\nBody only.';
  const result = validateAnswerSchema(answer);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingSections, ['Data Used', 'Sources Used', 'Missing Data']);
});

test('validateAnswerSchema: rejects header-only shells', () => {
  const answer = 'Answer\n\nData Used\n\nSources Used\n\nMissing Data';
  const result = validateAnswerSchema(answer);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingSections, ['Answer', 'Data Used', 'Sources Used', 'Missing Data']);
});

test('validateAnswerSchema: parse fallback accepts four sections when line-regex misses a header', () => {
  const answer = [
    'Preamble the model added on line one without a header.',
    '',
    'Answer',
    'Body for answer.',
    '',
    'Data Used',
    'Used snapshot.',
    '',
    'Sources Used',
    'knowledge/x.md',
    '',
    'Missing Data',
    'None.'
  ].join('\n');
  const result = validateAnswerSchema(answer);
  assert.equal(result.ok, true, result.missingSections?.join(', '));
});

test('validateAnswerSchema: passes when Answer body echoes headers with ZWSP but real sections exist', () => {
  const zwsp = '\u200b';
  const answer = [
    'Answer',
    'The issuer table mentions Data Used as a phrase.',
    `${zwsp}Data Used: not a real section break`,
    '',
    'Data Used',
    'snapshot.issuers rows for USDS and USDT',
    '',
    'Sources Used',
    'knowledge/issuer-notes.md',
    '',
    'Missing Data',
    'none'
  ].join('\n');
  const result = validateAnswerSchema(answer);
  assert.equal(result.ok, true, result.missingSections.join(', '));
});

test('findUnexpectedNumbers: snapshot values are allowed', () => {
  const answer = `Answer\nDDD is 1.4019% and Tether is $175,000,000,000.\n\nData Used\nx\n\nSources Used\ny\n\nMissing Data\nz`;
  assert.deepEqual(findUnexpectedNumbers(answer, snapshot), []);
});

test('findUnexpectedNumbers: flags fabricated numbers', () => {
  const answer = `Answer\nDDD is 9.9999%.\n\nData Used\nx\n\nSources Used\ny\n\nMissing Data\nz`;
  const unexpected = findUnexpectedNumbers(answer, snapshot);
  assert.ok(unexpected.includes('9.9999'), `expected 9.9999 in ${unexpected.join(',')}`);
});

test('findUnexpectedNumbers: rejects fabricated year (timestamps not allowed)', () => {
  const answer = `Answer\nIn 2099 things changed.\n\nData Used\nx\n\nSources Used\ny\n\nMissing Data\nz`;
  const unexpected = findUnexpectedNumbers(answer, snapshot);
  assert.ok(unexpected.includes('2099'));
});

test('findUnexpectedNumbers: allows years present on snapshot timestamps', () => {
  const answer = `Answer\nFigures are from the 2026 frozen snapshot; DDD is 1.4019%.\n\nData Used\nx\n\nSources Used\ny\n\nMissing Data\nz`;
  assert.deepEqual(findUnexpectedNumbers(answer, snapshot), []);
});

test('evaluateAnswerGuardrails: fails on voice and missing schema', () => {
  const bad = 'This is bullish. No sections here.';
  const ev = evaluateAnswerGuardrails(bad, snapshot);
  assert.equal(ev.ok, false);
  assert.ok(ev.voiceViolations.includes('bullish'));
  assert.equal(ev.schema.ok, false);
});

test('evaluateAnswerGuardrails: passes well-formed factual answer', () => {
  const good = [
    'Answer',
    'DDD is 1.4019% in this dataset.',
    '',
    'Data Used',
    'Local snapshot ddd_percent.',
    '',
    'Sources Used',
    'knowledge/ddd-methodology.md',
    '',
    'Missing Data',
    'None for this question.'
  ].join('\n');
  const ev = evaluateAnswerGuardrails(good, snapshot);
  assert.equal(ev.ok, true);
});

test('evaluateAnswerGuardrails: numeric drift does not fail ok', () => {
  const drift = [
    'Answer',
    'USDC market cap cited as $77,343,177,991.89 (rounded).',
    '',
    'Data Used',
    'snapshot.',
    '',
    'Sources Used',
    'knowledge/ddd-methodology.md',
    '',
    'Missing Data',
    'None.'
  ].join('\n');
  const ev = evaluateAnswerGuardrails(drift, snapshot);
  assert.equal(ev.ok, true);
  assert.ok(ev.unexpectedNumbers.length > 0);
  assert.ok(ev.numericHint.includes('exact snapshot'));
});

test('buildGuardrailFallbackAnswer: includes check reason and catalog tip', () => {
  const text = buildGuardrailFallbackAnswer({
    snapshot,
    chunks: [],
    evaluation: { issues: ['Numeric guardrail: test.'] }
  });
  assert.match(text, /Checks:.*Numeric guardrail/i);
  assert.match(text, /shortcuts=0|catalog answers/i);
});

test('findUnexpectedNumbers: ignores digits inside Solana program addresses', () => {
  const answer = `Answer\nSolana program ID: AbjVyP3WaY9yMG8AT8vNcLHcNoFkT5dwT94SPQ8kddd.\n\nData Used\nx\n\nSources Used\ny\n\nMissing Data\nz`;
  assert.deepEqual(findUnexpectedNumbers(answer, snapshot), []);
});

test('checkVoiceRules: flags whole-word violations', () => {
  assert.deepEqual(checkVoiceRules('This is bullish on stablecoins.'), ['bullish']);
});

test('checkVoiceRules: ignores substring false positives', () => {
  assert.deepEqual(checkVoiceRules('The cadence is steady.'), []);
  assert.deepEqual(checkVoiceRules('Adoption growth is observed.'), []);
});

test('isSolanaChain: matches variants and rejects others', () => {
  assert.equal(isSolanaChain({ name: 'Solana' }), true);
  assert.equal(isSolanaChain({ name: 'solana' }), true);
  assert.equal(isSolanaChain({ name: 'SOL' }), true);
  assert.equal(isSolanaChain({ name: 'Solana L1' }), true);
  assert.equal(isSolanaChain({ name: 'Ethereum' }), false);
  assert.equal(isSolanaChain({}), false);
});

test('snapshotSummary: picks largest issuer, largest chain, and Solana', () => {
  const summary = snapshotSummary(snapshot);
  assert.equal(summary.largest_issuer.symbol, 'USDT');
  assert.equal(summary.largest_chain.name, 'Ethereum');
  assert.equal(summary.solana_chain_share.name, 'Solana');
});

test('localResearchDataPack: includes issuer, chain, and onchain context for custom prompts', () => {
  const pack = localResearchDataPack(snapshot, {
    solana_program_id: 'AbjVyP3WaY9yMG8AT8vNcLHcNoFkT5dwT94SPQ8kddd',
    cluster: 'devnet',
    oracle_model: 'DDD Oracle on Solana push oracle',
    pda_seeds: ['oracle', 'chains', 'issuers', 'tokens'],
    read_status: 'not_read_during_offline_demo',
    runtime_note: 'local cache only',
    cached_values: { ddd_percent: 1.4019 }
  });
  assert.equal(pack.top_issuers.length, 2);
  assert.equal(pack.top_chains.length, 3);
  assert.equal(pack.solana_oracle_reference.solana_program_id, 'AbjVyP3WaY9yMG8AT8vNcLHcNoFkT5dwT94SPQ8kddd');
});

test('tokenize: drops stop words and short tokens', () => {
  const tokens = tokenize('What is the largest issuer in the snapshot?');
  assert.ok(tokens.includes('largest'));
  assert.ok(tokens.includes('issuer'));
  assert.ok(!tokens.includes('the'));
  assert.ok(!tokens.includes('is'));
});

test('retrieveChunks: returns top-scoring chunk first', () => {
  const index = {
    chunks: [
      { id: 'a', source_file: 'a.md', title: 'Solana share', text: 'Solana stablecoin chain share notes.', keywords: ['solana', 'chain', 'share'] },
      { id: 'b', source_file: 'b.md', title: 'Methodology', text: 'DDD methodology details.', keywords: ['methodology', 'ddd'] }
    ]
  };
  const results = retrieveChunks('Show Solana chain share', index, { limit: 5 });
  assert.equal(results[0].id, 'a');
});

test('retrievalQueryTokens: expands stablecoins to stablecoin and keeps multi-digit numbers', () => {
  const q = 'How large are stablecoins compared with US M2? What does 1 in 71 mean?';
  const set = retrievalQueryTokens(q);
  assert.ok(set.has('stablecoins'));
  assert.ok(set.has('stablecoin'));
  assert.ok(set.has('71'));
});

test('retrieveChunks: plural stablecoins still surfaces methodology', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const index = JSON.parse(readFileSync(join(here, '../index/knowledge-index.json'), 'utf8'));
  const results = retrieveChunks('How large are stablecoins compared with US M2 today?', index, { limit: 5 });
  const files = results.map((c) => c.source_file);
  assert.ok(files.includes('knowledge/ddd-methodology.md'));
});

test('retrieveChunks: zero-match query falls back to methodology-first order', () => {
  const index = {
    chunks: [
      { id: 'z', source_file: 'knowledge/source-notes.md', title: 'Z', text: 'zzz', keywords: ['zzz'] },
      { id: 'm', source_file: 'knowledge/ddd-methodology.md', title: 'M', text: 'method', keywords: ['method'] }
    ]
  };
  const results = retrieveChunks('xyzzy plugh', index, { limit: 2 });
  assert.equal(results[0].id, 'm');
  assert.equal(results[1].id, 'z');
});

test('stripThinking: removes closed and unterminated think tags', () => {
  assert.equal(stripThinking('<think>scratch</think>final'), 'final');
  assert.equal(stripThinking('<think>scratch</think>final'), 'final');
  assert.equal(stripThinking('<|redacted_thinking|>scratch</|redacted_thinking|>final'), 'final');
  assert.equal(stripThinking('<|redacted_thinking|>scratch</think>final'), 'final');
  assert.equal(stripThinking('<think>scratch only'), '');
  assert.equal(stripThinking('<|redacted_thinking|>scratch only'), '');
  assert.equal(stripThinking('plain'), 'plain');
});

test('assertLocalUrl: accepts loopback, rejects others', () => {
  assert.doesNotThrow(() => assertLocalUrl('http://127.0.0.1:11434/v1/models'));
  assert.doesNotThrow(() => assertLocalUrl('http://localhost:11434/v1/models'));
  assert.throws(() => assertLocalUrl('https://api.openai.com/v1/models'));
  assert.throws(() => assertLocalUrl('http://10.0.0.5:11434/v1/models'));
});
