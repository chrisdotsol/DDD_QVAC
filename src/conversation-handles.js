/**
 * Short queries that should not trigger a full LLM completion (avoids repeated template dumps).
 */

import {
  formatCurrency,
  formatPercent,
  missingSnapshotFields,
  precomputedFacts
} from './prompt-builder.js';

/** Shown when the assistant cannot match or safely answer the question as asked. */
export const REPHRASE_OR_DDD_HINT =
  'Try wording your question differently, or ask something related to DDD—for example stablecoins versus US M2, issuer shares, chain mix, methodology, what is missing from this snapshot, or the local Solana oracle reference.';

export function isCasualChatQuery(query) {
  const raw = String(query || '').trim().toLowerCase();
  if (!raw || raw.length > 200) return false;

  const q = raw
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!q) return false;

  const direct = [
    'hi', 'hello', 'hey', 'howdy', 'yo', 'sup', "what's up", 'whats up', 'what is up',
    'good morning', 'good afternoon', 'good evening', 'greetings',
    'thanks', 'thank you', 'thx', 'ty', 'tysm',
    'ok', 'okay', 'cool', 'nice',
    'bye', 'goodbye', 'cya', 'see ya',
    'good to meet you', 'pleased to meet you',
    'how are you', 'how are you doing', 'hru', 'how r u',
    'got it', 'makes sense', 'i see', 'understood', 'alright', 'sure', 'sure thing', 'sounds good', 'perfect'
  ];
  if (direct.includes(q)) return true;

  const words = q.split(' ');
  const GREET = new Set(['hi', 'hello', 'hey', 'howdy', 'yo', 'sup', 'greetings']);
  const SMALL_TALK = new Set(['how', 'are', 'you', 'doing', 'today', 'there', 'everyone', 'all', 'team', 'whats', "what's", 'up']);
  const COURTESY = new Set(['thanks', 'thank', 'you', 'thx', 'ty', 'tysm', 'ok', 'okay', 'cool', 'nice']);
  const BYE = new Set(['bye', 'goodbye', 'cya', 'see', 'ya', 'later']);
  const DOMAIN = new Set(['ddd', 'stablecoin', 'stablecoins', 'm2', 'issuer', 'issuers', 'chain', 'chains', 'solana', 'methodology', 'oracle', 'market', 'prediction', 'snapshot']);

  if (words.some((w) => DOMAIN.has(w))) return false;
  const maxLen = words.length <= 8;
  const onlySmallTalk = words.every((w) => GREET.has(w) || SMALL_TALK.has(w) || COURTESY.has(w) || BYE.has(w));
  const hasSignal = words.some((w) => GREET.has(w) || COURTESY.has(w) || BYE.has(w) || w === 'hru');
  return maxLen && onlySmallTalk && hasSignal;
}

/** Line starts a model "Answer" section (plain, markdown, `Answer: …`, or `Summary` alias). */
function lineStartsAnswerSection(trimmedLine) {
  return /^#{0,3}\s*\*{0,2}(Answer|Summary)\*{0,2}\b/i.test(trimmedLine);
}

/** Keeps the first Answer→Missing Data cycle; drops accidental repeated section blocks from small models. */
export function truncateToFirstAnswerBlock(text) {
  const lines = String(text || '').split(/\r?\n/);
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lineStartsAnswerSection(lines[i].trim())) starts.push(i);
  }
  if (starts.length <= 1) return String(text || '').trim();
  return lines.slice(0, starts[1]).join('\n').trim();
}

const SECTION_ORDER = ['Answer', 'Data Used', 'Sources Used', 'Missing Data'];

function canonSectionHeader(label) {
  const raw = String(label || '').trim().toLowerCase();
  if (raw === 'summary') return 'Answer';
  if (raw === 'sources') return 'Sources Used';
  return SECTION_ORDER.find((h) => h.toLowerCase() === raw) || null;
}

/** Same heading tokens as parseFourSectionAnswer — lines that match must not appear raw inside a wrapped Answer. */
const SECTION_HEADER_LINE_RE = /^#{0,3}\s*\*{0,2}(Answer|Summary|Data Used|Sources Used|Sources|Missing Data)\*{0,2}\s*:?\s*(.*)$/i;

/** Subtitles from `ANSWER_SECTION_UI` in app.js — models sometimes paste them into the Answer body. */
const UI_SCAFFOLD_LINES = new Set([
  'straight answer in everyday wording',
  'plain-language reply',
  'plain language reply',
  'which snapshot fields and numbers we used',
  'local knowledge notes pulled for this run',
  'what is missing or not available here',
  'figures and fields from this run'
]);

function lineIsUiScaffold(line) {
  const t = String(line || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!t) return false;
  if (UI_SCAFFOLD_LINES.has(t)) return true;
  if (/^answer\s*:\s*summary$/i.test(line.trim())) return true;
  if (/^answer\s*:\s*answer$/i.test(line.trim())) return true;
  if (/^answer\s*:\s*plain-language reply$/i.test(line.trim())) return true;
  if (/^data used\s*:\s*data\s*used$/i.test(line.trim())) return true;
  if (/^sources used\s*:\s*sources$/i.test(line.trim())) return true;
  if (/^missing data\s*:\s*gaps\b/i.test(line.trim())) return true;
  return false;
}

/**
 * Drop lines the browser UI uses as section subtitles — models echo them and duplicate the whole layout.
 */
export function stripUiScaffoldLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  const kept = lines.filter((line) => !lineIsUiScaffold(line));
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isBareAnswerHeaderLine(trimmedLine) {
  const m = trimmedLine.match(SECTION_HEADER_LINE_RE);
  if (!m) return false;
  const canon = canonSectionHeader(m[1]);
  if (canon !== 'Answer') return false;
  const rest = (m[2] || '').trim();
  return !rest || /^summary$/i.test(rest) || /^answer$/i.test(rest);
}

/**
 * True when a line is only an echoed Answer/Summary card title (markdown variants), no prose.
 */
function isAnswerTitleEchoLine(trimmed) {
  const t = String(trimmed || '').trim();
  if (!t) return false;
  if (lineIsUiScaffold(t)) return true;
  if (isBareAnswerHeaderLine(t)) return true;
  if (/^#{1,6}\s+(answer|summary)\b\s*:?\s*$/i.test(t)) return true;
  if (/^\*{1,2}\s*(answer|summary)\s*\*{1,2}\s*$/i.test(t)) return true;
  if (/^_{1,2}\s*(answer|summary)\s*_{1,2}\s*$/i.test(t)) return true;
  if (/^>\s*(answer|summary)\s*:?\s*$/i.test(t)) return true;
  if (/^(answer|summary)\s*:?\s*$/i.test(t)) return true;
  if (/^answer\s*:\s*plain[- ]language reply\s*$/i.test(t)) return true;
  return false;
}

const SECTION_LABEL_LINE_RES = {
  'Data Used': /^data used\s*:?\s*$/i,
  'Sources Used': /^(sources used|sources)\s*:?\s*$/i,
  'Missing Data': /^missing data\s*:?\s*$/i
};

/**
 * Strip echoed section headers and UI subtitle lines models paste into a section body
 * so the browser does not show “Answer” twice (card title + body echo).
 */
function polishFourSectionBodyPass(sectionKey, body) {
  const lines = String(body || '').split(/\r?\n/);
  const out = [...lines];
  const labelRe = SECTION_LABEL_LINE_RES[sectionKey];

  while (out.length) {
    const raw = out[0];
    const trimmed = stripDisplayInnoculation(raw).trim();
    if (!trimmed) {
      out.shift();
      continue;
    }
    if (sectionKey === 'Answer') {
      if (isAnswerTitleEchoLine(trimmed)) {
        out.shift();
        continue;
      }
      const m = trimmed.match(SECTION_HEADER_LINE_RE);
      if (m) {
        const canon = canonSectionHeader(m[1]);
        if (canon === 'Answer') {
          const rest = (m[2] || '').trim();
          if (!rest || /^answer$/i.test(rest) || /^summary$/i.test(rest)) {
            out.shift();
            continue;
          }
        }
      }
    } else if (labelRe && labelRe.test(trimmed)) {
      out.shift();
      continue;
    }
    break;
  }

  return out.join('\n').trim();
}

export function polishFourSectionBody(sectionKey, body) {
  let t = stripDisplayInnoculation(String(body || '')).trim();
  let prev = null;
  let guard = 0;
  while (prev !== t && guard < 20) {
    prev = t;
    t = polishFourSectionBodyPass(sectionKey, t);
    guard += 1;
  }
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * When the model prints a fake header block then repeats real `Answer`…`Missing Data`, keep the inner copy.
 */
export function preferInnerFourSectionCopy(text) {
  const lines = String(text || '').split(/\r?\n/);
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (isBareAnswerHeaderLine(lines[i].trim())) starts.push(i);
  }
  if (starts.length >= 2) {
    return lines.slice(starts[starts.length - 1]).join('\n').trim();
  }
  return String(text || '').trim();
}

/**
 * Strip echoed UI labels, prefer the substantive section block, then keep the first Answer→Missing cycle.
 */
export function sanitizeLocalModelReply(text) {
  let t = String(text || '').trim();
  t = stripUiScaffoldLines(t);
  t = preferInnerFourSectionCopy(t);
  t = truncateToFirstAnswerBlock(t);
  return t.trim();
}

/** Survives `String#trim`; keeps shadow lines from being parsed as real section headers. */
const VERBATIM_LINE_PREFIX = '\u200b';

/**
 * Strip innoculation marks so the answer panel does not show odd characters before lines.
 */
export function stripDisplayInnoculation(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\u200b\u200c\u200d\u2060]+/, ''))
    .join('\n');
}

/**
 * Prefix lines that would be parsed as schema headers so verbatim model prose stays under Answer.
 * Uses a leading ZWSP so `trim()` does not strip it and the line no longer matches `^`… header regex.
 */
export function innoculateVerbatimModelLinesAgainstSectionParsing(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      return SECTION_HEADER_LINE_RE.test(t) ? `${VERBATIM_LINE_PREFIX}${line}` : line;
    })
    .join('\n');
}

/**
 * Split structured reply into section bodies.
 * Accepts headers alone on a line, `Answer: text` on one line, and light markdown (`## Answer`, `**Answer**`).
 * Treats `Summary` / `Sources` as aliases some models use for Answer / Sources Used.
 */
export function parseFourSectionAnswer(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = {
    Answer: [],
    'Data Used': [],
    'Sources Used': [],
    'Missing Data': []
  };
  let cur = null;
  const headerRe = SECTION_HEADER_LINE_RE;
  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(headerRe);
    if (m) {
      cur = canonSectionHeader(m[1]);
      if (!cur) continue;
      const rest = (m[2] || '').trim();
      if (rest) out[cur].push(rest);
      continue;
    }
    if (cur) out[cur].push(line);
  }
  return out;
}

export function hasParsedAnswerStructure(parsed) {
  return SECTION_ORDER.some((k) => (parsed[k] || []).join('\n').trim().length > 0);
}

/**
 * When the model returns useful text but skips the four-section headers, wrap it so
 * guardrails and the answer panel always receive a valid schema (verbatim body in Answer).
 */
export function normalizeModelFourSectionAnswer(text, { snapshot, chunks } = {}) {
  let trimmed = String(text || '').trim();
  trimmed = stripUiScaffoldLines(trimmed);
  trimmed = preferInnerFourSectionCopy(trimmed);
  if (!trimmed) return trimmed;

  const parsed = parseFourSectionAnswer(trimmed);
  const answerBody = (parsed.Answer || []).join('\n').trim();
  if (answerBody.length > 0 && hasParsedAnswerStructure(parsed)) {
    return trimmed;
  }

  const miss = missingSnapshotFields(snapshot || {});
  const sourcesLines = (chunks || []).length
    ? (chunks || []).map((c) => `- ${c.source_file}: ${c.title}`).join('\n')
    : '- No knowledge chunks matched strongly for this query.';

  const missingBody = miss.length
    ? `Snapshot gaps: ${miss.join(', ')}. The model omitted section headers; this line is from the local snapshot checker.`
    : 'No required headline fields flagged missing. The model omitted section headers.';

  const safeBody = innoculateVerbatimModelLinesAgainstSectionParsing(trimmed);

  return [
    'Answer',
    safeBody,
    '',
    'Data Used',
    'Model reply had no recognised four-section headers, so the UI wrapped verbatim model text in Answer. Figures should match the snapshot JSON and precomputed block from the same turn.',
    '',
    'Sources Used',
    sourcesLines,
    '',
    'Missing Data',
    missingBody
  ].join('\n');
}

const SCHEMA_ECHO_LABELS = new Set(['answer', 'summary', 'data used', 'sources used', 'sources', 'missing data']);

function normaliseSchemaEchoToken(s) {
  return String(s || '')
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*{1,2}\s*/, '')
    .replace(/\s*\*{1,2}\s*$/i, '')
    .trim()
    .toLowerCase()
    .replace(/\*{1,2}/g, '')
    .replace(/\s+/g, ' ');
}

/** One line is only schema labels, e.g. `Answer`, `## Data Used`, or `Answer: Summary`. */
function lineIsSchemaEchoOnly(line) {
  const parts = String(line || '').split(/[:：]/);
  const head = normaliseSchemaEchoToken(parts[0] || '');
  const tail = parts.length > 1 ? normaliseSchemaEchoToken(parts.slice(1).join(':')) : '';
  if (!head || !SCHEMA_ECHO_LABELS.has(head)) return false;
  if (!tail) return true;
  return SCHEMA_ECHO_LABELS.has(tail);
}

/** True when the model printed only schema section titles (no figures or sentences). */
export function isSchemaHeaderOnlyEcho(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && l !== '—' && l !== '-');
  if (!lines.length || lines.length > 16) return false;
  return lines.every((line) => lineIsSchemaEchoOnly(line));
}

function chunkSourceLinesForVersus(chunks) {
  if (!chunks?.length) return '- No knowledge chunks matched strongly for this query.';
  return chunks.map((c) => `- ${c.source_file}: ${c.title}`).join('\n');
}

/**
 * Pull two ticker-like tokens from a comparison question. Tickers need not exist in the snapshot
 * (e.g. FDUSD can be asked even when that row is absent)—we still match USDS vs FDUSD.
 */
export function parseVersusPairFromQuery(query) {
  const q = String(query || '');
  let m = q.match(/\b([A-Za-z0-9]{2,10})\s*(?:vs\.?|versus)\s*([A-Za-z0-9]{2,10})\b/i);
  if (m) return [m[1].toUpperCase(), m[2].toUpperCase()];
  m = q.match(
    /\b([A-Za-z0-9]{2,10})\s+and\s+([A-Za-z0-9]{2,10})\b.*\b(cap|share|issuer|compare|json|table|dataset|rows?)\b/i
  );
  if (m) return [m[1].toUpperCase(), m[2].toUpperCase()];
  return null;
}

/** True when the normalised four-section reply still has no real prose in Answer (e.g. only echoed headers). */
export function normalizedAnswerIsSchemaShell(displayReady) {
  const p = parseFourSectionAnswer(String(displayReady || ''));
  const body = stripDisplayInnoculation((p.Answer || []).join('\n')).trim();
  return !body || isSchemaHeaderOnlyEcho(body);
}

/**
 * When the model echoes empty headers but the user asked SYM vs SYM, build a factual dual-issuer reply from the snapshot.
 */
export function buildIssuerVersusFromQueryAnswer(query, snapshot, chunks) {
  const issuers = snapshot?.issuers || [];
  if (!issuers.length) return null;

  const pair = parseVersusPairFromQuery(query);
  if (!pair) return null;
  const [left, right] = pair;
  if (left === right) return null;

  const by = (sym) => issuers.find((i) => String(i.symbol || '').toUpperCase() === sym);
  const a = by(left);
  const b = by(right);

  const facts = precomputedFacts(snapshot);
  const miss = missingSnapshotFields(snapshot);

  function rowLine(issuer) {
    if (!issuer) return null;
    return `- ${issuer.symbol} (${issuer.name}): market cap ${formatCurrency(issuer.market_cap_usd)}; issuer-table share ${formatPercent(issuer.share_percent)}.`;
  }

  const la = rowLine(a);
  const lb = rowLine(b);
  const intro =
    'The model reply had no usable comparison text, so this answer is built only from your question plus snapshot.issuers in the local JSON.';
  const rows = [la, lb].filter(Boolean);
  const body = [
    intro,
    rows.length ? ['Rows available in this file:', ...rows].join('\n') : `Neither ${left} nor ${right} appears in snapshot.issuers.`,
    `Headline context from the same file: DDD ${facts.ddd_reading} (${facts.one_in_x}).`
  ].join('\n\n');

  const missingBits = [
    miss.length ? `Snapshot gaps: ${miss.join(', ')}.` : 'No required headline fields flagged missing.',
    !a ? `${left} not found in issuer table.` : '',
    !b ? `${right} not found in issuer table.` : ''
  ].filter(Boolean);

  return [
    'Answer',
    body,
    '',
    'Data Used',
    'snapshot.issuers symbols resolved from the user question; precomputedFacts for the DDD headline line only.',
    '',
    'Sources Used',
    chunkSourceLinesForVersus(chunks),
    '',
    'Missing Data',
    missingBits.join(' ') || 'Nothing additional.'
  ].join('\n');
}

/** Short text from the last assistant turn for greetings and model context (avoids huge prompts). */
export function compactAssistantForHistory(fullText, maxLen = 900) {
  const raw = String(fullText || '').trim();
  if (!raw) return '';
  if (isSchemaHeaderOnlyEcho(raw) || normalizedAnswerIsSchemaShell(raw)) {
    return 'Prior assistant reply omitted (section labels only, no facts).';
  }
  const parsed = parseFourSectionAnswer(raw);
  const answer = stripDisplayInnoculation((parsed.Answer || []).join('\n')).trim();
  const base = answer || raw;
  if (!base.trim() || isSchemaHeaderOnlyEcho(base)) {
    return 'Prior assistant reply omitted (no substantive text).';
  }
  if (base.length <= maxLen) return base;
  return `${base.slice(0, Math.max(0, maxLen - 1))}…`;
}

/**
 * Four-section reply when the model returned nothing, malformed output, or QVAC failed—still grounded in snapshot headlines.
 */
export function buildMisunderstoodAnswer({ snapshot, chunks, lead }) {
  const facts = precomputedFacts(snapshot);
  const miss = missingSnapshotFields(snapshot);
  const tops = (chunks || []).length
    ? chunks.map((c) => `- ${c.source_file}: ${c.title}`)
    : ['- No knowledge chunks matched strongly; try a DDD topic above or tap a suggestion.'];

  return [
    'Answer',
    [lead, REPHRASE_OR_DDD_HINT].filter(Boolean).join('\n\n'),
    `For orientation in this dataset: DDD is ${facts.ddd_reading} (${facts.one_in_x}); stablecoins ${facts.stablecoin_market_cap}; US M2 ${facts.us_m2}.`,
    '',
    'Data Used',
    'precomputedFacts from the local snapshot JSON; retrieved chunk list for this query.',
    '',
    'Sources Used',
    ...tops,
    '',
    'Missing Data',
    [
      miss.length ? `Snapshot gaps: ${miss.join(', ')}.` : 'No required headline fields flagged missing.',
      'This path is a fallback when the question could not be answered in the usual structured way.'
    ].join(' ')
  ].join('\n');
}

export function buildCasualChatResponse({ chunks, priorAssistantSummary = '' }) {
  const tops = chunks.length
    ? chunks.slice(0, 6).map((c) => `- ${c.source_file}: ${c.title}`).join('\n')
    : '- No topic-specific notes matched this greeting; try a question about DDD, M2, issuers, or chains.';

  const threadHint = priorAssistantSummary
    ? ` We can keep going from your last topic (${priorAssistantSummary.slice(0, 220)}${priorAssistantSummary.length > 220 ? '…' : ''}).`
    : '';

  return [
    'Answer',
    `Hi — I am DDD Intelligence, your local assistant for this demo.${threadHint}`,
    'Ask in normal language (how stablecoins compare with US M2, largest issuer, chain mix, methodology, or the Solana oracle reference file); I will answer from the frozen snapshot and retrieved notes. You can also tap a suggestion below.',
    '',
    'Data Used',
    'Greeting path only. No local language model completion was run for this message.',
    '',
    'Sources Used',
    tops,
    '',
    'Missing Data',
    'No data question yet; this section will list snapshot gaps when you ask a factual question.'
  ].join('\n');
}
