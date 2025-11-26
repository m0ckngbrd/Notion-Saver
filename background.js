// Placeholder for future enhancements (e.g., capture screenshots of an element on the page).
// For now, popup makes API calls directly.
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-saver') {
    chrome.action.openPopup();
  }
});
