'use strict';

const { EventEmitter } = require('events');

class ListView extends EventEmitter {
  constructor(screen, store) {
    super();
    this.screen = screen;
    this.store = store;
    this.selectedIndex = 0;
    this.notes = [];
    this.confirmDelete = false;
    this.refresh();
  }

  refresh() {
    this.notes = this.store.listNotes();
    if (this.selectedIndex >= this.notes.length) {
      this.selectedIndex = Math.max(0, this.notes.length - 1);
    }
  }

  get contentStartRow() {
    return 2;
  }

  get visibleLines() {
    return this.screen.contentHeight();
  }

  handleKey(key) {
    if (this.confirmDelete) {
      if (key === 'y' || key === 'Y') {
        const note = this.notes[this.selectedIndex];
        if (note) {
          this.store.deleteNote(note.id);
        }
        this.confirmDelete = false;
        this.refresh();
        this.render();
        if (this.notes.length === 0) {
          this.emit('empty');
        }
      } else {
        this.confirmDelete = false;
        this.render();
      }
      return;
    }

    switch (key) {
      case 'j':
      case '\x1b[B': // Down arrow
        if (this.selectedIndex < this.notes.length - 1) {
          this.selectedIndex++;
          this._adjustScroll();
          this.render();
        }
        break;
      case 'k':
      case '\x1b[A': // Up arrow
        if (this.selectedIndex > 0) {
          this.selectedIndex--;
          this._adjustScroll();
          this.render();
        }
        break;
      case '\r': // Enter
        if (this.notes.length > 0) {
          this.emit('select', this.notes[this.selectedIndex].id);
        }
        break;
      case 'n':
        this.emit('new');
        break;
      case 'd':
        if (this.notes.length > 0) {
          this.confirmDelete = true;
          this.render();
        }
        break;
      case 'q':
        this.emit('quit');
        break;
    }
  }

  _adjustScroll() {
    const visible = this.visibleLines;
    if (this.selectedIndex < this._scrollOffset) {
      this._scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this._scrollOffset + visible) {
      this._scrollOffset = this.selectedIndex - visible + 1;
    }
  }

  get _scrollOffset() {
    return this.__scrollOffset || 0;
  }

  set _scrollOffset(v) {
    this.__scrollOffset = Math.max(0, v);
  }

  render() {
    const { ANSI } = require('./screen');
    const startRow = this.contentStartRow;
    const visible = this.visibleLines;

    // Title bar
    const path = require('path');
    const dirName = path.basename(this.store.dir);
    this.screen.drawTitleBar(dirName, this.notes.length);

    // Content
    this.screen.hideCursor();

    if (this.notes.length === 0) {
      const emptyMsg = `${ANSI.dim}No notes yet. Press ${ANSI.fg.cyan}n${ANSI.reset}${ANSI.dim} to create one, or ${ANSI.fg.cyan}q${ANSI.reset}${ANSI.dim} to quit.${ANSI.reset}`;
      this.screen.writeAt(startRow + 1, 3, emptyMsg);
      // Clear remaining lines
      for (let i = 2; i < visible; i++) {
        this.screen.clearRow(startRow + i);
      }
    } else {
      const offset = this._scrollOffset;
      for (let i = 0; i < visible; i++) {
        const noteIdx = offset + i;
        const row = startRow + i;
        if (noteIdx < this.notes.length) {
          const note = this.notes[noteIdx];
          const selected = noteIdx === this.selectedIndex;
          const sent = note.sentAt ? `${ANSI.fg.green}✓${ANSI.reset} ` : '  ';
          const idx = String(noteIdx + 1).padStart(2);
          const preview = note.preview || '(empty)';
          const time = new Date(note.updatedAt).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
          });

          let line;
          if (selected) {
            line = `${ANSI.bg.reverse}${sent}${idx} ${preview}${ANSI.bg.unreverse}`;
            // Pad to fill width
            const padLen = this.screen.cols - preview.length - 20;
            if (padLen > 0) line += ' '.repeat(padLen);
            line += time + ANSI.reset;
          } else {
            line = `${sent}${ANSI.dim}${idx}${ANSI.reset} ${preview}  ${ANSI.dim}${time}${ANSI.reset}`;
          }
          this.screen.writeAt(row, 1, line);
        } else {
          this.screen.clearRow(row);
        }
      }
    }

    // Status bar
    this.screen.drawStatusBar('LIST', '↵:edit  n:new  d:delete  j/k:move  q:quit');

    // Command line area
    if (this.confirmDelete) {
      this.screen.drawConfirm('Delete this note? (y/n)');
    } else {
      this.screen.drawCommandLine('');
    }
  }
}

module.exports = ListView;
