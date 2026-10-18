# Live Translator

A real-time voice translation tool for Google Meet. Speaks and listens in one language, translates live into another — as subtitles or spoken audio.

## Features
- 🎙️ Live speech-to-text via Deepgram
- 🌍 Real-time translation via Google Gemini
- 💬 Subtitle overlay inside Google Meet
- 🔊 Voice output (coming soon)
- 🌐 Language pair configurable (default: French ↔ English)

## Architecture
- **Chrome Extension** — captures Meet audio, displays subtitle overlay
- **Node Relay Server** — holds API keys, connects to Deepgram and Gemini

## Getting Started
_Setup instructions coming soon._

## Roadmap
- [x] Repo structure and branching
- [ ] Subtitle pipeline (Deepgram + Gemini + overlay)
- [ ] Voice output (text-to-speech + virtual audio routing)
- [ ] Multi-language support
- [ ] Firefox support

## License
MIT