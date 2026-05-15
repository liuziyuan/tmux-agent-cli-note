'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Note, NotePreview, NotesFile, AgentType } from './types';

export class Store {
  public readonly dir: string;
  private readonly noteDir: string;
  private readonly noteFile: string;

  constructor(dir: string) {
    this.dir = dir;
    this.noteDir = path.join(dir, '.note');
    this.noteFile = path.join(this.noteDir, 'notes.json');
  }

  private _ensureDir(): void {
    if (!fs.existsSync(this.noteDir)) {
      fs.mkdirSync(this.noteDir, { recursive: true });
    }
  }

  private load(): NotesFile {
    this._ensureDir();
    try {
      const raw = fs.readFileSync(this.noteFile, 'utf8');
      const data = JSON.parse(raw) as NotesFile;
      for (const note of data.notes) {
        if (note.sentToPane === undefined) note.sentToPane = null;
        if (note.sessionId === undefined) note.sessionId = null;
        if (note.agentType === undefined) note.agentType = null;
      }
      return data;
    } catch {
      return { directory: this.dir, notes: [] };
    }
  }

  private save(data: NotesFile): void {
    this._ensureDir();
    fs.writeFileSync(this.noteFile, JSON.stringify(data, null, 2), 'utf8');
  }

  createNote(content: string = ''): Note {
    const data = this.load();
    const note: Note = {
      id: crypto.randomBytes(3).toString('hex'),
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sentAt: null,
      sentToPane: null,
      sessionId: null,
      agentType: null,
    };
    data.notes.unshift(note);
    this.save(data);
    return note;
  }

  updateNote(id: string, content: string): Note | null {
    const data = this.load();
    const note = data.notes.find(n => n.id === id);
    if (!note) return null;
    note.content = content;
    note.updatedAt = new Date().toISOString();
    this.save(data);
    return note;
  }

  markSent(id: string, paneId: string, sessionId: string | null, agentType: AgentType | null): Note | null {
    const data = this.load();
    const note = data.notes.find(n => n.id === id);
    if (!note) return null;
    note.sentAt = new Date().toISOString();
    note.sentToPane = paneId;
    note.sessionId = sessionId ?? note.sessionId;
    note.agentType = agentType;
    this.save(data);
    return note;
  }

  linkSession(id: string, sessionId: string): Note | null {
    const data = this.load();
    const note = data.notes.find(n => n.id === id);
    if (!note) return null;
    note.sessionId = sessionId;
    this.save(data);
    return note;
  }

  deleteNote(id: string): void {
    const data = this.load();
    data.notes = data.notes.filter(n => n.id !== id);
    this.save(data);
  }

  getNote(id: string): Note | null {
    const data = this.load();
    return data.notes.find(n => n.id === id) ?? null;
  }

  listNotes(): NotePreview[] {
    const data = this.load();
    return data.notes.map(n => ({
      id: n.id,
      preview: n.content.split('\n')[0].slice(0, 60),
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      sentAt: n.sentAt,
      sentToPane: n.sentToPane ?? null,
      sessionId: n.sessionId ?? null,
      agentType: n.agentType ?? null,
    }));
  }

  hasNotes(): boolean {
    return this.listNotes().length > 0;
  }
}

export default Store;
