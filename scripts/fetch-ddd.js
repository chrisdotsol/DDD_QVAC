// scripts/fetch-ddd.js — refresh local JSON under data/ from Solana RPC (optional oracle account read).
import { Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PROGRAM_ID = new PublicKey('AbjVyP3WaY9yMG8AT8vNcLHcNoFkT5dwT94SPQ8kddd');

/** Prefer SOLANA_RPC_URL (GitHub Actions secret). Public RPC fallback is rate-limited. */
const RPC_URL =
  process.env.SOLANA_RPC_URL?.trim() || 'https://newest-wider-research.solana-mainnet.quiknode.pro/ff067ebc5d00daa5f59a9c23d03f098a880eec3f/';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_INTEL_ROOT = path.resolve(__dirname, '..');
const dataDir = path.join(REPO_INTEL_ROOT, 'data');

/**
 * Seed sets to try, in order. Canonical for this repo matches snapshot-builder / knowledge docs.
 * @type {string[][]}
 */
const SEED_CANDIDATES = [
  ['oracle', 'chains', 'issuers', 'tokens'],
  ['oracle', 'data'],
  ['oracle'],
  ['ddd', 'oracle'],
  ['oracle', 'chains'],
  ['ddd', 'snapshot']
];

async function findOracleAccount(connection) {
  for (const seeds of SEED_CANDIDATES) {
    const [pda] = await PublicKey.findProgramAddress(
      seeds.map((s) => Buffer.from(s, 'utf8')),
      PROGRAM_ID
    );
    const info = await connection.getAccountInfo(pda);
    if (info) {
      return { pda, seeds, info };
    }
  }
  return null;
}

async function main() {
  if (!process.env.SOLANA_RPC_URL?.trim()) {
    console.warn(
      'Warning: SOLANA_RPC_URL is not set; using public mainnet RPC (rate-limited). Set a repo secret for CI.'
    );
  }

  console.log('Fetching DDD oracle account from Solana (if deployed)...');

  const connection = new Connection(RPC_URL, 'confirmed');

  const found = await findOracleAccount(connection);

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  let currentData = {};
  try {
    currentData = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'ddd-current.snapshot.json'), 'utf8')
    );
  } catch {
    console.log('No existing ddd-current.snapshot.json; starting from empty object.');
  }

  const now = new Date().toISOString();
  currentData.generated_at = now;
  currentData.last_updated = now;
  currentData.dataset_status = found ? 'live' : 'rpc_oracle_account_missing';

  const onchainData = {
    generated_at: now,
    dataset_status: found ? 'live' : 'rpc_oracle_account_missing',
    runtime_note: found
      ? 'Account read succeeded via GitHub Actions / local script.'
      : 'No matching oracle PDA was found on this cluster for any known seed list; snapshot JSON was still refreshed.',
    solana_program_id: PROGRAM_ID.toBase58(),
    cluster: 'mainnet-beta',
    oracle_model: 'DDD Oracle on Solana push oracle',
    pda_seeds: found ? found.seeds : ['oracle', 'chains', 'issuers', 'tokens'],
    read_status: found ? 'read_ok' : 'account_not_found',
    source_files: ['scripts/fetch-ddd.js'],
    rpc_endpoint_kind: process.env.SOLANA_RPC_URL?.trim() ? 'custom' : 'public_mainnet',
    ...(found && {
      oracle_pda: found.pda.toBase58(),
      account_lamports: found.info.lamports,
      account_data_len: found.info.data.length,
      owner: found.info.owner.toBase58()
    }),
    cached_values: {
      ddd_percent: currentData.ddd_percent,
      stablecoin_market_cap_usd: currentData.stablecoin_market_cap_usd,
      us_m2_usd: currentData.us_m2_usd,
      one_in_x: currentData.one_in_x,
      last_updated: currentData.last_updated
    }
  };

  fs.writeFileSync(
    path.join(dataDir, 'ddd-current.snapshot.json'),
    JSON.stringify(currentData, null, 2)
  );
  fs.writeFileSync(
    path.join(dataDir, 'ddd-onchain.snapshot.json'),
    JSON.stringify(onchainData, null, 2)
  );

  if (!found) {
    const tried = await Promise.all(
      SEED_CANDIDATES.map(async (seeds) => {
        const [pda] = await PublicKey.findProgramAddress(
          seeds.map((s) => Buffer.from(s, 'utf8')),
          PROGRAM_ID
        );
        return `${seeds.join('+')} -> ${pda.toBase58()}`;
      })
    );
    console.error('Oracle account not found for any known PDA seed set.');
    console.error('Tried PDAs:\n', tried.join('\n'));
    console.error(
      'If the program is not initialized on mainnet yet, this is expected. Commit still wrote JSON with read_status.'
    );
    if (process.env.FAIL_IF_ORACLE_MISSING === '1') {
      process.exit(1);
    }
    return;
  }

  console.log('Oracle PDA:', found.pda.toBase58());
  console.log('Seeds:', found.seeds.join(', '));
  console.log('Account data length:', found.info.data.length);
  console.log('Updated snapshots under', dataDir);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
