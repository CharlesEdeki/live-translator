(function() {
  if (window._liveTranslatorLoaded) return;
  window._liveTranslatorLoaded = true;

  let port = null;
  const SUBTITLE_LIFETIME = 6000; // ms each subtitle stays on screen

  // ── Subtitle queue ──────────────────────────────────────
  const subtitleQueue = []; // { el, timer }

  function createOverlay() {
    if (document.getElementById('live-translator-overlay')) return;
    const el = document.createElement('div');
    el.id = 'live-translator-overlay';
    document.body.appendChild(el);

    const tr = document.createElement('div');
    tr.id = 'live-translator-transcript';
    document.body.appendChild(tr);
  }

  function showSubtitle(text) {
    const overlay = document.getElementById('live-translator-overlay');
    if (!overlay) return;

    // Create new subtitle element
    const el = document.createElement('div');
    el.className = 'lt-subtitle';
    el.textContent = text;
    overlay.appendChild(el);

    // Schedule fade-out and removal
    const fadeTimer = setTimeout(() => {
      el.classList.add('lt-fading');
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
        // Remove from queue tracking
        const idx = subtitleQueue.findIndex(s => s.el === el);
        if (idx !== -1) subtitleQueue.splice(idx, 1);
      }, 500); // matches CSS transition duration
    }, SUBTITLE_LIFETIME);

    subtitleQueue.push({ el, timer: fadeTimer });

    // Keep at most 3 subtitles visible — evict oldest if needed
    if (subtitleQueue.length > 3) {
      const oldest = subtitleQueue.shift();
      clearTimeout(oldest.timer);
      oldest.el.classList.add('lt-fading');
      setTimeout(() => {
        if (oldest.el.parentNode) oldest.el.parentNode.removeChild(oldest.el);
      }, 500);
    }
  }

  function showTranscript(text) {
    const panel = document.getElementById('live-translator-transcript');
    if (!panel) return;

    // De-emphasise previous current line
    const prev = panel.querySelector('.lt-current');
    if (prev) prev.classList.remove('lt-current');

    // Update or create the live line
    let liveLine = panel.querySelector('.lt-live');
    if (!liveLine) {
      liveLine = document.createElement('p');
      liveLine.className = 'lt-live lt-current';
      panel.appendChild(liveLine);
    } else {
      liveLine.classList.add('lt-current');
    }
    liveLine.textContent = text;

    // Scroll to bottom
    panel.scrollTop = panel.scrollHeight;
  }

  function commitTranscriptLine() {
    // When a turn ends, freeze the live line into a static past line
    const panel = document.getElementById('live-translator-transcript');
    if (!panel) return;
    const liveLine = panel.querySelector('.lt-live');
    if (liveLine) {
      liveLine.classList.remove('lt-live', 'lt-current');
      // Keep only last 10 lines in the panel
      const lines = panel.querySelectorAll('p');
      if (lines.length > 10) lines[0].remove();
    }
  }

  // ── Audio pipeline ──────────────────────────────────────
  function downsampleBuffer(buffer, sourceSampleRate, targetSampleRate) {
    if (sourceSampleRate === targetSampleRate) return buffer;
    const ratio = sourceSampleRate / targetSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(Math.floor((i + 1) * ratio), buffer.length);
      let sum = 0;
      for (let j = start; j < end; j++) sum += buffer[j];
      result[i] = sum / (end - start);
    }
    return result;
  }

  function float32ToInt16(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  }

  async function setupAudioPipeline(stream) {
    port = chrome.runtime.connect({ name: 'audio-stream' });
    const audioContext = new AudioContext();
    const sourceSampleRate = audioContext.sampleRate;
    const workletUrl = chrome.runtime.getURL('src/audio-processor.js');
    await audioContext.audioWorklet.addModule(workletUrl);
    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
    workletNode.port.onmessage = (e) => {
      const float32 = e.data;
      const downsampled = downsampleBuffer(float32, sourceSampleRate, 16000);
      const int16 = float32ToInt16(downsampled);
      if (port) {
        try { port.postMessage({ type: 'AUDIO_CHUNK', buffer: Array.from(int16) }); }
        catch (err) { console.error('[LiveTranslator] Port error:', err); }
      }
    };
    source.connect(workletNode);
    window._liveTranslatorAudioContext = audioContext;
    window._liveTranslatorWorkletNode = workletNode;
    window._liveTranslatorSource = source;
    window._liveTranslatorStream = stream;
  }

  async function startAudioCapture() {
    if (window._liveTranslatorStream) {
      console.log('[LiveTranslator] Stream already active, skipping capture');
      return;
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 16000 }
    });
    stream.getVideoTracks().forEach(t => t.stop());
    await setupAudioPipeline(stream);
  }

  function stopAudioCapture() {
    if (window._liveTranslatorWorkletNode) { window._liveTranslatorWorkletNode.disconnect(); window._liveTranslatorWorkletNode = null; }
    if (window._liveTranslatorSource) { window._liveTranslatorSource.disconnect(); window._liveTranslatorSource = null; }
    if (window._liveTranslatorAudioContext) { window._liveTranslatorAudioContext.close(); window._liveTranslatorAudioContext = null; }
    if (window._liveTranslatorStream) { window._liveTranslatorStream.getTracks().forEach(t => t.stop()); window._liveTranslatorStream = null; }
    if (port) { port.disconnect(); port = null; }

    // Clear subtitle queue
    subtitleQueue.forEach(s => { clearTimeout(s.timer); if (s.el.parentNode) s.el.parentNode.removeChild(s.el); });
    subtitleQueue.length = 0;
  }

  // ── Message handler ─────────────────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'START_AUDIO_CAPTURE') startAudioCapture();
    if (message.type === 'STOP_AUDIO_CAPTURE') stopAudioCapture();
    if (message.type === 'SHOW_SUBTITLE') showSubtitle(message.text);   // final translation
    if (message.type === 'SHOW_TRANSCRIPT') {                           // live STT
      showTranscript(message.text);
    }
    if (message.type === 'COMMIT_TRANSCRIPT') commitTranscriptLine();
    if (message.type === 'HIDE_OVERLAY') {
      const overlay = document.getElementById('live-translator-overlay');
      if (overlay) overlay.style.display = 'none';
    }
  });

  createOverlay();
})();