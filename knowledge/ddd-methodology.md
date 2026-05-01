# DDD Methodology

Digital Dollar Dominance, or DDD, measures stablecoin adoption as a percentage of US M2 money supply.

Formula:

DDD percent = total stablecoin market capitalization divided by US M2 money supply, multiplied by 100.

The public benchmark uses stablecoin market capitalization data and US M2 money supply data. The current DDD site cites DeFi Llama stablecoin data and FRED M2SL for US M2.

The DDD reading is a ratio. It is not an investment signal, forecast, recommendation, or claim about future stablecoin adoption.

For offline DDD Intelligence demos, the model must use the normalized local snapshot rather than live API calls. If a required value is missing from that snapshot, the correct answer is "not available in the current local dataset".

## Local Dataset Status

The hackathon demo uses a frozen local snapshot generated from the DDD repository before the offline proof. The snapshot records its generation time, source files, current DDD percentage, stablecoin market capitalization, US M2, one-in-X figure, issuer rows, chain rows, methodology version, and notes.
