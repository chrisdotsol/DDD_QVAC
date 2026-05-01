import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const intelligenceRoot = resolve(here, '..');
export const repoRoot = resolve(intelligenceRoot, '..');

export const paths = {
  snapshot: resolve(intelligenceRoot, 'data', 'ddd-current.snapshot.json'),
  onchainSnapshot: resolve(intelligenceRoot, 'data', 'ddd-onchain.snapshot.json'),
  knowledgeDir: resolve(intelligenceRoot, 'knowledge'),
  knowledgeIndex: resolve(intelligenceRoot, 'index', 'knowledge-index.json'),
  systemPrompt: resolve(intelligenceRoot, 'prompts', 'system.md'),
  queryTemplate: resolve(intelligenceRoot, 'prompts', 'query-template.md'),
  botFallback: resolve(repoRoot, 'bot', 'fallback.json'),
  botContext: resolve(repoRoot, 'bot', 'context.json'),
  botFeed: resolve(repoRoot, 'bot', 'feed.json'),
  issuersState: resolve(repoRoot, 'bot', 'issuers_state.json'),
  issuersConfig: resolve(repoRoot, 'bot', 'issuers_config.json'),
  chainRankHistory: resolve(repoRoot, 'bot', 'chain_rank_history.json'),
  methodologyHtml: resolve(repoRoot, 'methodology.html')
};
