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

    // Published date - try to extract from time element
    let publishedDate = null;
    const timeEl = article.querySelector('time');
    if (timeEl && timeEl.getAttribute('datetime')) {
      publishedDate = timeEl.getAttribute('datetime');
    }

    // Title suggestion: first 80 chars of text
    const title = text ? (text.length > 80 ? text.slice(0, 80) + '…' : text) : document.title;

    // Image: prefer [data-testid="tweetPhoto"] imgs; fallback to twimg media srcs; exclude avatars/emojis
    const imgCandidates = Array.from(
      article.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="twimg.com/media"], img[src*="pbs.twimg.com/media"]')
    )
      .map(img => {
        const srcset = img.getAttribute('srcset') || '';
        if (srcset) {
          // take the last candidate (highest resolution)
          const last = srcset.split(',').map(s => s.trim().split(' ')[0]).filter(Boolean).pop();
          if (last) return last;
        }
        return img.getAttribute('src') || '';
      })
      .filter(Boolean)
      .filter(src => /twimg\.com\/media\//.test(src) && !/profile_images|emoji/.test(src));

    const mainImageUrl = imgCandidates.length ? normalizeTwitterMediaUrl(imgCandidates[0]) : null;

    return { title, text, author, imageUrl: mainImageUrl, publishedDate };
  } catch { return null; }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_X_POST') {
    sendResponse(extractTweet());
  }
});

// Ensure we request a larger rendition when possible
function normalizeTwitterMediaUrl(url) {
  try {
    const u = new URL(url, window.location.href);
    // many media URLs have ?format=jpg&name=small|medium|large|orig
    if (u.searchParams.has('name')) u.searchParams.set('name', 'large');
    let format = u.searchParams.get('format');
    if (!format) {
      // guess format by path extension; default to jpg
      format = /\.(png|jpg|jpeg|gif|webp)\b/i.exec(u.pathname)?.[1] || 'jpg';
      u.searchParams.set('format', format.toLowerCase());
    }
    // ensure the path ends with an extension; Notion can be picky
    if (!/\.(png|jpg|jpeg|gif|webp)\b/i.test(u.pathname)) {
      const ext = format.toLowerCase() === 'jpeg' ? 'jpg' : format.toLowerCase();
      u.pathname = u.pathname.replace(/\/?$/, '') + '.' + ext;
    }
    if (u.protocol !== 'https:') u.protocol = 'https:';
    return u.href;
  } catch { return url; }
}
