'use strict';

const Screen = require('./screen');
const Store = require('./store');
const Editor = require('./editor');
const ListView = require('./list-view');
const Tmux = require('./tux');

const STATE = { LIST: 'LIST', EDITOR: 'EDITOR', CONFIRM: 'CONFIRM', WAIT_KEY: 'WAIT_KEY', SELECT: 'SELECT' };

class App {
  constructor(dir) {
    this.dir = dir;
    this.screen = new Screen();
    this.store = new Store(dir);
    this.state = STATE.LIST;
    this.currentView = null;
    this.running = false;
    this._keyBuf = '';
  }

  run() {
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

  _handleInput(data) {
    // Buffer escape sequences
    this._keyBuf += data;

    // Process buffer: check for complete escape sequences
    const keys = this._parseKeys(this._keyBuf);
    if (keys !== null) {
      this._keyBuf = '';
      for (const key of keys) {
        this._dispatchKey(key);
      }
    }
  }

  _parseKeys(buf) {
    if (buf.length === 0) return null;

    const keys = [];
    let i = 0;
    let pending = false;

    while (i < buf.length) {
      if (buf[i] === '\x1b') {
        // Escape sequence
        if (i + 1 < buf.length) {
          if (buf[i + 1] === '[') {
            if (i + 2 < buf.length) {
              // Known: \x1b[A (up) \x1b[B (down) \x1b[C (right) \x1b[D (left)
              const seq = buf.slice(i, i + 3);
              if (['\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D'].includes(seq)) {
                keys.push(seq);
                i += 3;
                continue;
              }
            }
            // Incomplete escape sequence, wait for more
            pending = true;
            break;
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

  _dispatchKey(key) {
    if (this.state === STATE.CONFIRM) {
      this._handleConfirm(key);
      return;
    }
    if (this.state === STATE.WAIT_KEY) {
      // Ignore pure escape/control keys
      if (key === '\x1b' || key.startsWith('\x1b[')) return;
      this.state = STATE.EDITOR;
      if (this._waitCallback) {
        this._waitCallback();
        this._waitCallback = null;
      }
      return;
    }
    if (this.state === STATE.SELECT) {
      this._handleSelectKey(key);
      return;
    }
    if (this.state === STATE.LIST) {
      this.currentView.handleKey(key);
      return;
    }
    if (this.state === STATE.EDITOR) {
      this.currentView.handleKey(key);
      return;
    }
  }

  _showList() {
    this.state = STATE.LIST;
    const lv = new ListView(this.screen, this.store);
    lv.on('select', (id) => this._openEditor(id));
    lv.on('new', () => this._openNewEditor());
    lv.on('quit', () => this._quit());
    lv.on('empty', () => this._openNewEditor());
    this.currentView = lv;
    lv.render();
  }

  _openNewEditor() {
    const note = this.store.createNote();
    this._openEditor(note.id);
  }

  _openEditor(noteId) {
    this.state = STATE.EDITOR;
    const editor = new Editor(this.screen, this.store, noteId);
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

  _handleSend(editor) {
    const content = editor.content.trim();
    if (!content) {
      this.screen.drawError('Nothing to send (empty note).');
      this._waitForAnyKey(() => {
        editor.mode = Editor.MODE.NORMAL;
        editor.commandBuf = '';
        editor.render();
      });
      return;
    }

    const agents = Tmux.findAgentPanes();
    if (agents.length === 0) {
      this.screen.drawError('No AI agent pane found in this window.');
      this._waitForAnyKey(() => {
        editor.mode = Editor.MODE.NORMAL;
        editor.commandBuf = '';
        editor.render();
      });
      return;
    }

    if (agents.length === 1) {
      this._doSend(editor, agents[0].id, agents[0].label);
    } else {
      // Multiple candidates — show selector
      this.state = STATE.SELECT;
      this._selectAgents = agents;
      this._selectEditor = editor;
      this._selectContent = content;
      this._renderSelector();
    }
  }

  _renderSelector() {
    const { ANSI } = require('./screen');
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
      this.screen.writeAt(row, 3,
        `${ANSI.bold}${ANSI.fg.cyan}${i + 1}${ANSI.reset}) ${agents[i].label} ${ANSI.dim}(${agents[i].id})${ANSI.reset}`
      );
    }
    this.screen.drawStatusBar('SELECT', '1-9:select  Esc:cancel');
    this.screen.drawCommandLine('');
    this.screen.hideCursor();
  }

  _handleSelectKey(key) {
    if (key === '\x1b' || key.startsWith('\x1b[')) {
      // Cancel — return to NORMAL mode
      this.state = STATE.EDITOR;
      this._selectEditor.mode = Editor.MODE.NORMAL;
      this._selectEditor.commandBuf = '';
      this._selectEditor.render();
      return;
    }
    const idx = parseInt(key, 10) - 1;
    if (idx >= 0 && idx < this._selectAgents.length) {
      const agent = this._selectAgents[idx];
      this.state = STATE.EDITOR;
      this._doSend(this._selectEditor, agent.id, agent.label);
    }
  }

  _doSend(editor, paneId, label) {
    const content = editor.content.trim();
    const ok = Tmux.sendToPane(paneId, content);
    if (ok) {
      this.store.markSent(editor.noteId);
      this.screen.drawSuccess(`Sent to ${label}. Press any key to continue.`);
      this._waitForAnyKey(() => {
        editor.mode = Editor.MODE.NORMAL;
        editor.commandBuf = '';
        editor.render();
      });
    } else {
      this.screen.drawError(`Failed to send to ${label}.`);
      this._waitForAnyKey(() => {
        editor.mode = Editor.MODE.NORMAL;
        editor.commandBuf = '';
        editor.render();
      });
    }
  }

  _waitForAnyKey(callback) {
    this.state = STATE.WAIT_KEY;
    this._waitCallback = callback;
  }

  _handleConfirm(key) {
    // Currently unused, but available for future confirm dialogs
  }

  _quit() {
    this.running = false;
    this.screen.destroy();
    process.exit(0);
  }
}

module.exports = App;
