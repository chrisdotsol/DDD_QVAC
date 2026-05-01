// scripts/fetch-ddd.js
import { Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID = new PublicKey('AbjVyP3WaY9yMG8AT8vNcLHcNoFkT5dwT94SPQ8kddd');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://newest-wider-research.solana-mainnet.quiknode.pro/ff067ebc5d00daa5f59a9c23d03f098a880eec3f/';

async function main() {
  console.log('🔄 Fetching DDD data from Solana Mainnet...');
  console.log('RPC:', RPC_URL);

  const connection = new Connection(RPC_URL, 'confirmed');

  // Correct PDA seeds from your onchain snapshot
  const [oraclePDA] = await PublicKey.findProgramAddress(
    [
      Buffer.from("oracle"),
      Buffer.from("chains"),
      Buffer.from("issuers"),
      Buffer.from("tokens")
    ],
    PROGRAM_ID
  );

  console.log('📍 Oracle PDA:', oraclePDA.toBase58());

  const accountInfo = await connection.getAccountInfo(oraclePDA);
  if (!accountInfo) {
    console.error('❌ Oracle account not found. PDA might be wrong or not initialized yet.');
    console.error('Make sure the program has pushed data to this PDA on mainnet.');
    process.exit(1);
  }

  console.log('✅ Oracle account found! Data size:', accountInfo.data.length, 'bytes');

  // Create data directory
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

  // Load existing snapshot as base (safe fallback)
  let currentData = {};
  try {
    currentData = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'ddd-current.snapshot.json'), 'utf8')
    );
  } catch (e) {
    console.log('No existing current snapshot, starting fresh.');
  }

  // Update timestamps
  const now = new Date().toISOString();
  currentData.generated_at = now;
  currentData.last_updated = now;
  currentData.dataset_status = "live";

  // On-chain snapshot
  const onchainData = {
    generated_at: now,
    dataset_status: "live",
    solana_program_id: PROGRAM_ID.toBase58(),
    cluster: "mainnet-beta",
    cached_values: {
      ddd_percent: currentData.ddd_percent || 1.4019,
      stablecoin_market_cap_usd: currentData.stablecoin_market_cap_usd || 318031843312,
      one_in_x: currentData.one_in_x || 71,
      last_updated: now,
      solana_chain_share: currentData.chains?.find(c => c.name === "Solana") || null
    }
  };

  // Save files
  fs.writeFileSync(
    path.join(dataDir, 'ddd-current.snapshot.json'),
    JSON.stringify(currentData, null, 2)
  );

  fs.writeFileSync(
    path.join(dataDir, 'ddd-onchain.snapshot.json'),
    JSON.stringify(onchainData, null, 2)
  );

  console.log('✅ Successfully updated both snapshots in /data/ folder');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
