'use strict';

import { EventEmitter } from 'events';
import { basename } from 'path';
import { Cursor, EditorEvents, CursorStyle } from './types';
import { ANSI } from './screen';
import type { Screen } from './screen';
import type { Store } from './store';

// Import EditorMode as a regular enum to avoid const enum issues
const EditorMode = {
  NORMAL: 'NORMAL',
  INSERT: 'INSERT',
  COMMAND: 'COMMAND',
} as const;

type EditorMode = (typeof EditorMode)[keyof typeof EditorMode];

/**
 * Calculate display width of a string (CJK chars = 2 columns)
 * Handles:
 * - CJK Unified Ideographs
 * - CJK Extensions
 * - Fullwidth forms
 * - Katakana, Hiragana
 * - Hangul
 */
function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (!code) continue;
    // CJK Unified Ideographs, CJK Extensions, Fullwidth forms, Katakana, Hangul, etc.
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x20000 && code <= 0x2a6df) || // CJK Extension B
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility
      (code >= 0x2f800 && code <= 0x2fa1f) || // CJK Compatibility Supplement
      (code >= 0xff01 && code <= 0xff60) || // Fullwidth ASCII
      (code >= 0x3000 && code <= 0x303f) || // CJK Symbols
      (code >= 0x3040 && code <= 0x309f) || // Hiragana
      (code >= 0x30a0 && code <= 0x30ff) || // Katakana
      (code >= 0xac00 && code <= 0xd7af) // Hangul
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/**
 * Check if a Unicode code point is a wide character
 */
function isWide(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x2f800 && code <= 0x2fa1f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x309f) ||
    (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}

/**
 * Convert string index to display column position
 */
function indexToCol(str: string, index: number): number {
  return displayWidth(str.slice(0, index));
}

/**
 * Convert display column position to string index
 */
function colToIndex(str: string, col: number): number {
  let w = 0;
  let i = 0;
  for (const ch of str) {
    if (w >= col) break;
    const code = ch.codePointAt(0);
    if (!code) continue;
    w += isWide(code) ? 2 : 1;
    i++;
  }
  return i;
}

export class Editor extends EventEmitter {
  static readonly MODE = EditorMode;

  screen: Screen;
  store: Store;
  noteId: string | null;
  mode: EditorMode;
  lines: string[];
  cursor: Cursor;
  scrollOffset: number;
  commandBuf: string;
  pendingDelete: boolean;
  private _insertCursorStyle: CursorStyle;

  // Re-export for type checking
  static ANSI = ANSI;

  constructor(screen: Screen, store: Store, noteId?: string, insertCursorStyle: CursorStyle = 'after') {
    super();
    this.screen = screen;
    this.store = store;
    this.noteId = noteId || null;
    this.mode = EditorMode.NORMAL;
    this.lines = [''];
    this.cursor = { row: 0, col: 0 };
    this.scrollOffset = 0;
    this.commandBuf = '';
    this.pendingDelete = false; // for dd
    this._insertCursorStyle = insertCursorStyle;

    if (noteId) {
      const note = store.getNote(noteId);
      if (note && note.content) {
        this.lines = note.content.split('\n');
        if (this.lines.length === 0) this.lines = [''];
      }
    }
  }

  // Override emit with type safety for known events
  emit<K extends keyof EditorEvents>(
    event: K,
    ...args: EditorEvents[K]
  ): boolean;
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  // Override on with type safety for known events
  on<K extends keyof EditorEvents>(
    event: K,
    listener: (...args: EditorEvents[K]) => void
  ): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  get content(): string {
    return this.lines.join('\n');
  }

  get contentStartRow(): number {
    return 2; // row 1 = title, row 2.. = content
  }

  get visibleLines(): number {
    return this.screen.contentHeight();
  }

  handleKey(key: string): void {
    if (this.mode === EditorMode.NORMAL) {
      this._handleNormal(key);
    } else if (this.mode === EditorMode.INSERT) {
      this._handleInsert(key);
    } else if (this.mode === EditorMode.COMMAND) {
      this._handleCommand(key);
    }
  }

  private _handleNormal(key: string): void {
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
        this._setMode(EditorMode.INSERT);
        break;
      case ':':
        this._setMode(EditorMode.COMMAND);
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
        this._setMode(EditorMode.INSERT);
        break;
      case 'o':
        this._insertLineBelow();
        this._setMode(EditorMode.INSERT);
        this.render();
        break;
      case 'O':
        this._insertLineAbove();
        this._setMode(EditorMode.INSERT);
        this.render();
        break;
    }
  }

  private _handleInsert(key: string): void {
    if (key === '\x1b') {
      // Esc
      this._save();
      this._setMode(EditorMode.NORMAL);
      return;
    }

    if (key === '\x7f' || key === '\b') {
      // Backspace
      this._backspace();
      this.render();
      return;
    }

    if (key === '\r') {
      // Enter
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
    if (key === '\x1b[A') {
      this._moveUp();
      this.render();
      return;
    }
    if (key === '\x1b[B') {
      this._moveDown();
      this.render();
      return;
    }
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

  private _handleCommand(key: string): void {
    if (key === '\x1b') {
      // Esc
      this._setMode(EditorMode.NORMAL);
      return;
    }
    if (key === '\r') {
      // Enter
      this._executeCommand(this.commandBuf.trim());
      return;
    }
    if (key === '\x7f' || key === '\b') {
      // Backspace
      this.commandBuf = this.commandBuf.slice(0, -1);
      this.screen.drawCommandLine(':' + this.commandBuf);
      return;
    }
    if (key.length === 1) {
      this.commandBuf += key;
      this.screen.drawCommandLine(':' + this.commandBuf);
    }
  }

  private _executeCommand(cmd: string): void {
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

  private _setMode(mode: EditorMode): void {
    this.mode = mode;
    this._applyCursorShape(mode);
    this.render();
  }

  private _applyCursorShape(mode: EditorMode): void {
    if (mode === EditorMode.NORMAL) {
      this.screen.setBlockCursor();
    } else if (mode === EditorMode.INSERT) {
      if (this._insertCursorStyle === 'on') {
        this.screen.setBlockCursor();
      } else {
        this.screen.setBarCursor();
      }
    }
  }

  private _save(): void {
    if (this.noteId) {
      this.store.updateNote(this.noteId, this.content);
    }
  }

  // --- Text operations ---

  private _insertChar(ch: string): void {
    const line = this.lines[this.cursor.row] || '';
    const col = Math.min(this.cursor.col, line.length);
    this.lines[this.cursor.row] = line.slice(0, col) + ch + line.slice(col);
    this.cursor.col = col + 1;
  }

  private _backspace(): void {
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

  private _splitLine(): void {
    const line = this.lines[this.cursor.row];
    const col = Math.min(this.cursor.col, line.length);
    this.lines[this.cursor.row] = line.slice(0, col);
    this.lines.splice(this.cursor.row + 1, 0, line.slice(col));
    this.cursor.row++;
    this.cursor.col = 0;
  }

  private _deleteCharUnderCursor(): void {
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

  private _deleteLine(): void {
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

  private _insertLineBelow(): void {
    this.lines.splice(this.cursor.row + 1, 0, '');
    this.cursor.row++;
    this.cursor.col = 0;
  }

  private _insertLineAbove(): void {
    this.lines.splice(this.cursor.row, 0, '');
    this.cursor.col = 0;
  }

  private _moveUp(): void {
    if (this.cursor.row > 0) {
      this.cursor.row--;
      this._clampCol();
      this._adjustScroll();
    }
  }

  private _moveDown(): void {
    if (this.cursor.row < this.lines.length - 1) {
      this.cursor.row++;
      this._clampCol();
      this._adjustScroll();
    }
  }

  private _clampCol(): void {
    const lineLen = (this.lines[this.cursor.row] || '').length;
    if (this.cursor.col > lineLen) this.cursor.col = lineLen;
  }

  private _adjustScroll(): void {
    const visible = this.visibleLines;
    // Cursor should be within visible area
    if (this.cursor.row < this.scrollOffset) {
      this.scrollOffset = this.cursor.row;
    } else if (this.cursor.row >= this.scrollOffset + visible) {
      this.scrollOffset = this.cursor.row - visible + 1;
    }
  }

  // --- Rendering ---

  render(): void {
    const startRow = this.contentStartRow;
    const visible = this.visibleLines;

    // Title bar
    const dirName = basename(this.store.dir);
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
        const prefix = ANSI.dim + lineNum + ' ' + ANSI.reset;
        this.screen.writeAt(row, 1, prefix + content);
      } else {
        this.screen.clearRow(row);
      }
    }

    // Status bar
    const mode = this.mode;
    let hint = '';
    if (mode === EditorMode.NORMAL) {
      hint = 'i:insert  :s:send  q:quit  h/j/k/l:move  x:del  dd:del line';
    } else if (mode === EditorMode.INSERT) {
      hint = 'Esc:back to normal';
    } else if (mode === EditorMode.COMMAND) {
      hint = 'Enter:exec  Esc:cancel  s:send  q:quit  ls:list';
    }
    this.screen.drawStatusBar(mode, hint);

    // Command line
    if (mode === EditorMode.COMMAND) {
      this.screen.drawCommandLine(':' + this.commandBuf);
    } else {
      this.screen.drawCommandLine('');
    }

    // Cursor position
    if (mode === EditorMode.INSERT || mode === EditorMode.NORMAL) {
      const screenRow = startRow + (this.cursor.row - this.scrollOffset);
      const line = this.lines[this.cursor.row] || '';
      const screenCol = 5 + indexToCol(line, this.cursor.col);
      if (screenRow >= startRow && screenRow < startRow + visible) {
        this._applyCursorShape(mode);
        this.screen.moveCursor(screenRow, screenCol);
      }
    } else {
      this.screen.hideCursor();
    }
  }
}

export default Editor;
