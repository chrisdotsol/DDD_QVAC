import { DEFAULT_COMPLETION_MODEL, DEFAULT_EMBEDDING_MODEL, FALLBACK_COMPLETION_MODEL, QVAC_BASE_URL } from './config.js';

const LOCALHOST_PATTERN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;

export function assertLocalUrl(url) {
  if (!LOCALHOST_PATTERN.test(url)) {
    throw new Error(`Refusing non-local QVAC endpoint: ${url}`);
  }
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return fetchImpl(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`QVAC request timed out after ${timeoutMs} ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function listModels({ baseUrl = QVAC_BASE_URL, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const url = `${baseUrl}/models`;
  assertLocalUrl(url);
  const response = await fetchWithTimeout(fetchImpl, url, undefined, timeoutMs);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`QVAC models request failed: HTTP ${response.status} ${body.slice(0, 200)}`);
  }
  return response.json();
}

/** Common Ollama model ids when QVAC aliases (e.g. ddd-r1-qwen) are not registered. */
const PUBLIC_LOCAL_MODEL_FALLBACKS = [
  'llama3.2:latest',
  'llama3.2',
  'llama3.1:latest',
  'llama3.1',
  'mistral:latest',
  'mistral',
  'qwen2.5:latest',
  'qwen2.5',
  'phi3:latest',
  'phi3',
  'gemma2:2b',
  'gemma2',
  'tinyllama:latest',
  'tinyllama'
];

/**
 * Pick a model id that exists on the server. Used so Ollama users are not stuck on unknown DDD aliases.
 */
export function pickResolvedModel(modelsResponse, preferred, secondary) {
  const ids = (modelsResponse?.data || [])
    .map((m) => m?.id)
    .filter(Boolean);
  if (!ids.length) {
    return { model: preferred, note: null, listedIds: ids };
  }
  if (ids.includes(preferred)) {
    return { model: preferred, note: null, listedIds: ids };
  }
  if (secondary && ids.includes(secondary)) {
    return {
      model: secondary,
      note: `Primary model "${preferred}" is not listed; using "${secondary}".`,
      listedIds: ids
    };
  }
  for (const id of PUBLIC_LOCAL_MODEL_FALLBACKS) {
    if (ids.includes(id)) {
      return {
        model: id,
        note: `"${preferred}" is not listed; using "${id}" from your local server.`,
        listedIds: ids
      };
    }
  }
  const first = ids[0];
  return {
    model: first,
    note: `"${preferred}" is not listed; using first listed model "${first}".`,
    listedIds: ids
  };
}

async function chatCompletionOnce({
  messages,
  model,
  baseUrl,
  maxTokens,
  temperature,
  fetchImpl,
  timeoutMs
}) {
  const url = `${baseUrl}/chat/completions`;
  assertLocalUrl(url);

  const startedAt = performance.now();
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      seed: 7
    })
  }, timeoutMs);
  const latencyMs = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const err = new Error(`QVAC completion failed: HTTP ${response.status} ${body}`);
    err.status = response.status;
    throw err;
  }

  const ct = (response.headers.get('content-type') || '').toLowerCase();
  if (ct && !/(json|ndjson|javascript)/i.test(ct)) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `QVAC returned non-JSON (${ct}). Is this the OpenAI-compatible /v1/chat/completions endpoint? First bytes: ${body.slice(0, 120)}`
    );
  }

  const data = await response.json();
  const answer = stripThinking(extractAssistantMessageText(data));
  return { answer, data, latencyMs, model };
}

/**
 * Normalise OpenAI-compatible responses (string content, or Ollama-style content parts array).
 */
export function extractAssistantMessageText(data) {
  const choice = data?.choices?.[0];
  if (!choice) return '';
  const msg = choice.message ?? choice.delta;
  if (!msg) return '';

  const c = msg.content;
  if (typeof c === 'string') return c;
  if (c == null) {
    if (typeof msg.refusal === 'string') return msg.refusal;
    return '';
  }
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text' && part.text != null) return String(part.text);
        if (part?.text != null) return String(part.text);
        return '';
      })
      .join('');
  }
  if (typeof c === 'object' && c != null && typeof c.text === 'string') return c.text;
  return '';
}

export async function chatCompletion({
  messages,
  model = DEFAULT_COMPLETION_MODEL,
  fallbackModel = FALLBACK_COMPLETION_MODEL,
  baseUrl = QVAC_BASE_URL,
  maxTokens = 1280,
  temperature = 0,
  fetchImpl = fetch,
  timeoutMs = 90000
}) {
  if (!model) throw new Error('QVAC chat completion requires an explicit model alias.');
  const opts = { messages, baseUrl, maxTokens, temperature, fetchImpl, timeoutMs };
  try {
    return await chatCompletionOnce({ ...opts, model });
  } catch (first) {
    const msg = String(first?.message || '');
    const canRetry = fallbackModel && fallbackModel !== model && (
      first?.status === 404
      || first?.status === 400
      || /unknown model|model not found|invalid model|no such model|model\s+['"]?[^'"]+['"]?\s+not found|does not exist/i.test(
        msg
      )
    );
    if (canRetry) {
      return await chatCompletionOnce({ ...opts, model: fallbackModel });
    }
    throw first;
  }
}

export function stripThinking(text) {
  let s = String(text || '');
  // `think` / `redacted_thinking` open+close pairs (models disagree on which tags they emit).
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '');
  s = s.replace(/<redacted_thinking>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/gi, '');
  s = s.replace(/<\|redacted_thinking\|>[\s\S]*?<\/\|redacted_thinking\|>/gi, '');
  s = s.replace(/<\|redacted_thinking\|>[\s\S]*?<\/redacted_thinking>/gi, '');
  s = s.replace(/<\|redacted_thinking\|>[\s\S]*?<\/think>/gi, '');
  // Unterminated thinking (strip remainder)
  s = s.replace(/<think>[\s\S]*$/i, '');
  s = s.replace(/<redacted_thinking>[\s\S]*$/i, '');
  s = s.replace(/<\|redacted_thinking\|>[\s\S]*$/i, '');
  return s.trim();
}

export async function createEmbedding({
  input,
  model = DEFAULT_EMBEDDING_MODEL,
  baseUrl = QVAC_BASE_URL,
  fetchImpl = fetch,
  timeoutMs = 30000
}) {
  if (!model) throw new Error('QVAC embedding requires an explicit model alias.');
  const url = `${baseUrl}/embeddings`;
  assertLocalUrl(url);

  const response = await fetchWithTimeout(fetchImpl, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input })
  }, timeoutMs);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`QVAC embedding failed: HTTP ${response.status} ${body}`);
  }

  const data = await response.json();
  return data?.data?.map((item) => item.embedding) || [];
}
