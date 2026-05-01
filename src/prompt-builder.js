import { PROHIBITED_TERMS } from './config.js';

export function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'not available in the current local dataset';
  }
  return `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'not available in the current local dataset';
  }
  return `${Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

export function isSolanaChain(chain) {
  const name = String(chain?.name || '').toLowerCase().trim();
  if (!name) return false;
  return name === 'solana' || name === 'sol' || /\bsolana\b/.test(name);
}

export function snapshotSummary(snapshot) {
  const largestIssuer = snapshot.issuers?.[0] || null;
  const largestChain = snapshot.chains?.[0] || null;
  const solana = snapshot.chains?.find(isSolanaChain) || null;
  return {
    dataset_status: snapshot.dataset_status || 'unknown',
    generated_at: snapshot.generated_at || null,
    last_updated: snapshot.last_updated || null,
    ddd_percent: snapshot.ddd_percent ?? null,
    stablecoin_market_cap_usd: snapshot.stablecoin_market_cap_usd ?? null,
    us_m2_usd: snapshot.us_m2_usd ?? null,
    one_in_x: snapshot.one_in_x ?? null,
    largest_issuer: largestIssuer,
    largest_chain: largestChain,
    solana_chain_share: solana
  };
}

export function precomputedFacts(snapshot) {
  const summary = snapshotSummary(snapshot);
  const target = 2;
  const distance = snapshot.ddd_percent === null || snapshot.ddd_percent === undefined
    ? null
    : Number((target - Number(snapshot.ddd_percent)).toFixed(4));

  return {
    benchmark_definition: 'Digital Dollar Dominance, or DDD, measures total stablecoin market capitalisation divided by US M2.',
    ddd_reading: formatPercent(snapshot.ddd_percent),
    one_in_x: snapshot.one_in_x ? `1 in ${snapshot.one_in_x}` : 'not available in the current local dataset',
    stablecoin_market_cap: formatCurrency(snapshot.stablecoin_market_cap_usd),
    us_m2: formatCurrency(snapshot.us_m2_usd),
    distance_from_2_percent_percentage_points: distance === null ? 'not available in the current local dataset' : `${distance.toFixed(4)} percentage points`,
    precomputed_field_reminder:
      'Do not confuse: (1) one_in_x is a plain-language scale of stablecoin stock vs M2. (2) distance_from_2_percent_percentage_points is how far current DDD% is below a 2% DDD reference—they are not interchangeable. (3) us_m2 is the M2 denominator only—copy that line exactly; it is on the order of tens of trillions of USD, never add extra zeros.',
    largest_issuer: summary.largest_issuer
      ? `${summary.largest_issuer.name} (${summary.largest_issuer.symbol || 'symbol not available'}) at ${formatCurrency(summary.largest_issuer.market_cap_usd)} and ${formatPercent(summary.largest_issuer.share_percent)} share`
      : 'not available in the current local dataset',
    largest_chain: summary.largest_chain
      ? `${summary.largest_chain.name} at ${formatCurrency(summary.largest_chain.stablecoin_supply_usd)} and ${formatPercent(summary.largest_chain.share_percent)} share`
      : 'not available in the current local dataset',
    solana_chain_share: summary.solana_chain_share
      ? `${formatPercent(summary.solana_chain_share.share_percent)} with ${formatCurrency(summary.solana_chain_share.stablecoin_supply_usd)} stablecoin supply`
      : 'not available in the current local dataset'
  };
}

export function localResearchDataPack(snapshot, onchainSnapshot = null) {
  const summary = snapshotSummary(snapshot);
  return {
    summary,
    top_issuers: (snapshot.issuers || []).slice(0, 20).map((issuer) => ({
      name: issuer.name,
      symbol: issuer.symbol,
      market_cap_usd: issuer.market_cap_usd,
      share_percent: issuer.share_percent,
      entity: issuer.entity,
      backing_type: issuer.backing_type,
      last_updated: issuer.last_updated
    })),
    top_chains: (snapshot.chains || []).slice(0, 20).map((chain) => ({
      name: chain.name,
      stablecoin_supply_usd: chain.stablecoin_supply_usd,
      share_percent: chain.share_percent,
      rank: chain.rank
    })),
    solana_oracle_reference: onchainSnapshot ? {
      solana_program_id: onchainSnapshot.solana_program_id,
      cluster: onchainSnapshot.cluster,
      oracle_model: onchainSnapshot.oracle_model,
      pda_seeds: onchainSnapshot.pda_seeds,
      read_status: onchainSnapshot.read_status,
      offline_note: onchainSnapshot.runtime_note,
      cached_values: onchainSnapshot.cached_values
    } : 'not available in the current local dataset'
  };
}

export function missingSnapshotFields(snapshot) {
  const required = [
    ['ddd_percent', snapshot.ddd_percent],
    ['stablecoin_market_cap_usd', snapshot.stablecoin_market_cap_usd],
    ['us_m2_usd', snapshot.us_m2_usd],
    ['one_in_x', snapshot.one_in_x],
    ['last_updated', snapshot.last_updated]
  ];
  const missing = required.filter(([, value]) => value === null || value === undefined).map(([key]) => key);
  if (!snapshot.issuers?.length) missing.push('issuers');
  if (!snapshot.chains?.length) missing.push('chains');
  if (!snapshot.chains?.some(isSolanaChain)) {
    missing.push('chains.Solana');
  }
  return missing;
}

const MAX_HISTORY_USER_CHARS = 2400;
const MAX_HISTORY_ASSISTANT_CHARS = 1200;

function escapeReToken(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Issuer symbols from snapshot.issuers that appear in the raw user query (longest symbol first). */
function mentionedIssuerSymbolsFromQuery(query, snapshot) {
  const q = String(query || '');
  const issuers = snapshot?.issuers || [];
  const withSym = issuers.filter((i) => i.symbol).sort((a, b) => String(b.symbol).length - String(a.symbol).length);
  const found = [];
  for (const i of withSym) {
    const sym = String(i.symbol);
    if (new RegExp(`\\b${escapeReToken(sym)}\\b`, 'i').test(q)) found.push(sym.toUpperCase());
  }
  return [...new Set(found)];
}

function queryMentionsPlaceOrResidency(rawQuery) {
  const s = String(rawQuery || '').toLowerCase();
  if (/\b(i'm|i m|im)\s+in\s+\w+/i.test(s)) return true;
  if (/\b(live in|living in|based in|located in|resident of|from)\s+\w+/i.test(s)) return true;
  return /\b(usa|u s a|u s|united states|america|canada|uk|u k|france|germany|bali|indonesia|singapore|japan|australia|mexico|brazil|india|china|thailand|vietnam|philippines|eu|europe|asia)\b/i.test(s);
}

function wantsIssuerChoiceProsConsPlaybook(query, snapshot) {
  const syms = mentionedIssuerSymbolsFromQuery(query, snapshot);
  const place = queryMentionsPlaceOrResidency(query);
  const q = String(query || '').toLowerCase();
  const comparesPair = /\b(or|versus|vs\.?|compare|comparison)\b/.test(q);
  return syms.length >= 2 || (place && comparesPair);
}

function buildIssuerGeoProsConsPlaybook(query, snapshot) {
  const syms = mentionedIssuerSymbolsFromQuery(query, snapshot);
  if (!wantsIssuerChoiceProsConsPlaybook(query, snapshot)) return '';
  const rows = (snapshot.issuers || [])
    .filter((i) => syms.includes(String(i.symbol || '').toUpperCase()))
    .map((i) => `- ${String(i.symbol || '').toUpperCase()}: official row name "${i.name}"; use only these fields for that symbol: market_cap_usd, share_percent, entity, backing_type.`)
    .join('\n');
  return [
    'SPECIAL PLAYBOOK (this user message compares issuers and/or mentions a place—follow closely):',
    '- If the user names exactly two tickers with versus or compare language, write **only** about those two symbols from `top_issuers`. Do **not** answer with the table’s rank-one and rank-two issuers (often USDT then USDC) unless those are the symbols they wrote.',
    '- In **Answer**, cover **every issuer ticker the user named** that exists in `top_issuers`. Use the **symbol** column to tell assets apart (e.g. USDS is not USDC; never mislabel a row).',
    '- For **each** such issuer, write two short blocks: (1) **Pros-style (snapshot only)** — 2–4 bullets, each tied to numbers or fields from that issuer’s JSON row (market cap, share, backing_type, entity). (2) **Outside this JSON** — 2–4 bullets for what the dataset does **not** score (local law, tax, bank rails, exchange listing in the user’s place, redemption friction, personal circumstances).',
    '- You must **not** pick a winner, say which they “should” use, or recommend buying, selling, or holding. Close with neutral “verify locally” steps.',
    '- Relevant snapshot rows you must respect for symbols the user asked about:',
    rows || '- (none of the named tickers matched issuer rows—say so and still answer neutrally.)',
    '- Do **not** dump raw JSON field names into **Data Used**; write readable lines (e.g. “issuer rows USDT, USDS from snapshot”).',
    '- Keep the usual four sections; no `Answer: Answer` lines or UI labels inside the reply.'
  ].join('\n');
}

export function buildMessages({ query, snapshot, chunks, systemPrompt, onchainSnapshot = null, chatHistory = [] }) {
  const history = Array.isArray(chatHistory) ? chatHistory : [];
  const compactSnapshot = snapshotSummary(snapshot);
  const slimPack = {
    summary: compactSnapshot,
    top_issuers: (snapshot.issuers || []).slice(0, 20).map((issuer) => ({
      name: issuer.name,
      symbol: issuer.symbol,
      market_cap_usd: issuer.market_cap_usd,
      share_percent: issuer.share_percent
    })),
    top_chains: (snapshot.chains || []).slice(0, 20).map((chain) => ({
      name: chain.name,
      stablecoin_supply_usd: chain.stablecoin_supply_usd,
      share_percent: chain.share_percent,
      rank: chain.rank
    })),
    solana_oracle_reference: onchainSnapshot
      ? {
          solana_program_id: onchainSnapshot.solana_program_id,
          cluster: onchainSnapshot.cluster,
          read_status: onchainSnapshot.read_status,
          offline_note: onchainSnapshot.runtime_note,
          cached_values: onchainSnapshot.cached_values
        }
      : 'not available in the current local dataset'
  };
  const sourceText = chunks.length
    ? chunks.map((chunk, index) => `[${index + 1}] ${chunk.title}\nSource: ${chunk.source_file}\n${chunk.text}`).join('\n\n')
    : 'No local knowledge chunks were retrieved.';

  const issuerPlaybook = buildIssuerGeoProsConsPlaybook(query, snapshot);

  const userContent = [
    '/no_think',
    '',
    'User query (current message):',
    query,
    '',
    'Conversation transcript (earlier turns; same rules apply—no new numbers beyond snapshot and retrieved context):',
    history.length
      ? 'See prior user/assistant messages in the model message list immediately before this block.'
      : 'No prior turns in this session yet.',
    '',
    'Precomputed factual values to use exactly (copy digits from here, nowhere else):',
    JSON.stringify(precomputedFacts(snapshot), null, 2),
    '',
    'Snapshot summary and issuer/chain tables (same JSON as the page, up to 20 rows each):',
    JSON.stringify(slimPack, null, 2),
    '',
    'Missing snapshot fields:',
    JSON.stringify(missingSnapshotFields(snapshot)),
    '',
    'Retrieved local context:',
    sourceText,
    ...(issuerPlaybook ? ['', issuerPlaybook] : []),
    '',
    'Minimal format example (illustrative):',
    'Answer',
    'Two short paragraphs that answer the user directly.',
    'Data Used',
    'List snapshot keys and retrieved file names you used.',
    'Sources Used',
    '- knowledge/ddd-methodology.md: DDD Methodology',
    'Missing Data',
    'List gaps, or write none for this question.',
    '',
    'Answer requirements:',
    '- Answer only from the snapshot JSON and retrieved local context above.',
    '- Freeform user questions are allowed. If the question is about DDD, methodology, issuers, chains, Solana chain share, or the Solana onchain oracle, use the local research data pack and retrieved local context to answer it.',
    '- Do not require the user to choose one of the suggested prompts.',
    '- If the question asks for live Solana blockchain state while offline, explain that the module can cite the locally cached Solana oracle reference but cannot perform a fresh Solana RPC read without network access.',
    '- Use this exact section schema, with no extra sections and no text after Missing Data:',
    '  Answer',
    '  Data Used',
    '  Sources Used',
    '  Missing Data',
    '- Print each of those four headers exactly once, in that order. Never repeat Answer or paste the whole template again.',
    '- If a value is absent, write "not available in the current local dataset".',
    '- Keep the voice neutral, factual, and data first.',
    '- Do not include <think> tags, hidden reasoning, or scratchpad text.',
    '- Use the precomputed factual values exactly when answering numeric questions.',
    '- Do not introduce numeric values that are not present in the precomputed facts, snapshot JSON, or retrieved context.',
    '- For broad stablecoin adoption, US M2 comparison, issuer, chain, Solana share, distance-to-target, missing-data, or methodology questions, explain that Digital Dollar Dominance, or DDD, is the benchmark used here.',
    '- Prefer this framing when relevant: "Digital Dollar Dominance, or DDD, measures total stablecoin market capitalisation divided by US M2."',
    '- Before you write the Answer section, decide which precomputed fact lines apply to the user query, then answer using those lines in a logical order, copying every digit and percentage exactly as written in precomputed facts.',
    '- Keep the Answer section to at most twelve short sentences so you finish all four sections within the output limit.',
    '- Write the Answer in natural conversational sentences; avoid robotic labels inside Answer unless the user asked for a structured list.'
  ].join('\n');

  const messages = [{ role: 'system', content: systemPrompt }];
  for (const turn of history) {
    if (!turn || (turn.role !== 'user' && turn.role !== 'assistant')) continue;
    const raw = String(turn.content || '').trim();
    if (!raw) continue;
    const cap = turn.role === 'user' ? MAX_HISTORY_USER_CHARS : MAX_HISTORY_ASSISTANT_CHARS;
    const content = raw.length > cap ? `${raw.slice(0, cap - 1)}…` : raw;
    messages.push({ role: turn.role, content });
  }
  messages.push({ role: 'user', content: userContent });
  return messages;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function checkVoiceRules(answer) {
  const text = String(answer || '');
  return PROHIBITED_TERMS.filter((term) => {
    const pattern = new RegExp(`\\b${escapeRegex(term)}\\b`, 'i');
    return pattern.test(text);
  });
}
