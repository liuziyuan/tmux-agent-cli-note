'use strict';

import { EventEmitter } from 'events';
import { basename } from 'path';
import { ListViewEvents, NotePreview, AgentType } from './types';
import { ANSI } from './screen';
import { displayWidth } from './editor';
import type { Screen } from './screen';
import type { Store } from './store';

export class ListView extends EventEmitter {
  screen: Screen;
  store: Store;
  selectedIndex: number;
  notes: NotePreview[];
  confirmDelete: boolean;
  private _scrollOffset: number;

  constructor(screen: Screen, store: Store) {
    super();
    this.screen = screen;
    this.store = store;
    this.selectedIndex = 0;
    this.notes = [];
    this.confirmDelete = false;
    this._scrollOffset = 0;
    this.refresh();
  }

  refresh(): void {
    this.notes = this.store.listNotes();
    if (this.selectedIndex >= this.notes.length) {
      this.selectedIndex = Math.max(0, this.notes.length - 1);
    }
  }

  get contentStartRow(): number {
    return 2;
  }

  get visibleLines(): number {
    return this.screen.contentHeight();
  }

  // Override emit with type safety for known events
  emit<K extends keyof ListViewEvents>(
    event: K,
    ...args: ListViewEvents[K]
  ): boolean;
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  // Override on with type safety for known events
  on<K extends keyof ListViewEvents>(
    event: K,
    listener: (...args: ListViewEvents[K]) => void
  ): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  handleKey(key: string): void {
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

  private static readonly AGENT_LOGO: Record<AgentType, string> = {
    claude: 'CC',
    codex: 'CX',
    gemini: 'GM',
    copilot: 'CP',
    opencode: 'OC',
    unknown: '??',
  };

  private _adjustScroll(): void {
    const visible = this.visibleLines;
    if (this.selectedIndex < this._scrollOffset) {
      this._scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this._scrollOffset + visible) {
      this._scrollOffset = this.selectedIndex - visible + 1;
    }
  }

  render(): void {
    const startRow = this.contentStartRow;
    const visible = this.visibleLines;

    // Title bar
    const dirName = basename(this.store.dir);
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
          // Agent + session: [CC]a1b2c3d or empty (12 chars)
          let meta: string;
          if (note.agentType) {
            const logo = ListView.AGENT_LOGO[note.agentType] ?? '??';
            const sid = note.sessionId ? note.sessionId.slice(-7) : '       ';
            meta = `[${logo}]${sid} `;
          } else {
            meta = '            ';
          }
          const idx = String(noteIdx + 1).padStart(2);
          // Format time as YY/MM/DD HH:MM
          const d = new Date(note.updatedAt);
          const yy = String(d.getFullYear() % 100).padStart(2, '0');
          const mo = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          const time = `${yy}/${mo}/${dd} ${hh}:${mm}`;
          // Layout: idx(2) + space(1) + preview + meta(13) + time(14)
          const fixedWidth = 2 + 1 + 12 + 14;
          const maxPreviewWidth = this.screen.cols - fixedWidth;
          const raw = note.preview || '(empty)';
          let preview = '';
          let pw = 0;
          for (const ch of raw) {
            const cw = displayWidth(ch);
            if (pw + cw > Math.min(60, maxPreviewWidth)) break;
            preview += ch;
            pw += cw;
          }

          let line;
          const padLen = Math.max(1, this.screen.cols - fixedWidth - pw);
          if (selected) {
            line = `${ANSI.bg.reverse}${idx} ${preview}${' '.repeat(padLen)}${meta}${time}${ANSI.reset}`;
          } else {
            line = `${idx} ${preview}${' '.repeat(padLen)}${meta}${time}`;
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

export default ListView;
