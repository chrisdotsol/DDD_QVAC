// scripts/fetch-ddd.js
import { Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID = new PublicKey('AbjVyP3WaY9yMG8AT8vNcLHcNoFkT5dwT94SPQ8kddd');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://newest-wider-research.solana-mainnet.quiknode.pro/ff067ebc5d00daa5f59a9c23d03f098a880eec3f/';

async function main() {
  console.log('🔄 Fetching DDD data from Solana...');

  const connection = new Connection(RPC_URL, 'confirmed');

  // Example PDA (adjust seeds based on your program)
  const [oraclePDA] = await PublicKey.findProgramAddress(
    [Buffer.from("oracle"), Buffer.from("data")], // ← UPDATE THESE SEEDS
    PROGRAM_ID
  );

  console.log('Oracle PDA:', oraclePDA.toBase58());

  const accountInfo = await connection.getAccountInfo(oraclePDA);
  if (!accountInfo) {
    throw new Error('❌ Oracle account not found. Check PDA seeds.');
  }

  // TODO: Replace this with actual data parsing from your program
  // For now, we load the existing snapshot and update timestamp
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

  // Load current snapshot as base
  let currentData = {};
  try {
    currentData = JSON.parse(fs.readFileSync(path.join(dataDir, 'ddd-current.snapshot.json'), 'utf8'));
  } catch (e) {
    console.log('No existing snapshot found, creating new one.');
  }

  // Update with fresh timestamp
  currentData.generated_at = new Date().toISOString();
  currentData.last_updated = new Date().toISOString();
  currentData.dataset_status = "live";

  // Example: Update Solana chain share if you parse it
  // currentData.chains[2].stablecoin_supply_usd = ... parsed value

  const onchainData = {
    generated_at: new Date().toISOString(),
    dataset_status: "live",
    solana_program_id: PROGRAM_ID.toBase58(),
    cluster: "devnet", // change to "mainnet-beta" later
    cached_values: {
      ddd_percent: currentData.ddd_percent,
      stablecoin_market_cap_usd: currentData.stablecoin_market_cap_usd,
      one_in_x: currentData.one_in_x,
      last_updated: currentData.last_updated
    }
  };

  // Write files to data/
  fs.writeFileSync(
    path.join(dataDir, 'ddd-current.snapshot.json'),
    JSON.stringify(currentData, null, 2)
  );

  fs.writeFileSync(
    path.join(dataDir, 'ddd-onchain.snapshot.json'),
    JSON.stringify(onchainData, null, 2)
  );

  console.log('✅ Successfully updated snapshots in /data/ folder');
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
