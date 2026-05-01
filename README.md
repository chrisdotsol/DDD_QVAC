# DDD Intelligence

Local chat UI for **Digital Dollar Dominance (DDD)** data: stablecoin market cap vs US M2, issuers, chains, and notes from this repo. Answers use a **frozen JSON snapshot** + **local markdown** + **QVAC** on your machine (no cloud LLM).

---

## How it works (short)

1. **Snapshot** — Numbers come from `data/ddd-current.snapshot.json` (built from the parent repo’s `bot/` JSON).
2. **Knowledge** — Extra context from `knowledge/*.md`; retrieval picks chunks that match your question.
3. **QVAC** — The browser sends prompts to a local OpenAI-compatible server (default `http://127.0.0.1:11434/v1`). Some questions are answered **without** the model (preset “shortcuts”).
4. **UI** — Served locally; open the URL below, type or tap a suggestion, read the four-part answer and “Retrieved sources”.

For deeper detail see `docs/architecture.md`.

---

## Quick start

**1. Install and prep data (once, from this folder)**

```bash
cd intelligence
npm install
npm run setup:models
npm run prepare:demo
```

`prepare:demo` runs the snapshot build and indexes knowledge into `index/knowledge-index.json`.

**2. Start QVAC** (terminal 1)

```bash
npm run qvac:serve
```

**3. Start the UI server** (terminal 2)

```bash
npm run serve:ui
```

**4. Open in your browser**

```text
http://127.0.0.1:4173/intelligence/
```

Use **`http://`** not `file://` — the page needs to load JSON and talk to QVAC.

---

## Handy commands

| Command | What it does |
|--------|----------------|
| `npm run build:snapshot` | Refresh `data/ddd-current.snapshot.json` from `../bot/` files |
| `npm run index:knowledge` | Rebuild search index after you add/change `knowledge/*.md` |
| `npm run prepare:demo` | Snapshot + index (good before a demo) |
| `npm test` | Run unit tests |
| `npm run verify:offline` | Check local QVAC + answer shape (after you’re set up) |

---

## Optional URL tweaks

- **`?qvac=http://127.0.0.1:PORT/v1`** — if QVAC listens on another port.
- **`?shortcuts=0`** — always use the model (skip built-in preset answers for that session).

---

## Add your own notes

1. Put a **`.md`** file in `knowledge/`.
2. Run **`npm run index:knowledge`** (or `npm run prepare:demo`).
3. Ask a question that mentions topics from that file so retrieval can pick it up.

---

## Offline check (optional)

After the UI works: turn off Wi‑Fi, ask a normal question, confirm only localhost traffic. Then:

```bash
npm run verify:offline
```

---

## Rules the UI enforces

Neutral, factual tone: no investment advice, no “buy this issuer,” no price predictions as fact. Numbers should match the snapshot and retrieved context.

If something breaks, confirm QVAC is running and the URL is under `/intelligence/` with the static server from `npm run serve:ui`.
