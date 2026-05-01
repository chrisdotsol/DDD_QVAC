import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAnswerGuardrails } from '../src/answer-guardrails.js';
import { pickIssuerFromQuery, tryBuildIntentAnswer } from '../src/intent-answers.js';

const snapshot = {
  generated_at: '2026-04-29T00:00:00.000Z',
  dataset_status: 'frozen_demo_snapshot',
  ddd_percent: 1.4019,
  stablecoin_market_cap_usd: 305000000000,
  us_m2_usd: 21750000000000,
  one_in_x: 71,
  last_updated: '2026-04-29T19:23:39.232Z',
  issuers: [
    {
      name: 'Tether',
      symbol: 'USDT',
      market_cap_usd: 175000000000,
      share_percent: 57.38,
      entity: 'Tether Limited',
      backing_type: 'fiat'
    },
    {
      name: 'Circle',
      symbol: 'USDC',
      market_cap_usd: 95000000000,
      share_percent: 31.15,
      entity: 'Circle Internet Financial',
      backing_type: 'fiat'
    }
  ],
  chains: [
    { name: 'Ethereum', stablecoin_supply_usd: 180000000000, share_percent: 59.02, rank: 1 },
    { name: 'Solana', stablecoin_supply_usd: 12000000000, share_percent: 3.93, rank: 3 }
  ]
};

const onchainSnapshot = {
  solana_program_id: 'AbjVyP3WaY9yMG8AT8vNcLHcNoFkT5dwT94SPQ8kddd',
  cluster: 'devnet',
  oracle_model: 'DDD Oracle on Solana push oracle',
  read_status: 'not_read_during_offline_demo',
  runtime_note: 'local file only',
  cached_values: {
    ddd_percent: 1.4019,
    solana_chain_share: {
      name: 'Solana',
      stablecoin_supply_usd: 15159883697,
      share_percent: 4.9912,
      rank: 3
    }
  }
};

test('pickIssuerFromQuery resolves ticker and name', () => {
  const byTicker = pickIssuerFromQuery('What is USDT?', snapshot);
  assert.equal(byTicker?.symbol, 'USDT');
  const byName = pickIssuerFromQuery('explain tether', snapshot);
  assert.equal(byName?.name, 'Tether');
});

test('tryBuildIntentAnswer: USDT definition', () => {
  const text = tryBuildIntentAnswer({
    query: 'What is USDT?',
    snapshot,
    onchainSnapshot,
    chunks: []
  });
  assert.ok(text);
  assert.match(text, /Tether/i);
  assert.match(text, /USDT/);
  assert.match(text, /stablecoin/i);
  assert.match(text, /ticker/i);
  const ev = evaluateAnswerGuardrails(text, snapshot, { supplementals: [onchainSnapshot] });
  assert.equal(ev.ok, true, ev.issues.join(' | '));
});

test('tryBuildIntentAnswer: largest issuer question', () => {
  const text = tryBuildIntentAnswer({
    query: 'Who is the largest issuer?',
    snapshot,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(text);
  assert.match(text, /Tether/i);
  assert.match(text, /USDT/);
  const ev = evaluateAnswerGuardrails(text, snapshot, { supplementals: [] });
  assert.equal(ev.ok, true, ev.issues.join(' | '));
});

test('tryBuildIntentAnswer: what does DDD mean', () => {
  const text = tryBuildIntentAnswer({
    query: 'What does DDD mean?',
    snapshot,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(text);
  assert.match(text, /Digital Dollar Dominance/i);
  assert.match(text, /M2/i);
  const ev = evaluateAnswerGuardrails(text, snapshot, { supplementals: [] });
  assert.equal(ev.ok, true, ev.issues.join(' | '));
});

test('tryBuildIntentAnswer: DDI typo treated as DDD meaning question', () => {
  const text = tryBuildIntentAnswer({
    query: 'What does that mean DDI?',
    snapshot,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(text);
  assert.match(text, /Digital Dollar Dominance/i);
  const ev = evaluateAnswerGuardrails(text, snapshot, { supplementals: [] });
  assert.equal(ev.ok, true, ev.issues.join(' | '));
});

test('tryBuildIntentAnswer: M2 and DDD', () => {
  const m2 = tryBuildIntentAnswer({
    query: "What's US M2 money supply in this demo?",
    snapshot,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(m2);
  assert.match(m2, /M2/i);
  const evM2 = evaluateAnswerGuardrails(m2, snapshot, { supplementals: [] });
  assert.equal(evM2.ok, true, evM2.issues.join(' | '));

  const ddd = tryBuildIntentAnswer({
    query: 'What is DDD percent?',
    snapshot,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(ddd);
  assert.match(ddd, /1\.40|DDD/i);
  const evDdd = evaluateAnswerGuardrails(ddd, snapshot, { supplementals: [] });
  assert.equal(evDdd.ok, true, evDdd.issues.join(' | '));
});

test('tryBuildIntentAnswer: Solana chain vs oracle reference', () => {
  const chain = tryBuildIntentAnswer({
    query: 'What is Solana in this dataset?',
    snapshot,
    onchainSnapshot,
    chunks: []
  });
  assert.ok(chain);
  assert.match(chain, /Solana/i);
  assert.doesNotMatch(chain, /Program id:/);

  const oracle = tryBuildIntentAnswer({
    query: 'What is the DDD oracle on Solana?',
    snapshot,
    onchainSnapshot,
    chunks: []
  });
  assert.ok(oracle);
  assert.match(oracle, /Program id:/i);
  assert.match(oracle, /does not call Solana RPC/i);
  const ev = evaluateAnswerGuardrails(oracle, snapshot, { supplementals: [onchainSnapshot] });
  assert.equal(ev.ok, true, ev.issues.join(' | '));
});

test('tryBuildIntentAnswer: bare ticker still answered', () => {
  const text = tryBuildIntentAnswer({
    query: 'USDT',
    snapshot,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(text);
  assert.match(text, /Tether/i);
});

test('tryBuildIntentAnswer: USDS vs USDT factual comparison is deterministic (not rank-1 vs USDC)', () => {
  const snap = {
    ...snapshot,
    issuers: [
      ...snapshot.issuers,
      {
        name: 'Sky Dollar',
        symbol: 'USDS',
        market_cap_usd: 7816702348,
        share_percent: 2.4578,
        entity: 'Sky (formerly MakerDAO)',
        backing_type: 'hybrid'
      }
    ]
  };
  const text = tryBuildIntentAnswer({
    query: 'USDS vs USDT',
    snapshot: snap,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(text);
  assert.match(text, /\bUSDS\b/i);
  assert.match(text, /\bUSDT\b/i);
  assert.match(text, /Sky Dollar/i);
  assert.match(text, /Tether/i);
  assert.doesNotMatch(text, /\bUSDC\b/);
  const ev = evaluateAnswerGuardrails(text, snap, { supplementals: [] });
  assert.equal(ev.ok, true, ev.issues.join(' | '));
});

test('tryBuildIntentAnswer: USDS vs USDT with location yields null so QVAC can answer', () => {
  const snap = {
    ...snapshot,
    issuers: [
      ...snapshot.issuers,
      {
        name: 'Sky Dollar',
        symbol: 'USDS',
        market_cap_usd: 7816702348,
        share_percent: 2.4578,
        entity: 'Sky (formerly MakerDAO)',
        backing_type: 'hybrid'
      }
    ]
  };
  assert.equal(
    tryBuildIntentAnswer({
      query: 'im in bali can I use USDS or USDT',
      snapshot: snap,
      onchainSnapshot: null,
      chunks: []
    }),
    null
  );
});

test('tryBuildIntentAnswer: Bali + USDT vs USDC still uses neutral preset', () => {
  const text = tryBuildIntentAnswer({
    query: 'im in bali should I use USDT or USDC?',
    snapshot,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(text);
  assert.match(text, /Bali/i);
  assert.match(text, /USDC/i);
  assert.doesNotMatch(text, /Bali Can I/i);
});

test('tryBuildIntentAnswer: stablecoin choice questions become neutral checklist answers', () => {
  const text = tryBuildIntentAnswer({
    query: 'I am in the USA, should I use USDT or USDC?',
    snapshot,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(text);
  assert.match(text, /cannot pick a winner/i);
  assert.match(text, /USA/i);
  assert.match(text, /- USDT:/i);
  assert.match(text, /- USDC:/i);
  assert.match(text, /Pros-style notes/i);
  assert.match(text, /Cons-style notes/i);
  const ev = evaluateAnswerGuardrails(text, snapshot, { supplementals: [] });
  assert.equal(ev.ok, true, ev.issues.join(' | '));
});

test('tryBuildIntentAnswer: non-USA stablecoin choice questions are handled without jurisdiction claims', () => {
  const text = tryBuildIntentAnswer({
    query: 'I live in Canada, which stablecoin is better, USDT or USDC?',
    snapshot,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(text);
  assert.match(text, /someone in Canada/i);
  assert.match(text, /Pros-style notes/i);
  assert.match(text, /Country-specific pros and cons/i);
  const ev = evaluateAnswerGuardrails(text, snapshot, { supplementals: [] });
  assert.equal(ev.ok, true, ev.issues.join(' | '));
});

test('tryBuildIntentAnswer: pros and cons in a country without should/which still matches', () => {
  const text = tryBuildIntentAnswer({
    query: "I'm in France — pros and cons of USDT vs USDC?",
    snapshot,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(text);
  assert.match(text, /someone in France/i);
  assert.match(text, /USDT — common angles/i);
  const ev = evaluateAnswerGuardrails(text, snapshot, { supplementals: [] });
  assert.equal(ev.ok, true, ev.issues.join(' | '));
});

test('tryBuildIntentAnswer: Ledger + USDC for me skips issuer suitability (defer to model + knowledge)', () => {
  assert.equal(
    tryBuildIntentAnswer({
      query: 'are ledgers safe for me to store my usdc on',
      snapshot,
      onchainSnapshot: null,
      chunks: [{ source_file: 'knowledge/hardware-wallets-ledgers.md', title: 'Ledgers', text: 'x' }]
    }),
    null
  );
});

test('tryBuildIntentAnswer: USDC safe for me without custody device context still uses suitability preset', () => {
  const text = tryBuildIntentAnswer({
    query: 'is USDC safe for me to hold long term',
    snapshot,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(text);
  assert.match(text, /cannot answer yes or no/i);
});

test('tryBuildIntentAnswer: single-ticker suitability in a country is not the generic issuer blurb', () => {
  const text = tryBuildIntentAnswer({
    query: 'Is USDC a good solution for me in the USA?',
    snapshot,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(text);
  assert.match(text, /cannot answer yes or no/i);
  assert.match(text, /USA/i);
  assert.match(text, /Circle/i);
  assert.match(text, /USDC/i);
  assert.match(text, /Pros-style notes/i);
  assert.match(text, /Cons-style notes/i);
  assert.doesNotMatch(text, /issuer row in this frozen snapshot\.?\s*\n\s*its tracked stablecoin/i);
  const ev = evaluateAnswerGuardrails(text, snapshot, { supplementals: [] });
  assert.equal(ev.ok, true, ev.issues.join(' | '));
});

test('tryBuildIntentAnswer: should I use USDC without country still gets suitability framing', () => {
  const text = tryBuildIntentAnswer({
    query: 'Should I use USDC for everyday spending?',
    snapshot,
    onchainSnapshot: null,
    chunks: []
  });
  assert.ok(text);
  assert.match(text, /cannot answer yes or no/i);
  assert.match(text, /USDC — angles/i);
  const ev = evaluateAnswerGuardrails(text, snapshot, { supplementals: [] });
  assert.equal(ev.ok, true, ev.issues.join(' | '));
});
