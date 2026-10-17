const SERVER_URL = 'ws://localhost:3000';
let socket = null;
let isTranslating = false;
let activePort = null;
let activeTabId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_TRANSLATION') {
    if (isTranslating) {
      sendResponse({ status: 'already_running' });
      return true;
    }
    activeTabId = message.tabId;
    startTranslation(message.tabId, message.sourceLang, message.targetLang);
    sendResponse({ status: 'started' });
  }
  if (message.type === 'STOP_TRANSLATION') {
    stopTranslation();
    sendResponse({ status: 'stopped' });
  }
  if (message.type === 'GET_STATUS') {
    sendResponse({ isTranslating });
  }
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'audio-stream') return;
  activePort = port;
  port.onMessage.addListener((msg) => {
    if (msg.type === 'AUDIO_CHUNK' && socket && socket.readyState === WebSocket.OPEN) {
      const arr = new Uint8Array(msg.buffer);
      socket.send(arr.buffer);
    }
  });
  port.onDisconnect.addListener(() => {
    activePort = null;
  });
});

async function startTranslation(tabId, sourceLang, targetLang) {
  isTranslating = true;

  try {
    // Check if already injected by testing for the guard flag
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window._liveTranslatorLoaded
    });

    if (!result.result) {
      // Not yet injected — inject now
      await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['src/overlay.css'] });
      console.log('Content script injected');
    } else {
      console.log('Content script already present, skipping injection');
    }

    socket = new WebSocket(`${SERVER_URL}?sourceLang=${sourceLang}&targetLang=${targetLang}`);

    socket.onopen = () => {
      console.log('Connected to translation server');
      chrome.tabs.sendMessage(tabId, { type: 'START_AUDIO_CAPTURE' });
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'TRANSLATION') {
          chrome.tabs.sendMessage(tabId, {
            type: 'SHOW_SUBTITLE',
            text: data.text,
            speaker: data.speaker
          });
        }
      } catch (err) {
        console.error('Failed to parse server message:', err);
      }
    };

    socket.onerror = (err) => {
      console.error('WebSocket error:', err);
      stopTranslation();
    };

    socket.onclose = () => {
        console.log('WebSocket closed');
        isTranslating = false;  // ← make sure this line exists
    };

  } catch (err) {
    console.error('Error starting translation:', err);
    isTranslating = false;
  }
}

function stopTranslation() {
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { type: 'STOP_AUDIO_CAPTURE' });
  }
  if (socket) {
    socket.close();
    socket = null;
  }
  isTranslating = false;
  activeTabId = null;
}