import { normalizeChipQuery } from './chip-answers.js';
import {
  formatCurrency,
  formatPercent,
  missingSnapshotFields,
  precomputedFacts,
  snapshotSummary
} from './prompt-builder.js';

function structured(answerBody, dataUsed, sourcesUsed, missingBody) {
  return [
    'Answer',
    answerBody,
    '',
    'Data Used',
    dataUsed,
    '',
    'Sources Used',
    sourcesUsed,
    '',
    'Missing Data',
    missingBody
  ].join('\n');
}

function sourcesLines(chunks) {
  if (!chunks?.length) {
    return '- No knowledge chunks matched strongly; the glossary and methodology files in the index still define terms.';
  }
  return chunks.map((c) => `- ${c.source_file}: ${c.title}`).join('\n');
}

function looksLikeDefinitionQuery(q) {
  return (
    /\b(what is|what's|whats|define|explain|tell me about|who is|describe|what does (that|this|it) mean)\b/i.test(q) ||
    /\bwhat does\b[\s\S]{0,120}\bmean\b/i.test(q)
  );
}

function looksLikeLargestIssuerQuery(q) {
  return (
    /\b(largest|biggest|top)\s+(issuer|issuers)\b/.test(q) ||
    /\bwho\s+is\s+the\s+largest\s+issuer\b/.test(q) ||
    /\bwhich\s+issuer\s+(has\s+the\s+)?(the\s+)?(largest|biggest|highest|most)\b/.test(q) ||
    /\bissuer\s+with\s+(the\s+)?(largest|biggest)\b/.test(q) ||
    /\bwhat\s+issuer\s+is\s+(the\s+)?(largest|biggest)\b/.test(q)
  );
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match issuer by ticker symbol (longest symbol first) or loose name token overlap. */
export function pickIssuerFromQuery(query, snapshot) {
  const q = normalizeChipQuery(query);
  const issuers = snapshot.issuers || [];
  const withSym = issuers.filter((i) => i.symbol).sort((a, b) => b.symbol.length - a.symbol.length);
  for (const i of withSym) {
    const sym = String(i.symbol).toLowerCase();
    if (new RegExp(`\\b${escapeRe(sym)}\\b`, 'i').test(q)) return i;
  }
  const tokens = q.split(' ').filter((t) => t.length > 3);
  for (const i of issuers) {
    const name = String(i.name || '').toLowerCase();
    if (!name) continue;
    if (tokens.some((t) => name.includes(t))) return i;
  }
  return null;
}

function buildIssuerAnswer(issuer, snapshot, chunks, { definitional = false } = {}) {
  const facts = precomputedFacts(snapshot);
  const miss = missingSnapshotFields(snapshot);
  const cap = formatCurrency(issuer.market_cap_usd);
  const sh = formatPercent(issuer.share_percent);
  const sym = issuer.symbol ? String(issuer.symbol).toUpperCase() : '';
  const entityPhrase = issuer.entity ? ` The snapshot’s entity field reads \`${issuer.entity}\`.` : '';
  const backingPhrase = issuer.backing_type
    ? ` This row only records backing as \`${issuer.backing_type}\`; reserve detail, redemption rules, and networks are outside the JSON.`
    : '';

  const body = definitional
    ? [
        `${sym || issuer.name} is the ticker this dataset uses for stablecoins grouped under ${issuer.name}.${entityPhrase} In the local stablecoin glossary, a stablecoin is a crypto asset designed to maintain a reference value—commonly one US dollar—for aggregate market-cap work; that is the sense in which “what it is” is defined here, not wallet addresses or trading advice.`,
        `For this frozen issuer row, tracked stablecoin market capitalisation is about ${cap}, with a headline share of about ${sh} of the issuer table in the same JSON.${backingPhrase}`,
        `${facts.benchmark_definition} The headline DDD reading in this snapshot is ${facts.ddd_reading}.`
      ].join('\n\n')
    : [
        `${issuer.name}${issuer.symbol ? ` (${issuer.symbol})` : ''} is an issuer row in this frozen snapshot.`,
        `Its tracked stablecoin market capitalisation is about ${cap}, with a headline share of about ${sh} of the issuer table in this JSON.`,
        `${facts.benchmark_definition} The headline DDD reading in the same snapshot is ${facts.ddd_reading}.`
      ].join('\n\n');

  const dataUsed = definitional
    ? `snapshot.issuers row for ${issuer.name}; stablecoin wording aligned with knowledge/stablecoin-glossary.md; precomputedFacts for headline DDD.`
    : `snapshot.issuers entry for ${issuer.name}; precomputedFacts for headline DDD context.`;

  return structured(
    body,
    dataUsed,
    sourcesLines(chunks),
    miss.length ? `Other snapshot gaps: ${miss.join(', ')}.` : 'No extra snapshot gaps flagged for this question.'
  );
}

function getIssuerBySymbol(snapshot, symbol) {
  return (snapshot.issuers || []).find((issuer) => String(issuer.symbol || '').toLowerCase() === String(symbol || '').toLowerCase()) || null;
}

/** Country / residency cues shared by choice + personal-suitability routing. */
function queryMentionsGeo(q) {
  const s = String(q || '');
  return (
    /\b(usa|u s a|u s|united states|america|canada|uk|u k|united kingdom|britain|france|germany|spain|italy|mexico|brazil|india|china|japan|australia|singapore|nigeria|south korea|korea|switzerland|sweden|norway|netherlands|belgium|ireland|portugal|poland|austria|uae|emirates|dubai|israel|turkey|argentina|chile|colombia|south africa|egypt|indonesia|bali|thailand|vietnam|philippines|new zealand|eu|europe|asia|latam|africa)\b/i.test(
      s
    ) ||
    /\b(country|countries|jurisdiction|where i live|resident|reside|based in|located in|living in|live in)\b/i.test(s) ||
    /\b(?:i am|i m|im)\s+in\s+[a-z]{3,}\b/i.test(s)
  );
}

function queryMentionsPersonalStablecoinFrame(q) {
  const s = String(q || '');
  return /\b(for me|for my|my situation|should i|should we|can i use|can we use|would it be|good for me|bad for me|right for me|wrong for me)\b/i.test(s);
}

/** Custody / device questions — not “which issuer should I use in my country.” */
function queryIsWalletCustodyPrimary(q) {
  const s = String(q || '');
  return /\b(ledgers?\b|ledger live|ledger nano|trezor|hardware wallets?\b|cold storage|cold wallets?\b|signing device|self[- ]custody|seed phrase|recovery phrase|wallet setup)\b/i.test(
    s
  );
}

function queryHasStablecoinEvaluativeLanguage(q) {
  const s = String(q || '');
  return /\b(good|bad|better|best|safe|safer|safest|unsafe|risk|risky|riskiest|should|worth|right|wrong|okay|ok|solution|suitable|avoid|trust|worried|worry|worrying|smart|stupid|useful|problem|recommend|legitimate)\b/i.test(s);
}

/** “Is USDC good for me in the USA?” — not the generic issuer row; needs direct framing + limits. */
function isStablecoinPersonalSuitabilityQuery(q) {
  const s = String(q || '');
  if (queryIsWalletCustodyPrimary(s)) return false;
  const mentionsUsdt = /\b(usdt|tether)\b/i.test(s);
  const mentionsUsdc = /\b(usdc|usd\s*coin)\b/i.test(s);
  if (!mentionsUsdt && !mentionsUsdc) return false;
  return queryHasStablecoinEvaluativeLanguage(s) && (queryMentionsGeo(s) || queryMentionsPersonalStablecoinFrame(s));
}

function isStablecoinChoiceQuery(q) {
  const mentionsUsdt = /\b(usdt|tether)\b/i.test(q);
  const mentionsUsdc = /\b(usdc|usd\s*coin)\b/i.test(q);
  const mentionsBoth = mentionsUsdt && mentionsUsdc;
  const asksComparison = /\b(should|which|choose|use|using|better|best|compare|comparison|versus|vs|pros|cons|advantages|disadvantages|tradeoffs|trade offs|upside|downside|differences|difference|help me decide|good idea|bad idea|worth it)\b/i.test(q);
  const mentionsStablecoinTopic = mentionsUsdt || mentionsUsdc || /\bstablecoins?\b/i.test(q);
  const mentionsGeo = queryMentionsGeo(q);

  if (!mentionsStablecoinTopic || !mentionsBoth) return false;
  // Only the hard-coded USDT↔USDC template; needs both tickers plus compare/geo cues (never geo + “use” alone).
  return asksComparison || mentionsGeo;
}

/** Symbols from snapshot.issuers mentioned in the normalized query (longest symbol matched first). */
function distinctMentionedIssuerSymbols(normalizedQ, snapshot) {
  const q = String(normalizedQ || '');
  const issuers = snapshot?.issuers || [];
  const withSym = issuers.filter((i) => i.symbol).sort((a, b) => String(b.symbol).length - String(a.symbol).length);
  const found = [];
  for (const i of withSym) {
    const sym = String(i.symbol);
    if (new RegExp(`\\b${escapeRe(sym)}\\b`, 'i').test(q)) found.push(sym.toUpperCase());
  }
  return [...new Set(found)];
}

/** Let QVAC handle arbitrary pairwise comparisons; presets only cover USDT+USDC. */
function shouldDeferStablecoinPresetsToModel(normalizedQ, snapshot) {
  const syms = distinctMentionedIssuerSymbols(normalizedQ, snapshot);
  if (syms.length < 2) return false;
  const set = new Set(syms);
  return !(set.size === 2 && set.has('USDT') && set.has('USDC'));
}

/**
 * Neutral snapshot-only answer for "USDS vs USDT" style questions so the model
 * does not substitute rank-1 / rank-2 issuers (often USDT and USDC) for the
 * tickers the user actually named.
 */
function isFactualTwoIssuerComparisonQuery(normalizedQ, snapshot) {
  const q = String(normalizedQ || '');
  const syms = distinctMentionedIssuerSymbols(q, snapshot);
  if (syms.length !== 2) return false;
  const a = getIssuerBySymbol(snapshot, syms[0]);
  const b = getIssuerBySymbol(snapshot, syms[1]);
  if (!a || !b) return false;
  if (!/\b(vs\.?|versus|compare|comparison|differences?|difference between)\b/i.test(q)) return false;
  if (queryMentionsGeo(q) && (queryHasStablecoinEvaluativeLanguage(q) || queryMentionsPersonalStablecoinFrame(q))) {
    return false;
  }
  return true;
}

function buildFactualIssuerPairAnswer(query, snapshot, chunks) {
  const normalizedQ = normalizeChipQuery(query).replace(/\bddi\b/g, 'ddd');
  const syms = distinctMentionedIssuerSymbols(normalizedQ, snapshot).sort((a, b) => a.localeCompare(b));
  const symA = syms[0];
  const symB = syms[1];
  const issuerA = getIssuerBySymbol(snapshot, symA);
  const issuerB = getIssuerBySymbol(snapshot, symB);
  const facts = precomputedFacts(snapshot);
  const miss = missingSnapshotFields(snapshot);

  const body = [
    `You asked for a side-by-side read of ${symA} and ${symB} from this frozen issuer table. The figures below are only market-cap and share in this JSON—not quality, safety, or suitability.`,
    `${symA} (${issuerA.name}):\n${issuerLine(issuerA)}`,
    `${symB} (${issuerB.name}):\n${issuerLine(issuerB)}`,
    `For scale in the same file: ${facts.benchmark_definition} Headline DDD is ${facts.ddd_reading} (${facts.one_in_x}); total stablecoin market cap in the numerator is ${facts.stablecoin_market_cap}.`,
    'This module does not rank which asset is “better,” predict peg stability, or give wallet or travel advice—only the two rows you named, plus headline DDD context.'
  ].join('\n\n');

  return structured(
    body,
    `Issuer rows ${symA} and ${symB} from snapshot.issuers; precomputedFacts for headline DDD.`,
    sourcesLines(chunks),
    miss.length ? `Other snapshot notes: ${miss.join(', ')}.` : 'No required headline fields flagged missing for this question.'
  );
}

function titleCasePlace(s) {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ');
}

function countryPhraseFromQuery(rawQuery) {
  const q = normalizeChipQuery(rawQuery);
  if (/\b(usa|united states|america|u s a|u s)\b/i.test(q)) return 'for someone in the USA';

  const placeWord = '([a-z]+(?:\\s+[a-z]+)?)';
  const imIn = q.match(new RegExp(`\\b(?:i am|i m|im|i'm)\\s+in\\s+${placeWord}\\b`, 'i'));
  if (imIn?.[1]) return `for someone in ${titleCasePlace(imIn[1])}`;

  const located = q.match(
    new RegExp(`\\b(?:live in|living in|based in|located in|resident of)\\s+${placeWord}\\b`, 'i')
  );
  if (located?.[1]) return `for someone in ${titleCasePlace(located[1])}`;

  const fromPlace = q.match(new RegExp(`\\bfrom\\s+${placeWord}\\b`, 'i'));
  if (fromPlace?.[1]) return `for someone in ${titleCasePlace(fromPlace[1])}`;

  return 'for your location';
}

function issuerLine(issuer) {
  if (!issuer) return 'not available in the current local dataset';
  const cap = formatCurrency(issuer.market_cap_usd);
  const sh = formatPercent(issuer.share_percent);
  const entity = issuer.entity ? `; entity listed as ${issuer.entity}` : '';
  const backing = issuer.backing_type ? `; backing type listed as ${issuer.backing_type}` : '';
  return `${issuer.name}${issuer.symbol ? ` (${issuer.symbol})` : ''}: ${cap}, ${sh} issuer share${entity}${backing}.`;
}

function buildStablecoinChoiceAnswer(query, snapshot, chunks) {
  const usdt = getIssuerBySymbol(snapshot, 'USDT');
  const usdc = getIssuerBySymbol(snapshot, 'USDC');
  const where = countryPhraseFromQuery(query);
  const miss = missingSnapshotFields(snapshot);
  const facts = precomputedFacts(snapshot);

  const usdtBacking = usdt?.backing_type || 'not listed in this issuer row';
  const usdcBacking = usdc?.backing_type || 'not listed in this issuer row';
  const usdtEntity = usdt?.entity || 'not listed in this issuer row';
  const usdcEntity = usdc?.entity || 'not listed in this issuer row';

  const body = [
    `I still cannot pick a winner for you or say what you “should” use ${where}. I can give a neutral pros-and-cons style comparison using only what this frozen JSON shows, plus a short list of what you must verify outside this demo.`,
    `Snapshot rows (same numbers no matter the country):\n- USDT: ${issuerLine(usdt)}\n- USDC: ${issuerLine(usdc)}`,
    `Headline market context in this file: ${facts.benchmark_definition} DDD here reads ${facts.ddd_reading} (${facts.one_in_x}).`,
    'USDT — common angles people weigh (educational framing only; not personal financial or legal guidance):\n- Pros-style notes tied to this table: larger headline market cap and issuer share in this snapshot, which some readers treat as a liquidity and ecosystem-size signal in aggregate.\n- Cons-style notes tied to this table: counterparty and disclosure questions are not scored here; backing is only described as `' +
      String(usdtBacking) +
      '` and the entity field reads `' +
      String(usdtEntity) +
      '`. Anything about reserves, attestation quality, or redemption friction is outside this JSON.',
    'USDC — common angles people weigh (educational framing only; not personal financial or legal guidance):\n- Pros-style notes tied to this table: still very large headline market cap and share; entity field reads `' +
      String(usdcEntity) +
      '` with backing listed as `' +
      String(usdcBacking) +
      '`.\n- Cons-style notes tied to this table: same limitation—this row does not prove bank-rail access, regulatory treatment, or wallet availability in your country.',
    `Country-specific pros and cons: this module does not know your bank, exchange, employer policy, tax residency, or local rules ${where}. Treat “pros” and “cons” about access, taxes, sanctions, or consumer protection as unknown here until you confirm with licensed professionals and primary sources.`,
    'Practical next checks (outside this UI): issuer transparency pages and attestations, exchange listing and off-ramp support for your country, on-chain transfer fees on the network you will actually use, insurance or bankruptcy policy of custodians you rely on, and whether your use case needs regulated bank money versus crypto-native rails.'
  ].join('\n\n');

  return structured(
    body,
    'snapshot.issuers rows for USDT and USDC (market_cap_usd, share_percent, entity, backing_type); precomputedFacts for headline DDD context only.',
    sourcesLines(chunks),
    [
      miss.length ? `Snapshot gaps: ${miss.join(', ')}.` : 'No required headline snapshot fields are flagged missing.',
      'Missing for this question: country-specific law, tax treatment, exchange availability, fees, wallet support, sanctions restrictions, live liquidity, live redemption status, and personal circumstances.'
    ].join(' ')
  );
}

function buildStablecoinPersonalSuitabilityAnswer(query, snapshot, chunks) {
  const q = normalizeChipQuery(query);
  const mentionsUsdt = /\b(usdt|tether)\b/i.test(q);
  const mentionsUsdc = /\b(usdc|usd\s*coin)\b/i.test(q);
  if (mentionsUsdt && mentionsUsdc) {
    return buildStablecoinChoiceAnswer(query, snapshot, chunks);
  }

  const issuer = mentionsUsdc ? getIssuerBySymbol(snapshot, 'USDC') : getIssuerBySymbol(snapshot, 'USDT');
  if (!issuer) return null;

  const sym = String(issuer.symbol || '').toUpperCase();
  const where = countryPhraseFromQuery(query);
  const miss = missingSnapshotFields(snapshot);
  const facts = precomputedFacts(snapshot);
  const backing = issuer.backing_type || 'not listed in this issuer row';
  const entity = issuer.entity || 'not listed in this issuer row';
  const otherSym = sym === 'USDC' ? 'USDT' : 'USDC';
  const other = getIssuerBySymbol(snapshot, otherSym);

  const body = [
    `You are asking whether ${issuer.name}${issuer.symbol ? ` (${issuer.symbol})` : ''} is a good personal fit ${where}. I cannot answer yes or no for you: this UI only has a frozen issuer row plus headline DDD context, not your tax status, bank, employer rules, or current law.`,
    `Snapshot row for ${sym} in this JSON:\n- ${issuerLine(issuer)}`,
    `Headline market context in the same file: ${facts.benchmark_definition} DDD here reads ${facts.ddd_reading} (${facts.one_in_x}).`,
    `${sym} — angles people often weigh when they ask this kind of question (educational framing only; not personal financial or legal guidance):\n- Pros-style notes tied to this table: headline market cap and issuer share in this snapshot are ${formatCurrency(issuer.market_cap_usd)} and ${formatPercent(issuer.share_percent)}; entity reads \`${entity}\` with backing listed as \`${backing}\`. Some readers treat size and issuer identity as rough liquidity and ecosystem-depth signals in aggregate.\n- Cons-style notes tied to this table: the row does not score reserve transparency, redemption friction, bankruptcy remoteness, or whether on-ramps you personally use list this asset. Anything about consumer protection, taxes, or sanctions is outside this JSON.`,
    other
      ? `If your real question is “${sym} versus ${otherSym},” ask that comparison explicitly—this answer stayed on ${sym} only. For a side-by-side checklist, the other row here is: ${issuerLine(other)}.`
      : `If you need a second issuer for comparison, name both tickers in one question.`,
    `Country-specific fit: this module does not know exchange listings, ACH or card rails, state rules, or broker policy ${where}. Treat access, taxes, and consumer protection as unknown here until you confirm with licensed professionals and primary sources.`,
    'Practical next checks (outside this UI): issuer transparency pages and attestations, whether your bank and broker support deposits or withdrawals, on-chain transfer fees on the network you will actually use, custodian terms if you do not self-custody, and whether you need bank-regulated money versus crypto-native rails.'
  ].join('\n\n');

  return structured(
    body,
    `snapshot.issuers row for ${sym} (market_cap_usd, share_percent, entity, backing_type); precomputedFacts for headline DDD context only.${other ? ` Peer row cited for ${otherSym}.` : ''}`,
    sourcesLines(chunks),
    [
      miss.length ? `Snapshot gaps: ${miss.join(', ')}.` : 'No required headline snapshot fields are flagged missing.',
      'Missing for this question: personalized suitability, country-specific law, tax treatment, exchange availability, live fees, live redemption status, and your circumstances.'
    ].join(' ')
  );
}

function buildM2Answer(snapshot, chunks) {
  const facts = precomputedFacts(snapshot);
  const body = [
    'US M2 is the broad US money-supply aggregate used as the denominator in DDD.',
    `In this snapshot the M2 line used for the ratio is ${facts.us_m2}. Total stablecoin market capitalisation in the numerator is ${facts.stablecoin_market_cap}, giving DDD ${facts.ddd_reading} (about ${facts.one_in_x}).`,
    'M2 is a macro statistic, not an on-chain balance; the local module does not fetch live FRED data in offline mode.'
  ].join('\n\n');
  return structured(
    body,
    'precomputedFacts.us_m2 and related headline fields; glossary chunk if retrieved.',
    sourcesLines(chunks),
    missingSnapshotFields(snapshot).length
      ? `Snapshot notes: ${missingSnapshotFields(snapshot).join(', ')}.`
      : 'No required headline fields are flagged missing.'
  );
}

function buildLargestIssuerAnswer(snapshot, chunks) {
  const facts = precomputedFacts(snapshot);
  const summary = snapshotSummary(snapshot);
  const li = summary.largest_issuer;
  const miss = missingSnapshotFields(snapshot);
  if (!li) {
    return structured(
      'This snapshot does not list a largest issuer row in the form this demo expects.',
      'snapshot.issuers missing or empty.',
      sourcesLines(chunks),
      miss.length ? `Snapshot gaps: ${miss.join(', ')}.` : 'Issuer table empty.'
    );
  }
  const cap = formatCurrency(li.market_cap_usd);
  const sh = formatPercent(li.share_percent);
  const body = [
    `In this frozen dataset, the issuer row ranked first in the table this UI uses is ${li.name}${li.symbol ? ` (${li.symbol})` : ''}.`,
    `That row shows tracked stablecoin market capitalisation about ${cap} and about ${sh} of the issuer table in this JSON.`,
    `${facts.benchmark_definition} Headline DDD in the same snapshot is ${facts.ddd_reading} (about ${facts.one_in_x}).`
  ].join('\n\n');
  return structured(
    body,
    'snapshot.issuers[0] as largest issuer row; precomputedFacts for DDD headline.',
    sourcesLines(chunks),
    miss.length ? `Other snapshot notes: ${miss.join(', ')}.` : 'No required headline fields flagged missing for this question.'
  );
}

function buildDddAnswer(snapshot, chunks) {
  const facts = precomputedFacts(snapshot);
  const body = [
    'DDD is short for Digital Dollar Dominance: it is the label this module uses for stablecoin market cap divided by US M2, so you can read “how big stablecoins are” next to a broad money-supply yardstick.',
    `${facts.benchmark_definition}`,
    `In this frozen dataset the reading is ${facts.ddd_reading}, which is the same ratio as about ${facts.one_in_x} when expressed in plain language.`,
    `Numerator (stablecoin market cap): ${facts.stablecoin_market_cap}. Denominator (US M2): ${facts.us_m2}.`
  ].join('\n\n');
  return structured(
    body,
    'precomputedFacts and benchmark definition string.',
    sourcesLines(chunks),
    missingSnapshotFields(snapshot).length
      ? `Snapshot gaps: ${missingSnapshotFields(snapshot).join(', ')}.`
      : 'No required headline fields are flagged missing.'
  );
}

function buildStablecoinGlossaryAnswer(snapshot, chunks) {
  const facts = precomputedFacts(snapshot);
  const body = [
    'A stablecoin is a crypto asset designed to track a reference value, most often one US dollar. In DDD, many stablecoins are aggregated into a single market-cap numerator.',
    `${facts.benchmark_definition} Headline figures here: ${facts.ddd_reading}, ${facts.one_in_x}, stablecoins ${facts.stablecoin_market_cap}, M2 ${facts.us_m2}.`
  ].join('\n\n');
  return structured(
    body,
    'knowledge/stablecoin-glossary.md concepts plus precomputedFacts headline numbers.',
    sourcesLines(chunks),
    missingSnapshotFields(snapshot).length
      ? `Snapshot gaps: ${missingSnapshotFields(snapshot).join(', ')}.`
      : 'No required headline fields are flagged missing.'
  );
}

function buildSolanaChainExplain(snapshot, chunks) {
  const facts = precomputedFacts(snapshot);
  const sum = snapshotSummary(snapshot);
  const sol = sum.solana_chain_share;
  const body = sol
    ? [
        'Solana in this snapshot is one row in the chain table: it shows how much tracked stablecoin supply is attributed to the Solana network.',
        `Figures from the same JSON as the cards: ${facts.solana_chain_share}.`,
        `${facts.benchmark_definition}`
      ].join('\n\n')
    : 'Solana chain share is not available in the current local dataset (missing chain row or empty table).';
  return structured(
    body,
    'snapshot.chains row matched as Solana via snapshotSummary(); precomputedFacts.solana_chain_share string.',
    sourcesLines(chunks),
    missingSnapshotFields(snapshot).includes('chains.Solana')
      ? 'chains.Solana row missing from snapshot.'
      : 'No Solana-specific gaps flagged beyond the general snapshot list.'
  );
}

function buildOracleReferenceAnswer(snapshot, onchain, chunks) {
  const facts = precomputedFacts(snapshot);
  if (!onchain || typeof onchain !== 'object') {
    return structured(
      'No local Solana oracle reference JSON was loaded. Add `data/ddd-onchain.snapshot.json` and refresh.',
      'Missing onchain snapshot object in the UI state.',
      sourcesLines(chunks),
      'On-chain reference file not available.'
    );
  }
  const cv = onchain.cached_values || {};
  const solOracle = cv.solana_chain_share;
  const oracleSolLine = solOracle && typeof solOracle === 'object'
    ? `Oracle file also caches a Solana chain snapshot: ${formatPercent(solOracle.share_percent)} with ${formatCurrency(solOracle.stablecoin_supply_usd)} supply.`
    : '';

  const body = [
    'This browser demo does not call Solana RPC directly. The panel below is built from `data/ddd-onchain.snapshot.json`, which stores a cached oracle reference and metadata from the DDD Solana program workstream.',
    `Program id: ${onchain.solana_program_id || 'not available in the current local dataset'}. Cluster: ${onchain.cluster || 'not available in the current local dataset'}. Oracle model label: ${onchain.oracle_model || 'not available in the current local dataset'}.`,
    `Read status: ${onchain.read_status || 'not available in the current local dataset'}. Note: ${onchain.runtime_note || 'not available in the current local dataset'}.`,
    `Headline DDD figures from the shelf snapshot (for comparison with any cached oracle payload): DDD ${facts.ddd_reading}; stablecoins ${facts.stablecoin_market_cap}; US M2 ${facts.us_m2}; one-in ${facts.one_in_x}.`,
    oracleSolLine
  ].filter(Boolean).join('\n\n');

  return structured(
    body,
    '`data/ddd-onchain.snapshot.json` fields (program id, cluster, read_status, cached_values) plus headline `data/ddd-current.snapshot.json` via precomputedFacts.',
    sourcesLines(chunks),
    missingSnapshotFields(snapshot).length
      ? `Snapshot gaps: ${missingSnapshotFields(snapshot).join(', ')}.`
      : 'No headline snapshot gaps flagged; remember cached oracle values can still be stale versus true chain state.'
  );
}

/**
 * Deterministic answers for common “what is …?” style questions so the UI works without QVAC.
 * Returns null when the query should go to the model instead.
 */
export function tryBuildIntentAnswer({ query, snapshot, onchainSnapshot, chunks }) {
  const q = normalizeChipQuery(query).replace(/\bddi\b/g, 'ddd');
  if (!q) return null;

  const oracleish = /\b(oracle|on-?chain|onchain|program id|pda|rpc|devnet|mainnet|solana program)\b/i.test(q);
  if (oracleish && /\b(solana|oracle)\b/i.test(q)) {
    return buildOracleReferenceAnswer(snapshot, onchainSnapshot, chunks);
  }

  if (isStablecoinChoiceQuery(q)) {
    return buildStablecoinChoiceAnswer(query, snapshot, chunks);
  }

  if (isFactualTwoIssuerComparisonQuery(q, snapshot)) {
    return buildFactualIssuerPairAnswer(query, snapshot, chunks);
  }

  if (shouldDeferStablecoinPresetsToModel(q, snapshot)) {
    return null;
  }

  if (isStablecoinPersonalSuitabilityQuery(q)) {
    return buildStablecoinPersonalSuitabilityAnswer(query, snapshot, chunks);
  }

  if (looksLikeLargestIssuerQuery(q)) {
    return buildLargestIssuerAnswer(snapshot, chunks);
  }

  const issuer = pickIssuerFromQuery(query, snapshot);
  const definitionalIssuer = looksLikeDefinitionQuery(q);
  if (issuer && (definitionalIssuer || /\b(usdt|usdc|usds|dai|fdusd|pyusd)\b/i.test(q))) {
    if (definitionalIssuer || !queryIsWalletCustodyPrimary(q)) {
      return buildIssuerAnswer(issuer, snapshot, chunks, { definitional: definitionalIssuer });
    }
  }

  if (looksLikeDefinitionQuery(q) && /\b(m2|money supply)\b/i.test(q)) {
    return buildM2Answer(snapshot, chunks);
  }

  if (looksLikeDefinitionQuery(q) && /\b(ddd|digital dollar dominance)\b/i.test(q)) {
    return buildDddAnswer(snapshot, chunks);
  }

  if (looksLikeDefinitionQuery(q) && /\bstablecoins?\b/i.test(q) && !issuer) {
    return buildStablecoinGlossaryAnswer(snapshot, chunks);
  }

  if (looksLikeDefinitionQuery(q) && /\bsolana\b/i.test(q) && !oracleish) {
    return buildSolanaChainExplain(snapshot, chunks);
  }

  return null;
}
