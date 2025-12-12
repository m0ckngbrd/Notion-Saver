# Backfill missing Notion `Published` dates

This is a **standalone** script (not the browser extension) that:

1. Queries your Notion database for pages where **`Published`** is empty
2. Reads the tweet URL from **`Tweet Link`**
3. Derives the tweet publish time and **PATCHes** Notion to set `Published`

## Requirements

- Node.js **18+** (for built-in `fetch`)
- A Notion integration token with access to the target DB

## Notion database requirements

- A **date** property named exactly: `Published`
- A **url** property named exactly: `Tweet Link`

## Install

No dependencies to install. This folder includes its own `package.json` mainly for convenience scripts.

## Run (PowerShell)

Dry-run (recommended first):

```powershell
cd tools/backfill_published
$env:NOTION_TOKEN="secret_..."
$env:NOTION_DATABASE_ID="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
$env:DRY_RUN="1"
node backfill_published.js
```

Real run:

```powershell
cd tools/backfill_published
$env:NOTION_TOKEN="secret_..."
$env:NOTION_DATABASE_ID="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
node backfill_published.js
```

## Run (cmd.exe)

```bat
cd tools\backfill_published
set NOTION_TOKEN=secret_...
set NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
set DRY_RUN=1
node backfill_published.js
```

## Options (env vars)

- `DRY_RUN=1`: don’t PATCH Notion; still generates reports/checkpoint
- `CONCURRENCY=3`: number of pages processed in parallel
- `MAX_PAGES=...`: limit Notion query pagination pages (each page returns up to 100 results)
- `MAX_ITEMS=...`: limit number of items processed this run
- `OUT_DIR=...`: output directory (default: `./out`)

## Outputs

Written under `OUT_DIR` (default `tools/backfill_published/out/`):

- `checkpoint.jsonl`: append-only record for resume/skip on future runs
- `report.jsonl`: append-only per-item outcomes
- `report.csv`: CSV summary of this run

## How publish time is derived

Best-effort order:

1. **Compute from the tweet ID** in the URL (`/status/<id>`) using the Twitter snowflake epoch
2. Fetch tweet HTML and extract `<time datetime="...">` when available
3. Try embedded timestamps in the HTML

The snowflake method is often enough to backfill even when X blocks scraping.

## Common failure modes

- **Tweet Link missing**: page skipped (`skipped_missing_url`)
- **Cannot derive datetime** (unusual): logged as `failed_scrape`
- **Notion errors / rate limiting**: logged as `notion_error` (script retries on `429` and `5xx`)


