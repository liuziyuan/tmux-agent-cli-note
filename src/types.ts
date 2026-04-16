export interface AnsiFg {
  green: string;
  yellow: string;
  cyan: string;
  red: string;
  white: string;
  gray: string;
}

export interface AnsiBg {
  reverse: string;
  unreverse: string;
}

export interface AnsiCodes {
  clear: string;
  home: string;
  hideCursor: string;
  showCursor: string;
  clearLine: string;
  clearLineRight: string;
  bold: string;
  dim: string;
  reset: string;
  setBlockCursor: string;
  setBarCursor: string;
  resetCursorStyle: string;
  fg: AnsiFg;
  bg: AnsiBg;
  cursorTo: (row: number, col: number) => string;
}

export interface Note {
  id: string;
  content: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;
  sentAt: string | null;
}

export interface NotePreview {
  id: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

export interface NotesFile {
  directory: string;
  notes: Note[];
}

export type AgentType = 'claude' | 'opencode' | 'codex' | 'gemini' | 'copilot' | 'unknown';

export interface AgentInfo {
  type: AgentType;
  label: string;
}

export interface AgentPane extends AgentInfo {
  id: string;    // tmux pane ID，如 %1
  index: number; // tmux pane index，用于显示
}

export interface TmuxPane {
  id: string;
  active: boolean;
  index: number;
}

export const enum EditorMode {
  NORMAL = 'NORMAL',
  INSERT = 'INSERT',
  COMMAND = 'COMMAND',
}

export interface Cursor {
  row: number;
  col: number;
}

export type CursorStyle = 'on' | 'after';

export interface Config {
  cursor: {
    insertStyle: CursorStyle;
  };
}

export interface EditorEvents {
  quit: [];
  send: [];
  list: [];
}

export interface ListViewEvents {
  select: [id: string];
  new: [];
  quit: [];
  empty: [];
}

export const enum AppState {
  LIST    = 'LIST',
  EDITOR  = 'EDITOR',
  CONFIRM = 'CONFIRM',
  WAIT_KEY = 'WAIT_KEY',
  SELECT  = 'SELECT',
}
