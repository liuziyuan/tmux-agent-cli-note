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
