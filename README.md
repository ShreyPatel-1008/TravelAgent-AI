# VoyageAgent

A React + Vite travel planning app that generates **day-by-day itineraries** from your destination, budget (INR), trip length, and activity preferences. The planner runs on **NVIDIA NIM** (OpenAI-compatible API) with a structured JSON itinerary used by maps and charts in the UI.

## Features

- **Inputs:** destination, budget, duration (days), toggles for adventure, cultural, food, etc.
- **Two-step AI flow:** draft plan → validate/optimize within budget.
- **Output:** itinerary with per-day activities, costs, coordinates (for maps), and weather summary.
- **UI:** dark/light theme, agent log console, budget gauge, charts (Recharts), export manifest.

## Prerequisites

- **Node.js** 18+ (recommended: current LTS)
- An **NVIDIA API key** from [NVIDIA Build](https://build.nvidia.com/) (format `nvapi-…`) for NIM serverless inference

## Quick start

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Environment variables**

   Create `.env.local` in the project root (this file is gitignored via `*.local`):

   | Variable | Required | Description |
   |----------|----------|-------------|
   | `NVIDIA_API_KEY` | Yes | Your `nvapi-…` key for [NVIDIA NIM](https://docs.api.nvidia.com/nim/reference/llm-apis) |
   | `NVIDIA_MODEL` | No | Model ID (default: `meta/llama-3.1-8b-instruct`). Use a model enabled on your NVIDIA account. |
   | `GOOGLE_MAPS_API_KEY` | Optional | For Google Maps / Places features if wired in the app |
   | `GEMINI_API_KEY` | Optional | Legacy; not used by the current planner service |

   Example:

   ```env
   NVIDIA_API_KEY=nvapi-your-key-here
   NVIDIA_MODEL=meta/llama-3.1-8b-instruct
   ```

3. **Run the dev server**

   ```bash
   npm run dev
   ```

   Open **http://localhost:3000** (see `vite.config.ts`).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (port 3000) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build locally |

## Tech stack

- **React 19**, **TypeScript**, **Vite 6**
- **NVIDIA NIM** via `openai` client (`baseURL`: `https://integrate.api.nvidia.com/v1`)
- **Recharts**, **Leaflet** / **react-leaflet**, **lucide-react**

## Security note

API keys are injected at build/dev time via Vite (`define`). Anything in `.env.local` ends up in the **client bundle**, so treat keys as visible to anyone who can load the built site. For production, call NIM from a **backend** and keep secrets on the server.

## Repository layout (high level)

- `App.tsx` — main UI and planning flow
- `services/geminiService.ts` — NVIDIA chat completions + itinerary JSON parsing
- `components/` — itinerary cards, budget gauge, agent log, etc.
- `types.ts` — shared TypeScript types

## License

Private project (`"private": true` in `package.json`).
