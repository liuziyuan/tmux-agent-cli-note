# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A vim-like brainstorm note TUI for tmux users working with AI CLI agents (Claude Code, OpenCode, Codex). Write notes in a modal editor and send them directly to AI CLI panes. Zero runtime dependencies — uses only Node.js built-in modules.

## Build & Development Commands

```bash
npm run dev           # Run via tsx (no build needed, fastest iteration)
npm run build         # Compile TypeScript to dist/
npm run typecheck     # Type check without emitting
npm run clean         # Remove dist/
```

No test framework is set up.

## Architecture

**Entry**: `bin/note.ts` — CLI argument parsing (`-v`, `-h`, `update`), tmux environment validation, then delegates to App.

**App controller** (`src/app.ts`): State machine with modes (LIST, EDITOR, CONFIRM, WAIT_KEY, SELECT). Uses EventEmitter for inter-component communication. Drives the main event loop — reads raw stdin, parses escape sequences, and dispatches to the active mode's handler.

**Modal editor** (`src/editor.ts`): NORMAL/INSERT/COMMAND modes with vim keybindings (`hjkl`, `dd`, `:s`, `:q`, etc.). Handles CJK wide characters for correct cursor positioning.

**List view** (`src/list-view.ts`): Note browser with scroll, delete confirmation, and empty state handling.

**Tmux integration** (`src/tux.ts`): Detects AI CLI agents (Claude Code, OpenCode, Codex) by inspecting pane commands and content. Sends text and Enter keys to target panes.

**Store** (`src/store.ts`): Per-directory persistence in `.note/notes.json`. CRUD operations with timestamp tracking (createdAt, updatedAt, sentAt).

**Screen** (`src/screen.ts`): Terminal abstraction using raw ANSI escape codes — title bar, status bar, cursor management, color support.

**Types** (`src/types.ts`): All interfaces, enums (EditorMode, AppState, AgentType), and event type definitions.

## Key Technical Details

- **Module system**: CommonJS (tsconfig `"module": "commonjs"`)
- **Node.js**: >=18.0.0 required
- **Storage**: `.note/notes.json` per working directory (gitignored)
- **Output**: `dist/` mirrors source structure after `npm run build`
- **Binary**: Published as `note` command via `bin` field in package.json
