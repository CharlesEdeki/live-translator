(function() {
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
    if (!container || !textEl) { createOverlay(); return showSubtitle(text, speaker); }
    textEl.innerHTML = speaker ? `<span class="speaker-label">${speaker}:</span> ${text}` : text;
    container.classList.add('visible');
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => container.classList.remove('visible'), 5000);
  }

  // Downsample Float32 audio from sourceSampleRate to 16000 Hz
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

  // Convert Float32 samples (-1.0 to 1.0) to Int16 PCM bytes
  function float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const clamped = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }
    return int16Array;
  }

  async function startAudioCapture(streamId) {
    try {
      console.log('[LiveTranslator] startAudioCapture called');

      // Use getDisplayMedia to capture tab audio — user picks the Meet tab
      // This avoids the stream ID expiry problem with tabCapture in MV3
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,   // Chrome requires video:true for getDisplayMedia, we just ignore the track
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 16000
        }
      });

      // Drop the video track — we only want audio
      stream.getVideoTracks().forEach(t => t.stop());

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        console.error('[LiveTranslator] No audio track in display media stream. Make sure to check "Share audio" when prompted.');
        return;
      }
      console.log('[LiveTranslator] Got display media audio stream');

      port = chrome.runtime.connect({ name: 'audio-stream' });
      console.log('[LiveTranslator] Port connected to background');

      const audioContext = new AudioContext();
      const sourceSampleRate = audioContext.sampleRate;
      console.log('[LiveTranslator] AudioContext sample rate:', sourceSampleRate);

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const downsampled = downsampleBuffer(inputData, sourceSampleRate, 16000);
        const int16 = float32ToInt16(downsampled);
        if (port) {
          try {
            port.postMessage({ type: 'AUDIO_CHUNK', buffer: Array.from(int16) });
          } catch (err) {
            console.warn('[LiveTranslator] Extension context lost, stopping');
            processor.disconnect();
            source.disconnect();
            stream.getTracks().forEach(t => t.stop());
            port = null;
          }
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      window._liveTranslatorAudioContext = audioContext;
      window._liveTranslatorProcessor = processor;
      window._liveTranslatorSource = source;
      window._liveTranslatorStream = stream;

      console.log('[LiveTranslator] Tab audio capture started via displayMedia');
    } catch (err) {
      console.error('[LiveTranslator] Audio capture error:', err.name, err.message);
    }
  }

  function stopAudioCapture() {
    if (window._liveTranslatorProcessor) {
      window._liveTranslatorProcessor.disconnect();
      window._liveTranslatorProcessor = null;
    }
    if (window._liveTranslatorSource) {
      window._liveTranslatorSource.disconnect();
      window._liveTranslatorSource = null;
    }
    if (window._liveTranslatorAudioContext) {
      window._liveTranslatorAudioContext.close();
      window._liveTranslatorAudioContext = null;
    }
    if (window._liveTranslatorStream) {
      window._liveTranslatorStream.getTracks().forEach(t => t.stop());
      window._liveTranslatorStream = null;
    }
    if (port) {
      port.disconnect();
      port = null;
    }
    console.log('[LiveTranslator] Audio capture stopped');
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'START_AUDIO_CAPTURE') startAudioCapture(message.streamId);
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