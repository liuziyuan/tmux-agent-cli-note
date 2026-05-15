#!/usr/bin/env bash
# Sets @agent-session-id on the Claude Code pane via tmux user options.
# Installed as a UserPromptSubmit hook in ~/.claude/settings.json.
set -euo pipefail

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""' 2>/dev/null)

[ -z "$SESSION_ID" ] && exit 0

# Resolve TMUX_PANE (hook subprocess may not inherit it)
if [ -z "${TMUX_PANE:-}" ]; then
  if [ -n "${TMUX:-}" ] || command -v tmux &>/dev/null; then
    check_pid=$$
    while [ "${check_pid:-0}" -gt 1 ]; do
      found=$(tmux list-panes -a -F "#{pane_id} #{pane_pid}" 2>/dev/null \
              | awk -v pid="$check_pid" '$2==pid{print $1; exit}')
      if [ -n "$found" ]; then TMUX_PANE="$found"; break; fi
      check_pid=$(ps -o ppid= -p "$check_pid" 2>/dev/null | tr -d '[:space:]')
    done
  fi
fi

[ -z "${TMUX_PANE:-}" ] && exit 0

tmux set-option -pt "$TMUX_PANE" @agent-session-id "$SESSION_ID" 2>/dev/null || true
