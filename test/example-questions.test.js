import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLE_CATALOG_QUESTIONS } from '../src/example-questions.js';

test('EXAMPLE_CATALOG_QUESTIONS: large unique catalog', () => {
  assert.ok(EXAMPLE_CATALOG_QUESTIONS.length >= 120, `expected >=120, got ${EXAMPLE_CATALOG_QUESTIONS.length}`);
  const set = new Set(EXAMPLE_CATALOG_QUESTIONS);
  assert.equal(set.size, EXAMPLE_CATALOG_QUESTIONS.length);
  assert.ok(EXAMPLE_CATALOG_QUESTIONS.every((s) => s.length > 5 && s.length <= 6000));
});

test('EXAMPLE_CATALOG_QUESTIONS: includes suggested M2 vs stablecoins wording', () => {
  assert.ok(
    EXAMPLE_CATALOG_QUESTIONS.includes('How large are stablecoins compared with US M2 today?'),
    'suggested-query chip must stay in the example library'
  );
});
