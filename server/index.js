require('dotenv').config();

const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Basic health check endpoint
// Hit this in your browser at http://localhost:3000/health to confirm server is running
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Live Translator server is running' });
});

// WebSocket connection handler
// The Chrome extension will connect here to stream audio and receive translations
wss.on('connection', (ws) => {
  console.log('Extension connected');

  ws.on('message', (message) => {
    // For now just log that we received something
    // We will replace this with real audio processing shortly
    console.log('Received message from extension, size:', message.length, 'bytes');
  });

  ws.on('close', () => {
    console.log('Extension disconnected');
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`Live Translator server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});