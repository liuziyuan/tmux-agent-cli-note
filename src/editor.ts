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
export function displayWidth(str: string): number {
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
  private _tmuxMouseOn: boolean;

  // Re-export for type checking
  static ANSI = ANSI;

  constructor(screen: Screen, store: Store, noteId?: string, insertCursorStyle: CursorStyle = 'after', tmuxMouseOn?: boolean) {
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
    this._tmuxMouseOn = tmuxMouseOn ?? false;

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
      case '0':
      case '\x1b[H':
      case '\x1bOH':
        this.cursor.col = 0;
        this.render();
        break;
      case '$':
      case '\x1b[F':
      case '\x1bOF':
        this.cursor.col = (this.lines[this.cursor.row] || '').length;
        this.render();
        break;
      case 'D':
        this.lines[this.cursor.row] = (this.lines[this.cursor.row] || '').slice(0, this.cursor.col);
        this.render();
        break;
      case 'i':
        this._setMode(EditorMode.INSERT);
        break;
      case ':':
        this._setMode(EditorMode.COMMAND);
        this.commandBuf = '';
        break;
      case 'h':
      case '\x1b[D':
        this.cursor.col = Math.max(0, this.cursor.col - 1);
        this.render();
        break;
      case 'l':
      case '\x1b[C':
        this.cursor.col = Math.min(
          (this.lines[this.cursor.row] || '').length,
          this.cursor.col + 1
        );
        this.render();
        break;
      case 'j':
      case '\x1b[B':
        this._moveDown();
        this.render();
        break;
      case 'k':
      case '\x1b[A':
        this._moveUp();
        this.render();
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

    // Handle escape sequences for special keys in insert mode
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
    // Delete key
    if (key === '\x1b[3~') {
      this._deleteCharUnderCursor();
      this.render();
      return;
    }
    // Home / End
    if (key === '\x1b[H' || key === '\x1bOH') {
      this.cursor.col = 0;
      this.render();
      return;
    }
    if (key === '\x1b[F' || key === '\x1bOF') {
      this.cursor.col = (this.lines[this.cursor.row] || '').length;
      this.render();
      return;
    }
    // Ctrl+Home / Ctrl+End
    if (key === '\x1b[1;5H') {
      this.cursor.row = 0;
      this.cursor.col = 0;
      this.scrollOffset = 0;
      this.render();
      return;
    }
    if (key === '\x1b[1;5F') {
      this.cursor.row = this.lines.length - 1;
      this.cursor.col = (this.lines[this.cursor.row] || '').length;
      this._adjustScroll();
      this.render();
      return;
    }
    // Ctrl+Left / Ctrl+Right (word navigation)
    if (key === '\x1b[1;5D') {
      const pos = this._wordBackward(this.cursor.row, this.cursor.col);
      this.cursor.row = pos.row;
      this.cursor.col = pos.col;
      this._adjustScroll();
      this.render();
      return;
    }
    if (key === '\x1b[1;5C') {
      const pos = this._wordForward(this.cursor.row, this.cursor.col);
      this.cursor.row = pos.row;
      this.cursor.col = pos.col;
      this._adjustScroll();
      this.render();
      return;
    }
    // Ctrl+Delete
    if (key === '\x1b[3;5~') {
      this._deleteWordForward();
      this.render();
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

  // --- Word navigation helpers ---

  private _isWordChar(code: number): boolean {
    return (code >= 0x41 && code <= 0x5a) || // A-Z
           (code >= 0x61 && code <= 0x7a) || // a-z
           (code >= 0x30 && code <= 0x39) || // 0-9
           code === 0x5f;                    // _
  }

  private _isWideChar(code: number): boolean {
    return isWide(code);
  }

  private _wordForward(row: number, col: number): { row: number; col: number } {
    let r = row, c = col;
    const line = this.lines[r] || '';
    // If at end of line, move to start of next line
    if (c >= line.length) {
      if (r < this.lines.length - 1) return { row: r + 1, col: 0 };
      return { row: r, col: c };
    }
    const firstCode = line.codePointAt(c)!;
    if (this._isWideChar(firstCode)) {
      // CJK char is its own word — skip it
      c += String.fromCodePoint(firstCode).length;
      // Skip whitespace after
      while (r < this.lines.length) {
        const ln = this.lines[r] || '';
        while (c < ln.length && ln.charCodeAt(c) === 0x20) c++;
        if (c < ln.length) return { row: r, col: c };
        if (r < this.lines.length - 1) { r++; c = 0; } else break;
      }
      return { row: r, col: Math.min(c, (this.lines[r] || '').length) };
    }
    if (this._isWordChar(firstCode)) {
      // Skip word chars
      while (c < (this.lines[r] || '').length && this._isWordChar((this.lines[r] || '').codePointAt(c)!))
        c++;
    } else {
      // Skip non-blank, non-word chars (punctuation)
      while (c < (this.lines[r] || '').length) {
        const ch = (this.lines[r] || '').charCodeAt(c);
        if (ch === 0x20 || this._isWordChar(ch)) break;
        c++;
      }
    }
    // Skip whitespace
    while (r < this.lines.length) {
      const ln = this.lines[r] || '';
      while (c < ln.length && ln.charCodeAt(c) === 0x20) c++;
      if (c < ln.length) return { row: r, col: c };
      if (r < this.lines.length - 1) { r++; c = 0; } else break;
    }
    return { row: r, col: Math.min(c, (this.lines[r] || '').length) };
  }

  private _wordBackward(row: number, col: number): { row: number; col: number } {
    let r = row, c = col;
    // Move back one position
    if (c === 0) {
      if (r === 0) return { row: 0, col: 0 };
      r--;
      c = (this.lines[r] || '').length;
    } else {
      c--;
    }
    // Skip whitespace backward
    while (true) {
      const ln = this.lines[r] || '';
      while (c > 0 && ln.charCodeAt(c - 1) === 0x20) c--;
      if (c > 0) break;
      // At start of line — check if we should go to previous line
      if (r === 0) return { row: 0, col: 0 };
      r--;
      c = (this.lines[r] || '').length;
      if (c === 0) return { row: r, col: 0 };
    }
    // Now c > 0, find the start of the word
    const ln = this.lines[r] || '';
    const prevCode = ln.codePointAt(c - 1)!;
    if (this._isWideChar(prevCode)) {
      // CJK char — it's its own word
      c -= String.fromCodePoint(prevCode).length;
      return { row: r, col: c };
    }
    if (this._isWordChar(prevCode)) {
      while (c > 0 && this._isWordChar(ln.codePointAt(c - 1)!)) c--;
    } else {
      // Non-word, non-space (punctuation)
      while (c > 0) {
        const ch = ln.charCodeAt(c - 1);
        if (ch === 0x20 || this._isWordChar(ch)) break;
        c--;
      }
    }
    return { row: r, col: c };
  }

  private _deleteWordForward(): void {
    const line = this.lines[this.cursor.row] || '';
    if (this.cursor.col >= line.length) return;
    const target = this._wordForward(this.cursor.row, this.cursor.col);
    if (target.row === this.cursor.row) {
      // Same line — delete from cursor to target col
      this.lines[this.cursor.row] = line.slice(0, this.cursor.col) + line.slice(target.col);
    } else {
      // Cross-line — delete to end of current line + splice
      this.lines[this.cursor.row] = line.slice(0, this.cursor.col) +
        (this.lines[target.row] || '').slice(target.col);
      this.lines.splice(this.cursor.row + 1, target.row - this.cursor.row);
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
    const maxWidth = this.screen.contentWidth();
    const line = this.lines[this.cursor.row] || '';
    const wraps = this._wrapLine(line, maxWidth);
    const cursorPos = this._getCursorDisplayPos(this.cursor.row, this.cursor.col);

    if (cursorPos.lineOffset > 0) {
      // Same logical line, previous visual segment
      const targetOffset = cursorPos.lineOffset - 1;
      let charStart = 0;
      for (let w = 0; w < targetOffset; w++) charStart += wraps[w].length;
      const targetCol = colToIndex(wraps[targetOffset], cursorPos.col);
      this.cursor.col = charStart + Math.min(targetCol, wraps[targetOffset].length);
    } else if (this.cursor.row > 0) {
      // Previous logical line, last visual segment
      this.cursor.row--;
      const prevLine = this.lines[this.cursor.row] || '';
      const prevWraps = this._wrapLine(prevLine, maxWidth);
      const targetOffset = prevWraps.length - 1;
      let charStart = 0;
      for (let w = 0; w < targetOffset; w++) charStart += prevWraps[w].length;
      const targetCol = colToIndex(prevWraps[targetOffset], cursorPos.col);
      this.cursor.col = charStart + Math.min(targetCol, prevWraps[targetOffset].length);
    }
    this._adjustScroll();
  }

  private _moveDown(): void {
    const maxWidth = this.screen.contentWidth();
    const line = this.lines[this.cursor.row] || '';
    const wraps = this._wrapLine(line, maxWidth);
    const cursorPos = this._getCursorDisplayPos(this.cursor.row, this.cursor.col);

    if (cursorPos.lineOffset < wraps.length - 1) {
      // Same logical line, next visual segment
      const targetOffset = cursorPos.lineOffset + 1;
      let charStart = 0;
      for (let w = 0; w < targetOffset; w++) charStart += wraps[w].length;
      const targetCol = colToIndex(wraps[targetOffset], cursorPos.col);
      this.cursor.col = charStart + Math.min(targetCol, wraps[targetOffset].length);
    } else if (this.cursor.row < this.lines.length - 1) {
      // Next logical line, first visual segment
      this.cursor.row++;
      const nextLine = this.lines[this.cursor.row] || '';
      const nextWraps = this._wrapLine(nextLine, maxWidth);
      const targetCol = colToIndex(nextWraps[0], cursorPos.col);
      this.cursor.col = Math.min(targetCol, nextWraps[0].length);
    }
    this._adjustScroll();
  }

  private _clampCol(): void {
    const lineLen = (this.lines[this.cursor.row] || '').length;
    if (this.cursor.col > lineLen) this.cursor.col = lineLen;
  }

  /**
   * Wrap a line to fit within maxWidth, handling CJK character widths
   * Returns array of display lines
   */
  private _wrapLine(text: string, maxWidth: number): string[] {
    if (maxWidth <= 0) return [text];
    const lines: string[] = [];
    let current = '';
    let width = 0;

    for (const ch of text) {
      const cw = displayWidth(ch);
      if (width + cw > maxWidth) {
        if (current) lines.push(current);
        current = ch;
        width = cw;
      } else {
        current += ch;
        width += cw;
      }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [''];
  }

  /**
   * Get cursor display position after wrapping
   * Returns { lineOffset (which wrapped line), col (display column) }
   */
  private _getCursorDisplayPos(lineIdx: number, col: number): { lineOffset: number; col: number } {
    const line = this.lines[lineIdx] || '';
    const maxWidth = this.screen.contentWidth();

    let currentWidth = 0;
    let lineOffset = 0;
    let displayCol = 0;

    for (let i = 0; i < Math.min(col, line.length); i++) {
      const cw = displayWidth(line[i]);
      if (currentWidth + cw > maxWidth) {
        lineOffset++;
        currentWidth = cw;
        displayCol = cw;
      } else {
        currentWidth += cw;
        displayCol += cw;
      }
    }

    return { lineOffset, col: displayCol };
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

  /**
   * Handle mouse click: convert screen coordinates to logical cursor position
   * screenRow/screenCol are 1-based terminal coordinates
   */
  handleMouseClick(screenRow: number, screenCol: number): void {
    const pos = this._screenToLogicalPos(screenRow, screenCol);
    if (!pos) return;
    this.cursor.row = pos.row;
    this.cursor.col = pos.col;
    this._adjustScroll();
    this.render();
  }

  /**
   * Convert screen coordinates (1-based) to logical { row, col } (0-based indices)
   * Returns null if click is outside content area
   */
  private _screenToLogicalPos(screenRow: number, screenCol: number): { row: number; col: number } | null {
    const startRow = this.contentStartRow; // 2
    const visible = this.visibleLines;
    const maxWidth = this.screen.contentWidth();

    // Convert to 0-based display row relative to content start
    const displayRow = screenRow - startRow;
    if (displayRow < 0 || displayRow >= visible) return null;

    // Walk from scrollOffset, accumulating display rows per logical line
    let remaining = displayRow;
    let logicalRow = this.scrollOffset;

    while (logicalRow < this.lines.length) {
      const wrapLines = this._wrapLine(this.lines[logicalRow], maxWidth);
      if (remaining < wrapLines.length) {
        // Found the logical line — 'remaining' tells us which wrap segment
        break;
      }
      remaining -= wrapLines.length;
      logicalRow++;
    }

    // Clicked past all content — clamp to last line
    if (logicalRow >= this.lines.length) {
      logicalRow = this.lines.length - 1;
      remaining = this._wrapLine(this.lines[logicalRow], maxWidth).length - 1;
    }

    const line = this.lines[logicalRow] || '';
    const wrapLines = this._wrapLine(line, maxWidth);
    const wrapIdx = Math.min(remaining, wrapLines.length - 1);

    // Calculate character offset within this wrap segment
    let charOffset = 0;
    for (let w = 0; w < wrapIdx; w++) {
      charOffset += wrapLines[w].length;
    }

    // Convert display column to character index within this wrap segment
    const displayCol = Math.max(0, screenCol - 5); // 5 = line number prefix width
    const segment = wrapLines[wrapIdx] || '';
    const colInSegment = colToIndex(segment, displayCol);
    const col = Math.min(charOffset + colInSegment, line.length);

    return { row: logicalRow, col };
  }

  // --- Rendering ---

  render(): void {
    const startRow = this.contentStartRow;
    const visible = this.visibleLines;
    const maxWidth = this.screen.contentWidth();

    // Title bar
    const dirName = basename(this.store.dir);
    this.screen.drawTitleBar(dirName, this.store.listNotes().length);

    // Content area - with text wrapping
    this.screen.hideCursor();

    // Render lines with wrapping support
    let displayRow = 0;
    for (let lineIdx = this.scrollOffset; lineIdx < this.lines.length && displayRow < visible; lineIdx++) {
      const line = this.lines[lineIdx];
      const wrapLines = this._wrapLine(line, maxWidth);
      const lineNum = String(lineIdx + 1).padStart(3);

      for (let wrapIdx = 0; wrapIdx < wrapLines.length && displayRow < visible; wrapIdx++) {
        const screenRow = startRow + displayRow;

        // Show line number only for first wrapped line of each logical line
        let prefix;
        if (wrapIdx === 0) {
          prefix = ANSI.dim + lineNum + ' ' + ANSI.reset;
        } else {
          prefix = ANSI.dim + '    ' + ANSI.reset;
        }

        this.screen.writeAt(screenRow, 1, prefix + wrapLines[wrapIdx]);
        displayRow++;
      }
    }

    // Clear remaining rows
    for (; displayRow < visible; displayRow++) {
      const screenRow = startRow + displayRow;
      this.screen.clearRow(screenRow);
    }

    // Status bar
    const mode = this.mode;
    let hint = '';
    if (mode === EditorMode.NORMAL) {
      hint = 'i:insert  q:quit  h/j/k/l:move  0/$:行首末  x:del  dd:del line  D:del to end';
    } else if (mode === EditorMode.INSERT) {
      hint = 'Esc:back to normal';
    } else if (mode === EditorMode.COMMAND) {
      hint = 'Enter:exec  Esc:cancel  s:send  q:quit  ls:list';
    }
    this.screen.drawStatusBar(mode, hint, this._tmuxMouseOn);

    // Command line
    if (mode === EditorMode.COMMAND) {
      this.screen.drawCommandLine(':' + this.commandBuf);
    } else {
      this.screen.drawCommandLine('');
    }

    // Cursor position with wrap support
    if (mode === EditorMode.INSERT || mode === EditorMode.NORMAL) {
      // Calculate display row, accounting for wrapped lines
      let displayRow = 0;
      for (let i = this.scrollOffset; i < this.cursor.row && i < this.lines.length; i++) {
        const wrapLines = this._wrapLine(this.lines[i], maxWidth);
        displayRow += wrapLines.length;
      }

      // Add wrap offset for cursor line
      const cursorPos = this._getCursorDisplayPos(this.cursor.row, this.cursor.col);
      displayRow += cursorPos.lineOffset;

      const screenRow = startRow + displayRow;
      const screenCol = 5 + cursorPos.col;

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
