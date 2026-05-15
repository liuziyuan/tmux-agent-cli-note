# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A vim-like brainstorm note TUI for tmux users working with AI CLI agents (Claude Code, OpenCode, Codex). Write notes in a modal editor and send them directly to AI CLI panes. Zero runtime dependencies — uses only Node.js built-in modules.

## Build & Development Commands

```bash
npm run dev           # Run via tsx (no build needed, fastest iteration)
npm run dev:args -- <args>  # Run with CLI arguments (e.g. -- update)
npm run dev:build     # Build then run compiled output
npm run build         # Compile TypeScript to dist/
npm run typecheck     # Type check without emitting
npm run build:watch   # Compile on file changes
npm run clean         # Remove dist/
```

No test framework is set up.

## Architecture

**Entry** (`bin/note.ts`): CLI argument parsing (`-v`, `-h`, `update`, `setup-hooks`), tmux environment check, then delegates to App. The `update` command reads the current version from package.json and runs `npm install -g` for self-update. The `setup-hooks` command installs Claude Code SessionStart hook into `~/.claude/settings.json` and marks hooks as bound in config.

**App controller** (`src/app.ts`): State machine with states (LIST, EDITOR, CONFIRM, WAIT_KEY, SELECT). Owns the main event loop — reads raw stdin, buffers escape sequences via `_parseKeys` (handles bare Esc with a 50ms timer vs multi-byte escape sequences like `\x1b[A`), then dispatches to the active state's handler via `_dispatchKey`. All mode transitions and view lifecycle are managed here.

**Modal editor** (`src/editor.ts`): NORMAL/INSERT/COMMAND modes with vim keybindings. CJK-aware: `displayWidth()` and `isWide()` treat CJK characters as 2 columns for correct cursor positioning and line truncation. Uses `pendingDelete` flag for the `dd` key sequence. Emits typed events (`quit`, `send`, `list`) via EventEmitter — App subscribes to these to drive state transitions.

**List view** (`src/list-view.ts`): Note browser with scroll offset, delete confirmation (`confirmDelete` flag), and empty state. Same EventEmitter pattern as Editor — emits `select`, `new`, `quit`, `empty`.

**Tmux integration** (`src/tux.ts`): Agent detection is a three-tier fallback: (1) check `pane_current_command` for known binary names, (2) version-formatted commands (e.g. `2.1.142`) identified as Claude Code, (3) wrapper commands (volta-shim, node, npx) checked via captured pane content. Sending uses `tmux set-buffer/load-buffer` + `paste-buffer` to handle multi-line text. `getSessionId()` reads `@agent-session-id` from tmux pane user options — set by the Claude Code SessionStart hook via `hooks/set-agent-session-id.sh`.

**Screen** (`src/screen.ts`): Terminal abstraction layer. Exports both a `Screen` class and a bare `ANSI` object (used directly by Editor and ListView for inline formatting). Layout: row 1 = title bar, rows 2..N-1 = content area, row N-1 = status bar, row N = command line. `contentHeight()` returns `rows - 3`.

**Store** (`src/store.ts`): Per-directory JSON persistence in `.note/notes.json`. Reads/writes the full file on every operation (no incremental writes). Note IDs are 6-char hex from `crypto.randomBytes(3)`. Notes track `sentToPane` (tmux pane ID) and `sessionId` (Claude Code session ID). `markSent()` writes both fields. Backward compatible — missing fields default to `null`.

**Config** (`src/config.ts`): User config at `~/.note-config.json`. Supports `cursor.insertStyle` (`"on"` for block cursor in insert mode, `"after"` for bar cursor) and `hooks.claude.bound` (`true`/`false`/`null` — `null` means never prompted). `setHooksBound()` and `isHooksBound()` manage the hooks binding state. Falls back to defaults on missing/invalid config.

**Types** (`src/types.ts`): All interfaces and const enums. `EditorMode` and `AppState` are const enums but Editor re-declares EditorMode as a plain object to avoid const enum inlining issues across files.

## Key Technical Details

- **Module system**: CommonJS (`tsconfig "module": "commonjs"`)
- **Node.js**: >=18.0.0 required
- **Runtime requirement**: Must be inside a tmux session (`TMUX` env var checked at startup)
- **Storage**: `.note/notes.json` per working directory (gitignored)
- **Output**: `dist/` mirrors source structure after `npm run build`
- **Binary**: Published as `note` command via `bin` field in package.json

## CI/CD

- **PR checks** (`.github/workflows/ci.yml`): Runs on PRs to `main` — `npm audit --audit-level=high`, `npm run build`, `tsc --noEmit`
- **Auto-publish** (`.github/workflows/publish.yml`): On push to `main`, compares package.json version against npm registry. If new version, publishes to npm with provenance, creates git tag, and creates GitHub Release with auto-generated release notes. Requires `NPM_TOKEN` secret.
