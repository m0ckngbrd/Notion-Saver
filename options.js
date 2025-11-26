const $ = s => document.querySelector(s);
const NOTION_VERSION = '2022-06-28';

function cleanDatabaseId(id) {
	// Remove dashes and extract from URL if needed
	return id.replace(/[-\s]/g, '').replace(/.*\/([a-f0-9]{32}).*/, '$1');
}

async function notionGetDB(token, id) {
	const cleanId = cleanDatabaseId(id);
	const res = await fetch(`https://api.notion.com/v1/databases/${cleanId}`, {
		headers: {
			'Authorization': `Bearer ${token}`,
			'Notion-Version': NOTION_VERSION
		}
	});
	if (!res.ok) {
		const errorText = await res.text();
		throw new Error(`HTTP ${res.status}: ${errorText}`);
	}
	return res.json();
}

function showResult(message, type = 'loading') {
	const resultEl = $('#result');
	resultEl.textContent = message;
	resultEl.className = type;
}

(async () => {
	const { token, databaseId } = await chrome.storage.local.get(['token','databaseId']);
	if (token) $('#token').value = token;
	if (databaseId) $('#db').value = databaseId;
})();

$('#optForm').addEventListener('submit', async (e) => {
	e.preventDefault();
	const token = $('#token').value.trim();
	const databaseId = cleanDatabaseId($('#db').value.trim());
	await chrome.storage.local.set({ token, databaseId });
	showResult('Settings saved successfully!', 'success');
});

$('#test').addEventListener('click', async () => {
	const testBtn = $('#test');
	const token = $('#token').value.trim();
	const db = $('#db').value.trim();
	if (!token || !db) {
		showResult('Please enter both token and database ID first.', 'error');
		return;
	}
	testBtn.disabled = true;
	showResult('Testing connection...', 'loading');
	try {
		const meta = await notionGetDB(token, db);
		const title = meta.title?.[0]?.plain_text || 'Untitled';
		const propCount = Object.keys(meta.properties).length;
		showResult(`✅ Connection successful!\n\nDatabase: "${title}"\nProperties: ${propCount}\n\nYou can now use the extension to save content to this database.`, 'success');
		const cleanDbId = cleanDatabaseId(db);
		await chrome.storage.local.set({ token, databaseId: cleanDbId });
	} catch (err) {
		let errorMsg = 'Connection failed: ';
		if (err.message.includes('401')) errorMsg += 'Invalid token. Please check your Notion integration token.';
		else if (err.message.includes('404')) errorMsg += 'Database not found. Please check the database ID and ensure your integration has access to it.';
		else if (err.message.includes('403')) errorMsg += 'Access denied. Please ensure your integration has been added to the database.';
		else errorMsg += err.message.slice(0, 200);
		showResult(errorMsg, 'error');
	} finally {
		testBtn.disabled = false;
	}
});

$('#db').addEventListener('paste', (e) => {
	setTimeout(() => {
		const value = e.target.value;
		if (value.includes('notion.so') || value.includes('notion.site')) {
			const cleanId = cleanDatabaseId(value);
			e.target.value = cleanId;
		}
	}, 0);
});
