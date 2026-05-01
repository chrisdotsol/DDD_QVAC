import { DEFAULT_EMBEDDING_MODEL } from './config.js';
import { createEmbedding, listModels } from './qvac-client.js';

async function main() {
  const input = 'stablecoin adoption compared with US M2';
  const models = await listModels();
  console.log('QVAC models endpoint responded.');
  console.log(JSON.stringify(models, null, 2));

  const startedAt = performance.now();
  const embeddings = await createEmbedding({
    input,
    model: process.env.QVAC_EMBED_MODEL || DEFAULT_EMBEDDING_MODEL
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  const vector = embeddings[0] || [];

  console.log('Embedding model:', process.env.QVAC_EMBED_MODEL || DEFAULT_EMBEDDING_MODEL);
  console.log('Input:', input);
  console.log('Vector length:', vector.length);
  console.log('Latency ms:', latencyMs);
  console.log('Status:', vector.length > 0 ? 'PASS' : 'FAIL');

  if (!vector.length) process.exit(1);
}

main().catch((error) => {
  console.error('QVAC embedding test failed:', error.message || error);
  process.exit(1);
});
