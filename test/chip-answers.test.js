import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChipQuery, normalizeChipQuery, tryBuildChipAnswer } from '../src/chip-answers.js';
import { evaluateAnswerGuardrails } from '../src/answer-guardrails.js';

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

const chunks = [{ source_file: 'knowledge/ddd-methodology.md', title: 'DDD Methodology', text: 'x' }];

test('normalizeChipQuery: expands what is contractions before possessive stripping', () => {
  assert.equal(normalizeChipQuery("What's US M2?"), 'what is us m2');
  assert.equal(normalizeChipQuery('Whats m2'), 'what is m2');
});

test('classifyChipQuery: maps suggested and advanced chip wording', () => {
  assert.equal(classifyChipQuery('How large are stablecoins compared with US M2 today?'), 'm2_comparison');
  assert.equal(classifyChipQuery('compare stablecoin size vs m2'), 'm2_comparison');
  assert.equal(classifyChipQuery('What does “1 in 71 dollars” mean?'), 'one_in_x_meaning');
  assert.equal(classifyChipQuery('what does one in x mean'), 'one_in_x_meaning');
  assert.equal(classifyChipQuery('Which issuer has the largest share?'), 'largest_issuer');
  assert.equal(classifyChipQuery('top issuer share right now'), 'largest_issuer');
  assert.equal(classifyChipQuery('Which chains hold the largest stablecoin supply?'), 'top_chains');
  assert.equal(classifyChipQuery('which network has the biggest stablecoin supply'), 'top_chains');
  assert.equal(classifyChipQuery('How far are stablecoins from 2 percent of US M2?'), 'distance_to_two');
  assert.equal(classifyChipQuery('what is the gap to 2% for ddd'), 'distance_to_two');
  assert.equal(classifyChipQuery('What data is missing from this local snapshot?'), 'missing_fields');
  assert.equal(classifyChipQuery('what fields are unavailable in this snapshot'), 'missing_fields');
  assert.equal(classifyChipQuery('Compare Solana’s stablecoin share with the largest chain.'), 'solana_vs_largest_chain');
  assert.equal(classifyChipQuery('solana vs top chain share compare'), 'solana_vs_largest_chain');
  assert.equal(classifyChipQuery('create a factual prediction market template for crossing 2% m2'), 'prediction_market');
  assert.equal(classifyChipQuery('explain local methodology from snapshot sources'), 'methodology_brief');
  assert.equal(classifyChipQuery('which data was used in this response'), 'meta_snapshot');
});

test('tryBuildChipAnswer: passes guardrails for every chip kind', () => {
  const kinds = [
    'How large are stablecoins compared with US M2 today?',
    'What does 1 in 71 dollars mean?',
    'Which issuer has the largest share?',
    'Which chains hold the largest stablecoin supply?',
    'How far are stablecoins from 2 percent of US M2?',
    'What data is missing from this local snapshot?',
    'Compare Solana stablecoin share with the largest chain.',
    'Generate a factual prediction market question for stablecoins crossing 2 percent of US M2.',
    'Summarise the methodology using only local sources.',
    'Show the data used for this answer.'
  ];
  for (const q of kinds) {
    const text = tryBuildChipAnswer({ query: q, snapshot, chunks });
    assert.ok(text && text.length > 80, q);
    const ev = evaluateAnswerGuardrails(text, snapshot);
    assert.equal(ev.ok, true, `${q}: ${ev.issues.join('; ')}`);
  }
});
