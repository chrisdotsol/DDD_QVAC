import { missingSnapshotFields, precomputedFacts } from './prompt-builder.js';

export function normalizeChipQuery(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/\bwhat's\b/g, 'what is')
    .replace(/\bwhere's\b/g, 'where is')
    .replace(/\bwho's\b/g, 'who is')
    .replace(/\bhow's\b/g, 'how is')
    .replace(/\bwhen's\b/g, 'when is')
    .replace(/\bwhy's\b/g, 'why is')
    .replace(/\bwhats\b/g, 'what is')
    .replace(/'s\b/g, '')
    .replace(/[^a-z0-9%'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/, '')
    .trim();
}

function wordsSet(text) {
  return new Set(String(text || '').split(' ').filter(Boolean));
}

function hasAny(set, values) {
  return values.some((v) => set.has(v));
}

function hasAll(set, values) {
  return values.every((v) => set.has(v));
}

/** Map user text to a built-in answer kind, or null to use the model. */
export function classifyChipQuery(query) {
  const q = normalizeChipQuery(query);
  if (!q) return null;
  const w = wordsSet(q);

  if (
    hasAll(w, ['solana']) &&
    hasAny(w, ['compare', 'versus', 'vs']) &&
    hasAny(w, ['largest', 'top']) &&
    hasAny(w, ['chain', 'chains']) &&
    hasAny(w, ['share', 'shares', 'supply'])
  ) {
    return 'solana_vs_largest_chain';
  }
  if (
    (q.includes('prediction market') || (hasAny(w, ['crossing', 'cross']) && (q.includes('2 percent') || q.includes('2%') || q.includes('two percent')))) &&
    hasAny(w, ['generate', 'make', 'create', 'question', 'factual', 'template'])
  ) {
    return 'prediction_market';
  }
  if (
    hasAny(w, ['summarise', 'summarize', 'summary', 'explain']) &&
    hasAny(w, ['methodology', 'method']) &&
    hasAny(w, ['local', 'offline', 'snapshot', 'sources'])
  ) {
    return 'methodology_brief';
  }
  if (q.includes('show the data') || q.includes('data used for this answer') || (hasAll(w, ['data', 'used']) && hasAny(w, ['answer', 'response']))) {
    return 'meta_snapshot';
  }
  if (hasAny(w, ['missing', 'unavailable', 'absent']) || q.includes('what data is missing')) {
    return 'missing_fields';
  }
  if (
    (hasAny(w, ['far', 'distance', 'gap', 'away']) && hasAny(w, ['2', 'two', 'percent'])) ||
    q.includes('2 percent') || q.includes('2%') || q.includes('two percent')
  ) {
    if (hasAny(w, ['m2', 'stablecoin', 'stablecoins', 'ddd'])) {
      return 'distance_to_two';
    }
  }
  if (/\b1 in \d+\b|\bone in \d+\b/.test(q) || (/what does/.test(q) && /\b1 in\b/.test(q)) || (q.includes('one in x') && hasAny(w, ['mean', 'meaning']))) {
    return 'one_in_x_meaning';
  }
  if (
    hasAny(w, ['issuer', 'issuers']) &&
    hasAny(w, ['largest', 'biggest', 'top', 'dominant', 'share'])
  ) {
    return 'largest_issuer';
  }
  if (
    hasAny(w, ['chain', 'chains', 'network', 'networks']) &&
    hasAny(w, ['largest', 'top', 'hold', 'holds', 'holding', 'distribution', 'supply'])
  ) {
    return 'top_chains';
  }
  if (
    (hasAny(w, ['stablecoin', 'stablecoins', 'ddd']) && hasAny(w, ['large', 'size', 'big', 'compare', 'comparison', 'vs', 'versus']) && hasAny(w, ['m2', 'money']))
    || q.includes('m2 today')
  ) {
    return 'm2_comparison';
  }
  return null;
}

function sourcesBlock(chunks) {
  if (!chunks?.length) {
    return 'No knowledge chunks scored above zero for this wording; the methodology and glossary files in the index still define DDD.';
  }
  return chunks.map((c) => `- ${c.source_file}: ${c.title}`).join('\n');
}

function fourSection(answerBody, dataUsed, sourcesUsed, missingBody) {
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

export function tryBuildChipAnswer({ query, snapshot, chunks }) {
  const kind = classifyChipQuery(query);
  if (!kind) return null;

  const facts = precomputedFacts(snapshot);
  const missing = missingSnapshotFields(snapshot);
  const missLine = missing.length
    ? `Snapshot gaps flagged for this dataset: ${missing.join(', ')}.`
    : 'No required snapshot fields are flagged missing for this question.';
  const src = sourcesBlock(chunks);

  switch (kind) {
    case 'm2_comparison': {
      const body = [
        `${facts.benchmark_definition} In this frozen snapshot, DDD is ${facts.ddd_reading}, which reads as about ${facts.one_in_x} when you line up all stablecoins against US M2.`,
        `Total stablecoin market capitalisation in the pack is ${facts.stablecoin_market_cap}. US M2 in the same pack is ${facts.us_m2}.`,
        'These are ratio inputs, not trading signals; they describe how large the stablecoin stock is relative to the M2 aggregate printed in the snapshot.'
      ].join('\n\n');
      return fourSection(
        body,
        'precomputedFacts(), snapshot summary fields ddd_percent, stablecoin_market_cap_usd, us_m2_usd, one_in_x, plus retrieved knowledge titles below.',
        src,
        missLine
      );
    }
    case 'one_in_x_meaning': {
      const body = [
        `The “1 in X” line on the dashboard is another way to read the same ratio as DDD. Here it is ${facts.one_in_x}: roughly one dollar of stablecoin market cap for every X dollars of US M2 in this snapshot.`,
        `DDD as a percent is still ${facts.ddd_reading}; both lines use the same numerator (${facts.stablecoin_market_cap}) and denominator (${facts.us_m2}).`,
        'It is a scale comparison, not a forecast of how bank balances or stablecoins will move next.'
      ].join('\n\n');
      return fourSection(
        body,
        'precomputedFacts one_in_x and ddd_reading; snapshot stablecoin_market_cap_usd and us_m2_usd.',
        src,
        missLine
      );
    }
    case 'largest_issuer': {
      const body = [
        `The largest issuer row in this snapshot is: ${facts.largest_issuer}.`,
        'Issuer rows are ordered by the generator that built the local JSON; the headline share is taken from that first row.',
        `${facts.benchmark_definition}`
      ].join('\n\n');
      return fourSection(
        body,
        'snapshot.issuers[0] via precomputedFacts.largest_issuer; benchmark definition string.',
        src,
        missLine
      );
    }
    case 'top_chains': {
      const rows = (snapshot.chains || []).slice(0, 6).map((ch) => {
        const cap = ch.stablecoin_supply_usd != null ? `$${Number(ch.stablecoin_supply_usd).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : 'not available in the current local dataset';
        const sh = ch.share_percent != null ? `${Number(ch.share_percent).toFixed(4)}%` : 'not available in the current local dataset';
        return `${ch.name}: about ${sh} of stablecoin supply in this snapshot, roughly ${cap} in supply terms.`;
      });
      const body = rows.length
        ? ['Chains in the local file are ranked by stablecoin supply attributed to each network. Top rows:', ...rows.map((r) => `- ${r}`)].join('\n')
        : 'Chain rows are not present in this snapshot file.';
      return fourSection(
        body,
        'snapshot.chains ordered as stored in ddd-current.snapshot.json (top six rows listed).',
        src,
        missLine
      );
    }
    case 'distance_to_two': {
      const body = [
        `A common reference point is two percent of US M2. In this snapshot DDD is ${facts.ddd_reading}, so the gap to two percent is ${facts.distance_from_2_percent_percentage_points} (still using the same M2 and stablecoin totals as elsewhere on the page).`,
        `${facts.benchmark_definition}`
      ].join('\n\n');
      return fourSection(
        body,
        'precomputedFacts.distance_from_2_percent_percentage_points and ddd_reading.',
        src,
        missLine
      );
    }
    case 'missing_fields': {
      const body = missing.length
        ? `The generator flagged these fields or tables as incomplete or empty in this JSON: ${missing.join(', ')}. Anything not listed should be present, but you should still verify against the upstream sources named in methodology.`
        : 'This snapshot passes the local completeness check: issuers, chains, Solana, DDD percent, caps, M2, one-in-X, and timestamps are all populated in the file we loaded.';
      return fourSection(
        body,
        'missingSnapshotFields() over ddd-current.snapshot.json.',
        src,
        'For this question the missing list itself is the answer; see Answer above.'
      );
    }
    case 'solana_vs_largest_chain': {
      const body = [
        `Largest chain by stablecoin supply in this snapshot: ${facts.largest_chain}.`,
        `Solana’s row in the same file reads: ${facts.solana_chain_share}.`,
        'Compare the two share percentages and supply figures directly; both come from the same frozen chain table.'
      ].join('\n\n');
      return fourSection(
        body,
        'snapshot.chains: first row as largest_chain; Solana row matched by name via snapshotSummary().',
        src,
        missLine
      );
    }
    case 'prediction_market': {
      const body = [
        'A deterministic wording (no odds, no thesis) is:',
        'Will Digital Dollar Dominance, defined as total stablecoin market cap divided by US M2, be at or above two percent by the calendar deadline you insert, according to DDD’s published methodology?',
        `Fill-ins from this snapshot only: current DDD is ${facts.ddd_reading}; distance to two percent is ${facts.distance_from_2_percent_percentage_points}. Pick any fixed deadline you can observe objectively; do not add probability language.`
      ].join('\n\n');
      return fourSection(
        body,
        'prediction-market-resolution.md rules; precomputedFacts for current DDD and distance.',
        src,
        missLine
      );
    }
    case 'methodology_brief': {
      const body = [
        `${facts.benchmark_definition}`,
        'DDD percent = total stablecoin market capitalization divided by US M2 money supply, times one hundred.',
        'Public data: stablecoin side from DeFi Llama style aggregates in the site pipeline; US M2 from FRED M2SL in the site pipeline. Offline demos must read the normalized snapshot, not live APIs.',
        'The ratio is descriptive only; it is not an investment signal or adoption forecast.'
      ].join('\n\n');
      return fourSection(
        body,
        'ddd-methodology.md (conceptual lines) plus precomputed benchmark string; retrieved chunk titles below.',
        src,
        missLine
      );
    }
    case 'meta_snapshot': {
      const keys = ['ddd_percent', 'stablecoin_market_cap_usd', 'us_m2_usd', 'one_in_x', 'issuers', 'chains', 'last_updated'];
      const body = [
        'For any answer on this page, the model is supposed to rely on:',
        `- JSON snapshot keys such as: ${keys.join(', ')}.`,
        `- Retrieved markdown chunks (titles listed under Sources Used for this run).`,
        `- precomputedFacts() which copies those numbers into single-line strings to reduce copying errors.`,
        `Current headline values: DDD ${facts.ddd_reading}, stablecoins ${facts.stablecoin_market_cap}, M2 ${facts.us_m2}, ${facts.one_in_x}.`
      ].join('\n\n');
      return fourSection(
        body,
        'Meta explanation only; values from precomputedFacts() for consistency with the cards above.',
        src,
        missLine
      );
    }
    default:
      return null;
  }
}
