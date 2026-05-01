import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAssistantMessageText, pickResolvedModel } from '../src/qvac-client.js';

test('pickResolvedModel: prefers configured id when listed', () => {
  const r = pickResolvedModel({ data: [{ id: 'ddd-r1-qwen' }, { id: 'other' }] }, 'ddd-r1-qwen', 'ddd-qwen');
  assert.equal(r.model, 'ddd-r1-qwen');
  assert.equal(r.note, null);
});

test('pickResolvedModel: still resolves legacy ddd-qwen when listed', () => {
  const r = pickResolvedModel({ data: [{ id: 'ddd-qwen' }, { id: 'other' }] }, 'ddd-qwen', 'ddd-llama');
  assert.equal(r.model, 'ddd-qwen');
  assert.equal(r.note, null);
});

test('pickResolvedModel: falls back to secondary then known Ollama ids', () => {
  const r = pickResolvedModel({ data: [{ id: 'llama3.2:latest' }] }, 'ddd-r1-qwen', 'ddd-qwen');
  assert.equal(r.model, 'llama3.2:latest');
  assert.ok(r.note);
});

test('pickResolvedModel: uses first listed when no known match', () => {
  const r = pickResolvedModel({ data: [{ id: 'custom-model' }] }, 'ddd-r1-qwen', 'ddd-qwen');
  assert.equal(r.model, 'custom-model');
});

test('extractAssistantMessageText: string content', () => {
  assert.equal(
    extractAssistantMessageText({
      choices: [{ message: { content: 'hello' } }]
    }),
    'hello'
  );
});

test('extractAssistantMessageText: array of text parts', () => {
  assert.equal(
    extractAssistantMessageText({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: 'a' },
              { text: 'b' },
              'c'
            ]
          }
        }
      ]
    }),
    'abc'
  );
});

test('extractAssistantMessageText: refusal when content null', () => {
  assert.equal(
    extractAssistantMessageText({
      choices: [{ message: { content: null, refusal: 'no' } }]
    }),
    'no'
  );
});
