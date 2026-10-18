// Popup script — controls the Start/Stop button and language selectors

const mainBtn = document.getElementById('mainBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const sourceLang = document.getElementById('sourceLang');
const targetLang = document.getElementById('targetLang');
const swapBtn = document.getElementById('swapBtn');
const mainContent = document.getElementById('mainContent');
const notMeet = document.getElementById('notMeet');

let isTranslating = false;

// Check if current tab is a Google Meet call
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  const isMeet = tab.url && tab.url.startsWith('https://meet.google.com/');

  if (!isMeet) {
    mainContent.style.display = 'none';
    notMeet.style.display = 'block';
    return;
  }

  // Check current translation status
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (response && response.isTranslating) {
      setActiveState();
    }
    if (response && response.sourceLang) sourceLang.value = response.sourceLang;
    if (response && response.targetLang) targetLang.value = response.targetLang;
  });
});

// Swap source and target languages
swapBtn.addEventListener('click', () => {
  const temp = sourceLang.value;
  sourceLang.value = targetLang.value;
  targetLang.value = temp;
});

// Auto-switch languages when dropdowns change (while translating)
function onLangChange() {
  if (!isTranslating) return; // only act if already running
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.runtime.sendMessage({
      type: 'START_TRANSLATION',
      tabId: tabs[0].id,
      sourceLang: sourceLang.value,
      targetLang: targetLang.value
    });
  });
}

sourceLang.addEventListener('change', onLangChange);
targetLang.addEventListener('change', onLangChange);

// Start or stop translation
mainBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0].id;

    if (!isTranslating) {
      chrome.runtime.sendMessage({
        type: 'START_TRANSLATION',
        tabId,
        sourceLang: sourceLang.value,
        targetLang: targetLang.value
      }, (response) => {
        if (response && response.status === 'started') {
          setActiveState();
        }
      });
    } else {
      chrome.runtime.sendMessage({ type: 'STOP_TRANSLATION' }, (response) => {
        if (response && response.status === 'stopped') {
          setIdleState();
        }
      });
    }
  });
});

function setActiveState() {
  isTranslating = true;
  mainBtn.textContent = 'Stop Translation';
  mainBtn.classList.add('stop');
  statusDot.classList.add('active');
  statusText.textContent = 'Translating...';
}

function setIdleState() {
  isTranslating = false;
  mainBtn.textContent = 'Start Translation';
  mainBtn.classList.remove('stop');
  statusDot.classList.remove('active');
  statusText.textContent = 'Ready';
}