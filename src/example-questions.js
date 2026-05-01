/**
 * Large catalog of tap-to-paste example prompts (deterministic, no network).
 * Freeform typing still works; these are inspiration chips only.
 */

const ISSUERS = ['USDT', 'USDC', 'DAI', 'USDS', 'PYUSD', 'FDUSD'];
const CHAINS = ['Ethereum', 'Tron', 'Solana', 'BNB Chain', 'Arbitrum', 'Base'];
const COUNTRIES = [
  'the USA',
  'Canada',
  'the UK',
  'Germany',
  'France',
  'Japan',
  'Singapore',
  'Brazil',
  'Mexico',
  'India',
  'Australia',
  'Nigeria',
  'South Korea',
  'Switzerland',
  'the UAE'
];
const ANALOGY_TOPICS = [
  'commercial real estate',
  'gold ETFs',
  'student loan balances',
  'credit card balances',
  'corporate bond funds',
  'money market funds',
  'reverse repos',
  'municipal bonds',
  'mortgage debt',
  'auto loans',
  'consumer credit',
  'household savings',
  'public pension assets',
  'sovereign wealth funds',
  'cross-border remittances',
  'commodity warehouse receipts',
  'tokenised Treasuries',
  'private credit funds',
  'venture capital dry powder',
  'AI datacenter capex'
];

function dedupe(strings) {
  const out = [];
  const seen = new Set();
  for (const s of strings) {
    const t = String(s || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function buildCatalog() {
  const q = [];

  // Core DDD / M2 / ratios
  const m2Stems = [
    'What is US M2 in this snapshot?',
    'Explain US M2 as used in DDD.',
    'How is M2 used as the denominator?',
    'What does M2SL mean in plain English here?',
    'Is M2 live in this demo?',
    'Why does DDD use M2 instead of M1?',
    'What is the stablecoin numerator in DDD?',
    'Define Digital Dollar Dominance.',
    'What does DDD percent represent?',
    'How do I read the DDD headline number?',
    'What does “1 in X” mean here?',
    'Translate the one-in ratio into plain language.',
    'How far are stablecoins from 2% of US M2?',
    'What is the gap to two percent of M2?',
    'Express DDD as a share of M2.',
    'Compare stablecoin market cap to US M2.',
    'How large are stablecoins compared with US M2 today?',
    'Which is bigger: stablecoins or a slice of M2?',
    'What is the headline stablecoin market cap?',
    'What is the headline US M2 line?',
    'When was this snapshot last updated?'
  ];
  q.push(...m2Stems);

  // Issuer / ticker
  for (const sym of ISSUERS) {
    q.push(`What is ${sym}?`);
    q.push(`Explain ${sym} using the snapshot row.`);
    q.push(`How large is ${sym} versus other issuers here?`);
    q.push(`What share does ${sym} have in this issuer table?`);
  }

  // Chains
  for (const ch of CHAINS) {
    q.push(`What is ${ch}’s role in this chain table?`);
    q.push(`How much stablecoin supply is on ${ch} in this snapshot?`);
    q.push(`What share does ${ch} have in this dataset?`);
  }

  // Solana / oracle
  const oracleStems = [
    'What is the DDD oracle on Solana?',
    'Explain the local Solana oracle reference file.',
    'Does this UI call Solana RPC?',
    'What is read_status in the on-chain snapshot?',
    'What program id is listed for the oracle reference?',
    'What cluster is the oracle reference using?',
    'What are the PDA seeds listed?',
    'What is cached in ddd-onchain.snapshot.json?',
    'Compare headline DDD with cached oracle values.',
    'What does offline_cached_solana_reference mean?'
  ];
  q.push(...oracleStems);

  // Comparisons
  for (let i = 0; i < ISSUERS.length; i += 1) {
    for (let j = i + 1; j < ISSUERS.length; j += 1) {
      q.push(`Compare ${ISSUERS[i]} and ${ISSUERS[j]} using snapshot rows.`);
      q.push(`${ISSUERS[i]} vs ${ISSUERS[j]}: market cap and share in this JSON?`);
    }
  }

  for (let i = 0; i < CHAINS.length; i += 1) {
    for (let j = i + 1; j < CHAINS.length; j += 1) {
      q.push(`Compare ${CHAINS[i]} and ${CHAINS[j]} stablecoin supply in this snapshot.`);
    }
  }

  // Jurisdiction + stablecoin choice (neutral intent path)
  for (const c of COUNTRIES) {
    q.push(`I live in ${c}; should I use USDT or USDC?`);
    q.push(`In ${c}, which stablecoin is safer: USDT or USDC?`);
    q.push(`Based in ${c}: compare USDT vs USDC using only this dataset.`);
    q.push(`Is USDC a good solution for me in ${c}?`);
    q.push(`Is USDT a good idea for me in ${c}?`);
  }

  // Methodology / meta / gaps
  const meta = [
    'What data is missing from this local snapshot?',
    'List snapshot gaps in one place.',
    'Summarise methodology using only local sources.',
    'What files built this snapshot?',
    'What does dataset_status mean here?',
    'Generate a factual prediction market template for crossing 2% of US M2.',
    'Write a neutral check-list before trusting headline numbers.',
    'How would you audit these figures offline?',
    'What is the largest issuer in this table?',
    'What is the largest chain in this table?',
    'What is Solana’s chain share here?',
    'Compare Solana’s stablecoin share with the largest chain.',
    'Which issuer has the largest share?',
    'Which chains hold the largest stablecoin supply?',
    'What does “stablecoin” mean in the glossary sense?',
    'Are stablecoins cash equivalents in this module?',
    'What risks does the disclaimer call out?',
    'What sources should I verify against in real life?',
    'Explain the four answer sections this UI expects.',
    'What is local QVAC used for here?'
  ];
  q.push(...meta);

  // Cross-domain analogies (still methodology-framed; model answers with limits)
  for (const topic of ANALOGY_TOPICS) {
    q.push(
      `As a thought experiment, what numerator would we need to define a DDD-style ratio for ${topic}, and what would break without local facts?`
    );
    q.push(
      `If someone asked about ${topic} using the same “numerator over US M2” framing as DDD, what is missing from this snapshot?`
    );
    q.push(
      `Compare the DDD methodology story to discussing ${topic}—what stays factual and what becomes speculation?`
    );
  }

  return dedupe(q);
}

export const EXAMPLE_CATALOG_QUESTIONS = buildCatalog();
