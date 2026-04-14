'use strict';

const Screen = require('./screen');
const { EventEmitter } = require('events');

const MODE = { NORMAL: 'NORMAL', INSERT: 'INSERT', COMMAND: 'COMMAND' };

// Calculate display width of a string (CJK chars = 2 columns)
function displayWidth(str) {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    // CJK Unified Ideographs, CJK Extensions, Fullwidth forms, Katakana, Hangul, etc.
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK Unified
      (code >= 0x3400 && code <= 0x4DBF) ||   // CJK Extension A
      (code >= 0x20000 && code <= 0x2A6DF) || // CJK Extension B
      (code >= 0xF900 && code <= 0xFAFF) ||   // CJK Compatibility
      (code >= 0x2F800 && code <= 0x2FA1F) || // CJK Compatibility Supplement
      (code >= 0xFF01 && code <= 0xFF60) ||   // Fullwidth ASCII
      (code >= 0x3000 && code <= 0x303F) ||   // CJK Symbols
      (code >= 0x3040 && code <= 0x309F) ||   // Hiragana
      (code >= 0x30A0 && code <= 0x30FF) ||   // Katakana
      (code >= 0xAC00 && code <= 0xD7AF)      // Hangul
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

// Convert string index to display column
function indexToCol(str, index) {
  return displayWidth(str.slice(0, index));
}

// Convert display column to string index
function colToIndex(str, col) {
  let w = 0;
  let i = 0;
  for (const ch of str) {
    if (w >= col) break;
    const code = ch.codePointAt(0);
    w += (isWide(code) ? 2 : 1);
    i++;
  }
  return i;
}

function isWide(code) {
  return (
    (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0x3400 && code <= 0x4DBF) ||
    (code >= 0x20000 && code <= 0x2A6DF) ||
    (code >= 0xF900 && code <= 0xFAFF) ||
    (code >= 0x2F800 && code <= 0x2FA1F) ||
    (code >= 0xFF01 && code <= 0xFF60) ||
    (code >= 0x3000 && code <= 0x303F) ||
    (code >= 0x3040 && code <= 0x309F) ||
    (code >= 0x30A0 && code <= 0x30FF) ||
    (code >= 0xAC00 && code <= 0xD7AF)
  );
}

class Editor extends EventEmitter {
  constructor(screen, store, noteId) {
    super();
    this.screen = screen;
    this.store = store;
    this.noteId = noteId;
    this.mode = MODE.NORMAL;
    this.lines = [''];
    this.cursor = { row: 0, col: 0 };
    this.scrollOffset = 0;
    this.commandBuf = '';
    this.pendingDelete = false; // for dd

    if (noteId) {
      const note = store.getNote(noteId);
      if (note && note.content) {
        this.lines = note.content.split('\n');
        if (this.lines.length === 0) this.lines = [''];
      }
    }
  }

  get content() {
    return this.lines.join('\n');
  }

  get contentStartRow() {
    return 2; // row 1 = title, row 2.. = content
  }

  get visibleLines() {
    return this.screen.contentHeight();
  }

  handleKey(key) {
    if (this.mode === MODE.NORMAL) {
      this._handleNormal(key);
    } else if (this.mode === MODE.INSERT) {
      this._handleInsert(key);
    } else if (this.mode === MODE.COMMAND) {
      this._handleCommand(key);
    }
  }

  _handleNormal(key) {
    // dd: delete line
    if (key === 'd' && this.pendingDelete) {
      this.pendingDelete = false;
      this._deleteLine();
      this.render();
      return;
    }
    this.pendingDelete = false;

    switch (key) {
      case 'i':
        this._setMode(MODE.INSERT);
        break;
      case ':':
        this._setMode(MODE.COMMAND);
        this.commandBuf = '';
        break;
      case 'h':
        this.cursor.col = Math.max(0, this.cursor.col - 1);
        this.render();
        break;
      case 'l':
        this.cursor.col = Math.min(
          (this.lines[this.cursor.row] || '').length,
          this.cursor.col + 1
        );
        this.render();
        break;
      case 'j':
        if (this.cursor.row < this.lines.length - 1) {
          this.cursor.row++;
          this._clampCol();
          this._adjustScroll();
          this.render();
        }
        break;
      case 'k':
        if (this.cursor.row > 0) {
          this.cursor.row--;
          this._clampCol();
          this._adjustScroll();
          this.render();
        }
        break;
      case 'x':
        this._deleteCharUnderCursor();
        this.render();
        break;
      case 'q':
        this._save();
        this.emit('quit');
        break;
      case 'G':
        this.cursor.row = this.lines.length - 1;
        this.cursor.col = 0;
        this._adjustScroll();
        this.render();
        break;
      case 'g':
        this.cursor.row = 0;
        this.cursor.col = 0;
        this.scrollOffset = 0;
        this.render();
        break;
      case 'd':
        this.pendingDelete = true;
        break;
      case 'A':
        this.cursor.col = (this.lines[this.cursor.row] || '').length;
        this._setMode(MODE.INSERT);
        break;
      case 'o':
        this._insertLineBelow();
        this._setMode(MODE.INSERT);
        this.render();
        break;
      case 'O':
        this._insertLineAbove();
        this._setMode(MODE.INSERT);
        this.render();
        break;
    }
  }

  _handleInsert(key) {
    if (key === '\x1b') { // Esc
      this._save();
      this._setMode(MODE.NORMAL);
      return;
    }

    if (key === '\x7f' || key === '\b') { // Backspace
      this._backspace();
      this.render();
      return;
    }

    if (key === '\r') { // Enter
      this._splitLine();
      this._adjustScroll();
      this.render();
      return;
    }

    // Regular character (including multi-byte)
    if (key.length === 1 || key.charCodeAt(0) > 127) {
      this._insertChar(key);
      this.render();
      return;
    }

    // Handle escape sequences for arrow keys in insert mode
    if (key === '\x1b[A') { this._moveUp(); this.render(); return; }
    if (key === '\x1b[B') { this._moveDown(); this.render(); return; }
    if (key === '\x1b[C') {
      const line = this.lines[this.cursor.row] || '';
      if (this.cursor.col < line.length) {
        this.cursor.col++;
        this.render();
      }
      return;
    }
    if (key === '\x1b[D') {
      if (this.cursor.col > 0) {
        this.cursor.col--;
        this.render();
      }
      return;
    }
  }

  _handleCommand(key) {
    if (key === '\x1b') { // Esc
      this._setMode(MODE.NORMAL);
      return;
    }
    if (key === '\r') { // Enter
      this._executeCommand(this.commandBuf.trim());
      return;
    }
    if (key === '\x7f' || key === '\b') { // Backspace
      this.commandBuf = this.commandBuf.slice(0, -1);
      this.screen.drawCommandLine(':' + this.commandBuf);
      return;
    }
    if (key.length === 1) {
      this.commandBuf += key;
      this.screen.drawCommandLine(':' + this.commandBuf);
    }
  }

  _executeCommand(cmd) {
    switch (cmd) {
      case 'q':
        this._save();
        this.emit('quit');
        break;
      case 's':
        this.emit('send');
        break;
      case 'w':
        this._save();
        this.screen.drawCommandLine('');
        this.screen.drawSuccess('Saved.');
        break;
      case 'ls':
        this._save();
        this.emit('list');
        break;
      default:
        this.screen.drawCommandLine('');
        this.screen.drawError(`Unknown command: ${cmd}`);
    }
  }

  _setMode(mode) {
    this.mode = mode;
    this.render();
  }

  _save() {
    if (this.noteId) {
      this.store.updateNote(this.noteId, this.content);
    }
  }

  // --- Text operations ---

  _insertChar(ch) {
    const line = this.lines[this.cursor.row] || '';
    const col = Math.min(this.cursor.col, line.length);
    this.lines[this.cursor.row] = line.slice(0, col) + ch + line.slice(col);
    this.cursor.col = col + 1;
  }

  _backspace() {
    if (this.cursor.col > 0) {
      const line = this.lines[this.cursor.row];
      this.lines[this.cursor.row] =
        line.slice(0, this.cursor.col - 1) + line.slice(this.cursor.col);
      this.cursor.col--;
    } else if (this.cursor.row > 0) {
      // Join with previous line
      const prevLen = this.lines[this.cursor.row - 1].length;
      this.lines[this.cursor.row - 1] += this.lines[this.cursor.row];
      this.lines.splice(this.cursor.row, 1);
      this.cursor.row--;
      this.cursor.col = prevLen;
      this._adjustScroll();
    }
  }

  _splitLine() {
    const line = this.lines[this.cursor.row];
    const col = Math.min(this.cursor.col, line.length);
    this.lines[this.cursor.row] = line.slice(0, col);
    this.lines.splice(this.cursor.row + 1, 0, line.slice(col));
    this.cursor.row++;
    this.cursor.col = 0;
  }

  _deleteCharUnderCursor() {
    const line = this.lines[this.cursor.row];
    if (this.cursor.col < line.length) {
      this.lines[this.cursor.row] =
        line.slice(0, this.cursor.col) + line.slice(this.cursor.col + 1);
    } else if (this.cursor.row < this.lines.length - 1) {
      // Join with next line
      this.lines[this.cursor.row] += this.lines[this.cursor.row + 1];
      this.lines.splice(this.cursor.row + 1, 1);
    }
  }

  _deleteLine() {
    if (this.lines.length <= 1) {
      this.lines = [''];
      this.cursor = { row: 0, col: 0 };
      return;
    }
    this.lines.splice(this.cursor.row, 1);
    if (this.cursor.row >= this.lines.length) {
      this.cursor.row = this.lines.length - 1;
    }
    this.cursor.col = 0;
  }

  _insertLineBelow() {
    this.lines.splice(this.cursor.row + 1, 0, '');
    this.cursor.row++;
    this.cursor.col = 0;
  }

  _insertLineAbove() {
    this.lines.splice(this.cursor.row, 0, '');
    this.cursor.col = 0;
  }

  _moveUp() {
    if (this.cursor.row > 0) {
      this.cursor.row--;
      this._clampCol();
      this._adjustScroll();
    }
  }

  _moveDown() {
    if (this.cursor.row < this.lines.length - 1) {
      this.cursor.row++;
      this._clampCol();
      this._adjustScroll();
    }
  }

  _clampCol() {
    const lineLen = (this.lines[this.cursor.row] || '').length;
    if (this.cursor.col > lineLen) this.cursor.col = lineLen;
  }

  _adjustScroll() {
    const visible = this.visibleLines;
    // Cursor should be within visible area
    if (this.cursor.row < this.scrollOffset) {
      this.scrollOffset = this.cursor.row;
    } else if (this.cursor.row >= this.scrollOffset + visible) {
      this.scrollOffset = this.cursor.row - visible + 1;
    }
  }

  // --- Rendering ---

  render() {
    const { A } = Screen;
    const startRow = this.contentStartRow;
    const visible = this.visibleLines;

    // Title bar
    const dirName = require('path').basename(this.store.dir);
    this.screen.drawTitleBar(dirName, this.store.listNotes().length);

    // Content area
    this.screen.hideCursor();
    for (let i = 0; i < visible; i++) {
      const lineIdx = this.scrollOffset + i;
      const row = startRow + i;
      if (lineIdx < this.lines.length) {
        const lineNum = String(lineIdx + 1).padStart(3);
        const maxCols = this.screen.cols - 5;
        // Truncate by display width, not string length
        let content = '';
        let w = 0;
        for (const ch of this.lines[lineIdx]) {
          const cw = displayWidth(ch);
          if (w + cw > maxCols) break;
          content += ch;
          w += cw;
        }
        const prefix = Screen.ANSI.dim + lineNum + ' ' + Screen.ANSI.reset;
        this.screen.writeAt(row, 1, prefix + content);
      } else {
        this.screen.clearRow(row);
      }
    }

    // Status bar
    const mode = this.mode;
    let hint = '';
    if (mode === MODE.NORMAL) {
      hint = 'i:insert  :s:send  q:quit  h/j/k/l:move  x:del  dd:del line';
    } else if (mode === MODE.INSERT) {
      hint = 'Esc:back to normal';
    } else if (mode === MODE.COMMAND) {
      hint = 'Enter:exec  Esc:cancel  s:send  q:quit  ls:list';
    }
    this.screen.drawStatusBar(mode, hint);

    // Command line
    if (mode === MODE.COMMAND) {
      this.screen.drawCommandLine(':' + this.commandBuf);
    } else {
      this.screen.drawCommandLine('');
    }

    // Cursor position
    if (mode === MODE.INSERT || mode === MODE.NORMAL) {
      const screenRow = startRow + (this.cursor.row - this.scrollOffset);
      const line = this.lines[this.cursor.row] || '';
      const screenCol = 4 + indexToCol(line, this.cursor.col);
      if (screenRow >= startRow && screenRow < startRow + visible) {
        this.screen.moveCursor(screenRow, screenCol);
      }
    } else {
      this.screen.hideCursor();
    }
  }
}

Editor.MODE = MODE;

module.exports = Editor;
