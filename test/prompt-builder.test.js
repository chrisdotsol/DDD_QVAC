import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages } from '../src/prompt-builder.js';

const snapshot = {
  ddd_percent: 1.4019,
  stablecoin_market_cap_usd: 318e9,
  us_m2_usd: 22686e9,
  one_in_x: 71,
  last_updated: '2026-01-01',
  issuers: [
    { name: 'Tether', symbol: 'USDT', market_cap_usd: 189e9, share_percent: 59, entity: 'T', backing_type: 'fiat' },
    { name: 'Sky', symbol: 'USDS', market_cap_usd: 7e9, share_percent: 2.4, entity: 'Sky', backing_type: 'hybrid' }
  ],
  chains: [{ name: 'Ethereum', stablecoin_supply_usd: 150e9, share_percent: 50, rank: 1 }]
};

test('buildMessages injects issuer pros/cons playbook for geo + two tickers', () => {
  const messages = buildMessages({
    query: 'im in bali can I use USDS or USDT',
    snapshot,
    chunks: [],
    systemPrompt: 'system',
    chatHistory: []
  });
  const user = messages.find((m) => m.role === 'user')?.content || '';
  assert.match(user, /SPECIAL PLAYBOOK/i);
  assert.match(user, /USDS/i);
  assert.match(user, /USDT/i);
  assert.match(user, /Pros-style/i);
});

test('buildMessages skips playbook for generic DDD question', () => {
  const messages = buildMessages({
    query: 'What is DDD?',
    snapshot,
    chunks: [],
    systemPrompt: 'system',
    chatHistory: []
  });
  const user = messages.find((m) => m.role === 'user')?.content || '';
  assert.equal(user.includes('SPECIAL PLAYBOOK'), false);
});
