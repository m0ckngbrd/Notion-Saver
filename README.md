# Clip to Notion++

A keyboard-first Chrome extension for saving X (Twitter) posts and web pages to Notion with full keyboard navigation and accessibility support.

## Features

- **Keyboard-first design**: Full keyboard navigation with accessible ARIA combobox for tags
- **X/Twitter integration**: Automatically extracts tweet text, author, published date, and images
- **Smart pre-filling**: Auto-fills content from the current page when available
- **Accessible UI**: WAI-ARIA compliant combobox/listbox patterns for screen readers
- **Quick save**: Keyboard shortcuts for fast saving (Ctrl+Shift+S to open, Ctrl+Enter to save)
- **Image support**: Automatically includes tweet images in Notion pages
- **Auto-close tab**: Optional setting to close the tab after saving

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the extension directory
5. The extension icon should appear in your toolbar

## Setup

### 1. Create a Notion Integration

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Choose "Internal" integration
4. Give it a name (e.g., "Clip to Notion++")
5. Copy the **Integration Token**

### 2. Create a Notion Database

Create a database in Notion with the following properties:

- **Tweet** (title) - For the tweet text content
- **Tweet Link** (url) - For the X/Twitter URL
- **Tags** (multi-select) - For organizing your saved posts
- **Published** (date) - For the tweet's published date
- **Sync?** (checkbox) - Optional sync flag

> **Note**: Property names must match exactly (case-sensitive). You can customize these in the code if needed.

### 3. Share Database with Integration

1. Open your Notion database
2. Click the "..." menu in the top right
3. Select "Connections"
4. Find your integration and connect it

### 4. Configure the Extension

1. Right-click the extension icon and select "Options" (or go to `chrome://extensions/` → find the extension → click "Extension options")
2. Paste your **Integration Token**
3. Paste your **Database ID** (found in the database URL, or paste the full URL and it will extract the ID)
4. Click "Test connection" to verify
5. Click "Save"

## Usage

### Saving X/Twitter Posts

1. Navigate to any tweet
2. Press `Ctrl+Shift+S` (or `Cmd+Shift+S` on Mac) to open the popup
3. The extension will auto-fill:
   - Tweet text
   - Title (first 80 characters)
   - Published date
   - Image (if present)
4. Add tags using the keyboard:
   - `Tab` to focus the tags input
   - Type to filter tags
   - `↓/↑` to navigate options
   - `Enter` or `Space` to select
   - `Esc` to close
5. Press `Ctrl+Enter` (or `Cmd+Enter` on Mac) to save

### Keyboard Shortcuts

- `Ctrl+Shift+S` / `Cmd+Shift+S`: Open the saver popup
- `Ctrl+Enter` / `Cmd+Enter`: Save to Notion
- `Tab` / `Shift+Tab`: Navigate between fields
- `↓/↑`: Navigate tag options
- `Enter` / `Space`: Select tag
- `Esc`: Close tag dropdown
- `s`: Toggle "Sync" checkbox (when not typing)
- `c`: Toggle "Close tab" checkbox (when not typing)

## Keyboard Navigation

The extension is designed with accessibility in mind:

- All interactive elements are keyboard accessible
- Tags use a proper ARIA combobox/listbox pattern
- Screen reader announcements for selections
- No `tabindex="-1"` blocking essential navigation
- Standard keyboard patterns (Tab, Arrow keys, Enter, Esc)

## Requirements

- Chrome or Chromium-based browser (Manifest V3)
- Notion account with API access
- Notion database with appropriate properties

## Troubleshooting

### "Network security (Zscaler) is blocking Notion API"

If you're on a corporate network with Zscaler or similar security software, contact IT to whitelist `api.notion.com`.

### "Missing config" error

Make sure you've:
1. Set up the Notion integration
2. Shared your database with the integration
3. Entered the token and database ID in Options
4. Tested the connection successfully

### Tags not appearing

Ensure your Notion database has a **multi-select** property named "Tags" (or whatever property name you're using).

### Images not saving

- Images must be publicly accessible HTTPS URLs
- Twitter media URLs are automatically normalized
- If images fail, the text content will still save

## Development

This is a Manifest V3 Chrome extension. Key files:

- `manifest.json` - Extension configuration
- `popup.html/js` - Main UI for saving content
- `options.html/js` - Settings page for Notion credentials
- `content_script_x.js` - Extracts content from X/Twitter pages
- `background.js` - Service worker for keyboard shortcuts

## License

This project is for personal use. Modify as needed for your workflow.

## Credits

Designed as a keyboard-first alternative to existing Notion clippers, with a focus on accessibility and speed.
