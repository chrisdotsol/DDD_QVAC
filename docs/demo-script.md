# DDD Intelligence Demo Script

Target length: 2 minutes.

## Setup Before Recording

Run these while online:

```bash
cd intelligence
npm install
npm run setup:models
npm run prepare:demo
```

Start the local runtime:

```bash
npm run qvac:serve
```

In a second terminal:

```bash
npm run serve:ui
```

Open:

```text
http://127.0.0.1:4173/intelligence/
```

## Script

1. Open `digitaldollardominance.com` or the local DDD homepage for 5 seconds.
2. Say: "Digital Dollar Dominance is a live benchmark: stablecoin market cap divided by US M2."
3. Say: "DDD data is public. Institutional questions about that data are private. QVAC lets users analyse stablecoin adoption locally, without sending sensitive research queries to a central AI provider."
4. Open DDD Intelligence.
5. Show the Current Snapshot card and Local Proof panel.
6. Say: "QVAC is running locally on this machine. The page talks to localhost only."
7. Disable WiFi on camera.
8. Ask this fixed query:

```text
Using only the current local snapshot, show how large stablecoins are compared with US M2, identify the largest issuer, identify the largest chain, show Solana’s share, and list any missing data.
```

9. Show the Answer, Data Used, and Sources Used sections.
10. Open browser network tab and show no external calls. Localhost requests are allowed.
11. Show the Solana factual chain share in the snapshot card or answer.
12. Closing frame:

```text
DDD measures the thing.
Solana can use the thing.
QVAC explains the thing privately.
```

Alternative closing frame:

```text
DDD is the data layer.
Solana is the composability layer.
QVAC is the local intelligence layer.
```

Do not mention Are You Stable in the video.

## Proof Checklist

- QVAC terminal shows local model/server logs.
- Browser network tab shows same-origin local static files and localhost QVAC only.
- WiFi is disabled before the query.
- Answer includes Data Used and Sources Used.
- No investment advice, thesis, tweet generation, or Solana interpretation appears.
