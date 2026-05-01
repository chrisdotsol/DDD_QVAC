const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in',
  'is', 'it', 'of', 'on', 'or', 'show', 'that', 'the', 'to', 'using', 'what',
  'which', 'with'
]);

/** Source order when keyword scores tie or all scores are zero (always send some context to the model). */
const SOURCE_PRIORITY = [
  'knowledge/ddd-methodology.md',
  'knowledge/stablecoin-glossary.md',
  'knowledge/issuer-notes.md',
  'knowledge/chain-notes.md',
  'knowledge/solana-chain-share.md',
  'knowledge/prediction-market-resolution.md',
  'knowledge/source-notes.md'
];

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9.%$ ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token && token.length > 1 && !STOP_WORDS.has(token));
}

function expandRetrievalTokens(tokens) {
  const out = new Set(tokens);
  for (const t of tokens) {
    if (t.endsWith('ies') && t.length > 4) out.add(t.slice(0, -3) + 'y');
    else if (t.endsWith('s') && t.length > 4) out.add(t.slice(0, -1));
    else if (!t.endsWith('s') && t.length > 4) out.add(`${t}s`);
  }
  return out;
}

/** Tokens used for retrieval: base words plus plural/singular variants and standalone numbers from the query. */
export function retrievalQueryTokens(query) {
  const base = tokenize(query);
  const fromWords = expandRetrievalTokens(base);
  const nums = String(query || '')
    .toLowerCase()
    .match(/\b\d{1,8}\b/g);
  if (nums) for (const n of nums) fromWords.add(n);
  return fromWords;
}

function priorityRank(sourceFile) {
  const idx = SOURCE_PRIORITY.indexOf(sourceFile);
  return idx === -1 ? SOURCE_PRIORITY.length : idx;
}

export function chunkMarkdown({ sourceFile, markdown, maxTokens = 420 }) {
  const lines = String(markdown || '').split(/\r?\n/);
  const chunks = [];
  let title = sourceFile.replace(/\.md$/, '');
  let buffer = [];
  let tokenCount = 0;
  let count = 0;

  function flush() {
    if (!buffer.length) return;
    const text = buffer.join('\n').trim();
    if (!text) return;
    count += 1;
    chunks.push({
      id: `${sourceFile.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-${count}`,
      source_file: `knowledge/${sourceFile}`,
      title,
      text,
      last_updated: new Date().toISOString().slice(0, 10),
      embedding: null,
      keywords: [...new Set(tokenize(`${title} ${text}`))].slice(0, 80)
    });
    buffer = [];
    tokenCount = 0;
  }

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading && buffer.length) flush();
    if (heading) title = heading[1].trim();

    const lineTokens = tokenize(line).length;
    if (tokenCount + lineTokens > maxTokens && buffer.length) flush();
    buffer.push(line);
    tokenCount += lineTokens;
  }
  flush();
  return chunks;
}

export function retrieveChunks(query, index, { limit = 5 } = {}) {
  const querySet = retrievalQueryTokens(query);
  const chunks = Array.isArray(index?.chunks) ? index.chunks : [];
  const qLower = String(query || '').toLowerCase();

  const scored = chunks.map((chunk) => {
    const keywords = Array.isArray(chunk.keywords) ? chunk.keywords : tokenize(chunk.text);
    let score = 0;
    for (const token of keywords) {
      if (querySet.has(token)) score += 2;
    }
    const lower = `${chunk.title || ''} ${chunk.text || ''}`.toLowerCase();
    let substringBonus = 0;
    for (const token of querySet) {
      if (substringBonus >= 14) break;
      if (token.length < 2) continue;
      // Avoid single-letter digit "1" alone (too many false positives). Allow 2+ digit numbers and m2.
      const safeShort = token === 'm2' || /^\d{2,8}$/.test(token);
      if (token.length >= 3 || safeShort) {
        if (lower.includes(token)) substringBonus += 1;
      }
    }
    score += substringBonus;
    if (qLower.includes('solana') && lower.includes('solana')) score += 8;
    if (qLower.includes('issuer') && lower.includes('issuer')) score += 5;
    if (qLower.includes('chain') && lower.includes('chain')) score += 5;
    if (qLower.includes('methodology') && lower.includes('methodology')) score += 5;
    if (qLower.includes('prediction') && lower.includes('prediction')) score += 5;
    if (qLower.includes('m2') && lower.includes('m2')) score += 4;
    if ((qLower.includes('stablecoin') || qLower.includes('stablecoins')) && lower.includes('stablecoin')) score += 4;
    if (qLower.includes('missing') && lower.includes('missing')) score += 3;
    if (qLower.includes('dollar') && (lower.includes('dollar') || lower.includes('dominance'))) score += 2;
    return { ...chunk, score };
  });

  const stripScore = ({ score: _s, ...rest }) => rest;

  const positive = scored.filter((chunk) => chunk.score > 0);
  if (positive.length) {
    return positive
      .sort((a, b) => b.score - a.score || priorityRank(a.source_file) - priorityRank(b.source_file) || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map(stripScore);
  }

  return scored
    .sort((a, b) => priorityRank(a.source_file) - priorityRank(b.source_file) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(stripScore);
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
