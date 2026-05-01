import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from './paths.js';

const DDD_SOLANA_PROGRAM_ID = 'AbjVyP3WaY9yMG8AT8vNcLHcNoFkT5dwT94SPQ8kddd';

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    return { ...fallback, __read_error: error.message };
  }
}

function toIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  return String(value);
}

function buildIssuers(issuersState, issuersConfig) {
  const issuers = Array.isArray(issuersState.issuers) ? issuersState.issuers : [];
  return issuers
    .map((issuer) => {
      const config = issuersConfig?.[issuer.symbol] || {};
      return {
        name: issuer.name || issuer.symbol || 'Unknown issuer',
        symbol: issuer.symbol || null,
        market_cap_usd: finiteOrNull(issuer.current_supply_usd),
        share_percent: finiteOrNull(issuer.ddd_contribution_share_pct),
        entity: issuer.entity || config.entity || null,
        backing_type: issuer.backing_type || config.backing_type || null,
        last_updated: toIsoDate(issuer.last_updated)
      };
    })
    .sort((a, b) => (b.market_cap_usd || 0) - (a.market_cap_usd || 0))
    .slice(0, 20);
}

function buildChains(chainRankHistory, issuersState) {
  const snapshots = Array.isArray(chainRankHistory.snapshots) ? chainRankHistory.snapshots : [];
  const latest = snapshots[snapshots.length - 1] || null;
  const sourceChains = Array.isArray(latest?.chains) ? latest.chains : [];
  const totalFromHistory = sourceChains.reduce((sum, chain) => sum + (finiteOrNull(chain.supply) || 0), 0);
  const total = totalFromHistory || finiteOrNull(issuersState.total_supply_usd);

  const chains = sourceChains
    .map((chain) => {
      const supply = finiteOrNull(chain.supply);
      return {
        name: chain.name || 'Unknown chain',
        stablecoin_supply_usd: supply,
        share_percent: supply !== null && total ? Number(((supply / total) * 100).toFixed(4)) : null,
        rank: finiteOrNull(chain.rank)
      };
    })
    .sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

  if (chains.length) return chains;

  const issuerChains = new Map();
  const issuers = Array.isArray(issuersState.issuers) ? issuersState.issuers : [];
  for (const issuer of issuers) {
    for (const chain of issuer.chain_distribution || []) {
      if (!chain.chain_name || chain.chain_name === 'Other') continue;
      issuerChains.set(chain.chain_name, (issuerChains.get(chain.chain_name) || 0) + (finiteOrNull(chain.supply_usd) || 0));
    }
  }
  const issuerTotal = [...issuerChains.values()].reduce((sum, value) => sum + value, 0);
  return [...issuerChains.entries()]
    .map(([name, supply]) => ({
      name,
      stablecoin_supply_usd: supply,
      share_percent: issuerTotal ? Number(((supply / issuerTotal) * 100).toFixed(4)) : null,
      rank: null
    }))
    .sort((a, b) => b.stablecoin_supply_usd - a.stablecoin_supply_usd)
    .map((chain, index) => ({ ...chain, rank: index + 1 }));
}

function buildNotes(context, readErrors) {
  const notes = [];
  const items = Array.isArray(context.items) ? context.items : [];
  for (const item of items) {
    if (item.source === 'editorial' && item.verified !== true) continue;
    const text = String(item.text || '').replace(/<[^>]+>/g, '').trim();
    if (text) notes.push({ text, source: item.source || 'local_context' });
  }
  for (const [path, error] of readErrors) {
    if (error) notes.push({ text: `Snapshot builder could not read ${path}: ${error}`, source: 'validation' });
  }
  return notes;
}

async function main() {
  const fallback = await readJson(paths.botFallback, {});
  const context = await readJson(paths.botContext, { items: [] });
  const issuersState = await readJson(paths.issuersState, { issuers: [] });
  const issuersConfig = await readJson(paths.issuersConfig, {});
  const chainRankHistory = await readJson(paths.chainRankHistory, { snapshots: [] });

  const sourceFiles = [
    'bot/fallback.json',
    'bot/issuers_state.json',
    'bot/issuers_config.json',
    'bot/chain_rank_history.json',
    'bot/context.json'
  ];

  const readErrors = [
    ['bot/fallback.json', fallback.__read_error],
    ['bot/issuers_state.json', issuersState.__read_error],
    ['bot/issuers_config.json', issuersConfig.__read_error],
    ['bot/chain_rank_history.json', chainRankHistory.__read_error],
    ['bot/context.json', context.__read_error]
  ];

  const snapshot = {
    generated_at: new Date().toISOString(),
    dataset_status: 'frozen_demo_snapshot',
    source_files: sourceFiles,
    ddd_percent: finiteOrNull(fallback.currentDDD),
    stablecoin_market_cap_usd: finiteOrNull(fallback.stablecoinMarketCap ?? issuersState.total_supply_usd),
    us_m2_usd: finiteOrNull(fallback.usM2 ?? issuersState.us_m2),
    one_in_x: finiteOrNull(fallback.ratio),
    last_updated: toIsoDate(issuersState.updated_at || fallback.updated),
    issuers: buildIssuers(issuersState, issuersConfig),
    chains: buildChains(chainRankHistory, issuersState),
    methodology_version: 'stablecoin_market_cap_divided_by_us_m2',
    notes: buildNotes(context, readErrors)
  };

  await mkdir(dirname(paths.snapshot), { recursive: true });
  await writeFile(paths.snapshot, `${JSON.stringify(snapshot, null, 2)}\n`);

  const onchainSnapshot = {
    generated_at: snapshot.generated_at,
    dataset_status: 'offline_cached_solana_reference',
    runtime_note: 'This file is local-only. It does not prove a fresh Solana RPC read during the offline demo.',
    solana_program_id: DDD_SOLANA_PROGRAM_ID,
    cluster: 'devnet',
    oracle_model: 'DDD Oracle on Solana push oracle',
    pda_seeds: ['oracle', 'chains', 'issuers', 'tokens'],
    read_status: 'not_read_during_offline_demo',
    source_files: [
      'dddoracle/README.md',
      'intelligence/data/ddd-current.snapshot.json'
    ],
    cached_values: {
      ddd_percent: snapshot.ddd_percent,
      stablecoin_market_cap_usd: snapshot.stablecoin_market_cap_usd,
      us_m2_usd: snapshot.us_m2_usd,
      one_in_x: snapshot.one_in_x,
      last_updated: snapshot.last_updated,
      solana_chain_share: snapshot.chains.find((chain) => String(chain.name || '').toLowerCase().includes('solana')) || null
    }
  };

  await mkdir(dirname(paths.onchainSnapshot), { recursive: true });
  await writeFile(paths.onchainSnapshot, `${JSON.stringify(onchainSnapshot, null, 2)}\n`);
  console.log(`Wrote ${paths.snapshot}`);
  console.log(`Wrote ${paths.onchainSnapshot}`);
  console.log(`Issuers: ${snapshot.issuers.length}; chains: ${snapshot.chains.length}; DDD: ${snapshot.ddd_percent}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
