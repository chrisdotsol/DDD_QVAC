export const QVAC_BASE_URL = 'http://127.0.0.1:11434/v1';
/** Primary chat alias in qvac.config.json (HF GGUF via https://…; registry://hf/… only matches QVAC’s indexed catalog). */
export const DEFAULT_COMPLETION_MODEL = 'ddd-r1-qwen';
/** Secondary alias if the primary model is not registered on the local QVAC server. */
export const FALLBACK_COMPLETION_MODEL = 'ddd-qwen';
export const DEFAULT_EMBEDDING_MODEL = 'ddd-embed';

/**
 * Initial preset mode: chip catalog + intent patterns answer locally before QVAC.
 * Override in the URL with `?shortcuts=0` (model only) or `?shortcuts=1` (same as default).
 */
export const USE_DETERMINISTIC_CHAT_SHORTCUTS = true;

export const PROHIBITED_TERMS = [
  'investment advice',
  'bullish',
  'bearish',
  'accelerating',
  'inevitable',
  'should buy',
  'should sell',
  'recommend buying',
  'recommend selling',
  'not financial advice',
  'guaranteed returns',
  'risk free',
  'risk-free',
  'moon',
  'nfa',
  'dyor'
];

export const FIXED_DEMO_QUERY = [
  'Using only the current local snapshot, show how large stablecoins are compared with US M2,',
  'identify the largest issuer, identify the largest chain, show Solana’s share,',
  'and list any missing data.'
].join(' ');
