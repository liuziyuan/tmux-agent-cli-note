import { execSync } from 'child_process';
import type { AgentPane, AgentInfo, TmuxPane, AgentType } from './types';

class Tmux {
  static isTmux(): boolean {
    return !!process.env.TMUX;
  }

  static currentPaneId(): string | undefined {
    return process.env.TMUX_PANE;
  }

  static listPanesInWindow(): TmuxPane[] {
    try {
      const output = execSync(
        'tmux list-panes -F "#{pane_id} #{pane_active}"',
        { encoding: 'utf-8' }
      );
      return output.trim().split('\n').map(line => {
        const [id, active] = line.split(' ');
        return { id, active: active === '1' };
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
        result.push({ id: pane.id, ...agent });
      }
    }

    return result;
  }

  private static _detectAgent(paneId: string): AgentInfo | null {
    // Check command name first (most reliable)
    try {
      const cmd = execSync(
        `tmux display-message -t ${paneId} -p '#{pane_current_command}'`,
        { encoding: 'utf-8' }
      ).trim().toLowerCase();

      if (cmd.includes('claude')) {
        return { type: 'claude', label: 'Claude Code' };
      }
      if (cmd.includes('opencode')) {
        return { type: 'opencode', label: 'OpenCode' };
      }
      if (cmd.includes('codex')) {
        return { type: 'codex', label: 'Codex' };
      }
    } catch {
      /* ignore */
    }

    // Fallback: inspect pane content
    const content = Tmux.capturePane(paneId).toLowerCase();
    if (content.includes('claude')) {
      return { type: 'claude', label: 'Claude Code' };
    }
    if (content.includes('opencode')) {
      return { type: 'opencode', label: 'OpenCode' };
    }
    if (content.includes('codex')) {
      return { type: 'codex', label: 'Codex' };
    }

    // Last resort: any pane with a rich prompt indicator (likely an AI tool)
    if (content.includes('❯')) {
      return { type: 'unknown', label: 'Unknown Agent' };
    }

    return null;
  }

  static sendToPane(paneId: string, text: string): boolean {
    try {
      // Use set-buffer + paste-buffer to handle multi-line text
      execSync('tmux set-buffer -w -- ' + JSON.stringify(text), { encoding: 'utf-8' });
      execSync(`tmux paste-buffer -t ${paneId}`);
      return true;
    } catch {
      // Fallback: load-buffer from stdin
      try {
        execSync('tmux load-buffer -', { input: text, encoding: 'utf-8' });
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
