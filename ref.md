Got it --- that regression is frustrating. I looked into how **Save to Notion** is positioned and what it does, then sketched a plan (with working code scaffolding) to replicate the key pieces with **first‑class keyboard navigation**.

* * * * *

What the current "Save to Notion" extension does (relevant bits)
----------------------------------------------------------------

-   It's a browser extension that lets you save web content---articles, **tweets/X posts**, YouTube, LinkedIn, etc.---to a Notion database, and map database properties in a configurable "form." ([Save to Notion](https://savetonotion.so/docs/ "Save to Notion Docs"))

-   Its docs show explicit flows for saving **individual Tweets** and **Threads**, which is right in your use case. ([Save to Notion](https://savetonotion.so/docs/articles/how-to-save-tweet-using-the-extension "How to save Tweet using the extension - Save to Notion Docs"))

-   The Web Store page highlights filling database properties (tags, relations, checkboxes), taking screenshots, and highlighting text from the page. ([Chrome Web Store](https://chromewebstore.google.com/detail/save-to-notion/ldmmifpegigmeammaeckplhnjbbpccmm?hl=en&utm_source=chatgpt.com "Save to Notion - Chrome Web Store"))

-   It has a concept of **exporting your forms/settings** as JSON, which implies most user configuration lives client-side. ([Save to Notion](https://savetonotion.so/docs/articles/how-to-export-my-data "How to Export My Data? - Save to Notion Docs"))

-   Notion connectivity is via the **Notion API** (public/internal integrations, OAuth or token), so any re‑implementation will use the same API surface. ([Notion Developers](https://developers.notion.com/docs/getting-started?utm_source=chatgpt.com "Notion API Overview"))

> They even mention "improved keyboard navigation" in a past changelog, so your experience that a **recent update** broke tabbing could be a regression. Either way, we'll design ours to follow WAI‑ARIA best practices for listbox/combobox widgets so **Tab/Shift+Tab** and **Arrow keys** behave reliably. ([Save to Notion](https://savetonotion.so/changelog/?utm_source=chatgpt.com "Save to Notion Changelog"), [W3C](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/?utm_source=chatgpt.com "Combobox Pattern | APG | WAI"))

* * * * *

The plan: "Clip to Notion++" --- a keyboard‑first web clipper for X
-----------------------------------------------------------------

### Design goals

1.  **Always tabbable**: every interactive control is in the natural tab order; no `tabindex="-1"` on essential elements.

2.  **Accessible dropdowns** for **tags** (multi‑select) and other properties using the **WAI‑ARIA combobox + listbox** pattern:

    -   `role="combobox"` with `aria-expanded`, `aria-controls`

    -   Popup `role="listbox"` with `role="option"` items

    -   `aria-activedescendant` for "roving focus" while DOM focus stays in the input

    -   Keyboard: **Enter/Space** selects, **Esc** closes, **Up/Down** moves, **Home/End** jump, **Type‑ahead** filters. ([W3C](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/?utm_source=chatgpt.com "Combobox Pattern | APG | WAI"), [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/combobox_role?utm_source=chatgpt.com "ARIA: combobox role - MDN Web Docs - Mozilla"))

3.  **No backend required (personal use)**: the user pastes a Notion **internal integration token** and database ID in an Options page; the token is stored locally via `chrome.storage`. (If you later want to distribute publicly, add a tiny OAuth backend.) ([Notion Developers](https://developers.notion.com/docs/getting-started?utm_source=chatgpt.com "Notion API Overview"))

4.  **X-optimized**: on `x.com/*/status/*`, the content script extracts post text/author/URL and pre‑fills the form. If DOM changes break scraping, we still save the URL + your tags, so you never lose a bookmark. ([Save to Notion](https://savetonotion.so/docs/ "Save to Notion Docs"))

* * * * *

How to set up Notion (once)
---------------------------

1.  In Notion, create an **internal integration** and copy the **secret token**. Share your target database with the integration. ([Notion Developers](https://developers.notion.com/docs/create-a-notion-integration?utm_source=chatgpt.com "Build your first integration"))

2.  In that database, include properties like:

    -   **Name** (title)

    -   **URL** (url)

    -   **Tags** (multi‑select)

    -   **Source** (select)

    -   **Author** (rich_text)

    -   **Saved At** (date)

    -   **Text** (rich_text)\
        (You can adjust later; the extension reads the schema dynamically.) ([Notion Developers](https://developers.notion.com/docs/getting-started?utm_source=chatgpt.com "Notion API Overview"))

* * * * *

Minimal but complete Chrome extension (MV3)
-------------------------------------------

> Drop these files into a folder and load it via **chrome://extensions → Load unpacked**.

### `manifest.json`

```
{
  "manifest_version": 3,
  "name": "Clip to Notion++",
  "version": "0.1.0",
  "description": "Keyboard-first saver for X posts and web pages to Notion.",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": [
    "https://api.notion.com/*",
    "https://x.com/*",
    "https://twitter.com/*"
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "Clip to Notion++"
  },
  "options_page": "options.html",
  "background": { "service_worker": "background.js" },
  "content_scripts": [
    {
      "matches": ["https://x.com/*", "https://twitter.com/*"],
      "js": ["content_script_x.js"],
      "run_at": "document_idle"
    }
  ],
  "commands": {
    "open-saver": {
      "suggested_key": { "default": "Ctrl+Shift+S", "mac": "Command+Shift+S" },
      "description": "Open the Notion saver popup"
    }
  }
}

```

### `options.html` (store your Notion token & database)

```
<!doctype html>
<meta charset="utf-8" />
<title>Clip to Notion++ - Options</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; }
  label { display:block; margin-top:1rem; font-weight:600; }
  input[type=text], input[type=password] { width:100%; padding:.5rem; }
  button { margin-top:1rem; padding:.5rem .75rem; }
  .hint { color:#555; font-size:.9rem; }
</style>

<h1>Clip to Notion++ - Options</h1>
<p class="hint">Create an <strong>internal Notion integration</strong>, share your database with it, then paste the <em>secret token</em> and the database ID here.</p>

<form id="optForm">
  <label for="token">Notion Integration Token</label>
  <input id="token" name="token" type="password" autocomplete="off" required aria-describedby="tokHelp" />
  <div id="tokHelp" class="hint">Looks like <code>secret_xxx</code>. Keep it private.</div>

  <label for="db">Target Database ID</label>
  <input id="db" name="db" type="text" required aria-describedby="dbHelp" />
  <div id="dbHelp" class="hint">The long ID in the database URL.</div>

  <button type="submit">Save</button>
  <button type="button" id="test">Test connection</button>
  <div id="result" role="status" aria-live="polite" class="hint" style="margin-top:1rem;"></div>
</form>

<script type="module">
  const $ = s => document.querySelector(s);
  const NOTION_VERSION = '2022-06-28';

  async function notionGetDB(token, id) {
    const res = await fetch(`https://api.notion.com/v1/databases/${id}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION
      }
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  (async () => {
    const { token, databaseId } = await chrome.storage.local.get(['token','databaseId']);
    if (token) $('#token').value = token;
    if (databaseId) $('#db').value = databaseId;
  })();

  $('#optForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = $('#token').value.trim();
    const databaseId = $('#db').value.trim();
    await chrome.storage.local.set({ token, databaseId });
    $('#result').textContent = 'Saved.';
  });

  $('#test').addEventListener('click', async () => {
    $('#result').textContent = 'Testing...';
    try {
      const token = $('#token').value.trim();
      const db = $('#db').value.trim();
      const meta = await notionGetDB(token, db);
      $('#result').textContent = `OK: "${meta.title?.[0]?.plain_text || 'Untitled'}" with ${Object.keys(meta.properties).length} properties.`;
    } catch (err) {
      $('#result').textContent = 'Failed: ' + (''+err).slice(0, 300);
    }
  });
</script>

```

### `popup.html` (keyboard‑first UI with accessible **Tags** combobox)

```
<!doctype html>
<meta charset="utf-8" />
<title>Clip to Notion++</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: .75rem; width: 360px; }
  .row { margin-bottom: .75rem; }
  label { font-weight: 600; display:block; margin-bottom:.25rem; }
  input[type=text], textarea { width:100%; padding:.5rem; }
  button { padding:.5rem .75rem; }
  .chips { display:flex; flex-wrap:wrap; gap:.25rem; margin-bottom:.25rem; }
  .chip { border:1px solid #ccc; border-radius:999px; padding:.15rem .5rem; }
  .chip button { border:none; background:none; margin-left:.25rem; cursor:pointer; }
  /* Combobox */
  .combo { position:relative; }
  .combo [role="listbox"] {
    position:absolute; z-index: 10; max-height:180px; overflow:auto;
    border:1px solid #ccc; background:#fff; width:100%; box-sizing:border-box;
  }
  .option { padding:.35rem .5rem; }
  .option[aria-selected="true"] { font-weight: 600; }
  .option[aria-current="true"] { outline: 2px solid #999; }
  .kbd { font: .85rem ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
</style>

<h1 style="font-size:1.1rem;margin:0 0 .5rem;">Clip to Notion++</h1>

<div class="row">
  <label for="title">Title</label>
  <input id="title" type="text" />
</div>

<div class="row">
  <label for="tagsInput">Tags <span class="kbd">(Tab to focus, ↓/↑, Enter/Space to select, Esc to close)</span></label>

  <!-- Combobox wrapper -->
  <div class="combo"
       id="tagsCombo"
       role="combobox"
       aria-haspopup="listbox"
       aria-expanded="false"
       aria-controls="tagsListbox">
    <!-- Selected chips appear before the input -->
    <div id="tagsChips" class="chips"></div>
    <input id="tagsInput" type="text" aria-autocomplete="list" aria-activedescendant="" aria-controls="tagsListbox" autocomplete="off" />
    <ul id="tagsListbox" role="listbox" hidden></ul>
  </div>
  <div id="tagsHelp" class="kbd" aria-hidden="true" style="margin-top:.25rem;color:#555;">Type to filter.</div>
</div>

<div class="row">
  <label for="notes">Notes (tweet text auto‑fills on X)</label>
  <textarea id="notes" rows="4"></textarea>
</div>

<div class="row">
  <button id="saveBtn">Save (Ctrl/Cmd+Enter)</button>
  <span id="status" role="status" aria-live="polite" style="margin-left:.5rem;"></span>
</div>

<script type="module" src="popup.js"></script>

```

### `popup.js` (ARIA combobox, X prefill, Notion save)

```
const NOTION_VERSION = '2022-06-28';
const $ = s => document.querySelector(s);
const statusEl = $('#status');

let allTags = [];        // [{id,name,color}]
let filteredTags = [];
let selectedTagIds = new Set();
let activeIndex = -1;

// --- Load config & schema, prefill from X ---
(async function init() {
  try {
    const { token, databaseId } = await chrome.storage.local.get(['token','databaseId']);
    if (!token || !databaseId) {
      statusEl.textContent = 'Open Options to set Notion token & DB.';
      return;
    }
    // Prefill from current tab (X)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab.url || '';
    const pre = await tryPrefillFromX(tab.id);
    $('#title').value = pre.title || (tab.title || '').trim();
    $('#notes').value = pre.text || '';

    // Fetch DB schema for tags + title property
    const meta = await notionGetDB(token, databaseId);
    const { titlePropName, tagsPropName, tagsOptions } = parseSchema(meta);
    window.__ctn = { token, databaseId, titlePropName, tagsPropName, url };

    allTags = tagsOptions;
    filteredTags = allTags.slice();
    renderListbox();
    renderChips();

    // Keyboard shortcuts for Save
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault(); save();
      }
    });

    // Focus the title for quick editing
    $('#title').focus();
  } catch (err) {
    statusEl.textContent = 'Init failed: ' + truncate(err);
  }
})();

async function tryPrefillFromX(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_X_POST' });
    return res || {};
  } catch { return {}; }
}

// --- Notion helpers ---
async function notionGetDB(token, id) {
  const res = await fetch(`https://api.notion.com/v1/databases/${id}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_VERSION }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function parseSchema(meta) {
  let titlePropName = Object.entries(meta.properties).find(([,v]) => v.type === 'title')?.[0];
  const tagsEntry = Object.entries(meta.properties).find(([,v]) => v.type === 'multi_select');
  const tagsPropName = tagsEntry?.[0] || null;
  const tagsOptions = tagsEntry?.[1]?.multi_select?.options?.map(o => ({ id: o.id, name: o.name, color: o.color })) || [];
  return { titlePropName, tagsPropName, tagsOptions };
}

async function save() {
  const { token, databaseId, titlePropName, tagsPropName, url } = window.__ctn || {};
  if (!token || !databaseId || !titlePropName) { statusEl.textContent = 'Missing config.'; return; }

  statusEl.textContent = 'Saving...';
  const title = $('#title').value.trim() || 'Untitled';
  const text = $('#notes').value.trim();

  // Build properties payload
  const props = {};
  props[titlePropName] = { title: [{ type: 'text', text: { content: title } }] };
  if (url) props['URL'] = { url }; // requires a URL property named "URL"
  if (text) props['Text'] = { rich_text: [{ type:'text', text: { content: text } }] };
  if (tagsPropName) {
    const selected = [...selectedTagIds].map(id => {
      const t = allTags.find(x => x.id === id);
      return t ? { id: t.id, name: t.name } : null;
    }).filter(Boolean);
    props[tagsPropName] = { multi_select: selected };
  }

  const body = { parent: { database_id: databaseId }, properties: props };
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text();
    statusEl.textContent = 'Save failed: ' + truncate(errText);
    return;
  }
  statusEl.textContent = 'Saved ✅';
}

// --- Accessible Tags Combobox (multi-select) ---
const combo = $('#tagsCombo');
const input = $('#tagsInput');
const listbox = $('#tagsListbox');
const chips = $('#tagsChips');

function openListbox() {
  combo.setAttribute('aria-expanded', 'true');
  listbox.hidden = false;
  renderListbox();
}
function closeListbox() {
  combo.setAttribute('aria-expanded', 'false');
  listbox.hidden = true;
  activeIndex = -1;
  input.removeAttribute('aria-activedescendant');
}
function renderListbox() {
  listbox.innerHTML = '';
  filteredTags.forEach((opt, idx) => {
    const li = document.createElement('li');
    li.id = `opt-${opt.id}`;
    li.className = 'option';
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', selectedTagIds.has(opt.id) ? 'true' : 'false');
    if (idx === activeIndex) li.setAttribute('aria-current', 'true');
    li.tabIndex = -1;
    li.textContent = opt.name;
    li.addEventListener('mousedown', (e) => { e.preventDefault(); toggleOption(opt.id); }); // mouse support without losing focus
    listbox.appendChild(li);
  });
}

function renderChips() {
  chips.innerHTML = '';
  for (const id of selectedTagIds) {
    const tag = allTags.find(t => t.id === id);
    if (!tag) continue;
    const el = document.createElement('span');
    el.className = 'chip';
    el.innerHTML = `${escapeHTML(tag.name)} <button aria-label="Remove ${escapeHTML(tag.name)}" data-id="${tag.id}">×</button>`;
    el.querySelector('button').addEventListener('click', (e) => {
      selectedTagIds.delete(e.currentTarget.dataset.id);
      renderChips(); renderListbox();
      input.focus();
    });
    chips.appendChild(el);
  }
}

function filterOptions(q) {
  const s = q.toLowerCase();
  filteredTags = !s ? allTags.slice() : allTags.filter(t => t.name.toLowerCase().includes(s));
  activeIndex = filteredTags.length ? 0 : -1;
  renderListbox();
  if (activeIndex >= 0) input.setAttribute('aria-activedescendant', `opt-${filteredTags[activeIndex].id}`);
}

function moveActive(delta) {
  if (!filteredTags.length) return;
  activeIndex = (activeIndex + delta + filteredTags.length) % filteredTags.length;
  input.setAttribute('aria-activedescendant', `opt-${filteredTags[activeIndex].id}`);
  renderListbox();
}

function toggleOption(id) {
  if (selectedTagIds.has(id)) selectedTagIds.delete(id);
  else selectedTagIds.add(id);
  renderChips();
  renderListbox();
}

input.addEventListener('focus', () => openListbox());
input.addEventListener('input', (e) => filterOptions(e.target.value));

input.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); if (listbox.hidden) openListbox(); moveActive(1); break;
    case 'ArrowUp':   e.preventDefault(); if (listbox.hidden) openListbox(); moveActive(-1); break;
    case 'Home':      e.preventDefault(); if (!listbox.hidden) { activeIndex = 0; renderListbox(); } break;
    case 'End':       e.preventDefault(); if (!listbox.hidden) { activeIndex = filteredTags.length -1; renderListbox(); } break;
    case 'Enter':
    case ' ': {
      if (listbox.hidden || activeIndex < 0) return;
      e.preventDefault();
      const id = filteredTags[activeIndex].id;
      toggleOption(id);
      break;
    }
    case 'Escape': closeListbox(); break;
    case 'Tab': closeListbox(); break;
    case 'Backspace': {
      if (!input.value && selectedTagIds.size) {
        // Remove last chip
        const last = [...selectedTagIds].pop();
        selectedTagIds.delete(last);
        renderChips(); renderListbox();
      }
      break;
    }
  }
});

// Save button
$('#saveBtn').addEventListener('click', save);

// Utilities
function escapeHTML(s) { return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function truncate(e) { const s = (''+e); return s.length > 300 ? s.slice(0,300)+'...' : s; }

```

### `content_script_x.js` (extract Tweet/X content when available)

```
function extractTweet() {
  // Works on x.com tweet permalinks. DOM changes often; keep it resilient.
  try {
    const article = document.querySelector('article');
    if (!article) return null;

    // Text: prefer tweetText container; fallback: any div[lang]
    const textEl = article.querySelector('[data-testid="tweetText"]') || article.querySelector('div[lang]');
    const text = textEl ? textEl.textContent.trim() : '';

    // Author handle
    const handleEl = article.querySelector('a[href*="/status/"]')?.closest('article')?.querySelector('a[role="link"][href*="/"] span');
    let author = '';
    if (handleEl) author = handleEl.textContent.trim();

    // Title suggestion: first 80 chars of text
    const title = text ? (text.length > 80 ? text.slice(0, 80) + '...' : text) : document.title;

    return { title, text, author };
  } catch { return null; }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_X_POST') {
    sendResponse(extractTweet());
  }
});

```

### `background.js`

```
// Placeholder for future enhancements (e.g., capture screenshots of an element on the page).
// For now, popup makes API calls directly.
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-saver') {
    chrome.action.openPopup();
  }
});

```

* * * * *

Why this fixes the keyboard pain
--------------------------------

-   The tags control is a **true ARIA combobox** with a **listbox** popup. Focus remains on the input, the active option is announced via `aria-activedescendant`, and standard keys (Tab, Shift+Tab, Up/Down, Enter/Space, Esc) all do what users expect. This mirrors the **WAI‑ARIA Authoring Practices** for combobox/listbox widgets, which is the gold standard for keyboard semantics. ([W3C](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/?utm_source=chatgpt.com "Combobox Pattern | APG | WAI"))

-   We avoid blocking Tab with `preventDefault()` except for Arrow‑key navigation inside the popup; so **you can tab into and out of the dropdown** reliably, which is what broke for you. (MDN's guidance on combobox control relationships & `aria-controls` is followed.) ([MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/combobox_role?utm_source=chatgpt.com "ARIA: combobox role - MDN Web Docs - Mozilla"))

* * * * *

Ship‑it checklist
-----------------

1.  **Create Notion integration** + share DB + copy token/database ID. ([Notion Developers](https://developers.notion.com/docs/getting-started?utm_source=chatgpt.com "Notion API Overview"))

2.  Load the extension (unpacked) and set token/DB in **Options**; hit **Test** to verify schema fetch works.

3.  In your Notion DB, ensure properties exist and are named as expected (e.g., **URL**, **Text**, **Tags**).

4.  Navigate to any **X post**, press **Ctrl/Cmd+Shift+S** to open the popup, **Tab** to Tags, **↓/↑** to move, **Space/Enter** to select, **Ctrl/Cmd+Enter** to save.

5.  Confirm the page shows up in Notion with the right properties.

* * * * *

Extensions / future upgrades
----------------------------

-   **General pages**: if not on X, the popup still saves the URL/title/notes/tags.

-   **Screenshots**: add `chrome.tabs.captureVisibleTab()` in the background and upload files to Notion's files property (requires creating a signed upload via Notion's API). ([Notion Developers](https://developers.notion.com/docs/getting-started?utm_source=chatgpt.com "Notion API Overview"))

-   **Public distribution**: add a tiny OAuth service (Node/Express) using Notion's OAuth 2.0; from the popup call `chrome.identity.launchWebAuthFlow` → exchange code on your server → store access token per user. ([Notion Developers](https://developers.notion.com/docs/authorization?utm_source=chatgpt.com "Authorization"))

-   **More properties**: map more Notion types (select, date, people, relation).

-   **A11y polish**: add screen‑reader announcements via `aria-live` when items are added/removed, and unit tests for keyboard flows.

* * * * *

### Sources / References

-   Save to Notion docs & pages (features, X/Twitter support, exporting forms/settings). ([Save to Notion](https://savetonotion.so/docs/ "Save to Notion Docs"))

-   Save to Notion Chrome Web Store description. ([Chrome Web Store](https://chromewebstore.google.com/detail/save-to-notion/ldmmifpegigmeammaeckplhnjbbpccmm?hl=en&utm_source=chatgpt.com "Save to Notion - Chrome Web Store"))

-   Notion API (integrations, auth). ([Notion Developers](https://developers.notion.com/docs/getting-started?utm_source=chatgpt.com "Notion API Overview"))

-   WAI‑ARIA Authoring Practices (combobox & listbox). ([W3C](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/?utm_source=chatgpt.com "Combobox Pattern | APG | WAI"))

-   MDN ARIA `combobox` and `aria-controls` guidance. ([MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/combobox_role?utm_source=chatgpt.com "ARIA: combobox role - MDN Web Docs - Mozilla"))

* * * * *

If you want, I can tailor the popup to your exact Notion schema (property names, default tags) and add a Gmail/X/YouTube picker---but the core above will give you a **fast, keyboard‑centric clone** that fixes the "can't tab into the dropdown" problem you're hitting today.