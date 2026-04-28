'use strict';

import { Screen, ANSI } from './screen';
import { Store } from './store';
import { Editor } from './editor';
import { ListView } from './list-view';
import Tmux from './tux';
import { AppState, AgentPane, Config, MouseEvent } from './types';
import { loadConfig } from './config';

export class App {
  private readonly dir: string;
  private readonly screen: Screen;
  private readonly store: Store;
  private state: AppState = AppState.LIST;
  private currentView: Editor | ListView | null = null;
  private running: boolean = false;
  private _keyBuf: string = '';
  private _escTimer: ReturnType<typeof setTimeout> | null = null;
  private _waitCallback: (() => void) | null = null;
  private _waitEnterOnly: boolean = false;
  private _selectAgents: AgentPane[] = [];
  private _selectEditor: Editor | null = null;
  private _selectContent: string = '';
  private _selectIdx: number = 0;
  private _config: Config;
  private _tmuxMouseOn: boolean;

  constructor(dir: string) {
    this.dir = dir;
    this.screen = new Screen();
    this.store = new Store(dir);
    this._config = loadConfig();
    this._tmuxMouseOn = Tmux.isMouseEnabled();
  }

  run(): void {
    this.running = true;
    this.screen.init();

    // Cleanup on exit
    const cleanup = () => {
      this.running = false;
      this.screen.destroy();
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Re-render on terminal resize
    process.stdout.on('resize', () => {
      if (this.currentView) {
        this.currentView.render();
      }
    });

    if (!this.store.hasNotes()) {
      // No notes — go directly to editor with a new note
      this._openNewEditor();
    } else {
      this._showList();
    }

    // Start reading keys
    process.stdin.on('data', (chunk) => {
      this._handleInput(chunk.toString());
    });
  }

  private _handleInput(data: string): void {
    // Buffer escape sequences
    this._keyBuf += data;

    // Process buffer: check for complete escape sequences
    const keys = this._parseKeys(this._keyBuf);
    if (keys !== null) {
      this._keyBuf = '';
      for (const key of keys) {
        if (typeof key === 'object') {
          this._dispatchMouse(key);
        } else {
          this._dispatchKey(key as string);
        }
      }
    }
  }

  private _parseKeys(buf: string): (string | MouseEvent)[] | null {
    if (buf.length === 0) return null;

    const keys: (string | MouseEvent)[] = [];
    let i = 0;
    let pending = false;

    while (i < buf.length) {
      if (buf[i] === '\x1b') {
        // Escape sequence
        if (i + 1 < buf.length) {
          if (buf[i + 1] === '[') {
            // X10 mouse: \x1b[M<btn><col><row> (3 bytes after M)
            if (i + 2 < buf.length && buf[i + 2] === 'M') {
              if (i + 5 < buf.length) {
                const mouse = this._parseX10Mouse(buf.charCodeAt(i + 3), buf.charCodeAt(i + 4), buf.charCodeAt(i + 5));
                if (mouse) keys.push(mouse);
                i += 6;
                continue;
              }
              // Incomplete X10 sequence
              pending = true;
              break;
            }
            // SGR mouse: \x1b[<btn;col;rowM or \x1b[<btn;col;rowm
            if (i + 2 < buf.length && buf[i + 2] === '<') {
              const end = this._findSgrEnd(buf, i + 3);
              if (end >= 0) {
                const seq = buf.slice(i, end + 1);
                const mouse = this._parseSgrMouse(seq);
                if (mouse) keys.push(mouse);
                i = end + 1;
                continue;
              }
              // Incomplete SGR sequence
              pending = true;
              break;
            }
            // General CSI sequence: \x1b[<params><final>
            // Collect parameter bytes (digits, semicolons, intermediate bytes)
            // until final byte (0x40-0x7E), then emit the full sequence as a key
            {
              let j = i + 2;
              let found = false;
              while (j < buf.length) {
                const c = buf.charCodeAt(j);
                if (c >= 0x40 && c <= 0x7e) {
                  // Final byte found — complete CSI sequence
                  keys.push(buf.slice(i, j + 1));
                  i = j + 1;
                  found = true;
                  break;
                }
                j++;
              }
              if (!found) {
                // Incomplete — wait for more data
                pending = true;
                break;
              }
              continue;
            }
          } else {
            // Alt+key or Esc followed by another key
            // Treat as bare Esc, next char will be processed separately
            keys.push('\x1b');
            i += 1;
            continue;
          }
        } else {
          // Just Esc, might be followed by more
          pending = true;
          break;
        }
      } else {
        // Regular character
        keys.push(buf[i]);
        i += 1;
      }
    }

    if (pending && keys.length === 0) {
      // Wait for more data to complete sequence
      // But also set a timeout for bare Esc
      if (buf === '\x1b') {
        // Use a short timer to detect bare Esc vs escape sequence start
        if (!this._escTimer) {
          this._escTimer = setTimeout(() => {
            this._escTimer = null;
            if (this._keyBuf === '\x1b') {
              this._keyBuf = '';
              this._dispatchKey('\x1b');
            }
          }, 50);
        }
        return null;
      }
      return null;
    }

    if (this._escTimer) {
      clearTimeout(this._escTimer);
      this._escTimer = null;
    }

    // Return remaining unprocessed part as part of keys if pending
    if (pending) {
      return null;
    }

    return keys;
  }

  /** Parse X10 mouse: button/col/row bytes (each offset by 32) */
  private _parseX10Mouse(bBtn: number, bCol: number, bRow: number): MouseEvent | null {
    const btnType = bBtn & 3; // 0=left, 1=middle, 2=right, 3=release
    if (btnType === 3) {
      return { row: bRow - 32, col: bCol - 32, type: 'release' };
    }
    if (btnType !== 0) return null;
    const col = bCol - 32;
    const row = bRow - 32;
    const isMotion = (bBtn & 32) !== 0;
    const type = isMotion ? 'drag' : 'press';
    return { row, col, type };
  }

  /** Find end of SGR mouse sequence starting after \x1b[< — returns index of M/m terminator */
  private _findSgrEnd(buf: string, start: number): number {
    for (let j = start; j < buf.length; j++) {
      const c = buf[j];
      if (c === 'M' || c === 'm') return j;
      // SGR params: digits and semicolons only
      if (!((c >= '0' && c <= '9') || c === ';')) return -1;
    }
    return -1; // incomplete
  }

  /** Parse SGR mouse: \x1b[<btn;col;rowM or \x1b[<btn;col;rowm */
  private _parseSgrMouse(seq: string): MouseEvent | null {
    const match = seq.match(/^\x1b\[<(\d+);(\d+);(\d+)(M|m)$/);
    if (!match) return null;
    const rawBtn = parseInt(match[1], 10);
    const btnType = rawBtn & 3;
    if (btnType !== 0) return null;
    const col = parseInt(match[2], 10);
    const row = parseInt(match[3], 10);
    const isRelease = match[4] === 'm';
    const isMotion = (rawBtn & 32) !== 0;
    let type: 'press' | 'drag' | 'release';
    if (isRelease) {
      type = 'release';
    } else if (isMotion) {
      type = 'drag';
    } else {
      type = 'press';
    }
    return { row, col, type };
  }

  private _dispatchKey(key: string): void {
    if (this.state === AppState.CONFIRM) {
      this._handleConfirm(key);
      return;
    }
    if (this.state === AppState.WAIT_KEY) {
      if (this._waitEnterOnly) {
        if (key !== '\r') return;
        this._waitEnterOnly = false;
      } else {
        // Ignore pure escape/control keys
        if (key === '\x1b' || key.startsWith('\x1b[')) return;
      }
      this.state = AppState.EDITOR;
      if (this._waitCallback) {
        this._waitCallback();
        this._waitCallback = null;
      }
      return;
    }
    if (this.state === AppState.SELECT) {
      this._handleSelectKey(key);
      return;
    }
    if (this.state === AppState.LIST) {
      if (this.currentView instanceof ListView) {
        this.currentView.handleKey(key);
      }
      return;
    }
    if (this.state === AppState.EDITOR) {
      if (this.currentView instanceof Editor) {
        this.currentView.handleKey(key);
      }
      return;
    }
  }

  private _dispatchMouse(event: MouseEvent): void {
    if (this.state === AppState.EDITOR && this.currentView instanceof Editor) {
      this.currentView.handleMouseEvent(event);
    }
  }

  private _showList(): void {
    this.state = AppState.LIST;
    const lv = new ListView(this.screen, this.store);
    lv.on('select', (id) => this._openEditor(id));
    lv.on('new', () => this._openNewEditor());
    lv.on('quit', () => this._quit());
    lv.on('empty', () => this._openNewEditor());
    this.currentView = lv;
    lv.render();
  }

  private _openNewEditor(): void {
    const note = this.store.createNote();
    this._openEditor(note.id);
  }

  private _openEditor(noteId: string): void {
    this.state = AppState.EDITOR;
    const editor = new Editor(this.screen, this.store, noteId, this._config.cursor.insertStyle, this._tmuxMouseOn);
    editor.on('quit', () => {
      if (this.store.hasNotes()) {
        this._showList();
      } else {
        this._quit();
      }
    });
    editor.on('send', () => this._handleSend(editor));
    editor.on('list', () => this._showList());
    this.currentView = editor;
    editor.render();
  }

  private _handleSend(editor: Editor): void {
    const content = editor.content.trim();
    if (!content) {
      this.screen.drawError('Nothing to send (empty note).');
      this._waitForAnyKey(() => {
        editor.mode = 'NORMAL';
        editor.commandBuf = '';
        editor.render();
      });
      return;
    }

    const agents = Tmux.findAgentPanes();
    if (agents.length === 0) {
      this.screen.drawError('No AI agent pane found in this window.');
      this._waitForAnyKey(() => {
        editor.mode = 'NORMAL';
        editor.commandBuf = '';
        editor.render();
      });
      return;
    }

    if (agents.length === 1) {
      this._doSend(editor, agents[0].id, agents[0].label);
    } else {
      // Multiple candidates — show selector
      this.state = AppState.SELECT;
      this._selectAgents = agents;
      this._selectEditor = editor;
      this._selectContent = content;
      this._renderSelector();
    }
  }

  private _renderSelector(): void {
    const agents = this._selectAgents;
    // Clear content area
    for (let r = 2; r <= this.screen.rows - 2; r++) {
      this.screen.clearRow(r);
    }
    // Title for selector
    const titleRow = Math.floor((this.screen.rows - 2 - agents.length) / 2) + 1;
    this.screen.writeAt(titleRow, 1, `${ANSI.bold}Send to which agent?${ANSI.reset}`);
    // Agent list
    for (let i = 0; i < agents.length; i++) {
      const row = titleRow + 1 + i;
      const cursor = i === this._selectIdx ? `${ANSI.fg.cyan}>${ANSI.reset}` : ' ';
      const highlight = i === this._selectIdx ? ANSI.bold : '';
      const dimRestore = i === this._selectIdx ? ANSI.reset : ANSI.reset;
      this.screen.writeAt(row, 1,
        `${cursor} ${ANSI.bold}${ANSI.fg.cyan}${agents[i].index}${ANSI.reset}) ${highlight}${agents[i].label}${dimRestore} ${ANSI.dim}(${agents[i].id})${ANSI.reset}`
      );
    }
    this.screen.drawStatusBar('SELECT', 'j/k:move  Enter:select  Esc:cancel');
    this.screen.drawCommandLine('');
    this.screen.hideCursor();
  }

  private _handleSelectKey(key: string): void {
    if (key === '\x1b') {
      // Cancel — return to NORMAL mode
      this.state = AppState.EDITOR;
      if (this._selectEditor) {
        this._selectEditor.mode = 'NORMAL';
        this._selectEditor.commandBuf = '';
        this._selectEditor.render();
      }
      return;
    }
    // j / down — move down
    if (key === 'j' || key === '\x1b[B') {
      this._selectIdx = (this._selectIdx + 1) % this._selectAgents.length;
      this._renderSelector();
      return;
    }
    // k / up — move up
    if (key === 'k' || key === '\x1b[A') {
      this._selectIdx = (this._selectIdx - 1 + this._selectAgents.length) % this._selectAgents.length;
      this._renderSelector();
      return;
    }
    // Enter — confirm selection
    if (key === '\r') {
      const agent = this._selectAgents[this._selectIdx];
      this.state = AppState.EDITOR;
      if (this._selectEditor) {
        this._doSend(this._selectEditor, agent.id, agent.label);
      }
      return;
    }
    // Numeric — select by pane index
    const num = parseInt(key, 10);
    if (!isNaN(num)) {
      const agent = this._selectAgents.find(a => a.index === num);
      if (agent) {
        this.state = AppState.EDITOR;
        if (this._selectEditor) {
          this._doSend(this._selectEditor, agent.id, agent.label);
        }
      }
    }
  }

  private _doSend(editor: Editor, paneId: string, label: string): void {
    const content = editor.content.trim();
    const ok = Tmux.sendToPane(paneId, content);
    if (ok) {
      if (editor.noteId) {
        this.store.markSent(editor.noteId);
      }
      this.screen.drawSuccess(`Sent to ${label}. Press Enter to continue.`);
      this._waitForEnter(() => {
        editor.mode = 'NORMAL';
        editor.commandBuf = '';
        editor.render();
      });
    } else {
      this.screen.drawError(`Failed to send to ${label}.`);
      this._waitForAnyKey(() => {
        editor.mode = 'NORMAL';
        editor.commandBuf = '';
        editor.render();
      });
    }
  }

  private _waitForAnyKey(callback: () => void): void {
    this.state = AppState.WAIT_KEY;
    this._waitCallback = callback;
  }

  private _waitForEnter(callback: () => void): void {
    this.state = AppState.WAIT_KEY;
    this._waitCallback = callback;
    this._waitEnterOnly = true;
  }

  private _handleConfirm(_key: string): void {
    // Currently unused, but available for future confirm dialogs
  }

  private _quit(): never {
    this.running = false;
    this.screen.destroy();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.exit(0);
  }
}
