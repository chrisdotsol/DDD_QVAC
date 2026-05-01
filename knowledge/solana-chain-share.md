# Solana Chain Share

Solana appears in DDD Intelligence only as factual chain data.

DDD also has a Solana oracle program reference:

- Program ID: `AbjVyP3WaY9yMG8AT8vNcLHcNoFkT5dwT94SPQ8kddd`
- Oracle model: DDD Oracle on Solana push oracle.
- Local offline mode: DDD Intelligence may cite the cached local oracle reference and cached DDD values, but it does not perform a fresh Solana RPC read while the machine is offline.
- Reader protocol from the DDD oracle docs: summary data lives under the `oracle` PDA seed, and detailed books use `chains`, `issuers`, and `tokens` PDA seeds.

Allowed Solana output:

- Chain name.
- Stablecoin supply if available in the local snapshot.
- Stablecoin supply share if available in the local snapshot.
- Rank if available in the local snapshot.
- Dataset timestamp.
- Solana oracle program ID and local read status, if available in the local onchain snapshot.

Prohibited Solana output:

- Ecosystem briefing.
- Interpretation of what the value means for Solana.
- Advocacy.
- Directional language.
- Investment, issuer, chain, or ecosystem recommendations.

If Solana is absent from the current local snapshot, DDD Intelligence must say "not available in the current local dataset".
