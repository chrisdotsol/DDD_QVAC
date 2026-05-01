import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCasualChatResponse,
  buildIssuerVersusFromQueryAnswer,
  buildMisunderstoodAnswer,
  compactAssistantForHistory,
  hasParsedAnswerStructure,
  innoculateVerbatimModelLinesAgainstSectionParsing,
  isCasualChatQuery,
  isSchemaHeaderOnlyEcho,
  normalizeModelFourSectionAnswer,
  normalizedAnswerIsSchemaShell,
  parseFourSectionAnswer,
  polishFourSectionBody,
  sanitizeLocalModelReply,
  parseVersusPairFromQuery,
  REPHRASE_OR_DDD_HINT,
  stripDisplayInnoculation,
  truncateToFirstAnswerBlock
} from '../src/conversation-handles.js';
import { evaluateAnswerGuardrails } from '../src/answer-guardrails.js';

test('isCasualChatQuery: recognises common greetings', () => {
  assert.equal(isCasualChatQuery('hi'), true);
  assert.equal(isCasualChatQuery('Hello!'), true);
  assert.equal(isCasualChatQuery('hi how are you'), true);
  assert.equal(isCasualChatQuery('hey, how are you doing today?'), true);
  assert.equal(isCasualChatQuery('what is up'), true);
  assert.equal(isCasualChatQuery('  hi there  '), true);
  assert.equal(isCasualChatQuery('hey everyone'), true);
  assert.equal(isCasualChatQuery('hey there'), true);
  assert.equal(isCasualChatQuery('hey how are you'), true);
  assert.equal(isCasualChatQuery('How large are stablecoins?'), false);
  assert.equal(isCasualChatQuery('hi can you compare solana and ethereum'), false);
  assert.equal(isCasualChatQuery('got it'), true);
  assert.equal(isCasualChatQuery('Sounds good!'), true);
  assert.equal(isCasualChatQuery('sure'), true);
});

test('compactAssistantForHistory: prefers Answer section', () => {
  const full = ['Answer', 'Alpha beta.', '', 'Data Used', 'x', '', 'Sources Used', 'y', '', 'Missing Data', 'z'].join('\n');
  assert.equal(compactAssistantForHistory(full, 200), 'Alpha beta.');
  assert.ok(compactAssistantForHistory(full, 4).endsWith('…'));
});

test('compactAssistantForHistory: never stores header-only model junk', () => {
  const junk = ['Answer  ', 'Data Used  ', 'Sources Used  ', 'Missing Data'].join('\n');
  assert.match(compactAssistantForHistory(junk, 900), /omitted|no substantive/i);
  assert.ok(!compactAssistantForHistory(junk, 900).includes('Data Used'));
});

test('truncateToFirstAnswerBlock: drops repeated Answer blocks', () => {
  const bloated = [
    'Answer',
    'First body.',
    '',
    'Data Used',
    'x',
    '',
    'Sources Used',
    'y',
    '',
    'Missing Data',
    'z',
    '',
    'Answer',
    'Second body should be removed.',
    '',
    'Data Used',
    'bad'
  ].join('\n');
  const cut = truncateToFirstAnswerBlock(bloated);
  assert.ok(!cut.includes('Second body'));
  assert.ok(cut.includes('First body'));
});

test('truncateToFirstAnswerBlock: drops second block when header is Answer: …', () => {
  const bloated = [
    'Answer: First paragraph only.',
    '',
    'Data Used',
    'x',
    '',
    'Sources Used',
    'y',
    '',
    'Missing Data',
    'z',
    '',
    'Answer: This repeat must be cut.'
  ].join('\n');
  const cut = truncateToFirstAnswerBlock(bloated);
  assert.ok(!cut.includes('This repeat must be cut'));
  assert.ok(cut.includes('First paragraph'));
});

test('polishFourSectionBody: strips echoed headers and UI subtitle from Answer body', () => {
  const bloated = ['Answer', '', 'Plain-language reply', '', 'Stablecoins are aggregated in the numerator.'].join('\n');
  const cleaned = polishFourSectionBody('Answer', bloated);
  assert.ok(cleaned.includes('Stablecoins'));
  assert.ok(!/^answer$/im.test(cleaned.split('\n')[0]));
  assert.ok(!cleaned.toLowerCase().includes('plain-language'));
});

test('polishFourSectionBody: strips bare Data Used label at start of Data Used body', () => {
  const raw = ['Data Used', '', '- snapshot fields'].join('\n');
  assert.equal(polishFourSectionBody('Data Used', raw), '- snapshot fields');
});

test('polishFourSectionBody: strips markdown-wrapped Answer title lines', () => {
  assert.equal(polishFourSectionBody('Answer', ['## Answer', '', 'Body.'].join('\n')), 'Body.');
  assert.equal(polishFourSectionBody('Answer', ['**Answer**', '', 'Body.'].join('\n')), 'Body.');
  assert.equal(polishFourSectionBody('Answer', ['__Answer__', 'Body.'].join('\n')), 'Body.');
});

test('polishFourSectionBody: strips ZWSP-prefixed Answer echo', () => {
  const raw = `\u200bAnswer\n\nReal content.`;
  assert.ok(polishFourSectionBody('Answer', raw).startsWith('Real content'));
});

test('parseFourSectionAnswer: splits four sections', () => {
  const text = [
    'Answer',
    'Line A',
    '',
    'Data Used',
    'Line B',
    '',
    'Sources Used',
    'Line C',
    '',
    'Missing Data',
    'Line D'
  ].join('\n');
  const p = parseFourSectionAnswer(text);
  assert.equal(p.Answer.join('\n').trim(), 'Line A');
  assert.equal(p['Data Used'].join('\n').trim(), 'Line B');
  assert.ok(hasParsedAnswerStructure(p));
});

test('parseFourSectionAnswer: captures Answer: on same line and markdown headers', () => {
  const text = [
    'Answer: Solana share is lower than Ethereum in this snapshot.',
    '',
    '## Data Used',
    'chains[] from snapshot.',
    '',
    '**Sources Used**',
    'knowledge/x.md',
    '',
    'Missing Data',
    'None.'
  ].join('\n');
  const p = parseFourSectionAnswer(text);
  assert.ok(p.Answer.join(' ').includes('Solana'));
  assert.ok(p['Data Used'].join('\n').includes('chains'));
  assert.ok(hasParsedAnswerStructure(p));
});

test('parseFourSectionAnswer: Summary and Sources aliases map to Answer and Sources Used', () => {
  const text = [
    '## Summary',
    'USDS and FDUSD both appear in the issuer table.',
    '',
    'Data Used',
    'snapshot.issuers',
    '',
    'Sources',
    '- knowledge/x.md: X',
    '',
    'Missing Data',
    'None.'
  ].join('\n');
  const p = parseFourSectionAnswer(text);
  assert.ok(p.Answer.join('\n').includes('USDS'));
  assert.ok(p['Sources Used'].join('\n').includes('knowledge'));
  assert.ok(hasParsedAnswerStructure(p));
});

test('buildCasualChatResponse: valid four-part shape', () => {
  const text = buildCasualChatResponse({
    chunks: [{ source_file: 'knowledge/a.md', title: 'T' }]
  });
  assert.match(text, /^Answer\n/m);
  assert.match(text, /^Missing Data\n/m);
});

test('buildCasualChatResponse: threads prior summary when provided', () => {
  const text = buildCasualChatResponse({
    chunks: [],
    priorAssistantSummary: 'US M2 was about two trillion in the prior reply text for testing.'
  });
  assert.match(text, /last topic/i);
  assert.match(text, /US M2/i);
});

const snapshotMini = {
  ddd_percent: 1.5,
  stablecoin_market_cap_usd: 300e9,
  us_m2_usd: 20e12,
  one_in_x: 66,
  last_updated: '2026-01-01',
  issuers: [{ name: 'Tether', symbol: 'USDT', market_cap_usd: 100e9, share_percent: 50 }],
  chains: [{ name: 'Ethereum', stablecoin_supply_usd: 150e9, share_percent: 50, rank: 1 }]
};

test('sanitizeLocalModelReply: drops echoed UI lines and keeps inner four-part reply', () => {
  const messy = [
    'Answer:Answer',
    'Plain-language reply',
    '',
    'Answer',
    'Real prose starts here.',
    '',
    'Data Used',
    '- snapshot fields',
    '',
    'Sources Used',
    '- knowledge/a.md',
    '',
    'Missing Data',
    'None'
  ].join('\n');
  const clean = sanitizeLocalModelReply(messy);
  assert.ok(clean.includes('Real prose starts'));
  assert.equal(clean.includes('Plain-language reply'), false);
  assert.equal(clean.includes('Answer:Answer'), false);
  const p = parseFourSectionAnswer(clean);
  assert.ok(hasParsedAnswerStructure(p));
  assert.ok(p.Answer.join('\n').includes('Real prose'));
});

test('normalizeModelFourSectionAnswer: wraps plain model prose', () => {
  const plain = 'USDS and FDUSD rows: market caps from the JSON you loaded.';
  const wrapped = normalizeModelFourSectionAnswer(plain, {
    snapshot: snapshotMini,
    chunks: [{ source_file: 'knowledge/a.md', title: 'T' }]
  });
  assert.match(wrapped, /^Answer\n/m);
  assert.match(wrapped, /^Missing Data\n/m);
  assert.ok(wrapped.includes(plain));
  assert.ok(hasParsedAnswerStructure(parseFourSectionAnswer(wrapped)));
});

test('normalizeModelFourSectionAnswer: lines that look like headers stay in Answer', () => {
  const plain = ['Data Used', '', 'USDS vs FDUSD: both rows are in snapshot.issuers.', 'Missing Data', 'none for this demo'].join('\n');
  const wrapped = normalizeModelFourSectionAnswer(plain, { snapshot: snapshotMini, chunks: [] });
  const p = parseFourSectionAnswer(wrapped);
  const answerText = p.Answer.join('\n');
  assert.ok(answerText.includes('USDS vs FDUSD'), answerText);
  assert.ok(answerText.includes('\u200b'), 'expected ZWSP prefix on shadowed header lines');
  assert.equal(stripDisplayInnoculation(answerText).includes('\u200b'), false);
  assert.ok(!p['Data Used'].join('\n').includes('USDS vs FDUSD'), 'comparison must not land under Data Used');
});

test('innoculateVerbatimModelLinesAgainstSectionParsing: idempotent for normal prose', () => {
  const s = 'Just numbers $1,234 and 5%.';
  assert.equal(innoculateVerbatimModelLinesAgainstSectionParsing(s), s);
});

test('isSchemaHeaderOnlyEcho: detects empty section-title outline', () => {
  assert.equal(isSchemaHeaderOnlyEcho('Answer\nData Used\nSources Used\nMissing Data'), true);
  assert.equal(isSchemaHeaderOnlyEcho('## Summary\n\n**Data Used**'), true);
  assert.equal(isSchemaHeaderOnlyEcho('Answer: Summary'), true);
  assert.equal(isSchemaHeaderOnlyEcho('Answer\nUSDS is larger than FDUSD in this JSON.'), false);
});

test('parseVersusPairFromQuery: tickers need not exist in snapshot', () => {
  assert.deepEqual(parseVersusPairFromQuery('USDS vs FDUSD: market cap?'), ['USDS', 'FDUSD']);
  assert.deepEqual(parseVersusPairFromQuery('compare USDC versus USDT'), ['USDC', 'USDT']);
  assert.equal(parseVersusPairFromQuery('no comparison here'), null);
});

test('normalizedAnswerIsSchemaShell: wrapped echo body', () => {
  const raw = 'Answer\nData Used\nSources Used';
  const wrapped = normalizeModelFourSectionAnswer(raw, { snapshot: snapshotMini, chunks: [] });
  assert.equal(normalizedAnswerIsSchemaShell(wrapped), true);
});

test('buildIssuerVersusFromQueryAnswer: dual issuer from snapshot', () => {
  const snap = {
    ddd_percent: 1.4,
    stablecoin_market_cap_usd: 300e9,
    us_m2_usd: 20e12,
    one_in_x: 70,
    last_updated: '2026-01-01',
    issuers: [
      { name: 'A', symbol: 'USDS', market_cap_usd: 5e9, share_percent: 2 },
      { name: 'B', symbol: 'FDUSD', market_cap_usd: 3e9, share_percent: 1 }
    ],
    chains: []
  };
  const text = buildIssuerVersusFromQueryAnswer('USDS vs FDUSD: caps?', snap, []);
  assert.ok(text);
  assert.match(text, /USDS/i);
  assert.match(text, /FDUSD/i);
  const ev = evaluateAnswerGuardrails(text, snap, { supplementals: [] });
  assert.equal(ev.ok, true, ev.issues.join(' | '));
});

test('buildIssuerVersusFromQueryAnswer: missing ticker still matches question', () => {
  const snap = {
    ddd_percent: 1.4,
    stablecoin_market_cap_usd: 300e9,
    us_m2_usd: 20e12,
    one_in_x: 70,
    last_updated: '2026-01-01',
    issuers: [{ name: 'Sky Dollar', symbol: 'USDS', market_cap_usd: 5e9, share_percent: 2 }],
    chains: []
  };
  const text = buildIssuerVersusFromQueryAnswer('USDS vs FDUSD: market cap and share in this JSON?', snap, []);
  assert.ok(text);
  assert.match(text, /USDS/i);
  assert.match(text, /FDUSD not found/i);
  const ev = evaluateAnswerGuardrails(text, snap, { supplementals: [] });
  assert.equal(ev.ok, true, ev.issues.join(' | '));
});

test('buildMisunderstoodAnswer: includes rephrase hint and snapshot orientation', () => {
  const text = buildMisunderstoodAnswer({
    snapshot: snapshotMini,
    chunks: [],
    lead: 'No model text.'
  });
  assert.ok(text.includes(REPHRASE_OR_DDD_HINT));
  assert.match(text, /DDD is/i);
  assert.match(text, /^Answer\n/m);
  assert.match(text, /^Missing Data\n/m);
});
