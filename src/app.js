import {
  DEFAULT_COMPLETION_MODEL,
  FALLBACK_COMPLETION_MODEL,
  QVAC_BASE_URL,
  USE_DETERMINISTIC_CHAT_SHORTCUTS
} from './config.js';
import { chatCompletion, listModels, pickResolvedModel } from './qvac-client.js';
import { retrieveChunks } from './retrieval.js';
import { buildMessages, formatCurrency, formatPercent, snapshotSummary } from './prompt-builder.js';
import { buildGuardrailFallbackAnswer, evaluateAnswerGuardrails } from './answer-guardrails.js';
import {
  buildCasualChatResponse,
  buildIssuerVersusFromQueryAnswer,
  buildMisunderstoodAnswer,
  compactAssistantForHistory,
  hasParsedAnswerStructure,
  isCasualChatQuery,
  isSchemaHeaderOnlyEcho,
  normalizedAnswerIsSchemaShell,
  normalizeModelFourSectionAnswer,
  parseFourSectionAnswer,
  polishFourSectionBody,
  sanitizeLocalModelReply,
  stripDisplayInnoculation
} from './conversation-handles.js';
import { tryBuildChipAnswer } from './chip-answers.js';
import { tryBuildIntentAnswer } from './intent-answers.js';
import { EXAMPLE_CATALOG_QUESTIONS } from './example-questions.js';

const QUERY_STORAGE_KEY = 'ddd_intel_last_query';
const MAX_QUERY_CHARS = 6000;
/** Max prior user+assistant pairs kept for QVAC context (each pair = 2 entries). */
const MAX_CHAT_HISTORY_MESSAGES = 12;
let answerSectionIdSeq = 0;
/** Friendly labels (schema keys unchanged in the raw text). */
const ANSWER_SECTION_UI = [
  { key: 'Answer', title: 'Answer', sub: '' },
  { key: 'Data Used', title: 'Data used', sub: 'Snapshot fields and numbers cited in this reply' },
  { key: 'Sources Used', title: 'Sources', sub: 'Retrieved knowledge files for this turn' },
  { key: 'Missing Data', title: 'Gaps & limits', sub: 'Fields or context not in this dataset' }
];

const state = {
  snapshot: null,
  onchainSnapshot: null,
  index: null,
  systemPrompt: '',
  model: DEFAULT_COMPLETION_MODEL,
  /** OpenAI-compatible base (must end with `/v1`). Overridable via `?qvac=` in init. */
  qvacBaseUrl: QVAC_BASE_URL,
  lastChunks: [],
  /**
   * When true, `?shortcuts=0` skips chip catalog + intent presets (model answers everything).
   * Chips and intent both run by default so suggested questions never depend on QVAC headers.
   */
  deterministicShortcuts: USE_DETERMINISTIC_CHAT_SHORTCUTS,
  /** @type {{ role: 'user' | 'assistant', content: string }[]} */
  chatHistory: []
};

/** Restored after closing the knowledge source modal. */
let sourceModalLastFocus = null;

const suggestedQueries = [
  'How large are stablecoins compared with US M2 today?',
  'What does “1 in 71 dollars” mean?',
  'What is USDT?',
  'Which issuer has the largest share?',
  'Which chains hold the largest stablecoin supply?',
  'How far are stablecoins from 2 percent of US M2?',
  'What data is missing from this local snapshot?'
];

const advancedQueries = [
  'Compare Solana’s stablecoin share with the largest chain.',
  'Generate a factual prediction market question for stablecoins crossing 2 percent of US M2.',
  'Summarise the methodology using only local sources.',
  'Show the data used for this answer.'
];

function $(id) {
  return document.getElementById(id);
}

async function loadJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
  return response.json();
}

async function loadText(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
  return response.text();
}

function formatMaybe(value, formatter) {
  return value === null || value === undefined ? 'not available' : formatter(value);
}

function renderSnapshot() {
  const snapshot = state.snapshot;
  const summary = snapshotSummary(snapshot);
  const largestIssuer = summary.largest_issuer;
  const largestChain = summary.largest_chain;
  const solana = summary.solana_chain_share;

  $('dddValue').textContent = formatMaybe(snapshot.ddd_percent, (value) => `${Number(value).toFixed(4)}%`);
  $('oneInX').textContent = snapshot.one_in_x ? `1 in ${snapshot.one_in_x}` : 'not available';
  $('stablecoinSupply').textContent = formatCurrency(snapshot.stablecoin_market_cap_usd);
  $('m2Supply').textContent = formatCurrency(snapshot.us_m2_usd);
  $('datasetStatus').textContent = snapshot.dataset_status || 'unknown';
  $('lastUpdated').textContent = snapshot.last_updated || 'not available';
  $('largestIssuer').textContent = largestIssuer
    ? `${largestIssuer.name} (${formatPercent(largestIssuer.share_percent)})`
    : 'not available';
  $('largestChain').textContent = largestChain
    ? `${largestChain.name} (${formatPercent(largestChain.share_percent)})`
    : 'not available';
  $('solanaShare').textContent = solana
    ? `${formatPercent(solana.share_percent)} (${formatCurrency(solana.stablecoin_supply_usd)})`
    : 'not available in the current local dataset';
}

function renderQueries() {
  const wrap = $('suggestedQueries');
  const advancedWrap = $('advancedQueries');
  const catalogWrap = $('queryCatalog');
  const input = $('queryInput');
  wrap.innerHTML = '';
  advancedWrap.innerHTML = '';
  if (catalogWrap) {
    catalogWrap.innerHTML = '';
    EXAMPLE_CATALOG_QUESTIONS.forEach((query) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'query-chip advanced';
      button.textContent = query;
      button.addEventListener('click', () => {
        input.value = query;
        input.focus();
      });
      catalogWrap.appendChild(button);
    });
  }
  suggestedQueries.forEach((query) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'query-chip';
    button.textContent = query;
    button.addEventListener('click', () => {
      input.value = query;
      input.focus();
    });
    wrap.appendChild(button);
  });
  advancedQueries.forEach((query) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'query-chip advanced';
    button.textContent = query;
    button.addEventListener('click', () => {
      input.value = query;
      input.focus();
    });
    advancedWrap.appendChild(button);
  });
  try {
    const saved = sessionStorage.getItem(QUERY_STORAGE_KEY);
    if (saved) input.value = saved;
  } catch {
    /* private mode */
  }
}

function renderSources(chunks) {
  state.lastChunks = chunks;
  $('retrievalMode').textContent = state.index?.retrieval_mode || 'local_keyword';
  $('retrievedCount').textContent = String(chunks.length);
  $('sourcesList').innerHTML = chunks.length
    ? `<div class="source-grid">${chunks
        .map((chunk, i) => {
          const flat = String(chunk.text || '')
            .replace(/\s+/g, ' ')
            .trim();
          const snip = escapeHtml(flat.slice(0, 140));
          const more = flat.length > 140 ? '…' : '';
          return `<button type="button" class="source-tile" data-source-index="${i}" aria-haspopup="dialog" aria-controls="sourceModalShell">
          <span class="source-tile__rank">${i + 1}</span>
          <span class="source-tile__title">${escapeHtml(chunk.title)}</span>
          <span class="source-tile__file">${escapeHtml(chunk.source_file)}</span>
          <span class="source-tile__snippet">${snip}${more}</span>
          <span class="source-tile__cta">Read full file</span>
        </button>`;
        })
        .join('')}</div>`
    : '<p class="muted">No local knowledge chunks retrieved.</p>';
}

/**
 * Scroll the thread only as much as needed to show `node` (no jump to absolute bottom).
 * User bubbles intentionally do not auto-scroll so sending a question does not yank the view.
 */
function scrollChatNodeIntoView(node, { block = 'nearest' } = {}) {
  if (!node || typeof node.scrollIntoView !== 'function') return;
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  requestAnimationFrame(() => {
    try {
      node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block, inline: 'nearest' });
    } catch {
      node.scrollIntoView();
    }
  });
}

function priorAssistantSummary() {
  for (let i = state.chatHistory.length - 1; i >= 0; i -= 1) {
    if (state.chatHistory[i].role === 'assistant') return state.chatHistory[i].content;
  }
  return '';
}

/** Stops header-only model echoes from being replayed into QVAC as fake assistant turns. */
function sanitizeAssistantHistoryForApi(history) {
  return (Array.isArray(history) ? history : []).map((turn) => {
    if (!turn || turn.role !== 'assistant') return turn;
    const c = String(turn.content || '').trim();
    if (!c) {
      return { ...turn, content: '(Prior assistant message had no text.)' };
    }
    if (isSchemaHeaderOnlyEcho(c) || normalizedAnswerIsSchemaShell(c)) {
      return {
        ...turn,
        content:
          '(Prior assistant reply omitted: it was only empty section headers. Ask again if you need that answer.)'
      };
    }
    return turn;
  });
}

function pushChatHistory(userQuery, assistantFullText) {
  state.chatHistory.push(
    { role: 'user', content: String(userQuery || '').slice(0, 2400) },
    { role: 'assistant', content: compactAssistantForHistory(assistantFullText, 1200) }
  );
  while (state.chatHistory.length > MAX_CHAT_HISTORY_MESSAGES) {
    state.chatHistory.splice(0, 2);
  }
}

function renderChatWelcome() {
  const thread = $('chatThread');
  if (!thread) return;
  thread.innerHTML = `<div class="chat-msg chat-msg--assistant chat-msg--welcome chat-msg-enter">
    <div class="chat-msg-body">
      <p class="welcome-lead">You are in a <strong>local chat</strong> with DDD Intelligence.</p>
      <p class="muted">Ask anything about the frozen snapshot, M2, issuers, chains, or the Solana oracle reference file. I will answer in short sections so you can skim, then you can reply naturally and I will keep context from this thread when QVAC is running.</p>
    </div>
  </div>`;
}

function appendChatUser(text) {
  const thread = $('chatThread');
  if (!thread) return;
  thread.querySelectorAll('.chat-msg--welcome').forEach((n) => n.remove());
  thread.insertAdjacentHTML(
    'beforeend',
    `<div class="chat-msg chat-msg--user chat-msg-enter"><div class="chat-msg-body"><p>${escapeHtml(text)}</p></div></div>`
  );
}

function removePendingAssistant() {
  $('chatThread')?.querySelectorAll('.chat-msg--pending').forEach((n) => n.remove());
}

function showAssistantPending(label = 'Working on your answer…') {
  removePendingAssistant();
  const thread = $('chatThread');
  if (!thread) return;
  thread.insertAdjacentHTML(
    'beforeend',
    `<div class="chat-msg chat-msg--assistant chat-msg--pending chat-msg-enter"><div class="chat-msg-aside" aria-hidden="true"><span class="chat-avatar chat-avatar--pulse">⋯</span></div><div class="chat-msg-body"><div class="chat-typing" aria-hidden="true"><span></span><span></span><span></span></div><p class="pending-label muted">${escapeHtml(label)}</p></div></div>`
  );
  scrollChatNodeIntoView(thread.lastElementChild, { block: 'nearest' });
}

/**
 * After a new assistant message is inserted, bring the answer panel (lead section)
 * into view instead of forcing the thread to the absolute bottom.
 */
function scrollToLatestAssistantAnswer(thread, msgEl) {
  if (!msgEl || !thread) return;
  const panel = msgEl.querySelector('.answer-panel');
  if (!panel) {
    scrollChatNodeIntoView(msgEl, { block: 'start' });
    return;
  }
  const lead = panel.querySelector('.answer-section--lead');
  const fallback = panel.querySelector('.answer-panel--fallback');
  const target = lead || fallback || panel;
  scrollChatNodeIntoView(target, { block: 'start' });
}

function appendAssistantPanelHtml(innerHtml) {
  const thread = $('chatThread');
  if (!thread) return;
  thread.insertAdjacentHTML(
    'beforeend',
    `<div class="chat-msg chat-msg--assistant chat-msg-enter"><div class="chat-msg-aside" aria-hidden="true"><span class="chat-avatar" title="DDD Intelligence">DDD</span></div><div class="chat-msg-body">${innerHtml}</div></div>`
  );
  const last = thread.lastElementChild;
  requestAnimationFrame(() => {
    scrollToLatestAssistantAnswer(thread, last);
  });
}

function renderProof({ latencyMs = null, status = 'ready', model = state.model } = {}) {
  $('qvacStatus').textContent = status;
  $('runtimeMode').textContent = 'Local QVAC HTTP server';
  $('modelName').textContent = model;
  $('localhostEndpoint').textContent = `${state.qvacBaseUrl}/chat/completions`;
  $('networkStatus').textContent = 'This page only talks to your machine (QVAC on 127.0.0.1). No cloud LLM and no browser calls to Solana or other external APIs.';
  $('latency').textContent = latencyMs === null ? 'not run yet' : `${latencyMs} ms`;
  $('proofDatasetTimestamp').textContent = state.snapshot?.last_updated || 'not available';
  $('solanaProgram').textContent = state.onchainSnapshot?.solana_program_id || 'not available';
}

/**
 * Never show an empty assistant bubble after QVAC/guardrails (snapshot-grounded fallback only).
 */
function finalizeAssistantText(display, chunksForFallback = []) {
  const trimmed = String(display || '').trim();
  if (trimmed) return display;
  return buildMisunderstoodAnswer({
    snapshot: state.snapshot,
    chunks: chunksForFallback,
    lead: 'No renderable answer text was produced for this turn.'
  });
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function intelligenceDocBaseDir() {
  const p = window.location.pathname || '/';
  const marker = '/intelligence';
  const i = p.indexOf(marker);
  if (i === -1) {
    const path = p.endsWith('/') ? p : p.replace(/[^/]+$/, '');
    return path.endsWith('/') ? path : `${path}/`;
  }
  const after = p.slice(i + marker.length);
  if (after === '' || after === '/') return `${marker}/`;
  return `${marker}/`;
}

function resolveKnowledgeFetchUrl(sourceFile) {
  const rel = String(sourceFile || '').replace(/^\/+/, '');
  if (!rel) return '';
  const baseDir = intelligenceDocBaseDir();
  return new URL(rel, `${window.location.origin}${baseDir}`).href;
}

function onSourceModalEscape(ev) {
  if (ev.key === 'Escape') closeSourceModal();
}

function closeSourceModal() {
  const overlay = $('sourceModalOverlay');
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  document.removeEventListener('keydown', onSourceModalEscape);
  document.body.style.overflow = '';
  if (sourceModalLastFocus && typeof sourceModalLastFocus.focus === 'function') {
    try {
      sourceModalLastFocus.focus();
    } catch {
      /* ignore */
    }
  }
  sourceModalLastFocus = null;
}

async function openSourceModal(index) {
  const chunk = state.lastChunks[index];
  if (!chunk) return;
  const overlay = $('sourceModalOverlay');
  const title = $('sourceModalTitle');
  const pathEl = $('sourceModalPath');
  const body = $('sourceModalBody');
  if (!overlay || !title || !pathEl || !body) return;

  sourceModalLastFocus = document.activeElement;
  title.textContent = chunk.title;
  pathEl.textContent = chunk.source_file;
  body.innerHTML = `<p class="source-modal-status">Loading full markdown from the repo…</p><pre>${escapeHtml(chunk.text)}</pre>`;
  overlay.hidden = false;
  document.addEventListener('keydown', onSourceModalEscape);
  document.body.style.overflow = 'hidden';
  $('sourceModalOverlay')?.querySelector('.source-modal-x')?.focus();

  const url = resolveKnowledgeFetchUrl(chunk.source_file);
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) {
      const full = await res.text();
      body.innerHTML = `<p class="source-modal-status">Full file loaded (${full.length.toLocaleString()} characters).</p><pre>${escapeHtml(full)}</pre>`;
    } else {
      body.innerHTML = `<p class="source-modal-status">Could not fetch file (HTTP ${res.status}). Retrieved chunk text is below.</p><pre>${escapeHtml(chunk.text)}</pre>`;
    }
  } catch (err) {
    const msg = escapeHtml((err && err.message) || String(err));
    body.innerHTML = `<p class="source-modal-status">Fetch failed (${msg}). Retrieved chunk text is below.</p><pre>${escapeHtml(chunk.text)}</pre>`;
  }
}

function initSourceModal() {
  const overlay = $('sourceModalOverlay');
  if (!overlay) return;
  overlay.addEventListener('click', (e) => {
    const el = e.target;
    if (el instanceof HTMLElement && el.closest('[data-modal-dismiss]')) {
      closeSourceModal();
    }
  });
  const list = $('sourcesList');
  if (!list) return;
  list.addEventListener('click', (e) => {
    const el = e.target;
    const btn = el instanceof Element ? el.closest('.source-tile[data-source-index]') : null;
    if (!btn || !(btn instanceof HTMLElement)) return;
    const idx = Number(btn.dataset.sourceIndex);
    if (!Number.isFinite(idx)) return;
    void openSourceModal(idx);
  });
}

/** Builds the inner HTML for one assistant reply (panel wrapper included). */
function buildAnswerPanelHtml(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) {
    return '<div class="answer-panel"><p class="muted">No response text.</p></div>';
  }
  const parsed = parseFourSectionAnswer(trimmed);
  if (!hasParsedAnswerStructure(parsed)) {
    return `<div class="answer-panel answer-panel--fallback"><pre class="answer-inline" tabindex="0">${escapeHtml(trimmed)}</pre></div>`;
  }
  const sid = ++answerSectionIdSeq;
  const sections = ANSWER_SECTION_UI.map((meta, i) => {
    const rawBody = stripDisplayInnoculation(parsed[meta.key].join('\n')).trim();
    const body = polishFourSectionBody(meta.key, rawBody) || '—';
    const inner = formatAnswerBodyHtml(body);
    const mod = i === 0 ? ' answer-section--lead' : '';
    const aid = `ans-${sid}-${i}`;
    const subBlock = meta.sub ? `<p class="answer-section-sub">${escapeHtml(meta.sub)}</p>` : '';
    return `<section class="answer-section${mod}" aria-labelledby="${aid}">
      <header class="answer-section-head">
        <h3 id="${aid}"><span class="sr-only">${escapeHtml(meta.key)}: </span>${escapeHtml(meta.title)}</h3>
        ${subBlock}
      </header>
      <div class="answer-section-body">${inner}</div>
    </section>`;
  }).join('');
  return `<div class="answer-panel">${sections}</div>`;
}

/**
 * Belt-and-suspenders greeting detector in UI layer.
 * If the helper misses, this still catches very common openers.
 */
function isGreetingFallback(query) {
  const q = String(query || '').toLowerCase().replace(/[\u2018\u2019\u201c\u201d]/g, "'").trim();
  if (!q) return false;
  const normalized = q.replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const hasDomainTerms = /\b(ddd|stablecoin|stablecoins|m2|issuer|issuers|chain|chains|solana|methodology|oracle|prediction|snapshot)\b/.test(normalized);
  if (hasDomainTerms) return false;
  return /^(hi|hello|hey|howdy|yo)\b(?:\s+(there|everyone|all|team))?(?:\s+(how are you|how are you doing|how are you doing today|how r u|hru))?$/.test(normalized)
    || /^(how are you|how are you doing|how are you doing today|how r u|hru)$/.test(normalized);
}

/** After escapeHtml: wrap dollar amounts and simple percentages for quick scanning. */
function highlightStatsInEscaped(html) {
  return String(html || '')
    .replace(/(\$[\d,]+(?:\.\d+)?)\b/g, '<span class="answer-stat">$1</span>')
    .replace(/(\b\d+(?:,\d{3})*(?:\.\d+)?%)/g, '<span class="answer-stat">$1</span>');
}

/** Turn `- item` blocks into lists; otherwise paragraphs with line breaks. */
function formatAnswerBodyHtml(body) {
  const cleaned = stripDisplayInnoculation(String(body || ''));
  const blocks = cleaned.trim().split(/\n\n+/).filter(Boolean);
  const html = blocks.map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2 && lines.every((l) => /^[-•]\s/.test(l))) {
      const items = lines
        .map((l) => l.replace(/^[-•]\s+/, ''))
        .map((text) => `<li>${highlightStatsInEscaped(escapeHtml(text))}</li>`)
        .join('');
      return `<ul class="answer-list">${items}</ul>`;
    }
    const withBreaks = highlightStatsInEscaped(escapeHtml(block)).replaceAll('\n', '<br>');
    return `<p>${withBreaks}</p>`;
  }).join('');
  if (!html.trim()) {
    return '<p class="muted">No visible text in this section.</p>';
  }
  return html;
}

async function handleSubmit(event) {
  event.preventDefault();
  let query = $('queryInput').value.trim();
  if (!query) return;
  if (query.length > MAX_QUERY_CHARS) {
    query = query.slice(0, MAX_QUERY_CHARS);
    $('queryInput').value = query;
  }

  const submitBtn = $('queryForm').querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  let chunks = [];
  const sentQuery = query;
  $('queryInput').dataset._lastSent = sentQuery;

  appendChatUser(sentQuery);
  $('queryInput').value = '';
  showAssistantPending('Retrieving local notes and running QVAC if needed…');
  $('voiceWarning').hidden = true;
  renderProof({ status: 'checking local QVAC runtime' });

  try {
    try {
      sessionStorage.setItem(QUERY_STORAGE_KEY, sentQuery);
    } catch {
      /* private mode */
    }

    chunks = retrieveChunks(sentQuery, state.index, { limit: 10 });
    renderSources(chunks);

    if (isCasualChatQuery(sentQuery) || isGreetingFallback(sentQuery)) {
      const display = finalizeAssistantText(
        buildCasualChatResponse({
          chunks,
          priorAssistantSummary: priorAssistantSummary()
        }),
        chunks
      );
      removePendingAssistant();
      appendAssistantPanelHtml(buildAnswerPanelHtml(display));
      pushChatHistory(sentQuery, display);
      renderProof({ latencyMs: null, status: 'greeting (no model run)', model: state.model });
      return;
    }

    if (state.deterministicShortcuts) {
      const chipAnswer = tryBuildChipAnswer({
        query: sentQuery,
        snapshot: state.snapshot,
        chunks
      });
      if (chipAnswer) {
        const display = finalizeAssistantText(chipAnswer, chunks);
        removePendingAssistant();
        appendAssistantPanelHtml(buildAnswerPanelHtml(display));
        pushChatHistory(sentQuery, display);
        renderProof({
          latencyMs: null,
          status: 'catalog answer (local preset; no model)',
          model: state.model
        });
        return;
      }

      const intentAnswer = tryBuildIntentAnswer({
        query: sentQuery,
        snapshot: state.snapshot,
        onchainSnapshot: state.onchainSnapshot,
        chunks
      });
      if (intentAnswer) {
        const display = finalizeAssistantText(intentAnswer, chunks);
        removePendingAssistant();
        appendAssistantPanelHtml(buildAnswerPanelHtml(display));
        pushChatHistory(sentQuery, display);
        renderProof({
          latencyMs: null,
          status: 'local intent answer (grounded pattern; no model)',
          model: state.model
        });
        return;
      }
    }

    try {
      const models = await listModels({ baseUrl: state.qvacBaseUrl });
      const picked = pickResolvedModel(models, state.model, FALLBACK_COMPLETION_MODEL);
      if (picked.model !== state.model) {
        state.model = picked.model;
      }
      if (picked.note) {
        $('voiceWarning').hidden = false;
        $('voiceWarning').textContent = picked.note;
      }
    } catch (err) {
      const msg = err?.message || String(err);
      $('voiceWarning').hidden = false;
      $('voiceWarning').textContent = `Could not reach ${state.qvacBaseUrl}/models (${msg}). Trying chat with "${state.model}" anyway—if this fails, run QVAC or Ollama on 127.0.0.1:11434 or set ?qvac=http://127.0.0.1:PORT/v1`;
    }

    const messages = buildMessages({
      query: sentQuery,
      snapshot: state.snapshot,
      onchainSnapshot: state.onchainSnapshot,
      chunks,
      systemPrompt: state.systemPrompt,
      chatHistory: sanitizeAssistantHistoryForApi(state.chatHistory)
    });
    const result = await chatCompletion({ messages, model: state.model, baseUrl: state.qvacBaseUrl });
    const raw = sanitizeLocalModelReply((result.answer || '').trim());

    let display;
    let proofStatus = 'local QVAC response received';
    if (!raw) {
      display = buildMisunderstoodAnswer({
        snapshot: state.snapshot,
        chunks,
        lead: 'The local model did not return usable text for that question.'
      });
      proofStatus = 'no model text returned';
    } else {
      let displayReady = normalizeModelFourSectionAnswer(raw, { snapshot: state.snapshot, chunks });
      const salvage = buildIssuerVersusFromQueryAnswer(sentQuery, state.snapshot, chunks);
      const shellRaw = isSchemaHeaderOnlyEcho(raw);
      const shellNorm = normalizedAnswerIsSchemaShell(displayReady);
      if (salvage && (shellRaw || shellNorm)) {
        displayReady = salvage;
        proofStatus = 'local QVAC + issuer table (model echoed empty headers only)';
      } else if (shellRaw || shellNorm) {
        const evaluation = evaluateAnswerGuardrails(displayReady, state.snapshot, {
          supplementals: [state.onchainSnapshot].filter(Boolean)
        });
        evaluation.issues.push('Answer format: model returned section labels only.');
        display = buildGuardrailFallbackAnswer({
          snapshot: state.snapshot,
          chunks,
          evaluation
        });
        proofStatus = 'local QVAC response had no usable text; snapshot fallback shown';
      } else {
        display = displayReady;
      }
    }

    display = finalizeAssistantText(display, chunks);
    removePendingAssistant();
    appendAssistantPanelHtml(buildAnswerPanelHtml(display));
    pushChatHistory(sentQuery, display);
    renderProof({ latencyMs: result.latencyMs, status: proofStatus, model: result.model || state.model });
  } catch (error) {
    const display = finalizeAssistantText(
      buildMisunderstoodAnswer({
        snapshot: state.snapshot,
        chunks,
        lead: `Local QVAC completion is unavailable (${error.message}), so no model answer could be generated.`
      }),
      chunks
    );
    removePendingAssistant();
    appendAssistantPanelHtml(buildAnswerPanelHtml(display));
    pushChatHistory(sentQuery, display);
    renderProof({ status: `QVAC unavailable: ${error.message}` });
  } finally {
    submitBtn.disabled = false;
    delete $('queryInput').dataset._lastSent;
  }
}

async function init() {
  [state.snapshot, state.onchainSnapshot, state.index, state.systemPrompt] = await Promise.all([
    loadJson('data/ddd-current.snapshot.json'),
    loadJson('data/ddd-onchain.snapshot.json'),
    loadJson('index/knowledge-index.json'),
    loadText('prompts/system.md')
  ]);

  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.has('shortcuts')) {
      state.deterministicShortcuts = sp.get('shortcuts') !== '0';
    } else {
      state.deterministicShortcuts = true;
    }
    const qvacOverride = sp.get('qvac');
    if (qvacOverride) {
      const raw = decodeURIComponent(qvacOverride.trim());
      const u = new URL(raw);
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
        let base = `${u.protocol}//${u.host}`;
        const p = (u.pathname || '').replace(/\/+$/, '');
        base = p && p !== '/' ? `${base}${p.startsWith('/') ? '' : '/'}${p}` : base;
        if (!/\/v1$/i.test(base)) base = `${base}/v1`;
        state.qvacBaseUrl = base.replace(/\/+$/, '');
      }
    }
  } catch {
    /* non-browser or bad ?qvac= */
  }

  renderSnapshot();
  renderQueries();
  renderSources([]);
  renderProof();
  renderChatWelcome();
  initSourceModal();
  $('clearChatBtn')?.addEventListener('click', () => {
    state.chatHistory = [];
    $('voiceWarning').hidden = true;
    renderChatWelcome();
  });
  $('queryForm').addEventListener('submit', (e) => {
    void handleSubmit(e).catch((err) => {
      const msg = err?.message || String(err);
      const chunks = state.lastChunks || [];
      let lastQ = '';
      try {
        lastQ = sessionStorage.getItem(QUERY_STORAGE_KEY) || '';
      } catch {
        /* private mode */
      }
      const display = finalizeAssistantText(
        buildMisunderstoodAnswer({
          snapshot: state.snapshot,
          chunks,
          lead: `The page hit an unexpected error while handling your question: ${msg}`
        }),
        chunks
      );
      removePendingAssistant();
      appendAssistantPanelHtml(buildAnswerPanelHtml(display));
      try {
        if (lastQ) pushChatHistory(lastQ, display);
      } catch {
        /* private mode */
      }
      renderProof({ status: `UI error: ${msg}` });
      const btn = $('queryForm').querySelector('button[type="submit"]');
      if (btn) btn.disabled = false;
    });
  });
}

init().catch((error) => {
  const thread = $('chatThread');
  const html = `<div class="answer-panel answer-panel--plain"><p class="muted" style="margin:0">${escapeHtml(`Initialization failed: ${error.message}`)}</p></div>`;
  if (thread) {
    thread.innerHTML = `<div class="chat-msg chat-msg--assistant chat-msg-enter"><div class="chat-msg-aside" aria-hidden="true"><span class="chat-avatar" title="DDD Intelligence">DDD</span></div><div class="chat-msg-body">${html}</div></div>`;
  }
  renderProof({ status: 'initialization failed' });
});
