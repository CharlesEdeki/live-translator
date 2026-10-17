(function() {
  // Prevent double-execution using IIFE + flag
  if (window._liveTranslatorLoaded) return;
  window._liveTranslatorLoaded = true;

  let hideTimeout = null;
  let port = null;

  function createOverlay() {
    if (document.getElementById('live-translator-overlay')) return;
    const div = document.createElement('div');
    div.id = 'live-translator-overlay';
    const p = document.createElement('p');
    p.id = 'live-translator-text';
    div.appendChild(p);
    document.body.appendChild(div);
    console.log('[LiveTranslator] Overlay created');
  }

  function showSubtitle(text, speaker) {
    const container = document.getElementById('live-translator-overlay');
    const textEl = document.getElementById('live-translator-text');
    if (!container || !textEl) {
      createOverlay();
      return showSubtitle(text, speaker);
    }
    textEl.innerHTML = speaker
      ? `<span class="speaker-label">${speaker}:</span> ${text}`
      : text;
    container.classList.add('visible');
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => container.classList.remove('visible'), 5000);
  }

  async function startAudioCapture() {
    try {
      console.log('[LiveTranslator] startAudioCapture called');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      console.log('[LiveTranslator] Got mic stream:', stream.getAudioTracks().length, 'audio tracks');
      port = chrome.runtime.connect({ name: 'audio-stream' });
      console.log('[LiveTranslator] Port connected to background');
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && port) {
          e.data.arrayBuffer().then(buffer => {
            try {
              port.postMessage({ type: 'AUDIO_CHUNK', buffer: Array.from(new Uint8Array(buffer)) });
            } catch (err) {
              console.warn('[LiveTranslator] Extension context lost, stopping');
              mediaRecorder.stop();
              port = null;
            }
          }).catch(() => {});
        }
      };
      mediaRecorder.start(250);
      console.log('[LiveTranslator] MediaRecorder started');
      window._liveTranslatorRecorder = mediaRecorder;
      window._liveTranslatorStream = stream;
    } catch (err) {
      console.error('[LiveTranslator] Audio capture error:', err.name, err.message);
    }
  }

  function stopAudioCapture() {
    if (window._liveTranslatorRecorder) {
      window._liveTranslatorRecorder.stop();
      window._liveTranslatorRecorder = null;
    }
    if (window._liveTranslatorStream) {
      window._liveTranslatorStream.getTracks().forEach(t => t.stop());
      window._liveTranslatorStream = null;
    }
    if (port) { port.disconnect(); port = null; }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'START_AUDIO_CAPTURE') startAudioCapture();
    if (message.type === 'STOP_AUDIO_CAPTURE') stopAudioCapture();
    if (message.type === 'SHOW_SUBTITLE') showSubtitle(message.text, message.speaker);
    if (message.type === 'HIDE_OVERLAY') {
      const c = document.getElementById('live-translator-overlay');
      if (c) c.classList.remove('visible');
    }
  });

  createOverlay();
  console.log('[LiveTranslator] Content script loaded');
})();