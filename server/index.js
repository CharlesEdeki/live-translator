require('dotenv').config();
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const https = require('https');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Live Translator server is running' });
});

// Language code mapping: our codes → DeepL codes
const DEEPL_LANG_MAP = {
  'en': 'EN',
  'fr': 'FR',
  'es': 'ES',
  'de': 'DE',
  'it': 'IT',
  'pt': 'PT',
  'nl': 'NL',
  'pl': 'PL',
  'ru': 'RU',
  'ja': 'JA',
  'zh': 'ZH',
  'ar': 'AR'
};

async function translate(text, sourceLang, targetLang) {
  const sourceCode = DEEPL_LANG_MAP[sourceLang] || sourceLang.toUpperCase();
  const targetCode = DEEPL_LANG_MAP[targetLang] || targetLang.toUpperCase();

  const body = JSON.stringify({
    text: [text],
    source_lang: sourceCode,
    target_lang: targetCode
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api-free.deepl.com',
      path: '/v2/translate',
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.translations && parsed.translations[0]) {
            resolve(parsed.translations[0].text);
          } else {
            reject(new Error('No translation in response: ' + data));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

wss.on('connection', (ws, req) => {
  console.log('Extension connected');
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sourceLang = url.searchParams.get('sourceLang') || 'fr';
  const targetLang = url.searchParams.get('targetLang') || 'en';
  console.log(`Translating: ${sourceLang} → ${targetLang}`);

  const model_name = sourceLang === 'en' ? 'flux-general-en' : 'flux-general-multi';

  const dgUrl = [
    `wss://api.deepgram.com/v2/listen`,
    `?model=${model_name}`,
    `&encoding=linear16`,
    `&sample_rate=16000`,
    `&eot_threshold=0.5`  // lower = faster end of turn (was 0.7)
  ].join('');

  console.log('Connecting to Deepgram:', dgUrl);

  const dgSocket = new WebSocket(dgUrl, {
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` }
  });

  const audioBuffer = [];
  let dgReady = false;

  dgSocket.on('open', () => {
    console.log('Deepgram Flux connection open');
    dgReady = true;
    if (audioBuffer.length > 0) {
      console.log(`Flushing ${audioBuffer.length} buffered chunks`);
      for (const chunk of audioBuffer) dgSocket.send(chunk);
      audioBuffer.length = 0;
    }
  });

  dgSocket.on('message', async (rawData) => {
    try {
      const data = JSON.parse(rawData.toString());
      if (data.type !== 'TurnInfo') return;
      const { event, transcript, turn_index, end_of_turn_confidence } = data;
      if (!transcript || transcript.trim() === '') return;
      console.log(`[Turn ${turn_index}] ${event} (eot: ${end_of_turn_confidence?.toFixed(2)}): ${transcript}`);

      if (event === 'StartOfTurn' || event === 'Update') {
        // Translate incrementally — show live translated subtitle
        let outputText = transcript;
        if (sourceLang !== targetLang) {
          try {
            outputText = await translate(transcript, sourceLang, targetLang);
          } catch (err) {
            outputText = transcript; // fall back to raw if translation fails
          }
        }
        if (ws.readyState === WebSocket.OPEN) {
          // LIVE = true means "replace current subtitle, don't stack yet"
          ws.send(JSON.stringify({ type: 'TRANSLATION', text: outputText, live: true }));
        }
      }

      if (event === 'EndOfTurn') {
        let outputText = transcript;
        if (sourceLang !== targetLang) {
          try {
            outputText = await translate(transcript, sourceLang, targetLang);
            console.log(`Final translation: ${outputText}`);
          } catch (err) {
            outputText = transcript;
          }
        }
        if (ws.readyState === WebSocket.OPEN) {
          // LIVE = false means "commit this to the queue and start fresh"
          ws.send(JSON.stringify({ type: 'TRANSLATION', text: outputText, live: false }));
        }
      }
    } catch (err) { console.error('Processing error:', err.message); }
  });

  dgSocket.on('close', (code) => { console.log(`Deepgram closed: ${code}`); });
  dgSocket.on('error', (err) => { console.error('Deepgram error:', err.message); });

  let chunkCount = 0;
  ws.on('message', (audioChunk) => {
    chunkCount++;
    if (chunkCount === 1) console.log('First audio chunk received, size:', audioChunk.length, 'bytes');
    if (dgReady && dgSocket.readyState === WebSocket.OPEN) {
      dgSocket.send(audioChunk);
    } else if (dgSocket.readyState === WebSocket.CONNECTING) {
      audioBuffer.push(audioChunk);
    }
  });

  ws.on('close', () => { console.log('Extension disconnected'); dgSocket.close(); });
  ws.on('error', (err) => { console.error('Extension error:', err.message); });
});

server.listen(PORT, () => {
  console.log(`Live Translator server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

process.on('unhandledRejection', (reason) => { console.error('Unhandled rejection:', reason); });