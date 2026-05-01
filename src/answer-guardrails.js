import {
  parseFourSectionAnswer,
  stripDisplayInnoculation,
  stripUiScaffoldLines
} from './conversation-handles.js';
import { checkVoiceRules, missingSnapshotFields, precomputedFacts } from './prompt-builder.js';

export const REQUIRED_ANSWER_SECTIONS = ['Answer', 'Data Used', 'Sources Used', 'Missing Data'];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Section title at line start: `Answer`, `Answer:`, `## **Answer**`, etc. */
function lineHasSectionHeader(text, section) {
  const esc = escapeRegex(section);
  const pattern = new RegExp(`^[\\u200b\\u200c\\u200d\\u2060\\s]*#{0,3}\\s*\\*{0,2}${esc}\\*{0,2}\\b:?`, 'im');
  return pattern.test(text);
}

function normalizeAnswerTextForSchema(answer) {
  let t = String(answer || '').trim().replace(/^\ufeff/, '');
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  t = stripUiScaffoldLines(t);
  t = stripDisplayInnoculation(t);
  return t.trim();
}

/** True when parseFourSectionAnswer extracted non-empty bodies for all four sections (same contract as the UI). */
function hasCompleteParsedSections(text) {
  const parsed = parseFourSectionAnswer(text);
  return REQUIRED_ANSWER_SECTIONS.every((key) => (parsed[key] || []).join('\n').trim().length > 0);
}

export function validateAnswerSchema(answer) {
  const text = normalizeAnswerTextForSchema(answer);
  const missingByLine = REQUIRED_ANSWER_SECTIONS.filter((section) => !lineHasSectionHeader(text, section));
  const parsed = parseFourSectionAnswer(text);
  const missingByParse = REQUIRED_ANSWER_SECTIONS.filter((key) => (parsed[key] || []).join('\n').trim().length === 0);
  if (missingByLine.length === 0 && missingByParse.length === 0) {
    return { ok: true, missingSections: [] };
  }
  if (hasCompleteParsedSections(text)) {
    return { ok: true, missingSections: [] };
  }
  const union = [...new Set([...missingByLine, ...missingByParse])];
  return { ok: false, missingSections: union };
}

function normalizeNumber(value) {
  return String(value)
    .replace(/[$,%]/g, '')
    .replace(/,/g, '')
    .trim()
    .replace(/\.0+$/, '');
}

function collectNumbersFromText(text) {
  return [...String(text || '').matchAll(/(^|[^A-Za-z])(\$?\d+(?:,\d{3})*(?:\.\d+)?%?)(?![A-Za-z])/g)]
    .map((match) => normalizeNumber(match[2]))
    .filter(Boolean);
}

function addNumericValue(allowed, value) {
  if (value === null || value === undefined) return;
  const num = Number(value);
  if (!Number.isFinite(num)) return;
  allowed.add(normalizeNumber(num));
  allowed.add(normalizeNumber(num.toFixed(2)));
  allowed.add(normalizeNumber(num.toFixed(4)));
  allowed.add(normalizeNumber(Math.round(num)));
}

function addYearFromIso(allowed, value) {
  if (typeof value !== 'string') return;
  const match = value.match(/\b(19|20)\d{2}\b/);
  if (match) allowed.add(match[0]);
}

function walkNestedNumbers(allowed, value, depth) {
  if (value === null || value === undefined || depth > 10) return;
  if (typeof value === 'number') addNumericValue(allowed, value);
  else if (typeof value === 'string') addYearFromIso(allowed, value);
  else if (Array.isArray(value)) for (const x of value) walkNestedNumbers(allowed, x, depth + 1);
  else if (typeof value === 'object') for (const v of Object.values(value)) walkNestedNumbers(allowed, v, depth + 1);
}

function mergeSnapshotIntoAllowed(allowed, snapshot, depth = 0) {
  if (!snapshot || typeof snapshot !== 'object' || depth > 8) return;

  addYearFromIso(allowed, snapshot.last_updated);
  addYearFromIso(allowed, snapshot.generated_at);

  addNumericValue(allowed, snapshot.ddd_percent);
  addNumericValue(allowed, snapshot.stablecoin_market_cap_usd);
  addNumericValue(allowed, snapshot.us_m2_usd);
  addNumericValue(allowed, snapshot.one_in_x);

  for (const issuer of snapshot.issuers || []) {
    addYearFromIso(allowed, issuer.last_updated);
    addNumericValue(allowed, issuer.market_cap_usd);
    addNumericValue(allowed, issuer.share_percent);
  }
  for (const chain of snapshot.chains || []) {
    addNumericValue(allowed, chain.stablecoin_supply_usd);
    addNumericValue(allowed, chain.share_percent);
    addNumericValue(allowed, chain.rank);
  }

  if (snapshot.ddd_percent !== null && snapshot.ddd_percent !== undefined) {
    const distance = Number((2 - Number(snapshot.ddd_percent)).toFixed(4));
    addNumericValue(allowed, distance);
  }

  if (snapshot.cached_values && typeof snapshot.cached_values === 'object') {
    walkNestedNumbers(allowed, snapshot.cached_values, 0);
  }
}

export function collectAllowedNumbers(snapshot, supplementals = []) {
  const facts = precomputedFacts(snapshot);
  const allowed = new Set(['0', '1', '2', '3', '4', '5', '100']);

  mergeSnapshotIntoAllowed(allowed, snapshot, 0);
  for (const extra of supplementals || []) {
    mergeSnapshotIntoAllowed(allowed, extra, 0);
  }

  for (const value of Object.values(facts)) {
    if (typeof value !== 'string') continue;
    for (const number of collectNumbersFromText(value)) allowed.add(number);
  }

  return allowed;
}

export function findUnexpectedNumbers(answer, snapshot, supplementals = []) {
  const allowed = collectAllowedNumbers(snapshot, supplementals);
  return [...new Set(collectNumbersFromText(answer))]
    .filter((number) => !allowed.has(number));
}

/**
 * Verification helper: schema and voice issues are useful for tests/offline checks.
 * The browser only uses this to replace replies when the model returns no usable text.
 */
export function evaluateAnswerGuardrails(answer, snapshot, { supplementals = [] } = {}) {
  const text = String(answer || '').trim();
  const schema = validateAnswerSchema(text);
  const unexpectedNumbers = findUnexpectedNumbers(text, snapshot, supplementals);
  const voiceViolations = checkVoiceRules(text);

  const issues = [];
  if (!schema.ok) {
    issues.push(`Answer format: add sections ${schema.missingSections.join(', ')}.`);
  }
  if (voiceViolations.length) {
    issues.push(`Voice guardrail: disallowed wording (${voiceViolations.join(', ')}).`);
  }

  let numericHint = '';
  if (unexpectedNumbers.length) {
    const sample = unexpectedNumbers.slice(0, 4).join(', ');
    numericHint = `Some numeric tokens are not exact snapshot copies (${sample}${unexpectedNumbers.length > 4 ? ', …' : ''}). Compare with the Current Snapshot panel if something looks off.`;
  }

  return {
    ok: issues.length === 0,
    schema,
    unexpectedNumbers,
    voiceViolations,
    issues,
    numericHint
  };
}

export function buildGuardrailFallbackAnswer({ snapshot, chunks, evaluation }) {
  const facts = precomputedFacts(snapshot);
  const missing = missingSnapshotFields(snapshot);
  const sourceLines = (chunks || []).length
    ? chunks.map((c) => `- ${c.source_file}: ${c.title}`)
    : ['- No knowledge chunks were retrieved; methodology and glossary files still apply as local references when indexed.'];

  const reason = (evaluation?.issues || []).join(' ');

  return [
    'Answer',
    [
      'The model reply did not pass local checks, so this turn uses only the frozen snapshot and retrieved note titles (no free-form model text).',
      `${facts.benchmark_definition} Here: DDD ${facts.ddd_reading} (about ${facts.one_in_x}). Stablecoin market cap ${facts.stablecoin_market_cap}; US M2 ${facts.us_m2}. Largest issuer: ${facts.largest_issuer}. Largest chain: ${facts.largest_chain}. Solana: ${facts.solana_chain_share}. Gap to 2% of M2: ${facts.distance_from_2_percent_percentage_points}.`
    ].join('\n\n'),
    '',
    'Data Used',
    'Local file `data/ddd-current.snapshot.json` (and on-chain reference snapshot when present), plus retrieved knowledge chunk metadata listed under Sources Used.',
    '',
    'Sources Used',
    ...sourceLines,
    '',
    'Missing Data',
    [
      missing.length ? `Snapshot fields not populated: ${missing.join(', ')}.` : 'No required snapshot fields are marked missing.',
      reason ? `Checks: ${reason}` : '',
      'Tip: suggested questions use local catalog answers so you can avoid this path—try again without `?shortcuts=0`, or ask a narrower factual question.'
    ].filter(Boolean).join(' ')
  ].join('\n');
}
