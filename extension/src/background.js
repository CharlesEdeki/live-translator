// Background service worker
// Runs silently behind the scenes — the brain of the extension
// Handles: audio capture, WebSocket connection to server, receiving translations

const SERVER_URL = 'ws://localhost:3000';

let socket = null;
let mediaRecorder = null;
let isTranslating = false;

// Listen for messages from the popup (start/stop button)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_TRANSLATION') {
    startTranslation(message.tabId);
    sendResponse({ status: 'started' });
  }

  if (message.type === 'STOP_TRANSLATION') {
    stopTranslation();
    sendResponse({ status: 'stopped' });
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({ isTranslating });
  }

  return true; // Required to use sendResponse asynchronously
});

async function startTranslation(tabId) {
  if (isTranslating) return;

  try {
    // Capture audio from the Meet tab
    const stream = await chrome.tabCapture.capture({
      audio: true,
      video: false
    });

    if (!stream) {
      console.error('Failed to capture tab audio');
      return;
    }

    // Connect to our relay server via WebSocket
    socket = new WebSocket(SERVER_URL);

    socket.onopen = () => {
      console.log('Connected to translation server');
      isTranslating = true;

      // Start recording and sending audio chunks to server
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
          socket.send(event.data);
        }
      };

      // Send audio in 250ms chunks for low latency
      mediaRecorder.start(250);
    };

    // Receive translated text from server and send to content script
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'TRANSLATION') {
        // Forward translation to the content script to display as subtitle
        chrome.tabs.sendMessage(tabId, {
          type: 'SHOW_SUBTITLE',
          text: data.text,
          speaker: data.speaker
        });
      }
    };

    socket.onerror = (err) => {
      console.error('WebSocket error:', err);
      stopTranslation();
    };

    socket.onclose = () => {
      console.log('Disconnected from translation server');
      isTranslating = false;
    };

  } catch (err) {
    console.error('Error starting translation:', err);
  }
}

function stopTranslation() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  if (socket) {
    socket.close();
    socket = null;
  }

  isTranslating = false;
  mediaRecorder = null;
}