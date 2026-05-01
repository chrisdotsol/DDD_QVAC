import * as qvac from '@qvac/sdk';
import { DEFAULT_COMPLETION_MODEL, DEFAULT_EMBEDDING_MODEL, FALLBACK_COMPLETION_MODEL } from './config.js';

/** `null` = GGUF comes from qvac.config.json registry `src` (downloaded on first QVAC serve). */
const MODEL_CONSTANTS = {
  [DEFAULT_COMPLETION_MODEL]: null,
  [FALLBACK_COMPLETION_MODEL]: 'QWEN3_600M_INST_Q4',
  'ddd-llama': 'LLAMA_3_2_1B_INST_Q4_0',
  [DEFAULT_EMBEDDING_MODEL]: 'GTE_LARGE_FP16'
};

async function downloadModel(alias) {
  const constantName = MODEL_CONSTANTS[alias];
  if (constantName === null) {
    console.log(
      `${alias}: skip SDK download (explicit Hugging Face registry entry in qvac.config.json; QVAC fetches on first load).`
    );
    return;
  }
  const assetSrc = qvac[constantName];
  if (!assetSrc) {
    throw new Error(`QVAC SDK does not expose ${constantName}. Check installed @qvac/sdk version.`);
  }
  if (typeof qvac.downloadAsset !== 'function') {
    throw new Error('QVAC SDK does not expose downloadAsset(). Check installed @qvac/sdk version.');
  }

  console.log(`Downloading or verifying local QVAC model cache: ${alias} (${constantName})`);
  const startedAt = Date.now();
  await qvac.downloadAsset({
    assetSrc,
    onProgress(progress) {
      if (progress?.percentage !== undefined) {
        process.stdout.write(`\r${alias}: ${progress.percentage.toFixed(1)}%`);
      }
    }
  });
  process.stdout.write('\n');
  console.log(`Ready: ${alias} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

async function main() {
  const aliases = process.argv.slice(2);
  const requested = aliases.length
    ? aliases
    : [FALLBACK_COMPLETION_MODEL, 'ddd-llama', DEFAULT_EMBEDDING_MODEL];

  console.log('Preparing QVAC models for offline demo.');
  console.log('Internet is allowed for this setup step only. Offline demo starts after this completes.');
  for (const alias of requested) {
    if (!Object.prototype.hasOwnProperty.call(MODEL_CONSTANTS, alias)) {
      throw new Error(`Unknown model alias: ${alias}`);
    }
    await downloadModel(alias);
  }
  if (typeof qvac.close === 'function') {
    await qvac.close();
  }
  console.log('Model setup complete. You can now start QVAC with npm run qvac:serve.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
