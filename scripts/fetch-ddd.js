// scripts/fetch-ddd.js - DEBUG VERSION
import { Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID = new PublicKey('AbjVyP3WaY9yMG8AT8vNcLHcNoFkT5dwT94SPQ8kddd');
const RPC_URL = 'https://newest-wider-research.solana-mainnet.quiknode.pro/ff067ebc5d00daa5f59a9c23d03f098a880eec3f/';

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');

  const seedCombinations = [
    ["oracle", "chains", "issuers", "tokens"],
    ["oracle", "data"],
    ["ddd", "oracle"],
    ["oracle"],
    ["ddd", "snapshot"]
  ];

  console.log('🔍 Trying different PDA seeds...');

  for (const seeds of seedCombinations) {
    const [pda] = await PublicKey.findProgramAddress(
      seeds.map(s => Buffer.from(s)),
      PROGRAM_ID
    );
    
    console.log(`Testing seeds [${seeds.join(', ')}] → ${pda.toBase58()}`);

    const info = await connection.getAccountInfo(pda);
    if (info) {
      console.log('✅ FOUND! Data size:', info.data.length);
      console.log('Use this seed combination.');
      return;
    }
  }

  console.log('❌ No PDA found with common seeds.');
  console.log('The oracle account may not be initialized yet on mainnet.');
}

main().catch(console.error);
