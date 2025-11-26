const NOTION_VERSION = '2022-06-28';
const $ = s => document.querySelector(s);
const statusEl = $('#status');

let allTags = [];        // [{id,name,color}]
let filteredTags = [];
let selectedTagIds = new Set();
let activeIndex = -1;

// --- Load config & schema, prefill from X ---
function cleanDatabaseId(id) {
  // Remove dashes and extract from URL if needed
  return id.replace(/[-\s]/g, '').replace(/.*\/([a-f0-9]{32}).*/, '$1');
}

(async function init() {
  try {
    const { token, databaseId } = await chrome.storage.local.get(['token','databaseId']);
    if (!token || !databaseId) {
      statusEl.innerHTML = '<span class="options-link" id="openOptions">Open Options</span> to set Notion token & DB.';
      $('#openOptions').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
      });
      return;
    }
    // Prefill from current tab (X)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab.url || '';
    const pre = await tryPrefillFromX(tab.id);
    $('#title').value = pre.title || (tab.title || '').trim();
    $('#notes').value = pre.text || '';
    if (pre.imageUrl) {
      const imgEl = document.getElementById('previewImg');
      const box = document.getElementById('imgPreview');
      const no = document.getElementById('noImg');
      imgEl.src = pre.imageUrl;
      box.style.display = 'block';
      no.style.display = 'none';
    }

    // Fetch DB schema for tags + title property
    const cleanDbId = cleanDatabaseId(databaseId);
    const meta = await notionGetDB(token, cleanDbId);
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

    // Hotkeys: 's' toggles Sync, 'c' toggles Close Tab (when not typing in inputs)
    window.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const active = document.activeElement;
      const isTextInput = active && (
        (active.tagName === 'INPUT' && active.type !== 'checkbox') ||
        active.tagName === 'TEXTAREA' ||
        active.isContentEditable === true
      );
      if (isTextInput) return;

      const key = (e.key || '').toLowerCase();
      if (key === 's') {
        e.preventDefault();
        const box = document.getElementById('syncCheck');
        if (box) box.checked = !box.checked;
      } else if (key === 'c') {
        e.preventDefault();
        const box = document.getElementById('closeTabCheck');
        if (box) box.checked = !box.checked;
      }
    });

    // Focus the tags input for quick editing (moved to top)
    $('#tagsInput').focus();
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
  if (!res.ok) {
    const text = await res.text();
    // Detect Zscaler or other proxy interference
    if (text.includes('Zscaler')) {
      throw new Error('Network security (Zscaler) is blocking Notion API access. Please contact IT to whitelist api.notion.com');
    }
    throw new Error(text);
  }
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error('Received non-JSON response from Notion API. Network security may be interfering.');
  }
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
  if (!token || !databaseId || !titlePropName) { 
    statusEl.innerHTML = '<span class="options-link" id="openOptionsMissing">Open Options</span> to configure.';
    $('#openOptionsMissing').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return; 
  }

  statusEl.textContent = 'Saving…';
  const title = $('#title').value.trim() || 'Untitled';
    let text = $('#notes').value.trim();
    if (text.length > 2000) {
      text = text.slice(0, 2000);
    }
  const syncChecked = $('#syncCheck').checked;

  // Build properties payload
  const props = {};
  props[titlePropName] = { title: [{ type: 'text', text: { content: title } }] };
  if (text) props['Tweet'] = { title: [{ type: 'text', text: { content: text } }] };
  if (url) props['Tweet Link'] = { url };
  props['Sync?'] = { checkbox: syncChecked };
  if (tagsPropName) {
    const selected = [...selectedTagIds].map(id => {
      const t = allTags.find(x => x.id === id);
      return t ? { id: t.id, name: t.name } : null;
    }).filter(Boolean);
    props[tagsPropName] = { multi_select: selected };
  }

  // Add published date if available
  const pre = await tryPrefillFromX((await chrome.tabs.query({ active: true, currentWindow: true }))[0].id).catch(() => ({}));
  if (pre?.publishedDate) {
    props['Created'] = { date: { start: pre.publishedDate } };
  }

  const body = { parent: { database_id: databaseId }, properties: props };
  // If we have an image, append a children block with an image object
  if (pre?.imageUrl) {
    // Notion requires a direct, public https URL with a file extension.
    try {
      const u = new URL(pre.imageUrl);
      if (u.protocol === 'http:') u.protocol = 'https:';
      // ensure an image-like extension exists
      if (!/\.(png|jpg|jpeg|gif|webp)\b/i.test(u.pathname)) {
        const ext = (u.searchParams.get('format') || 'jpg').toLowerCase().replace('jpeg','jpg');
        u.pathname = u.pathname.replace(/\/?$/, '') + '.' + ext;
      }
      body.children = [
        {
          object: 'block',
          type: 'image',
          image: { type: 'external', external: { url: u.href } }
        }
      ];
    } catch {
      // ignore invalid image URL
    }
  }
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
    // Detect Zscaler or other proxy interference
    if (errText.includes('Zscaler') || errText.includes('jTHTZ10k5M70NH6ntFvFPFjR1sSPrTZ10sLQK4td') || errText.includes('<!DOCTYPE')) {
      statusEl.textContent = 'Network security (Zscaler) is blocking Notion API. Contact IT to whitelist api.notion.com';
      return;
    }
    statusEl.textContent = 'Save failed: ' + truncate(errText);
    return;
  }
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    statusEl.textContent = 'Received non-JSON response. Network security may be interfering.';
    return;
  }
  
  // Show success overlay
  showSuccessOverlay();
  
  // Close tab if checkbox is checked
  const closeTabChecked = $('#closeTabCheck').checked;
  if (closeTabChecked) {
    setTimeout(() => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.remove(tabs[0].id);
        }
      });
    }, 500); // Wait 0.5 seconds before closing tab
  }
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
      input.value = ''; // Clear the input when Enter/Space is pressed to add a tag
      filterOptions(''); // Reset the filtered options
      break;
    }
    case 'Escape': 
      e.preventDefault();
      e.stopPropagation();
      closeListbox();
      input.value = ''; // Clear the input when ESC is pressed
      filterOptions(''); // Reset the filtered options
      input.blur(); // Remove focus so global hotkeys can work
      break;
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

// Success overlay function
function showSuccessOverlay() {
  const overlay = $('#successOverlay');
  overlay.style.display = 'flex';
  
  // Close the popup window after 0.5 seconds
  setTimeout(() => {
    window.close();
  }, 500);
}

// Save button
$('#saveBtn').addEventListener('click', save);

// Utilities
function escapeHTML(s) { return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function truncate(e) { const s = (''+e); return s.length > 300 ? s.slice(0,300)+'…' : s; }
