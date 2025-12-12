import fs from 'node:fs';
import path from 'node:path';

const NOTION_VERSION = '2022-06-28';
const TWITTER_SNOWFLAKE_EPOCH_MS = 1288834974657n;

function cleanDatabaseId(id) {
  return String(id || '')
    .trim()
    .replace(/[-\s]/g, '')
    .replace(/.*\/([a-f0-9]{32}).*/, '$1');
}

function env(name, required = true) {
  const v = process.env[name];
  if (required && (!v || !String(v).trim())) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return [];
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => safeJsonParse(line))
    .filter(Boolean);
}

function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
}

function csvEscape(s) {
  const v = String(s ?? '');
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function writeCsv(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const headers = ['page_id', 'tweet_url', 'published_iso', 'status', 'error'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      csvEscape(r.page_id),
      csvEscape(r.tweet_url),
      csvEscape(r.published_iso),
      csvEscape(r.status),
      csvEscape(r.error)
    ].join(','));
  }
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

function parseIntEnv(name, def) {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function isValidIsoDateString(s) {
  if (!s || typeof s !== 'string') return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function parseTweetIdFromUrl(url) {
  try {
    const u = new URL(url);
    const m = /\/status\/(\d+)/.exec(u.pathname);
    return m?.[1] || null;
  } catch { return null; }
}

function isoFromTweetIdSnowflake(tweetIdStr) {
  try {
    const id = BigInt(tweetIdStr);
    const ms = (id >> 22n) + TWITTER_SNOWFLAKE_EPOCH_MS;
    return new Date(Number(ms)).toISOString();
  } catch {
    return null;
  }
}

function extractIsoFromHtml(html) {
  if (!html) return null;

  // 1) <time datetime="2025-07-21T22:16:15.000Z">
  {
    const m = /<time\b[^>]*\bdatetime="([^"]+)"/i.exec(html);
    const iso = m?.[1]?.trim();
    if (iso && isValidIsoDateString(iso)) return new Date(iso).toISOString();
  }

  // 2) meta tags sometimes contain ISO-like timestamps
  {
    const m = /<meta\b[^>]*(?:property|name)="(?:og:(?:updated_time|published_time)|article:published_time)"[^>]*\bcontent="([^"]+)"/i.exec(html);
    const iso = m?.[1]?.trim();
    if (iso && isValidIsoDateString(iso)) return new Date(iso).toISOString();
  }

  // 3) Embedded JSON with ISO timestamps
  // Try a few common keys seen in Twitter/X inlined state.
  {
    const m = /"created_at"\s*:\s*"([^"]+)"/i.exec(html);
    const v = m?.[1]?.trim();
    // Example: "Mon Jul 21 22:16:15 +0000 2025"
    if (v) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  {
    const m = /"date"\s*:\s*"(\d{4}-\d{2}-\d{2}T[^"]+Z)"/i.exec(html);
    const iso = m?.[1]?.trim();
    if (iso && isValidIsoDateString(iso)) return new Date(iso).toISOString();
  }

  return null;
}

async function fetchWithRetry(url, init, { maxRetries = 5, baseDelayMs = 500 } = {}) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status < 500) return res;

    if (attempt > maxRetries) return res;

    const ra = res.headers.get('retry-after');
    const retryAfterMs = ra ? Number(ra) * 1000 : null;
    const delay = Number.isFinite(retryAfterMs) ? retryAfterMs : (baseDelayMs * Math.pow(2, attempt - 1));
    await sleep(Math.min(delay, 20_000));
  }
}

async function notionQueryMissingPublished({ token, databaseId, maxPages = Infinity }) {
  const pages = [];
  let cursor = undefined;
  let pageCount = 0;

  while (true) {
    if (pageCount >= maxPages) break;
    pageCount += 1;

    const body = {
      page_size: 100,
      filter: { property: 'Published', date: { is_empty: true } }
    };
    if (cursor) body.start_cursor = cursor;

    const res = await fetchWithRetry(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Notion query failed (${res.status}): ${text.slice(0, 500)}`);
    }

    const json = safeJsonParse(text);
    if (!json || !Array.isArray(json.results)) {
      throw new Error(`Notion query returned unexpected payload: ${text.slice(0, 500)}`);
    }

    for (const p of json.results) {
      const pageId = p?.id;
      const tweetUrl = p?.properties?.['Tweet Link']?.url || null;
      pages.push({ pageId, tweetUrl });
    }

    if (!json.has_more) break;
    cursor = json.next_cursor;
    if (!cursor) break;
  }

  return pages;
}

async function notionPatchPublished({ token, pageId, iso }) {
  const body = {
    properties: {
      Published: { date: { start: iso } }
    }
  };
  const res = await fetchWithRetry(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Notion patch failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return safeJsonParse(text) || { ok: true };
}

async function getTweetPublishedIso(tweetUrl) {
  // Prefer snowflake (tweet ID) first: deterministic, fast, and avoids X anti-bot / login issues.
  const tweetId = parseTweetIdFromUrl(tweetUrl);
  if (tweetId) {
    const iso = isoFromTweetIdSnowflake(tweetId);
    if (iso) return iso;
  }

  // Fallback: try to scrape HTML (when available).
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };

  try {
    const res = await fetchWithRetry(tweetUrl, { method: 'GET', headers }, { maxRetries: 2, baseDelayMs: 700 });
    const html = await res.text();
    const fromHtml = extractIsoFromHtml(html);
    if (fromHtml) return fromHtml;
  } catch {
    // ignore and fallback
  }

  return null;
}

async function asyncPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let idx = 0;

  async function runOne() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  const n = Math.max(1, concurrency);
  const runners = Array.from({ length: Math.min(n, items.length) }, () => runOne());
  await Promise.all(runners);
  return results;
}

async function main() {
  const token = env('NOTION_TOKEN');
  const databaseId = cleanDatabaseId(env('NOTION_DATABASE_ID'));
  const dryRun = String(process.env.DRY_RUN || '').trim() === '1';
  const concurrency = parseIntEnv('CONCURRENCY', 3);
  const maxPages = parseIntEnv('MAX_PAGES', Infinity);
  const maxItems = parseIntEnv('MAX_ITEMS', Infinity);

  const outDir = process.env.OUT_DIR || path.join(process.cwd(), 'out');
  const checkpointFile = path.join(outDir, 'checkpoint.jsonl');
  const reportFile = path.join(outDir, 'report.jsonl');
  const reportCsv = path.join(outDir, 'report.csv');

  const checkpoint = readJsonl(checkpointFile);
  const doneIds = new Set(checkpoint.filter(r => r?.page_id && r?.status).map(r => r.page_id));

  console.log(`[${nowIso()}] Starting backfill`);
  console.log(`- databaseId: ${databaseId}`);
  console.log(`- dryRun: ${dryRun}`);
  console.log(`- concurrency: ${concurrency}`);
  console.log(`- outDir: ${outDir}`);
  console.log(`- alreadyDone: ${doneIds.size}`);

  const missing = await notionQueryMissingPublished({ token, databaseId, maxPages });
  const work = missing
    .filter(x => x?.pageId && !doneIds.has(x.pageId))
    .slice(0, Number.isFinite(maxItems) ? maxItems : missing.length);

  console.log(`- missingPublishedFound: ${missing.length}`);
  console.log(`- toProcessNow: ${work.length}`);

  const summary = {
    total_missing: missing.length,
    processed: 0,
    updated: 0,
    skipped_missing_url: 0,
    failed_scrape: 0,
    notion_errors: 0
  };

  const perItem = await asyncPool(work, concurrency, async ({ pageId, tweetUrl }) => {
    const base = { ts: nowIso(), page_id: pageId, tweet_url: tweetUrl || '' };
    try {
      summary.processed += 1;

      if (!tweetUrl) {
        const row = { ...base, published_iso: '', status: 'skipped_missing_url', error: 'Tweet Link url is empty' };
        appendJsonl(checkpointFile, row);
        appendJsonl(reportFile, row);
        summary.skipped_missing_url += 1;
        return row;
      }

      const iso = await getTweetPublishedIso(tweetUrl);
      if (!iso) {
        const row = { ...base, published_iso: '', status: 'failed_scrape', error: 'Could not derive published datetime' };
        appendJsonl(checkpointFile, row);
        appendJsonl(reportFile, row);
        summary.failed_scrape += 1;
        return row;
      }

      if (dryRun) {
        const row = { ...base, published_iso: iso, status: 'dry_run', error: '' };
        appendJsonl(checkpointFile, row);
        appendJsonl(reportFile, row);
        return row;
      }

      await notionPatchPublished({ token, pageId, iso });
      const row = { ...base, published_iso: iso, status: 'updated', error: '' };
      appendJsonl(checkpointFile, row);
      appendJsonl(reportFile, row);
      summary.updated += 1;
      return row;
    } catch (e) {
      const row = { ...base, published_iso: '', status: 'notion_error', error: String(e?.message || e) };
      appendJsonl(checkpointFile, row);
      appendJsonl(reportFile, row);
      summary.notion_errors += 1;
      return row;
    }
  });

  writeCsv(reportCsv, perItem);

  console.log(`[${nowIso()}] Done`);
  console.log(summary);
  console.log(`Wrote:\n- ${checkpointFile}\n- ${reportFile}\n- ${reportCsv}`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Backfill missing Notion Published dates\n\nEnv:\n  NOTION_TOKEN (required)\n  NOTION_DATABASE_ID (required)\n  DRY_RUN=1 (optional)\n  CONCURRENCY=3 (optional)\n  MAX_PAGES (optional, pages of Notion query)\n  MAX_ITEMS (optional, items to process)\n  OUT_DIR (optional, default: ./out)\n`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


