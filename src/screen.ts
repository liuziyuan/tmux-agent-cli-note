import type { AnsiCodes } from './types';

const ANSI: AnsiCodes = {
  clear: '\x1b[2J',
  home: '\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  clearLine: '\x1b[2K',
  clearLineRight: '\x1b[K',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  fg: {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
  },
  bg: {
    reverse: '\x1b[7m',
    unreverse: '\x1b[27m',
  },
  cursorTo: (row: number, col: number) => `\x1b[${row};${col}H`,
};

export class Screen {
  rows: number;
  cols: number;
  private _handleResize: () => void;

  static readonly ANSI = ANSI;

  constructor() {
    this.rows = process.stdout.rows || 24;
    this.cols = process.stdout.columns || 80;
    this._handleResize = () => {
      this.rows = process.stdout.rows || 24;
      this.cols = process.stdout.columns || 80;
    };
    process.stdout.on('resize', this._handleResize);
  }

  init(): void {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdout.write(ANSI.hideCursor);
    this.clear();
  }

  destroy(): void {
    process.stdout.write(ANSI.showCursor);
    process.stdout.write(ANSI.reset);
    this.clear();
    process.stdout.removeListener('resize', this._handleResize);
  }

  clear(): void {
    process.stdout.write(ANSI.clear + ANSI.home);
  }

  // contentAreaHeight: rows - title(1) - status(1) - cmdline(1)
  contentHeight(): number {
    return Math.max(1, this.rows - 3);
  }

  writeAt(row: number, col: number, text: string): void {
    process.stdout.write(ANSI.cursorTo(row, col) + ANSI.clearLineRight + text);
  }

  clearRow(row: number): void {
    process.stdout.write(ANSI.cursorTo(row, 1) + ANSI.clearLine);
  }

  drawTitleBar(dirName: string, noteCount: number): void {
    const title = `${ANSI.bold}${ANSI.fg.cyan} note ${ANSI.reset}${ANSI.dim}│${ANSI.reset} ${dirName} ${ANSI.dim}(${noteCount} notes)${ANSI.reset}`;
    this.writeAt(1, 1, title);
  }

  drawStatusBar(mode: string, hint?: string): void {
    const row = this.rows - 1;
    let modeLabel = '';
    if (mode === 'INSERT') {
      modeLabel = `${ANSI.fg.green}${ANSI.bold} -- INSERT --${ANSI.reset}`;
    } else if (mode === 'NORMAL') {
      modeLabel = `${ANSI.fg.yellow} -- NORMAL --${ANSI.reset}`;
    } else if (mode === 'COMMAND') {
      modeLabel = `${ANSI.fg.cyan} -- COMMAND --${ANSI.reset}`;
    } else if (mode === 'LIST') {
      modeLabel = `${ANSI.fg.cyan} -- LIST --${ANSI.reset}`;
    }
    const hintText = hint ? `${ANSI.dim}${hint}${ANSI.reset}` : '';
    const content = modeLabel + '  ' + hintText;
    this.writeAt(row, 1, content);
  }

  drawCommandLine(text?: string): void {
    const row = this.rows;
    this.writeAt(row, 1, text || '');
  }

  drawConfirm(message: string): void {
    const row = this.rows;
    const text = `${ANSI.fg.yellow}${message}${ANSI.reset}`;
    this.writeAt(row, 1, text);
  }

  drawError(message: string): void {
    const row = this.rows;
    const text = `${ANSI.fg.red}${message}${ANSI.reset}`;
    this.writeAt(row, 1, text);
  }

  drawSuccess(message: string): void {
    const row = this.rows;
    const text = `${ANSI.fg.green}${message}${ANSI.reset}`;
    this.writeAt(row, 1, text);
  }

  moveCursor(row: number, col: number): void {
    process.stdout.write(ANSI.cursorTo(row, col));
    process.stdout.write(ANSI.showCursor);
  }

  hideCursor(): void {
    process.stdout.write(ANSI.hideCursor);
  }
}

export { ANSI };
