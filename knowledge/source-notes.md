# Source Notes

DDD uses stablecoin market data and US M2 money supply data to calculate the DDD ratio.

Stablecoin data source note: The public DDD methodology cites DeFi Llama stablecoin data.

US M2 source note: The public DDD methodology cites FRED M2SL for US M2 money supply.

Offline demo note: DDD Intelligence does not call DeFi Llama, FRED, or any hosted AI API during offline mode. It reads only the generated local snapshot and local knowledge index, then sends grounded prompts to the local QVAC runtime on localhost.

Privacy boundary: DDD data is public. Institutional queries about exposure, issuer dominance, chain share, methodology, or resolution criteria can still be sensitive. The QVAC integration keeps those queries on the user's machine during the demo.
