import { execSync } from 'child_process';
import type { AgentPane, AgentInfo, TmuxPane, AgentType } from './types';

class Tmux {
  static isTmux(): boolean {
    return !!process.env.TMUX;
  }

  static isMouseEnabled(): boolean {
    try {
      const output = execSync('tmux show -gv mouse', { encoding: 'utf-8' }).trim();
      return output === 'on';
    } catch {
      return false;
    }
  }

  static currentPaneId(): string | undefined {
    return process.env.TMUX_PANE;
  }

  static listPanesInWindow(): TmuxPane[] {
    try {
      const output = execSync(
        'tmux list-panes -F "#{pane_id} #{pane_active} #{pane_index}"',
        { encoding: 'utf-8' }
      );
      return output.trim().split('\n').map(line => {
        const [id, active, index] = line.split(' ');
        return { id, active: active === '1', index: parseInt(index, 10) };
      });
    } catch {
      return [];
    }
  }

  static capturePane(paneId: string): string {
    try {
      return execSync(
        `tmux capture-pane -t ${paneId} -p -S -50`,
        { encoding: 'utf-8' }
      );
    } catch {
      return '';
    }
  }

  static findAgentPanes(): AgentPane[] {
    const myPane = Tmux.currentPaneId();
    const panes = Tmux.listPanesInWindow().filter(p => p.id !== myPane);
    const result: AgentPane[] = [];

    for (const pane of panes) {
      const agent = Tmux._detectAgent(pane.id);
      if (agent) {
        result.push({ id: pane.id, index: pane.index, ...agent });
      }
    }

    return result;
  }

  private static readonly SHELLS = new Set([
    'zsh', 'bash', 'fish', 'sh', 'dash', 'ksh', 'csh', 'tcsh', 'nu', 'pwsh', 'xonsh',
  ]);

  private static readonly AGENT_BY_CMD: Array<{ test: (cmd: string) => boolean; info: AgentInfo }> = [
    { test: cmd => cmd.includes('claude'), info: { type: 'claude', label: 'Claude Code' } },
    { test: cmd => cmd.includes('opencode'), info: { type: 'opencode', label: 'OpenCode' } },
    { test: cmd => cmd.includes('codex'), info: { type: 'codex', label: 'Codex' } },
    { test: cmd => cmd.includes('gemini'), info: { type: 'gemini', label: 'Gemini CLI' } },
    { test: cmd => cmd.includes('copilot'), info: { type: 'copilot', label: 'GitHub Copilot' } },
  ];

  private static _detectAgent(paneId: string): AgentInfo | null {
    let cmd = '';
    try {
      cmd = execSync(
        `tmux display-message -t ${paneId} -p '#{pane_current_command}'`,
        { encoding: 'utf-8' }
      ).trim().toLowerCase();
    } catch {
      /* ignore */
    }

    // Tier 1: exact command name match
    for (const { test, info } of Tmux.AGENT_BY_CMD) {
      if (test(cmd)) return info;
    }

    // Known shell → agent definitely not running
    if (Tmux.SHELLS.has(cmd)) return null;

    // Tier 2: Claude Code standalone binary shows version as command name (e.g. "2.1.112")
    if (/^\d+\.\d+\.\d+$/.test(cmd)) {
      const content = Tmux.capturePane(paneId);
      if (content.includes('⏺')) {
        return { type: 'claude', label: 'Claude Code' };
      }
    }

    // Tier 3: content fallback for wrapper commands (volta-shim, node, npx, etc.)
    // Only check recent output to avoid stale scrollback matches
    if (cmd && !Tmux.SHELLS.has(cmd)) {
      const bottom = Tmux._captureRecent(paneId);
      for (const { test, info } of Tmux.AGENT_BY_CMD) {
        if (test(bottom)) return info;
      }
    }

    return null;
  }

  /** Capture only the last 10 lines to reduce stale content false positives */
  private static _captureRecent(paneId: string): string {
    try {
      return execSync(
        `tmux capture-pane -t ${paneId} -p -S -10`,
        { encoding: 'utf-8' }
      ).toLowerCase();
    } catch {
      return '';
    }
  }

  static sendToPane(paneId: string, text: string): boolean {
    try {
      // load-buffer from stdin preserves real newlines (unlike set-buffer -w which mangles them)
      execSync('tmux load-buffer -', { input: text, encoding: 'utf-8' });
      execSync(`tmux paste-buffer -t ${paneId}`);
      return true;
    } catch {
      // Fallback: set-buffer with shell-escaped text
      try {
        execSync('tmux set-buffer -w -- ' + JSON.stringify(text), { encoding: 'utf-8' });
        execSync(`tmux paste-buffer -t ${paneId}`);
        return true;
      } catch {
        return false;
      }
    }
  }

  static sendEnterToPane(paneId: string): boolean {
    try {
      execSync(`tmux send-keys -t ${paneId} Enter`, { encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  }
}

export default Tmux;
