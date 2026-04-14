# tmux-agent-cli-note

[中文文档](README_zh.md)

A vim-like brainstorm note tool that runs inside tmux. Write notes, then send them directly to AI CLI agents (Claude Code, OpenCode, Codex, etc.) in the same tmux window.

## Features

- **Vim-like modal editor** — NORMAL / INSERT / COMMAND modes with familiar keybindings
- **Per-directory notes** — notes are stored in `.note/notes.json` under each working directory
- **Multi-agent support** — auto-detects all AI CLI panes, shows a selector when multiple are found
- **CJK friendly** — proper display width handling for Chinese/Japanese/Korean characters
- **Zero dependencies** — built with Node.js built-in modules only

## Requirements

- tmux 3.0+
- Node.js 18+
- Must be run inside a tmux session

## Install

```bash
npm install -g tmux-agent-cli-note
```

## Usage

Run `note` inside a tmux pane:

```bash
note
```

### Modes

| Mode | Description |
|------|-------------|
| NORMAL | Default mode. Navigate, enter other modes. |
| INSERT | Type text freely. Press `Esc` to return to NORMAL. |
| COMMAND | Type commands after `:`. Press `Enter` to execute. |
| LIST | Browse all notes in the current directory. |
| SELECT | Choose which AI agent to send to (when multiple found). |

### NORMAL Mode Keys

| Key | Action |
|-----|--------|
| `i` | Enter INSERT mode |
| `:` | Enter COMMAND mode |
| `q` | Quit editor, return to list |
| `h` `j` `k` `l` | Move cursor left / down / up / right |
| `x` | Delete character under cursor |
| `dd` | Delete current line |
| `g` | Go to top |
| `G` | Go to bottom |
| `A` | Append at end of line, enter INSERT |
| `o` | Open new line below, enter INSERT |
| `O` | Open new line above, enter INSERT |

### COMMAND Mode Keys

| Command | Action |
|---------|--------|
| `:s` | Send note content to AI agent pane |
| `:q` | Quit editor |
| `:w` | Save note |
| `:ls` | Return to note list |

### LIST Mode Keys

| Key | Action |
|-----|--------|
| `j` / `k` | Move selection up / down |
| `Enter` | Open selected note |
| `n` | Create new note |
| `d` | Delete selected note (with confirmation) |
| `q` | Quit |

### Send Flow

1. Press `:s` in NORMAL mode
2. Auto-detect AI agent panes in the current tmux window
3. **One agent found** — content is sent immediately
4. **Multiple agents found** — selector appears, press number to choose, `Esc` to cancel

Text is pasted into the agent's input box. It is **not** auto-submitted — you can review and edit before pressing Enter in the agent pane.

## Data Storage

Notes are stored per working directory:

```
your-project/
└── .note/
    └── notes.json
```

Example:

```json
{
  "directory": "/path/to/your-project",
  "notes": [
    {
      "id": "a1b2c3",
      "content": "Your brainstorm text...",
      "createdAt": "2026-04-14T16:00:00Z",
      "updatedAt": "2026-04-14T16:05:00Z",
      "sentAt": "2026-04-14T16:10:00Z"
    }
  ]
}
```

## License

MIT
