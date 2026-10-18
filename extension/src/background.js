const SERVER_URL = 'live-translator-production-fd06.up.railway.app';
let socket = null;
let isTranslating = false;
let activePort = null;
let activeTabId = null;
let currentSourceLang = null;
let currentTargetLang = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_TRANSLATION') {
    const langChanged = message.sourceLang !== currentSourceLang || message.targetLang !== currentTargetLang;
    const wasTranslating = isTranslating;

    currentSourceLang = message.sourceLang;
    currentTargetLang = message.targetLang;
    activeTabId = message.tabId;

    if (wasTranslating && langChanged) {
      // Just reconnect WebSocket with new languages, keep audio stream alive
      reconnectSocket(message.tabId, message.sourceLang, message.targetLang);
    } else if (!wasTranslating) {
      // Fresh start
      startTranslation(message.tabId, message.sourceLang, message.targetLang);
    }
    sendResponse({ status: 'started' });
  }
  if (message.type === 'STOP_TRANSLATION') { stopTranslation(); sendResponse({ status: 'stopped' }); }
  if (message.type === 'GET_STATUS') {
    sendResponse({ 
    isTranslating,
    sourceLang: currentSourceLang,
    targetLang: currentTargetLang
    });
  }
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'audio-stream') return;
  activePort = port;
  port.onMessage.addListener((msg) => {
    if (msg.type === 'AUDIO_CHUNK' && socket && socket.readyState === WebSocket.OPEN) {
      const int16 = new Int16Array(msg.buffer);
      socket.send(int16.buffer);
    }
  });
  port.onDisconnect.addListener(() => { activePort = null; });
});

function openSocket(tabId, sourceLang, targetLang) {
  if (socket) { socket.close(); socket = null; }
  socket = new WebSocket(`${SERVER_URL}?sourceLang=${sourceLang}&targetLang=${targetLang}`);
  socket.onopen = () => {
    isTranslating = true; // ← ensure it stays true when new socket opens
    console.log(`WebSocket open: ${sourceLang} → ${targetLang}`);
  };
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'TRANSLATION') {
        chrome.tabs.sendMessage(tabId, { type: 'SHOW_SUBTITLE', text: data.text, live: data.live });
        if (!data.live) {
            chrome.tabs.sendMessage(tabId, { type: 'COMMIT_TRANSCRIPT' });
        }
      } else if (data.type === 'TRANSCRIPT') {
        chrome.tabs.sendMessage(tabId, { type: 'SHOW_TRANSCRIPT', text: data.text });
      }
    } catch (err) { console.error('Failed to parse server message:', err); }
  };
  socket.onerror = (err) => { console.error('WebSocket error:', err); stopTranslation(); };
  socket.onclose = () => {
    console.log('WebSocket closed');
    // Only mark as not translating if we didn't immediately open a new socket
    if (!socket) isTranslating = false;
  };
}

function reconnectSocket(tabId, sourceLang, targetLang) {
  console.log(`Switching languages: ${sourceLang} → ${targetLang}`);
  openSocket(tabId, sourceLang, targetLang);
  // Audio keeps streaming — no need to restart capture
}

async function startTranslation(tabId, sourceLang, targetLang) {
  isTranslating = true;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window._liveTranslatorLoaded
    });
    if (!result.result) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['src/overlay.css'] });
      console.log('Content script injected');
    }

    openSocket(tabId, sourceLang, targetLang);

    // Start audio capture (getDisplayMedia — one time only)
    chrome.tabs.sendMessage(tabId, { type: 'START_AUDIO_CAPTURE' });

  } catch (err) {
    console.error('Error starting translation:', err);
    isTranslating = false;
  }
}

function stopTranslation() {
  if (activeTabId) chrome.tabs.sendMessage(activeTabId, { type: 'STOP_AUDIO_CAPTURE' });
  if (socket) { socket.close(); socket = null; }
  if (activePort) { activePort.disconnect(); activePort = null; }
  isTranslating = false;
  activeTabId = null;
  currentSourceLang = null;
  currentTargetLang = null;
}