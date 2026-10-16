// Content script — injected directly into the Google Meet page
// Responsible for displaying the subtitle overlay on top of Meet's UI
// This script can read and modify the Meet page's DOM

let subtitleContainer = null;
let hideTimeout = null;

// Create the subtitle overlay when the script loads
function createOverlay() {
  // Don't create it twice
  if (document.getElementById('live-translator-overlay')) return;

  subtitleContainer = document.createElement('div');
  subtitleContainer.id = 'live-translator-overlay';

  // Inner element that holds the actual text
  const textEl = document.createElement('p');
  textEl.id = 'live-translator-text';
  subtitleContainer.appendChild(textEl);

  document.body.appendChild(subtitleContainer);
}

// Show a translation as a subtitle
function showSubtitle(text, speaker) {
  if (!subtitleContainer) createOverlay();

  const textEl = document.getElementById('live-translator-text');

  // Show speaker label if provided
  textEl.innerHTML = speaker
    ? `<span class="speaker-label">${speaker}:</span> ${text}`
    : text;

  // Make overlay visible
  subtitleContainer.classList.add('visible');

  // Auto-hide after 5 seconds of no new subtitles
  clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    subtitleContainer.classList.remove('visible');
  }, 5000);
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SHOW_SUBTITLE') {
    showSubtitle(message.text, message.speaker);
  }

  if (message.type === 'HIDE_OVERLAY') {
    if (subtitleContainer) {
      subtitleContainer.classList.remove('visible');
    }
  }
});

// Initialize overlay when page loads
createOverlay();