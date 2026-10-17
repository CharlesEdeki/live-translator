require('dotenv').config();
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Live Translator server is running' });
});

wss.on('connection', (ws, req) => {
  console.log('Extension connected');
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sourceLang = url.searchParams.get('sourceLang') || 'fr';
  const targetLang = url.searchParams.get('targetLang') || 'en';
  console.log(`Translating: ${sourceLang} → ${targetLang}`);

  const dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&language=${sourceLang}&punctuate=true&interim_results=true&smart_format=true`;

  const dgSocket = new WebSocket(dgUrl, {
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` }
  });

  const audioBuffer = [];
  let dgReady = false;

  dgSocket.on('open', () => {
    console.log('Deepgram connection open');
    dgReady = true;
    if (audioBuffer.length > 0) {
      console.log(`Flushing ${audioBuffer.length} buffered chunks to Deepgram`);
      for (const chunk of audioBuffer) dgSocket.send(chunk);
      audioBuffer.length = 0;
    }
  });

  dgSocket.on('message', (rawData) => {
    try {
      const data = JSON.parse(rawData.toString());
      if (data.type !== 'Results') return;
      const transcript = data.channel?.alternatives?.[0]?.transcript;
      if (!transcript || transcript.trim() === '') return;
      if (!data.is_final) return;
      console.log(`Transcript [${sourceLang}]: ${transcript}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'TRANSLATION',
          text: transcript,
          sourceLang,
          targetLang
        }));
      }
    } catch (err) {
      console.error('Processing error:', err.message);
    }
  });

  dgSocket.on('close', (code) => { console.log(`Deepgram closed: ${code}`); });
  dgSocket.on('error', (err) => { console.error('Deepgram error:', err.message); });

  let chunkCount = 0;
  ws.on('message', (audioChunk) => {
    chunkCount++;
    if (chunkCount === 1) {
      console.log('First audio chunk received, size:', audioChunk.length, 'bytes');
    }
    if (dgReady && dgSocket.readyState === WebSocket.OPEN) {
      dgSocket.send(audioChunk);
    } else if (dgSocket.readyState === WebSocket.CONNECTING) {
      audioBuffer.push(audioChunk);
    }
  });

  ws.on('close', () => {
    console.log('Extension disconnected');
    dgSocket.close();
  });

  ws.on('error', (err) => { console.error('Extension error:', err.message); });
});

server.listen(PORT, () => {
  console.log(`Live Translator server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

process.on('unhandledRejection', (reason) => { console.error('Unhandled rejection:', reason); });