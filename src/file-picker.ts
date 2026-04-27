'use strict';

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { ANSI } from './screen';
import type { Screen } from './screen';
import { displayWidth } from './editor';

interface FileEntry {
  name: string;
  fullPath: string;
  relativePath: string;
  isDir: boolean;
}

interface FilePickerEvents {
  select: [relativePath: string];
  cancel: [];
}

const EXCLUDE_DIRS = new Set(['node_modules', '.git', '.note']);
const SHOW_HIDDEN = new Set(['.claude', '.github']);

export class FilePicker extends EventEmitter {
  private screen: Screen;
  private rootDir: string;
  currentDir: string;
  entries: FileEntry[] = [];
  selectedIndex = 0;
  private _scrollOffset = 0;

  emit<K extends keyof FilePickerEvents>(event: K, ...args: FilePickerEvents[K]): boolean;
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof FilePickerEvents>(event: K, listener: (...args: FilePickerEvents[K]) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  constructor(screen: Screen, rootDir: string) {
    super();
    this.screen = screen;
    this.rootDir = rootDir;
    this.currentDir = rootDir;
    this._loadEntries();
  }

  handleKey(key: string): void {
    if (key === '\x1b') {
      this.emit('cancel');
      return;
    }

    if (key === 'j' || key === '\x1b[B') {
      if (this.selectedIndex < this.entries.length - 1) {
        this.selectedIndex++;
      }
      return;
    }

    if (key === 'k' || key === '\x1b[A') {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
      }
      return;
    }

    if (key === '\r' || key === 'l' || key === '\x1b[C') {
      const entry = this.entries[this.selectedIndex];
      if (!entry) return;
      if (entry.isDir) {
        this._navigateTo(entry.fullPath);
      } else {
        this.emit('select', entry.relativePath);
      }
      return;
    }

    if (key === 'h' || key === '\x7f' || key === '\b') {
      if (this.currentDir !== this.rootDir) {
        this._navigateTo(path.dirname(this.currentDir));
      }
      return;
    }
  }

  render(startRow: number, maxRows: number): void {
    if (this.entries.length === 0) {
      this.screen.writeAt(startRow, 3, `${ANSI.dim}(empty directory)${ANSI.reset}`);
      for (let i = 1; i < maxRows; i++) {
        this.screen.clearRow(startRow + i);
      }
      return;
    }

    const visible = maxRows;
    this._adjustScroll(visible);
    const cols = this.screen.cols;

    for (let i = 0; i < visible; i++) {
      const entryIdx = this._scrollOffset + i;
      const row = startRow + i;

      if (entryIdx < this.entries.length) {
        const entry = this.entries[entryIdx];
        const selected = entryIdx === this.selectedIndex;
        const displayName = entry.isDir ? entry.name + '/' : entry.name;
        const icon = entry.isDir ? `${ANSI.fg.cyan}` : '';
        const iconReset = entry.isDir ? ANSI.reset : '';
        const content = ` ${icon}${displayName}${iconReset}`;
        const padLen = Math.max(0, cols - 1 - displayWidth(content));

        if (selected) {
          this.screen.writeAt(row, 1, `${ANSI.bg.reverse}${content}${' '.repeat(padLen)}${ANSI.reset}`);
        } else {
          this.screen.writeAt(row, 1, content);
        }
      } else {
        this.screen.clearRow(row);
      }
    }
  }

  private _navigateTo(dirPath: string): void {
    if (!dirPath.startsWith(this.rootDir)) {
      dirPath = this.rootDir;
    }
    this.currentDir = dirPath;
    this.selectedIndex = 0;
    this._scrollOffset = 0;
    this._loadEntries();
  }

  private _loadEntries(): void {
    this.entries = [];
    const dirs: FileEntry[] = [];
    const files: FileEntry[] = [];

    if (this.currentDir !== this.rootDir) {
      const parentDir = path.dirname(this.currentDir);
      dirs.push({
        name: '..',
        fullPath: parentDir,
        relativePath: path.relative(this.rootDir, parentDir),
        isDir: true,
      });
    }

    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(this.currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirents) {
      if (dirent.isDirectory() && EXCLUDE_DIRS.has(dirent.name)) continue;
      if (dirent.name.startsWith('.') && !SHOW_HIDDEN.has(dirent.name)) continue;

      const fullPath = path.join(this.currentDir, dirent.name);
      const entry: FileEntry = {
        name: dirent.name,
        fullPath,
        relativePath: path.relative(this.rootDir, fullPath),
        isDir: dirent.isDirectory(),
      };

      if (dirent.isDirectory()) {
        dirs.push(entry);
      } else {
        files.push(entry);
      }
    }

    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    this.entries = [...dirs, ...files];
  }

  private _adjustScroll(visible: number): void {
    if (this.selectedIndex < this._scrollOffset) {
      this._scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this._scrollOffset + visible) {
      this._scrollOffset = this.selectedIndex - visible + 1;
    }
  }
}
