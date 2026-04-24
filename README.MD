# Hermes Desktop Agent

Hermes Desktop Agent is an Electron-based desktop shell for Hermes Agent, designed to run well inside WSL2/WSLg while still reaching Windows-native capabilities when needed.

It combines three pieces into one workspace:

- a desktop chat window for talking to Hermes
- a bridge from Electron to a local `hermes chat` process over stdio
- a WSL-to-Windows interop layer for path conversion, Explorer reveal, default-app open, and clipboard access

## What it does

- Electron desktop app with a custom title bar, always-on-top toggle, minimize, tray menu, and `Super+H` global shortcut
- React + Vite + Tailwind renderer with a three-panel layout:
  - Skills panel
  - Chat panel
  - Workspace panel
- Hermes bridge in the main process that normalizes stdout/stderr events and streams assistant responses into the UI
- Safe preload bridge via `contextBridge`
- Windows interop helpers for:
  - converting WSL paths to Windows paths
  - revealing the workspace in Windows Explorer
  - opening the workspace with the Windows default app
  - reading and writing the Windows clipboard
- Chat usability improvements:
  - Markdown-like rendering in message bubbles
  - inline code and fenced code block display
  - lightweight built-in code highlighting
  - `Enter` to send, `Shift+Enter` to insert a newline

## Current project status

Implemented today:

- project scaffold and desktop shell are in place
- window/tray/shortcut behavior is wired
- Hermes stdio bridge and preload bridge are working
- Windows interop is connected to the UI
- chat supports streaming updates, Markdown-style display, and keyboard send

Still incomplete:

- workspace file tree is still placeholder data, not a live filesystem tree
- tool calls and tool results do not yet have dedicated rich cards
- Markdown support is intentionally lightweight rather than full CommonMark

## Tech stack

- Electron
- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- Framer Motion
- Zustand

## Project structure

```text
hermes-desktop-agent/
├── electron/                 # Electron main process, preload, Hermes bridge, Windows interop
├── src/                      # React renderer
│   ├── components/           # Shared UI pieces
│   ├── panels/               # Skills / Chat / Workspace panels
│   ├── store/                # Zustand stores
│   └── lib/                  # Small utilities
├── scripts/                  # Helper scripts such as dbus launcher
├── changelog/                # Daily development notes
├── PLAN.md                   # Working implementation plan
├── package.json
└── README.MD
```

## Requirements

Recommended environment:

- Linux under WSL2 with WSLg available
- Node.js 20+
- npm 10+
- Hermes CLI installed and available on `PATH`
- a configured Hermes home directory, typically `~/.hermes/`

For Windows interop features, the environment should also expose:

- `wslpath`
- `powershell.exe`
- Windows clipboard access from WSL

## Install

If dependencies are not already installed:

```bash
npm install
```

If Electron postinstall is blocked in your environment, you may need the same workaround noted in the changelog:

```bash
npm install --ignore-scripts
```

## Development

Start the full desktop app in development mode:

```bash
npm run dev
```

This runs:

- Vite dev server for the renderer
- TypeScript watch build for Electron code
- Electron itself, pointed at the local Vite server

When the app is running:

- `Super+H` toggles window visibility
- tray menu supports show/hide, always-on-top, and quit
- the title bar supports pin, minimize, and close app

## Production build

Build both renderer and Electron code:

```bash
npm run build
```

Preview the built app:

```bash
npm run electron:preview
```

## Basic usage

### 1. Launch the app

Run `npm run dev` while developing, or `npm run electron:preview` after building.

### 2. Send a prompt to Hermes

Type into the chat box and:

- press `Enter` to send
- press `Shift+Enter` to add a new line

Hermes responses stream into the chat panel as they arrive.

### 3. Read chat output

Assistant messages support:

- headings
- lists
- blockquotes
- links
- inline code
- fenced code blocks

### 4. Use workspace interop actions

From the workspace panel you can:

- inspect the current WSL workspace path
- see the mapped Windows path when available
- reveal the workspace in Explorer
- open it with the Windows default app
- read from or write to the Windows clipboard

### 5. Check the active Hermes config

The skills/config panel reads the current Hermes provider/model from `~/.hermes/config.yaml` and also lists installed Hermes skills discovered from `~/.hermes/skills/`.

## Notes and caveats

- The app expects `hermes` to be invokable from the Electron process environment.
- In sandboxed environments, local port binding for Vite may require elevated execution.
- Production Electron runs may still show development-oriented security warnings until a stricter CSP is added.
- The current Markdown renderer is custom and intentionally dependency-light.

## Useful commands

```bash
npm run dev
npm run build
npm run electron:preview
```

## Changelog

Development notes are kept in `changelog/`.

- `changelog/2026-04-23.md`
- `changelog/2026-04-24.md`
