# Trace | OSINT Canvas

**Trace** (`trace-osint`) is a visual, node-based Open Source Intelligence (OSINT) and digital forensics investigation platform. Built around an infinite interactive canvas, Trace combines multi-project case management, client-side image/audio/video forensics, real-time mobile field capture sync, native cross-platform username pivoting, and multi-provider AI synthesis in a single self-hosted Node process.

---

## Key Capabilities

- **Infinite Node-Based Investigation Canvas**: Wire evidence frames, metadata extractors, forensic filters, geolocation nodes, and AI analysis threads together using directed visual pipelines.
- **Multi-Project Case Dashboard**: Create, rename, switch between, and persist multiple independent OSINT investigations automatically in browser IndexedDB, or export complete case files (`osint_case.json`).
- **Real-Time Mobile Companion Sync**: Capture or select field photos on your phone and beam them directly onto the desktop canvas over a zero-configuration WebSocket relay (`/sync`) from the built-in mobile web app (`/mobile`).
- **Multi-Provider AI Synthesis (BYOK)**: Connect Google Gemini, OpenAI, Anthropic Claude, OpenRouter, DeepSeek, or Mistral for multimodal visual reasoning, GEOINT clue extraction, targeted Google Dork synthesis, and forensic suspect composites.

---

## OSINT & Forensics Nodes

| Node | Purpose |
| :--- | :--- |
| **Image Node** | Evidence frame container supporting local upload, drag-and-drop, interactive region cropping (spawning child nodes), and live mobile WebSocket injection. |
| **Chat & Result Nodes** | Dual-handle AI analyst thread supporting **Global Context** (outer edge) and **Specific Prompt Context** (inner dock) across wired images, OCR text, and EXIF metadata. |
| **OCR Node** | In-browser optical character recognition powered by Tesseract.js Web Workers for extracting signage, badges, license plates, and document text. |
| **EXIF Node** | Binary EXIF/IPTC/XMP metadata parser extracting camera make/model, capture timestamps, and decimal GPS coordinates. |
| **Enhance Node** | Client-side 2x/4x bicubic super-resolution upscaling with a 3×3 sharpening convolution filter for low-resolution crops. |
| **Forensics Node (ELA)** | Error Level Analysis (ELA) recompression engine with adjustable diff amplification (`5x`–`40x`) to highlight spliced or digitally manipulated regions. |
| **Face Node** | Neural face detection (`@vladmandic/face-api` SSD MobileNetV1) that draws confidence bounding boxes and extracts isolated face crops. |
| **Video Node** | HTML5 video timeline scrubber and batch interval frame extractor (`1s` / `5s` intervals) that spawns individual `ImageNode` frames onto the canvas. |
| **Doppler Node** | Acoustic forensics analyzer using the Web Audio API and a Radix-2 Cooley-Tukey FFT engine to render spectrograms and estimate source velocity / closest point of approach (CPA). |
| **Map Node** | Interactive Leaflet / OpenStreetMap geospatial viewer that plots GPS coordinates automatically from upstream `ExifNode` or `ChatNode` findings. |
| **Reverse Search Node** | Multi-engine visual reverse search launcher for Google Lens, Yandex Images, and TinEye. |
| **GeoIntel Node** | Multimodal AI GEOINT analyst that inspects connected frames for architecture, vegetation, sun/shadow azimuth, driving side, signage, and utility infrastructure. |
| **GeoSpy Node** | AI geolocation prediction node estimating latitude, longitude, confidence score, and location summary via `/api/osint/geospy`. |
| **Dork Node** | Automated Google Dork generator that synthesizes 10 advanced search queries (`site:`, `inurl:`, `filetype:`, `intitle:`, `intext:`) from connected OCR, EXIF, or Chat text across *General OSINT*, *Social Media*, *Vulnerable Servers*, or *Documents/Leaks*. |
| **Pivot Node** | Native JavaScript cross-platform username reconnaissance engine that checks 7 platforms in parallel (**GitHub, Reddit, Instagram, TikTok, Pinterest, Twitch, Steam**) with 5-second `AbortController` timeouts and soft-404 / WAF detection. |
| **Suspect Node** | Forensic composite generator combining analyst descriptions with connected OCR/Chat/Image context via Google Imagen 3 (`imagen-3.0-generate-001`) or OpenAI DALL-E 3 (`dall-e-3`). |

---

## Installation & Quick Start

### Option 1: Global CLI Installation (Recommended)

Install `trace-osint` globally via `npm` or `pnpm` to launch Trace from any terminal like `n8n`:

```bash
npm install -g trace-osint
# Or using pnpm:
pnpm add -g trace-osint
```

Start the production server:

```bash
trace
```

By default, Trace binds to `http://0.0.0.0:3000`:
- **Desktop OSINT Canvas**: [http://localhost:3000](http://localhost:3000)
- **Mobile Companion App**: [http://localhost:3000/mobile](http://localhost:3000/mobile) (or `http://<YOUR_LAN_IP>:3000/mobile` from a phone on the same Wi-Fi network)
- **WebSocket Sync Relay**: `ws://localhost:3000/sync`

To run on a custom port:

```bash
PORT=8080 trace
```

---

### Option 2: Local Development from Source

1. **Clone the repository and install dependencies**:
   ```bash
   git clone https://github.com/mahimr837-stack/Osint.git
   cd Osint
   pnpm install
   cd mobile && pnpm install && cd ..
   ```

2. **Start the development server (with Vite HMR + WebSocket & OSINT APIs on port 3000)**:
   ```bash
   pnpm dev
   ```

3. **Build for production (Desktop + Mobile + Bundled Server)**:
   ```bash
   pnpm build
   pnpm start
   ```

4. **Install globally from your local checkout**:
   ```bash
   pnpm add -g .
   trace
   ```

---

## Bring Your Own Key (BYOK)

Trace uses a **Bring Your Own Key (BYOK)** architecture so you control your own AI provider credentials and usage:

1. Open the **Trace Dashboard** at [http://localhost:3000](http://localhost:3000).
2. Click the **Settings (gear icon)** in the top-right navigation bar next to **New Project**.
3. Select your preferred **AI Provider**:
   - **Google** (`GEMINI_API_KEY` — Gemini 2.5 / 3.1 / 4 & Imagen 3)
   - **OpenAI** (`OPENAI_API_KEY` — GPT-4o / GPT-4.1 / o4-mini & DALL-E 3)
   - **Anthropic** (`ANTHROPIC_API_KEY` — Claude 3.5 / 3.7 Sonnet & Haiku)
   - **OpenRouter** (`OPENROUTER_API_KEY` — Multi-model router)
   - **DeepSeek** (`DEEPSEEK_API_KEY` — DeepSeek Chat & Reasoner)
   - **Mistral** (`MISTRAL_API_KEY` — Pixtral Large & Mistral Large)
4. Paste your **API Key**, choose a preset or custom model identifier, and click **Save Settings**.

Your provider selection and API key are stored locally in your browser's `localStorage` and persist across all investigations and page reloads. If no key is configured, AI-powered nodes (`ChatNode`, `DorkNode`, `GeoIntelNode`, `SuspectNode`) will prompt you with:
> *"Please set your API key in the Dashboard Settings."*

### Optional Server Environment Variables (`.env`)

You can also copy `.env.example` to `.env` to provide server-level fallback keys or configure CORS and timeouts:

```dotenv
GEMINI_API_KEY=
GEOSPY_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=
DEEPSEEK_API_KEY=
MISTRAL_API_KEY=
PORT=3000
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
OSINT_TIMEOUT_MS=5000
```

---

## Testing

Run the unit test suite and the live server smoke test:

```bash
# Run unit tests (97 tests across graph, forensics, dorks, pivot, and global settings)
pnpm exec tsx --test src/utils/*.test.ts

# Run end-to-end HTTP + WebSocket + Native OSINT smoke test against port 3000
node scripts/smoke-test.js
```
